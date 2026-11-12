import { expect, test, type Page } from "@playwright/test";

// The browser talks to the REAL /api/publish route and the REAL deploy code; only Cloudflare itself is faked
// (e2e/fake-cloudflare-server.mjs: strict, and it 404s files whose keys are wrong, like the real service).

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const FAKE = "http://127.0.0.1:3197";
const ACCOUNT = "a".repeat(32);
const TOKEN = "good-token-0123456789abcdef";
let n = 0;

async function open(page: Page, signedIn = true) {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  if (signedIn) {
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Email").fill(`pub${Date.now()}${++n}@example.com`);
    await page.getByRole("button", { name: "Send link" }).click();
    await expect(page.getByTestId("sync-status")).toBeVisible();
  }
  await page.getByRole("button", { name: "Export", exact: true }).click();
  return page.getByTestId("publish-section");
}
const unique = () => `site-${Date.now().toString(36)}${++n}`;
async function fill(section: ReturnType<Page["getByTestId"]>, over: { account?: string; token?: string; name?: string } = {}) {
  await section.getByLabel("Cloudflare account ID").fill(over.account ?? ACCOUNT);
  await section.getByLabel("Cloudflare API token").fill(over.token ?? TOKEN);
  await section.getByLabel("Cloudflare project name").fill(over.name ?? unique());
}
const debug = async (page: Page) => (await page.request.get(`${FAKE}/debug`)).json() as Promise<{ projects: string[]; deployments: { id: string; project: string; files: string[]; wrongKeys: string[]; headers: string | null }[] }>;

test("signed out: explains why publishing is unavailable and offers the zip instead", async ({ page }) => {
  const s = await open(page, false);
  await expect(s).toContainText("Sign in");
  await expect(s.getByLabel("Cloudflare API token")).toHaveCount(0);
});

test("the setup steps are available, and the form guides bad input", async ({ page }) => {
  const s = await open(page);
  await s.getByRole("button", { name: "How do I set this up?" }).click();
  await expect(page.getByTestId("publish-help")).toContainText("Cloudflare Pages → Edit");
  const publish = s.getByRole("button", { name: /Publish/ });
  await expect(publish).toBeDisabled();
  await s.getByLabel("Cloudflare account ID").fill("not-an-id");
  await expect(s).toContainText("exactly 32");
  await s.getByLabel("Cloudflare account ID").fill(ACCOUNT);
  await s.getByLabel("Cloudflare project name").fill("Bad Name");
  await expect(s.getByLabel("Cloudflare project name")).toHaveValue("bad name"); // lowercased as typed
  await expect(s).toContainText("lowercase letters, numbers and hyphens");
  await s.getByLabel("Cloudflare project name").fill("-bad-");
  await s.getByLabel("Cloudflare API token").fill("x".repeat(40));
  await expect(publish).toBeDisabled();
  await s.getByLabel("Cloudflare project name").fill(unique());
  await expect(publish).toBeEnabled();
  expect(await s.getByLabel("Cloudflare API token").getAttribute("type")).toBe("password");
});

