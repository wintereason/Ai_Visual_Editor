import { getCloud } from "./cloud";

export type PublicPack = { id: string; label: string; credits: number; amountPaise: number; price: string };
export type BillingInfo = { balance: number; enabled: boolean; packs: PublicPack[] };
export type OrderInfo = { orderId: string; amountPaise: number; currency: "INR"; keyId: string; label: string; credits: number };
export type Result<T> = ({ ok: true } & T) | { ok: false; code: string; message: string };

const FALLBACK: Record<number, string> = { 401: "Sign in to continue.", 429: "You're going a little fast. Please wait a moment.", 503: "This isn't available right now. Please try again." };

async function call<T>(path: string, init: RequestInit): Promise<Result<T>> {
  const token = await getCloud()?.accessToken().catch(() => null);
  if (!token) return { ok: false, code: "signin", message: "Sign in to continue." };
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) } });
  } catch { return { ok: false, code: "network", message: "Couldn't reach the server. Check your connection and try again." }; }
  let body: any = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.ok && body?.ok) return body as { ok: true } & T;
  return { ok: false, code: typeof body?.code === "string" ? body.code : "failed", message: typeof body?.message === "string" && body.message.length < 300 ? body.message : (FALLBACK[res.status] ?? "That didn't work. Please try again.") };
}

export const getBilling = () => call<BillingInfo>("/api/billing", { method: "GET" });
export const startOrder = (packId: string) => call<OrderInfo>("/api/billing/order", { method: "POST", body: JSON.stringify({ packId }) });
export const verifyPayment = (p: { orderId: string; paymentId: string; signature: string }) => call<{ status: "granted" | "already"; balance: number }>("/api/billing/verify", { method: "POST", body: JSON.stringify(p) });

type CheckoutResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type CheckoutOptions = { key: string; amount: number; currency: string; name: string; description: string; order_id: string; prefill?: { email?: string }; handler: (r: CheckoutResponse) => void; modal?: { ondismiss?: () => void }; theme?: { color: string } };
type RazorpayCtor = new (o: CheckoutOptions) => { open(): void; on(ev: string, cb: (r: unknown) => void): void };

export const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** Loads Razorpay's checkout script once. Resolves to its constructor, or null if it couldn't be loaded (offline, blocked). */
export function loadCheckout(): Promise<RazorpayCtor | null> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = CHECKOUT_SRC; s.async = true;
    s.onload = () => resolve(w.Razorpay ?? null);
    s.onerror = () => { s.remove(); resolve(null); };
    document.head.appendChild(s);
  });
}

export type CheckoutOutcome = { kind: "paid"; payment: CheckoutResponse } | { kind: "dismissed" } | { kind: "failed" } | { kind: "unavailable" };

/** Opens Razorpay Checkout for an order we created on the server, and reports what the customer did. */
export async function openCheckout(order: OrderInfo, email: string): Promise<CheckoutOutcome> {
  const Razorpay = await loadCheckout();
  if (!Razorpay) return { kind: "unavailable" };
  return new Promise((resolve) => {
    let settled = false;
    const done = (o: CheckoutOutcome) => { if (!settled) { settled = true; resolve(o); } };
    const rzp = new Razorpay({
      key: order.keyId, amount: order.amountPaise, currency: order.currency, name: "AI Visual Creator", description: `${order.label}: ${order.credits} credits`, order_id: order.orderId,
      prefill: email ? { email } : undefined, theme: { color: "#2563eb" },
      handler: (r) => done({ kind: "paid", payment: r }),
      modal: { ondismiss: () => done({ kind: "dismissed" }) },
    });
    rzp.on("payment.failed", () => done({ kind: "failed" }));
    rzp.open();
  });
}
