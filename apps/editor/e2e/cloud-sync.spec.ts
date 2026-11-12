import { expect, test, type Page } from "@playwright/test";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
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

const state = <T,>(page: Page, fn: string): Promise<T> => page.evaluate(`(() => { const s = window.__editor.getState(); return (${fn})(s); })()`) as Promise<T>;

/** 300x200: left half red, right half blue. */
async function picture(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 300; c.height = 200;
    const x = c.getContext("2d")!;
    x.fillStyle = "#ff0000"; x.fillRect(0, 0, 150, 200);
    x.fillStyle = "#0000ff"; x.fillRect(150, 0, 150, 200);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    return await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]!); fr.readAsDataURL(blob); });
  });
  return Buffer.from(b64, "base64");
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
/** Forget everything local (project, link, media) but keep the account and the server: a brand-new device. */
async function freshDevice(page: Page) {
  await quiesce(page);
  await page.evaluate(async () => {
    for (const k of ["avc:project:v1", "avc:versions:v1", "avc:cloudlink:v1"]) localStorage.removeItem(k);
    await new Promise<void>((res) => { const r = indexedDB.deleteDatabase("avc-assets"); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  });
  await page.reload();
  await expect(frame(page).locator("h1")).toContainText("Learn skills that get you hired");
}
async function openFirstCloudProject(page: Page) {
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByTestId("cloud-project-BrightPath Coaching").getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("dialog", { name: "Your projects" })).toHaveCount(0);
}

test.describe("image descriptions and derived images follow you between devices", () => {
  test("alt text typed on one device appears on the next", async ({ page }) => {
    await signIn(page);
    await saveToCloud(page);
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Upload images").setInputFiles([{ name: "gate.png", mimeType: "image/png", buffer: await picture(page) }]);
    await expect(page.getByTestId("asset-gate")).toBeVisible();
    await expect.poll(async () => (await mockDb(page)).assets.length).toBe(1);

    const alt = page.getByLabel("Alt text for gate");
    await alt.fill("The school gate at sunrise");
    await alt.blur();
    await expect.poll(async () => (await mockDb(page)).assets[0].asset.alt).toBe("The school gate at sunrise");

    await freshDevice(page);
    await openFirstCloudProject(page);
    await page.getByRole("tab", { name: "Media" }).click();
    await expect(page.getByTestId("asset-gate")).toBeVisible();
    await expect(page.getByLabel("Alt text for gate")).toHaveValue("The school gate at sunrise");
  });

  test("a rotated copy keeps its link to the original on the other device, so 'Back to original' still works", async ({ page }) => {
    await signIn(page);
    await saveToCloud(page);
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Upload images").setInputFiles([{ name: "flag.png", mimeType: "image/png", buffer: await picture(page) }]);
    await expect(page.getByTestId("asset-flag")).toBeVisible();
    await page.getByTestId("asset-flag").getByRole("button").first().click(); // adds an image, selected
    await page.getByRole("tab", { name: "Blocks" }).click();
    await page.getByRole("button", { name: /Right/ }).click(); // rotate: creates the derived copy
    await expect.poll(async () => (await mockDb(page)).assets.length).toBe(2);
    const derived = (await mockDb(page)).assets.map((a: any) => a.asset).find((a: any) => a.derivedFrom);
    expect(derived.derivedFrom.op).toBe("rotate");
    await expect.poll(async () => (await cloudProjects(page))[0].version).toBeGreaterThan(1);
    await synced(page);

    await freshDevice(page);
    await openFirstCloudProject(page);
    await expect(frame(page).locator("img[src^='blob:']")).toHaveCount(1);
    await frame(page).locator("img[src^='blob:']").click();
    await expect(page.getByTestId("image-size")).toContainText("200×300"); // the rotated copy
    await page.getByRole("button", { name: /Back to original/ }).click();
    await expect(page.getByTestId("image-size")).toContainText("300×200"); // original, downloaded from the server
  });

  test("a description set on this device wins over a different one on the server, and is pushed", async ({ page }) => {
    await signIn(page);
    await saveToCloud(page);
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Upload images").setInputFiles([{ name: "logo.png", mimeType: "image/png", buffer: await picture(page) }]);
    await expect(page.getByTestId("asset-logo")).toBeVisible();
    await expect.poll(async () => (await mockDb(page)).assets.length).toBe(1);
    const alt = page.getByLabel("Alt text for logo");
    await alt.fill("Local description");
    await alt.blur();
    await expect.poll(async () => (await mockDb(page)).assets[0].asset.alt).toBe("Local description");
    // someone changes it on the server directly
    await quiesce(page);
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem("avc:mockcloud:v1")!);
      db.assets[0].asset.alt = "Server description";
      localStorage.setItem("avc:mockcloud:v1", JSON.stringify(db));
    });
    await page.reload();
    await expect(frame(page).locator("h1")).toBeVisible();
    await expect.poll(async () => (await mockDb(page)).assets[0].asset.alt, { timeout: 8000 }).toBe("Local description");
    await page.getByRole("tab", { name: "Media" }).click();
    await expect(page.getByLabel("Alt text for logo")).toHaveValue("Local description");
  });

  test("over-long descriptions are not pushed (the server limit is 300) and do not break the editor", async ({ page }) => {
    await signIn(page);
    await saveToCloud(page);
    await page.getByRole("tab", { name: "Media" }).click();
    await page.getByLabel("Upload images").setInputFiles([{ name: "big.png", mimeType: "image/png", buffer: await picture(page) }]);
    await expect(page.getByTestId("asset-big")).toBeVisible();
    await expect.poll(async () => (await mockDb(page)).assets.length).toBe(1);
    const alt = page.getByLabel("Alt text for big");
    await alt.fill("x".repeat(400));
    await alt.blur();
    await page.waitForTimeout(500);
    expect(((await mockDb(page)).assets[0].asset.alt ?? "").length).toBeLessThanOrEqual(300);
    await expect(page.getByTestId("asset-big")).toBeVisible(); // the editor is fine
  });
});

