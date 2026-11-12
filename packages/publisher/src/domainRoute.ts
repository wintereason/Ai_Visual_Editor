// SERVER ONLY. POST JSON {"accountId","projectName","domain","action":"connect"|"status"} with the person's Cloudflare token in the
// x-cf-token header. Same rules as the publish route: signed-in only, rate limited, token never stored or logged.
import { connectDomain, domainStatus } from "./cloudflareDomains";
import type { PublishDeps } from "./publishRoute";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export async function handleDomain(req: Request, deps: PublishDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { ok: false, code: "method_not_allowed", message: "Use POST." }, { allow: "POST" });
  const userId = await deps.authenticate(req).catch(() => null);
  if (!userId) return json(401, { ok: false, code: "unauthorized", message: "Sign in to connect a domain." });
  if (deps.allow && !deps.allow(userId)) return json(429, { ok: false, code: "rate_limited", message: "You're going a little fast. Wait a minute and try again." }, { "retry-after": "60" });

  let b: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.length > 2000) return json(413, { ok: false, code: "too_large", message: "That request is too large." });
    b = JSON.parse(text);
  } catch { return json(400, { ok: false, code: "bad_request", message: "The request wasn't valid." }); }
  if (typeof b.accountId !== "string" || typeof b.projectName !== "string" || typeof b.domain !== "string" || (b.action !== "connect" && b.action !== "status"))
    return json(400, { ok: false, code: "bad_request", message: "Missing details." });

  const token = (req.headers.get("x-cf-token") ?? "").trim();
  const run = b.action === "connect" ? connectDomain : domainStatus;
  const r = await run({ accountId: b.accountId, token, projectName: b.projectName, domain: b.domain }, { ...deps.cf, signal: req.signal });
  deps.log?.({ event: "domain", action: b.action, ok: r.ok, ...(r.ok ? { status: r.status } : { code: r.code }) }); // never the token, account or domain
  if (r.ok) return json(200, r);
  return json(r.code === "auth" ? 401 : r.code === "rate_limited" ? 429 : r.code === "cloudflare_down" || r.code === "network" ? 503 : r.code === "not_found" ? 404 : 400, r);
}