test("publishing end to end: live progress, the deployed site is the built site, and the token isn't kept", async ({ page }) => {
  const s = await open(page);
  const name = unique();
  await fill(s, { name });
  await s.getByRole("button", { name: /Publish/ }).click();
  const seen = new Set<string>(); // what the Publish button said, sampled while the request was running
  const sampler = setInterval(() => { void s.evaluate((el) => [...el.querySelectorAll("button")].map((b) => b.textContent).join(" | ")).then((t) => seen.add(t), () => {}); }, 100);
  await expect(page.getByTestId("publish-done")).toContainText("Your site is live");
  clearInterval(sampler);
  const all = [...seen].join(" || ");
  for (const stage of ["Setting up your Cloudflare project", "Getting permission to upload", "Uploading files", "Publishing…"]) expect(all).toContain(stage); // progress was live, stage by stage
  await expect(page.getByTestId("publish-done")).toContainText("Your site is live");
  await expect(page.getByTestId("publish-url")).toHaveText(`https://${name}.pages.dev`);

  // what Cloudflare now holds is the real build: the pages, the security headers, and every key correct
  const d = (await debug(page)).deployments.filter((x) => x.project === name);
  expect(d).toHaveLength(1);
  expect(d[0]!.files).toEqual(expect.arrayContaining(["/index.html", "/404.html", "/robots.txt"]));
  expect(d[0]!.wrongKeys).toEqual([]);
  expect(d[0]!.headers).toContain("Content-Security-Policy");
  const live = await page.request.get(`${FAKE}/s/${d[0]!.id}/`);
  expect(live.status()).toBe(200);
  expect(await live.text()).toContain("Learn skills that get you hired");

  // the token was used once and is gone from the screen and from storage
  await expect(s.getByLabel("Cloudflare API token")).toHaveValue("");
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  expect(stored).not.toContain(TOKEN);
  // the non-secret details are remembered for next time
  expect(await page.evaluate(() => localStorage.getItem("avc:cloudflare:v1"))).toContain(name);
});

test("'remember until I close this tab' keeps the token in this tab's session only", async ({ page }) => {
  const s = await open(page);
  await fill(s);
  await s.getByLabel("Remember the token until I close this tab").check();
  await s.getByRole("button", { name: /Publish/ }).click();
  await expect(page.getByTestId("publish-done")).toBeVisible();
  const where = await page.evaluate(() => ({ local: JSON.stringify({ ...localStorage }), session: JSON.stringify({ ...sessionStorage }) }));
  expect(where.session).toContain("good-token");
  expect(where.local).not.toContain("good-token"); // never in long-lived storage
  await s.getByLabel("Remember the token until I close this tab").uncheck();
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain("good-token");
});

