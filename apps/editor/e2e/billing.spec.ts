import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// The browser, the REAL /api/billing routes and the REAL billing code, against a fake Razorpay order API and a stub of Razorpay's
// checkout window (which signs payments the way Razorpay does). Only Razorpay itself is fake.

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const FAKE = "http://127.0.0.1:3196";
const KEY_SECRET = "e2e_key_secret_0123456789";
const WEBHOOK_SECRET = "e2e_webhook_secret_abcdef";
const hmac = (secret: string, msg: string) => createHmac("sha256", secret).update(msg).digest("hex");
const debug = async (page: Page | { request: APIRequestContext }) => ((await (await page.request.get(`${FAKE}/debug`)).json()) as { orders: { id: string; amount: number; notes: any }[] }).orders;

type Mode = "pay" | "forged" | "dismiss" | "fail";
/** Replaces Razorpay's checkout script with a stub that behaves as the test says. */
async function stubCheckout(page: Page, mode: Mode) {
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `(function(){
      var enc = new TextEncoder();
      async function sign(secret, msg){ var k = await crypto.subtle.importKey("raw", enc.encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]); var s = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg))); return Array.from(s, function(b){return b.toString(16).padStart(2,"0")}).join(""); }
      window.__checkoutOpts = [];
      window.Razorpay = function(o){ this.o = o; this.cbs = {}; window.__checkoutOpts.push({ key: o.key, amount: o.amount, currency: o.currency, order_id: o.order_id }); };
      window.Razorpay.prototype.on = function(ev, cb){ this.cbs[ev] = cb; };
      window.Razorpay.prototype.open = async function(){
        var o = this.o, mode = ${JSON.stringify(mode)};
        if (mode === "dismiss") return o.modal.ondismiss();
        if (mode === "fail") return this.cbs["payment.failed"] && this.cbs["payment.failed"]({});
        var pay = "pay_E2E" + Math.random().toString(36).slice(2, 12);
        var secret = mode === "forged" ? "attacker_secret_value_123456" : ${JSON.stringify(KEY_SECRET)};
        o.handler({ razorpay_payment_id: pay, razorpay_order_id: o.order_id, razorpay_signature: await sign(secret, o.order_id + "|" + pay) });
      };
    })();`,
  }));
}

let n = 0;
async function signIn(page: Page) {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(`bill${Date.now()}${++n}@example.com`);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
}
const openCredits = async (page: Page) => { await page.getByRole("button", { name: "✦ Credits" }).click(); await expect(page.getByTestId("credit-balance")).not.toHaveText("…"); };
const balance = async (page: Page) => Number(await page.getByTestId("credit-balance").textContent());

test("signed out: no credits button", async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await expect(page.getByRole("button", { name: "✦ Credits" })).toHaveCount(0);
});

test("the dialog shows the balance, the server's packs in rupees, and where the policies are", async ({ page }) => {
  await signIn(page);
  await openCredits(page);
  expect(await balance(page)).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId("pack-starter")).toContainText("₹99");
  await expect(page.getByTestId("pack-starter")).toContainText("50 credits");
  await expect(page.getByTestId("pack-standard")).toContainText("₹299");
  await expect(page.getByTestId("pack-pro")).toContainText("₹799");
  for (const doc of ["Terms", "Privacy Policy", "Refund Policy"]) await expect(page.getByRole("dialog", { name: "Credits" }).getByRole("link", { name: doc })).toHaveAttribute("target", "_blank");
});

test("buying a pack: the order uses the server's price, the signed payment adds the credits once, and the balance persists", async ({ page }) => {
  await stubCheckout(page, "pay");
  await signIn(page);
  await openCredits(page);
  const before = await balance(page);
  await page.getByRole("button", { name: "Buy Starter" }).click();
  await expect(page.getByTestId("credit-note")).toContainText("✔ 50 credits added");
  expect(await balance(page)).toBe(before + 50);
  // what Razorpay was asked for: the pack's price, in paise, set by the server
  const orders = await debug(page);
  expect(orders.at(-1)).toMatchObject({ amount: 9900, notes: { pack: "starter" } });
  // and what the checkout window was opened with: that same order, with the PUBLIC key id only
  const opened = await page.evaluate(() => (window as any).__checkoutOpts.at(-1));
  expect(opened).toMatchObject({ key: "rzp_test_e2e12345", amount: 9900, currency: "INR", order_id: orders.at(-1)!.id });
  expect(JSON.stringify(opened)).not.toContain("secret");
  // close and reopen: the balance is real, not just on screen
  await page.getByRole("button", { name: "Close" }).click();
  await openCredits(page);
  expect(await balance(page)).toBe(before + 50);
});

test("a forged payment signature adds nothing and says so", async ({ page }) => {
  await stubCheckout(page, "forged");
  await signIn(page);
  await openCredits(page);
  const before = await balance(page);
  await page.getByRole("button", { name: "Buy Standard" }).click();
  await expect(page.getByTestId("credit-note")).toContainText("couldn't verify");
  await page.getByRole("button", { name: "Close" }).click();
  await openCredits(page);
  expect(await balance(page)).toBe(before);
});

test("closing the payment window, or a failed payment, is explained and changes nothing", async ({ page }) => {
  await signIn(page);
  await stubCheckout(page, "dismiss");
  await openCredits(page);
  const before = await balance(page);
  await page.getByRole("button", { name: "Buy Pro" }).click();
  await expect(page.getByTestId("credit-note")).toContainText("window was closed");
  await expect(page.getByTestId("credit-note")).toContainText("arrive automatically");
  expect(await balance(page)).toBe(before);
  await page.unroute("https://checkout.razorpay.com/v1/checkout.js");
  await page.evaluate(() => { delete (window as any).Razorpay; });
  await stubCheckout(page, "fail");
  await page.getByRole("button", { name: "Buy Pro" }).click();
  await expect(page.getByTestId("credit-note")).toContainText("didn't go through");
  expect(await balance(page)).toBe(before);
});

