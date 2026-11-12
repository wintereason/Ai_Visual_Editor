import { expect, test, type Page } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
});

async function addHeading(page: Page) {
  await page.getByRole("button", { name: "Heading" }).click();
  const h = frame(page).locator("h2", { hasText: "New heading" });
  await expect(h).toBeVisible();
  return h;
}
const lastNodeProps = (page: Page) => state<Record<string, unknown>>(page, "s => { const n = s.project.pages[0].nodes; return n[n.length-1].children[0].props; }");
const pastLen = (page: Page) => state<number>(page, "s => s.past.length");

test.describe("inline text editing", () => {
  test("double-click edits in place; Enter commits as ONE undoable change", async ({ page }) => {
    const h = await addHeading(page);
    const before = await pastLen(page);
    await h.dblclick();
    await expect(h).toHaveAttribute("contenteditable", "true");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Hello from the canvas");
    await page.keyboard.press("Enter");
    await expect(frame(page).locator("h2", { hasText: "Hello from the canvas" })).toBeVisible();
    expect((await lastNodeProps(page)).text).toBe("Hello from the canvas");
    expect(await pastLen(page)).toBe(before + 1); // typing 21 characters is a single history step
    await expect(frame(page).locator("[contenteditable]")).toHaveCount(0);

    await page.getByRole("button", { name: /Undo/ }).click();
    expect((await lastNodeProps(page)).text).toBe("New heading");
  });

  test("Escape cancels with no change and no history entry", async ({ page }) => {
    const h = await addHeading(page);
    const before = await pastLen(page);
    await h.dblclick();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Discard me");
    await page.keyboard.press("Escape");
    await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
    expect((await lastNodeProps(page)).text).toBe("New heading");
    expect(await pastLen(page)).toBe(before);
  });

  test("clicking inside the text while editing keeps the edit (does not re-render or reselect)", async ({ page }) => {
    const h = await addHeading(page);
    await h.dblclick();
    await h.click(); // caret placement click
    await expect(h).toHaveAttribute("contenteditable", "true");
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.keyboard.press("Enter");
    expect((await lastNodeProps(page)).text).toBe("New heading!");
  });

  test("blurring (clicking elsewhere) commits; unchanged text makes no history entry", async ({ page }) => {
    const h = await addHeading(page);
    const before = await pastLen(page);
    await h.dblclick();
    await page.locator("aside").first().click({ position: { x: 5, y: 5 } }); // blur without typing
    expect(await pastLen(page)).toBe(before);
    await h.dblclick();
    await page.keyboard.press("End");
    await page.keyboard.type(" v2");
    await page.locator("aside").first().click({ position: { x: 5, y: 5 } });
    expect((await lastNodeProps(page)).text).toBe("New heading v2");
  });

  test("line breaks collapse to spaces and button labels are limited to 80 characters", async ({ page }) => {
    const h = await addHeading(page);
    await h.dblclick();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Line one");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("line two");
    await page.keyboard.press("Enter");
    expect(((await lastNodeProps(page)).text as string).includes("\n")).toBe(false);

    await page.getByRole("button", { name: "Button", exact: true }).click();
    const b = frame(page).locator("a.avc-btn", { hasText: "Click me" });
    await b.dblclick();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("x".repeat(120));
    await page.keyboard.press("Enter");
    expect(((await lastNodeProps(page)).label as string).length).toBe(80);
  });

  test("blocks are not inline-editable (they are edited in the Inspector)", async ({ page }) => {
    await frame(page).locator("h1").dblclick();
    await expect(frame(page).locator("[contenteditable]")).toHaveCount(0);
  });

  test("pasted content is inserted as plain text, never as markup", async ({ page }) => {
    const h = await addHeading(page);
    await h.dblclick();
    await page.keyboard.press("Control+A");
    await h.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData("text/html", "<img src=x onerror=alert(1)><b>bold</b>");
      dt.setData("text/plain", "plain <b>text</b>");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.keyboard.press("Enter");
    expect((await lastNodeProps(page)).text).toBe("plain <b>text</b>"); // literal characters, stored as data
    await expect(frame(page).locator("h2 img, h2 b")).toHaveCount(0);
  });
});

