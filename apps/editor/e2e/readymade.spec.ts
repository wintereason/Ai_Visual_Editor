import { expect, test, type Page } from "@playwright/test";
import { exampleProject, validateProject, type Project } from "@avc/schema";
import { renderDocument } from "@avc/renderer";
import { READY, READY_CATEGORIES } from "../lib/readymade";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;

test("there are plenty of ready-made items, with unique keys", () => {
  expect(READY.length).toBeGreaterThanOrEqual(55);
  expect(new Set(READY.map((r) => r.key)).size).toBe(READY.length);
  expect(READY_CATEGORIES.length).toBeGreaterThanOrEqual(8);
});

test("every ready-made item is valid, renders, and is editable like anything else", () => {
  for (const r of READY) {
    const node = r.make();
    const section = { id: "s_" + r.key, kind: "container", type: "section", props: {}, children: [node] };
    const project: Project = JSON.parse(JSON.stringify(exampleProject));
    project.pages[0]!.nodes = [section as never];
    const v = validateProject(project);
    expect(v.ok, `${r.key}: ${JSON.stringify((v as { issues?: unknown }).issues)}`).toBe(true);
    expect(() => renderDocument(project, project.pages[0]!.id)).not.toThrow();
  }
});

test.describe("the Ready-made tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(frame(page).locator("h1")).toBeVisible();
    await page.getByRole("tab", { name: "Ready-made" }).click();
  });

  test("search and category filters narrow the list", async ({ page }) => {
    const grid = page.getByTestId("ready-made");
    await expect(grid.getByRole("button", { name: "Hero · split" })).toBeVisible();
    await grid.getByRole("button", { name: "Pricing", exact: true }).click();
    await expect(grid.getByRole("button", { name: "Pricing · three plans" })).toBeVisible();
    await expect(grid.getByRole("button", { name: "Hero · split" })).toHaveCount(0);
    await grid.getByRole("button", { name: "All", exact: true }).click();
    await page.getByLabel("Search ready-made items").fill("zzzz");
    await expect(page.getByText("Nothing matches")).toBeVisible();
  });

  test("clicking adds it to the page, and it can be edited and undone", async ({ page }) => {
    const before = await state<number>(page, "(s) => s.project.pages[0].nodes.length");
    await page.getByRole("button", { name: "Pricing · three plans" }).click();
    expect(await state<number>(page, "(s) => s.project.pages[0].nodes.length")).toBe(before + 1);
    await expect(frame(page).getByText("Simple pricing")).toBeVisible();
    await page.keyboard.press("Control+z");
    expect(await state<number>(page, "(s) => s.project.pages[0].nodes.length")).toBe(before);
  });

  test("dragging a card onto the canvas adds it", async ({ page }) => {
    const card = page.getByRole("button", { name: "Card · highlighted" });
    await card.scrollIntoViewIfNeeded();
    const from = (await card.boundingBox())!;
    await frame(page).locator("footer").first().scrollIntoViewIfNeeded();
    const b = (await frame(page).locator("footer").first().boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.5, { steps: 10 });
    await page.mouse.up();
    await expect(frame(page).getByText("Good to know")).toBeVisible();
  });
});
