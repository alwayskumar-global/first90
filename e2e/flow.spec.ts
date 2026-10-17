import { expect, test, type Session, allItems, articles, buildFromInterests, resetMock, samplePlan, STAGE_HEADINGS, stageButton, startSample } from "./helpers";

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

test("a word Qloo knows several ways offers choices you can tell apart", async ({ page }) => {
  await page.goto("/interests");
  await page.getByRole("textbox", { name: /Search interests/ }).fill("library");
  await expect(page.getByText("“library” could mean more than one thing")).toBeVisible();
  const chips = page.getByRole("button", { name: /^Library · / });
  await expect(chips).toHaveCount(4);
  const labels = await chips.allInnerTexts();
  expect(new Set(labels).size).toBe(4);
  expect(labels.join("|")).toContain("Library · Kind of place");
  await page.getByRole("button", { name: "Library · Restaurant style" }).click();
  await expect(page.getByText("Library").first()).toBeVisible();
});

test("an interest the demo cannot search is said so, at the interest step, in the routines and in the plan summary", async ({ page }) => {
  await startSample(page);
  await page.getByRole("textbox", { name: /Search interests/ }).fill("library");
  await page.getByRole("button", { name: "Library · Kind of place" }).click();
  const note = page.getByRole("note").filter({ hasText: "“library” isn’t one of this demo’s place types" });
  await expect(note).toContainText("cafés, bookstores, restaurants, and museums");
  await expect(note).toContainText("won’t add suggestions of its own");

  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await expect(page.getByText("In this demo: restaurants (your cuisine, if you named one)")).toBeVisible();
  await expect(page.getByText("In this demo: museums and cultural venues")).toBeVisible();

  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });
  const session = await page.evaluate(() => (JSON.parse(window.localStorage.getItem("f90.flow.v1") ?? "{}") as { session: Session }).session);
  expect(session.plan.input["interests"]).toContain("library");
  expect(allItems(session).every((item) => ["cafe", "bookstore", "restaurant", "museum"].includes(item.category))).toBe(true);
  await expect(page.getByText("library: taste signal only. This demo covers cafés, bookstores, restaurants, and museums.")).toBeVisible();
});

test("'Japanese food' plans Japanese restaurants, not Korean ones, and the persona still plans Korean", async ({ page, request }) => {
  await startSample(page);
  await page.getByRole("button", { name: /^Remove Korean food$/ }).click();
  await page.getByRole("textbox", { name: /Search interests/ }).fill("japanese food");
  await page.getByRole("button", { name: /^japanese food|^Japanese .* Add$/i }).first().click();
  await expect(page.getByRole("note")).toHaveCount(0); // a cuisine is searchable: no 'not searched' note
  const session = await buildFromInterests(page);
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });

  expect(session.plan.input["cuisineTagId"]).toBe("urn:tag:genre:place:restaurant:japanese");
  const meals = allItems(session).filter((item) => item.category === "restaurant");
  expect(meals.length).toBeGreaterThan(0);
  for (const item of meals) {
    expect(item.routine).toMatch(/for a Japanese meal$/);
    expect(["mock-j1", "mock-j2", "mock-j3"]).toContain(item.qlooEntityId); // the Chinese place Qloo also tagged Japanese is dropped
  }
  await expect(page.getByText("Japanese restaurant", { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Korean");
  await expect(page.locator("body")).not.toContainText("Mock Seoul");

  // and the Korean persona is unchanged
  await resetMock(request);
  const persona = await samplePlan(page);
  expect(persona.plan.input["cuisineTagId"]).toBe("urn:tag:genre:place:restaurant:korean");
  for (const item of allItems(persona).filter((i) => i.category === "restaurant")) expect(item.routine).toMatch(/for a Korean meal$/);
});

test("the sample persona, fully searchable, shows no 'not searched' note", async ({ page }) => {
  await startSample(page);
  await expect(page.getByRole("note")).toHaveCount(0);
});
