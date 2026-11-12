// SERVER ONLY (see cloudflare.ts). Framework-free request handling for "publish to my Cloudflare account".
//
// POST multipart/form-data:
//   header  x-cf-token : the person's Cloudflare API token  (a header, never the URL or body, so it can't end up in logs or history)
//   field   meta       : JSON {"accountId": "...", "projectName": "..."}
//   fields  <path>     : one file part per site file, named by its path ("index.html", "about/index.html", "_headers", ...)
// Response: newline-delimited JSON. Zero or more {"type":"progress",...} lines, then exactly one
//   {"type":"result","status":200|4xx|5xx,"body":{...}}.
//
// Only signed-in people can use this (it must not become an open proxy), and it is rate limited per person.

import { deployToCloudflare, LIMITS, type CfOptions, type CfProgress } from "./cloudflare";

export const NDJSON = "application/x-ndjson";
const MAX_REQUEST_BYTES = LIMITS.totalBytes + 5 * 1024 * 1024; // site + form overhead

export type PublishDeps = {
  /** Verifies the credential and returns the signed-in user's id, or null. */
  authenticate: (req: Request) => Promise<string | null>;
  /** Returns false when this person is publishing too often. */
  allow?: (userId: string) => boolean;
  cf?: Pick<CfOptions, "fetchImpl" | "baseUrl" | "sleep">;
  log?: (event: Record<string, unknown>) => void;
};

const line = (o: unknown) => new TextEncoder().encode(JSON.stringify(o) + "\n");
const plain = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ ok: false, code, message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export async function handlePublish(req: Request, deps: PublishDeps): Promise<Response> {
  if (req.method !== "POST") return plain(405, "method_not_allowed", "Use POST.", { allow: "POST" });

  const userId = await deps.authenticate(req).catch(() => null);
  if (!userId) return plain(401, "unauthorized", "Sign in to publish.");
  if (deps.allow && !deps.allow(userId)) return plain(429, "rate_limited", "You're publishing too often. Wait a minute and try again.", { "retry-after": "60" });

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return plain(413, "too_large", "The site is too large to publish (100 MB limit).");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) return plain(415, "unsupported_media_type", "Send the site as a form upload.");

  const token = (req.headers.get("x-cf-token") ?? "").trim();
  let form: FormData;
  try { form = await req.formData(); } catch { return plain(400, "bad_request", "The upload could not be read."); }

  let meta: { accountId?: unknown; projectName?: unknown } = {};
  try { meta = JSON.parse(String(form.get("meta") ?? "")); } catch { return plain(400, "bad_request", "Missing publish details."); }
  if (typeof meta.accountId !== "string" || typeof meta.projectName !== "string") return plain(400, "bad_request", "Missing publish details.");

  const files: Record<string, Uint8Array> = {};
  let bytes = 0;
  for (const [name, value] of form.entries()) {
    if (name === "meta") continue;
    if (typeof value === "string") return plain(400, "bad_request", "Unexpected form field.");
    bytes += value.size;
    if (bytes > LIMITS.totalBytes) return plain(413, "too_large", "The site is larger than 100 MB. Compress the images and try again.");
    files[name] = new Uint8Array(await value.arrayBuffer());
  }

  const accountId = meta.accountId;
  const projectName = meta.projectName;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (o: unknown) => { if (open) { try { controller.enqueue(line(o)); } catch { open = false; } } };
      const ctl = new AbortController();
      req.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
      try {
        const r = await deployToCloudflare({ accountId, token, projectName, files }, { ...deps.cf, signal: ctl.signal, onProgress: (p: CfProgress) => send({ type: "progress", ...p }) });
        deps.log?.({ event: "publish", ok: r.ok, files: Object.keys(files).length, ...(r.ok ? { uploaded: r.uploaded, verified: r.verified } : { code: r.code }) }); // never the token or names
        if (r.ok) send({ type: "result", status: 200, body: r });
        else send({ type: "result", status: r.code === "auth" ? 401 : r.code === "rate_limited" ? 429 : r.code === "cloudflare_down" || r.code === "network" ? 503 : 400, body: r });
      } catch {
        send({ type: "result", status: 503, body: { ok: false, code: "failed", message: "Publishing failed unexpectedly. Nothing was changed on your live site." } });
      } finally {
        open = false;
        try { controller.close(); } catch { /* client left */ }
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": NDJSON, "cache-control": "no-store", "x-accel-buffering": "no" } });
}
