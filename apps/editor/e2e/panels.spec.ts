import { expect, test, type Page } from "@playwright/test";
import { exampleProject, failingPairs, validateProject, type Project } from "@avc/schema";
import { renderDocument } from "@avc/renderer";
import { ALL_ITEMS, CATEGORIES } from "../lib/catalog";
import { FONT_PAIRS, GRADIENTS, PALETTES, readableTextOn } from "../lib/brand";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const nodeCount = (page: Page) => state<number>(page, "(s) => s.project.pages.find(p => p.id === s.pageId).nodes.length");
const rail = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test.describe("catalogue data", () => {
  it_("has a big library", () => {
    const by = (id: string) => CATEGORIES.find((c) => c.id === id)!.items.length;
    expect(by("shapes")).toBeGreaterThanOrEqual(25);
    expect(by("icons")).toBeGreaterThanOrEqual(45);
    expect(by("charts")).toBe(6);
    expect(by("tables")).toBeGreaterThanOrEqual(4);
    expect(ALL_ITEMS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(ALL_ITEMS.map((i) => i.key)).size).toBe(ALL_ITEMS.length);
  });
  it_("every item is valid, renders, and has a drop type the registry knows", () => {
    for (const item of ALL_ITEMS) {
      const node = item.make();
      expect(node.type, item.key).toBe(item.type);
      const project: Project = JSON.parse(JSON.stringify(exampleProject));
      project.pages[0]!.nodes = [{ id: "s", kind: "container", type: "section", props: {}, children: [node] } as never];
      const v = validateProject(project);
      expect(v.ok, `${item.key}: ${JSON.stringify((v as { issues?: unknown }).issues)}`).toBe(true);
      expect(() => renderDocument(project, project.pages[0]!.id)).not.toThrow();
    }
  });
  it_("every colour palette passes the same readability checks as the Theme panel", () => {
    for (const p of PALETTES) expect(failingPairs(p.colors), p.name).toEqual([]);
  });
  it_("font pairs only use fonts the Theme panel offers", () => {
    const offered = ["Poppins", "Inter", "Roboto", "Montserrat", "Lora", "Georgia", "system-ui"];
    for (const f of FONT_PAIRS) { expect(offered).toContain(f.heading); expect(offered).toContain(f.body); }
  });
  it_("text colour chosen for a background is always readable on it, or left alone", () => {
    expect(readableTextOn(["#0F172A"])).toBe("#FFFFFF");
    expect(readableTextOn(["#FFFFFF"])).toBe("#111827");
    expect(readableTextOn(["#808080"])).toBeNull();
    for (const g of GRADIENTS) {
      const t = readableTextOn(g.stops.map((s) => s.color));
      expect(t === null || ["#FFFFFF", "#111827"].includes(t), g.name).toBe(true);
    }
  });
});
function it_(name: string, fn: () => void) { test(name, fn); }

