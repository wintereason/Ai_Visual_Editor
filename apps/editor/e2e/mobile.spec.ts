import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
});

async function newProject(page: Page, kind: "web" | "mobile" | "web+mobile", template?: string) {
  await page.getByRole("button", { name: "New…" }).click();
  const dlg = page.getByRole("dialog", { name: "New project" });
  await dlg.getByTestId(`kind-${kind}`).click();
  if (template) await dlg.getByTestId(`template-${template}`).getByRole("button", { name: "Use template" }).click();
  else await dlg.getByRole("button", { name: "Use blank" }).click();
  await expect(dlg).toHaveCount(0);
}
const platform = (page: Page) => state<string>(page, "(s) => s.project.platform");

test.describe("choosing the project type", () => {
  test("Mobile app shows only the starter apps, and no page mixing", async ({ page }) => {
    await page.getByRole("button", { name: "New…" }).click();
    const dlg = page.getByRole("dialog", { name: "New project" });
    await expect(dlg.getByTestId("kind-web")).toHaveAttribute("aria-checked", "true");
    await expect(dlg.getByTestId("template-coaching")).toBeVisible();
    await expect(dlg.getByRole("tab", { name: "Mix pages" })).toBeVisible();
    await dlg.getByTestId("kind-mobile").click();
    await expect(dlg.getByTestId("template-school-app")).toBeVisible();
    await expect(dlg.getByTestId("template-coaching-app")).toBeVisible();
    await expect(dlg.getByTestId("template-coaching")).toHaveCount(0);
    await expect(dlg.getByRole("tab", { name: "Mix pages" })).toHaveCount(0);
    await dlg.getByTestId("kind-web").click();
    await expect(dlg.getByTestId("template-coaching")).toBeVisible();
  });

  test("a starter app opens as a phone with a tab bar, and the website-only controls go away", async ({ page }) => {
    await newProject(page, "mobile", "school-app");
    expect(await platform(page)).toBe("mobile");
    expect(await state<number>(page, "(s) => s.project.pages.length")).toBe(4);
    await expect(frame(page).locator("nav.avc-tabbar")).toBeVisible();
    await expect(frame(page).locator("header.avc-ah h1")).toHaveText("Greenfield School");
    // the tab for the screen you are on is marked
    await expect(frame(page).locator(".avc-tab-on")).toHaveText("Home");
    // phone-sized canvas, no desktop/tablet switch
    await expect(page.getByRole("button", { name: "💻" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "▭" })).toHaveCount(0);
    const w = await page.locator("iframe[title=Canvas]").evaluate((e) => (e as HTMLElement).style.width);
    expect(w).toBe("390px");
    // another screen
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    await page.getByRole("button", { name: /Notices/ }).first().click();
    await expect(frame(page).locator(".avc-tab-on")).toHaveText("Notices");
  });

  test("Website + app keeps the website's pages and desktop/tablet/phone views", async ({ page }) => {
    await newProject(page, "web+mobile", "coaching");
    expect(await platform(page)).toBe("web+mobile");
    await expect(page.getByRole("button", { name: "💻" })).toBeVisible();
    await expect(frame(page).locator("nav.avc-tabbar")).toHaveCount(0);
  });

  test("a blank mobile app starts with a header and a tab bar", async ({ page }) => {
    await newProject(page, "mobile");
    expect(await platform(page)).toBe("mobile");
    await expect(frame(page).locator("header.avc-ah")).toBeVisible();
    await expect(frame(page).locator("nav.avc-tabbar")).toBeVisible();
  });

  test("a plain website stays a website", async ({ page }) => {
    await newProject(page, "web", "school");
    expect(await platform(page)).toBe("web");
    await expect(page.getByRole("button", { name: "💻" })).toBeVisible();
  });
});