test.describe("cloud version history", () => {
  test("hidden until you are signed in and the project is saved to the cloud", async ({ page }) => {
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByTestId("cloud-history")).toHaveCount(0);
    await signIn(page);
    await expect(page.getByTestId("cloud-history")).toHaveCount(0); // signed in, but this project is still local only
    await saveToCloud(page);
    await expect(page.getByTestId("cloud-history")).toBeVisible();
  });

  test("saving to the cloud records a 'Created' version; named versions appear with their name", async ({ page }) => {
    await signIn(page);
    await saveToCloud(page);
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByTestId("cloud-history").locator("li", { hasText: "Created" })).toHaveCount(1);

    await page.getByRole("tab", { name: "Style" }).click();
    await page.getByRole("button", { name: "Heading" }).click();
    await synced(page);
    await page.getByRole("tab", { name: "History" }).click();
    await page.getByPlaceholder("Version name").fill("Before redesign");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("cloud-history").locator("li", { hasText: "Before redesign" })).toHaveCount(1);
    // it was taken after the heading was saved, so it is the newer server version
    const versions = (await mockDb(page)).versions as { reason: string; version: number }[];
    const named = versions.find((v) => v.reason === "Before redesign")!;
    expect(named.version).toBeGreaterThan(versions.find((v) => v.reason === "Created")!.version);
  });

  test("restoring an older cloud version brings its content back, is undoable, and keeps the whole history", async ({ page }) => {
    await signIn(page);
    await saveToCloud(page);
    await page.getByRole("tab", { name: "Style" }).click();
    await page.getByRole("button", { name: "Heading" }).click();
    await expect.poll(async () => (await cloudProjects(page))[0].version).toBe(2); // the edit is on the server (the "Synced" label alone may be stale)
    await synced(page);
    await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
    await page.getByRole("tab", { name: "History" }).click();
    const before = (await mockDb(page)).versions.length;

    page.once("dialog", (d) => d.accept());
    await page.getByTestId("cloud-history").locator("li", { hasText: "Created" }).getByRole("button", { name: "Restore" }).click();
    await expect(frame(page).locator("h2", { hasText: "New heading" })).toHaveCount(0); // back to the original
    // the restored state is saved as a NEW server version (v1 created, v2 with the heading, v3 = the restore)
    await expect.poll(async () => (await cloudProjects(page))[0].version, { timeout: 8000 }).toBeGreaterThanOrEqual(3);
    await synced(page);
    const projects = await cloudProjects(page);
    expect(projects[0].json.pages[0].nodes.some((n: any) => n.children?.some((c: any) => c.props?.text === "New heading"))).toBe(false);
    expect((await mockDb(page)).versions.length).toBeGreaterThanOrEqual(before);

    await page.getByRole("button", { name: /Undo/ }).click(); // restore itself is undoable
    await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
  });

  test("cancelling the confirmation changes nothing", async ({ page }) => {
    await signIn(page);
    await saveToCloud(page);
    await page.getByRole("tab", { name: "Style" }).click();
    await page.getByRole("button", { name: "Heading" }).click();
    await expect.poll(async () => (await cloudProjects(page))[0].version).toBe(2);
    await synced(page);
    await page.getByRole("tab", { name: "History" }).click();
    const v = (await cloudProjects(page))[0].version;
    page.once("dialog", (d) => d.dismiss());
    await page.getByTestId("cloud-history").locator("li", { hasText: "Created" }).getByRole("button", { name: "Restore" }).click();
    await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();
    expect((await cloudProjects(page))[0].version).toBe(v);
  });

  test("history follows you to a fresh device", async ({ page }) => {
    await signIn(page);
    await saveToCloud(page);
    await freshDevice(page);
    await openFirstCloudProject(page);
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByTestId("cloud-history").locator("li", { hasText: "Created" })).toHaveCount(1);
  });

  test("restore is blocked while there is an unresolved conflict", async ({ page, context }) => {
    await signIn(page);
    await saveToCloud(page);
    const b = await context.newPage();
    await b.goto("/");
    await synced(b);
    await page.getByRole("button", { name: "Heading" }).click();
    await expect.poll(async () => (await cloudProjects(page))[0].version).toBe(2);
    await b.getByRole("button", { name: "Text", exact: true }).click();
    await expect(b.getByTestId("conflict-banner")).toBeVisible();
    await b.getByRole("tab", { name: "History" }).click();
    await expect(b.getByTestId("cloud-history").getByRole("button", { name: "Restore" }).first()).toBeDisabled();
    expect(await state<string>(b, "s => s.project.pages[0].id")).toBeTruthy();
  });
});
