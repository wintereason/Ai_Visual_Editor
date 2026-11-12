import { expect, test, type Page } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const live = (page: Page) => page.getByTestId("a11y-live");
const FIND = (id: string) => `(function f(ns){ for (const n of ns) { if (n.id === ${JSON.stringify(id)}) return n; const c = n.children && f(n.children); if (c) return c; } })(s.project.pages.flatMap(p => p.nodes))`;
const node = <T,>(page: Page, id: string, expr = "n") => state<T>(page, `(s) => { const n = ${FIND(id)}; return ${expr}; }`);
const childIds = (page: Page, id: string) => node<string[]>(page, id, "n.children.map(c => c.id)");
const selected = (page: Page) => state<string | null>(page, "(s) => s.selection");

/**
 * A small known page: S1[ a, b, C[ c1, c2 ], d ]  S2[ e ]   (so every keyboard move has a predictable result)
 */
async function setup(page: Page) {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.evaluate(() => {
    const st = (window as any).__editor.getState();
    const t = (id: string) => ({ id, kind: "element", type: "text", props: { text: id } });
    const sec = (id: string, children: any[]) => ({ id, kind: "container", type: "section", props: {}, children });
    const project = structuredClone(st.project);
    project.pages[0].nodes = [
      sec("S1", [t("a"), t("b"), { id: "C", kind: "container", type: "container", props: {}, children: [t("c1"), t("c2")] }, t("d")]),
      sec("S2", [t("e")]),
    ];
    st.loadProject(project, "test");
    (window as any).__editor.setState({ past: [], future: [] });
  });
  await page.getByRole("tab", { name: "Layers", exact: true }).click();
}
const row = (page: Page, id: string) => page.locator(`[role="treeitem"][data-layer-id="${id}"]`);

