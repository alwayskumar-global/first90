import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { buildFromInterests, resetMock, startSample } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await resetMock(request);
  // Reduced motion also switches off colour transitions, so contrast is measured on settled colours.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  expect(summary, `${label} has WCAG violations`).toEqual([]);
}

test("every screen passes automated WCAG 2.2 AA checks (axe)", async ({ page }) => {
  await page.goto("/");
  await scan(page, "Welcome");
  await page.getByRole("button", { name: "Build my plan" }).click();
  await scan(page, "Location");
  await page.getByRole("radio", { name: /Five Points/ }).click();
  await scan(page, "Location (selected)");
  await page.getByRole("button", { name: "Continue" }).click();
  await scan(page, "Interests (empty)");

  await startSample(page);
  await scan(page, "Interests");
  await page.getByRole("textbox", { name: /Search interests/ }).fill("Haruki Murakami");
  await expect(page.getByText("could mean more than one thing")).toBeVisible();
  await scan(page, "Interests (ambiguous)");
  await page.getByRole("textbox", { name: /Search interests/ }).fill("zzqx");
  await expect(page.getByText("We couldn’t confirm “zzqx”")).toBeVisible();
  await scan(page, "Interests (unmatched)");
  await page.getByRole("textbox", { name: /Search interests/ }).fill("");

  await buildFromInterests(page);
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });
  await scan(page, "Plan");
  await page.getByRole("button", { name: /^View details for / }).first().click();
  await scan(page, "Plan (details open)");
  await page.getByRole("button", { name: /^Replace / }).first().click();
  await scan(page, "Replace dialog");
  await page.getByRole("button", { name: "Keep this suggestion", exact: true }).click();
  await page.getByRole("button", { name: /^See full details for / }).first().click();
  await expect(page).toHaveURL(/\/plan\/item/);
  await scan(page, "Place details");
});
