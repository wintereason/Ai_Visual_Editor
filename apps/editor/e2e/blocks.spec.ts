import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { exampleProject, type Project } from "@avc/schema";
import { renderDocument } from "@avc/renderer";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
});

test.describe("new blocks from the palette", () => {
  const cases: [string, string, (f: ReturnType<typeof frame>) => ReturnType<ReturnType<typeof frame>["locator"]>][] = [
    ["Stats", "Our results", (f) => f.locator(".avc-stat")],
    ["Steps", "How it works", (f) => f.locator(".avc-steps li")],
    ["FAQ", "Questions and answers", (f) => f.locator(".avc-faq details")],
    ["Pricing", "Plans", (f) => f.locator(".avc-plan")],
    ["Team", "Meet the team", (f) => f.locator(".avc-member")],
    ["Logo strip", "Trusted by", (f) => f.locator(".avc-logos li")],
    ["CTA banner", "Ready to get started?", (f) => f.locator(".avc-cta")],
    ["Gallery", "Gallery", (f) => f.locator(".avc-gallery figure")],
  ];
  for (const [label, heading, items] of cases) {
    test(`${label} adds, renders its content, and is a single undoable step`, async ({ page }) => {
      const before = await state<number>(page, "s => s.past.length");
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(frame(page).getByText(heading, { exact: true }).first()).toBeVisible();
      expect(await items(frame(page)).count()).toBeGreaterThan(0);
      expect(await state<number>(page, "s => s.past.length")).toBe(before + 1);
      await page.getByRole("button", { name: /Undo/ }).click();
      await expect(frame(page).getByText(heading, { exact: true })).toHaveCount(0);
    });
  }

  test("a variant switch in the Inspector changes the layout", async ({ page }) => {
    await page.getByRole("button", { name: "Stats", exact: true }).click();
    await page.getByRole("combobox").first().selectOption("cards");
    await expect(frame(page).locator(".avc-stats-cards")).toHaveCount(1);
  });

  test("in the editor FAQ answers are shown expanded so they can be read and edited", async ({ page }) => {
    await page.getByRole("button", { name: "FAQ", exact: true }).click();
    await expect(frame(page).locator(".avc-faq details[open]")).toHaveCount(2);
    await expect(frame(page).getByText("Everything you need to get started.")).toBeVisible();
  });

  test("a block with invalid data is refused with a message and not applied", async ({ page }) => {
    await page.getByRole("button", { name: "Pricing", exact: true }).click();
    const before = await state<number>(page, "s => s.past.length");
    // an unsafe link in a plan's button (edited through the list editor)
    const f2 = page.getByLabel("plans 1 ctaHref", { exact: true });
    await f2.fill("javascript:alert(1)");
    await f2.blur();
    await expect(page.getByRole("alert").filter({ hasText: /url must be/i })).toBeVisible();
    expect(await state<number>(page, "s => s.past.length")).toBe(before);
  });
});

test.describe("gallery with uploaded images", () => {
  test("clicking a library image adds it to the selected gallery; export demands alt text, then ships the file", async ({ page }) => {
    await page.getByRole("button", { name: "Gallery", exact: true }).click();
    const galleryId = await state<string>(page, "s => s.selection");
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Upload images").setInputFiles([{ name: "campus.png", mimeType: "image/png", buffer: PNG_1PX }]);
    await expect(page.getByTestId("asset-campus")).toBeVisible();

    await page.getByTestId("asset-campus").getByRole("button").first().click(); // gallery is selected, so it is appended there
    const images = await state<any[]>(page, `s => { const f = (ns) => { for (const n of ns) { if (n.id === '${galleryId}') return n.props.images; const r = f(n.children||[]); if (r) return r; } }; return f(s.project.pages[0].nodes); }`);
    expect(images).toHaveLength(4);
    expect(images[3].assetId).toMatch(/^asset_/);
    expect(images[3].alt).toBe(""); // not guessed: the owner has to describe it

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("dialog")).toContainText("gallery");
    await expect(page.getByRole("dialog")).toContainText("no alt text");
    await expect(page.getByRole("button", { name: /Download/ })).toBeDisabled();
    await page.getByRole("button", { name: "Close" }).click();

    // describe the image, then export
    await page.evaluate(({ id }) => {
      const st = (window as any).__editor.getState();
      const find = (ns: any[]): any => { for (const n of ns) { if (n.id === id) return n; const r = find(n.children ?? []); if (r) return r; } };
      const g = find(st.project.pages[0].nodes);
      st.commit({ summary: "alt", ops: [{ op: "update", id, props: { images: g.props.images.map((i: any) => ({ ...i, alt: i.alt || "Our campus" })) } }] });
    }, { id: galleryId });
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("dialog")).not.toContainText("no alt text");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download/ }).click()]);
    const files = unzipSync(new Uint8Array(readFileSync((await dl.path())!)));
    const assetFiles = Object.keys(files).filter((f) => f.startsWith("assets/"));
    expect(assetFiles).toHaveLength(1); // only the image the gallery uses
    const html = strFromU8(files["index.html"]!);
    expect(html).toContain(`src="/${assetFiles[0]}"`);
    expect(html).toContain('alt="Our campus"');
  });
});

