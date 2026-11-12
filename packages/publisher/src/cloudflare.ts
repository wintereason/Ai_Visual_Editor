// SERVER ONLY. Deploys a built site to a person's OWN Cloudflare Pages account with their API token.
// Import it by path ("@avc/publisher/src/cloudflare"), never from the package index: it must not end up in browser bundles.
//
// The token is used for the duration of one call and then dropped: it is never stored, logged, or put in an error message.
//
// Protocol (Pages "Direct Upload", the same steps wrangler performs):
//   1. GET  /accounts/{id}/pages/projects/{name}            (create the project when missing)
//   2. GET  /accounts/{id}/pages/projects/{name}/upload-token   -> short-lived JWT
//   3. POST /pages/assets/check-missing   {hashes}          (JWT)  -> which files Cloudflare doesn't have yet
//   4. POST /pages/assets/upload          [{key,value,metadata,base64}]  (JWT)
//   5. POST /pages/assets/upsert-hashes   {hashes}          (JWT)
//   6. POST /accounts/{id}/pages/projects/{name}/deployments   multipart: manifest, branch, _headers
// A file's key is BLAKE3(base64(bytes) + extension) cut to 32 hex characters. A WRONG key is accepted without complaint and
// the site then answers 404, so after deploying we fetch the live pages and report whether they really load.

import { blake3 } from "@noble/hashes/blake3.js";

export const CF_API = "https://api.cloudflare.com/client/v4";

export type CfProgress =
  | { stage: "project" | "token" | "deploying" | "verifying" }
  | { stage: "uploading"; done: number; total: number };

export type CfInput = { accountId: string; token: string; projectName: string; files: Record<string, Uint8Array> };
export type CfResult =
  | { ok: true; url: string; productionUrl: string; deploymentId: string; files: number; uploaded: number; verified: boolean; unreachable: string[] }
  | { ok: false; code: string; message: string };
export type CfOptions = { fetchImpl?: typeof fetch; baseUrl?: string; onProgress?: (p: CfProgress) => void; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> };

export const LIMITS = { files: 2000, fileBytes: 25 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, batchFiles: 500, batchBytes: 30 * 1024 * 1024 } as const;
const SPECIAL = new Set(["_headers", "_redirects", "_routes.json"]); // sent with the deployment itself, not as assets

const MIME: Record<string, string> = {
  html: "text/html", css: "text/css", js: "text/javascript", json: "application/json", txt: "text/plain", xml: "application/xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", map: "application/json", webmanifest: "application/manifest+json",
};

export const isValidAccountId = (s: string) => /^[a-f0-9]{32}$/.test(s);
export const isValidProjectName = (s: string) => s.length >= 1 && s.length <= 58 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s);
export const isValidToken = (s: string) => /^[A-Za-z0-9_-]{20,200}$/.test(s);

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const extOf = (path: string) => { const f = path.split("/").pop()!; const i = f.lastIndexOf("."); return i > 0 ? f.slice(i + 1).toLowerCase() : ""; };

