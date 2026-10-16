import type { Page } from "@playwright/test";
import { buildFromInterests, expect, lastQloo, resetMock, setMode, startSample, stubTiles, test, TILES_URL } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const search = (page: Page) => page.getByRole("textbox", { name: /Neighborhood or area/ });

async function openLocation(page: Page) {
  await page.goto("/location");
  await expect(page.getByRole("heading", { level: 1, name: "Where are you settling in?" })).toBeVisible();
}

test("a real map loads, and searching finds a real place that is pinned with the distance circle", async ({ page }) => {
  await openLocation(page);
  await expect(page.locator("[data-map-state=ready]")).toBeVisible();
  await expect(page.getByText("© OpenStreetMap contributors, tiles by OpenFreeMap")).toBeVisible();

  await search(page).fill("hillsborough");
  const result = page.getByRole("radio", { name: /Hillsborough Street Lofts/ });
  await expect(result).toBeVisible();
  await expect(page.getByText("go through our server to Photon")).toBeVisible();
  await result.click();

  await expect(result).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".maplibregl-marker")).toContainText("Hillsborough Street Lofts");
  await expect(page.getByText("We’ll focus on places close to Hillsborough Street Lofts.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await expect(page.getByRole("status").filter({ hasText: "Ready: Hillsborough Street Lofts" })).toBeVisible();

  // the typed text went to our own server, bounded to the Raleigh box; nothing else carried it
  const sent = await lastQloo(page.request);
  expect(sent.geoQueries.length).toBeGreaterThan(0);
  expect(sent.geoQueries.every((query) => query.includes("bbox=-79") && query.includes("q=hillsborough"))).toBe(true);
});

test("the searched place is the plan's search center, is remembered on refresh, and words distances from its name", async ({ page, request }) => {
  await startSample(page);
  await page.goto("/location");
  await search(page).fill("hillsborough");
  await page.getByRole("radio", { name: /Hillsborough Street Lofts/ }).click();
  await page.getByRole("radio", { name: /Flexible/ }).click();

  await page.reload();
  await expect(page.getByRole("radio", { name: /Hillsborough Street Lofts/ })).toHaveAttribute("aria-checked", "true");

  await page.goto("/interests");
  await expect(page.getByText("indie bookstores").first()).toBeVisible();
  const session = await buildFromInterests(page);
  await expect(page.getByRole("heading", { level: 1, name: /Your first 90 days in Raleigh/ })).toBeVisible();

  expect(session.plan.input).toMatchObject({ customArea: { label: "Hillsborough Street Lofts", lat: 35.78145, lon: -78.65391 }, radiusMeters: 10_000 });
  expect(session.plan.input["neighborhoodKey"]).toBeUndefined();
  const qloo = await lastQloo(request);
  expect(qloo.lastLocation?.point).toContain("-78.65391");
  expect(qloo.lastLocation?.point).toContain("35.78145");
  expect(qloo.lastLocation?.radius).toBe("10000");
  await expect(page.locator("body")).toContainText("from Hillsborough Street Lofts");
});

test("our curated neighborhoods are still searchable and selectable, and replace a searched place", async ({ page }) => {
  await openLocation(page);
  await search(page).fill("hillsborough");
  await page.getByRole("radio", { name: /Hillsborough Street Lofts/ }).click();
  await search(page).fill("five");
  await page.getByRole("radio", { name: /Five Points/ }).click();
  await expect(page.getByRole("radio", { name: /Five Points/ })).toHaveAttribute("aria-checked", "true");
  await search(page).fill("hillsborough");
  await expect(page.getByRole("radio", { name: /Hillsborough Street Lofts/ })).toHaveAttribute("aria-checked", "false");
});

test("a place outside the Raleigh area is refused honestly, with ways forward", async ({ page }) => {
  await openLocation(page);
  await search(page).fill("charlotte");
  await expect(page.getByText("No area found for “charlotte”")).toBeVisible();
  await expect(page.getByText("covers the Raleigh area only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await page.getByRole("button", { name: "I’m not sure yet" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});

test("if place search is down, the curated areas stay selectable and the flow continues", async ({ page, request }) => {
  await setMode(request, { geo: "down" });
  await openLocation(page);
  await search(page).fill("hillsborough");
  await expect(page.getByText("Live place search isn’t available right now")).toBeVisible();
  await page.getByRole("radio", { name: /Five Points/ }).click();
  await expect(page.getByRole("radio", { name: /Five Points/ })).toHaveAttribute("aria-checked", "true");
  await expect(search(page)).toHaveValue("Five Points");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});

test("if the map tiles cannot load, the illustration takes over and area choice still works", async ({ page }) => {
  await page.route(TILES_URL, (route) => route.abort());
  await openLocation(page);
  await expect(page.locator("[data-map-state=fallback]")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Simplified illustration. Not a verified map.")).toBeVisible();
  await search(page).fill("hillsborough");
  await page.getByRole("radio", { name: /Hillsborough Street Lofts/ }).click();
  await expect(page.getByText("Hillsborough Street Lofts focus")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});

test("the browser talks only to this app and the tile host, and the page policy is never violated", async ({ page }) => {
  await stubTiles(page); // already stubbed by the fixture; this keeps the intent explicit
  const hosts = new Set<string>();
  const violations: string[] = [];
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  page.on("console", (message) => {
    if (/Content Security Policy|violates the following/i.test(message.text())) violations.push(message.text());
  });
  page.on("pageerror", (error) => violations.push(error.message));

  await openLocation(page);
  await expect(page.locator("[data-map-state=ready]")).toBeVisible();
  await search(page).fill("hillsborough");
  await page.getByRole("radio", { name: /Hillsborough Street Lofts/ }).click();
  await expect(page.locator(".maplibregl-marker")).toBeVisible();

  expect([...hosts].filter((host) => !host.startsWith("127.0.0.1")).sort()).toEqual(["tiles.openfreemap.org"]);
  expect(violations).toEqual([]);
});
