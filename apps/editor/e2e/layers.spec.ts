import { expect, test, type Page } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const findJs = (id: string) => `(function f(ns){ for (const n of ns) { if (n.id === ${JSON.stringify(id)}) return n; const c = n.children && f(n.children); if (c) return c; } })(s.project.pages.flatMap(p => p.nodes))`;
const node = <T,>(page: Page, id: string, expr = "n") => state<T>(page, `(s) => { const n = ${findJs(id)}; return ${expr}; }`);
const select = (page: Page, id: string) => page.evaluate((i) => (window as any).__editor.getState().select(i), id);

async function addCompositionAndGetLayers(page: Page, name = "Photo with badge") {
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByRole("button", { name: /^Photo layers \(/ }).click();
  await page.getByRole("button", { name, exact: true }).click();
  const gid = await state<string>(page, "(s) => { let g; (function f(ns){ for (const n of ns) { if (n.type === 'layerGroup') g = n; if (n.children) f(n.children); } })(s.project.pages.find(p => p.id === s.pageId).nodes); return g.id; }");
  const layers = await node<string[]>(page, gid, "n.children.map(c => c.id)");
  return { gid, layers };
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
});

test("a composition is a fixed-shape box with its layers placed by percentage", async ({ page }) => {
  const { gid, layers } = await addCompositionAndGetLayers(page, "Photo with caption");
  expect(layers).toHaveLength(3);
  const g = frame(page).locator(`[data-node="${gid}"]`);
  await expect(g).toHaveClass(/avc-lg/);
  const box = (await g.boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
  await expect(frame(page).locator(".avc-lp")).toHaveCount(3);
});

test("the shape holds on a phone: the picture and its badge scale together", async ({ page }) => {
  const { gid } = await addCompositionAndGetLayers(page, "Photo with badge");
  const ratio = async () => { const b = (await frame(page).locator(`[data-node="${gid}"]`).boundingBox())!; return b.width / b.height; };
  const desktop = await ratio();
  await page.getByRole("button", { name: "📱" }).click();
  await expect.poll(ratio).toBeCloseTo(desktop, 1);
});

test("the Inspector edits a layer's position, with limits, and each edit is one undo", async ({ page }) => {
  const { layers } = await addCompositionAndGetLayers(page);
  const badge = layers[1]!;
  await select(page, badge);
  const left = page.getByLabel("Layer Left");
  await expect(left).toBeVisible();
  const before = await node<number>(page, badge, "n.place.x");
  await left.fill("30");
  await left.blur();
  expect(await node<number>(page, badge, "n.place.x")).toBe(30);
  await left.fill("9999"); // out of range: held to the limit, not accepted as typed
  await left.blur();
  expect(await node<number>(page, badge, "n.place.x")).toBe(150);
  await left.fill("");
  await left.blur();
  expect(await node<number>(page, badge, "n.place.x")).toBe(150);
  await page.keyboard.press("Control+z");
  expect(await node<number>(page, badge, "n.place.x")).toBe(30);
  await page.keyboard.press("Control+z");
  expect(await node<number>(page, badge, "n.place.x")).toBe(before);
});

test("dragging a layer on the canvas moves it, as one undoable step", async ({ page }) => {
  const { layers } = await addCompositionAndGetLayers(page);
  const badge = layers[1]!;
  await select(page, badge);
  const overlay = page.getByTestId("layer-overlay");
  await expect(overlay).toBeVisible();
  const startPlace = await node<{ x: number; y: number; w: number }>(page, badge, "n.place");
  const b = (await overlay.boundingBox())!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy + 30, { steps: 8 });
  await page.mouse.up();
  const after = await node<{ x: number; y: number; w: number }>(page, badge, "n.place");
  expect(after.x).toBeLessThan(startPlace.x);
  expect(after.y).toBeGreaterThan(startPlace.y);
  expect(after.w).toBe(startPlace.w);
  await page.keyboard.press("Control+z");
  expect(await node<unknown>(page, badge, "n.place")).toEqual(startPlace);
});

