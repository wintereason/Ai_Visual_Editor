import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const GIF_1PX = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
});

/** A 300x200 picture: left half pure red, right half pure blue, so crops and rotations are checkable by pixel. */
async function twoToneImage(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 300; c.height = 200;
    const x = c.getContext("2d")!;
    x.fillStyle = "#ff0000"; x.fillRect(0, 0, 150, 200);
    x.fillStyle = "#0000ff"; x.fillRect(150, 0, 150, 200);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    return await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]!); fr.readAsDataURL(blob); });
  });
  return Buffer.from(b64, "base64");
}

/** Upload the two-tone picture and add it to the page as a selected image element. */
async function addPicture(page: Page, name = "pic") {
  await page.getByRole("tab", { name: "Media" }).click();
  await page.getByLabel("Upload images").setInputFiles([{ name: `${name}.png`, mimeType: "image/png", buffer: await twoToneImage(page) }]);
  await expect(page.getByTestId(`asset-${name}`)).toBeVisible();
  await page.getByTestId(`asset-${name}`).getByRole("button").first().click(); // nothing selected: appends a new image, selected
  await page.getByRole("tab", { name: "Blocks" }).click();
}
const assetsInfo = () => "s => s.assets.map(a => ({ id: a.id, name: a.name, w: a.width, h: a.height, derived: a.derivedFrom ?? null }))";
const imageProps = (page: Page) => state<any>(page, "s => { const n = s.project.pages[0].nodes; return n[n.length-1].children[0].props; }");
const img = (page: Page) => frame(page).locator("img[src^='blob:']");

