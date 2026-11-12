import { AI_KINDS, handleAiRequest, handleAiStream, NDJSON, type AiKind } from "@avc/ai";
import { getAiDeps } from "../../../../lib/ai-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ ok: false, code, message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export async function POST(req: Request, ctx: { params: { kind: string } }) {
  const kind = ctx.params.kind as AiKind;
  if (!AI_KINDS.includes(kind)) return reply(404, "not_found", "Unknown AI action.");
  const deps = getAiDeps();
  // Browsers that ask for a stream get live progress; everything else (and every error before we know the kind) is plain JSON.
  if (req.method === "POST" && (req.headers.get("accept") ?? "").includes(NDJSON)) return handleAiStream(kind, req, deps);
  return handleAiRequest(kind, req, deps);
}

export async function GET() {
  return reply(405, "method_not_allowed", "Use POST.", { allow: "POST" });
}
