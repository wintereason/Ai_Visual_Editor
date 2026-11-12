import { expect, test, type Page } from "@playwright/test";
import { exampleProject, type Asset, type Project } from "@avc/schema";
import { buildSite, sha256Hex, publicAssetPath } from "@avc/publisher";

// These tests serve a REAL build to a real browser, with the real `_headers` applied as HTTP headers,
// so the Content-Security-Policy is actually enforced rather than just checked as text.

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const SITE = "https://published.test";

async function project(): Promise<{ p: Project; library: { asset: Asset; bytes: Uint8Array }[] }> {
  const p = structuredClone(exampleProject);
  const asset: Asset = { id: "asset_pic", name: "pic", kind: "png", mime: "image/png", bytes: PNG.length, width: 1, height: 1, hash: await sha256Hex(PNG), createdAt: 1 };
  p.pages[0]!.nodes[1]!.children!.push({ id: "im", kind: "element", type: "image", props: { assetId: "asset_pic", alt: "A pixel", fit: "cover" } });
  // push the feature grid below the fold and animate it on scroll
  p.pages[0]!.nodes.splice(2, 0, { id: "sec_gap", kind: "container", type: "section", props: {}, children: [{ id: "gap", kind: "element", type: "spacer", props: {}, styles: { base: { normal: { minHeight: { value: 3000, unit: "px" } } } } }] });
  p.pages[0]!.nodes[3]!.children![0]!.animation = { preset: "slide-up", trigger: "scroll" };
  return { p, library: [{ asset, bytes: PNG }] };
}

/** Serve a build at SITE, applying `_headers` for "/*" as response headers (like Cloudflare Pages would). */
async function serve(page: Page, files: Record<string, Uint8Array>) {
  const headersText = Buffer.from(files["_headers"]!).toString();
  const globalBlock = headersText.split(/\n\n/)[0]!.split("\n").slice(1);
  const headers: Record<string, string> = {};
  for (const line of globalBlock) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const violations: string[] = [];
  await page.route(`${SITE}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const key = path === "/" ? "index.html" : path.replace(/^\//, "").replace(/\/$/, "");
    const file = files[key] ?? files[`${key}/index.html`];
    const ext = key.split(".").pop();
    const type = ext === "png" ? "image/png" : ext === "txt" ? "text/plain" : ext === "xml" ? "application/xml" : "text/html; charset=utf-8";
    if (!file) return route.fulfill({ status: 404, headers, contentType: "text/html", body: Buffer.from(files["404.html"]!) });
    return route.fulfill({ status: 200, headers, contentType: type, body: Buffer.from(file) });
  });
  await page.exposeFunction("__reportViolation", (v: string) => violations.push(v));
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => (window as any).__reportViolation(`${e.violatedDirective}|${e.blockedURI}`)));
  return { violations, headers };
}

test("a published site works under its own CSP: images load, scroll-reveal runs, no violations", async ({ page }) => {
  const { p, library } = await project();
  const r = await buildSite(p, library, { baseUrl: SITE });
  if (!r.ok) throw new Error(r.errors.join());
  const { violations, headers } = await serve(page, r.files);
  expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");

  await page.goto(`${SITE}/`);
  await expect(page.locator("h1")).toContainText("Learn skills");
  await expect(page.locator("html")).toHaveClass(/avc-js/); // the hashed inline script was allowed to run

  const img = page.locator("img[alt='A pixel']");
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(1); // /assets/<hash>.png loaded from 'self'

  const target = page.locator('[data-node="feat1"]');
  expect(await target.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
  await target.scrollIntoViewIfNeeded();
  await expect(target).toHaveClass(/avc-in/);
  await expect.poll(() => target.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");

  expect(violations).toEqual([]);
});

test("the CSP actually blocks injected scripts, event handlers and foreign frames", async ({ page }) => {
  const { p, library } = await project();
  const r = await buildSite(p, library);
  if (!r.ok) throw new Error(r.errors.join());
  const { violations } = await serve(page, r.files);
  await page.goto(`${SITE}/`);
  await expect(page.locator("h1")).toBeVisible();

  const result = await page.evaluate(async () => {
    (window as any).__pwned = 0;
    // 1. an injected inline <script> (what an XSS payload would try)
    const s = document.createElement("script");
    s.textContent = "window.__pwned = 1";
    document.body.appendChild(s);
    // 2. an inline event handler
    const b = document.createElement("div");
    b.innerHTML = "<img src=x onerror=\"window.__pwned = 2\">";
    document.body.appendChild(b);
    // 3. a javascript: URL navigation attempt via a link click
    const a = document.createElement("a");
    a.href = "javascript:window.__pwned = 3";
    document.body.appendChild(a);
    a.click();
    // 4. a framed foreign site
    const f = document.createElement("iframe");
    f.src = "https://evil.example.com/";
    document.body.appendChild(f);
    await new Promise((res) => setTimeout(res, 400));
    return (window as any).__pwned;
  });
  expect(result).toBe(0);
  expect(violations.some((v) => v.startsWith("script-src"))).toBe(true);
  expect(violations.some((v) => v.startsWith("frame-src"))).toBe(true);
});

test("a build with a tampered image is refused, and nothing is produced", async () => {
  const { p, library } = await project();
  const tampered = PNG.slice();
  tampered[tampered.length - 2] = (tampered[tampered.length - 2] ?? 0) ^ 0x55;
  const r = await buildSite(p, [{ asset: library[0]!.asset, bytes: tampered }]);
  expect(r.ok).toBe(false);
  expect("files" in r).toBe(false);
});

test("the published page can't be framed by another site (frame-ancestors / X-Frame-Options)", async ({ page }) => {
  const { p, library } = await project();
  const r = await buildSite(p, library);
  if (!r.ok) throw new Error(r.errors.join());
  const { headers } = await serve(page, r.files);
  expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  expect(headers["X-Frame-Options"]).toBe("DENY");
  expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  expect(publicAssetPath(library[0]!.asset)).toMatch(/^assets\/[0-9a-f]{12}\.png$/);
});

test("unknown URLs serve the 404 page with a 404 status", async ({ page }) => {
  const { p, library } = await project();
  const r = await buildSite(p, library);
  if (!r.ok) throw new Error(r.errors.join());
  await serve(page, r.files);
  const res = await page.goto(`${SITE}/nope`);
  expect(res!.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("Page not found");
});

test("image adjustments and masks still apply under the published CSP", async ({ page }) => {
  const { p, library } = await project();
  const im = p.pages[0]!.nodes[1]!.children!.find((n) => n.id === "im")!;
  im.props.adjust = { brightness: 120, blur: 2 };
  im.props.mask = "circle";
  const r = await buildSite(p, library);
  if (!r.ok) throw new Error(r.errors.join());
  const { violations } = await serve(page, r.files);
  await page.goto(`${SITE}/`);
  const el = page.locator("img[alt='A pixel']");
  await expect.poll(() => el.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(1);
  const s = await el.evaluate((e) => ({ filter: getComputedStyle(e).filter, radius: getComputedStyle(e).borderTopLeftRadius }));
  expect(s.filter).toContain("brightness(1.2)");
  expect(s.filter).toContain("blur(2px)");
  expect(s.radius).not.toBe("0px");
  expect(violations).toEqual([]); // inline style attributes are permitted; nothing was blocked
});
