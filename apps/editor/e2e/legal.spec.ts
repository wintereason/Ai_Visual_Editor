import { expect, test, type Page } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("tab", { name: "Pages" }).click();
  await page.getByRole("button", { name: /Add legal pages/ }).click();
});

test("starter pages are added with the site's own navbar and footer, linked from every footer, and undoable in one step", async ({ page }) => {
  const before = await state<number>(page, "s => s.project.pages.length");
  await expect(page.getByTestId("legal-pages")).toContainText("not legal advice");
  const add = page.getByRole("button", { name: /^Add \d* ?pages?$/ });
  await expect(add).toBeDisabled(); // needs a valid email
  await page.getByLabel("Contact email").fill("nope");
  await expect(page.getByTestId("legal-pages")).toContainText("valid email");
  await page.getByLabel("Contact email").fill("hello@brightpath.example");
  await page.getByLabel("Refund and Cancellation Policy").check();
  await add.click();

  expect(await state<string[]>(page, "s => s.project.pages.map(p => p.path)")).toEqual(expect.arrayContaining(["/privacy", "/terms", "/refunds"]));
  expect(await state<number>(page, "s => s.project.pages.length")).toBe(before + 3);
  // the new pages have the home page's navbar first and a footer last, around the legal text
  const shape = await state<string[][]>(page, "s => s.project.pages.filter(p => ['/privacy','/terms','/refunds'].includes(p.path)).map(p => p.nodes.map(n => n.children?.[0]?.type ?? n.type))");
  for (const nodes of shape) { expect(nodes[0]).toBe("navbar"); expect(nodes[nodes.length - 1]).toBe("footer"); }
  // every footer links to all three legal pages, without duplicates
  const footerLinks = await state<string[][]>(page, "s => s.project.pages.map(p => { const f = p.nodes.flatMap(n => n.children ?? []).find(c => c.type === 'footer'); return f ? f.props.links.map(l => l.href) : null; }).filter(Boolean)");
  expect(footerLinks.length).toBeGreaterThan(3);
  for (const links of footerLinks) { expect(links).toEqual(expect.arrayContaining(["/privacy", "/terms", "/refunds"])); expect(new Set(links).size).toBe(links.length); }
  // the business name and email are in the text; the canvas shows the new page
  await expect(frame(page).locator("h1", { hasText: "Privacy Policy" })).toBeVisible();
  await expect(frame(page).getByText("hello@brightpath.example").first()).toBeVisible();
  // one undo removes all of it, including the footer links
  await page.evaluate(() => (window as any).__editor.getState().undo());
  expect(await state<number>(page, "s => s.project.pages.length")).toBe(before);
  const after = await state<string[][]>(page, "s => s.project.pages.map(p => { const f = p.nodes.flatMap(n => n.children ?? []).find(c => c.type === 'footer'); return f ? f.props.links.map(l => l.href) : []; })");
  expect(after.some((l) => l.includes("/privacy"))).toBe(false);
});

test("the export is blocked until the blanks are filled and the notice is deleted", async ({ page }) => {
  await page.getByLabel("Contact email").fill("hello@brightpath.example");
  await page.getByRole("button", { name: /^Add \d* ?pages?$/ }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog).toContainText("starter-text notice");
  await expect(dialog).toContainText("blanks to fill in");
  await expect(dialog.getByRole("button", { name: /Download \.zip/ })).toBeDisabled();

  // a person reviews it: fill the blanks, delete the notice
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.evaluate(() => {
    const s = (window as any).__editor.getState();
    const ops: any[] = [];
    const walk = (nodes: any[]) => { for (const n of nodes) { if (n.id.startsWith("legal_notice")) ops.push({ op: "remove", id: n.id }); else if (typeof n.props?.text === "string" && /\[\[/.test(n.props.text)) ops.push({ op: "update", id: n.id, props: { text: n.props.text.replace(/\[\[[^\]]*\]\]/g, "30") } }); if (n.children) walk(n.children); } };
    for (const p of s.project.pages) walk(p.nodes);
    for (let i = 0; i < ops.length; i += 20) s.commit({ summary: "Review legal pages", ops: ops.slice(i, i + 20) });
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Export" })).not.toContainText("starter-text notice");
  await expect(page.getByRole("dialog", { name: "Export" })).not.toContainText("blanks to fill in");
});

test("a page that already exists isn't added twice", async ({ page }) => {
  await page.getByLabel("Contact email").fill("hello@brightpath.example");
  await page.getByRole("button", { name: /^Add \d* ?pages?$/ }).click();
  await page.getByRole("tab", { name: "Pages" }).click();
  await expect(page.getByLabel("Privacy Policy")).toBeDisabled();
  await expect(page.getByTestId("legal-pages")).toContainText("(already added)");
});
