import type { Patch, Project, Theme } from "@avc/schema";
import { getCloud } from "./cloud";

export type AiFailure = { ok: false; code: string; message: string; status: number };
export type AiSuccess<T> = { ok: true; data: T; credits?: { charged: boolean; cost: number } };
export type AiResult<T> = AiSuccess<T> | AiFailure;

export type AiProgress = { stage: "asking" | "checking" | "fixing"; attempt: number; of: number };

export type StyleResponse = { theme: Theme; notes: string; attempts: number };

export type PatchResponse = { patch: Patch; summary: string; touched: string[]; attempts: number };

const FALLBACK: Record<number, string> = {
  401: "Sign in to use AI.",
  402: "You're out of AI credits.",
  429: "You're going a little fast, or you've reached today's limit. Please try again soon.",
  503: "AI is temporarily unavailable. Please try again.",
};

/** Calls one of our own server's AI endpoints with the signed-in user's token. Never throws. */
export async function askAi<T>(kind: "patch" | "element" | "layout" | "build_page" | "style", body: Record<string, unknown>, signal?: AbortSignal, onProgress?: (p: AiProgress) => void): Promise<AiResult<T>> {
  const token = await getCloud()?.accessToken().catch(() => null);
  if (!token) return { ok: false, code: "signin", message: "Sign in to use AI.", status: 401 };

  let res: Response;
  try {
    res = await fetch(`/api/ai/${kind}`, {
      method: "POST", signal,
      headers: { "content-type": "application/json", accept: "application/x-ndjson, application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (signal?.aborted) return { ok: false, code: "cancelled", message: "Cancelled.", status: 0 };
    return { ok: false, code: "network", message: "Couldn't reach the server. Check your connection and try again.", status: 0 };
  }

  let json: any = null;
  let status = res.status;
  try {
    if ((res.headers.get("content-type") ?? "").includes("application/x-ndjson")) {
      const r = await readStream(res, onProgress, signal);
      json = r.body;
      status = r.status;
    } else {
      json = await res.json();
    }
  } catch {
    if (signal?.aborted) return { ok: false, code: "cancelled", message: "Cancelled.", status: 0 };
    /* non-JSON (a proxy error page, say) or a stream that ended early: handled below */
  }
  if (status === 200 && json?.ok) {
    const { ok: _ok, credits, ...data } = json;
    return { ok: true, data: data as T, credits };
  }
  return {
    ok: false, status, code: typeof json?.code === "string" ? json.code : "failed",
    // Server messages are written to be safe to show; anything else gets a generic line.
    message: typeof json?.message === "string" && json.message.length < 300 ? json.message : (FALLBACK[status] ?? "That didn't work. Please try again."),
  };
}

/** The project reduced to the one page being edited: the server only needs that, and nothing else leaves the browser. */
export function onlyPage(project: Project, pageId: string): Project {
  const page = project.pages.find((p) => p.id === pageId) ?? project.pages[0]!;
  return { ...project, pages: [page] };
}

export const newRequestKey = () => `ui-${crypto.randomUUID()}`;

/**
 * Reads the server's newline-delimited stream: progress lines go to the listener, and the last line is the real answer.
 * Throws if the stream ends without one (connection dropped), which the caller reports as a generic failure.
 */
export async function readStream(res: Response, onProgress?: (p: AiProgress) => void, signal?: AbortSignal): Promise<{ status: number; body: any }> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no stream");
  const dec = new TextDecoder();
  let buf = "";
  let result: { status: number; body: any } | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let m: any;
    try { m = JSON.parse(line); } catch { return; } // ignore a garbled line rather than fail the whole job
    if (m?.type === "progress" && typeof m.attempt === "number") { try { onProgress?.({ stage: m.stage, attempt: m.attempt, of: m.of }); } catch { /* listener bug */ } }
    else if (m?.type === "result" && typeof m.status === "number") result = { status: m.status, body: m.body };
  };
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    buf += dec.decode();
    handle(buf);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (!result) throw new Error("stream ended without a result");
  return result;
}

/** Human wording for a progress step. */
export function progressText(p: AiProgress | null, what = "Working"): string {
  if (!p) return what + "…";
  const n = p.attempt > 1 ? ` (try ${p.attempt} of ${p.of})` : "";
  if (p.stage === "checking") return `Checking the result${n}…`;
  if (p.stage === "fixing") return `Fixing a problem and trying again${n}…`;
  return `${what}${n}…`;
}
