import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";

const frame = (page: Page) => page.frameLocator("iframe[title=Canvas]");
const MOCK_DB = "avc:mockcloud:v1";
let n = 0;

async function signedInWithCloudProject(page: Page, email = `acct${Date.now()}${++n}@example.com`) {
  await page.goto("/");
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(page.getByTestId("cloud-project-BrightPath Coaching")).toBeVisible();
  return email;
}
const dialog = (page: Page) => page.getByRole("dialog", { name: "Your projects" });

test("usage against the limits is shown", async ({ page }) => {
  await signedInWithCloudProject(page);
  await expect(page.getByTestId("usage-projects")).toHaveText("1 of 25");
  await expect(page.getByTestId("usage-storage")).toHaveText("0.0 MB of 200 MB");
  await expect(dialog(page).getByRole("progressbar", { name: "Projects" })).toHaveAttribute("aria-valuenow", "4");
});

test("the 26th project is refused with a friendly message, and nothing is lost", async ({ page }) => {
  await signedInWithCloudProject(page);
  // the account already holds 24 other projects (written straight into the mock server), so it is full with this one
  await page.evaluate((key) => {
    const db = JSON.parse(localStorage.getItem(key)!);
    const mine = db.projects[0];
    for (let i = 0; i < 24; i++) db.projects.push({ ...mine, id: `filler_${i}`, name: `Filler ${i}` });
    localStorage.setItem(key, JSON.stringify(db));
    (window as any).__cloud.getState().unlink(); // this device's copy is no longer linked, so it would be saved as a NEW project
  }, MOCK_DB);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "Save to cloud" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("limit of 25 projects");
  await expect(page.getByTestId("usage-projects")).toHaveText("25 of 25");
  await expect(frame(page).locator("h1")).toBeVisible(); // local work is untouched
});

test("download all my data: a zip with every project, the media list and a README", async ({ page }) => {
  await signedInWithCloudProject(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download all my data/ }).click()]);
  expect(dl.suggestedFilename()).toBe("my-data.zip");
  const files = unzipSync(new Uint8Array(await readFile((await dl.path())!)));
  const names = Object.keys(files);
  const projectFile = names.find((f) => f.startsWith("projects/") && f.endsWith(".json"))!;
  expect(projectFile).toBeTruthy();
  const project = JSON.parse(new TextDecoder().decode(files[projectFile]));
  expect(project.name).toBe("BrightPath Coaching");
  expect(project.schemaVersion).toBe(2);
  expect(names).toContain("media.json");
  expect(new TextDecoder().decode(files["README.txt"])).toContain("1 project file(s)");
  await expect(dialog(page).getByRole("status")).toContainText("Downloaded 1 project(s)");
});

test("deleting the account: needs the exact word, removes the cloud data, signs out, keeps the local project", async ({ page }) => {
  const email = await signedInWithCloudProject(page);
  await page.getByRole("button", { name: "Delete my account…" }).click();
  const confirm = page.getByRole("group", { name: "Confirm account deletion" });
  const go = confirm.getByRole("button", { name: "Permanently delete" });
  await expect(go).toBeDisabled();
  await confirm.getByLabel("Type DELETE to confirm").fill("delete");
  await expect(go).toBeDisabled(); // case matters
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId("cloud-project-BrightPath Coaching")).toBeVisible(); // cancelling deleted nothing

  await page.getByRole("button", { name: "Delete my account…" }).click();
  await confirm.getByLabel("Type DELETE to confirm").fill("DELETE");
  await go.click();

  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Your projects" })).toHaveCount(0);
  // the local copy is untouched and still editable
  await expect(frame(page).locator("h1")).toBeVisible();
  await page.getByRole("button", { name: "Heading" }).click();
  await expect(frame(page).locator("h2", { hasText: "New heading" })).toBeVisible();

  // signing in again with the same email gives a brand-new, empty account
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByTestId("sync-status")).toBeVisible();
  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByText("No cloud projects yet.")).toBeVisible();
  await expect(page.getByTestId("usage-projects")).toHaveText("0 of 25");
});

test("the real server route refuses everything it should, and reveals nothing", async ({ request }) => {
  const get = await request.get("/api/account");
  expect(get.status()).toBe(405);
  const del = await request.delete("/api/account", { data: { confirm: "DELETE" }, headers: { "content-type": "application/json", authorization: "Bearer mock.someone" } });
  // this test server has no service-role key, so deletion is simply unavailable (it must never pretend to succeed)
  expect(del.status()).toBe(503);
  expect(await del.json()).toMatchObject({ ok: false, code: "not_configured" });
  expect(await del.text()).not.toMatch(/service_role|SUPABASE|stack|node_modules/i);
});
