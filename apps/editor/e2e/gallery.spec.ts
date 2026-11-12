import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "New…" }).click();
});

const visible = (page: Page) => page.locator("[data-testid^=template-]");

test.describe("search and filters", () => {
  test("all templates and the blank option show by default", async ({ page }) => {
    await expect(visible(page)).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Use blank" })).toBeVisible();
  });
  test("search matches names, colours, features and audiences", async ({ page }) => {
    const box = page.getByLabel("Search templates");
    for (const [q, id] of [["green", "school"], ["maroon", "college"], ["pricing", "online"], ["kids", "preschool"], ["exam", "coaching"], ["GREEN", "school"], ["  greenfield ", "school"]] as const) {
      await box.fill(q);
      await expect(visible(page), q).toHaveCount(1);
      await expect(page.getByTestId(`template-${id}`), q).toBeVisible();
    }
  });
  test("a search with no results says so, and clearing it brings everything back", async ({ page }) => {
    await page.getByLabel("Search templates").fill("xyzzy");
    await expect(visible(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "No templates match" })).toContainText('"xyzzy"');
    await expect(page.getByRole("button", { name: "Use blank" })).toHaveCount(0);
    await page.getByLabel("Search templates").fill("");
    await expect(visible(page)).toHaveCount(5);
  });
  test("the blank option is findable by search, and the topic chip works", async ({ page }) => {
    await page.getByLabel("Search templates").fill("blank");
    await expect(page.getByRole("button", { name: "Use blank" })).toBeVisible();
    await expect(visible(page)).toHaveCount(0);
    await page.getByLabel("Search templates").fill("");
    await page.getByRole("button", { name: "Education", exact: true }).click();
    await expect(visible(page)).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Use blank" })).toHaveCount(0); // blank belongs to no topic
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByRole("button", { name: "Use blank" })).toBeVisible();
  });
  test("a filtered template can still be used", async ({ page }) => {
    await page.getByLabel("Search templates").fill("preschool");
    await page.getByTestId("template-preschool").getByRole("button", { name: "Use template" }).click();
    await expect(frame(page).locator("h1")).toContainText("Where little ones love to learn");
  });
});

