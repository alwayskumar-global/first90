import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const MOCK = "http://127.0.0.1:4010";

export const resetMock = (request: APIRequestContext) => request.get(`${MOCK}/__reset`);
export const setMode = (request: APIRequestContext, body: { mode: string; ids?: string[] }) => request.post(`${MOCK}/__mode`, { data: body });
export const served = async (request: APIRequestContext) =>
  (await (await request.get(`${MOCK}/__served`)).json()) as Record<string, { name: string; address: string; price: number | null; website: string | null; distance: number }>;

export interface Session {
  signature?: string;
  plan: { input: Record<string, unknown>; stages: Record<"first_week" | "first_month" | "months_2_3", Item[]>; dismissedEntityIds: string[] };
  candidates: Record<string, { name: string; address?: string; priceLevel?: number; website?: string; evidence: { distanceMeters?: number } }>;
  notes: string[];
}
export interface Item { id: string; qlooEntityId: string; routine: string; why: string; notices: string[]; externalUrl?: string; status: string; category: string }

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
