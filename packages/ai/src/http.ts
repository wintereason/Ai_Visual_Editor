import { ThemeSchema, validateProject } from "@avc/schema";
import { z } from "zod";
import { estimateCredits, runCharged, type CreditsStore, type JobKind } from "./credits";
import type { Progress } from "./loop";
import { collectText, MODERATION_MESSAGES, type Moderator } from "./moderation";
import { runBuildPage } from "./buildAgent";
import { runElementCreator } from "./elementAgent";
import { runLayoutAgent } from "./layoutAgent";
import { runPatchAgent } from "./patchAgent";
import { matchesImageSignature, MAX_STYLE_IMAGE_BYTES, runStyleAgent, STYLE_IMAGE_TYPES } from "./styleAgent";
import type { ModelProvider } from "./provider";

// Framework-free request handling (standard Request/Response) so it is unit-testable without a server and can be mounted
// in Next.js, an Edge Function or a plain Node server. Everything a client sends is untrusted; nothing a provider or the
// database says is passed through verbatim.

export const MAX_BODY_BYTES = 300_000;
/** The style endpoint carries a picture (base64), so it gets a larger, still strict, limit. */
export const MAX_STYLE_BODY_BYTES = 6_500_000;

export type AiDeps = {
  provider: ModelProvider | null;
  credits: CreditsStore;
  /** Returns the signed-in user's id, or null. Must verify the credential (never trust a client-supplied user id). */
  authenticate: (req: Request) => Promise<string | null>;
  newId: () => string;
  /** Returns false when this user is sending too many requests. */
  allow?: (userId: string) => boolean;
  model?: string;
  /** When set, requests and results are safety-checked, failing closed (see moderation.ts). */
  moderator?: Moderator;
  log?: (event: Record<string, unknown>) => void;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json(status, { ok: false, code, message, ...extra });

const key = z.string().min(8).max(80).optional();
const briefShape = z.object({
  prompt: z.string().min(1).max(4000),
  style: z.enum(["minimal", "bold", "playful", "corporate"]).optional(),
  pages: z.array(z.string().max(80)).max(12).optional(),
  language: z.string().max(30).optional(),
}).strict();

const SCHEMAS = {
  patch: z.object({ project: z.unknown(), nodeId: z.string().min(1).max(64), instruction: z.string().min(1).max(4000), idempotencyKey: key }).strict(),
  element: z.object({ theme: z.unknown(), prompt: z.string().min(1).max(2000), idempotencyKey: key }).strict(),
  layout: z.object({ brief: briefShape, idempotencyKey: key }).strict(),
  style: z.object({
    image: z.object({ mediaType: z.enum(STYLE_IMAGE_TYPES), data: z.string().min(100).max(6_000_000) }).strict(),
    hint: z.string().max(300).optional(),
    idempotencyKey: key,
  }).strict(),
  build_page: z.object({ project: z.unknown(), pageId: z.string().min(1).max(64), brief: briefShape, idempotencyKey: key }).strict(),
} as const;

export type AiKind = keyof typeof SCHEMAS;
export const AI_KINDS = Object.keys(SCHEMAS) as AiKind[];
// A style request is billed and logged as a layout-sized job (it reads an image), so no new database job kind is needed.
const jobKind: Record<AiKind, JobKind> = { patch: "patch", element: "element", layout: "layout", build_page: "build", style: "layout" };

async function readBody(req: Request, limit: number): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { ok: false, res: fail(415, "unsupported_media_type", "Send JSON.") };
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return { ok: false, res: fail(413, "too_large", "That request is too large.") };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, res: fail(400, "bad_request", "The request could not be read.") };
  }
  if (new TextEncoder().encode(text).length > limit) return { ok: false, res: fail(413, "too_large", "That request is too large.") };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: fail(400, "bad_request", "The request was not valid JSON.") };
  }
}

const PROVIDER_STATUS: Record<string, [number, string]> = {
  rate_limited: [429, "The AI service is busy. Please try again in a moment."],
  overloaded: [503, "The AI service is temporarily unavailable. Please try again."],
  network: [503, "The AI service is temporarily unavailable. Please try again."],
  timeout: [503, "The AI service took too long. Please try again."],
  refused: [422, "The AI declined that request. Try rephrasing."],
  auth: [503, "AI features are not available right now."], // our key problem, not the user's: say nothing specific
  bad_request: [503, "AI features are not available right now."],
  invalid_response: [503, "The AI service returned something unusable. Please try again."],
};

