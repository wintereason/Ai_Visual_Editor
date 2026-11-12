import { expect, test, type Page } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const lastProps = (page: Page) => state<any>(page, "s => { const n = s.project.pages[0].nodes; return n[n.length-1].children[0].props; }");
const pastLen = (page: Page) => state<number>(page, "s => s.past.length");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
});

async function add(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}
const commitField = async (page: Page, label: string, value: string) => {
  const f = page.getByLabel(label, { exact: true });
  await f.fill(value);
  await f.blur();
};

test.describe("pricing plans", () => {
  test("edit a field, see it on the canvas, undo it", async ({ page }) => {
    await add(page, "Pricing");
    await commitField(page, "plans 1 price", "₹555");
    await expect(frame(page).locator(".avc-plan").first()).toContainText("₹555");
    await page.getByRole("button", { name: /Undo/ }).click();
    await expect(frame(page).locator(".avc-plan").first()).toContainText("₹299");
  });

  test("add a plan (copies the last, valid at once), then edit and reorder it", async ({ page }) => {
    await add(page, "Pricing");
    await page.getByRole("button", { name: "Add to plans", exact: true }).click();
    await expect(frame(page).locator(".avc-plan")).toHaveCount(3);
    await page.getByRole("button", { name: "Toggle plans 3" }).click();
    await commitField(page, "plans 3 name", "Team");
    await expect(frame(page).locator(".avc-plan h3").nth(2)).toHaveText("Team");

    await page.getByRole("button", { name: "Move plans 3 up" }).click();
    await expect(frame(page).locator(".avc-plan h3")).toHaveText(["Basic", "Team", "Pro"]);
    expect((await lastProps(page)).plans.map((p: any) => p.name)).toEqual(["Basic", "Team", "Pro"]);
  });

  test("remove a plan", async ({ page }) => {
    await add(page, "Pricing");
    await page.getByRole("button", { name: "Remove plans 1", exact: true }).click();
    await expect(frame(page).locator(".avc-plan")).toHaveCount(1);
    await expect(frame(page).locator(".avc-plan h3")).toHaveText(["Pro"]);
  });

  test("a nested list (features) can be edited, extended and shortened", async ({ page }) => {
    await add(page, "Pricing");
    await commitField(page, "plans 1 features 1", "Unlimited courses");
    await expect(frame(page).locator(".avc-plan").first()).toContainText("Unlimited courses");
    await page.getByRole("button", { name: "Add to plans 1 features", exact: true }).click();
    await expect(frame(page).locator(".avc-plan").first().locator("li")).toHaveCount(3);
    await page.getByRole("button", { name: "Remove plans 1 features 1" }).click();
    await expect(frame(page).locator(".avc-plan").first().locator("li")).toHaveCount(2);
    expect((await lastProps(page)).plans[0].features).toEqual(["Another feature", "Another feature"]);
  });

  test("booleans are checkboxes", async ({ page }) => {
    await add(page, "Pricing");
    await page.getByRole("button", { name: "Toggle plans 2" }).click();
    const box = page.getByLabel("plans 2 highlighted", { exact: true });
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect(frame(page).locator(".avc-plan-hl")).toHaveCount(0);
  });

  test("an unsafe link is refused with a message; nothing changes", async ({ page }) => {
    await add(page, "Pricing");
    const before = await pastLen(page);
    await commitField(page, "plans 1 ctaHref", "javascript:alert(1)");
    await expect(page.getByRole("alert").filter({ hasText: /url must be/i })).toBeVisible();
    expect(await pastLen(page)).toBe(before);
    await expect(frame(page).locator(".avc-plan a.avc-btn").first()).not.toHaveAttribute("href", /javascript/);
  });

  test("schema limits apply: a fifth plan is rejected and the list stays at four", async ({ page }) => {
    await add(page, "Pricing");
    await page.getByRole("button", { name: "Add to plans", exact: true }).click(); // 3
    await page.getByRole("button", { name: "Add to plans", exact: true }).click(); // 4
    await expect(frame(page).locator(".avc-plan")).toHaveCount(4);
    await page.getByRole("button", { name: "Add to plans", exact: true }).click(); // 5: refused
    await expect(page.getByRole("alert").filter({ hasText: /plans/i })).toBeVisible();
    await expect(frame(page).locator(".avc-plan")).toHaveCount(4);
  });
});

