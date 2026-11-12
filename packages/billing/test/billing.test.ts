import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createOrder, DEFAULT_PACKS, formatRupees, handleBalance, handleOrder, handleVerify, handleWebhook, MemoryPaymentsStore, parseCaptured, parsePacks,
  paymentSignature, safeEqualHex, verifyPaymentSignature, verifyWebhookSignature, webhookSignature, PaymentsError,
  type BillingDeps, type RazorpayConfig,
} from "../src";

const KEY_ID = "rzp_test_ABCDEFGH";
const KEY_SECRET = "test_key_secret_0123456789";
const WH_SECRET = "test_webhook_secret_abcdef";
const node = (secret: string, msg: string) => createHmac("sha256", secret).update(msg).digest("hex");

describe("packs", () => {
  it("defaults are valid and sorted by size", () => {
    expect(parsePacks(undefined)).toEqual({ ok: true, packs: DEFAULT_PACKS });
    expect(parsePacks("  ")).toEqual({ ok: true, packs: DEFAULT_PACKS });
    expect(DEFAULT_PACKS.every((p) => p.amountPaise >= 100 && Number.isInteger(p.amountPaise) && p.credits >= 1)).toBe(true);
  });
  it("accepts a custom list, strictly", () => {
    const ok = parsePacks(JSON.stringify([{ id: "a", label: "A", credits: 10, amountPaise: 5000 }]));
    expect(ok).toMatchObject({ ok: true });
    for (const bad of ["not json", "[]", "{}", JSON.stringify([{ id: "A!", label: "x", credits: 1, amountPaise: 500 }]), JSON.stringify([{ id: "a", label: "x", credits: 0, amountPaise: 500 }]),
      JSON.stringify([{ id: "a", label: "x", credits: 1, amountPaise: 50 }]), JSON.stringify([{ id: "a", label: "x", credits: 1, amountPaise: 99.5 }]),
      JSON.stringify([{ id: "a", label: "x", credits: 1, amountPaise: 500, extra: 1 }]), JSON.stringify([{ id: "a", label: "x", credits: 1, amountPaise: 500 }, { id: "a", label: "y", credits: 2, amountPaise: 900 }]),
      JSON.stringify([{ id: "a", label: "x", credits: 1, amountPaise: 500_000_000 }])])
      expect(parsePacks(bad).ok).toBe(false);
  });
  it("formats rupees", () => {
    expect(formatRupees(9900)).toBe("₹99");
    expect(formatRupees(12950)).toBe("₹129.50");
    expect(formatRupees(10000000)).toBe("₹1,00,000");
  });
});

describe("signatures (checked against Node's own HMAC, not just against themselves)", () => {
  it("payment signature is HMAC-SHA256 hex of order|payment with the key secret", async () => {
    expect(await paymentSignature(KEY_SECRET, "order_ABC123456", "pay_XYZ123456")).toBe(node(KEY_SECRET, "order_ABC123456|pay_XYZ123456"));
  });
  it("webhook signature is HMAC-SHA256 hex of the raw body with the webhook secret", async () => {
    const body = '{"event":"payment.captured","note":"unicode ₹ ✓"}';
    expect(await webhookSignature(WH_SECRET, body)).toBe(node(WH_SECRET, body));
  });
  it("verification accepts the right signature and rejects every kind of wrong one", async () => {
    const sig = node(KEY_SECRET, "order_ABC123456|pay_XYZ123456");
    expect(await verifyPaymentSignature(KEY_SECRET, "order_ABC123456", "pay_XYZ123456", sig)).toBe(true);
    expect(await verifyPaymentSignature(KEY_SECRET, "order_ABC123456", "pay_XYZ123456", sig.toUpperCase())).toBe(true); // hex case doesn't matter
    for (const bad of ["", "abc", sig.slice(0, -1), sig + "0", sig.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "z".repeat(64), "0".repeat(64)])
      expect(await verifyPaymentSignature(KEY_SECRET, "order_ABC123456", "pay_XYZ123456", bad)).toBe(false);
    expect(await verifyPaymentSignature(KEY_SECRET, "order_OTHER12345", "pay_XYZ123456", sig)).toBe(false); // another order
    expect(await verifyPaymentSignature("wrong_secret_0123456789", "order_ABC123456", "pay_XYZ123456", sig)).toBe(false);
    expect(await verifyPaymentSignature("", "order_ABC123456", "pay_XYZ123456", sig)).toBe(false); // no secret configured: never valid
    expect(await verifyPaymentSignature(KEY_SECRET, "order_ABC123456", "pay_XYZ123456", undefined as never)).toBe(false);
  });
  it("webhook verification also fails when the body is altered by even one character, or the secret is empty", async () => {
    const body = '{"a":1}';
    const sig = node(WH_SECRET, body);
    expect(await verifyWebhookSignature(WH_SECRET, body, sig)).toBe(true);
    expect(await verifyWebhookSignature(WH_SECRET, '{"a":2}', sig)).toBe(false);
    expect(await verifyWebhookSignature(WH_SECRET, body + " ", sig)).toBe(false);
    expect(await verifyWebhookSignature("", body, node("", body))).toBe(false);
  });
  it("safeEqualHex handles odd input", () => {
    expect(safeEqualHex("abcd", "ABCD")).toBe(true);
    for (const [a, b] of [["", ""], ["ab", "abc"], ["zz", "zz"], ["ab", null as never], [undefined as never, "ab"]] as [string, string][]) expect(safeEqualHex(a, b)).toBe(false);
  });
});

