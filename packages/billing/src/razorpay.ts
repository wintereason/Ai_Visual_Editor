// SERVER ONLY. A small Razorpay client: create an order, verify the signatures Razorpay produces, and read a "payment captured"
// webhook. Built from Razorpay's published documentation and tested against fakes, NOT against the live service (see docs/billing.md).
// Secrets are used and dropped: never logged, never placed in an error message.

export const RAZORPAY_API = "https://api.razorpay.com/v1";

export type RazorpayConfig = {
  keyId: string;
  keySecret: string;
  /** A DIFFERENT secret, set on the webhook in the Razorpay dashboard. */
  webhookSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two hex strings without stopping at the first difference. Anything that isn't a same-length hex string is a mismatch. */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0 || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.toLowerCase().charCodeAt(i) ^ b.toLowerCase().charCodeAt(i);
  return diff === 0;
}

/** The signature Razorpay Checkout returns: HMAC-SHA256 (hex) of "<order_id>|<payment_id>" with the API key secret. */
export async function paymentSignature(keySecret: string, orderId: string, paymentId: string): Promise<string> {
  return hmacHex(keySecret, `${orderId}|${paymentId}`);
}
export async function verifyPaymentSignature(keySecret: string, orderId: string, paymentId: string, signature: string): Promise<boolean> {
  if (!keySecret) return false;
  return safeEqualHex(await paymentSignature(keySecret, orderId, paymentId), String(signature ?? ""));
}

/** Webhooks: HMAC-SHA256 (hex) of the RAW request body with the webhook secret, in the X-Razorpay-Signature header. */
export async function webhookSignature(webhookSecret: string, rawBody: string): Promise<string> {
  return hmacHex(webhookSecret, rawBody);
}
export async function verifyWebhookSignature(webhookSecret: string, rawBody: string, signature: string): Promise<boolean> {
  if (!webhookSecret) return false;
  return safeEqualHex(await webhookSignature(webhookSecret, rawBody), String(signature ?? ""));
}

export type OrderResult = { ok: true; id: string; amount: number; currency: "INR" } | { ok: false; code: string; message: string };

/** Creates an order for a server-chosen amount. The browser never influences the amount. */
export async function createOrder(cfg: RazorpayConfig, input: { amountPaise: number; receipt: string; notes?: Record<string, string> }): Promise<OrderResult> {
  const f = cfg.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${(cfg.baseUrl ?? RAZORPAY_API).replace(/\/+$/, "")}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${btoa(`${cfg.keyId}:${cfg.keySecret}`)}` },
      body: JSON.stringify({ amount: input.amountPaise, currency: "INR", receipt: input.receipt.slice(0, 40), notes: input.notes ?? {} }),
    });
  } catch {
    return { ok: false, code: "network", message: "Couldn't reach the payment service. Please try again." };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, code: "config", message: "Payments aren't available right now." }; // our credentials problem: say nothing specific
  if (res.status === 429) return { ok: false, code: "rate_limited", message: "The payment service is busy. Try again in a moment." };
  if (!res.ok) return { ok: false, code: res.status >= 500 ? "unavailable" : "rejected", message: "Couldn't start the payment. Please try again." };
  let body: any;
  try { body = await res.json(); } catch { return { ok: false, code: "invalid_response", message: "Couldn't start the payment. Please try again." }; }
  // Never trust the response blindly: it must be the order we asked for.
  if (typeof body?.id !== "string" || !/^order_[A-Za-z0-9]{6,60}$/.test(body.id) || body.amount !== input.amountPaise || body.currency !== "INR")
    return { ok: false, code: "invalid_response", message: "Couldn't start the payment. Please try again." };
  return { ok: true, id: body.id, amount: body.amount, currency: "INR" };
}

export type Captured = { orderId: string; paymentId: string; amount: number; currency: string };

/**
 * Reads a payment.captured or order.paid webhook body. Returns null for anything else (other events, malformed bodies, payments
 * that aren't captured), so a caller can safely ignore it. Field names follow Razorpay's payload documentation.
 */
export function parseCaptured(body: unknown): Captured | null {
  const b = body as any;
  if (b?.event !== "payment.captured" && b?.event !== "order.paid") return null;
  const p = b?.payload?.payment?.entity;
  if (!p || p.status !== "captured") return null;
  if (typeof p.id !== "string" || typeof p.order_id !== "string" || typeof p.currency !== "string" || !Number.isInteger(p.amount)) return null;
  return { orderId: p.order_id, paymentId: p.id, amount: p.amount, currency: p.currency };
}