test("if Razorpay's checkout can't be loaded, the person is told and nothing is charged", async ({ page }) => {
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) => route.abort());
  await signIn(page);
  await openCredits(page);
  await page.getByRole("button", { name: "Buy Starter" }).click();
  await expect(page.getByTestId("credit-error")).toContainText("Couldn't open the payment window");
});

test.describe("the webhook (Razorpay tells us, even if the browser was closed)", () => {
  const TOKEN = (u: string) => ({ authorization: `Bearer mock.${u}` });
  async function order(request: APIRequestContext, user: string, pack = "starter", extra: object = {}) {
    const r = await request.post("/api/billing/order", { data: { packId: pack, ...extra }, headers: TOKEN(user) });
    expect(r.status()).toBe(200);
    return (await r.json()) as { orderId: string; amountPaise: number };
  }
  const bal = async (request: APIRequestContext, user: string) => ((await (await request.get("/api/billing", { headers: TOKEN(user) })).json()) as { balance: number }).balance;
  const captured = (orderId: string, over: object = {}) => ({ event: "payment.captured", payload: { payment: { entity: { id: "pay_WH" + orderId.slice(-8), order_id: orderId, amount: 9900, currency: "INR", status: "captured", ...over } } } });
  const send = (request: APIRequestContext, payload: unknown, sig?: string, tamper = false) => {
    const raw = JSON.stringify(payload);
    return request.post("/api/billing/webhook", { data: tamper ? raw.replace("9900", "100") : raw, headers: { "content-type": "application/json", "x-razorpay-signature": sig ?? hmac(WEBHOOK_SECRET, raw) } });
  };

  test("a signed capture adds the credits once, however often it is delivered", async ({ request }) => {
    const u = `wh${Date.now()}a`;
    const before = await bal(request, u);
    const o = await order(request, u);
    expect(await (await send(request, captured(o.orderId))).json()).toMatchObject({ ok: true, result: "granted" });
    expect(await (await send(request, captured(o.orderId))).json()).toMatchObject({ result: "already" });
    expect(await bal(request, u)).toBe(before + 50);
  });
  test("forged, unsigned and tampered webhooks are refused", async ({ request }) => {
    const u = `wh${Date.now()}b`;
    const before = await bal(request, u);
    const o = await order(request, u);
    expect((await send(request, captured(o.orderId), "0".repeat(64))).status()).toBe(400);
    expect((await send(request, captured(o.orderId), hmac(KEY_SECRET, JSON.stringify(captured(o.orderId))))).status()).toBe(400); // the API secret isn't the webhook secret
    expect((await send(request, captured(o.orderId), undefined, true)).status()).toBe(400); // amount edited after signing
    expect(await bal(request, u)).toBe(before);
  });
  test("a payment of the wrong amount is acknowledged but grants nothing", async ({ request }) => {
    const u = `wh${Date.now()}c`;
    const before = await bal(request, u);
    const o = await order(request, u);
    expect(await (await send(request, captured(o.orderId, { amount: 100 }))).json()).toMatchObject({ result: "mismatch" });
    expect(await bal(request, u)).toBe(before);
  });
  test("the browser cannot choose the price or the credits", async ({ request }) => {
    const u = `wh${Date.now()}d`;
    const o = await order(request, u, "starter", { amountPaise: 1, credits: 99999, price: "₹0" });
    expect(o.amountPaise).toBe(9900);
    expect((await debug({ request })).find((x) => x.id === o.orderId)?.amount).toBe(9900);
  });
  test("someone else's order can't be claimed through the browser report", async ({ request }) => {
    const o = await order(request, `wh${Date.now()}e`);
    const pay = "pay_Steal00001";
    const r = await request.post("/api/billing/verify", { data: { orderId: o.orderId, paymentId: pay, signature: hmac(KEY_SECRET, `${o.orderId}|${pay}`) }, headers: TOKEN(`wh${Date.now()}other`) });
    expect(r.status()).toBe(404);
  });
});

test("the real routes refuse strangers and wrong methods, and reveal nothing", async ({ request }) => {
  for (const path of ["/api/billing", "/api/billing/order", "/api/billing/verify"]) {
    const r = path === "/api/billing" ? await request.get(path) : await request.post(path, { data: {}, headers: { "content-type": "application/json" } });
    expect(r.status()).toBe(401);
    expect(await r.text()).not.toMatch(/secret|rzp_|e2e_/i);
  }
  expect((await request.get("/api/billing/order")).status()).toBe(405);
  expect((await request.post("/api/billing/webhook", { data: "{}", headers: { "content-type": "application/json" } })).status()).toBe(400); // no signature
});

for (const [path, title] of [["/terms", "Terms of Service"], ["/privacy", "Privacy Policy"], ["/refunds", "Refund and Cancellation Policy"]] as const) {
  test(`${path}: the platform's legal page shows a DRAFT banner while blanks remain, and highlights them`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByTestId("draft-banner")).toContainText("DRAFT");
    expect(await page.locator("mark").count()).toBeGreaterThan(0);
    await expect(page.locator("body")).toContainText(path === "/refunds" ? "credit" : "Razorpay"); // each page describes the platform, not a school website
  });
}