test.describe("keyboard shortcuts work while the canvas has focus", () => {
  test("Delete, Ctrl+Z, Ctrl+D and Alt+Arrow after clicking in the canvas", async ({ page }) => {
    const h = await addHeading(page);
    await h.click(); // focus moves into the iframe
    const headings = frame(page).locator("h2", { hasText: "New heading" });
    await expect(headings).toHaveCount(1);

    await page.keyboard.press("Delete"); // removes the selected heading
    await expect(headings).toHaveCount(0);
    await page.keyboard.press("Control+Z");
    await expect(headings).toHaveCount(1);

    await h.click();
    await page.keyboard.press("Control+D"); // duplicate the heading inside its section
    await expect(frame(page).locator("h2", { hasText: "New heading" })).toHaveCount(2);
    await page.keyboard.press("Control+Z");
    await expect(frame(page).locator("h2", { hasText: "New heading" })).toHaveCount(1);
  });

  test("Alt+Arrow moves a section up and down; Escape deselects", async ({ page }) => {
    await frame(page).locator("h1").click(); // selects the hero block inside sec_hero
    await page.keyboard.press("Escape");
    expect(await state<string | null>(page, "s => s.selection")).toBeNull();

    // select the hero's section through the Layers panel and reorder it
    await page.getByRole("tab", { name: "Layers" }).click();
    await page.getByTestId("layer-sec_hero").click();
    const order = () => state<string[]>(page, "s => s.project.pages[0].nodes.map(n => n.id)");
    expect((await order()).indexOf("sec_hero")).toBe(1);
    await page.locator("body").press("Alt+ArrowDown");
    expect((await order()).indexOf("sec_hero")).toBe(2);
    await page.locator("body").press("Alt+ArrowUp");
    expect((await order()).indexOf("sec_hero")).toBe(1);
    await page.locator("body").press("Alt+ArrowUp");
    await page.locator("body").press("Alt+ArrowUp"); // already first: no-op, no error
    expect((await order())[0]).toBe("sec_hero");
  });

  test("shortcuts are ignored while typing in a form field", async ({ page }) => {
    await page.getByRole("tab", { name: "Pages" }).click();
    const before = await state<number>(page, "s => s.project.pages[0].nodes.length");
    await page.getByLabel("Page name").click();
    await page.keyboard.press("Delete");
    await page.keyboard.press("Control+D");
    expect(await state<number>(page, "s => s.project.pages[0].nodes.length")).toBe(before);
  });
});