export async function handleAiRequest(kind: AiKind, req: Request, deps: AiDeps, opts: { onProgress?: (p: Progress) => void } = {}): Promise<Response> {
  if (req.method !== "POST") return json(405, { ok: false, code: "method_not_allowed", message: "Use POST." }, { allow: "POST" });
  if (!deps.provider) return fail(503, "not_configured", "AI features are not set up on this server yet.");

  const userId = await deps.authenticate(req).catch(() => null);
  if (!userId) return fail(401, "unauthorized", "Sign in to use AI.");
  if (deps.allow && !deps.allow(userId)) return json(429, { ok: false, code: "rate_limited", message: "You're going a little fast. Please wait a moment." }, { "retry-after": "30" });

  const body = await readBody(req, kind === "style" ? MAX_STYLE_BODY_BYTES : MAX_BODY_BYTES);
  if (!body.ok) return body.res;
  const parsed = SCHEMAS[kind].safeParse(body.value);
  if (!parsed.success) return fail(400, "invalid_request", `Invalid request: ${parsed.error.issues[0]?.path.join(".") || "body"} ${parsed.error.issues[0]?.message ?? ""}`.trim());
  const b = parsed.data as any;

  // What a client sends is validated exactly like a saved project: the server never works from unvalidated data.
  let project: ReturnType<typeof validateProject> | null = null;
  if (kind === "patch" || kind === "build_page") {
    project = validateProject(b.project);
    if (!project.ok) return fail(400, "invalid_project", "The project data is not valid.");
  }
  let theme: z.infer<typeof ThemeSchema> | null = null;
  if (kind === "element") {
    const t = ThemeSchema.safeParse(b.theme);
    if (!t.success) return fail(400, "invalid_request", "The theme is not valid.");
    theme = t.data;
  }

  if (kind === "style") {
    // The picture is untrusted: it must be well-formed base64, within the size limit, and really be the kind of file it claims to be.
    const data: string = b.image.data;
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return fail(400, "invalid_image", "That picture couldn't be read. Try a PNG or JPEG.");
    const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (bytes > MAX_STYLE_IMAGE_BYTES) return fail(413, "image_too_large", "That picture is too large. Use one under 4 MB.");
    let head: Uint8Array;
    try { head = Uint8Array.from(atob(data.slice(0, 32)), (c) => c.charCodeAt(0)); } catch { return fail(400, "invalid_image", "That picture couldn't be read. Try a PNG or JPEG."); }
    if (!matchesImageSignature(b.image.mediaType, head)) return fail(400, "invalid_image", "That file isn't a real picture of that type. Try a PNG or JPEG.");
  }

  const credits = estimateCredits(jobKind[kind], 1);
  const idem = b.idempotencyKey ?? `auto-${crypto.randomUUID()}`;
  const controller = new AbortController();
  req.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  const agent = async () => {
    const common = { provider: deps.provider!, newId: deps.newId, signal: controller.signal, onProgress: opts.onProgress };
    switch (kind) {
      case "patch": return runPatchAgent({ ...common, project: (project as { project: any }).project, nodeId: b.nodeId, instruction: b.instruction });
      case "element": return runElementCreator({ ...common, theme: theme!, prompt: b.prompt });
      case "layout": return runLayoutAgent({ ...common, brief: b.brief });
      case "style": return runStyleAgent({ ...common, image: b.image, hint: b.hint });
      default: return runBuildPage({ provider: deps.provider!, approved: (project as { project: any }).project, pageId: b.pageId, brief: b.brief, signal: controller.signal, onProgress: opts.onProgress });
    }
  };

  /** The agent, wrapped with a safety check before it runs (on the request) and after (on its answer). */
  const run = async () => {
    const mod = deps.moderator;
    if (!mod) return agent();
    const asked = kind === "patch" ? b.instruction : kind === "element" ? b.prompt : kind === "style" ? b.hint : [b.brief?.prompt, ...(b.brief?.pages ?? [])];
    const pre = await mod.check(collectText(asked), controller.signal);
    if (pre.status !== "clear") return { ok: false, reason: pre.status === "flagged" ? "moderated" : "moderation_unavailable", message: pre.status === "flagged" ? MODERATION_MESSAGES.input : MODERATION_MESSAGES.unavailable, attempts: 0, usage: pre.usage };
    const r = (await agent()) as any;
    if (!r.ok) return r;
    const made = kind === "patch" ? r.patch : kind === "element" ? r.options : kind === "layout" ? r.project : kind === "style" ? r.notes : r.page;
    const post = await mod.check(collectText(made), controller.signal);
    const usage = { inputTokens: (r.usage?.inputTokens ?? 0) + pre.usage.inputTokens + post.usage.inputTokens, outputTokens: (r.usage?.outputTokens ?? 0) + pre.usage.outputTokens + post.usage.outputTokens };
    if (post.status !== "clear") return { ok: false, reason: post.status === "flagged" ? "moderated" : "moderation_unavailable", message: post.status === "flagged" ? MODERATION_MESSAGES.output : MODERATION_MESSAGES.unavailable, attempts: r.attempts, usage };
    return { ...r, usage };
  };

  let charged;
  try {
    charged = await runCharged({ store: deps.credits, user: userId, kind: jobKind[kind], credits, key: idem, model: deps.model, run: run as () => Promise<{ ok: boolean; usage?: any; reason?: string; providerKind?: string }>, onSettleError: (e, jobId) => deps.log?.({ event: "settle_failed", jobId, kind }) });
  } catch {
    // Reserve/settle infrastructure failed, or the agent threw. Nothing is charged; say nothing about why.
    deps.log?.({ event: "ai_error", kind });
    return fail(503, "unavailable", "AI is temporarily unavailable. Please try again.");
  }

  if (charged.status === "refused") {
    switch (charged.reason) {
      case "insufficient_credits": return fail(402, "insufficient_credits", "You're out of AI credits.", { available: charged.available ?? 0 });
      case "daily_cap": return fail(429, "daily_cap", "You've reached today's AI limit. It resets tomorrow.");
      case "in_progress": return fail(409, "in_progress", "That request is already running.");
      case "already_done": return fail(409, "already_done", "That request already finished.");
      default: return fail(409, "key_reused", "That request id was already used. Try again.");
    }
  }

  const r = charged.result as any;
  deps.log?.({ event: "ai_job", kind, ok: r.ok, attempts: r.attempts, tokens: r.usage, charged: charged.charged });
  const credit = { charged: charged.charged, cost: charged.charged ? credits : 0, ...(charged.settleFailed ? { settleFailed: true } : {}) };

  if (!r.ok) {
    if (r.reason === "provider") {
      const [status, message] = PROVIDER_STATUS[r.providerKind ?? ""] ?? [503, "The AI service had a problem. Please try again."];
      return json(status, { ok: false, code: "provider", message, credits: credit });
    }
    if (r.reason === "moderation_unavailable") return json(503, { ok: false, code: "moderation_unavailable", message: r.message, credits: credit });
    if (r.reason === "invalid_request") return json(400, { ok: false, code: "invalid_request", message: r.message, credits: credit });
    return json(422, { ok: false, code: r.reason ?? "failed", message: r.message ?? "The AI could not do that.", credits: credit });
  }

  switch (kind) {
    case "patch": return json(200, { ok: true, patch: r.patch, summary: r.summary, touched: r.touched, attempts: r.attempts, credits: credit });
    case "element": return json(200, { ok: true, options: r.options, dropped: r.dropped, attempts: r.attempts, credits: credit });
    case "layout": return json(200, { ok: true, project: r.project, attempts: r.attempts, credits: credit });
    case "style": return json(200, { ok: true, theme: r.theme, notes: r.notes, attempts: r.attempts, credits: credit });
    default: return json(200, { ok: true, page: r.page, attempts: r.attempts, credits: credit });
  }
}