test.describe("the left rail and its panels", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(frame(page).locator("h1")).toBeVisible();
  });

  test("a Canva-style rail with every tool, and the old ones still work", async ({ page }) => {
    for (const n of ["Templates", "Elements", "Text", "Brand", "Blocks", "Media", "Background", "Charts", "Layers", "Pages", "✦ Create"]) await expect(rail(page, n)).toBeVisible();
    await expect(rail(page, "Blocks")).toHaveAttribute("aria-selected", "true");
    await rail(page, "Layers").click();
    await expect(rail(page, "Layers")).toHaveAttribute("aria-selected", "true");
    await rail(page, "Elements").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("elements-panel")).toBeVisible();
  });

  test("Elements: categories, then click a shape to add it, and it is editable", async ({ page }) => {
    await rail(page, "Elements").click();
    for (const c of ["Shapes", "Icons", "Sections", "Buttons", "Cards", "Layouts", "Pictures", "Charts", "Tables", "Maps"]) await expect(page.getByRole("button", { name: new RegExp(`^${c} \\(`) })).toBeVisible();
    await page.getByRole("button", { name: /^Shapes \(/ }).click();
    const before = await nodeCount(page);
    await page.getByRole("button", { name: "Hexagon", exact: true }).click();
    expect(await nodeCount(page)).toBe(before + 1);
    await expect(frame(page).locator("svg.avc-shape")).toHaveCount(1);
    // the inspector offers the shape list and a text-colour control
    await expect(page.getByText("shape", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Back to all categories" }).click();
    await expect(page.getByText("Browse categories")).toBeVisible();
  });

  test("Elements: search finds things across categories", async ({ page }) => {
    await rail(page, "Elements").click();
    await page.getByLabel("Search elements").fill("arrow");
    await expect(page.getByRole("button", { name: "Arrow", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Arrow right" })).toBeVisible();
    await page.getByLabel("Search elements").fill("zzzzzz");
    await expect(page.getByText("Nothing matches")).toBeVisible();
  });

  test("Elements: icons and a drag onto the canvas", async ({ page }) => {
    await rail(page, "Elements").click();
    await page.getByRole("button", { name: /^Icons \(/ }).click();
    const tile = page.getByRole("button", { name: "Heart", exact: true });
    await tile.scrollIntoViewIfNeeded();
    const from = (await tile.boundingBox())!;
    await frame(page).locator("footer").first().scrollIntoViewIfNeeded();
    const b = (await frame(page).locator("footer").first().boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.5, { steps: 10 });
    await page.mouse.up();
    await expect(frame(page).locator("svg.avc-icon")).toHaveCount(1);
  });

  test("Sections show a real preview of each design and add it", async ({ page }) => {
    await rail(page, "Elements").click();
    await page.getByRole("button", { name: /^Sections \(/ }).click();
    await expect(page.getByTestId("elements-panel").locator("iframe[title=preview]").first()).toBeVisible();
    await page.getByRole("button", { name: "Pricing", exact: true }).click(); // category chip
    const before = await nodeCount(page);
    await page.getByRole("button", { name: "Pricing · three plans" }).click();
    expect(await nodeCount(page)).toBe(before + 1);
    await expect(frame(page).getByText("Simple pricing")).toBeVisible();
  });

  test("Charts: add a chart, then change its numbers", async ({ page }) => {
    await rail(page, "Charts").click();
    await page.getByRole("button", { name: "Donut chart" }).click();
    await expect(frame(page).locator("svg.avc-chart")).toHaveCount(1);
    await expect(frame(page).locator("svg.avc-chart")).toHaveAttribute("aria-label", /donut chart: Online 55, In person 30, Other 15/);
    await page.getByText("Edit as JSON").click();
    const json = page.getByLabel("data JSON");
    await json.fill(JSON.stringify([{ label: "Yes", value: 80 }, { label: "No", value: 20 }]));
    await json.blur();
    await expect(frame(page).locator("svg.avc-chart")).toHaveAttribute("aria-label", /Yes 80, No 20/);
    // undo restores the old numbers
    await page.keyboard.press("Control+z");
    await expect(frame(page).locator("svg.avc-chart")).toHaveAttribute("aria-label", /Online 55/);
  });

  test("Text: add a heading, and a font pair restyles the whole site", async ({ page }) => {
    await rail(page, "Text").click();
    const before = await nodeCount(page);
    await page.getByRole("button", { name: "Add a heading" }).click();
    expect(await nodeCount(page)).toBe(before + 1);
    await page.getByRole("button", { name: "Use Classic fonts" }).click();
    expect(await state<string>(page, "(s) => s.project.theme.fonts.heading + '/' + s.project.theme.fonts.body")).toBe("Lora/Inter");
    await expect(page.getByRole("button", { name: "Use Classic fonts" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Control+z");
    expect(await state<string>(page, "(s) => s.project.theme.fonts.heading")).not.toBe("Lora");
  });

  test("Text: 'Write with AI' opens the AI tab", async ({ page }) => {
    await rail(page, "Text").click();
    await page.getByRole("button", { name: /Write with AI/ }).click();
    await expect(rail(page, "✦ Create")).toHaveAttribute("aria-selected", "true");
  });

  test("Brand: a palette changes the theme, and is one undo", async ({ page }) => {
    await rail(page, "Brand").click();
    await page.getByRole("button", { name: "Use Forest colours" }).click();
    expect(await state<string>(page, "(s) => s.project.theme.colors.primary")).toBe("#166534");
    await expect(page.getByRole("button", { name: "Use Forest colours" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "none", exact: true }).click();
    expect(await state<string>(page, "(s) => s.project.theme.radius")).toBe("none");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    expect(await state<string>(page, "(s) => s.project.theme.colors.primary")).not.toBe("#166534");
  });

  test("Background: gradient on every section, with readable text; colour on one selected section", async ({ page }) => {
    await rail(page, "Background").click();
    await page.getByRole("button", { name: "Every section on this page" }).click();
    await page.getByRole("button", { name: "Gradient Night" }).click();
    const sections = await state<{ bg: unknown; color: unknown }[]>(page, "(s) => s.project.pages.find(p => p.id === s.pageId).nodes.filter(n => n.type === 'section').map(n => ({ bg: n.styles.base.normal.background, color: n.styles.base.normal.color }))");
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) { expect((s.bg as { type: string }).type).toBe("linear"); expect(s.color).toBe("#FFFFFF"); }
    await expect(frame(page).locator("section").first()).toHaveCSS("background-image", /linear-gradient/);
    // one selected section
    const first = await state<string>(page, "(s) => s.project.pages.find(p => p.id === s.pageId).nodes.find(n => n.type === 'section').id");
    await page.evaluate((id) => (window as any).__editor.getState().select(id), first);
    await page.getByRole("button", { name: "Selected box" }).click();
    await page.getByRole("button", { name: "Colour #FEF3C7" }).click();
    const bg = await state<string>(page, `(s) => s.project.pages.find(p => p.id === s.pageId).nodes.find(n => n.id === '${first}').styles.base.normal.background`);
    expect(bg).toBe("#FEF3C7");
    expect(await state<string>(page, `(s) => s.project.pages.find(p => p.id === s.pageId).nodes.find(n => n.id === '${first}').styles.base.normal.color`)).toBe("#111827");
    // "No background" clears it
    await page.getByRole("button", { name: "No background" }).click();
    expect(await state<unknown>(page, `(s) => s.project.pages.find(p => p.id === s.pageId).nodes.find(n => n.id === '${first}').styles.base.normal.background ?? null`)).toBeNull();
  });

  test("Templates: previews are real, and a template page is added as a new page", async ({ page }) => {
    await rail(page, "Templates").click();
    const panel = page.getByTestId("templates-panel");
    await expect(panel.locator("iframe[title=preview]").first()).toBeVisible();
    const pages = await state<number>(page, "(s) => s.project.pages.length");
    await panel.getByRole("button", { name: /^Add page: .*\(Online Academy\)$/ }).first().click();
    expect(await state<number>(page, "(s) => s.project.pages.length")).toBe(pages + 1);
    await expect(panel.getByRole("status")).toContainText("as a new page");
    // paths stay unique even when the same page is added twice
    await panel.getByRole("button", { name: /^Add page: .*\(Online Academy\)$/ }).first().click();
    const paths = await state<string[]>(page, "(s) => s.project.pages.map(p => p.path)");
    expect(new Set(paths).size).toBe(paths.length);
    // "Start a whole new site" opens the full gallery
    await panel.getByRole("button", { name: /Start a whole new site/ }).click();
    await expect(page.getByRole("heading", { name: "Start a new project" })).toBeVisible();
  });
});