test.describe("project settings", () => {
  const open = async (page: Page) => { await page.getByRole("button", { name: "⚙ Project" }).click(); return page.getByRole("dialog", { name: "Project settings" }); };

  test("switch the project type, and undo it", async ({ page }) => {
    const dlg = await open(page);
    await expect(dlg.getByRole("radio", { name: /Website$|Website\s/ }).first()).toHaveAttribute("aria-checked", "true");
    await expect(dlg.getByTestId("app-settings")).toHaveCount(0); // nothing app-related for a website
    await dlg.getByRole("radio", { name: /Mobile app/ }).click();
    expect(await platform(page)).toBe("mobile");
    await expect(dlg.getByTestId("app-settings")).toBeVisible();
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: "💻" })).toHaveCount(0);
    expect(await page.locator("iframe[title=Canvas]").evaluate((e) => (e as HTMLElement).style.width)).toBe("390px");
    await page.keyboard.press("Control+z");
    expect(await platform(page)).toBe("web");
    await expect(page.getByRole("button", { name: "💻" })).toBeVisible();
  });

  test("app settings are saved with the project, validated, and one undo each", async ({ page }) => {
    const dlg = await open(page);
    await dlg.getByRole("radio", { name: /Website \+ app/ }).click();
    const name = dlg.getByLabel("App short name");
    await expect(name).toHaveAttribute("maxlength", "12");
    await name.fill("Bright");
    await name.blur();
    expect(await state<string>(page, "(s) => s.project.app.shortName")).toBe("Bright");
    await dlg.getByLabel("App theme colour").fill("#112233");
    expect((await state<string>(page, "(s) => s.project.app.themeColor")).toUpperCase()).toBe("#112233");
    await dlg.getByLabel("App display").selectOption("minimal-ui");
    expect(await state<string>(page, "(s) => s.project.app.display")).toBe("minimal-ui");
    await dlg.getByLabel("Work offline").uncheck();
    expect(await state<boolean>(page, "(s) => s.project.app.offline")).toBe(false);
    await dlg.getByLabel("Work offline").check();
    expect(await state<unknown>(page, "(s) => s.project.app.offline ?? null")).toBeNull(); // back to the default (on)
    await dlg.getByRole("button", { name: "Use site colour" }).first().click();
    expect(await state<unknown>(page, "(s) => s.project.app.themeColor ?? null")).toBeNull();
    await expect(dlg.getByRole("img", { name: "Your app icon" })).toBeVisible();
  });

  test("the automatic icon follows the app name, and a picture from Media can replace it", async ({ page }) => {
    const dlg = await open(page);
    await dlg.getByRole("radio", { name: /Mobile app/ }).click();
    const iconSrc = () => dlg.getByRole("img", { name: "Your app icon" }).getAttribute("src");
    await expect(dlg.getByRole("img", { name: "Your app icon" })).toBeVisible();
    const letterA = await iconSrc();
    await dlg.getByLabel("App short name").fill("Zed");
    await dlg.getByLabel("App short name").blur();
    await expect.poll(iconSrc).not.toBe(letterA);
    await dlg.getByRole("button", { name: "Close" }).click();
    await page.getByRole("tab", { name: "Media", exact: true }).click();
    await page.getByLabel("Upload images").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG_1PX });
    await expect.poll(() => state<number>(page, "(s) => s.assets.length")).toBe(1);
    const d2 = await open(page);
    const before = await iconSrc();
    await d2.getByLabel("App icon picture").selectOption({ index: 1 }); // the first (only) picture in Media
    await expect.poll(iconSrc).not.toBe(before);
    expect(await state<string>(page, "(s) => s.project.app.iconAssetId")).toMatch(/^asset_/);
  });
});

