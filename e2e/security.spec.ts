import { expect, test, allItems, resetMock, served, stageButton, type Session } from "./helpers";

const input = {
  interests: ["indie bookstores", "Korean food", "coffee shops", "quiet mornings"],
  areaKey: "raleigh-nc", radiusMeters: 15000, categories: ["cafe", "bookstore", "restaurant", "museum"], cuisineTagId: "urn:tag:genre:place:restaurant:korean",
  atmosphere: "no_preference", preferMornings: false,
};

async function buildViaApi(request: import("@playwright/test").APIRequestContext): Promise<{ session: Session; raw: string }> {
  const response = await request.post("/api/plan", { data: { action: "build", input } });
  const raw = await response.text();
  const result = raw.trim().split("\n").map((l) => JSON.parse(l)).find((l) => l.type === "result");
  return { session: result.session as Session, raw };
}

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("tampered or unsigned sessions are rejected with 400", async ({ request }) => {
  const { session } = await buildViaApi(request);
  const item = session.plan.stages.first_week[0]!;
  const feedback = { itemId: item.id, action: "replace", reason: "too_far" };
  const post = (s: unknown) => request.post("/api/plan", { data: { action: "revise", session: s, feedback } });

  expect((await post(session)).status()).toBe(200);
  const renamed = structuredClone(session);
  renamed.candidates[item.qlooEntityId]!.name = "Invented Place";
  const unsigned = structuredClone(session);
  delete unsigned.signature;
  const reworded = structuredClone(session);
  reworded.plan.stages.first_week[0]!.why = "A 99% match";
  for (const bad of [renamed, unsigned, reworded]) {
    const response = await post(bad);
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ kind: "bad_session" });
  }
});

test("diagnostics routes are hidden in production", async ({ request }) => {
  expect((await request.get("/api/diagnostics/plan?scenarios=1")).status()).toBe(404);
  expect((await request.post("/api/diagnostics/plan", { data: {} })).status()).toBe(404);
  expect((await request.get("/api/diagnostics/qloo?category=cafe")).status()).toBe(404);
});

test("every recommended place traces to an entity Qloo returned, with unaltered facts and no invented ones", async ({ request }) => {
  const { session, raw } = await buildViaApi(request);
  const fromQloo = await served(request);
  const items = allItems(session);
  expect(items.length).toBeGreaterThanOrEqual(6);
  for (const item of items) {
    const real = fromQloo[item.qlooEntityId];
    expect(real, `${item.qlooEntityId} was not returned by Qloo`).toBeTruthy();
    const candidate = session.candidates[item.qlooEntityId]!;
    expect(candidate.name).toBe(real!.name);
    expect(candidate.address).toBe(real!.address);
    expect(candidate.priceLevel ?? null).toBe(real!.price);
    expect(item.externalUrl ?? null).toBe(real!.website);
    expect(candidate.evidence.distanceMeters).toBe(real!.distance);
    // wording: no scores, odds or promises; distances match Qloo's number
    expect(`${item.why} ${item.routine}`).not.toMatch(/%|percent|probab|guarantee|chance|rating|stars|reviews/i);
    const km = item.why.match(/about (\d+\.\d) km/);
    if (km) expect(Number(km[1])).toBeCloseTo(real!.distance / 1000, 1);
    expect(item.notices).toContain("Check current hours, prices, and details before visiting.");
  }
  expect(new Set(items.map((i) => i.qlooEntityId)).size).toBe(items.length); // no duplicates
  // secrets never reach the response
  expect(raw).not.toMatch(/mock-key|e2e-session-secret/);
});

test("the visible plan text contains no invented hours, ratings, events, scores or promises", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample plan" }).click();
  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page).toHaveURL(/\/plan$/, { timeout: 45_000 });
  for (const index of [0, 1, 2] as const) {
    await stageButton(page, index).click();
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/%|percent|probab|guarantee|\bchance\b/i);
    expect(text).not.toMatch(/\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i); // no hours
    expect(text).not.toMatch(/\b(open (now|today|until)|opens at|closes (at|early)|closing time|tickets?|reserv\w*|book (a|your) table|rating|stars?|reviews?)\b/i);
    expect(text).not.toMatch(/\bevent\b(?!s?\s+not)/i);
  }
});

