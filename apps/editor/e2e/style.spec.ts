import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

// The browser prepares a picture, talks to the REAL /api/ai/style route and the real provider code, against the fake model.

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const FAKE = "http://127.0.0.1:3198";

/** A real, decodable PNG: a w x h picture with a horizontal colour gradient. */
function png(w: number, h: number): Buffer {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; rows[o] = (x * 255) / w; rows[o + 1] = 90; rows[o + 2] = 200; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
const upload = (page: Page, name: string, mimeType: string, buffer: Buffer) => page.getByLabel("Choose a picture").setInputFiles({ name, mimeType, buffer });

let n = 0;
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(`style${Date.now()}${++n}@example.com`);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
  await page.getByRole("tab", { name: "✦ Create" }).click();
  await page.getByRole("button", { name: "Style from a picture" }).click();
});

test("signed out: explains and offers no button", async ({ page }) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByTestId("create-signin")).toBeVisible();
  await expect(page.getByRole("button", { name: /Find the style/ })).toBeDisabled();
});

test("pick a picture, get a style, preview it, apply it (undoable), and only the theme changes", async ({ page }) => {
  const before = await state<any>(page, "s => ({ theme: s.project.theme, pages: JSON.stringify(s.project.pages) })");
  await expect(page.getByRole("button", { name: /Find the style/ })).toBeDisabled(); // needs a picture
  await upload(page, "inspiration.png", "image/png", png(300, 200));
  await expect(page.getByTestId("style-preview")).toBeVisible();
  await page.getByRole("button", { name: /Find the style/ }).click();
  const result = page.getByTestId("style-result");
  await expect(result).toContainText("Warm and friendly");
  await expect(page.getByTestId("swatch-primary")).toHaveAttribute("title", "#6d28d9");
  await expect(result).toContainText("Lora / Inter");
  await expect(page.getByTestId("theme-sample")).toBeVisible();
  // nothing has changed yet: it is only a suggestion
  expect(await state<string>(page, "s => s.project.theme.colors.primary")).toBe(before.theme.colors.primary);

  // what reached the model was a real JPEG, shrunk, not the original PNG
  const seen = await (await page.request.get(`${FAKE}/debug/last-style`)).json();
  expect(seen).toMatchObject({ mediaType: "image/jpeg", magic: "ffd8ff" });

  await page.getByRole("button", { name: "Apply to my site" }).click();
  await expect(result).toContainText("Applied");
  const after = await state<any>(page, "s => ({ theme: s.project.theme, pages: JSON.stringify(s.project.pages) })");
  expect(after.theme.colors.primary).toBe("#6d28d9");
  expect(after.theme.fonts).toEqual({ heading: "Lora", body: "Inter" });
  expect(after.theme.radius).toBe("lg");
  expect(after.pages).toBe(before.pages); // content and structure untouched
  await page.evaluate(() => (window as any).__editor.getState().undo());
  expect(await state<string>(page, "s => s.project.theme.colors.primary")).toBe(before.theme.colors.primary);
});

test("a first unusable answer is retried automatically, with live 'fixing' progress", async ({ page }) => {
  await upload(page, "a.png", "image/png", png(64, 64));
  await page.getByLabel("Style note (optional)").fill("BADSTYLE");
  await page.getByRole("button", { name: /Find the style/ }).click();
  await expect(page.getByRole("button", { name: /Fixing a problem and trying again \(try 2 of 3\)/ })).toBeVisible();
  await expect(page.getByTestId("style-result")).toContainText("Warm and friendly");
});

test("a large picture is shrunk before it leaves the browser", async ({ page }) => {
  await upload(page, "big.png", "image/png", png(2400, 1600));
  await expect(page.getByTestId("style-preview")).toBeVisible();
  await page.getByRole("button", { name: /Find the style/ }).click();
  await expect(page.getByTestId("style-result")).toBeVisible();
  const seen = await (await page.request.get(`${FAKE}/debug/last-style`)).json();
  expect(seen.bytes).toBeLessThan(200_000); // a 1024-pixel JPEG, not a 2400-pixel original
});

test("files that aren't usable pictures are refused with a clear message", async ({ page }) => {
  await upload(page, "notes.txt", "text/plain", Buffer.from("hello"));
  await expect(page.getByTestId("create-error")).toContainText("PNG, JPEG, WebP or GIF");
  await upload(page, "svg.svg", "image/svg+xml", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));
  await expect(page.getByTestId("create-error")).toContainText("PNG, JPEG, WebP or GIF"); // SVG can carry scripts: not accepted
  await upload(page, "broken.png", "image/png", Buffer.from("this is not really a png"));
  await expect(page.getByTestId("create-error")).toContainText("couldn't be opened");
  await upload(page, "tiny.png", "image/png", png(4, 4));
  await expect(page.getByTestId("create-error")).toContainText("too small");
  await expect(page.getByRole("button", { name: /Find the style/ })).toBeDisabled();
});

test("the real route refuses a disguised file even if the browser step is bypassed", async ({ request }) => {
  const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(300, 1)]).toString("base64");
  const r = await request.post("/api/ai/style", { data: { image: { mediaType: "image/png", data: exe } }, headers: { "content-type": "application/json", authorization: "Bearer mock.styletest" } });
  expect(r.status()).toBe(400);
  expect(await r.json()).toMatchObject({ code: "invalid_image" });
});
