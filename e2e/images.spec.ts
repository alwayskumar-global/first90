import type { Locator, Page } from "@playwright/test";
import { allItems, buildFromInterests, expect, IMAGE_REQUESTS, resetMock, setMode, stageButton, startSample, test, type Session } from "./helpers";

// Mock places: c1 has a working image, c2's image URL fails to load, c3 has no image at all.
const CAFES = ["mock-c1", "mock-c2", "mock-c3"];
const NAMES = { ok: "Mock Morning Cafe", broken: "Mock Corner Cafe", none: "Mock Slow Roast" } as const;

test.beforeEach(async ({ request }) => {
  await resetMock(request);
  IMAGE_REQUESTS.length = 0;
});

async function buildCafePlan(page: Page, request: Parameters<typeof setMode>[0]): Promise<Session> {
  await startSample(page);
  await setMode(request, { mode: "only", ids: CAFES });
  const session = await buildFromInterests(page);
  await expect(page.getByRole("heading", { name: /Some categories came up short|Your first 90 days in Raleigh/ }).first()).toBeVisible({ timeout: 45_000 });
  if (/\/building/.test(page.url())) await page.getByRole("button", { name: "View my plan" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  return session;
}

/** The card for a place, switching stage until it is on screen. */
async function card(page: Page, name: string): Promise<Locator> {
  for (const index of [0, 1, 2] as const) {
    await stageButton(page, index).click();
    const article = page.locator("article").filter({ has: page.locator(".f90-place__name", { hasText: name }) });
    if (await article.count()) return article;
  }
  throw new Error(`${name} is not in the plan`);
}

test("a place with a working image shows its photo, modestly credited; the others keep the category tile", async ({ page, request }) => {
  const session = await buildCafePlan(page, request);
  const byName = (name: string) => allItems(session).find((i) => session.candidates[i.qlooEntityId]?.name === name)!;
  expect(byName(NAMES.ok)).toMatchObject({ imageSource: "qloo", imageUrl: "https://images.qloo.com/i/mock-ok-mock-c1" });
  expect(byName(NAMES.none).imageUrl).toBeUndefined();

  const ok = await card(page, NAMES.ok);
  const photo = ok.locator(".f90-place__photo img");
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute("alt", NAMES.ok);
  await expect(photo).toHaveAttribute("loading", "lazy");
  await expect(photo).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(ok.locator(".f90-place__photo-src")).toHaveText("Image via Qloo");
  await expect(ok.locator(".f90-place__tile")).toHaveCount(0);

  for (const name of [NAMES.broken, NAMES.none]) {
    const other = await card(page, name);
    await expect(other.locator(".f90-place__tile")).toBeVisible();
    await expect(other.locator("img")).toHaveCount(0); // never a broken-image icon
  }
});

test("an image that fails in the browser falls back to the tile without a broken icon", async ({ page, request }) => {
  await buildCafePlan(page, request);
  const broken = await card(page, NAMES.broken);
  await expect(broken.locator(".f90-place__tile")).toBeVisible();
  await expect(broken.locator("img")).toHaveCount(0);
  expect(IMAGE_REQUESTS.some((r) => r.url.includes("mock-broken-mock-c2"))).toBe(true); // it was tried, then dropped
  const dead = await page.locator("img").evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0).length);
  expect(dead).toBe(0); // every <img> still on the page really loaded
});

test("photos are requested without a referrer and only from the image host", async ({ page, request }) => {
  await buildCafePlan(page, request);
  await card(page, NAMES.ok);
  await expect.poll(() => IMAGE_REQUESTS.length).toBeGreaterThan(0);
  expect(IMAGE_REQUESTS.every((r) => r.referer === undefined)).toBe(true);
  expect(IMAGE_REQUESTS.every((r) => new URL(r.url).host === "images.qloo.com")).toBe(true);
});

test("the place details screen shows a large photo with its credit, or the category panel with an honest line", async ({ page, request }) => {
  await buildCafePlan(page, request);
  const open = async (name: string) => {
    const article = await card(page, name);
    await article.getByRole("button", { name: /^View details for / }).click();
    await page.getByRole("button", { name: /^See full details for / }).click();
    await expect(page).toHaveURL(/\/plan\/item/);
  };

  await open(NAMES.ok);
  const hero = page.locator(".f90-place__photo--hero img");
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute("alt", NAMES.ok);
  await expect.poll(() => hero.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("Image via Qloo. It may not show the place as it is today.")).toBeVisible();
  await expect(page.getByText("We don’t show photos of places")).toHaveCount(0);

  await page.goBack();
  await open(NAMES.none);
  await expect(page.locator(".f90-place__photo--hero")).toHaveCount(0);
  await expect(page.getByText("We only show a photo when a source provides one we can verify. There isn’t one for this place.")).toBeVisible();

  await page.goBack();
  await open(NAMES.broken);
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.getByText("There isn’t one for this place.")).toBeVisible();
});

test("images survive save, replace, undo and a refresh; a replacement shows its own image or tile", async ({ page }) => {
  await startSample(page);
  const session = await buildFromInterests(page);
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });
  const withImage = allItems(session).filter((i) => i.imageUrl);
  expect(withImage.length).toBeGreaterThan(0);

  const photos = page.locator("article .f90-place__photo img");
  await expect(photos.first()).toBeVisible();
  const before = await photos.count();
  await page.getByRole("button", { name: /^Save / }).first().click();
  await expect(photos).toHaveCount(before);

  await page.reload();
  await expect(photos.first()).toBeVisible();

  await page.getByRole("button", { name: /^Replace / }).first().click();
  await page.getByRole("radio", { name: /Too far/ }).click();
  await page.getByRole("button", { name: /^Replace with another|^Find another|^Replace$/ }).last().click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Undo replacing / }).click();
  await expect(photos).toHaveCount(before);
  // every card is either a photo that loaded, or a tile; never an <img> that is broken
  await expect(page.locator("article .f90-place__photo img, article .f90-place__tile").first()).toBeVisible();
  const broken = await page.locator("article img").evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth === 0).length);
  expect(broken).toBe(0);
});

test("a swapped image URL in a signed session is rejected by the server", async ({ page, request }) => {
  const session = await buildCafePlan(page, request);
  const item = allItems(session).find((i) => i.imageUrl)!;
  const tampered = structuredClone(session);
  for (const stage of Object.values(tampered.plan.stages)) for (const it of stage) if (it.id === item.id) it.imageUrl = "https://tracker.example.com/pixel.png";
  const response = await request.post("/api/plan", { data: { action: "revise", session: tampered, feedback: { itemId: item.id, action: "save" } } });
  expect(response.status()).toBe(400);
  expect(((await response.json()) as { kind: string }).kind).toBe("bad_session");
  const bad = structuredClone(session);
  for (const stage of Object.values(bad.plan.stages)) for (const it of stage) if (it.id === item.id) it.imageUrl = "http://images.qloo.com/insecure.png";
  expect((await request.post("/api/plan", { data: { action: "revise", session: bad, feedback: { itemId: item.id, action: "save" } } })).status()).toBe(400);
});

test("photos fit the screen: no horizontal scroll and the image stays inside its card", async ({ page, request }) => {
  await buildCafePlan(page, request);
  const ok = await card(page, NAMES.ok);
  const box = await ok.locator(".f90-place__photo").boundingBox();
  const cardBox = await ok.boundingBox();
  expect(box && cardBox && box.width <= cardBox.width + 1).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
