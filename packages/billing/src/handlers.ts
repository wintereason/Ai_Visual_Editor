// SERVER ONLY. Framework-free request handlers for buying credit packs.
//
//   GET  /api/billing          balance and the pack list (prices come from the server's list)
//   POST /api/billing/order    {packId}                              -> creates the order for the SERVER's price, records it
//   POST /api/billing/verify   {orderId, paymentId, signature}       -> checks Razorpay's signature, grants credits (instant feedback)
//   POST /api/billing/webhook  Razorpay -> us (signed)               -> the source of truth: grants credits even if the browser closed
//
// Both "verify" and "webhook" end in the same idempotent store.apply(), so credits are granted exactly once however many of them,
// in whatever order, report the same payment. Amounts that don't match what we recorded grant nothing.

import { formatRupees, type Pack } from "./packs";
import { createOrder, parseCaptured, verifyPaymentSignature, verifyWebhookSignature, type RazorpayConfig } from "./razorpay";
import { PaymentsError, type PaymentsStore } from "./store";

export type BillingDeps = {
  /** Verified user id from the sign-in credential, or null. */
  authenticate: (req: Request) => Promise<string | null>;
  allow?: (userId: string) => boolean;
  packs: Pack[];
  /** Null when Razorpay isn't configured: purchases are then refused. */
  razorpay: RazorpayConfig | null;
  store: PaymentsStore;
  credits: { available(user: string): Promise<number> };
  newId: () => string;
  log?: (event: Record<string, unknown>) => void;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const fail = (status: number, code: string, message: string, headers: Record<string, string> = {}) => json(status, { ok: false, code, message }, headers);

const ORDER_ID = /^order_[A-Za-z0-9]{6,60}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,60}$/;
const MAX_JSON_BYTES = 2_000;
const MAX_WEBHOOK_BYTES = 1_000_000;

const publicPacks = (packs: Pack[]) => packs.map((p) => ({ id: p.id, label: p.label, credits: p.credits, amountPaise: p.amountPaise, price: formatRupees(p.amountPaise) }));

async function signedIn(req: Request, deps: BillingDeps): Promise<{ user: string } | { res: Response }> {
  const user = await deps.authenticate(req).catch(() => null);
  if (!user) return { res: fail(401, "unauthorized", "Sign in to continue.") };
  if (deps.allow && !deps.allow(user)) return { res: fail(429, "rate_limited", "You're going a little fast. Please wait a moment.", { "retry-after": "30" }) };
  return { user };
}

async function readJson(req: Request): Promise<{ ok: true; value: any } | { ok: false; res: Response }> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { ok: false, res: fail(415, "unsupported_media_type", "Send JSON.") };
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BYTES) return { ok: false, res: fail(413, "too_large", "That request is too large.") };
    return { ok: true, value: JSON.parse(text) };
  } catch { return { ok: false, res: fail(400, "bad_request", "The request wasn't valid.") }; }
}

export async function handleBalance(req: Request, deps: BillingDeps): Promise<Response> {
  if (req.method !== "GET") return fail(405, "method_not_allowed", "Use GET.", { allow: "GET" });
  const a = await signedIn(req, deps);
  if ("res" in a) return a.res;
  try {
    return json(200, { ok: true, balance: await deps.credits.available(a.user), enabled: !!deps.razorpay, packs: publicPacks(deps.packs) });
  } catch {
    return fail(503, "unavailable", "Your balance is temporarily unavailable. Please try again.");
  }
}

export async function handleOrder(req: Request, deps: BillingDeps): Promise<Response> {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Use POST.", { allow: "POST" });
  if (!deps.razorpay) return fail(503, "not_configured", "Buying credits isn't open yet.");
  const a = await signedIn(req, deps);
  if ("res" in a) return a.res;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const pack = typeof body.value?.packId === "string" ? deps.packs.find((p) => p.id === body.value.packId) : undefined;
  if (!pack) return fail(400, "unknown_pack", "That credit pack doesn't exist.");

  // The amount and the credits come from OUR list for this pack id: nothing the browser sent can change them.
  const made = await createOrder(deps.razorpay, { amountPaise: pack.amountPaise, receipt: `avc_${deps.newId()}`, notes: { pack: pack.id } });
  if (!made.ok) { deps.log?.({ event: "order_failed", code: made.code }); return fail(made.code === "rate_limited" ? 429 : 503, made.code, made.message); }
  try {
    await deps.store.create({ orderId: made.id, userId: a.user, packId: pack.id, credits: pack.credits, amountPaise: pack.amountPaise, currency: "INR" });
  } catch {
    deps.log?.({ event: "order_record_failed" }); // the unused Razorpay order is harmless: it can never be paid into our books
    return fail(503, "unavailable", "Couldn't start the payment. Please try again.");
  }
  deps.log?.({ event: "order_created", pack: pack.id });
  // keyId is Razorpay's PUBLIC key id (it is meant for the browser); the secret never leaves the server.
  return json(200, { ok: true, orderId: made.id, amountPaise: pack.amountPaise, currency: "INR", keyId: deps.razorpay.keyId, label: pack.label, credits: pack.credits });
}