test.describe("the Layers list is a real tree", () => {
  test.beforeEach(async ({ page }) => setup(page));

  test("it is labelled, every row says what it is and where it sits, and only one row is a Tab stop", async ({ page }) => {
    await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
    await expect(row(page, "S1")).toHaveAttribute("aria-level", "1");
    await expect(row(page, "C")).toHaveAttribute("aria-level", "3");
    await expect(row(page, "C")).toHaveAttribute("aria-label", /container.*level 3, 3 of 4/);
    await expect(row(page, "C")).toHaveAttribute("aria-expanded", "true");
    await expect(row(page, "a")).not.toHaveAttribute("aria-expanded", /.*/);
    expect(await page.locator('[role="treeitem"][tabindex="0"]').count()).toBe(1);
    await row(page, "b").click();
    await expect(row(page, "b")).toHaveAttribute("aria-selected", "true");
    expect(await page.locator('[role="treeitem"][tabindex="0"]').count()).toBe(1);
    await expect(page.locator('[role="treeitem"][tabindex="0"]')).toHaveAttribute("data-layer-id", "b");
  });

  test("Arrow keys move through the rows and select them; Home and End jump", async ({ page }) => {
    await row(page, "S1").focus();
    await page.keyboard.press("ArrowDown");
    expect(await selected(page)).toBe("a");
    await expect(row(page, "a")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await selected(page)).toBe("C");
    await page.keyboard.press("End");
    expect(await selected(page)).toBe("e");
    await page.keyboard.press("Home");
    expect(await selected(page)).toBe("S1");
    await page.keyboard.press("ArrowUp"); // at the top: stays put
    expect(await selected(page)).toBe("S1");
    await expect(live(page)).toContainText(/selected/);
  });

  test("Right and Left open, close, step in and step out", async ({ page }) => {
    await row(page, "C").click();
    await row(page, "C").focus();
    await page.keyboard.press("ArrowLeft"); // open -> closes
    await expect(row(page, "C")).toHaveAttribute("aria-expanded", "false");
    await expect(row(page, "c1")).toHaveCount(0);
    await page.keyboard.press("ArrowRight"); // closed -> opens
    await expect(row(page, "C")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowRight"); // open -> first child
    expect(await selected(page)).toBe("c1");
    await page.keyboard.press("ArrowLeft"); // a leaf -> its parent
    expect(await selected(page)).toBe("C");
  });

  test("Enter and Space select the focused row", async ({ page }) => {
    await row(page, "d").focus();
    await page.keyboard.press("Enter");
    expect(await selected(page)).toBe("d");
    await row(page, "b").focus();
    await page.keyboard.press("Space");
    expect(await selected(page)).toBe("b");
  });

  test("keys meant for the small buttons inside a row still work (they aren't swallowed by the row)", async ({ page }) => {
    await row(page, "b").click();
    const hide = row(page, "b").getByRole("button", { name: "Hide" });
    await hide.focus();
    await page.keyboard.press("Enter");
    expect(await node<boolean>(page, "b", "!!n.styles?.base?.normal?.hidden")).toBe(true);
  });
});

test.describe("moving things with the keyboard (Alt + arrows), with the result announced", () => {
  test.beforeEach(async ({ page }) => setup(page));

  test("Alt+Down and Alt+Up reorder among siblings and keep focus on the row", async ({ page }) => {
    await row(page, "b").click();
    await row(page, "b").focus();
    await page.keyboard.press("Alt+ArrowDown");
    expect(await childIds(page, "S1")).toEqual(["a", "C", "b", "d"]);
    await expect(live(page)).toContainText("Moved text down. Position 3 of 4 in section.");
    await expect(row(page, "b")).toBeFocused();
    await page.keyboard.press("Alt+ArrowUp");
    expect(await childIds(page, "S1")).toEqual(["a", "b", "C", "d"]);
  });

  test("Alt+Right nests into the item above; Alt+Left moves back out; focus survives the move to a new parent", async ({ page }) => {
    await row(page, "d").click();
    await row(page, "d").focus();
    await page.keyboard.press("Alt+ArrowRight");
    expect(await childIds(page, "C")).toEqual(["c1", "c2", "d"]);
    await expect(live(page)).toContainText("Moved text into container");
    await expect(row(page, "d")).toBeFocused();
    await expect(row(page, "d")).toHaveAttribute("aria-level", "4");
    await page.keyboard.press("Alt+ArrowLeft");
    expect(await childIds(page, "S1")).toEqual(["a", "b", "C", "d"]);
    await expect(row(page, "d")).toBeFocused();
  });

  test("a move that isn't allowed changes nothing, and says why", async ({ page }) => {
    const before = await state<string>(page, "(s) => JSON.stringify(s.project)");
    await row(page, "a").click();
    await row(page, "a").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(live(page)).toContainText("already first in section");
    await page.keyboard.press("Alt+ArrowRight");
    await expect(live(page)).toContainText("nothing above");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(live(page)).toContainText("must stay inside a section");
    expect(await state<string>(page, "(s) => JSON.stringify(s.project)")).toBe(before);
    await row(page, "b").click();
    await row(page, "b").focus();
    await page.keyboard.press("Alt+ArrowRight"); // nest into "a" (a text element can't hold children)
    await expect(live(page)).toContainText("can't contain");
    expect(await state<string>(page, "(s) => JSON.stringify(s.project)")).toBe(before);
  });

  test("every keyboard move is one undo step", async ({ page }) => {
    await row(page, "d").click();
    await row(page, "d").focus();
    await page.keyboard.press("Alt+ArrowRight");
    await page.keyboard.press("Control+z");
    expect(await childIds(page, "S1")).toEqual(["a", "b", "C", "d"]);
  });

  test("the same moves work from the canvas, and the buttons in the row do the same", async ({ page }) => {
    await frame(page).locator('[data-node="b"]').click();
    await page.keyboard.press("Alt+ArrowDown");
    expect(await childIds(page, "S1")).toEqual(["a", "C", "b", "d"]);
    await row(page, "b").click();
    await row(page, "b").getByRole("button", { name: "Move up" }).click();
    expect(await childIds(page, "S1")).toEqual(["a", "b", "C", "d"]);
    await row(page, "d").click();
    await row(page, "d").getByRole("button", { name: "Nest into the item above" }).click();
    expect(await childIds(page, "C")).toContain("d");
    await row(page, "d").getByRole("button", { name: "Move out of its parent" }).click();
    expect(await childIds(page, "S1")).toEqual(["a", "b", "C", "d"]);
  });

  test("sections can be reordered with the keyboard too", async ({ page }) => {
    await row(page, "S2").click();
    await row(page, "S2").focus();
    await page.keyboard.press("Alt+ArrowUp");
    expect(await state<string[]>(page, "(s) => s.project.pages[0].nodes.map(n => n.id)")).toEqual(["S2", "S1"]);
  });

  test("typing in a field never triggers a move", async ({ page }) => {
    await row(page, "b").click();
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    const field = page.getByPlaceholder(/page name/i).first();
    if (await field.count()) { await field.focus(); await page.keyboard.press("Alt+ArrowDown"); }
    expect(await childIds(page, "S1")).toEqual(["a", "b", "C", "d"]);
  });
});

test.describe("adding things with the keyboard", () => {
  test.beforeEach(async ({ page }) => setup(page));

  test("Enter on a palette item adds it at the end of the page; Shift+Enter adds it next to the selected item", async ({ page }) => {
    await page.getByRole("tab", { name: "Blocks", exact: true }).click();
    await row(page, "S1").count(); // (the Layers tab is no longer shown)
    await page.evaluate(() => (window as any).__editor.getState().select("b"));
    await page.getByRole("button", { name: "Heading", exact: true }).focus();
    await page.keyboard.press("Shift+Enter");
    const after = await childIds(page, "S1");
    expect(after.slice(0, 2)).toEqual(["a", "b"]);
    expect(after).toHaveLength(5);
    expect(await node<string>(page, after[2]!, "n.type")).toBe("heading"); // right after the selected "b"
    await expect(live(page)).toContainText("Added Heading after text.");
    // plain Enter: a new section at the end of the page
    await page.getByRole("button", { name: "Divider", exact: true }).focus();
    await page.keyboard.press("Enter");
    expect(await state<number>(page, "(s) => s.project.pages[0].nodes.length")).toBe(3);
    await expect(live(page)).toContainText("at the end of the page");
  });

  test("Shift+Enter with a container selected puts the item inside it", async ({ page }) => {
    await page.getByRole("tab", { name: "Blocks", exact: true }).click();
    await page.evaluate(() => (window as any).__editor.getState().select("C"));
    await page.getByRole("button", { name: "Link", exact: true }).focus();
    await page.keyboard.press("Shift+Enter");
    expect((await childIds(page, "C")).length).toBe(3);
    await expect(live(page)).toContainText("inside container");
  });

  test("with nothing selected, Shift+Enter behaves like Enter (end of the page)", async ({ page }) => {
    await page.getByRole("tab", { name: "Blocks", exact: true }).click();
    await page.evaluate(() => (window as any).__editor.getState().select(null));
    await page.getByRole("button", { name: "Heading", exact: true }).focus();
    await page.keyboard.press("Shift+Enter");
    expect(await state<number>(page, "(s) => s.project.pages[0].nodes.length")).toBe(3);
  });

  test("palette items tell screen readers what really works (the drag sensor is pointer-only)", async ({ page }) => {
    await page.getByRole("tab", { name: "Blocks", exact: true }).click();
    const id = await page.getByRole("button", { name: "Heading", exact: true }).getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    const text = await page.locator(`#${id}`).textContent();
    expect(text).toContain("Press Enter to add this to the page");
    expect(text).toContain("Alt with the arrow keys");
    expect(text).not.toMatch(/space bar|pick up/i); // the library's default text promised a keyboard drag that doesn't exist
  });
});

test.describe("photo layers can be nudged with the arrow keys", () => {
  test("arrow keys move a selected layer by 1%, Shift by 10%, and are clamped", async ({ page }) => {
    await page.goto("/");
    await expect(frame(page).locator("h1")).toBeVisible();
    await page.getByRole("tab", { name: "Elements", exact: true }).click();
    await page.getByRole("button", { name: /^Photo layers \(/ }).click();
    await page.getByRole("button", { name: "Photo with badge", exact: true }).click();
    const layerId = await page.evaluate(() => { let g: any; (function f(ns: any[]) { for (const n of ns) { if (n.type === "layerGroup") g = n; if (n.children) f(n.children); } })((window as any).__editor.getState().project.pages[0].nodes); return g.children[1].id; });
    await page.evaluate((i) => (window as any).__editor.getState().select(i), layerId);
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.evaluate((i) => (window as any).__editor.getState().select(i), layerId);
    const x0 = await node<number>(page, layerId, "n.place.x");
    const y0 = await node<number>(page, layerId, "n.place.y");
    await page.keyboard.press("ArrowRight");
    expect(await node<number>(page, layerId, "n.place.x")).toBe(x0 + 1);
    await page.keyboard.press("Shift+ArrowDown");
    expect(await node<number>(page, layerId, "n.place.y")).toBe(y0 + 10);
    await expect(live(page)).toContainText("from the left");
    await page.keyboard.press("Control+z");
    expect(await node<number>(page, layerId, "n.place.y")).toBe(y0);
    for (let i = 0; i < 25; i++) await page.keyboard.press("Shift+ArrowLeft");
    expect(await node<number>(page, layerId, "n.place.x")).toBe(-50); // held to the allowed range
    await expect(live(page)).toContainText("edge");
  });

  test("an ordinary element ignores plain arrow keys (so scrolling and tree navigation aren't hijacked)", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => (window as any).__editor.getState().select("b"));
    const before = await state<string>(page, "(s) => JSON.stringify(s.project)");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    expect(await state<string>(page, "(s) => JSON.stringify(s.project)")).toBe(before);
  });
});