test.describe("other lists", () => {
  test("FAQ: add a question and edit its answer in a multi-line field", async ({ page }) => {
    await add(page, "FAQ");
    await page.getByRole("button", { name: "Add to items", exact: true }).click();
    await page.getByRole("button", { name: "Toggle items 3" }).click();
    await commitField(page, "items 3 question", "Do you offer refunds?");
    await commitField(page, "items 3 answer", "Yes, within 7 days.");
    await expect(frame(page).locator(".avc-faq details")).toHaveCount(3);
    await expect(frame(page).getByText("Do you offer refunds?")).toBeVisible();
    await expect(frame(page).getByText("Yes, within 7 days.")).toBeVisible();
    expect(await page.getByLabel("items 3 answer", { exact: true }).evaluate((e) => e.tagName)).toBe("TEXTAREA");
  });

  test("team: pick a photo from the media library instead of typing an id", async ({ page }) => {
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Upload images").setInputFiles([{ name: "asha.png", mimeType: "image/png", buffer: PNG_1PX }]);
    await expect(page.getByTestId("asset-asha")).toBeVisible();
    await page.getByRole("tab", { name: "Blocks" }).click();
    await add(page, "Team");
    const select = page.getByLabel("members 1 imageAssetId", { exact: true });
    await expect(select.locator("option")).toHaveText(["(none)", "asha"]);
    await select.selectOption({ label: "asha" });
    await expect(frame(page).locator(".avc-member img[src^='blob:']")).toHaveCount(1);
    expect((await lastProps(page)).members[0].imageAssetId).toMatch(/^asset_/);
    await select.selectOption("");
    await expect(frame(page).locator(".avc-member img")).toHaveCount(0); // back to the initial
  });

  test("gallery images and logo strip use the same editor", async ({ page }) => {
    await add(page, "Gallery");
    await commitField(page, "images 1 alt", "Front gate");
    await expect(frame(page).locator('.avc-gallery img[alt="Front gate"]')).toHaveCount(1);
    await add(page, "Logo strip");
    await commitField(page, "logos 1 name", "Acme Corp");
    await expect(frame(page).locator(".avc-logos li").first()).toHaveText("Acme Corp");
  });

  test("the raw JSON view is still there for power users and still validates", async ({ page }) => {
    await add(page, "Stats");
    await page.getByText("Edit as JSON").click();
    const area = page.getByLabel("items JSON");
    const json = JSON.parse(await area.inputValue());
    json[0].value = "900+";
    await area.fill(JSON.stringify(json));
    await area.blur();
    await expect(frame(page).locator(".avc-stat strong").first()).toHaveText("900+");

    const before = await pastLen(page);
    await area.fill("not json");
    await area.blur();
    await expect(page.getByRole("alert").filter({ hasText: /invalid JSON/i })).toBeVisible();
    expect(await pastLen(page)).toBe(before);
  });

  test("moving items with the keyboard-reachable buttons is disabled at the ends", async ({ page }) => {
    await add(page, "Steps");
    await expect(page.getByRole("button", { name: "Move items 1 up" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move items 3 down" })).toBeDisabled();
    await page.getByRole("button", { name: "Move items 1 down" }).click();
    await expect(frame(page).locator(".avc-steps li h3").first()).toHaveText("Choose");
  });
});

test.describe("schema-driven fields", () => {
  test("optional fields that are not set yet are still offered (hero image, subheadline)", async ({ page }) => {
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Upload images").setInputFiles([{ name: "banner.png", mimeType: "image/png", buffer: PNG_1PX }]);
    await expect(page.getByTestId("asset-banner")).toBeVisible();
    await page.getByRole("tab", { name: "Blocks" }).click();
    await add(page, "Hero");
    expect("imageAssetId" in (await lastProps(page))).toBe(false); // not stored...
    const pick = page.getByLabel("imageAssetId", { exact: true });
    await expect(pick).toBeVisible(); // ...but still offered
    await pick.selectOption({ label: "banner" });
    await expect(frame(page).locator(".avc-hero-img")).toHaveCount(1);
    await pick.selectOption("");
    await expect(frame(page).locator(".avc-hero-img")).toHaveCount(0);
    expect("imageAssetId" in (await lastProps(page))).toBe(false); // clearing removes the key, it does not store ""
  });

  test("blanking an optional text field removes it; blanking a required one keeps an empty string", async ({ page }) => {
    await add(page, "Hero");
    const heroP = frame(page).locator(".avc-hero").last().locator("p");
    await expect(heroP).toHaveCount(1);
    await commitField(page, "subheadline", "");
    expect("subheadline" in (await lastProps(page))).toBe(false);
    await expect(heroP).toHaveCount(0);
    await commitField(page, "subheadline", "Back again");
    await expect(heroP).toHaveText("Back again");
    await commitField(page, "headline", "");
    expect((await lastProps(page)).headline).toBe(""); // required: stays as an empty string
  });

  test("a plan's optional period can be cleared and re-added", async ({ page }) => {
    await add(page, "Pricing");
    await commitField(page, "plans 1 period", "");
    expect("period" in (await lastProps(page)).plans[0]).toBe(false);
    await expect(frame(page).locator(".avc-plan").first().locator(".avc-price span")).toHaveCount(0);
    await commitField(page, "plans 1 period", "year");
    await expect(frame(page).locator(".avc-plan").first().locator(".avc-price span")).toContainText("year");
  });

  test("enums are dropdowns of the allowed values only (image fit)", async ({ page }) => {
    await add(page, "Image");
    const fit = page.getByLabel("fit", { exact: true });
    await expect(fit.locator("option")).toHaveText(["(default)", "cover", "contain"]); // fit has a default, so "(default)" removes the override
    await fit.selectOption("contain");
    expect((await lastProps(page)).fit).toBe("contain");
  });

  test("an image element can take a file from the library through its dropdown, replacing the address", async ({ page }) => {
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Upload images").setInputFiles([{ name: "pic.png", mimeType: "image/png", buffer: PNG_1PX }]);
    await expect(page.getByTestId("asset-pic")).toBeVisible();
    await page.getByRole("tab", { name: "Blocks" }).click();
    await add(page, "Image");
    await page.getByLabel("assetId", { exact: true }).selectOption({ label: "pic" });
    await expect(frame(page).locator("img[src^='blob:']")).toHaveCount(1);
    expect((await lastProps(page)).assetId).toMatch(/^asset_/);
  });

  test("a missing library file is shown as such instead of being silently dropped", async ({ page }) => {
    await add(page, "Image");
    await page.evaluate(() => {
      const st = (window as any).__editor.getState();
      const n = st.project.pages[0].nodes;
      st.commit({ summary: "x", ops: [{ op: "update", id: n[n.length - 1].children[0].id, props: { assetId: "asset_gone" } }] });
    });
    await expect(page.getByLabel("assetId", { exact: true }).locator("option:checked")).toHaveText("asset_gone (not in library)");
  });
});