test.describe("advanced style panel", () => {
  async function selectNewContainer(page: Page) {
    await page.getByRole("button", { name: "Container", exact: true }).click();
    await page.getByTestId("advanced").locator("summary").click();
    // the container created by the palette (flex row, md gap, md padding)
    return frame(page).locator("div[data-node]:empty").first();
  }
  const css = (el: ReturnType<Page["locator"]>, prop: string) => el.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);

  test("exact per-side padding in px is applied, shows an override dot, and resets", async ({ page }) => {
    const box = await selectNewContainer(page);
    await page.getByLabel("Padding top").fill("40");
    await page.getByLabel("Padding top").blur();
    expect(await css(box, "padding-top")).toBe("40px");
    expect(await css(box, "padding-left")).toBe("16px"); // other sides untouched (token md)
    await expect(page.getByTestId("adv-padding").getByLabel("overridden")).toBeVisible();

    await page.getByRole("button", { name: "Reset Padding" }).click();
    expect(await css(box, "padding-top")).toBe("0px");
    await expect(page.getByTestId("adv-padding").getByLabel("overridden")).toHaveCount(0);
  });

  test("tokens are accepted, nonsense is flagged and never applied", async ({ page }) => {
    const box = await selectNewContainer(page);
    await page.getByLabel("Gap", { exact: true }).fill("xl");
    await page.getByLabel("Gap", { exact: true }).blur();
    expect(await css(box, "column-gap")).toBe("48px");
    const before = await pastLen(page);
    await page.getByLabel("Gap", { exact: true }).fill("banana");
    await page.getByLabel("Gap", { exact: true }).blur();
    expect(await pastLen(page)).toBe(before); // nothing was sent
    await expect(page.getByLabel("Gap", { exact: true })).toHaveCSS("border-color", "rgb(220, 38, 38)");
  });

  test("hover state is edited separately and applies on hover only", async ({ page }) => {
    const box = await selectNewContainer(page);
    await page.getByRole("button", { name: "hover", exact: true }).click();
    await page.getByLabel("Background color", { exact: true }).fill("#ff0000");
    await page.getByLabel("Background color", { exact: true }).blur();
    expect(await css(box, "background-color")).not.toBe("rgb(255, 0, 0)");
    await box.hover();
    await expect.poll(() => css(box, "background-color")).toBe("rgb(255, 0, 0)");

    // normal state is unaffected and shows no dot for background
    await page.getByRole("button", { name: "normal", exact: true }).click();
    await expect(page.getByTestId("adv-background").getByLabel("overridden")).toHaveCount(0);
  });

  test("gradient backgrounds and exact sizes", async ({ page }) => {
    const box = await selectNewContainer(page);
    await page.getByLabel("Gradient from", { exact: true }).fill("#112233");
    await page.getByLabel("Gradient from", { exact: true }).blur();
    await page.getByLabel("Gradient angle").fill("90");
    await page.getByLabel("Gradient angle").blur();
    expect(await css(box, "background-image")).toContain("linear-gradient(90deg");

    await page.getByLabel("Min height", { exact: true }).fill("200");
    await page.getByLabel("Min height", { exact: true }).blur();
    expect(await css(box, "min-height")).toBe("200px");
    await page.getByLabel("Width", { exact: true }).fill("50");
    await page.getByLabel("Width unit", { exact: true }).selectOption("%");
    const w = await box.evaluate((e) => ({ wide: e.getBoundingClientRect().width, parent: e.parentElement!.getBoundingClientRect().width }));
    expect(Math.abs(w.wide / w.parent - 0.5)).toBeLessThan(0.01);
  });

  test("per-device overrides: mobile edits don't change desktop", async ({ page }) => {
    const box = await selectNewContainer(page);
    await page.getByLabel("Padding top").fill("60");
    await page.getByLabel("Padding top").blur();
    await page.getByRole("button", { name: "📱" }).click();
    await expect(page.getByTestId("adv-padding").getByLabel("overridden")).toHaveCount(0); // not set at mobile
    await page.getByLabel("Padding top").fill("8");
    await page.getByLabel("Padding top").blur();
    expect(await css(box, "padding-top")).toBe("8px"); // mobile view shows the override
    await page.getByRole("button", { name: "💻" }).click();
    expect(await css(box, "padding-top")).toBe("60px"); // desktop untouched
    const styles = await state<any>(page, "s => { const n = s.project.pages[0].nodes; return n[n.length-1].children[0].styles; }");
    expect(styles.base.normal.padding.top).toBe(60);
    expect(styles.mobile.normal.padding.top).toBe(8);
  });

  test("out-of-range values are rejected by the schema with a visible message and change nothing", async ({ page }) => {
    await selectNewContainer(page);
    const before = await pastLen(page);
    await page.getByLabel("Opacity").fill("5");
    await page.getByLabel("Opacity").blur();
    await expect(page.getByRole("alert").filter({ hasText: /opacity/i })).toBeVisible();
    expect(await pastLen(page)).toBe(before);
  });

  test("only groups the node supports are offered (a divider has no typography or background)", async ({ page }) => {
    await page.getByRole("button", { name: "Divider" }).click();
    await page.getByTestId("advanced").locator("summary").click();
    await expect(page.getByLabel("Font size")).toHaveCount(0);
    await expect(page.getByLabel("Background color", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Border width")).toBeVisible();
  });
});