test.describe("animation panel: new presets", () => {
  test("text effects are offered on headings and text only", async ({ page }) => {
    await page.getByRole("button", { name: "Heading" }).click();
    await frame(page).locator("h2", { hasText: "New heading" }).click();
    await page.getByRole("tab", { name: "Animate" }).click();
    for (const p of ["word-by-word", "typewriter", "shimmer", "reveal", "hover-tilt"]) await expect(page.getByTestId(`anim-${p}`)).toBeVisible();

    await page.getByRole("button", { name: "Stats", exact: true }).click(); // a block: text effects do not apply
    await expect(page.getByTestId("anim-reveal")).toBeVisible();
    await expect(page.getByTestId("anim-hover-tilt")).toBeVisible();
    for (const p of ["word-by-word", "typewriter", "shimmer"]) await expect(page.getByTestId(`anim-${p}`)).toHaveCount(0);
  });

  test("word-by-word splits the words; Play animates them with a stagger, then stops", async ({ page }) => {
    await page.getByRole("button", { name: "Heading" }).click();
    await frame(page).locator("h2", { hasText: "New heading" }).click();
    await page.getByRole("tab", { name: "Animate" }).click();
    await page.getByTestId("anim-word-by-word").click();
    const words = frame(page).locator("h2 .avc-w");
    await expect(words).toHaveCount(2);
    // idle in the editor: no animation
    expect(await words.first().evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
    await page.getByRole("button", { name: /Play/ }).click();
    await expect.poll(() => words.nth(1).evaluate((e) => getComputedStyle(e).animationName)).toBe("avc-slide-up");
    expect(await words.nth(1).evaluate((e) => getComputedStyle(e).animationDelay)).not.toBe(await words.nth(0).evaluate((e) => getComputedStyle(e).animationDelay)); // staggered
    await expect.poll(() => words.first().evaluate((e) => getComputedStyle(e).animationName), { timeout: 12_000 }).toBe("none");
    // the stored text is untouched: still one string, not split
    const text = await state<string>(page, "s => { const n = s.project.pages[0].nodes; return n[n.length-1].children[0].props.text; }");
    expect(text).toBe("New heading");
  });
});

// ---- published-page behaviour in a real browser ----
function tall(preset: string, extra: Record<string, unknown> = {}): Project {
  const p = structuredClone(exampleProject);
  p.pages[0]!.nodes.splice(2, 0, { id: "sec_gap", kind: "container", type: "section", props: {}, children: [{ id: "gap", kind: "element", type: "spacer", props: {}, styles: { base: { normal: { minHeight: { value: 3000, unit: "px" } } } } }] });
  p.pages[0]!.nodes[3]!.children!.push({ id: "fx", kind: "element", type: "heading", props: { text: "Learn skills that get you hired", level: 2 }, animation: { preset: preset as never, trigger: "scroll", ...extra } });
  return p;
}

test.describe("published page: new effects", () => {
  test("typewriter is collapsed until scrolled into view, then types out", async ({ page }) => {
    await page.setContent(renderDocument(tall("typewriter"), "page_home"));
    const el = page.locator('[data-node="fx"]');
    await expect(page.locator("html")).toHaveClass(/avc-js/);
    expect(await el.evaluate((e) => getComputedStyle(e).maxWidth)).toBe("0px");
    await el.scrollIntoViewIfNeeded();
    await expect(el).toHaveClass(/avc-in/);
    await expect.poll(() => el.evaluate((e) => getComputedStyle(e).maxWidth), { timeout: 12_000 }).not.toBe("0px");
    expect(await el.evaluate((e) => (e as HTMLElement).scrollWidth)).toBeGreaterThan(50); // text is really there
  });

  test("word-by-word: words hidden before reveal, all visible afterwards", async ({ page }) => {
    await page.setContent(renderDocument(tall("word-by-word"), "page_home"));
    const words = page.locator('[data-node="fx"] .avc-w');
    await expect(words).toHaveCount(6); // "Learn skills that get you hired"
    for (let i = 0; i < 6; i++) expect(await words.nth(i).evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    await page.locator('[data-node="fx"]').scrollIntoViewIfNeeded();
    await expect.poll(async () => (await words.evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity))).every((o) => o === "1"), { timeout: 12_000 }).toBe(true);
  });

  test("wipe (reveal) uses a clip-path that opens up", async ({ page }) => {
    await page.setContent(renderDocument(tall("reveal"), "page_home"));
    const el = page.locator('[data-node="fx"]');
    expect(await el.evaluate((e) => getComputedStyle(e).opacity)).toBe("0");
    await el.scrollIntoViewIfNeeded();
    await expect.poll(() => el.evaluate((e) => getComputedStyle(e).opacity), { timeout: 12_000 }).toBe("1");
  });

  for (const preset of ["typewriter", "word-by-word", "reveal", "shimmer"]) {
    test(`reduced-motion visitors see ${preset} text immediately and fully`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setContent(renderDocument(tall(preset, preset === "shimmer" ? { trigger: "load" } : {}), "page_home"));
      const el = page.locator('[data-node="fx"]');
      const s = await el.evaluate((e) => {
        const c = getComputedStyle(e);
        return { opacity: c.opacity, maxWidth: c.maxWidth, clip: c.clipPath, anim: c.animationName, color: c.color };
      });
      expect(s.opacity).toBe("1");
      expect(s.maxWidth).not.toBe("0px");
      expect(s.clip).toBe("none");
      expect(s.anim).toBe("none");
      expect(s.color).not.toBe("rgba(0, 0, 0, 0)"); // shimmer's transparent text must not stay invisible
      if (preset === "word-by-word") {
        const ops = await el.locator(".avc-w").evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
        expect(ops.every((o) => o === "1")).toBe(true);
      }
    });
  }

  test("a published FAQ is collapsed by default and opens and closes natively, with JavaScript off", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    const p = structuredClone(exampleProject);
    p.pages[0]!.nodes[2]!.children!.push({ id: "faq", kind: "block", type: "faq", variant: "simple", props: { items: [{ question: "Is it free?", answer: "Yes, entirely." }] } });
    await page.setContent(renderDocument(p, "page_home"));
    const d = page.locator("details").first();
    await expect(page.getByText("Yes, entirely.")).toBeHidden();
    await d.locator("summary").click();
    await expect(page.getByText("Yes, entirely.")).toBeVisible();
    await d.locator("summary").click();
    await expect(page.getByText("Yes, entirely.")).toBeHidden();
    await ctx.close();
  });

  test("with JavaScript disabled, nothing stays hidden", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    for (const preset of ["typewriter", "word-by-word", "reveal"]) {
      await page.setContent(renderDocument(tall(preset), "page_home"));
      const el = page.locator('[data-node="fx"]');
      expect(await el.evaluate((e) => getComputedStyle(e).opacity), preset).toBe("1");
      expect(await el.evaluate((e) => getComputedStyle(e).maxWidth), preset).not.toBe("0px");
    }
    await ctx.close();
  });
});
