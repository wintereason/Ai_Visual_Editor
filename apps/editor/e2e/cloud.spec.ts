import { expect, test, type Page } from "@playwright/test";

// The mock backend has the same contract as Supabase (see packages/cloud) and lives in localStorage,
// so two tabs of one browser context behave like two devices sharing one server.

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const mockDb = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("avc:mockcloud:v1") ?? "null"));
const cloudProjects = async (page: Page) => (await mockDb(page))?.projects ?? [];
const synced = (page: Page) => expect(page.getByTestId("sync-status")).toHaveText("☁ Synced ✓");

/**
 * Wait until the editor is genuinely idle: no save in flight and no autosave timer pending. Tests that wipe or edit browser
 * storage directly must do this first, or a late autosave (600 ms debounce) can rewrite what they just changed.
 */
async function quiesce(page: Page) {
  const idle = () => page.evaluate(() => {
    const e = (window as any).__editor.getState();
    const c = (window as any).__cloud?.getState();
    return e.saveStatus !== "saving" && (!c || c.sync !== "syncing");
  });
  await expect.poll(idle).toBe(true);
  await page.waitForTimeout(900); // longer than the autosave debounce, so no timer can still be pending
  await expect.poll(idle).toBe(true);
}

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
async function saveToCloud(page: Page) {
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.getByTestId("cloud-project-BrightPath Coaching")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await synced(page);
}

test("signed-out users see only Sign in; bad emails are rejected; local editing still works", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Projects" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByRole("dialog", { name: "Sign in" }).getByRole("alert")).toContainText("valid email");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Heading" }).click();
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
});

test("sign in, save to cloud, edits sync with a bumped version, survives reload", async ({ page }) => {
  await signIn(page);
  await saveToCloud(page);
  expect((await cloudProjects(page))[0].version).toBe(1);

  await page.getByRole("button", { name: "Heading" }).click();
  await expect.poll(async () => (await cloudProjects(page))[0].version).toBe(2);
  await synced(page);
  const text = (await cloudProjects(page))[0].json.pages[0].nodes.at(-1).children[0].props.text;
  expect(text).toBe("New heading");

  await page.reload(); // still signed in and linked; nothing new to push
  await synced(page);
  expect((await cloudProjects(page))[0].version).toBe(2);
});

test("a template starts a NEW project and never overwrites the linked one", async ({ page }) => {
  await signIn(page);
  await saveToCloud(page);
  await page.getByRole("button", { name: "New…" }).click();
  await page.getByTestId("template-school").getByRole("button", { name: "Use template" }).click();
  await expect(frame(page).locator("h1")).toContainText("A school where every child is known");
  await expect(page.getByTestId("sync-status")).toHaveText("☁ Not synced");
  await page.getByRole("button", { name: "Heading" }).click();
  await page.waitForTimeout(1500); // longer than the autosave debounce
  const projects = await cloudProjects(page);
  expect(projects).toHaveLength(1);
  expect(projects[0].name).toBe("BrightPath Coaching");
  expect(projects[0].version).toBe(1);
});

test("conflict between two tabs: 'load their version' is undoable and nothing is overwritten", async ({ page, context }) => {
  await signIn(page);
  await saveToCloud(page);
  const b = await context.newPage();
  await b.goto("/");
  await expect(frame(b).locator("h1")).toBeVisible();
  await synced(b);

  await page.getByRole("button", { name: "Heading" }).click(); // tab A saves v2
  await expect.poll(async () => (await cloudProjects(page))[0].version).toBe(2);

  await b.getByRole("button", { name: "Text", exact: true }).click(); // tab B edits from v1
  await expect(b.getByTestId("conflict-banner")).toBeVisible();
  expect((await cloudProjects(page))[0].version).toBe(2);

  await b.getByRole("button", { name: /Load their version/ }).click();
  await expect(b.getByTestId("conflict-banner")).toHaveCount(0);
  await expect(frame(b).locator("h2", { hasText: "New heading" })).toBeVisible(); // A's edit
  await expect(frame(b).locator("p", { hasText: "Write something here." })).toHaveCount(0); // B's edit is gone...
  await b.getByRole("button", { name: /Undo/ }).click();
  await expect(frame(b).locator("p", { hasText: "Write something here." })).toBeVisible(); // ...but one Undo away
});

test("conflict: 'keep mine' overwrites the server", async ({ page, context }) => {
  await signIn(page);
  await saveToCloud(page);
  const b = await context.newPage();
  await b.goto("/");
  await synced(b);
  await page.getByRole("button", { name: "Heading" }).click();
  await expect.poll(async () => (await cloudProjects(page))[0].version).toBe(2);
  await b.getByRole("button", { name: "Text", exact: true }).click();
  await expect(b.getByTestId("conflict-banner")).toBeVisible();
  await b.getByRole("button", { name: /Keep mine/ }).click();
  await expect(b.getByTestId("conflict-banner")).toHaveCount(0);
  await expect.poll(async () => (await cloudProjects(page))[0].version).toBe(3);
  const last = (await cloudProjects(page))[0].json.pages[0].nodes.at(-1).children[0].props.text;
  expect(last).toBe("Write something here.");
});

