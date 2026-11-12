import { handleWebhook } from "@avc/billing";
import { getBillingDeps } from "../../../../lib/ai-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Razorpay calls this with a signed body. The handler verifies the signature over the raw bytes before reading anything.
export async function POST(req: Request) {
  return handleWebhook(req, getBillingDeps());
}