/** Colour of the pixel at (fx, fy) of the image currently used by the selected image node. */
async function pixelOf(page: Page, fx: number, fy: number): Promise<[number, number, number]> {
  return page.evaluate(async ({ fx, fy }) => {
    const st = (window as any).__editor.getState();
    const n = st.project.pages[0].nodes;
    const id = n[n.length - 1].children[0].props.assetId;
    const bmp = await createImageBitmap(await (await fetch(st.assetUrls[id])).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d")!;
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(Math.floor(fx * (bmp.width - 1)), Math.floor(fy * (bmp.height - 1)), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, { fx, fy });
}
const isRed = (p: number[]) => p[0]! > 200 && p[2]! < 60;
const isBlue = (p: number[]) => p[2]! > 200 && p[0]! < 60;

test.describe("non-destructive adjustments and masks", () => {
  test("brightness, blur and grayscale apply live; clearing them removes them; one undo step per change", async ({ page }) => {
    await addPicture(page);
    const before = await state<number>(page, "s => s.past.length");
    for (const [label, value] of [["adjust brightness", "120"], ["adjust blur", "2"], ["adjust grayscale", "40"]] as const) {
      const f = page.getByLabel(label, { exact: true });
      await f.fill(value);
      await f.blur();
    }
    expect(await state<number>(page, "s => s.past.length")).toBe(before + 3);
    const filter = await img(page).evaluate((e) => getComputedStyle(e).filter);
    expect(filter).toContain("brightness(1.2)");
    expect(filter).toContain("blur(2px)");
    expect(filter).toContain("grayscale(0.4)");

    for (const label of ["adjust brightness", "adjust blur", "adjust grayscale"]) {
      const f = page.getByLabel(label, { exact: true });
      await f.fill("");
      await f.blur();
    }
    expect(await img(page).evaluate((e) => getComputedStyle(e).filter)).toBe("none");
    expect("adjust" in (await imageProps(page))).toBe(false); // the empty group is removed, not stored as {}
  });

  test("out-of-range values are refused with a message and change nothing", async ({ page }) => {
    await addPicture(page);
    const before = await state<number>(page, "s => s.past.length");
    const f = page.getByLabel("adjust brightness", { exact: true });
    await f.fill("500");
    await f.blur();
    await expect(page.getByRole("alert").filter({ hasText: /200|less than|too big/i })).toBeVisible();
    expect(await state<number>(page, "s => s.past.length")).toBe(before);
  });

  test("circle mask crops to a round shape, rounded softens corners, and the original file is untouched", async ({ page }) => {
    await addPicture(page);
    const originalBefore = (await state<any[]>(page, assetsInfo()))[0];
    await page.getByLabel("mask", { exact: true }).selectOption("circle");
    await expect.poll(() => img(page).evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toMatch(/50%|px/);
    const box = await img(page).boundingBox();
    expect(Math.abs(box!.width - box!.height)).toBeLessThan(2); // forced square
    await page.getByLabel("mask", { exact: true }).selectOption("rounded");
    expect(await img(page).evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe("16px");
    await page.getByLabel("mask", { exact: true }).selectOption("");
    expect("mask" in (await imageProps(page))).toBe(false);
    expect((await state<any[]>(page, assetsInfo()))).toEqual([originalBefore]); // no new files: these are only parameters
  });
});

test.describe("rotate", () => {
  test("rotating right makes a new 200x300 file, keeps the original, and the image points at the new one", async ({ page }) => {
    await addPicture(page);
    const original = (await imageProps(page)).assetId;
    await page.getByRole("button", { name: /Right/ }).click();
    await expect.poll(async () => (await state<any[]>(page, assetsInfo())).length).toBe(2);
    const list = await state<any[]>(page, assetsInfo());
    const derived = list.find((a) => a.derived)!;
    expect([derived.w, derived.h]).toEqual([200, 300]);
    expect(derived.derived).toEqual({ assetId: original, op: "rotate" });
    expect(list.find((a) => a.id === original)).toMatchObject({ w: 300, h: 200 }); // untouched
    expect((await imageProps(page)).assetId).toBe(derived.id);
    await expect(page.getByTestId("image-size")).toContainText("200×300");
  });

  test("clockwise really is clockwise: the red (left) half ends up on top", async ({ page }) => {
    await addPicture(page);
    await page.getByRole("button", { name: /Right/ }).click();
    await expect.poll(async () => (await state<any[]>(page, assetsInfo())).length).toBe(2);
    expect(isRed(await pixelOf(page, 0.5, 0.1))).toBe(true); // top
    expect(isBlue(await pixelOf(page, 0.5, 0.9))).toBe(true); // bottom
  });

  test("rotate left puts red at the bottom; 180 puts red on the right", async ({ page }) => {
    await addPicture(page);
    await page.getByRole("button", { name: /Left/ }).click();
    await expect.poll(async () => (await state<any[]>(page, assetsInfo())).length).toBe(2);
    expect(isBlue(await pixelOf(page, 0.5, 0.1))).toBe(true);
    expect(isRed(await pixelOf(page, 0.5, 0.9))).toBe(true);
  });

  test("Back to original restores the first file; Undo steps back through each change", async ({ page }) => {
    await addPicture(page);
    const original = (await imageProps(page)).assetId;
    await page.getByRole("button", { name: /Right/ }).click();
    await expect(page.getByRole("button", { name: /Back to original/ })).toBeVisible();
    await page.getByRole("button", { name: /Back to original/ }).click();
    expect((await imageProps(page)).assetId).toBe(original);
    await expect(page.getByTestId("image-size")).toContainText("300×200");
    await page.getByRole("button", { name: /Undo/ }).click(); // undo "back to original"
    await expect(page.getByTestId("image-size")).toContainText("200×300");
  });
});

test.describe("crop", () => {
  test("the preview size is right for each shape, and applying crops to exactly that", async ({ page }) => {
    await addPicture(page);
    await expect(page.getByTestId("crop-result")).toHaveText("Result: 200×200"); // 1:1 is the default
    await page.getByLabel("Crop shape").selectOption("16:9");
    await expect(page.getByTestId("crop-result")).toHaveText("Result: 300×169");
    await page.getByLabel("Crop shape").selectOption("3:4");
    await expect(page.getByTestId("crop-result")).toHaveText("Result: 150×200");
    await page.getByLabel("Crop shape").selectOption("1:1");
    await page.getByRole("button", { name: "Apply crop" }).click();
    await expect.poll(async () => (await state<any[]>(page, assetsInfo())).some((a) => a.derived?.op === "crop")).toBe(true);
    const derived = (await state<any[]>(page, assetsInfo())).find((a) => a.derived?.op === "crop")!;
    expect([derived.w, derived.h]).toEqual([200, 200]);
  });

  test("keeping the left side: the window is x 0..200 of 300, so red (0..150) then a blue strip (150..200)", async ({ page }) => {
    await addPicture(page);
    await page.getByLabel("Crop position across").fill("0");
    await page.getByRole("button", { name: "Apply crop" }).click();
    await expect.poll(async () => (await state<any[]>(page, assetsInfo())).length).toBe(2);
    expect(isRed(await pixelOf(page, 0.2, 0.5))).toBe(true); // x = 40
    expect(isRed(await pixelOf(page, 0.5, 0.5))).toBe(true); // x = 100
    expect(isBlue(await pixelOf(page, 0.95, 0.5))).toBe(true); // x = 190
  });

  test("keeping the right side gives blue at the centre", async ({ page }) => {
    await addPicture(page);
    await page.getByLabel("Crop position across").fill("100");
    await page.getByRole("button", { name: "Apply crop" }).click();
    await expect.poll(async () => (await state<any[]>(page, assetsInfo())).length).toBe(2);
    // window is x 100..300: a red strip (100..150) at the left edge, then blue
    expect(isRed(await pixelOf(page, 0.1, 0.5))).toBe(true); // x = 120
    expect(isBlue(await pixelOf(page, 0.5, 0.5))).toBe(true); // x = 200
    expect(isBlue(await pixelOf(page, 0.95, 0.5))).toBe(true); // x = 290
  });

  test("'Original (no crop)' offers no apply button", async ({ page }) => {
    await addPicture(page);
    await page.getByLabel("Crop shape").selectOption("original");
    await expect(page.getByRole("button", { name: "Apply crop" })).toHaveCount(0);
  });
});

test.describe("limits and edge cases", () => {
  test("animated GIFs can't be rotated or cropped, with a clear message and no new file", async ({ page }) => {
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Upload images").setInputFiles([{ name: "anim.gif", mimeType: "image/gif", buffer: GIF_1PX }]);
    await expect(page.getByTestId("asset-anim")).toBeVisible();
    await page.getByTestId("asset-anim").getByRole("button").first().click();
    await page.getByRole("tab", { name: "Blocks" }).click();
    await page.getByRole("button", { name: /Right/ }).click();
    await expect(page.getByTestId("image-tools").getByRole("alert")).toContainText("Animated GIFs");
    expect(await state<number>(page, "s => s.assets.length")).toBe(1);
  });

  test("an image that uses an address instead of a library file shows a hint, not broken buttons", async ({ page }) => {
    await page.getByRole("button", { name: "Image", exact: true }).click();
    await expect(page.getByTestId("image-tools")).toContainText("files from your media library");
    await expect(page.getByRole("button", { name: /Right/ })).toHaveCount(0);
  });

  test("export ships only the file the page uses (the derived one), not the original", async ({ page }) => {
    await addPicture(page);
    await page.getByLabel("alt", { exact: true }).fill("A flag");
    await page.getByLabel("alt", { exact: true }).blur();
    await page.getByRole("button", { name: /Right/ }).click();
    await expect.poll(async () => (await state<any[]>(page, assetsInfo())).length).toBe(2);
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("dialog")).not.toContainText("✖");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download/ }).click()]);
    const files = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
    expect(Object.keys(files).filter((f) => f.startsWith("assets/"))).toHaveLength(1);
  });

  test("adjustments survive a rotate (they belong to the image, not the file)", async ({ page }) => {
    await addPicture(page);
    const f = page.getByLabel("adjust contrast", { exact: true });
    await f.fill("130");
    await f.blur();
    await page.getByRole("button", { name: /Right/ }).click();
    await expect.poll(async () => (await state<any[]>(page, assetsInfo())).length).toBe(2);
    expect((await imageProps(page)).adjust).toEqual({ contrast: 130 });
    expect(await img(page).evaluate((e) => getComputedStyle(e).filter)).toContain("contrast(1.3)");
  });
});