test("without a Qloo key the API fails cleanly (503) and the UI keeps the user's answers", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4012" });
  const api = await context.request.post("/api/plan", { data: { action: "build", input } });
  expect(api.status()).toBe(503);
  const body = await api.text();
  expect(body).not.toMatch(/QLOO_API_KEY|mock-key|SESSION_SECRET|stack/);

  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample plan" }).click();
  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByRole("heading", { name: "Your answers are saved" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("The problem was on our side, not yours.")).toBeVisible();
  await page.getByRole("button", { name: "Edit preferences" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).first().click();
  await expect(page.getByText("Korean food").first()).toBeVisible();
  await context.close();
});

test("heavy use from one visitor is throttled with Retry-After and a calm message", async ({ browser }, testInfo) => {
  // a distinct visitor address per viewport project, so the two projects never share a throttle window
  const visitor = testInfo.project.name === "mobile" ? "198.51.100.8" : "198.51.100.7";
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4013", extraHTTPHeaders: { "x-forwarded-for": visitor } });
  const codes: number[] = [];
  for (let i = 0; i < 3; i++) {
    const response = await context.request.post("/api/plan", { data: { action: "build", input } });
    await response.text();
    codes.push(response.status());
    if (response.status() === 429) expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
  }
  expect(codes).toEqual([200, 200, 429]);

  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Try a sample plan" }).click();
  await page.getByRole("button", { name: "Continue to preferences" }).click();
  await page.getByRole("button", { name: "Build my plan" }).click();
  await expect(page.getByRole("heading", { name: "Your answers are saved" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/You’re going a little fast|Please wait/)).toBeVisible();
  await context.close();
});

test("responses carry a Content Security Policy that allows only this app and the tile host", async ({ request }) => {
  const response = await request.get("/");
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("connect-src 'self' https://tiles.openfreemap.org");
  expect(csp).toContain("img-src 'self' data: blob: https:"); // place photos: images only, https only
  expect(csp).not.toMatch(/\*|unsafe-eval|photon|komoot/); // production policy: no wildcard, no eval, no direct geocoder access
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});

test("place search validates input, works without a Qloo key, and is throttled per visitor", async ({ browser, request }, testInfo) => {
  expect((await request.get("/api/geocode?q=a")).status()).toBe(400);
  expect((await request.get("/api/geocode")).status()).toBe(400);
  const noKey = await request.get("http://127.0.0.1:4012/api/geocode?q=hillsborough"); // app started with no QLOO_API_KEY
  expect(noKey.status()).toBe(200);
  expect(((await noKey.json()) as { results: unknown[] }).results.length).toBeGreaterThan(0);

  const visitor = testInfo.project.name === "mobile" ? "198.51.100.18" : "198.51.100.17";
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4013", extraHTTPHeaders: { "x-forwarded-for": visitor } });
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const response = await context.request.get("/api/geocode?q=hillsborough");
    codes.push(response.status());
    if (response.status() === 429) expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
  }
  expect(codes).toEqual([200, 200, 200, 429]);
  await context.close();
});

test("a tampered or out-of-area searched place is rejected by the server", async ({ request }) => {
  const input = {
    interests: ["coffee shops"], areaKey: "raleigh-nc", radiusMeters: 5000, categories: ["cafe"], atmosphere: "no_preference", preferMornings: false,
  };
  const build = (customArea: unknown, extra: object = {}) => request.post("/api/plan", { data: { action: "build", input: { ...input, customArea, ...extra } } });
  expect((await build({ lat: 35.2271, lon: -80.8431, label: "Charlotte Uptown" })).status()).toBe(400);
  expect((await build({ lat: 35.78, lon: -78.64, label: "<img src=x onerror=alert(1)>" })).status()).toBe(400);
  expect((await build({ lat: 35.78, lon: -78.64, label: "Both" }, { neighborhoodKey: "five-points" })).status()).toBe(400);
});