test("a fresh device can open the project, including its images", async ({ page }) => {
  await signIn(page);
  await saveToCloud(page);
  await page.getByRole("tab", { name: "Media" }).click();
  await page.getByLabel("Upload images").setInputFiles([{ name: "logo.png", mimeType: "image/png", buffer: PNG_1PX }]);
  await expect(page.getByTestId("asset-logo")).toBeVisible();
  await page.getByTestId("asset-logo").getByRole("button").first().click(); // add the image to the page
  await expect.poll(async () => (await mockDb(page)).assets.length).toBe(1);
  await expect.poll(async () => (await cloudProjects(page))[0].version).toBeGreaterThan(1);
  await synced(page);

  // "new device": forget the local project, link and media, but keep the account and the server
  await quiesce(page);
  await page.evaluate(async () => {
    localStorage.removeItem("avc:project:v1");
    localStorage.removeItem("avc:versions:v1");
    localStorage.removeItem("avc:cloudlink:v1");
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase("avc-assets");
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  });
  await page.reload();
  await expect(frame(page).locator("h1")).toContainText("Learn skills that get you hired");
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByTestId("cloud-project-BrightPath Coaching").getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("dialog", { name: "Your projects" })).toHaveCount(0);
  await expect(frame(page).locator("img[src^='blob:']")).toHaveCount(1); // image bytes came down from the server
  await page.getByRole("tab", { name: "Media" }).click();
  await expect(page.getByTestId("asset-logo")).toBeVisible();
});

test("deleting the open project unlinks it but keeps the local copy", async ({ page }) => {
  await signIn(page);
  await saveToCloud(page);
  await page.getByRole("button", { name: "Projects" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("cloud-project-BrightPath Coaching").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("cloud-project-BrightPath Coaching")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("sync-status")).toHaveText("☁ Not synced");
  expect(await cloudProjects(page)).toHaveLength(0);
  await expect(frame(page).locator("h1")).toContainText("Learn skills");
});

test("sign out hides cloud actions and stops syncing; local work stays", async ({ page }) => {
  await signIn(page);
  await saveToCloud(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Projects" })).toHaveCount(0);
  await expect(page.getByTestId("sync-status")).toHaveCount(0);
  await page.getByRole("button", { name: "Heading" }).click();
  await page.waitForTimeout(1200);
  expect((await cloudProjects(page))[0].version).toBe(1); // signed out: nothing pushed
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
});

test("edits made while away conflict with a newer server version after reload (never silently lost)", async ({ page, context }) => {
  await signIn(page);
  await saveToCloud(page);
  const b = await context.newPage();
  await b.goto("/");
  await synced(b);
  await page.getByRole("button", { name: "Heading" }).click(); // the server moves to v2 while "B" is away
  await expect.poll(async () => (await cloudProjects(page))[0].version).toBe(2);
  await b.close();

  // Simulate a device that edited offline from v1: local content differs from what was last synced, link still at v1.
  await quiesce(page);
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("avc:project:v1")!);
    p.pages[0].nodes[1].children[0].props.headline = "Edited while offline";
    localStorage.setItem("avc:project:v1", JSON.stringify(p));
    const link = JSON.parse(localStorage.getItem("avc:cloudlink:v1")!);
    link.version = 1;
    localStorage.setItem("avc:cloudlink:v1", JSON.stringify(link));
  });
  await page.reload();
  await expect(page.getByTestId("conflict-banner")).toBeVisible();
  await expect(frame(page).locator("h1")).toContainText("Edited while offline"); // local work is still on screen
  expect((await cloudProjects(page))[0].version).toBe(2); // and the server was not overwritten
});

test("untouched local copy fast-forwards to a newer server version on reload (no false conflict)", async ({ page, context }) => {
  await signIn(page);
  await saveToCloud(page);
  // another device saves v2 straight to the server
  await quiesce(page);
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem("avc:mockcloud:v1")!);
    db.projects[0].json.pages[0].nodes[1].children[0].props.headline = "Edited on another device";
    db.projects[0].version = 2;
    localStorage.setItem("avc:mockcloud:v1", JSON.stringify(db));
  });
  await page.reload();
  await expect(frame(page).locator("h1")).toContainText("Edited on another device");
  await synced(page);
  await expect(page.getByTestId("conflict-banner")).toHaveCount(0);
  void context;
});