test.describe("mix pages", () => {
  const openMix = async (page: Page) => { await page.getByRole("tab", { name: "Mix pages" }).click(); };
  const pick = (page: Page, label: string) => page.getByLabel(label, { exact: true }).check();

  test("combine pages from three templates into one site with a single look and matching navigation", async ({ page }) => {
    await openMix(page);
    await pick(page, "School: Home");
    await pick(page, "Coaching Institute: Courses");
    await pick(page, "Online Academy: Contact");
    await page.getByLabel("Theme from").selectOption("preschool");
    await expect(page.getByTestId("mix-summary")).toHaveText("3 pages: Home · Courses · Contact");
    await page.getByRole("button", { name: "Create site" }).click();

    await expect(page.getByRole("dialog", { name: "New project" })).toHaveCount(0);
    expect(await state<string>(page, "s => s.project.name")).toBe("Little Sprouts Preschool");
    expect(await state<string[]>(page, "s => s.project.pages.map(p => p.path)")).toEqual(["/", "/courses", "/contact"]);
    expect(await state<string>(page, "s => s.project.theme.colors.primary")).toBe("#0f766e"); // teal, from the preschool template
    await expect(frame(page).locator("nav strong").first()).toHaveText("Little Sprouts Preschool"); // brand replaced
    await expect(frame(page).locator(".avc-nav a", { hasText: "Courses" })).toHaveCount(1);
    await expect(frame(page).locator("a", { hasText: "Teachers" })).toHaveCount(0); // pages that are not in the mix are not linked anywhere
  });

  test("colors and name follow the home page's template until you choose otherwise", async ({ page }) => {
    await openMix(page);
    await pick(page, "College: Programs"); // no home page yet: follows the first page chosen
    await expect(page.getByLabel("Theme from")).toHaveValue("college");
    await pick(page, "Online Academy: Home"); // now there is a home page: follow its template
    await expect(page.getByLabel("Theme from")).toHaveValue("online");
    await page.getByLabel("Theme from").selectOption("school"); // an explicit choice sticks
    await pick(page, "Preschool: Contact");
    await page.getByLabel("Online Academy: Home", { exact: true }).uncheck();
    await pick(page, "Coaching Institute: Home");
    await expect(page.getByLabel("Theme from")).toHaveValue("school");
  });

  test("the mixed site exports cleanly (no pre-publish errors) as three pages", async ({ page }) => {
    await openMix(page);
    await pick(page, "College: Home");
    await pick(page, "College: Programs");
    await pick(page, "School: Contact");
    await page.getByRole("button", { name: "Create site" }).click();
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("dialog", { name: "Export" })).not.toContainText("✖");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download/ }).click()]);
    const files = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
    expect(Object.keys(files).filter((f) => f.endsWith("index.html")).sort()).toEqual(["contact/index.html", "index.html", "programs/index.html"]);
    const home = strFromU8(files["index.html"]!);
    expect(home).not.toContain("Greenfield Public School"); // the other template's name did not leak in
    expect(home).toContain("Northbridge College");
  });

  test("pages that would share an address can't both be chosen", async ({ page }) => {
    await openMix(page);
    await pick(page, "School: Contact");
    await expect(page.getByLabel("Online Academy: Contact", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Coaching Institute: Contact", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("School: Home", { exact: true })).toBeEnabled();
    await page.getByLabel("School: Contact", { exact: true }).uncheck();
    await expect(page.getByLabel("Online Academy: Contact", { exact: true })).toBeEnabled();
  });

  test("a mix without a home page is explained and can't be created", async ({ page }) => {
    await openMix(page);
    await pick(page, "Coaching Institute: Courses");
    await expect(page.getByTestId("mix-error")).toContainText("home page");
    await expect(page.getByRole("button", { name: "Create site" })).toBeDisabled();
    await pick(page, "Coaching Institute: Home");
    await expect(page.getByTestId("mix-error")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create site" })).toBeEnabled();
  });

  test("nothing chosen: no error shown, button disabled", async ({ page }) => {
    await openMix(page);
    await expect(page.getByTestId("mix-summary")).toHaveText("No pages chosen");
    await expect(page.getByTestId("mix-error")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create site" })).toBeDisabled();
  });

  test("creating a mix is undoable and keeps the previous project in History", async ({ page }) => {
    await openMix(page);
    await pick(page, "School: Home");
    await page.getByRole("button", { name: "Create site" }).click();
    expect(await state<string>(page, "s => s.project.name")).toBe("Greenfield Public School");
    await page.getByRole("button", { name: /Undo/ }).click();
    expect(await state<string>(page, "s => s.project.name")).toBe("BrightPath Coaching");
    expect(await state<string[]>(page, "s => s.versions.map(v => v.label)")).toContain("Before a mixed site");
  });

  test("the mix is independent of the templates: editing it does not change the next mix", async ({ page }) => {
    await openMix(page);
    await pick(page, "School: Home");
    await page.getByRole("button", { name: "Create site" }).click();
    await frame(page).locator("h1").dblclick().catch(() => {});
    await page.evaluate(() => {
      const st = (window as any).__editor.getState();
      st.commit({ summary: "edit", ops: [{ op: "update", id: st.project.pages[0].nodes[1].children[0].id, props: { headline: "My own words" } }] });
    });
    await page.getByRole("button", { name: "New…" }).click();
    await page.getByRole("tab", { name: "Mix pages" }).click();
    await pick(page, "School: Home");
    await page.getByRole("button", { name: "Create site" }).click();
    await expect(frame(page).locator("h1")).toContainText("A school where every child is known");
  });
});