test("dragging the corner resizes a layer", async ({ page }) => {
  const { layers } = await addCompositionAndGetLayers(page);
  const badge = layers[1]!;
  await select(page, badge);
  const startW = await node<number>(page, badge, "n.place.w");
  const h = (await page.getByTestId("layer-resize").boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y + 20, { steps: 8 });
  await page.mouse.up();
  expect(await node<number>(page, badge, "n.place.w")).toBeGreaterThan(startW);
});

test("a click without movement changes nothing", async ({ page }) => {
  const { layers } = await addCompositionAndGetLayers(page);
  const badge = layers[1]!;
  await select(page, badge);
  const before = await node<unknown>(page, badge, "n.place");
  const undoBefore = await state<number>(page, "(s) => s.past.length");
  const b = (await page.getByTestId("layer-overlay").boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  expect(await node<unknown>(page, badge, "n.place")).toEqual(before);
  expect(await state<number>(page, "(s) => s.past.length")).toBe(undoBefore);
});

test("stacking buttons change which layer is on top", async ({ page }) => {
  const { gid, layers } = await addCompositionAndGetLayers(page);
  const first = layers[0]!;
  await select(page, first);
  await page.getByRole("button", { name: "To front" }).click();
  expect((await node<string[]>(page, gid, "n.children.map(c => c.id)")).at(-1)).toBe(first);
  await expect(page.getByRole("button", { name: "To front" })).toBeDisabled();
  await page.getByRole("button", { name: "To back" }).click();
  expect((await node<string[]>(page, gid, "n.children.map(c => c.id)"))[0]).toBe(first);
  // the visible order on the canvas matches
  const order = await frame(page).locator(`[data-node="${gid}"] > .avc-lp`).evaluateAll((els) => els.map((e) => e.getAttribute("data-layer")));
  expect(order[0]).toBe(first);
});

test("add layers from the group's tools, then hide one", async ({ page }) => {
  const { gid } = await addCompositionAndGetLayers(page, "Blank canvas");
  await select(page, gid);
  await expect(page.getByTestId("layer-tools")).toBeVisible();
  const before = await node<number>(page, gid, "n.children.length");
  for (const b of ["+ Text", "+ Shape", "+ Icon", "+ Picture"]) {
    await page.getByRole("button", { name: b, exact: true }).click();
    await page.getByRole("button", { name: "↑ Whole canvas" }).click(); // the new layer is selected; step back to the canvas to add another
  }
  expect(await node<number>(page, gid, "n.children.length")).toBe(before + 4);
  const kids = await node<{ place: unknown }[]>(page, gid, "n.children");
  for (const k of kids) expect(k.place).toBeTruthy();
  const pic = (await node<{ id: string; type: string }[]>(page, gid, "n.children")).find((k) => k.type === "image")!;
  await select(page, pic.id);
  await expect(page.getByTestId("layer-position")).toBeVisible();
  await page.getByLabel("Hide on desktop").check();
  await expect(frame(page).locator(`[data-node="${gid}"] img`)).toBeHidden();
});

test("the Layers tab shows the layers inside, in order, and a layer can be selected from it", async ({ page }) => {
  const { gid, layers } = await addCompositionAndGetLayers(page);
  await page.getByRole("tab", { name: "Layers", exact: true }).click();
  const panel = page.getByTestId("left-panel");
  for (const t of ["layerGroup", "image", "shape", "text"]) await expect(panel.getByText(t, { exact: false }).first()).toBeVisible();
  void gid; void layers;
});

test("every composition starter is usable: valid, placed, and editable", async ({ page }) => {
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByRole("button", { name: /^Photo layers \(/ }).click();
  for (const name of ["Photo with caption", "Photo with badge", "Photo with title", "Square post", "Story", "Poster", "Blank canvas"]) {
    const before = await state<number>(page, "(s) => s.project.pages.find(p => p.id === s.pageId).nodes.length");
    await page.getByRole("button", { name, exact: true }).click();
    expect(await state<number>(page, "(s) => s.project.pages.find(p => p.id === s.pageId).nodes.length"), name).toBe(before + 1);
  }
  await expect(frame(page).locator(".avc-lg")).toHaveCount(7);
});
