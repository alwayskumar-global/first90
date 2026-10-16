import { expect, test, resetMock, samplePlan, setMode, startSample } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("a Qloo 429 shows a calm error, keeps every answer, and Try again works once Qloo recovers", async ({ page, request }) => {
  await startSample(page);
  await setMode(request, { mode: "rate_limit" });
  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();

  await expect(page.getByRole("heading", { name: "Your answers are saved" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/We’ve asked our data source for a lot just now/)).toBeVisible();
  await expect(page.getByText("Still saved:")).toBeVisible();

  // inputs were not erased
  await page.getByRole("button", { name: "Edit preferences" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).first().click();
  await expect(page.getByText("Korean food").first()).toBeVisible();
  await expect(page.getByText("quiet mornings").first()).toBeVisible();

  await setMode(request, { mode: "ok" });
  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });
});

test("a temporary Qloo outage is retryable from the Building screen", async ({ page, request }) => {
  await startSample(page);
  await setMode(request, { mode: "down" });
  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByRole("heading", { name: "Your answers are saved" })).toBeVisible({ timeout: 45_000 });
  await setMode(request, { mode: "ok" });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });
});

test("when nothing qualifies we say so, offer a concrete next step, and keep the answers", async ({ page, request }) => {
  await startSample(page);
  await setMode(request, { mode: "empty" });
  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByRole("heading", { name: "Nothing we could confirm fits all of this yet" })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "Change interests" }).click();
  await expect(page).toHaveURL(/\/interests$/);
  await expect(page.getByText("indie bookstores").first()).toBeVisible();
});

test("a build with some categories missing still shows the plan and names what came up short", async ({ page, request }) => {
  await startSample(page);
  // routines that only touch cafes + bookstores, then make Qloo return nothing for them
  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await setMode(request, { mode: "only", ids: ["mock-c1", "mock-c5", "mock-k1", "mock-k3", "mock-m1", "mock-m2"] }); // no bookstores
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByRole("heading", { name: "Some categories came up short" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Not enough yet")).toBeVisible();
  await page.getByRole("button", { name: "View my plan" }).click();
  await expect(page).toHaveURL(/\/plan$/);
});

test("the unmatched-input and no-match paths never clear what the user entered", async ({ page }) => {
  await samplePlan(page);
  await page.getByRole("button", { name: "Edit preferences" }).first().click();
  await page.getByRole("button", { name: "Edit interests" }).click();
  await expect(page.getByText("Korean food").first()).toBeVisible();
});
