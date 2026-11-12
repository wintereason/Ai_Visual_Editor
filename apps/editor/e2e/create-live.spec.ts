import { expect, test, type Page } from "@playwright/test";

// These tests do NOT mock the network. The browser talks to the real /api/ai route, which streams progress and talks to the
// real Anthropic provider code, pointed at e2e/fake-anthropic.mjs (slow and deterministic). Only the model is fake.

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;

let n = 0;
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  // a different user per test, so one test's credits and daily cap never affect another
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(`live${Date.now()}${++n}@example.com`);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
  await page.getByRole("tab", { name: "✦ Create" }).click();
  await page.getByRole("button", { name: "A whole site" }).click();
});

async function design(page: Page, brief: string) {
  await page.getByLabel("Describe the website").fill(brief);
  await page.getByRole("button", { name: "✦ Design layout" }).click();
  await expect(page.getByTestId("site-page")).toHaveCount(2);
}
const status = (page: Page, i: number) => page.getByTestId("page-status").nth(i);

test("designing shows live progress, then the layout for review", async ({ page }) => {
  await page.getByLabel("Describe the website").fill("a school site");
  await page.getByRole("button", { name: "✦ Design layout" }).click();
  await expect(page.getByRole("button", { name: /Designing/ })).toBeVisible();
  await expect(page.getByTestId("site-page")).toHaveCount(2);
});

test("a bad first answer is shown as 'fixing', and the retry succeeds", async ({ page }) => {
  await page.getByLabel("Describe the website").fill("BADLAYOUT a school site");
  await page.getByRole("button", { name: "✦ Design layout" }).click();
  await expect(page.getByRole("button", { name: /Fixing a problem and trying again \(try 2 of 3\)/ })).toBeVisible();
  await expect(page.getByTestId("site-page")).toHaveCount(2);
});

