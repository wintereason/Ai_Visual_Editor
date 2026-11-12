import { blake3 } from "@noble/hashes/blake3.js";
import { describe, expect, it } from "vitest";
import { exampleProject } from "@avc/schema";
import { buildSite } from "../src";
import { assetHash, deployToCloudflare, isSafePath, isValidAccountId, isValidProjectName, isValidToken, toBase64, type CfInput, type CfProgress } from "../src/cloudflare";
import { createFakeCloudflare } from "./fake-cloudflare.mjs";

const ACCOUNT = "a".repeat(32);
const TOKEN = "good-token-0123456789abcdef";
const enc = new TextEncoder();
const hexAll = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

async function realSite(): Promise<Record<string, Uint8Array>> {
  const r = await buildSite(exampleProject, [], { baseUrl: "https://example.com" });
  if (!r.ok) throw new Error(r.errors.join());
  return r.files;
}
const run = (cf: ReturnType<typeof createFakeCloudflare>, over: Partial<CfInput> = {}, files?: Record<string, Uint8Array>, progress?: CfProgress[]) =>
  realSite().then((site) =>
    deployToCloudflare({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", files: files ?? site, ...over }, { fetchImpl: cf.fetch as never, sleep: async () => {}, onProgress: progress ? (p) => progress.push(p) : undefined }),
  );

describe("asset keys", () => {
  it("is the first 32 hex characters of BLAKE3(base64(contents) + extension)", () => {
    const bytes = enc.encode("<h1>Hi</h1>");
    const full = hexAll(blake3(enc.encode(toBase64(bytes) + "html")));
    expect(assetHash("index.html", bytes)).toBe(full.slice(0, 32));
    expect(assetHash("index.html", bytes)).toHaveLength(32);
  });
  it("depends on the contents and on the extension, not on the folder", () => {
    const a = enc.encode("one"), b = enc.encode("two");
    expect(assetHash("x.html", a)).not.toBe(assetHash("x.html", b));
    expect(assetHash("x.html", a)).not.toBe(assetHash("x.css", a));
    expect(assetHash("a/b/x.html", a)).toBe(assetHash("x.html", a));
    expect(assetHash("a/Page.HTML", a)).toBe(assetHash("a/page.html", a)); // extension is case-folded
  });
  it("the BLAKE3 implementation matches the official empty-input test vector", () => {
    expect(hexAll(blake3(new Uint8Array(0)))).toBe("af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262");
  });
  it("handles large binary files (base64 of a megabyte does not overflow the stack)", () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    expect(assetHash("big.png", big)).toHaveLength(32);
  });
});

describe("input validation happens before any request", () => {
  const bad: [string, Partial<CfInput>, string][] = [
    ["account id", { accountId: "short" }, "bad_account"],
    ["account id with letters past f", { accountId: "g".repeat(32) }, "bad_account"],
    ["project with capitals", { projectName: "My-Site" }, "bad_project"],
    ["project starting with a hyphen", { projectName: "-site" }, "bad_project"],
    ["project too long", { projectName: "a".repeat(59) }, "bad_project"],
    ["project with a path", { projectName: "a/../b" }, "bad_project"],
    ["token with spaces or header injection", { token: "abc def\r\nx-evil: 1 aaaaaaaaaaaaaaa" }, "bad_token"],
    ["token too short", { token: "short" }, "bad_token"],
  ];
  for (const [name, over, code] of bad) {
    it(`rejects ${name}`, async () => {
      const cf = createFakeCloudflare();
      const r = await run(cf, over);
      expect(r).toMatchObject({ ok: false, code });
      expect(cf.state.log).toEqual([]); // not a single request was made
    });
  }
  it("rejects unsafe or oversized file sets", async () => {
    const cf = createFakeCloudflare();
    const ok = { "index.html": enc.encode("x") };
    for (const [files, code] of [
      [{ ...ok, "../evil.html": enc.encode("x") }, "bad_path"],
      [{ ...ok, "/abs.html": enc.encode("x") }, "bad_path"],
      [{ ...ok, "a\\b.html": enc.encode("x") }, "bad_path"],
      [{ ...ok, "a//b.html": enc.encode("x") }, "bad_path"],
      [{ "about.html": enc.encode("x") }, "no_index"],
      [{}, "empty"],
      [{ ...ok, "huge.png": new Uint8Array(26 * 1024 * 1024) }, "file_too_large"],
    ] as const) expect(await run(cf, {}, files as never)).toMatchObject({ ok: false, code });
    expect(cf.state.log).toEqual([]);
  });
  it("path and name helpers", () => {
    expect(isSafePath("a/b.html")).toBe(true);
    expect(isSafePath("a/./b")).toBe(false);
    expect(isValidAccountId("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isValidProjectName("a")).toBe(true);
    expect(isValidProjectName("a-")).toBe(false);
    expect(isValidToken("x".repeat(40))).toBe(true);
  });
});

describe("a successful deployment", () => {
  it("creates the project, uploads every file, deploys, and verifies the live pages", async () => {
    const cf = createFakeCloudflare();
    const progress: CfProgress[] = [];
    const site = await realSite();
    const r = await run(cf, {}, site, progress);
    expect(r).toMatchObject({ ok: true, verified: true, unreachable: [], productionUrl: "https://my-site.pages.dev" });
    if (!r.ok) return;
    expect(r.url).toMatch(/^https:\/\/d\d+\.my-site\.pages\.dev$/);
    const dep = cf.state.deployments.get(r.deploymentId)!;
    // every file except the special ones is in the manifest, with a leading slash, and the key matches the real content
    const expected = Object.keys(site).filter((p) => p !== "_headers");
    expect(Object.keys(dep.manifest).sort()).toEqual(expected.map((p) => "/" + p).sort());
    for (const p of expected) expect(dep.manifest["/" + p]).toBe(assetHash(p, site[p]!));
    expect(dep.wrongKeys).toEqual([]);
    // _headers travelled with the deployment, and was not uploaded as an asset
    expect(dep.files["_headers"]).toContain("Content-Security-Policy");
    expect(Object.keys(dep.manifest)).not.toContain("/_headers");
    // the served home page is byte-for-byte what was built
    const home = await cf.fetch(`${r.url}/`);
    expect(home.status).toBe(200);
    expect(new Uint8Array(await home.arrayBuffer())).toEqual(site["index.html"]);
    expect(progress.map((p) => p.stage)).toEqual(expect.arrayContaining(["project", "token", "uploading", "deploying", "verifying"]));
    const last = progress.filter((p) => p.stage === "uploading").pop() as { done: number; total: number };
    expect(last.done).toBe(last.total);
  });
  it("reuses an existing project, and only uploads files Cloudflare doesn't already have", async () => {
    const cf = createFakeCloudflare();
    const first = await run(cf);
    expect(first.ok).toBe(true);
    const uploadedFirst = cf.state.uploadedKeys.length;
    const log0 = cf.state.log.length;
    const second = await run(cf);
    expect(second).toMatchObject({ ok: true, uploaded: 0, verified: true });
    expect(cf.state.uploadedKeys.length).toBe(uploadedFirst); // nothing re-sent
    expect(cf.state.log.slice(log0).filter((l) => l.startsWith("POST /accounts/") && l.endsWith("/pages/projects"))).toEqual([]); // no second create
  });
  it("sends the same bytes to many files with identical content only once", async () => {
    const cf = createFakeCloudflare();
    const same = enc.encode("<p>same</p>");
    await run(cf, {}, { "index.html": same, "a/index.html": same, "b/index.html": same });
    expect(cf.state.uploadedKeys).toHaveLength(1);
  });
  it("batches big sites", async () => {
    const cf = createFakeCloudflare();
    const files: Record<string, Uint8Array> = { "index.html": enc.encode("home") };
    for (let i = 0; i < 1200; i++) files[`p${i}.txt`] = enc.encode("file " + i);
    const r = await run(cf, {}, files);
    expect(r).toMatchObject({ ok: true, uploaded: 1201 });
    expect(cf.state.uploadCalls).toBe(3); // 500 + 500 + 201
  });
  it("refreshes the short-lived upload token once if it expires mid-upload", async () => {
    const cf = createFakeCloudflare({ expireJwtAfterUploads: 1 });
    const r = await run(cf);
    expect(r).toMatchObject({ ok: true, verified: true });
    expect(cf.state.tokenCalls).toBe(2);
  });
  it("waits for the deployment to finish", async () => {
    const cf = createFakeCloudflare({ deployPolls: 4 });
    expect(await run(cf)).toMatchObject({ ok: true, verified: true });
  });
});

describe("failures are explained, never leak the token, and never half-succeed silently", () => {
  it("a rejected token says what permission is needed", async () => {
    const cf = createFakeCloudflare({ token: "some-other-token-0123456789" });
    const r = await run(cf);
    expect(r).toMatchObject({ ok: false, code: "auth" });
    expect((r as { message: string }).message).toContain("Pages: Edit");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("a wrong account id is reported as such", async () => {
    const r = await run(createFakeCloudflare({ accountId: "b".repeat(32) }));
    expect(r).toMatchObject({ ok: false, code: "not_found" });
  });
  it("network failures and cancellation", async () => {
    const down = async () => { throw new TypeError("fetch failed: secret-detail"); };
    const r1 = await deployToCloudflare({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", files: await realSite() }, { fetchImpl: down as never });
    expect(r1).toMatchObject({ ok: false, code: "network" });
    expect(JSON.stringify(r1)).not.toContain("secret-detail");
    const ctl = new AbortController();
    ctl.abort();
    const aborted = async (_u: unknown, init: RequestInit) => { if (init.signal?.aborted) throw new DOMException("aborted", "AbortError"); return new Response("{}"); };
    expect(await deployToCloudflare({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", files: await realSite() }, { fetchImpl: aborted as never, signal: ctl.signal })).toMatchObject({ ok: false, code: "cancelled" });
  });
  it("Cloudflare outages and rate limits map to friendly messages", async () => {
    for (const [status, code] of [[503, "cloudflare_down"], [429, "rate_limited"]] as const) {
      const f = async () => new Response(JSON.stringify({ success: false, errors: [{ code: 1, message: "internal secret text" }] }), { status });
      const r = await deployToCloudflare({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", files: await realSite() }, { fetchImpl: f as never });
      expect(r).toMatchObject({ ok: false, code });
      expect(JSON.stringify(r)).not.toContain("secret text");
    }
  });
  it("Cloudflare's free-text error messages are never repeated to the user", async () => {
    const f = async () => new Response(JSON.stringify({ success: false, errors: [{ code: 8000095, message: "your token abc-secret was used" }] }), { status: 400 });
    const r = await deployToCloudflare({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", files: await realSite() }, { fetchImpl: f as never });
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    expect(JSON.stringify(r)).not.toContain("abc-secret");
    expect((r as { message: string }).message).toContain("8000095");
  });
  it("a failed deployment is reported as failed", async () => {
    const cf = createFakeCloudflare();
    const orig = cf.api;
    cf.api = async (req: Request) => { const res = await orig(req); if (/deployments\/d\d+$/.test(new URL(req.url).pathname)) return new Response(JSON.stringify({ success: true, result: { latest_stage: { name: "deploy", status: "failure" } } }), { status: 200 }); return res; };
    expect(await run(cf)).toMatchObject({ ok: false, code: "deploy_failed" });
  });
});

describe("verification catches the silent failure mode (wrong file keys)", () => {
  it("if Cloudflare ends up not serving the pages, the result says so instead of claiming success", async () => {
    const cf = createFakeCloudflare();
    // Corrupt what the fake STORES, after upload, so served content no longer matches its key: the situation a wrong hash produces.
    const orig = cf.api;
    cf.api = async (req: Request) => {
      const res = await orig(req);
      if (new URL(req.url).pathname.endsWith("/upsert-hashes")) for (const [k, v] of cf.state.store) cf.state.store.set(k, { ...v, value: toBase64(enc.encode("tampered")) });
      return res;
    };
    const r = await run(cf);
    expect(r.ok).toBe(true); // the deployment itself was accepted, like the real service
    if (r.ok) {
      expect(r.verified).toBe(false);
      expect(r.unreachable).toContain("/");
    }
  });
  it("only *.pages.dev https addresses are ever fetched by our server (against the real API)", async () => {
    const cf = createFakeCloudflare();
    const orig = cf.api;
    cf.api = async (req: Request) => {
      const res = await orig(req);
      if (req.method === "POST" && new URL(req.url).pathname.endsWith("/deployments")) {
        const b = await res.json();
        b.result.url = "https://internal.example.com/admin";
        return new Response(JSON.stringify(b), { status: 200 });
      }
      return res;
    };
    const fetched: string[] = [];
    const spy = (async (u: string, i: RequestInit) => { fetched.push(String(u)); return cf.fetch(u, i); }) as typeof fetch;
    const r = await deployToCloudflare({ accountId: ACCOUNT, token: TOKEN, projectName: "my-site", files: await realSite() }, { fetchImpl: ((u: string, i: RequestInit) => (String(u).startsWith("https://api.cloudflare.com") ? cf.api(new Request(u, i)) : spy(u, i))) as never, sleep: async () => {} });
    expect(r).toMatchObject({ ok: false, code: "rejected" });
    expect(fetched.some((u) => u.includes("internal.example.com"))).toBe(false);
  });
});