function fakeRazorpay(over: { status?: number; body?: (req: any) => unknown; throwNet?: boolean } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    if (over.throwNet) throw new TypeError("secret network detail");
    const resBody = over.body ? over.body(body) : { id: "order_Fake000001", entity: "order", amount: body.amount, currency: body.currency, status: "created" };
    return new Response(JSON.stringify(resBody), { status: over.status ?? 200 });
  }) as typeof fetch;
  const cfg: RazorpayConfig = { keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WH_SECRET, fetchImpl };
  return { calls, cfg };
}

describe("createOrder", () => {
  it("sends the server's amount with Basic auth, INR, and a receipt of at most 40 characters", async () => {
    const { calls, cfg } = fakeRazorpay();
    const r = await createOrder(cfg, { amountPaise: 9900, receipt: "r".repeat(80), notes: { pack: "starter" } });
    expect(r).toEqual({ ok: true, id: "order_Fake000001", amount: 9900, currency: "INR" });
    expect(calls[0]!.url).toBe("https://api.razorpay.com/v1/orders");
    expect(Buffer.from(calls[0]!.headers.authorization!.replace("Basic ", ""), "base64").toString()).toBe(`${KEY_ID}:${KEY_SECRET}`);
    expect(calls[0]!.body).toMatchObject({ amount: 9900, currency: "INR" });
    expect(calls[0]!.body.receipt).toHaveLength(40);
  });
  it("does not trust a response that isn't the order it asked for", async () => {
    for (const body of [{ id: "order_Fake000001", amount: 100, currency: "INR" }, { id: "order_Fake000001", amount: 9900, currency: "USD" }, { id: "not-an-order", amount: 9900, currency: "INR" }, { amount: 9900, currency: "INR" }, "garbage"]) {
      const { cfg } = fakeRazorpay({ body: () => body });
      expect(await createOrder(cfg, { amountPaise: 9900, receipt: "r" })).toMatchObject({ ok: false, code: "invalid_response" });
    }
  });
  it("maps failures to friendly messages and never repeats secrets or Razorpay's own text", async () => {
    for (const [status, code] of [[401, "config"], [403, "config"], [429, "rate_limited"], [500, "unavailable"], [400, "rejected"]] as const) {
      const { cfg } = fakeRazorpay({ status, body: () => ({ error: { description: `bad key ${KEY_SECRET}` } }) });
      const r = await createOrder(cfg, { amountPaise: 9900, receipt: "r" });
      expect(r).toMatchObject({ ok: false, code });
      expect(JSON.stringify(r)).not.toContain(KEY_SECRET);
      expect(JSON.stringify(r)).not.toContain("bad key");
    }
    const r = await createOrder(fakeRazorpay({ throwNet: true }).cfg, { amountPaise: 9900, receipt: "r" });
    expect(r).toMatchObject({ ok: false, code: "network" });
    expect(JSON.stringify(r)).not.toContain("secret network detail");
  });
});

