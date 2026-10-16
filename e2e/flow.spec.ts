import { expect, test } from "@playwright/test";
import { allItems, articles, buildFromInterests, resetMock, samplePlan, STAGE_HEADINGS, stageButton, startSample } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("primary flow: welcome to plan to place details, with three stages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Feel at home");
  await page.getByRole("button", { name: "Build my plan" }).click();

  await expect(page).toHaveURL(/\/location$/);
  await expect(page.getByRole("button", { name: "Continue" })).toHaveAttribute("aria-disabled", "true"); // needs an area
  await page.getByRole("radio", { name: /Five Points/ }).click();
  await page.getByRole("radio", { name: /Flexible/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/interests$/);
  await expect(page.getByRole("button", { name: "Continue to preferences" })).toHaveAttribute("aria-disabled", "true");
  for (const example of ["Independent bookstores", "Korean food", "Coffee shops", "Quiet mornings"]) {
    await page.getByRole("button", { name: example, exact: true }).click();
  }
  await buildFromInterests(page);
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });

  for (const index of [0, 1, 2] as const) {
    await stageButton(page, index).click();
    await expect(page.getByRole("heading", { level: 2, name: STAGE_HEADINGS[index] })).toBeVisible();
    expect(await articles(page).count()).toBeGreaterThanOrEqual(1);
  }

  // Place details
  await stageButton(page, 0).click();
  await page.getByRole("button", { name: /^View details for / }).first().click();
  await page.getByRole("button", { name: /^See full details for / }).click();
  await expect(page).toHaveURL(/\/plan\/item/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Why this fits").first()).toBeVisible();
  await expect(page.getByText("Check current hours, prices, and details before visiting.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Save this place/ })).toBeVisible();
  await page.getByRole("button", { name: "Back to my plan" }).click();
  await expect(page).toHaveURL(/\/plan$/);
});

test("plan and answers survive a refresh (browser storage only, no secrets)", async ({ page }) => {
  await samplePlan(page);
  const routine = await articles(page).first().getByRole("heading", { level: 3 }).innerText();
  await page.reload();
  await expect(articles(page).first().getByRole("heading", { level: 3 })).toHaveText(routine);
  const stored = await page.evaluate(() => window.localStorage.getItem("f90.flow.v1") ?? "");
  expect(stored).toContain("indie bookstores");
  expect(stored).not.toMatch(/mock-key|e2e-session-secret/);
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/plan");
  await expect(page).toHaveURL(/\/$/); // nothing left to show
});

test("a named interest that matches several things asks which one, then uses the choice", async ({ page }) => {
  await startSample(page);
  await page.getByRole("textbox", { name: /Search interests/ }).fill("Haruki Murakami");
  await expect(page.getByText("could mean more than one thing")).toBeVisible();
  await page.getByRole("button", { name: /Haruki Murakami · Author/ }).click();
  await expect(page.getByText("Author", { exact: true })).toBeVisible();
  const session = await buildFromInterests(page);
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });
  expect(session.plan.input.confirmations).toEqual({ "Haruki Murakami": "mock-e-author" });
  await expect(page.locator(".f90-why", { hasText: "Your pick “Haruki Murakami” contributed to how Qloo ranked it" }).first()).toBeVisible();
});

test("an interest we cannot match is kept as the user's own words and never presented as a match", async ({ page }) => {
  await startSample(page);
  await page.getByRole("textbox", { name: /Search interests/ }).fill("zzqx");
  await expect(page.getByText("We couldn’t confirm “zzqx”")).toBeVisible();
  await page.getByRole("button", { name: "Keep as my own words" }).click();
  await expect(page.getByText("Your words", { exact: true })).toBeVisible();
  // earlier answers are still there
  await expect(page.getByText("indie bookstores").first()).toBeVisible();
  const session = await buildFromInterests(page);
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });
  expect(session.notes.join(" ")).toContain("“zzqx” matched nothing in Qloo and was not used");
  expect(allItems(session).length).toBeGreaterThan(0);
  await expect(page.getByText("matched nothing in Qloo and was not used")).toBeVisible();
});

test("interests are capped at five and duplicates are ignored", async ({ page }) => {
  await startSample(page); // four interests
  await page.getByRole("button", { name: "Art museums", exact: true }).click();
  await expect(page.getByText(/5 selected/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Search interests/ })).toBeDisabled();
  await expect(page.getByText("You’ve added five")).toBeVisible();
});
