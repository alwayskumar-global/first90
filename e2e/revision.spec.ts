import { expect, test } from "@playwright/test";
import { articles, chooseReason, openReplace, placeNameOf, resetMock, routineOf, samplePlan } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("save one item, replace another: the saved item stays, Undo restores, and it all survives a refresh", async ({ page }) => {
  await samplePlan(page);
  const savedName = await placeNameOf(page, 0);
  const otherName = await placeNameOf(page, 1);

  await articles(page).nth(0).getByRole("button", { name: /^Save / }).click();
  await expect(articles(page).nth(0).getByRole("button", { name: /^Saved: / })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Saved/ })).toContainText("(1)");

  await openReplace(page, 1);
  await chooseReason(page, "Too far");
  await expect(page.getByText("Updated based on your feedback")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await placeNameOf(page, 1)).not.toBe(otherName);
  expect(await placeNameOf(page, 0)).toBe(savedName); // the saved item did not move or change
  await expect(articles(page).nth(0).getByRole("button", { name: /^Saved: / })).toBeVisible();
  await expect(page.getByText("Distance limit reduced to 7.5 km").first()).toBeVisible();

  await page.getByRole("button", { name: /^Undo replacing / }).click();
  await expect(page.getByText("Updated based on your feedback")).toBeHidden();
  expect(await placeNameOf(page, 1)).toBe(otherName);

  await page.reload();
  expect(await placeNameOf(page, 0)).toBe(savedName);
  await expect(articles(page).nth(0).getByRole("button", { name: /^Saved: / })).toBeVisible();
});

test("every structured reason revises only the chosen item, never the saved one, and never repeats a dismissed place", async ({ page }) => {
  await samplePlan(page);
  const savedName = await placeNameOf(page, 0);
  await articles(page).nth(0).getByRole("button", { name: /^Save / }).click();

  for (const reason of ["Too expensive", "Too lively", "Not interested", "Too far"]) {
    await openReplace(page, 2);
    await chooseReason(page, reason);
    // Either the item is replaced, or Qloo has no verified alternate and says so; both leave the saved item alone.
    const noMatch = page.getByText("We couldn’t find another match");
    await Promise.race([
      page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30_000 }).catch(() => undefined),
      noMatch.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    ]);
    if (await noMatch.isVisible()) await page.getByRole("button", { name: "Keep the original" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await placeNameOf(page, 0)).toBe(savedName);
    await expect(articles(page).nth(0).getByRole("button", { name: /^Saved: / })).toBeVisible();
    const names = await page.locator(".f90-place__name").allInnerTexts();
    expect(new Set(names).size).toBe(names.length); // never the same place twice
  }
  expect(await routineOf(page, 0)).toBeTruthy();
});

test("a replacement with no verified alternate says so and leaves the plan exactly as it was", async ({ page, request }) => {
  const session = await samplePlan(page);
  const ids = [...session.plan.stages.first_week, ...session.plan.stages.first_month, ...session.plan.stages.months_2_3].map((i) => i.qlooEntityId);
  const before = await page.locator(".f90-place__name").allInnerTexts();
  await request.post("http://127.0.0.1:4010/__mode", { data: { mode: "only", ids } }); // Qloo now offers nothing new

  await openReplace(page, 1);
  await chooseReason(page, "Too far");
  await expect(page.getByText("We couldn’t find another match with those preferences")).toBeVisible();
  await expect(page.getByText("We haven’t loosened your choice or made up a replacement.")).toBeVisible();
  await page.getByRole("button", { name: "Keep the original" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(await page.locator(".f90-place__name").allInnerTexts()).toEqual(before);
});