/** Sliding-window limiter: at most `max` requests per `windowMs` per key. In memory (per server instance). */
export function createRateLimiter(o: { max: number; windowMs: number; now?: () => number }) {
  const now = o.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return (id: string): boolean => {
    const t = now();
    const recent = (hits.get(id) ?? []).filter((x) => t - x < o.windowMs);
    if (recent.length >= o.max) { hits.set(id, recent); return false; }
    recent.push(t);
    hits.set(id, recent);
    return true;
  };
}

export const NDJSON = "application/x-ndjson";

/**
 * Same as handleAiRequest, but answers as a stream of newline-delimited JSON so the browser can show live progress:
 *   {"type":"progress","stage":"asking"|"checking"|"fixing","attempt":1,"of":3}  (zero or more)
 *   {"type":"result","status":200,"body":{...}}                                   (always last, exactly once)
 * Every check, charge and safe-error mapping is the one in handleAiRequest; this only changes how the answer is delivered.
 * Progress carries stage names and counters only, never model output or user content.
 */
export function handleAiStream(kind: AiKind, req: Request, deps: AiDeps): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (o: unknown) => { if (!closed) { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { closed = true; } } };
      try {
        const res = await handleAiRequest(kind, req, deps, { onProgress: (p) => send({ type: "progress", ...p }) });
        let body: unknown;
        try { body = await res.json(); } catch { body = { ok: false, code: "failed", message: "That didn't work. Please try again." }; }
        send({ type: "result", status: res.status, body });
      } catch {
        send({ type: "result", status: 503, body: { ok: false, code: "unavailable", message: "AI is temporarily unavailable. Please try again." } });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* already closed (client left) */ }
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": NDJSON, "cache-control": "no-store", "x-accel-buffering": "no" } });
}
