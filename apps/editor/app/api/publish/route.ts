import { handlePublish } from "@avc/publisher/src/publishRoute";
import { getPublishDeps } from "../../../lib/ai-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handlePublish(req, getPublishDeps());
}

const notAllowed = () => new Response(JSON.stringify({ ok: false, code: "method_not_allowed", message: "Use POST." }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
