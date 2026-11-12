import { expect, test, type Page } from "@playwright/test";
import { exampleProject, type Project } from "@avc/schema";
import { renderDocument } from "@avc/renderer";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");

async function dragTo(page: Page, from: string, x: number, y: number) {
  const box = (await page.locator(from).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 3 });
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
}

async function canvasPoint(page: Page, selector: string, fy = 0.5) {
  const ifr = (await page.locator("iframe[title=Canvas]").boundingBox())!;
  await frame(page).locator(selector).first().scrollIntoViewIfNeeded();
  const b = (await frame(page).locator(selector).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height * fy };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toContainText("Learn skills");
});

test("click-to-append and undo/redo", async ({ page }) => {
  await page.getByRole("button", { name: "Heading" }).click();
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toHaveCount(0);
  await page.getByRole("button", { name: /Redo/ }).click();
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
});

test("drag a block from the palette into the page", async ({ page }) => {
  const before = await frame(page).locator("blockquote").count();
  const sections = await frame(page).locator("section").count();
  const p = await canvasPoint(page, "footer", 0.5);
  await dragTo(page, "button:has-text('Testimonial')", p.x, p.y);
  await expect(frame(page).locator("blockquote")).toHaveCount(before + 1);
  await expect(frame(page).locator("section")).toHaveCount(sections); // dropped into an existing section, not wrapped
});

test("drag a heading into a container", async ({ page }) => {
  // add an empty container section target via click, then drag into it
  await page.getByRole("button", { name: "Container", exact: true }).click();
  await expect(frame(page).locator("div[data-node]:empty")).toHaveCount(1);
  const c = await canvasPoint(page, "div[data-node]:empty");
  await page.waitForTimeout(300);
  await dragTo(page, "button:has-text('Text')", c.x, c.y);
  await expect(frame(page).locator("div[data-node]:has(> p)", { hasText: "Write something" })).toHaveCount(1);
});

test("device switch applies mobile media query", async ({ page }) => {
  await page.getByRole("button", { name: "📱" }).click();
  await expect.poll(() => page.locator("iframe[title=Canvas]").evaluate((e) => e.clientWidth)).toBeLessThanOrEqual(390);
});

test("invalid inspector edit shows error and leaves project unchanged", async ({ page }) => {
  await frame(page).locator("h1").click();
  await page.getByText("ctaHref").locator("xpath=following-sibling::input").fill("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "url must be" })).toBeVisible();
});

test("autosave survives a reload", async ({ page }) => {
  await page.getByRole("button", { name: "Heading" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved ✓");
  await page.reload();
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
});

test("corrupt saved data is ignored, not crashed on", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("avc:project:v1", JSON.stringify({ schemaVersion: 2, pages: "nope" })));
  await page.reload();
  await expect(frame(page).locator("h1")).toContainText("Learn skills");
});

test("theme: color change reaches the canvas; low contrast warns", async ({ page }) => {
  await page.getByRole("tab", { name: "Theme" }).click();
  await page.getByLabel("primary").fill("#ffff00");
  await expect(page.getByRole("note")).toContainText("Button text (white) on primary");
  const bg = await frame(page).locator(".avc-btn").first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 0)");
  await page.getByLabel("primary").fill("#1d4ed8");
  await expect(page.getByRole("note")).toHaveCount(0);
});

test("layers: select, hide, and undo", async ({ page }) => {
  await page.getByRole("tab", { name: "Layers" }).click();
  await page.getByTestId("layer-hero1").click();
  await expect(frame(page).locator('[data-node="hero1"]')).toHaveClass(/avc-sel/);
  await page.getByTestId("layer-hero1").getByTitle("Hide").click();
  await expect(frame(page).locator("h1")).toBeHidden();
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(frame(page).locator("h1")).toBeVisible();
});

test("versions: save, change, restore", async ({ page }) => {
  await page.getByRole("tab", { name: "History" }).click();
  await page.getByPlaceholder("Version name").fill("v-one");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByRole("button", { name: "Heading" }).click();
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await page.locator("li", { hasText: "v-one" }).getByRole("button", { name: "Restore" }).click();
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toHaveCount(0);
  await page.getByRole("button", { name: /Undo/ }).click(); // restore is undoable
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
});