test.describe("visible focus", () => {
  test("keyboard focus shows a clear ring on buttons, tabs and tree rows", async ({ page }) => {
    await setup(page);
    const ring = (sel: string) => page.locator(sel).first().evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
    await page.keyboard.press("Tab"); // keyboard use switches :focus-visible on
    await row(page, "S1").focus();
    expect(await ring('[role="treeitem"][data-layer-id="S1"]')).toMatchObject({ style: "solid" });
    expect((await ring('[role="treeitem"][data-layer-id="S1"]')).width).toBeGreaterThanOrEqual(2);
    await page.getByRole("tab", { name: "Elements", exact: true }).focus();
    expect((await ring('[data-rail="elements"]')).width).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Export" }).focus();
    expect((await ring("header button:has-text('Export')")).width).toBeGreaterThanOrEqual(2);
  });

  test("a mouse click doesn't leave a ring behind", async ({ page }) => {
    await setup(page);
    await row(page, "b").click();
    const w = await row(page, "b").evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(w).toBe("none");
  });
});

test.describe("existing mouse behaviour is untouched", () => {
  test("clicking selects, the row buttons work, and the tree still renders every node", async ({ page }) => {
    await setup(page);
    await row(page, "c2").click();
    expect(await selected(page)).toBe("c2");
    await expect(page.locator('[role="treeitem"]')).toHaveCount(9); // S1, a, b, C, c1, c2, d, S2, e
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await row(page, "d").click();
    await row(page, "d").getByRole("button", { name: "Move up" }).click();
    expect(await childIds(page, "S1")).toEqual(["a", "b", "d", "C"]);
    expect(errors).toEqual([]);
  });
});