describe("parseCaptured", () => {
  const event = (over: any = {}, ev = "payment.captured") => ({ event: ev, payload: { payment: { entity: { id: "pay_Abc123456", order_id: "order_Abc123456", amount: 9900, currency: "INR", status: "captured", ...over } } } });
  it("reads payment.captured and order.paid", () => {
    expect(parseCaptured(event())).toEqual({ orderId: "order_Abc123456", paymentId: "pay_Abc123456", amount: 9900, currency: "INR" });
    expect(parseCaptured(event({}, "order.paid"))).not.toBeNull();
  });
  it("ignores everything else", () => {
    for (const bad of [event({ status: "authorized" }), event({ status: "failed" }), event({}, "payment.failed"), event({}, "refund.created"), event({ amount: 99.5 }), event({ amount: "9900" }), event({ id: 5 }), event({ order_id: undefined }), { event: "payment.captured" }, null, "x", 5])
      expect(parseCaptured(bad)).toBeNull();
  });
});

// ---------------- handlers ----------------
function setup(over: { configured?: boolean; storeFails?: boolean; rzp?: Parameters<typeof fakeRazorpay>[0]; allow?: () => boolean } = {}) {
  const ledger = new Map<string, number>();
  const grants: string[] = [];
  const store = new MemoryPaymentsStore((u, c, why) => { ledger.set(u, (ledger.get(u) ?? 0) + c); grants.push(`${u}:${c}:${why}`); });
  if (over.storeFails) store.create = async () => { throw new PaymentsError(); };
  const rz = fakeRazorpay(over.rzp);
  let n = 0;
  const logs: Record<string, unknown>[] = [];
  const deps: BillingDeps = {
    authenticate: async (r) => ({ "Bearer alice": "alice", "Bearer bob": "bob" } as Record<string, string>)[r.headers.get("authorization") ?? ""] ?? null,
    allow: over.allow, packs: DEFAULT_PACKS, razorpay: over.configured === false ? null : rz.cfg, store,
    credits: { available: async (u) => ledger.get(u) ?? 0 }, newId: () => `id${++n}`, log: (e) => logs.push(e),
  };
  return { deps, store, ledger, grants, rz, logs };
}
const jreq = (url: string, body: unknown, auth = "Bearer alice", method = "POST") =>
  new Request("http://x" + url, { method, headers: { "content-type": "application/json", authorization: auth }, body: method === "GET" ? undefined : JSON.stringify(body) });
const j = async (r: Response) => ({ status: r.status, body: (await r.json()) as any });