test("review: rename, reorder, remove sections and pages; previews are sandboxed; nothing is applied yet", async ({ page }) => {
  const name0 = await state<string>(page, "s => s.project.name");
  await design(page, "a school site");

  // the home page cannot be removed; another can
  await expect(page.getByRole("button", { name: "Remove page" }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove page" }).nth(1)).toBeEnabled();

  // rename (committed on blur / Enter)
  const about = page.getByLabel("Name of page /about");
  await about.fill("Our story");
  await about.press("Enter");
  await expect(about).toHaveValue("Our story");
  await about.fill("   ");
  await about.blur();
  await expect(about).toHaveValue("Our story"); // a blank name is refused and reverts

  // sections: first page is navbar, hero, footer
  const rows = page.getByTestId("site-page").first().getByTestId("section-row");
  await expect(rows).toHaveText([/^navbar/, /^hero/, /^footer/]);
  await page.getByRole("button", { name: "Move hero up" }).first().click();
  await expect(rows).toHaveText([/^hero/, /^navbar/, /^footer/]);
  await expect(page.getByRole("button", { name: "Move hero up" }).first()).toBeDisabled();
  await page.getByRole("button", { name: "Remove footer" }).first().click();
  await expect(rows).toHaveText([/^hero/, /^navbar/]);

  // preview
  await page.getByRole("button", { name: "Preview" }).first().click();
  const frame1 = page.locator("iframe[title='Page preview']");
  await expect(frame1).toHaveAttribute("sandbox", "");
  await expect(page.getByTestId("page-preview")).toBeVisible();
  await page.getByRole("button", { name: "Hide preview" }).click();
  await expect(page.getByTestId("page-preview")).toHaveCount(0);

  // remove the second page
  await page.getByRole("button", { name: "Remove page" }).nth(1).click();
  await expect(page.getByTestId("site-page")).toHaveCount(1);

  // the review was only a draft
  expect(await state<string>(page, "s => s.project.name")).toBe(name0);
});

test("edits made in review are what gets built and applied (the structure lock follows the approved edits)", async ({ page }) => {
  await design(page, "a school site");
  const about = page.getByLabel("Name of page /about");
  await about.fill("Our story");
  await about.press("Enter");
  await page.getByRole("button", { name: "Remove footer" }).nth(1).click(); // drop the About page's footer
  await page.getByRole("button", { name: /Approve/ }).click();
  await expect(status(page, 0)).toHaveText("✔ Done");
  await expect(status(page, 1)).toHaveText("✔ Done");
  await page.getByRole("button", { name: "Use this site" }).click();
  await expect(page.getByTestId("site-applied")).toBeVisible();
  expect(await state<string[]>(page, "s => s.project.pages.map(p => p.name)")).toEqual(["Home", "Our story"]);
  expect(await state<number>(page, "s => s.project.pages[1].nodes.length")).toBe(2);
  expect(await state<string>(page, "s => s.project.pages[1].nodes[1].children[0].props.headline")).toBe("Written for Our story");
  expect(await state<string | null>(page, "s => s.error")).toBeNull();
});

test("progress is live while a page is being written, including a retry", async ({ page }) => {
  await design(page, "FLAKY a school site");
  await page.getByRole("button", { name: /Approve/ }).click();
  await expect(status(page, 0)).toContainText(/Writing/);
  await expect(status(page, 1)).toContainText(/Fixing a problem and trying again \(try 2 of 3\)/);
  await expect(status(page, 1)).toHaveText("✔ Done");
});

test("a page that keeps failing is reported on its own; the rest can still be applied", async ({ page }) => {
  await design(page, "ALWAYSFAIL a school site");
  await page.getByRole("button", { name: /Approve/ }).click();
  await expect(status(page, 0)).toHaveText("✔ Done");
  await expect(status(page, 1)).toHaveText("✖ Failed");
  await page.getByRole("button", { name: /Retry 1 page/ }).click();
  await expect(status(page, 1)).toHaveText("✖ Failed"); // still failing, nothing lost
  await page.getByRole("button", { name: "Use what's done" }).click();
  await expect(page.getByTestId("site-applied")).toBeVisible();
  expect(await state<string>(page, "s => s.project.pages[0].nodes[1].children[0].props.headline")).toBe("Written for Home");
  expect(await state<string>(page, "s => s.project.pages[1].nodes[1].children[0].props.headline")).toBe("About us"); // approved placeholder kept
});

test("Stop cancels the build and keeps what was finished", async ({ page }) => {
  await design(page, "a school site");
  await page.getByRole("button", { name: /Approve/ }).click();
  await expect(status(page, 0)).toHaveText("✔ Done");
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(status(page, 0)).toHaveText("✔ Done");
  await expect(page.getByRole("button", { name: "Use what's done" })).toBeVisible();
});

test("review: add a section and a new page; both are built and applied", async ({ page }) => {
  await design(page, "a school site");
  // add an FAQ to Home: it lands before the footer
  await page.getByLabel("Add a section to Home").selectOption("faq");
  const rows = page.getByTestId("site-page").first().getByTestId("section-row");
  await expect(rows).toHaveText([/^navbar/, /^hero/, /^faq/, /^footer/]);
  // add a page
  await page.getByLabel("New page name").fill("Contact us");
  await page.getByRole("button", { name: "Add page" }).click();
  await expect(page.getByTestId("site-page")).toHaveCount(3);
  await expect(page.getByLabel("Name of page /contact-us")).toHaveValue("Contact us");
  await expect(page.getByLabel("New page name")).toHaveValue("");

  await page.getByRole("button", { name: /Approve/ }).click();
  await expect(page.getByTestId("page-status")).toHaveText(["✔ Done", "✔ Done", "✔ Done"]);
  await page.getByRole("button", { name: "Use this site" }).click();
  await expect(page.getByTestId("site-applied")).toBeVisible();
  expect(await state<string[]>(page, "s => s.project.pages.map(p => p.path)")).toEqual(["/", "/about", "/contact-us"]);
  expect(await state<string[]>(page, "s => s.project.pages[0].nodes.map(n => n.children[0].type)")).toEqual(["navbar", "hero", "faq", "footer"]);
  expect(await state<string>(page, "s => s.project.pages[2].nodes[1].children[0].props.headline")).toBe("Written for Contact us");
  expect(await state<string | null>(page, "s => s.error")).toBeNull();
});

test("the safety check refuses a flagged request with a clear message, before any layout is made", async ({ page }) => {
  await page.getByLabel("Describe the website").fill("FORBIDDEN-TEST-CONTENT a school site");
  await page.getByRole("button", { name: "✦ Design layout" }).click();
  await expect(page.getByTestId("create-error")).toContainText("may involve content we don't allow");
  await expect(page.getByTestId("create-error")).not.toContainText("FORBIDDEN"); // the flagged text is never echoed back
  await expect(page.getByTestId("site-page")).toHaveCount(0);
  // an ordinary request still works straight afterwards
  await page.getByLabel("Describe the website").fill("a school site");
  await page.getByRole("button", { name: "✦ Design layout" }).click();
  await expect(page.getByTestId("site-page")).toHaveCount(2);
});
