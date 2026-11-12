import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const MOCK_DB = "avc:mockcloud:v1";

let n = 0;
async function setup(page: Page, signedIn = true) {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  if (signedIn) {
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Email").fill(`inbox${Date.now()}${++n}@example.com`);
    await page.getByRole("button", { name: "Send link" }).click();
    await page.getByRole("button", { name: "Projects" }).click();
    await page.getByRole("button", { name: "Save to cloud" }).click();
    await expect(page.getByTestId("cloud-project-BrightPath Coaching")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("sync-status")).toHaveText("☁ Synced ✓");
  }
  // give the project a contact form
  await page.evaluate(() => {
    const s = (window as any).__editor.getState();
    const page0 = s.project.pages[0];
    s.commit({ summary: "Add form", ops: [{ op: "insert", parentId: page0.id, index: 2, node: { id: "sec_form", kind: "container", type: "section", props: {}, children: [{ id: "contact1", kind: "block", type: "contactForm", variant: "simple", props: { title: "Get in touch", submitLabel: "Send" } }] } }] });
  });
  if (signedIn) await expect(page.getByTestId("sync-status")).toHaveText("☁ Synced ✓");
}
const openExport = async (page: Page) => { await page.getByRole("button", { name: "Export", exact: true }).click(); };
const addMessage = (page: Page, slug: string, fields: Record<string, string>, id = "m" + Math.random().toString(36).slice(2, 6), at = new Date().toISOString()) =>
  page.evaluate(([key, row]) => {
    const db = JSON.parse(localStorage.getItem(key as string)!);
    (db.submissions ??= []).push(row);
    localStorage.setItem(key as string, JSON.stringify(db));
  }, [MOCK_DB, { id, slug, formId: "contact1", fields, createdAt: at }] as const);

test("signed out: the dialog says forms won't deliver, and offers no site name", async ({ page }) => {
  await setup(page, false);
  await openExport(page);
  await expect(page.getByTestId("forms-section")).toContainText("Sign in");
  await expect(page.getByLabel("Site name")).toHaveCount(0);
});

test("no contact form: the section is not shown at all", async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await openExport(page);
  await expect(page.getByTestId("forms-section")).toHaveCount(0);
});

test("create a site name, export with forms connected, receive and delete a message", async ({ page }) => {
  await setup(page);
  await openExport(page);
  const section = page.getByTestId("forms-section");
  await expect(section.getByLabel("Site name")).toBeVisible();

  // invalid names are explained and cannot be saved
  await section.getByLabel("Site name").fill("Bad Name!");
  await expect(section).toContainText("3 to 40 lowercase");
  await expect(section.getByRole("button", { name: "Create site" })).toBeDisabled();

  await section.getByLabel("Site name").fill("my-school");
  await section.getByRole("button", { name: "Create site" }).click();
  await expect(section.getByRole("status")).toHaveText("Saved.");
  await expect(section.getByRole("button", { name: "Rename" })).toBeVisible();

  // the exported site really contains a live form for this site, and a CSP that allows only that backend
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download \.zip/ }).click()]);
  const path = await download.path();
  const files = unzipSync(new Uint8Array(await (await import("node:fs/promises")).readFile(path!)));
  const html = new TextDecoder().decode(files["index.html"]);
  expect(html).toContain('data-avc-form="contact1"');
  expect(html).toContain("https://abc.supabase.co/rest/v1/rpc/submit_form");
  expect(html).toContain("my-school");
  expect(new TextDecoder().decode(files["_headers"])).toContain("connect-src https://abc.supabase.co");
  expect(html).not.toContain("service_role");

  // unchecking delivery exports an inert form
  await section.getByLabel("Deliver form messages to my inbox").uncheck();
  const [d2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download \.zip/ }).click()]);
  const f2 = unzipSync(new Uint8Array(await (await import("node:fs/promises")).readFile((await d2.path())!)));
  expect(new TextDecoder().decode(f2["index.html"])).not.toContain("data-avc-form");
  await section.getByLabel("Deliver form messages to my inbox").check();

  // the inbox: empty, then messages arrive (newest first), hostile text is shown as text
  await section.getByRole("button", { name: /View messages/ }).click();
  await expect(page.getByTestId("inbox")).toContainText("No messages yet");
  await addMessage(page, "my-school", { email: "old@example.com", message: "first" }, "m1", "2025-01-01T00:00:00Z");
  await addMessage(page, "my-school", { email: "new@example.com", message: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>' }, "m2", "2025-02-01T00:00:00Z");
  await addMessage(page, "other-site", { email: "stranger@example.com", message: "not mine" }, "m3");
  await page.getByTestId("inbox").getByRole("button", { name: "Refresh" }).click();
  const rows = page.getByTestId("inbox-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("new@example.com");
  await expect(rows.first()).toContainText('<img src=x onerror="window.__pwned=1">'); // visible as text
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  expect(await page.getByTestId("inbox").locator("img, script").count()).toBe(0);
  await expect(page.getByTestId("inbox")).not.toContainText("stranger@example.com");

  await rows.first().getByRole("button", { name: "Delete message" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("old@example.com");
});

test("a name someone else has is refused with a clear message", async ({ page }) => {
  await setup(page);
  await openExport(page);
  const section = page.getByTestId("forms-section");
  // another user already owns the name (written straight into the mock server)
  await page.evaluate((key) => {
    const db = JSON.parse(localStorage.getItem(key)!);
    (db.sites ??= []).push({ projectId: "someone_elses", owner: "user_other", slug: "taken-name" });
    localStorage.setItem(key, JSON.stringify(db));
  }, MOCK_DB);
  await section.getByLabel("Site name").fill("taken-name");
  await section.getByRole("button", { name: "Create site" }).click();
  await expect(section.getByRole("alert")).toContainText("already taken");
});