async function ordered(s: ReturnType<typeof setup>, pack = "starter", user = "Bearer alice") {
  const r = await j(await handleOrder(jreq("/o", { packId: pack }, user), s.deps));
  expect(r.status).toBe(200);
  return r.body as { orderId: string; amountPaise: number; credits: number; keyId: string };
}
const verifyBody = async (orderId: string, paymentId = "pay_Real000001", secret = KEY_SECRET) => ({ orderId, paymentId, signature: await paymentSignature(secret, orderId, paymentId) });
const webhook = async (s: ReturnType<typeof setup>, payload: unknown, over: { secret?: string; tamper?: boolean; sig?: string | null } = {}) => {
  const raw = JSON.stringify(payload);
  const sig = over.sig === null ? undefined : (over.sig ?? (await webhookSignature(over.secret ?? WH_SECRET, raw)));
  return j(await handleWebhook(new Request("http://x/w", { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-razorpay-signature": sig } : {}) }, body: over.tamper ? raw.replace("9900", "1") : raw }), s.deps));
};
const captured = (orderId: string, over: any = {}) => ({ event: "payment.captured", payload: { payment: { entity: { id: "pay_Real000001", order_id: orderId, amount: 9900, currency: "INR", status: "captured", ...over } } } });

describe("POST /api/billing/order", () => {
  it("creates an order for the SERVER's price and records what was bought", async () => {
    const s = setup();
    const o = await ordered(s);
    expect(o).toMatchObject({ amountPaise: 9900, credits: 50, keyId: KEY_ID, orderId: "order_Fake000001" });
    expect(await s.store.get("order_Fake000001")).toMatchObject({ userId: "alice", packId: "starter", credits: 50, amountPaise: 9900, status: "created" });
    expect(JSON.stringify(o)).not.toContain(KEY_SECRET);
  });
  it("ignores any price or credits the browser sends", async () => {
    const s = setup();
    const r = await j(await handleOrder(jreq("/o", { packId: "starter", amountPaise: 1, amount: 1, credits: 99999, price: "₹0" }), s.deps));
    expect(r.status).toBe(200);
    expect(s.rz.calls[0]!.body.amount).toBe(9900);
    expect((await s.store.get(r.body.orderId))!.credits).toBe(50);
  });
  it("unknown packs, bad bodies, no sign-in, no configuration, wrong method, rate limit", async () => {
    const s = setup();
    for (const body of [{ packId: "free" }, { packId: 5 }, {}, { packId: "STARTER" }]) expect((await j(await handleOrder(jreq("/o", body), s.deps))).body.code).toBe("unknown_pack");
    expect((await j(await handleOrder(jreq("/o", { packId: "starter" }, "Bearer nobody"), s.deps))).status).toBe(401);
    expect((await j(await handleOrder(jreq("/o", {}, "Bearer alice", "GET"), s.deps))).status).toBe(405);
    expect((await j(await handleOrder(jreq("/o", { packId: "starter" }), setup({ configured: false }).deps))).status).toBe(503);
    expect((await j(await handleOrder(jreq("/o", { packId: "starter" }), setup({ allow: () => false }).deps))).status).toBe(429);
    const raw = new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer alice" }, body: "not json" });
    expect((await j(await handleOrder(raw, s.deps))).status).toBe(400);
    expect((await j(await handleOrder(new Request("http://x", { method: "POST", headers: { authorization: "Bearer alice", "content-type": "text/plain" }, body: "x" }), s.deps))).status).toBe(415);
    expect(s.rz.calls).toHaveLength(0); // none of those reached Razorpay
  });
  it("if Razorpay refuses, nothing is recorded; if recording fails, the person is told to retry", async () => {
    const down = setup({ rzp: { status: 503 } });
    expect((await j(await handleOrder(jreq("/o", { packId: "starter" }), down.deps))).status).toBe(503);
    expect(down.store.rows.size).toBe(0);
    const norec = setup({ storeFails: true });
    const r = await j(await handleOrder(jreq("/o", { packId: "starter" }), norec.deps));
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("unavailable");
  });
});

describe("POST /api/billing/verify (the browser reports success)", () => {
  it("a correctly signed payment grants the credits once and reports the balance", async () => {
    const s = setup();
    const o = await ordered(s);
    const r = await j(await handleVerify(jreq("/v", await verifyBody(o.orderId)), s.deps));
    expect(r).toMatchObject({ status: 200, body: { ok: true, status: "granted", balance: 50 } });
    const again = await j(await handleVerify(jreq("/v", await verifyBody(o.orderId)), s.deps));
    expect(again.body).toMatchObject({ status: "already", balance: 50 }); // reloading or double-clicking never pays twice
    expect(s.grants).toHaveLength(1);
  });
  it("a forged or wrong signature grants nothing", async () => {
    const s = setup();
    const o = await ordered(s);
    for (const body of [await verifyBody(o.orderId, "pay_Real000001", "attacker_secret_0123456789"), { ...(await verifyBody(o.orderId)), signature: "0".repeat(64) }, { ...(await verifyBody(o.orderId)), signature: "" }]) {
      const r = await j(await handleVerify(jreq("/v", body), s.deps));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("bad_signature");
    }
    // a genuine signature for a DIFFERENT payment id doesn't validate this one
    expect((await j(await handleVerify(jreq("/v", { ...(await verifyBody(o.orderId, "pay_Other000001")), paymentId: "pay_Real000001" }), s.deps))).status).toBe(400);
    expect(s.grants).toHaveLength(0);
  });
  it("someone else's order is indistinguishable from a missing one, and can't be claimed", async () => {
    const s = setup();
    const o = await ordered(s, "starter", "Bearer alice");
    const r = await j(await handleVerify(jreq("/v", await verifyBody(o.orderId), "Bearer bob"), s.deps));
    expect(r).toMatchObject({ status: 404, body: { code: "unknown_order" } });
    expect((await j(await handleVerify(jreq("/v", await verifyBody("order_Nothing00001")), s.deps))).status).toBe(404);
    expect(s.grants).toHaveLength(0);
  });
  it("malformed ids, huge bodies, no sign-in, no configuration", async () => {
    const s = setup();
    const o = await ordered(s);
    for (const body of [{}, { orderId: "x", paymentId: "y", signature: "z" }, { ...(await verifyBody(o.orderId)), paymentId: "pay_'; drop table payments;--" }, { ...(await verifyBody(o.orderId)), signature: "a".repeat(500) }, { ...(await verifyBody(o.orderId)), orderId: 5 }])
      expect((await j(await handleVerify(jreq("/v", body), s.deps))).status).toBe(400);
    expect((await j(await handleVerify(new Request("http://x", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer alice" }, body: "x".repeat(5000) }), s.deps))).status).toBe(413);
    expect((await j(await handleVerify(jreq("/v", await verifyBody(o.orderId), "Bearer nobody"), s.deps))).status).toBe(401);
    expect((await j(await handleVerify(jreq("/v", await verifyBody(o.orderId)), setup({ configured: false }).deps))).status).toBe(503);
    expect(s.grants).toHaveLength(0);
  });
  it("a store outage says the credits will arrive, and a retry then works", async () => {
    const s = setup();
    const o = await ordered(s);
    const orig = s.store.apply.bind(s.store);
    let fail = true;
    s.store.apply = async (...a) => { if (fail) { fail = false; throw new PaymentsError(); } return orig(...a); };
    const r1 = await j(await handleVerify(jreq("/v", await verifyBody(o.orderId)), s.deps));
    expect(r1.status).toBe(503);
    expect(r1.body.message).toContain("will arrive");
    expect((await j(await handleVerify(jreq("/v", await verifyBody(o.orderId)), s.deps))).body.status).toBe("granted");
  });
});

describe("POST /api/billing/webhook (Razorpay reports success)", () => {
  it("a signed payment.captured grants the credits, and a duplicate delivery changes nothing", async () => {
    const s = setup();
    const o = await ordered(s);
    expect((await webhook(s, captured(o.orderId))).body).toMatchObject({ ok: true, result: "granted" });
    expect((await webhook(s, captured(o.orderId))).body).toMatchObject({ result: "already" });
    expect(s.ledger.get("alice")).toBe(50);
  });
  it("rejects an unsigned, wrongly signed or tampered request, and grants nothing", async () => {
    const s = setup();
    const o = await ordered(s);
    expect((await webhook(s, captured(o.orderId), { sig: null })).status).toBe(400);
    expect((await webhook(s, captured(o.orderId), { secret: "someone_elses_secret_value" })).status).toBe(400);
    expect((await webhook(s, captured(o.orderId), { sig: "0".repeat(64) })).status).toBe(400);
    expect((await webhook(s, captured(o.orderId), { tamper: true })).status).toBe(400); // amount edited after signing
    expect((await webhook(s, captured(o.orderId), { sig: node(KEY_SECRET, JSON.stringify(captured(o.orderId))) })).status).toBe(400); // the API key secret is not the webhook secret
    expect(s.grants).toHaveLength(0);
  });
  it("a payment of the wrong amount or currency is acknowledged but grants nothing, and is logged for a human", async () => {
    const s = setup();
    const o = await ordered(s);
    expect((await webhook(s, captured(o.orderId, { amount: 100 }))).body.result).toBe("mismatch");
    expect((await webhook(s, captured(o.orderId, { currency: "USD" }))).body.result).toBe("mismatch");
    expect(s.grants).toHaveLength(0);
    expect(s.logs.filter((l) => l.result === "mismatch")).toHaveLength(2);
    expect((await webhook(s, captured(o.orderId))).body.result).toBe("granted"); // the genuine payment still works
  });
  it("unknown orders and uninteresting events are acknowledged and ignored", async () => {
    const s = setup();
    expect((await webhook(s, captured("order_Unknown00001"))).body.result).toBe("unknown");
    expect((await webhook(s, captured("order_Unknown00001", { status: "authorized" }))).body.ignored).toBe("not_a_captured_payment");
    expect((await webhook(s, { event: "refund.created" })).status).toBe(200);
    const raw = "not json at all";
    const r = await j(await handleWebhook(new Request("http://x/w", { method: "POST", headers: { "x-razorpay-signature": await webhookSignature(WH_SECRET, raw) }, body: raw }), s.deps));
    expect(r).toMatchObject({ status: 200, body: { ignored: "not_json" } });
    expect(s.grants).toHaveLength(0);
  });
  it("is refused when no webhook secret is configured, for GET, and for oversized bodies", async () => {
    const s = setup();
    const noSecret = setup();
    noSecret.deps.razorpay = { ...noSecret.rz.cfg, webhookSecret: undefined };
    expect((await webhook(noSecret, captured("order_x00000001"))).status).toBe(503);
    expect((await j(await handleWebhook(new Request("http://x/w", { method: "GET" }), s.deps))).status).toBe(405);
    expect((await j(await handleWebhook(new Request("http://x/w", { method: "POST", headers: { "content-length": "5000000" }, body: "x" }), s.deps))).status).toBe(413);
  });
  it("a store outage returns 503 so Razorpay retries, and the retry then succeeds", async () => {
    const s = setup();
    const o = await ordered(s);
    const orig = s.store.apply.bind(s.store);
    let fail = true;
    s.store.apply = async (...a) => { if (fail) { fail = false; throw new PaymentsError(); } return orig(...a); };
    expect((await webhook(s, captured(o.orderId))).status).toBe(503);
    expect((await webhook(s, captured(o.orderId))).body.result).toBe("granted");
  });
});

describe("the browser report and the webhook together", () => {
  it("whichever arrives first, and even at the same moment, credits are granted exactly once", async () => {
    for (const order of ["verify-first", "webhook-first", "simultaneous"] as const) {
      const s = setup();
      const o = await ordered(s);
      const v = async () => handleVerify(jreq("/v", await verifyBody(o.orderId)), s.deps);
      const w = () => webhook(s, captured(o.orderId));
      if (order === "verify-first") { await v(); await w(); }
      else if (order === "webhook-first") { await w(); await v(); }
      else await Promise.all([v(), w(), v(), w()]);
      expect(s.ledger.get("alice")).toBe(50);
      expect(s.grants).toHaveLength(1);
    }
  });
  it("the balance endpoint reflects it and lists the server's packs", async () => {
    const s = setup();
    const o = await ordered(s);
    await webhook(s, captured(o.orderId));
    const r = await j(await handleBalance(jreq("/b", null, "Bearer alice", "GET"), s.deps));
    expect(r.body).toMatchObject({ ok: true, balance: 50, enabled: true });
    expect(r.body.packs.map((p: any) => p.id)).toEqual(["starter", "standard", "pro"]);
    expect(r.body.packs[0]).toMatchObject({ price: "₹99" });
    expect(JSON.stringify(r.body)).not.toMatch(/secret|keyId/i);
    expect((await j(await handleBalance(jreq("/b", null, "Bearer bob", "GET"), s.deps))).body.balance).toBe(0); // bob has nothing
    expect((await j(await handleBalance(jreq("/b", null, "Bearer nobody", "GET"), s.deps))).status).toBe(401);
    expect((await j(await handleBalance(jreq("/b", {}, "Bearer alice", "POST"), s.deps))).status).toBe(405);
  });
  it("logs never contain secrets, ids, amounts or signatures", async () => {
    const s = setup();
    const o = await ordered(s);
    await handleVerify(jreq("/v", await verifyBody(o.orderId)), s.deps);
    await webhook(s, captured(o.orderId), { secret: "someone_elses_secret_value" });
    await webhook(s, captured(o.orderId));
    const all = JSON.stringify(s.logs);
    for (const bad of [KEY_SECRET, WH_SECRET, o.orderId, "pay_Real000001", "alice", "9900"]) expect(all).not.toContain(bad);
  });
});
