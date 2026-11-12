import { expect, test, type Page } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
});

async function signIn(page: Page, email = "dev@example.com") {
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
}
const openCreate = (page: Page) => page.getByRole("tab", { name: "✦ Create" }).click();
const credits = { charged: true, cost: 1 };
const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

test("signed out: explains and cannot send", async ({ page }) => {
  await openCreate(page);
  await expect(page.getByTestId("create-signin")).toBeVisible();
  await page.getByLabel("Describe the element").fill("a card");
  await expect(page.getByRole("button", { name: /Suggest 3 options/ })).toBeDisabled();
});

test("element creator: options are previewed in a sandbox, inserted with fresh ids, and undoable", async ({ page }) => {
  await signIn(page);
  const tree = (t: string) => ({ id: "x1", kind: "element", type: "heading", props: { text: t, level: 2 } });
  await page.route("**/api/ai/element", (r) => r.fulfill(json({ ok: true, options: [{ name: "Plain", tree: tree("One") }, { name: "Bold", tree: tree("Two") }], dropped: 0, attempts: 1, credits })));
  await openCreate(page);
  await page.getByLabel("Describe the element").fill("a heading");
  await page.getByRole("button", { name: /Suggest 3 options/ }).click();
  await expect(page.getByTestId("element-option")).toHaveCount(2);
  await expect(page.locator("iframe[title=Preview]").first()).toHaveAttribute("sandbox", "");
  const before = await state<number>(page, "s => s.project.pages[0].nodes.length");
  await page.getByRole("button", { name: "Add to page" }).first().click();
  await page.getByRole("button", { name: "Add to page" }).first().click(); // same option twice: ids must not collide
  expect(await state<number>(page, "s => s.project.pages[0].nodes.length")).toBe(before + 2);
  expect(await state<boolean>(page, "s => { const a = s.project.pages[0].nodes.slice(-2).map(n => n.children[0].id); return a[0] !== a[1] && !a.includes('x1'); }")).toBe(true);
  expect(await state<string | null>(page, "s => s.error")).toBeNull();
  await page.evaluate(() => (window as any).__editor.getState().undo());
  expect(await state<number>(page, "s => s.project.pages[0].nodes.length")).toBe(before + 1);
});

test("element creator: server errors are shown and nothing changes", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/ai/element", (r) => r.fulfill(json({ ok: false, code: "insufficient_credits", message: "You're out of AI credits." }, 402)));
  await openCreate(page);
  await page.getByLabel("Describe the element").fill("a heading");
  const before = await state<number>(page, "s => s.past.length");
  await page.getByRole("button", { name: /Suggest 3 options/ }).click();
  await expect(page.getByTestId("create-error")).toContainText("out of AI credits");
  expect(await state<number>(page, "s => s.past.length")).toBe(before);
});

test.describe("site builder", () => {
  /** Layout returns the current project with a new name and a second page; build_page returns that page with new text. */
  async function mock(page: Page, failPage?: { id: string; times: number }) {
    const layout = await page.evaluate(() => {
      const p = JSON.parse(JSON.stringify((window as any).__editor.getState().project));
      p.name = "AI Site";
      p.pages.push({ id: "pg2", name: "About", path: "/about", nodes: [{ id: "s2", kind: "container", type: "section", props: {}, children: [{ id: "h2", kind: "element", type: "heading", props: { text: "placeholder", level: 1 } }] }] });
      return p;
    });
    const calls: string[] = [];
    let fails = failPage?.times ?? 0;
    await page.route("**/api/ai/layout", (r) => r.fulfill(json({ ok: true, project: layout, attempts: 1, credits })));
    await page.route("**/api/ai/build_page", (r) => {
      const b = r.request().postDataJSON();
      calls.push(b.pageId);
      if (failPage && b.pageId === failPage.id && fails-- > 0) return r.fulfill(json({ ok: false, code: "provider", message: "The AI service is busy. Please try again in a moment." }, 503));
      const pg = JSON.parse(JSON.stringify(b.project.pages.find((p: any) => p.id === b.pageId)));
      if (pg.id === "pg2") pg.nodes[0].children[0].props.text = "Written about us";
      return r.fulfill(json({ ok: true, page: pg, attempts: 1, credits }));
    });
    return calls;
  }
  const start = async (page: Page) => {
    await openCreate(page);
    await page.getByRole("button", { name: "A whole site" }).click();
    await page.getByLabel("Describe the website").fill("a coaching class site");
    await page.getByRole("button", { name: "✦ Design layout" }).click();
    await expect(page.getByTestId("site-page")).toHaveCount(2);
  };

  test("design, approve, build each page, then apply; nothing changes before apply; undo restores", async ({ page }) => {
    await signIn(page);
    const calls = await mock(page);
    const name0 = await state<string>(page, "s => s.project.name");
    await start(page);
    expect(await state<string>(page, "s => s.project.name")).toBe(name0); // review is a draft only
    await page.getByRole("button", { name: /Approve/ }).click();
    await expect(page.getByTestId("page-status")).toHaveText(["✔ Done", "✔ Done"]);
    expect(calls[1]).toBe("pg2");
    await page.getByRole("button", { name: "Use this site" }).click();
    await expect(page.getByTestId("site-applied")).toBeVisible();
    expect(await state<string>(page, "s => s.project.name")).toBe("AI Site");
    expect(await state<string>(page, "s => s.project.pages[1].nodes[0].children[0].props.text")).toBe("Written about us");
    await page.evaluate(() => (window as any).__editor.getState().undo());
    expect(await state<string>(page, "s => s.project.name")).toBe(name0);
  });

  test("a failed page can be retried alone", async ({ page }) => {
    await signIn(page);
    const calls = await mock(page, { id: "pg2", times: 1 });
    await start(page);
    await page.getByRole("button", { name: /Approve/ }).click();
    await expect(page.getByTestId("page-status").nth(1)).toHaveText("✖ Failed");
    await expect(page.getByTestId("page-status").nth(0)).toHaveText("✔ Done");
    const n = calls.length;
    await page.getByRole("button", { name: /Retry 1 page/ }).click();
    await expect(page.getByTestId("page-status").nth(1)).toHaveText("✔ Done");
    expect(calls.slice(n)).toEqual(["pg2"]); // only the failed page was asked for again
  });

  test("out of credits stops the build instead of failing every page", async ({ page }) => {
    await signIn(page);
    await mock(page);
    await page.route("**/api/ai/build_page", (r) => r.fulfill(json({ ok: false, code: "insufficient_credits", message: "You're out of AI credits." }, 402)));
    await start(page);
    await page.getByRole("button", { name: /Approve/ }).click();
    await expect(page.getByTestId("create-error")).toContainText("out of AI credits");
    await expect(page.getByTestId("page-status").nth(1)).not.toHaveText("✖ Failed"); // never attempted
  });
});