export async function handleVerify(req: Request, deps: BillingDeps): Promise<Response> {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Use POST.", { allow: "POST" });
  if (!deps.razorpay) return fail(503, "not_configured", "Buying credits isn't open yet.");
  const a = await signedIn(req, deps);
  if ("res" in a) return a.res;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const { orderId, paymentId, signature } = body.value ?? {};
  if (typeof orderId !== "string" || !ORDER_ID.test(orderId) || typeof paymentId !== "string" || !PAYMENT_ID.test(paymentId) || typeof signature !== "string" || signature.length > 200)
    return fail(400, "bad_request", "The payment details weren't valid.");

  try {
    const row = await deps.store.get(orderId);
    // someone else's order looks exactly like a missing one
    if (!row || row.userId !== a.user) return fail(404, "unknown_order", "We couldn't find that payment.");
    if (!(await verifyPaymentSignature(deps.razorpay.keySecret, row.orderId, paymentId, signature))) {
      deps.log?.({ event: "verify_bad_signature" });
      return fail(400, "bad_signature", "We couldn't verify that payment. If you were charged, your credits will still arrive shortly.");
    }
    // Razorpay's signature binds this payment to this order, and an order has one fixed price: use our recorded amount.
    const result = await deps.store.apply(row.orderId, paymentId, row.amountPaise, row.currency);
    deps.log?.({ event: "verify", result });
    if (result === "granted" || result === "already") return json(200, { ok: true, status: result, balance: await deps.credits.available(a.user) });
    return fail(409, "not_applied", "We couldn't add the credits yet. If you were charged, they will arrive shortly.");
  } catch (e) {
    deps.log?.({ event: "verify_error", store: e instanceof PaymentsError });
    return fail(503, "unavailable", "We couldn't confirm the payment yet. If you were charged, your credits will arrive shortly.");
  }
}

/** Razorpay calls this. Always acknowledges (200) valid, signed events so Razorpay doesn't retry forever; refuses unsigned ones. */
export async function handleWebhook(req: Request, deps: BillingDeps): Promise<Response> {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Use POST.", { allow: "POST" });
  const secret = deps.razorpay?.webhookSecret;
  if (!secret) return fail(503, "not_configured", "Webhooks aren't set up.");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return fail(413, "too_large", "Too large.");
  let raw: string;
  try { raw = await req.text(); } catch { return fail(400, "bad_request", "Unreadable."); }
  if (raw.length > MAX_WEBHOOK_BYTES) return fail(413, "too_large", "Too large.");

  // The signature covers the RAW bytes exactly as received: verify before parsing anything.
  if (!(await verifyWebhookSignature(secret, raw, req.headers.get("x-razorpay-signature") ?? ""))) {
    deps.log?.({ event: "webhook_bad_signature" });
    return fail(400, "bad_signature", "Invalid signature.");
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json(200, { ok: true, ignored: "not_json" }); }
  const cap = parseCaptured(body);
  if (!cap) return json(200, { ok: true, ignored: "not_a_captured_payment" });

  try {
    const result = await deps.store.apply(cap.orderId, cap.paymentId, cap.amount, cap.currency);
    // "mismatch" and "unknown" are worth a human's attention; they are logged without any ids or amounts that could identify a person
    deps.log?.({ event: "webhook", result });
    return json(200, { ok: true, result });
  } catch {
    deps.log?.({ event: "webhook_error" });
    return fail(503, "unavailable", "Try again."); // not 200: Razorpay retries, and apply is idempotent
  }
}