test("pages: add, switch, edit independently, delete, undo", async ({ page }) => {
  await page.getByRole("tab", { name: "Pages" }).click();
  await page.getByPlaceholder("New page name").fill("Courses");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("page-/courses")).toBeVisible();
  await expect(frame(page).locator("h1")).toHaveCount(0); // new page is empty
  await page.getByRole("tab", { name: "Blocks" }).click();
  await page.getByRole("button", { name: "Heading" }).click();
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
  await page.getByRole("tab", { name: "Pages" }).click();
  await page.getByTestId("page-/").click();
  await expect(frame(page).locator("h1")).toContainText("Learn skills");
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toHaveCount(0);

  // duplicate path is rejected with a message, state unchanged
  await page.getByTestId("page-/courses").click();
  await page.getByLabel("Page path").fill("/");
  await page.getByLabel("Page path").blur();
  await expect(page.getByTestId("page-/courses")).toBeVisible();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete page" }).click();
  await expect(page.getByTestId("page-/courses")).toHaveCount(0);
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.getByTestId("page-/courses")).toBeVisible();
});

test("pages survive reload", async ({ page }) => {
  await page.getByRole("tab", { name: "Pages" }).click();
  await page.getByPlaceholder("New page name").fill("About");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText("Saved ✓");
  await page.reload();
  await page.getByRole("tab", { name: "Pages" }).click();
  await expect(page.getByTestId("page-/about")).toBeVisible();
});

test("export: lint blocks on missing alt; zip has one file per page", async ({ page }) => {
  await page.getByRole("tab", { name: "Pages" }).click();
  await page.getByPlaceholder("New page name").fill("Courses");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // image with empty alt => error, download disabled
  await page.getByRole("tab", { name: "Blocks" }).click();
  await page.getByRole("button", { name: "Image" }).click();
  await frame(page).locator("img").first().click();
  await page.getByText("alt", { exact: true }).locator("xpath=following-sibling::input").fill("");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog")).toContainText("no alt text");
  await expect(page.getByRole("button", { name: /Download/ })).toBeDisabled();

  // "Go" jumps to the node; fix alt; re-export
  await page.getByRole("dialog").getByRole("button", { name: "Go" }).first().click();
  await page.getByText("alt", { exact: true }).locator("xpath=following-sibling::input").fill("A photo");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog")).not.toContainText("no alt text");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download/ }).click()]);
  const files = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
  expect(Object.keys(files).sort()).toEqual(["404.html", "_headers", "courses/index.html", "index.html", "robots.txt"]); // pages + the publisher's site files
  expect(strFromU8(files["index.html"]!)).toContain("Learn skills that get you hired");
  expect(strFromU8(files["courses/index.html"]!)).toContain('alt="A photo"');
});

test("templates: use Coaching Institute, export is clean, undo restores previous project", async ({ page }) => {
  await page.getByRole("button", { name: "New…" }).click();
  await expect(page.getByTestId("template-coaching")).toBeVisible();
  await page.getByTestId("template-coaching").getByRole("button", { name: "Use template" }).click();
  await expect(frame(page).locator("h1")).toContainText("Learn with mentors");
  await page.getByRole("tab", { name: "Pages" }).click();
  for (const p of ["/", "/courses", "/teachers", "/contact"]) await expect(page.getByTestId(`page-${p}`)).toBeVisible();

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog")).not.toContainText("✖");
  await expect(page.getByRole("button", { name: /Download/ })).toBeEnabled();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(frame(page).locator("h1")).toContainText("Learn skills that get you hired");
});

test("templates: blank project", async ({ page }) => {
  await page.getByRole("button", { name: "New…" }).click();
  await page.getByRole("button", { name: "Use blank" }).click();
  await expect(frame(page).locator("h1")).toHaveCount(0);
  await expect(frame(page).locator("section")).toHaveCount(1);
});

