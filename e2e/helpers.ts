import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";

export { expect };

export const MOCK = "http://127.0.0.1:4010";

/** Map tiles come from a third-party host the tests must not depend on: answer its requests with an empty style. */
export const TILES_URL = "https://tiles.openfreemap.org/**";
export async function stubTiles(page: Page) {
  await page.route(TILES_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ version: 8, name: "e2e", sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#efede4" } }] }),
    }),
  );
}

/** Place photos: Qloo's image host is stubbed too. URLs containing "mock-broken" fail; the rest are a tiny valid PNG. */
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64");
export const IMAGE_REQUESTS: { url: string; referer: string | undefined }[] = [];
export async function stubPlaceImages(page: Page) {
  await page.route("https://images.qloo.com/**", (route) => {
    const request = route.request();
    IMAGE_REQUESTS.push({ url: request.url(), referer: request.headers()["referer"] });
    return request.url().includes("mock-broken")
      ? route.abort("failed")
      : route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG_1X1 });
  });
}

/** `test` with the tile host and the image host stubbed for every page. */
export const test = base.extend<{ stubbedTiles: void }>({
  stubbedTiles: [async ({ page }, use) => { await stubTiles(page); await stubPlaceImages(page); await use(); }, { auto: true }],
});

export const lastQloo = async (request: APIRequestContext) =>
  (await (await request.get(`${MOCK}/__last`)).json()) as { lastLocation: { point: string; radius: string } | null; geoQueries: string[] };

export const resetMock = (request: APIRequestContext) => request.get(`${MOCK}/__reset`);
export const setMode = (request: APIRequestContext, body: { mode?: string; ids?: string[]; geo?: string }) => request.post(`${MOCK}/__mode`, { data: body });
export const served = async (request: APIRequestContext) =>
  (await (await request.get(`${MOCK}/__served`)).json()) as Record<string, { name: string; address: string; price: number | null; website: string | null; distance: number }>;

export interface Session {
  signature?: string;
  plan: { input: Record<string, unknown>; stages: Record<"first_week" | "first_month" | "months_2_3", Item[]>; dismissedEntityIds: string[] };
  candidates: Record<string, { name: string; address?: string; priceLevel?: number; website?: string; evidence: { distanceMeters?: number } }>;
  notes: string[];
}
export interface Item { id: string; qlooEntityId: string; routine: string; why: string; notices: string[]; externalUrl?: string; status: string; category: string; imageUrl?: string; imageSource?: string }

export async function startSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample plan" }).click();
  await expect(page).toHaveURL(/\/interests$/);
  await expect(page.getByText("indie bookstores").first()).toBeVisible();
}

/**
 * Interests -> Preferences -> Build; returns the signed session from the /api/plan result. The response is read
 * inside a route handler (before it reaches the page) because its body is gone once the page navigates away.
 */
export async function buildFromInterests(page: Page): Promise<Session> {
  let resolveBody!: (body: string) => void;
  const bodyPromise = new Promise<string>((resolve) => (resolveBody = resolve));
  await page.route("**/api/plan", async (route) => {
    if (route.request().method() !== "POST" || !(route.request().postData() ?? "").includes('"action":"build"')) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    resolveBody(body);
    await route.fulfill({ response, body });
  });
  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await expect(page).toHaveURL(/\/preferences$/);
  await page.getByRole("button", { name: "Build my plan" }).click();
  const body = await bodyPromise;
  await page.unroute("**/api/plan");
  const lines = body.trim().split("\n").map((line) => JSON.parse(line) as { type: string; session?: Session });
  const result = lines.find((line) => line.type === "result");
  return (result?.session ?? null) as Session;
}

export async function samplePlan(page: Page): Promise<Session> {
  await startSample(page);
  const session = await buildFromInterests(page);
  await expect(page.getByRole("heading", { level: 1, name: /Your first 90 days in Raleigh/ })).toBeVisible();
  return session;
}

export const articles = (page: Page) => page.locator("article");
export const routineOf = (page: Page, index: number) => articles(page).nth(index).getByRole("heading", { level: 3 }).innerText();
export const placeNameOf = (page: Page, index: number) => articles(page).nth(index).locator(".f90-place__name").innerText();

export async function openReplace(page: Page, index: number) {
  await articles(page).nth(index).getByRole("button", { name: /^Replace / }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

export async function chooseReason(page: Page, reason: string) {
  await page.getByRole("radio", { name: new RegExp(reason) }).click();
  await page.getByRole("button", { name: "Find another place" }).click();
}

export const allItems = (session: Session): Item[] => [...session.plan.stages.first_week, ...session.plan.stages.first_month, ...session.plan.stages.months_2_3];

/** The three stage tabs (labels differ between desktop and the compact phone layout, so select by position). */
export const stageButton = (page: Page, index: 0 | 1 | 2) => page.getByRole("navigation", { name: "Your first 90 days" }).getByRole("button").nth(index);
export const STAGE_HEADINGS = ["First Week", "First Month", "Months 2–3"] as const;