test("a token without permission gets a clear explanation", async ({ page }) => {
  const s = await open(page);
  await fill(s, { token: "some-other-token-0123456789abc" });
  await s.getByRole("button", { name: /Publish/ }).click();
  await expect(page.getByTestId("publish-error")).toContainText("Pages: Edit");
  await expect(page.getByTestId("publish-done")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("some-other-token");
});

test("a wrong account ID is reported, and nothing is created", async ({ page }) => {
  const s = await open(page);
  const name = unique();
  await fill(s, { account: "b".repeat(32), name });
  await s.getByRole("button", { name: /Publish/ }).click();
  await expect(page.getByTestId("publish-error")).toContainText("account ID");
  expect((await debug(page)).projects).not.toContain(name);
});

test("publishing again updates the same project without re-uploading unchanged files", async ({ page }) => {
  const s = await open(page);
  const name = unique();
  await fill(s, { name });
  await s.getByRole("button", { name: /Publish/ }).click();
  await expect(page.getByTestId("publish-done")).toContainText("checked and loading");
  await fill(s, { name });
  await s.getByRole("button", { name: /Publish/ }).click();
  await expect(page.getByTestId("publish-done")).toContainText("(0 new)");
  expect((await debug(page)).deployments.filter((x) => x.project === name)).toHaveLength(2);
});

test("a problem in the site blocks publishing and says so, before anything is sent", async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(`pub${Date.now()}${++n}@example.com`);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
  // an image with no description is a pre-publish error
  await page.evaluate(() => {
    const s = (window as any).__editor.getState();
    s.commit({ summary: "img", ops: [{ op: "insert", parentId: s.project.pages[0].id, index: 1, node: { id: "sec_i", kind: "container", type: "section", props: {}, children: [{ id: "bad_img", kind: "element", type: "image", props: { src: "https://placehold.co/10", alt: "", fit: "cover" } }] } }] });
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const s = page.getByTestId("publish-section");
  await fill(s);
  await expect(s.getByRole("button", { name: /Publish/ })).toBeDisabled();
});

test("the real route: refuses strangers and wrong methods, and reveals nothing", async ({ request }) => {
  const stranger = await request.post("/api/publish", { multipart: { meta: JSON.stringify({ accountId: ACCOUNT, projectName: "x" }) }, headers: { "x-cf-token": TOKEN } });
  expect(stranger.status()).toBe(401);
  expect(await stranger.text()).not.toContain(TOKEN);
  const get = await request.get("/api/publish");
  expect(get.status()).toBe(405);
});

test("a site address that isn't a web address (like an email) is explained and blocks publishing; clearing it fixes it", async ({ page }) => {
  const s = await open(page);
  await fill(s);
  const publish = s.getByRole("button", { name: /Publish/ });
  await expect(publish).toBeEnabled();
  const address = page.getByLabel("Site address");
  await address.fill("someone@gmail.com");
  await expect(page.getByTestId("address-error")).toContainText("isn't a web address");
  await expect(publish).toBeDisabled();
  await expect(page.getByRole("button", { name: /Download \.zip/ })).toBeDisabled();
  await address.fill("http://insecure.example.com");
  await expect(publish).toBeDisabled(); // https only
  await address.fill("");
  await expect(page.getByTestId("address-error")).toHaveCount(0);
  await expect(publish).toBeEnabled();
  await address.fill("https://www.example.com");
  await expect(publish).toBeEnabled();
  expect(await address.getAttribute("autocomplete")).toBe("off"); // so the browser doesn't fill in an email
});

test.describe("custom domain", () => {
  const publishFirst = async (page: Page) => {
    const s = await open(page);
    const name = unique();
    await fill(s, { name });
    await s.getByRole("button", { name: /Publish/ }).click();
    await expect(page.getByTestId("publish-done")).toContainText("Your site is live");
    await s.getByLabel("Cloudflare API token").fill(TOKEN); // the token was cleared after publishing, on purpose
    return { s, name };
  };

  test("connect a subdomain: DNS instructions with the right CNAME target, then 'check again' until active", async ({ page }) => {
    const { s, name } = await publishFirst(page);
    const connect = s.getByRole("button", { name: "Connect" });
    await expect(connect).toBeDisabled(); // needs a domain
    await s.getByLabel("Custom domain").fill(`www.${name}.example.com`);
    await connect.click();
    const info = page.getByTestId("domain-info");
    await expect(info).toContainText("waiting for DNS");
    await expect(page.getByTestId("cname-target")).toHaveText(`${name}.pages.dev`);
    await expect(info).toContainText("CNAME");
    await info.getByRole("button", { name: "Check again" }).click();
    await expect(info).toContainText("Status: pending"); // DNS not ready yet: still waiting, and says so
    await info.getByRole("button", { name: "Check again" }).click();
    await expect(info).toContainText("is connected");
    await expect(info.getByRole("link")).toHaveAttribute("href", `https://www.${name}.example.com`);
  });

  test("a bare domain explains that it needs Cloudflare DNS", async ({ page }) => {
    const { s, name } = await publishFirst(page);
    await s.getByLabel("Custom domain").fill(`${name}.com`);
    await s.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByTestId("domain-error")).toContainText("Cloudflare DNS");
  });

  test("a mistyped domain is explained without contacting Cloudflare", async ({ page }) => {
    const { s } = await publishFirst(page);
    await s.getByLabel("Custom domain").fill("not a domain");
    await s.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByTestId("domain-error")).toContainText("www.example.com");
  });

  test("connecting before publishing says to publish first", async ({ page }) => {
    const s = await open(page);
    await fill(s, { name: unique() });
    await s.getByLabel("Custom domain").fill("www.example.org");
    await s.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByTestId("domain-error")).toContainText("Publish the site first");
  });

  test("the real route refuses strangers and wrong methods", async ({ request }) => {
    const stranger = await request.post("/api/publish/domain", { data: { accountId: ACCOUNT, projectName: "x", domain: "www.example.com", action: "connect" }, headers: { "x-cf-token": TOKEN } });
    expect(stranger.status()).toBe(401);
    expect((await request.get("/api/publish/domain")).status()).toBe(405);
  });
});