test("templates: visual check (screenshots)", async ({ page }) => {
  const dir = process.env.SHOTS_DIR;
  test.skip(!dir, "set SHOTS_DIR to capture");
  await page.getByRole("button", { name: "New…" }).click();
  await page.getByTestId("template-coaching").getByRole("button", { name: "Use template" }).click();
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.screenshot({ path: `${dir}/editor-desktop.png` });
  await page.getByRole("button", { name: "📱" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/editor-mobile.png` });
});

test("gallery: every template loads, all pages render, export is lint-clean", async ({ page }) => {
  const ids = ["coaching", "school", "college", "online", "preschool"];
  for (const id of ids) {
    await page.getByRole("button", { name: "New…" }).click();
    await page.getByTestId(`template-${id}`).getByRole("button", { name: "Use template" }).click();
    await expect(frame(page).locator("h1").first()).toBeVisible();
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("dialog")).not.toContainText("✖");
    await expect(page.getByRole("button", { name: /Download/ })).toBeEnabled();
    await page.getByRole("button", { name: "Close" }).click();
  }
});

test("gallery screenshots", async ({ page }) => {
  const dir = process.env.SHOTS_DIR;
  test.skip(!dir, "set SHOTS_DIR to capture");
  await page.getByRole("button", { name: "New…" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${dir}/gallery.png` });
});

// ---- media library ----
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const png = (name = "pixel.png", buffer = PNG_1PX) => ({ name, mimeType: "image/png", buffer });
const upload = async (page: Page, ...files: { name: string; mimeType: string; buffer: Buffer }[]) => {
  await page.getByRole("tab", { name: "Media" }).click();
  await page.getByLabel("Upload images").setInputFiles(files);
};
const stateAssets = (page: Page) =>
  page.evaluate(() => (window as any).__editor.getState().assets.map((a: any) => ({ name: a.name, kind: a.kind, width: a.width, height: a.height })));

test("media: upload re-encodes to webp, shows in grid, survives reload", async ({ page }) => {
  await upload(page, png("logo.png"));
  await expect(page.getByTestId("asset-logo")).toBeVisible();
  expect(await stateAssets(page)).toEqual([{ name: "logo", kind: "webp", width: 1, height: 1 }]);
  await page.reload();
  await page.getByRole("tab", { name: "Media" }).click();
  await expect(page.getByTestId("asset-logo")).toBeVisible();
});

test("media: large images are downscaled to 2400px", async ({ page }) => {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 3000; c.height = 1000;
    const x = c.getContext("2d")!; x.fillStyle = "#3366cc"; x.fillRect(0, 0, 3000, 1000);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  });
  await upload(page, png("wide.png", Buffer.from(b64, "base64")));
  await expect(page.getByTestId("asset-wide")).toBeVisible();
  expect(await stateAssets(page)).toEqual([{ name: "wide", kind: "webp", width: 2400, height: 800 }]);
});

