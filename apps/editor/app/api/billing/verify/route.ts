import { handleVerify } from "@avc/billing";
import { getBillingDeps } from "../../../../lib/ai-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleVerify(req, getBillingDeps());
}
