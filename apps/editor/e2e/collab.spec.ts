import { expect, test, type Page } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;
const cloud = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__cloud.getState(); return (${fn})(s); })()`) as Promise<T>;
const synced = (page: Page) => expect(page.getByTestId("sync-status")).toHaveText("☁ Synced ✓");
/** Edit the mock server's data directly, as if another person had done something. */
const editServer = (page: Page, body: string) => page.evaluate(`(() => { const k = "avc:mockcloud:v1"; const db = JSON.parse(localStorage.getItem(k)); (${body})(db); localStorage.setItem(k, JSON.stringify(db)); })()`);

async function quiesce(page: Page) {
  const idle = () => page.evaluate(() => { const e = (window as any).__editor.getState(); const c = (window as any).__cloud?.getState(); return e.saveStatus !== "saving" && (!c || c.sync !== "syncing"); });
  await expect.poll(idle).toBe(true);
  await page.waitForTimeout(900);
  await expect.poll(idle).toBe(true);
}
async function signIn(page: Page, email: string) {
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
}
async function signOut(page: Page) {
  await quiesce(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
}
async function saveToCloud(page: Page) {
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.getByTestId("cloud-project-BrightPath Coaching")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await synced(page);
}
async function share(page: Page, email: string, role: "editor" | "viewer") {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Share project" });
  await dlg.getByLabel("Email to invite").fill(email);
  await dlg.getByLabel("What they can do").selectOption(role);
  await dlg.getByRole("button", { name: "Invite" }).click();
  await expect(dlg.getByTestId("share-note")).toBeVisible();
  await dlg.getByRole("button", { name: "Close" }).click();
}
/** Alice creates and shares a project, then bob signs in and opens it. */
async function bobOpensShared(page: Page, role: "editor" | "viewer") {
  await signIn(page, "alice@example.com");
  await saveToCloud(page);
  await share(page, "bob@example.com", role);
  await signOut(page);
  await signIn(page, "bob@example.com");
  await expect(page.getByTestId("cloud-notice")).toContainText("shared with you");
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByTestId("shared-project-BrightPath Coaching").getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("dialog", { name: "Your projects" })).toHaveCount(0);
  await synced(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
});

test("only a signed-in owner of a saved project sees Share", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  await signIn(page, "alice@example.com");
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0); // not saved to the cloud yet
  await saveToCloud(page);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
});

test("the owner invites people, sees them as invited, can change and remove them, and is held to 10", async ({ page }) => {
  await signIn(page, "alice@example.com");
  await saveToCloud(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Share project" });
  await expect(dlg).toContainText("Only you, for now");

  await dlg.getByLabel("Email to invite").fill("Bob@Example.com");
  await dlg.getByRole("button", { name: "Invite" }).click();
  await expect(dlg.getByTestId("person-bob@example.com")).toContainText("Invited");
  await expect(dlg.getByTestId("share-note")).toContainText("next time they sign in");

  await dlg.getByLabel("Access for bob@example.com").selectOption("viewer");
  await expect(dlg.getByLabel("Access for bob@example.com")).toHaveValue("viewer");

  // the same message for an email that has an account and one that doesn't, so accounts can't be probed
  await dlg.getByLabel("Email to invite").fill("nobody@nowhere.example");
  await dlg.getByRole("button", { name: "Invite" }).click();
  await expect(dlg.getByTestId("person-nobody@nowhere.example")).toContainText("Invited");

  // own address, bad address
  await dlg.getByLabel("Email to invite").fill("alice@example.com");
  await dlg.getByRole("button", { name: "Invite" }).click();
  await expect(dlg.getByRole("alert")).toContainText("your own email");
  await dlg.getByLabel("Email to invite").fill("not-an-email");
  await dlg.getByRole("button", { name: "Invite" }).click();
  await expect(dlg.getByRole("alert")).toContainText("valid email");

  await dlg.getByRole("button", { name: "Remove bob@example.com" }).click();
  await expect(dlg.getByTestId("person-bob@example.com")).toHaveCount(0);

  for (let i = 0; i < 9; i++) {
    await dlg.getByLabel("Email to invite").fill(`p${i}@example.com`);
    await dlg.getByRole("button", { name: "Invite" }).click();
    await expect(dlg.getByTestId(`person-p${i}@example.com`)).toBeVisible();
  }
  await expect(dlg).toContainText("10 of 10");
  await dlg.getByLabel("Email to invite").fill("one-too-many@example.com");
  await expect(dlg.getByRole("button", { name: "Invite" })).toBeDisabled();
});

test("an invited person gets the project after signing in, can edit it, and the owner sees their change", async ({ page }) => {
  await bobOpensShared(page, "editor");
  await expect(page.getByTestId("role-badge")).toContainText("you can edit");
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0); // only the owner shares
  expect(await state<boolean>(page, "(s) => s.readOnly")).toBe(false);

  const before = await state<number>(page, "(s) => s.project.pages[0].nodes[1].children.length");
  await page.getByRole("button", { name: "Heading", exact: true }).click();
  await expect.poll(() => state<number>(page, "(s) => s.project.pages.find(p => p.id === s.pageId).nodes.length")).toBeGreaterThan(0);
  await synced(page);
  void before;

  await signOut(page);
  await signIn(page, "alice@example.com");
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByTestId("cloud-project-BrightPath Coaching").getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("dialog", { name: "Your projects" })).toHaveCount(0);
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible(); // bob's heading
  await expect(page.getByTestId("role-badge")).toHaveCount(0); // alice is the owner again
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
});

test("a viewer can look but nothing can be changed, and says so", async ({ page }) => {
  await bobOpensShared(page, "viewer");
  await expect(page.getByTestId("role-badge")).toContainText("View only");
  expect(await state<boolean>(page, "(s) => s.readOnly")).toBe(true);
  const before = await state<string>(page, "(s) => JSON.stringify(s.project)");
  await page.getByRole("button", { name: "Heading", exact: true }).click();
  expect(await state<string>(page, "(s) => JSON.stringify(s.project)")).toBe(before);
  expect(await state<string>(page, "(s) => s.error")).toContain("view-only");
  await page.keyboard.press("Control+z");
  expect(await state<string>(page, "(s) => JSON.stringify(s.project)")).toBe(before);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  // and the server never saw a change
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("avc:mockcloud:v1")!));
  expect(db.projects[0].version).toBe(1); // untouched
});

test("a viewer can leave a project, and then it is gone from their list", async ({ page }) => {
  await bobOpensShared(page, "viewer");
  await page.getByRole("button", { name: "Projects" }).click();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("shared-project-BrightPath Coaching").getByRole("button", { name: "Leave" }).click();
  await expect(page.getByTestId("shared-with-me")).toHaveCount(0);
  await expect(page.getByTestId("role-badge")).toHaveCount(0);
  expect(await state<boolean>(page, "(s) => s.readOnly")).toBe(false); // the local copy is theirs to edit again
});

test("changes someone else saved arrive on their own, and Undo can't step back across them", async ({ page }) => {
  await bobOpensShared(page, "editor");
  await quiesce(page);
  // another person saves a change: simulate it on the server
  await editServer(page, `(db) => { const p = db.projects[0]; p.json.pages[0].nodes[0].children[0].props.brand = "Changed by a teammate"; p.version += 1; }`);
  await cloud<void>(page, "(s) => s.checkRemote()");
  await expect(frame(page).locator("nav.avc-nav strong").first()).toHaveText("Changed by a teammate");
  await expect(page.getByTestId("cloud-notice")).toContainText("someone else saved");
  expect(await state<number>(page, "(s) => s.past.length")).toBe(0);
  await synced(page);
});

test("if I have unsaved edits when someone else saves, I'm asked which version to keep (nothing is overwritten silently)", async ({ page }) => {
  await bobOpensShared(page, "editor");
  await quiesce(page);
  await editServer(page, `(db) => { db.projects[0].version += 1; }`);
  await page.getByRole("button", { name: "Heading", exact: true }).click(); // my edit; its save will find the newer version
  await expect(page.getByTestId("conflict-banner")).toBeVisible();
  await expect(page.getByTestId("conflict-banner")).toContainText("person you share it with");
});

test("if the owner removes my access, I'm told and keep my copy on this device", async ({ page }) => {
  await bobOpensShared(page, "editor");
  await quiesce(page);
  await editServer(page, `(db) => { db.members = []; }`);
  await cloud<void>(page, "(s) => s.checkRemote()");
  await expect(page.getByTestId("cloud-message")).toContainText("no longer have access");
  await expect(page.getByTestId("role-badge")).toHaveCount(0);
  expect(await cloud<string | null>(page, "(s) => s.cloudId")).toBeNull();
  await expect(frame(page).locator("h1")).toBeVisible(); // the copy is still here
});

test("if the owner changes my access from edit to view, the editor locks", async ({ page }) => {
  await bobOpensShared(page, "editor");
  await quiesce(page);
  await editServer(page, `(db) => { db.members[0].role = "viewer"; }`);
  for (let i = 0; i < 4; i++) await cloud<void>(page, "(s) => s.checkRemote()"); // permission is re-checked every few checks
  await expect(page.getByTestId("role-badge")).toContainText("View only");
  expect(await state<boolean>(page, "(s) => s.readOnly")).toBe(true);
  await expect(page.getByTestId("cloud-notice")).toContainText("only view");
});

test("if my access was cut to view-only while I was editing, the save is refused, and the saved version is loaded", async ({ page }) => {
  await bobOpensShared(page, "editor");
  await quiesce(page);
  await editServer(page, `(db) => { db.members[0].role = "viewer"; }`);
  await page.getByRole("button", { name: "Heading", exact: true }).click(); // allowed locally (the editor didn't know yet); the save is refused
  await expect(page.getByTestId("role-badge")).toContainText("View only");
  await expect(page.getByTestId("cloud-message")).toContainText("view-only");
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem("avc:mockcloud:v1")!));
  expect(db.projects[0].version).toBe(1); // the refused edit never reached the server
});

test("contact-form delivery is the owner's: a collaborator is told, not offered broken controls", async ({ page }) => {
  await bobOpensShared(page, "editor");
  await page.getByRole("button", { name: "Contact form" }).click(); // the forms section only appears for a project that has a contact form
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByTestId("forms-section")).toContainText("set up by this project's owner");
});