test("media: rejects fake images, SVG, empty and oversized files; accepts the good one", async ({ page }) => {
  await upload(
    page,
    { name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") },
    { name: "vector.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>") },
    { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
    { name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(21 * 1024 * 1024, 1) },
    png("ok.png"),
  );
  const errs = page.getByTestId("upload-errors");
  await expect(errs).toContainText("evil.png: not a supported image");
  await expect(errs).toContainText("vector.svg: not a supported image");
  await expect(errs).toContainText("empty.png: the file is empty");
  await expect(errs).toContainText("huge.png: larger than 20 MB");
  await expect(page.getByTestId("asset-ok")).toBeVisible();
  expect((await stateAssets(page)).length).toBe(1);
});

test("media: identical uploads are de-duplicated", async ({ page }) => {
  await upload(page, png("a.png"));
  await expect(page.getByTestId("asset-a")).toBeVisible();
  await page.getByLabel("Upload images").setInputFiles([png("b.png")]);
  await expect.poll(async () => (await stateAssets(page)).length).toBe(1);
  await expect(page.getByTestId("asset-b")).toHaveCount(0);
});

test("media: use in a selected image, a hero, and as a new image", async ({ page }) => {
  await upload(page, png("pic.png"));
  await expect(page.getByTestId("asset-pic")).toBeVisible();

  // new image (nothing selected): alt starts empty so the pre-publish check forces a description
  await page.getByTestId("asset-pic").getByRole("button").first().click();
  await expect(frame(page).locator("img[src^='blob:']")).toHaveCount(1);

  // hero image
  await page.getByRole("tab", { name: "Blocks" }).click();
  await frame(page).locator("h1").click();
  await page.getByRole("tab", { name: "Media" }).click();
  await page.getByTestId("asset-pic").getByRole("button").first().click();
  await expect(frame(page).locator(".avc-hero-img")).toHaveCount(1);
  await expect(frame(page).locator(".avc-hero-img")).toHaveAttribute("src", /^blob:/);

  // replacing a URL image: src is cleared, assetId set
  await page.getByRole("tab", { name: "Blocks" }).click();
  await page.getByRole("button", { name: "Image", exact: true }).click(); // adds placeholder image (src url), selected
  await page.getByRole("tab", { name: "Media" }).click();
  await page.getByTestId("asset-pic").getByRole("button").first().click();
  const props = await page.evaluate(() => {
    const s = (window as any).__editor.getState();
    return s.project.pages[0].nodes.at(-1).children[0].props;
  });
  expect(props.assetId).toMatch(/^asset_/);
  expect(props.src).toBeUndefined();
});

test("media: export ships used assets; deleting a used asset blocks export", async ({ page }) => {
  await upload(page, png("pic.png"));
  await page.getByTestId("asset-pic").getByLabel("Alt text for pic").fill("A red pixel");
  await page.getByTestId("asset-pic").getByLabel("Alt text for pic").blur();
  await page.getByTestId("asset-pic").getByRole("button").first().click();
  await expect(frame(page).locator("img[alt='A red pixel']")).toHaveCount(1);

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog")).not.toContainText("✖");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download/ }).click()]);
  const files = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
  const assetFiles = Object.keys(files).filter((f) => f.startsWith("assets/"));
  expect(assetFiles.length).toBe(1);
  expect(assetFiles[0]).toMatch(/^assets\/[0-9a-f]{12}\.webp$/);
  expect(files[assetFiles[0]!]!.length).toBeGreaterThan(10);
  const html = strFromU8(files["index.html"]!);
  expect(html).toContain(`src="/${assetFiles[0]}"`);
  expect(html).not.toContain("blob:");
  await page.getByRole("button", { name: "Close" }).click();

  // delete the asset while it's used -> confirm, then export is blocked with a clear message
  await page.getByRole("tab", { name: "Media" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("asset-pic").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("asset-pic")).toHaveCount(0);
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("dialog")).toContainText("no longer in your media library");
  await expect(page.getByRole("button", { name: /Download/ })).toBeDisabled();
});

test("media screenshot", async ({ page }) => {
  const dir = process.env.SHOTS_DIR;
  test.skip(!dir, "set SHOTS_DIR to capture");
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 600; c.height = 400;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 600, 400); g.addColorStop(0, "#1d4ed8"); g.addColorStop(1, "#f59e0b");
    x.fillStyle = g; x.fillRect(0, 0, 600, 400);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]!); r.readAsDataURL(blob); });
  });
  await page.getByRole("button", { name: "New…" }).click();
  await page.getByTestId("template-school").getByRole("button", { name: "Use template" }).click();
  await upload(page, png("campus.png", Buffer.from(b64, "base64")));
  await expect(page.getByTestId("asset-campus")).toBeVisible();
  await frame(page).locator("h1").click();
  await page.getByTestId("asset-campus").getByRole("button").first().click();
  await expect(frame(page).locator(".avc-hero-img")).toHaveCount(1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/media.png` });
});

// ---- animations ----
const heroAnim = (page: Page) =>
  page.evaluate(() => (window as any).__editor.getState().project.pages[0].nodes[1].children[0].animation ?? null);

test("animate panel: choose, trigger, timing, play, undo, remove", async ({ page }) => {
  await frame(page).locator("h1").click(); // selects the hero block
  await page.getByRole("tab", { name: "Animate" }).click();
  await page.getByTestId("anim-slide-up").click();
  expect(await heroAnim(page)).toEqual({ preset: "slide-up", trigger: "scroll", durationMs: 600, delayMs: 0 });
  await expect(frame(page).locator('[data-node="hero1"]')).toHaveAttribute("data-anim", "slide-up");
  await expect(frame(page).locator('[data-node="hero1"]')).toHaveAttribute("data-trigger", "scroll");

  await page.getByRole("button", { name: "On load" }).click();
  await expect(frame(page).locator('[data-node="hero1"]')).toHaveAttribute("data-trigger", "load");

  await page.getByLabel("Duration").fill("99999");
  await page.getByLabel("Duration").blur();
  expect((await heroAnim(page)).durationMs).toBe(3000); // clamped to the schema limit, never rejected
  await page.getByLabel("Delay").fill("250");
  await page.keyboard.press("Enter");
  expect((await heroAnim(page)).delayMs).toBe(250);

  // Play adds the preview class, then removes it
  await page.getByRole("button", { name: /Play/ }).click();
  await expect(frame(page).locator('[data-node="hero1"]')).toHaveClass(/avc-play/);
  await expect(frame(page).locator('[data-node="hero1"]')).not.toHaveClass(/avc-play/, { timeout: 12_000 });

  await page.getByRole("button", { name: /Undo/ }).click();
  expect((await heroAnim(page)).delayMs).toBe(0);
  await page.getByRole("button", { name: "Remove" }).click();
  expect(await heroAnim(page)).toBeNull();
});

test("animate panel: hover presets have no trigger choice; non-animatable nodes say so", async ({ page }) => {
  await frame(page).locator("h1").click();
  await page.getByRole("tab", { name: "Animate" }).click();
  await page.getByTestId("anim-hover-lift").click();
  await expect(page.getByText("Plays on hover")).toBeVisible();
  await expect(page.getByRole("button", { name: /Play/ })).toBeDisabled();
  // a navbar can't be animated
  await frame(page).locator("nav").first().click();
  await expect(page.getByText("navbar can't be animated")).toBeVisible();
});

test("animate panel: theme motion off warns and strips animation from the export", async ({ page }) => {
  await frame(page).locator("h1").click();
  await page.getByRole("tab", { name: "Animate" }).click();
  await page.getByTestId("anim-fade-in").click();
  await page.getByRole("tab", { name: "Theme" }).click();
  await page.getByRole("button", { name: "off", exact: true }).click();
  await page.getByRole("tab", { name: "Animate" }).click();
  await expect(page.getByRole("note")).toContainText('motion is set to "off"');
  await page.getByRole("button", { name: "Export" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download/ }).click()]);
  const html = strFromU8(unzipSync(new Uint8Array(readFileSync((await dl.path())!)))["index.html"]!);
  expect(html).not.toMatch(/<[a-z0-9]+ [^>]*data-anim=/); // no element carries an animation attribute (CSS selectors may still mention it)
  expect(html).not.toContain("<script>");
});

// ---- published-page behaviour, in a real browser ----
function tallProject(): Project {
  const p = structuredClone(exampleProject);
  const spacer = { id: "sec_gap", kind: "container" as const, type: "section", props: {}, children: [
    { id: "gap", kind: "element" as const, type: "spacer", props: {}, styles: { base: { normal: { minHeight: { value: 3000, unit: "px" as const } } } } },
  ] };
  p.pages[0]!.nodes.splice(2, 0, spacer); // push the feature grid far below the fold
  p.pages[0]!.nodes[3]!.children![0]!.animation = { preset: "slide-up", trigger: "scroll" };
  return p;
}

test("published page: scroll-triggered content is hidden until it scrolls into view, then revealed", async ({ page }) => {
  await page.setContent(renderDocument(tallProject(), "page_home"));
  const target = page.locator('[data-node="feat1"]');
  await expect(page.locator("html")).toHaveClass(/avc-js/);
  await expect(target).not.toHaveClass(/avc-in/);
  expect(await target.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
  await target.scrollIntoViewIfNeeded();
  await expect(target).toHaveClass(/avc-in/);
  await expect.poll(() => target.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
});

test("published page: reduced-motion visitors see everything immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(renderDocument(tallProject(), "page_home"));
  await expect(page.locator("html")).not.toHaveClass(/avc-js/);
  expect(await page.locator('[data-node="feat1"]').evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
});

test("published page: content stays visible when JavaScript is disabled", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.setContent(renderDocument(tallProject(), "page_home"));
  expect(await page.locator('[data-node="feat1"]').evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
  await ctx.close();
});