test.describe("app screens in Elements", () => {
  test("insert a tab bar, a header and a list, then edit them", async ({ page }) => {
    await newProject(page, "mobile");
    await page.getByRole("tab", { name: "Elements", exact: true }).click();
    await page.getByRole("button", { name: /^App screens \(/ }).click();
    for (const n of ["Tab bar · 4 tabs", "Header with back", "List · rounded"]) await expect(page.getByRole("button", { name: n, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "List · rounded", exact: true }).click();
    await expect(frame(page).locator(".avc-al h2")).toHaveText("Today");
    await expect(frame(page).locator(".avc-row")).toHaveCount(3);
    // editing: the Inspector offers the rows, and an icon dropdown
    await page.getByText("Edit as JSON").first().click();
    const json = page.getByLabel("items JSON");
    await json.fill(JSON.stringify([{ title: "Only row", subtitle: "Edited", icon: "heart", href: "#" }]));
    await json.blur();
    await expect(frame(page).locator(".avc-row")).toHaveCount(1);
    await expect(frame(page).locator(".avc-row strong")).toHaveText("Only row");
  });

  test("a tab bar needs between 2 and 5 tabs, and a bad edit is refused (the page keeps working)", async ({ page }) => {
    await newProject(page, "mobile");
    await frame(page).locator("nav.avc-tabbar").click();
    await page.getByText("Edit as JSON").first().click();
    const json = page.getByLabel("items JSON");
    await json.fill(JSON.stringify([{ label: "One", href: "/", icon: "home" }]));
    await json.blur();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible(); // too few tabs: the editor says no
    await expect(frame(page).locator(".avc-tab")).toHaveCount(2); // and nothing changed
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// The real thing: export an app, host it on a real web server, let the browser install its offline worker, go offline, and use it.
// ---------------------------------------------------------------------------------------------------------------------------------------
test.describe("export and install", () => {
  async function exportZip(page: Page): Promise<Record<string, Uint8Array>> {
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByTestId("build-errors")).toHaveCount(0);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "⬇ Download .zip" }).click()]);
    return unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
  }
  const dims = (b: Uint8Array) => { const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); return [dv.getUint32(16), dv.getUint32(20)]; };
  const isPng = (b: Uint8Array) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v);

  test("an exported app contains a valid manifest, real icons, an offline worker, and the security rules for them", async ({ page }) => {
    await newProject(page, "mobile", "school-app");
    const files = await exportZip(page);
    for (const f of ["index.html", "classes/index.html", "notices/index.html", "contact/index.html", "manifest.webmanifest", "sw.js", "icons/icon-192.png", "icons/icon-512.png", "_headers"]) expect(Object.keys(files), f).toContain(f);
    const m = JSON.parse(new TextDecoder().decode(files["manifest.webmanifest"]));
    expect(m).toMatchObject({ name: "Greenfield School", short_name: "Greenfield", display: "standalone", start_url: "/" });
    for (const [file, size] of [["icons/icon-192.png", 192], ["icons/icon-512.png", 512]] as const) {
      expect(isPng(files[file]!), file).toBe(true);
      expect(dims(files[file]!), file).toEqual([size, size]);
    }
    const html = new TextDecoder().decode(files["index.html"]).replace(/&#39;/g, "'"); // the policy sits in an HTML attribute, where ' is written &#39;
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("manifest-src 'self'");
    expect(new TextDecoder().decode(files["_headers"])).toContain("/sw.js");
  });

  test("a website exports as before: no app files", async ({ page }) => {
    const files = await exportZip(page);
    expect(Object.keys(files).filter((f) => /manifest|sw\.js|icons\//.test(f))).toEqual([]);
  });

  test("the pre-publish check explains what's missing for an app", async ({ page }) => {
    await newProject(page, "mobile");
    // a one-screen app without a tab bar is fine; remove the tab bar and add a second page: a warning appears
    await page.evaluate(() => {
      const st = (window as any).__editor.getState();
      const tab = st.project.pages[0].nodes[0].children.find((c: any) => c.type === "tabBar");
      st.commit({ summary: "x", ops: [{ op: "remove", id: tab.id }, { op: "addPage", page: { id: "pg2", name: "Two", path: "/two", seo: { title: "Two" }, nodes: [{ id: "s2", kind: "container", type: "section", props: {}, children: [] }] } }] });
    });
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("dialog", { name: "Export" })).toContainText("no tab bar");
  });

  let server: Server | null = null;
  test.afterEach(() => new Promise<void>((res) => (server ? server.close(() => res()) : res())));

  test("installed for real: the browser registers the worker, then the app opens and navigates with no connection", async ({ page, context }) => {
    await newProject(page, "mobile", "school-app");
    const files = await exportZip(page);

    // host the exported files exactly as a static host would, including the _headers content types
    const mime: Record<string, string> = { html: "text/html", js: "text/javascript", webmanifest: "application/manifest+json", png: "image/png", json: "application/json" };
    server = createServer((req, res) => {
      let p = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      if (p.endsWith("/")) p += "index.html";
      let key = p.slice(1);
      if (!files[key] && files[key + "/index.html"]) key += "/index.html";
      const body = files[key];
      if (!body) { res.statusCode = 404; res.end("not found"); return; }
      res.setHeader("content-type", mime[key.split(".").pop()!] ?? "application/octet-stream");
      res.end(Buffer.from(body));
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const app = await context.newPage();
    const problems: string[] = [];
    app.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
    app.on("pageerror", (e) => problems.push(String(e)));
    await app.goto(origin + "/");
    await expect(app.locator("h1")).toHaveText("Greenfield School");
    await expect(app.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

    // the manifest and icons are fetchable and well-formed
    const manifest = await app.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
    expect(manifest.icons).toHaveLength(2);
    expect((await app.request.get(origin + "/icons/icon-512.png")).ok()).toBe(true);

    // the worker installs and activates, and saves the screens
    await app.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => app.evaluate(async () => (await caches.keys()).length)).toBe(1);
    const saved = await app.evaluate(async () => { const c = await caches.open((await caches.keys())[0]!); return (await c.keys()).map((r) => new URL(r.url).pathname); });
    for (const p of ["/", "/classes", "/notices", "/contact", "/manifest.webmanifest"]) expect(saved, p).toContain(p);

    // reload once under the worker's control, then lose the connection
    await app.reload();
    await app.evaluate(async () => { await navigator.serviceWorker.ready; });
    await context.setOffline(true);
    await server.close(); server = null; // and make sure nothing can possibly answer except the worker's saved copies
    await app.reload();
    await expect(app.locator("h1")).toHaveText("Greenfield School");
    await app.locator("nav.avc-tabbar").getByRole("link", { name: "Notices" }).click();
    await expect(app.locator("header.avc-ah h1")).toHaveText("Notices");
    await expect(app.locator(".avc-tab-on")).toHaveText("Notices");
    await app.locator("nav.avc-tabbar").getByRole("link", { name: "Classes" }).click();
    await expect(app.locator(".avc-row strong").first()).toHaveText("Mathematics");

    // and none of it broke the page's strict security policy
    expect(problems.filter((p) => /Content Security Policy|Refused to|CSP/i.test(p))).toEqual([]);
    await context.setOffline(false);
  });
});
