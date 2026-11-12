// SERVER ONLY (see cloudflare.ts). Connects a custom domain to a person's own Cloudflare Pages project, and reports its status.
//   POST /accounts/{id}/pages/projects/{name}/domains          {"name": "www.example.com"}
//   GET  /accounts/{id}/pages/projects/{name}/domains/{domain}
// Cloudflare's rules (from its documentation):
//   * a SUBDOMAIN (www.example.com) can stay on any DNS provider: add a CNAME to <project>.pages.dev;
//   * an APEX domain (example.com) must be a zone on Cloudflare in the SAME account (nameservers pointed at Cloudflare).
// The token is used for one call and dropped: never stored, logged, or put in a message.

import { CF_API, isValidAccountId, isValidProjectName, isValidToken, type CfOptions } from "./cloudflare";

export type DomainStatus = "initializing" | "pending" | "active" | "deactivated" | "blocked" | "error" | "unknown";
export type DomainResult =
  | { ok: true; domain: string; status: DomainStatus; active: boolean; cnameTarget: string; isApex: boolean; detail: string | null }
  | { ok: false; code: string; message: string };

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A plain ASCII hostname with at least two labels, not an IP address, not a *.pages.dev name. Punycode (xn--) is accepted for non-English names. */
export function normalizeDomain(input: string): string | null {
  const d = String(input ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (d.length < 4 || d.length > 253 || /^\d+(\.\d+){3}$/.test(d)) return null;
  const labels = d.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (labels[labels.length - 1]!.length < 2 || /^\d+$/.test(labels[labels.length - 1]!)) return null;
  if (d === "pages.dev" || d.endsWith(".pages.dev") || d.endsWith(".workers.dev") || d === "localhost") return null;
  return d;
}

/** True for a bare registrable-looking name like example.com (two labels). Public-suffix names like example.co.in need a person to judge, so we say "probably". */
export const looksLikeApex = (d: string) => d.split(".").length === 2;

type Input = { accountId: string; token: string; projectName: string; domain: string };
const fail = (code: string, message: string): DomainResult => ({ ok: false, code, message });

async function run(input: Input, mode: "connect" | "status", opts: CfOptions): Promise<DomainResult> {
  if (!isValidAccountId(input.accountId)) return fail("bad_account", "That doesn't look like a Cloudflare account ID (32 letters and numbers).");
  if (!isValidProjectName(input.projectName)) return fail("bad_project", "The Cloudflare project name isn't valid.");
  if (!isValidToken(input.token)) return fail("bad_token", "That doesn't look like a Cloudflare API token.");
  const domain = normalizeDomain(input.domain);
  if (!domain) return fail("bad_domain", "Enter a domain like www.example.com (letters, numbers, hyphens and dots; not an IP address or a pages.dev name).");

  const f = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? CF_API).replace(/\/+$/, "");
  const project = `${base}/accounts/${input.accountId}/pages/projects/${input.projectName}`;
  const call = async (url: string, init: RequestInit) => {
    let res: Response;
    try { res = await f(url, { ...init, signal: opts.signal, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${input.token}` } }); }
    catch { throw fail(opts.signal?.aborted ? "cancelled" : "network", opts.signal?.aborted ? "Cancelled." : "Couldn't reach Cloudflare. Check your connection and try again."); }
    let body: any = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (res.ok && body?.success !== false) return body;
    const codes: number[] = Array.isArray(body?.errors) ? body.errors.map((e: any) => Number(e?.code)).filter(Number.isFinite) : [];
    if (res.status === 401 || res.status === 403 || codes.includes(10000)) throw fail("auth", "Cloudflare didn't accept that token. It needs the \"Cloudflare Pages: Edit\" permission for this account.");
    if (res.status === 404) throw fail("not_found", "Cloudflare couldn't find that project. Publish the site first, then connect the domain.");
    if (res.status === 409) throw fail("conflict", "That domain is already connected to a Cloudflare Pages project.");
    if (res.status === 429) throw fail("rate_limited", "Cloudflare is limiting requests right now. Wait a minute and try again.");
    if (res.status >= 500) throw fail("cloudflare_down", "Cloudflare had a problem. Please try again in a moment.");
    throw fail("rejected", `Cloudflare refused the request${codes.length ? ` (code ${codes[0]})` : ` (HTTP ${res.status})`}. If this domain is an apex name (like example.com), it must be added to Cloudflare DNS in the same account first.`);
  };

  try {
    // the project's own address, which is the CNAME target
    const proj = await call(project, { method: "GET" });
    const target: string = typeof proj?.result?.subdomain === "string" ? proj.result.subdomain : `${input.projectName}.pages.dev`;

    let body: any;
    if (mode === "connect") {
      try {
        body = await call(`${project}/domains`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: domain }) });
      } catch (e) {
        // already connected to THIS project: not an error, just report where it stands
        const again = e && typeof e === "object" && (e as { code?: string }).code === "conflict";
        if (!again) throw e;
        body = await call(`${project}/domains/${domain}`, { method: "GET" });
      }
    } else {
      body = await call(`${project}/domains/${domain}`, { method: "GET" });
    }
    const r = body?.result ?? {};
    const known: DomainStatus[] = ["initializing", "pending", "active", "deactivated", "blocked", "error"];
    const status: DomainStatus = known.includes(r.status) ? r.status : "unknown";
    const detail = [r?.validation_data?.error_message, r?.verification_data?.error_message].find((m) => typeof m === "string" && m) ?? null;
    return { ok: true, domain, status, active: status === "active", cnameTarget: target, isApex: looksLikeApex(domain), detail: detail ? String(detail).slice(0, 200) : null };
  } catch (e) {
    if (e && typeof e === "object" && "ok" in e) return e as DomainResult; // one of our own failures
    return fail("failed", "Couldn't connect the domain. Nothing was changed on your live site.");
  }
}

export const connectDomain = (input: Input, opts: CfOptions = {}) => run(input, "connect", opts);
export const domainStatus = (input: Input, opts: CfOptions = {}) => run(input, "status", opts);
