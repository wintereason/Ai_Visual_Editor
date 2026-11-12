import { handleDeleteAccount } from "@avc/cloud/src/account";
import { getAccountDeps } from "../../../lib/ai-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  return handleDeleteAccount(req, getAccountDeps());
}

const notAllowed = () => new Response(JSON.stringify({ ok: false, code: "method_not_allowed", message: "Use DELETE." }), { status: 405, headers: { "content-type": "application/json", allow: "DELETE" } });
export const GET = notAllowed;
export const POST = notAllowed;