/** Cloudflare's asset key for a file: first 32 hex characters of BLAKE3(base64(contents) + extension). */
export function assetHash(path: string, bytes: Uint8Array): string {
  const digest = blake3(new TextEncoder().encode(toBase64(bytes) + extOf(path)));
  return Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Paths must be plain relative file paths: no leading slash, backslash, "..", empty or odd segments. */
export function isSafePath(p: string): boolean {
  return p.length > 0 && p.length <= 300 && !p.startsWith("/") && !p.includes("\\") && !p.includes("\0") && p.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

const fail = (code: string, message: string): CfResult => ({ ok: false, code, message });

class CfError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export async function deployToCloudflare(input: CfInput, opts: CfOptions = {}): Promise<CfResult> {
  const { accountId, token, projectName, files } = input;
  const f = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? CF_API).replace(/\/+$/, "");
  const say = (p: CfProgress) => { try { opts.onProgress?.(p); } catch { /* a broken listener never breaks a deploy */ } };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // ---- validate everything before any request is made ----
  if (!isValidAccountId(accountId)) return fail("bad_account", "That doesn't look like a Cloudflare account ID (32 letters and numbers).");
  if (!isValidProjectName(projectName)) return fail("bad_project", "Use 1 to 58 lowercase letters, numbers or hyphens for the project name (not starting or ending with a hyphen).");
  if (!isValidToken(token)) return fail("bad_token", "That doesn't look like a Cloudflare API token.");
  const paths = Object.keys(files);
  if (paths.length === 0) return fail("empty", "There are no files to publish.");
  if (paths.length > LIMITS.files) return fail("too_many_files", `The site has too many files (${paths.length}; the limit is ${LIMITS.files}).`);
  let total = 0;
  for (const p of paths) {
    if (!isSafePath(p)) return fail("bad_path", "The site contains a file with an unsafe name.");
    const n = files[p]!.length;
    if (n > LIMITS.fileBytes) return fail("file_too_large", `"${p}" is larger than Cloudflare's 25 MB file limit.`);
    total += n;
  }
  if (total > LIMITS.totalBytes) return fail("too_large", "The site is larger than 100 MB. Compress the images and try again.");
  if (!paths.includes("index.html")) return fail("no_index", "The site has no home page (index.html).");

  const acct = `${base}/accounts/${accountId}`;
  const project = `${acct}/pages/projects/${projectName}`;

  /** One Cloudflare API call. Returns the parsed envelope; maps failures to safe, token-free errors. */
  async function call(url: string, init: RequestInit, bearer: string, what: string): Promise<any> {
    let res: Response;
    try {
      res = await f(url, { ...init, signal: opts.signal, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${bearer}` } });
    } catch {
      if (opts.signal?.aborted) throw new CfError("cancelled", "Cancelled.");
      throw new CfError("network", "Couldn't reach Cloudflare. Check your connection and try again.");
    }
    let body: any = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (res.ok && body?.success !== false) return { status: res.status, body };
    const codes = Array.isArray(body?.errors) ? body.errors.map((e: any) => Number(e?.code)).filter(Number.isFinite) : [];
    if (res.status === 401 || res.status === 403 || codes.includes(10000)) throw new CfError("auth", "Cloudflare didn't accept that token. It needs the \"Cloudflare Pages: Edit\" permission for this account.");
    if (res.status === 404) throw new CfError("not_found", `Cloudflare couldn't find that (${what}). Check the account ID.`);
    if (res.status === 429) throw new CfError("rate_limited", "Cloudflare is limiting requests right now. Wait a minute and try again.");
    if (res.status >= 500) throw new CfError("cloudflare_down", "Cloudflare had a problem. Please try again in a moment.");
    // Surface only Cloudflare's numeric codes, never its free text (which could echo request details).
    throw new CfError("rejected", `Cloudflare refused the request (${what}${codes.length ? `, code ${codes[0]}` : `, HTTP ${res.status}`}).`);
  }

  try {
    // 1. project
    say({ stage: "project" });
    let subdomain = `${projectName}.pages.dev`;
    try {
      const got = await call(project, { method: "GET" }, token, "project");
      subdomain = got.body?.result?.subdomain ?? subdomain;
    } catch (e) {
      if (!(e instanceof CfError) || e.code !== "not_found") throw e;
      const made = await call(`${acct}/pages/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: projectName, production_branch: "main" }) }, token, "create project");
      subdomain = made.body?.result?.subdomain ?? subdomain;
    }

    // 2. upload token
    say({ stage: "token" });
    const getJwt = async (): Promise<string> => {
      const r = await call(`${project}/upload-token`, { method: "GET" }, token, "upload token");
      const jwt = r.body?.result?.jwt;
      if (typeof jwt !== "string" || jwt.length < 10) throw new CfError("rejected", "Cloudflare didn't give an upload token.");
      return jwt;
    };
    let jwt = await getJwt();

    // 3-5. assets
    const assets = paths.filter((p) => !SPECIAL.has(p));
    const hashOf = new Map(assets.map((p) => [p, assetHash(p, files[p]!)]));
    const unique = [...new Set(hashOf.values())];
    let missing: string[] = unique;
    try {
      const r = await call(`${base}/pages/assets/check-missing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hashes: unique }) }, jwt, "check files");
      if (Array.isArray(r.body?.result)) missing = r.body.result.filter((h: unknown): h is string => typeof h === "string" && unique.includes(h));
    } catch (e) {
      if (e instanceof CfError && (e.code === "cancelled" || e.code === "network")) throw e;
      /* if the check isn't available, simply upload everything */
    }

    const byHash = new Map<string, string>();
    for (const [p, h] of hashOf) if (!byHash.has(h)) byHash.set(h, p);
    const batches: string[][] = [];
    let cur: string[] = [];
    let curBytes = 0;
    for (const h of missing) {
      const size = files[byHash.get(h)!]!.length * 1.4;
      if (cur.length && (cur.length >= LIMITS.batchFiles || curBytes + size > LIMITS.batchBytes)) { batches.push(cur); cur = []; curBytes = 0; }
      cur.push(h); curBytes += size;
    }
    if (cur.length) batches.push(cur);

    let done = 0;
    say({ stage: "uploading", done, total: missing.length });
    for (const batch of batches) {
      const payload = JSON.stringify(batch.map((h) => {
        const p = byHash.get(h)!;
        return { key: h, value: toBase64(files[p]!), metadata: { contentType: MIME[extOf(p)] ?? "application/octet-stream" }, base64: true };
      }));
      try {
        await call(`${base}/pages/assets/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: payload }, jwt, "upload files");
      } catch (e) {
        if (!(e instanceof CfError) || e.code !== "auth") throw e;
        jwt = await getJwt(); // the short-lived token may simply have expired mid-upload: refresh once
        await call(`${base}/pages/assets/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: payload }, jwt, "upload files");
      }
      done += batch.length;
      say({ stage: "uploading", done, total: missing.length });
    }
    await call(`${base}/pages/assets/upsert-hashes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hashes: unique }) }, jwt, "register files");

    // 6. deployment
    say({ stage: "deploying" });
    const manifest: Record<string, string> = {};
    for (const p of assets) manifest["/" + p] = hashOf.get(p)!;
    const form = new FormData();
    form.append("manifest", JSON.stringify(manifest));
    form.append("branch", "main");
    for (const name of SPECIAL) if (files[name]) form.append(name, new Blob([files[name]!.slice().buffer as ArrayBuffer], { type: "text/plain" }), name);
    const dep = await call(`${project}/deployments`, { method: "POST", body: form }, token, "create deployment");
    const deploymentId: unknown = dep.body?.result?.id;
    const url: unknown = dep.body?.result?.url;
    if (typeof deploymentId !== "string" || typeof url !== "string" || !/^https?:\/\//.test(url)) throw new CfError("rejected", "Cloudflare didn't confirm the deployment.");
    // Our server will fetch this address to check the site. Against the real Cloudflare it must be a *.pages.dev https address,
    // so a surprising API answer can never point our server at somewhere else. (A custom baseUrl means a test double.)
    if (opts.baseUrl === undefined) {
      let host = "";
      try { const u = new URL(url); host = u.protocol === "https:" ? u.hostname : ""; } catch { /* invalid */ }
      if (!host.endsWith(".pages.dev")) throw new CfError("rejected", "Cloudflare returned an unexpected address, so the site was not checked.");
    }

    // wait for the deployment to finish building
    for (let i = 0; i < 40; i++) {
      const d = await call(`${project}/deployments/${deploymentId}`, { method: "GET" }, token, "deployment status");
      const stage = d.body?.result?.latest_stage;
      if (stage?.status === "failure") throw new CfError("deploy_failed", "Cloudflare couldn't finish the deployment.");
      if (stage?.name === "deploy" && stage?.status === "success") break;
      if (i === 39) break; // give up waiting; verification below tells the truth
      await sleep(1500);
    }

    // verify: do the pages actually load? (a wrong file key would 404 here)
    say({ stage: "verifying" });
    const pages = ["index.html", ...assets.filter((p) => p.endsWith("/index.html")).slice(0, 4)].map((p) => (p === "index.html" ? "/" : "/" + p.replace(/index\.html$/, "")));
    let unreachable = pages;
    for (let attempt = 0; attempt < 8 && unreachable.length; attempt++) {
      if (attempt) await sleep(2000);
      const still: string[] = [];
      for (const path of unreachable) {
        try { const r = await f(url.replace(/\/$/, "") + path, { method: "GET", redirect: "follow", signal: opts.signal }); if (r.status !== 200) still.push(path); }
        catch { still.push(path); }
      }
      unreachable = still;
    }

    return { ok: true, url, productionUrl: `https://${subdomain}`, deploymentId, files: assets.length, uploaded: missing.length, verified: unreachable.length === 0, unreachable };
  } catch (e) {
    if (e instanceof CfError) return fail(e.code, e.message);
    return fail("failed", "Publishing failed unexpectedly. Nothing was changed on your live site.");
  }
}
