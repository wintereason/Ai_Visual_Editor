import { expect, test, type Page } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("tab", { name: "Brand", exact: true }).click();
});
const kit = (page: Page) => page.getByTestId("brand-kit");

test("brand name: saved with the project, can be put into the navbars, and undone", async ({ page }) => {
  await kit(page).getByLabel("Brand name").fill("Bright School");
  await kit(page).getByLabel("Brand name").blur();
  expect(await state<string>(page, "(s) => s.project.brand.name")).toBe("Bright School");
  await kit(page).getByRole("button", { name: "Use this name in my navbars" }).click();
  await expect(frame(page).locator("nav.avc-nav strong").first()).toHaveText("Bright School");
  await page.keyboard.press("Control+z");
  await expect(frame(page).locator("nav.avc-nav strong").first()).not.toHaveText("Bright School");
  expect(await state<string>(page, "(s) => s.project.brand.name")).toBe("Bright School"); // only the navbar change was undone
});

test("logo: upload once, then add it to any page with proper alt text", async ({ page }) => {
  await kit(page).getByLabel("Brand name").fill("Bright School");
  await kit(page).getByLabel("Brand name").blur();
  await kit(page).getByLabel("Upload logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(kit(page).getByRole("img", { name: "Your logo" })).toBeVisible();
  const logoId = await state<string>(page, "(s) => s.project.brand.logoAssetId");
  expect(logoId).toBeTruthy();
  const before = await state<number>(page, "(s) => s.project.pages.find(p => p.id === s.pageId).nodes.length");
  await kit(page).getByRole("button", { name: "Add logo to page" }).click();
  expect(await state<number>(page, "(s) => s.project.pages.find(p => p.id === s.pageId).nodes.length")).toBe(before + 1);
  await expect(frame(page).locator('img[alt="Bright School logo"]')).toHaveCount(1);
  // the library knows the logo is in use
  expect(await state<boolean>(page, `(s) => [...window.__editor.getState().project.pages.flatMap(p => JSON.stringify(p.nodes))].join('').includes('${logoId}')`)).toBe(true);
  await kit(page).getByRole("button", { name: "Remove", exact: true }).click();
  expect(await state<unknown>(page, "(s) => s.project.brand?.logoAssetId ?? null")).toBeNull();
});

test("my colours: save a colour, save the theme colours, use one as primary, remove one", async ({ page }) => {
  await kit(page).getByLabel("Pick a colour to save").fill("#ff0066");
  await kit(page).getByRole("button", { name: "Save colour", exact: true }).click();
  expect(await state<string[]>(page, "(s) => s.project.brand.colors")).toEqual(["#FF0066"]);
  await kit(page).getByRole("button", { name: "Save current theme colours" }).click();
  const saved = await state<string[]>(page, "(s) => s.project.brand.colors");
  expect(saved.length).toBeGreaterThan(1);
  expect(new Set(saved).size).toBe(saved.length); // never twice
  await kit(page).getByRole("button", { name: "Use #FF0066 as primary colour" }).click();
  expect(await state<string>(page, "(s) => s.project.theme.colors.primary")).toBe("#FF0066");
  await kit(page).getByRole("button", { name: "Remove #FF0066" }).click();
  expect(await state<string[]>(page, "(s) => s.project.brand.colors")).not.toContain("#FF0066");
});

test("my fonts: save the current pair once, switch to it later", async ({ page }) => {
  await kit(page).getByRole("button", { name: /^Save current fonts/ }).click();
  expect(await state<number>(page, "(s) => s.project.brand.fonts.length")).toBe(1);
  await expect(kit(page).getByRole("button", { name: /^Save current fonts/ })).toBeDisabled(); // already saved
  await page.getByRole("button", { name: "Use Classic fonts" }).first().click();
  expect(await state<string>(page, "(s) => s.project.theme.fonts.heading")).toBe("Lora");
  await kit(page).getByRole("button", { name: /^Use my fonts Poppins and Inter/ }).click();
  expect(await state<string>(page, "(s) => s.project.theme.fonts.heading")).toBe("Poppins");
});

test("the brand kit survives a reload", async ({ page }) => {
  await kit(page).getByLabel("Brand name").fill("Kept School");
  await kit(page).getByLabel("Brand name").blur();
  await expect(page.getByTestId("save-status")).toHaveText(/Saved/, { timeout: 10_000 });
  await page.reload();
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("tab", { name: "Brand", exact: true }).click();
  await expect(kit(page).getByLabel("Brand name")).toHaveValue("Kept School");
});
