import { expect, test } from "@playwright/test";

test("without a backend configured there is no sign-in, projects or sync UI, and editing works", async ({ page }) => {
  await page.goto("/");
  const frame = page.frameLocator("iframe[title=Canvas]");
  await expect(frame.locator("h1")).toBeVisible();
  await page.waitForTimeout(500);
  for (const name of ["Sign in", "Projects", "Sign out"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
  await expect(page.getByTestId("sync-status")).toHaveCount(0);
  await page.getByRole("button", { name: "Heading" }).click();
  await expect(frame.locator("h2", { hasText: "New heading" })).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("Saved ✓");
});
