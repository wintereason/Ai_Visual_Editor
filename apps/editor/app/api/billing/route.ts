import { handleBalance } from "@avc/billing";
import { getBillingDeps } from "../../../lib/ai-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleBalance(req, getBillingDeps());
}
