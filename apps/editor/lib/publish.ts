import { getCloud } from "./cloud";
import { readNdjson } from "./ndjson";

export type PublishProgress = { stage: "project" | "token" | "uploading" | "deploying" | "verifying"; done?: number; total?: number };
export type PublishOk = { ok: true; url: string; productionUrl: string; files: number; uploaded: number; verified: boolean; unreachable: string[] };
export type PublishResult = PublishOk | { ok: false; code: string; message: string };

export const isAccountId = (s: string) => /^[a-f0-9]{32}$/.test(s);
export const isProjectName = (s: string) => s.length >= 1 && s.length <= 58 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s);

/** A valid Cloudflare project name from free text ("My School!" -> "my-school"). Empty when nothing usable is left. */
export function projectNameFrom(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 58).replace(/-+$/, "");
}

const FRIENDLY: Record<number, string> = { 401: "Sign in again to publish.", 413: "The site is too large to publish (100 MB limit).", 429: "You're publishing too often. Wait a minute and try again." };

/**
 * Sends the built site to OUR server, which deploys it to the person's own Cloudflare account with their token.
 * The token travels only in a request header over HTTPS, is used once, and is never stored by the server.
 * Never throws.
 */
export async function publishToCloudflare(
  input: { files: Record<string, Uint8Array>; accountId: string; token: string; projectName: string },
  onProgress?: (p: PublishProgress) => void,
  signal?: AbortSignal,
): Promise<PublishResult> {
  const session = await getCloud()?.accessToken().catch(() => null);
  if (!session) return { ok: false, code: "signin", message: "Sign in to publish." };

  const form = new FormData();
  form.append("meta", JSON.stringify({ accountId: input.accountId, projectName: input.projectName }));
  for (const [path, bytes] of Object.entries(input.files)) form.append(path, new Blob([bytes as BlobPart]), path.split("/").pop());

  let res: Response;
  try {
    res = await fetch("/api/publish", { method: "POST", signal, headers: { authorization: `Bearer ${session}`, "x-cf-token": input.token, accept: "application/x-ndjson" }, body: form });
  } catch {
    if (signal?.aborted) return { ok: false, code: "cancelled", message: "Cancelled." };
    return { ok: false, code: "network", message: "Couldn't reach the server. Check your connection and try again." };
  }

  let status = res.status;
  let body: any = null;
  try {
    if ((res.headers.get("content-type") ?? "").includes("application/x-ndjson")) {
      const r = await readNdjson(res, (m) => onProgress?.({ stage: m.stage, done: m.done, total: m.total }), signal);
      status = r.status; body = r.body;
    } else {
      body = await res.json();
    }
  } catch {
    if (signal?.aborted) return { ok: false, code: "cancelled", message: "Cancelled." };
  }
  if (status === 200 && body?.ok) return body as PublishOk;
  return {
    ok: false, code: typeof body?.code === "string" ? body.code : "failed",
    // server messages are written to be safe to show
    message: typeof body?.message === "string" && body.message.length < 300 ? body.message : (FRIENDLY[status] ?? "Publishing didn't work. Nothing was changed on your live site."),
  };
}

export type DomainOk = { ok: true; domain: string; status: string; active: boolean; cnameTarget: string; isApex: boolean; detail: string | null };
export type DomainResult = DomainOk | { ok: false; code: string; message: string };

/** Connects a custom domain to the person's Cloudflare Pages project, or checks its status. Never throws. */
export async function domainRequest(action: "connect" | "status", input: { accountId: string; token: string; projectName: string; domain: string }, signal?: AbortSignal): Promise<DomainResult> {
  const session = await getCloud()?.accessToken().catch(() => null);
  if (!session) return { ok: false, code: "signin", message: "Sign in to connect a domain." };
  let res: Response;
  try {
    res = await fetch("/api/publish/domain", {
      method: "POST", signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${session}`, "x-cf-token": input.token },
      body: JSON.stringify({ accountId: input.accountId, projectName: input.projectName, domain: input.domain, action }),
    });
  } catch {
    return { ok: false, code: signal?.aborted ? "cancelled" : "network", message: signal?.aborted ? "Cancelled." : "Couldn't reach the server. Check your connection and try again." };
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.ok && body?.ok) return body as DomainOk;
  return { ok: false, code: typeof body?.code === "string" ? body.code : "failed", message: typeof body?.message === "string" && body.message.length < 400 ? body.message : (FRIENDLY[res.status] ?? "That didn't work. Please try again.") };
}
