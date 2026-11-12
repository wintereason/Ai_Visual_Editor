import { expect, test, type Page } from "@playwright/test";
import { animMeta, exampleProject, type Project } from "@avc/schema";
import { renderDocument } from "@avc/renderer";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");

/** The example page with 3000px of space, then a heading carrying the animation under test. */
function tall(preset: string, extra: Record<string, unknown> = {}): Project {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes.splice(2, 0, { id: "sec_gap", kind: "container", type: "section", props: {}, children: [{ id: "gap", kind: "element", type: "spacer", props: {}, styles: { base: { normal: { minHeight: { value: 3000, unit: "px" } } } } }] });
  p.pages[0]!.nodes[3]!.children!.push({ id: "fx", kind: "element", type: "heading", props: { text: "Admissions open for the new batch", level: 2 }, animation: { preset: preset as never, ...extra } });
  return p;
}
const fx = (page: Page) => page.locator('[data-node="fx"]');
const indent = (page: Page) => fx(page).evaluate((e) => parseFloat(getComputedStyle(e).textIndent));

test.describe("marquee (published)", () => {
  test("the text crosses its box continuously, and keeps moving", async ({ page }) => {
    await page.setContent(renderDocument(tall("marquee"), "page_home"));
    expect(await fx(page).evaluate((e) => getComputedStyle(e).animationName)).toBe("avc-marquee");
    expect(await fx(page).evaluate((e) => getComputedStyle(e).whiteSpace)).toBe("nowrap");
    const a = await indent(page);
    await page.waitForTimeout(500);
    const b = await indent(page);
    await page.waitForTimeout(500);
    const c = await indent(page);
    expect(b).not.toBe(a);
    expect(c).not.toBe(b);
    expect(b).toBeLessThan(a); // moving left
  });
  test("the duration setting is the speed: a larger value is slower", async ({ page }) => {
    const speed = async (ms: number) => {
      await page.setContent(renderDocument(tall("marquee", { durationMs: ms }), "page_home"));
      const a = await indent(page);
      await page.waitForTimeout(400);
      return Math.abs((await indent(page)) - a);
    };
    const fast = await speed(300);
    const slow = await speed(3000);
    expect(fast).toBeGreaterThan(slow * 3);
  });
  test("reduced-motion visitors get still, fully readable text", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setContent(renderDocument(tall("marquee"), "page_home"));
    const s = await fx(page).evaluate((e) => { const c = getComputedStyle(e); return { anim: c.animationName, indent: c.textIndent, ws: c.whiteSpace }; });
    expect(s.anim).toBe("none");
    expect(parseFloat(s.indent)).toBe(0);
    expect(s.ws).toBe("normal"); // wraps, so every word can be read
  });
  test("it is only offered for text", async ({ page }) => {
    expect(animMeta("marquee")?.only).toEqual(["heading", "text"]);
    await page.goto("/");
    await expect(frame(page).locator("h1")).toBeVisible();
    await frame(page).locator("h1").click();
    await page.getByRole("tab", { name: "Animate" }).click();
    await expect(page.getByRole("button", { name: "Marquee" })).toHaveCount(0); // the hero block is not text
  });
});

test.describe("parallax (published)", () => {
  const ty = (page: Page) => fx(page).evaluate((e) => { const m = /matrix\(.*?,\s*.*?,\s*.*?,\s*.*?,\s*(-?[\d.]+),\s*(-?[\d.]+)\)/.exec(getComputedStyle(e).transform); return m ? parseFloat(m[2]!) : 0; });

  test("the element drifts as the page scrolls, and the drift follows the scroll", async ({ page }) => {
    await page.setContent(renderDocument(tall("parallax"), "page_home"));
    await page.evaluate(() => window.scrollTo(0, 0));
    await fx(page).scrollIntoViewIfNeeded();
    // the heading is near the bottom of the page, so scroll UP: the element then sits lower in the window and drifts further
    await page.evaluate(() => window.scrollBy(0, -150));
    await expect.poll(() => ty(page)).not.toBe(0);
    const a = await ty(page);
    await page.evaluate(() => window.scrollBy(0, -150));
    await expect.poll(() => ty(page)).not.toBe(a);
    expect(await ty(page)).toBeLessThan(a);
  });
  test("it never hides content and never loads far-off elements' transforms before they are near", async ({ page }) => {
    await page.setContent(renderDocument(tall("parallax"), "page_home"));
    expect(await fx(page).evaluate((e) => getComputedStyle(e).opacity)).toBe("1"); // parallax is not a reveal
    expect(await ty(page)).toBe(0); // 3000px away: not touched yet
  });
  test("reduced-motion visitors get no movement at all", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setContent(renderDocument(tall("parallax"), "page_home"));
    await fx(page).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    await page.waitForTimeout(300);
    expect(await ty(page)).toBe(0);
    expect(await fx(page).evaluate((e) => (e as HTMLElement).style.transform)).toBe("");
  });
  test("without JavaScript the page is fully visible and still", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.setContent(renderDocument(tall("parallax"), "page_home"));
    expect(await fx(page).evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    expect(await ty(page)).toBe(0);
    await ctx.close();
  });
});

test.describe("in the editor canvas", () => {
  test("marquee and parallax hold still while editing, and the panel explains parallax", async ({ page }) => {
    await page.goto("/");
    await expect(frame(page).locator("h1")).toBeVisible();
    await page.getByRole("button", { name: "Heading" }).click();
    const heading = frame(page).locator("h2", { hasText: "New heading" });
    await expect(heading).toBeVisible();
    const id = await page.evaluate(() => (window as any).__editor.getState().selection as string);
    for (const preset of ["marquee", "parallax"]) {
      await page.evaluate(([nid, p]) => (window as any).__editor.getState().commit({ summary: "anim", ops: [{ op: "update", id: nid, animation: { preset: p } }] }), [id, preset]);
      await expect(heading).toHaveAttribute("data-anim", preset);
      await expect(heading).toHaveClass(/avc-still/);
      const s = await heading.evaluate((e) => { const c = getComputedStyle(e); return { anim: c.animationName, indent: c.textIndent, transform: c.transform }; });
      expect(s.anim).toBe("none");
      expect(parseFloat(s.indent)).toBe(0);
      expect(s.transform).toBe("none");
    }
    await page.getByRole("tab", { name: "Animate" }).click();
    await expect(page.getByText("Moves as the visitor scrolls")).toBeVisible();
    await expect(page.getByRole("button", { name: /Play/ })).toBeDisabled();
  });
});
