import { describe, expect, it } from "vitest";
import { STAGE_KEYS, type PlanSession } from "@/domain/types";
import { evaluateSession } from "@/lib/agent/rubric";
import { buildPlan, validateTasteInput, WorkflowError } from "@/lib/agent/workflow";
import { QlooError } from "@/lib/qloo/errors";
import { BASE_INPUT, BOOK_TAG, CAFE_TAG, KOREAN_TAG, MUSEUM_TAG, fakeClient, largeRaw } from "./helpers";

const itemsOf = (session: PlanSession) => STAGE_KEYS.flatMap((stage) => session.plan.stages[stage]);
const build = (raw = largeRaw(), input = BASE_INPUT) => {
  const fake = fakeClient(raw);
  return { fake, result: buildPlan({ client: fake.client }, input) };
};

describe("buildPlan", () => {
  it("runs the five observable steps in order and builds a valid, fully grounded plan", async () => {
    const { result } = build();
    const { session, trace } = await result;
    expect(trace.map((step) => step.id)).toEqual([
      "resolve_interests",
      "discover_places",
      "apply_constraints",
      "construct_plan",
      "explain",
    ]);
    expect(trace.every((step) => step.status === "done" && step.durationMs >= 0)).toBe(true);
    expect(itemsOf(session)).toHaveLength(9);
    expect(evaluateSession(session).allPass).toBe(true);
    expect(JSON.stringify(trace)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // no raw ids in the progress trace
  });

  it("applies 'quiet mornings' as a preference and says so; never searches it in Qloo", async () => {
    const { fake, result } = build();
    const { session } = await result;
    expect(session.plan.input.atmosphere).toBe("quiet");
    expect(session.plan.input.preferMornings).toBe(true);
    expect(session.notes.join(" ")).toContain("quiet mornings");
    expect(fake.client.tags).not.toHaveBeenCalled();
  });

  it("queries each category with its own tag filter, the other picks as tag signals, and an explicit radius", async () => {
    const { fake, result } = build();
    await result;
    const calls = fake.placeInsights.mock.calls.map(([params]) => params as Record<string, string | number | boolean | undefined>);
    expect(calls).toHaveLength(4);
    const cafe = calls.find((p) => p["filter.tags"] === CAFE_TAG)!;
    expect(cafe["filter.location.radius"]).toBe(15_000);
    expect(cafe["signal.interests.tags"]).toBe(`${BOOK_TAG},${KOREAN_TAG}`); // own tag left out
    expect(cafe["feature.explainability"]).toBeUndefined(); // explainability only with entity signals
    const museum = calls.find((p) => p["filter.tags"] === MUSEUM_TAG)!;
    expect(String(museum["signal.interests.tags"]).split(",").sort()).toEqual([BOOK_TAG, CAFE_TAG, KOREAN_TAG].sort());
  });

  it("requests explainability when an entity interest is present, and uses the attribution", async () => {
    const raw = largeRaw();
    for (const list of Object.values(raw)) {
      for (const entity of list as { query: Record<string, unknown> }[]) {
        entity.query["explainability"] = { "signal.interests.entities": [{ entity_id: "E-AUTHOR", score: 1 }] };
      }
    }
    const fake = fakeClient(raw, {
      tags: async () => [],
      search: async () => [{ entity_id: "E-AUTHOR", name: "Haruki Murakami", types: ["urn:entity:author"] }],
    });
    const { session } = await buildPlan(
      { client: fake.client },
      { ...BASE_INPUT, interests: ["indie bookstores", "Haruki Murakami"] },
    );
    const params = fake.placeInsights.mock.calls[0]![0] as Record<string, unknown>;
    expect(params["signal.interests.entities"]).toBe("E-AUTHOR");
    expect(params["feature.explainability"]).toBe(true);
    expect(itemsOf(session).every((item) => item.basis === "input_attribution")).toBe(true);
    expect(itemsOf(session)[0]!.why).toContain("Your pick “Haruki Murakami” contributed");
  });

  it("asks for confirmation on an ambiguous interest, keeps building, and honors a later confirmation", async () => {
    const entities = [
      { entity_id: "E-artist", name: "Haruki Murakami", types: ["urn:entity:artist"] },
      { entity_id: "E-author", name: "Haruki Murakami", types: ["urn:entity:author"] },
    ];
    const fake = fakeClient(largeRaw(), { search: async () => entities, tags: async () => [] });
    const input = { ...BASE_INPUT, interests: ["indie bookstores", "Haruki Murakami"] };
    const first = await buildPlan({ client: fake.client }, input);
    expect(first.session.needsConfirmation.map((entry) => entry.input)).toEqual(["Haruki Murakami"]);
    expect(itemsOf(first.session).length).toBeGreaterThan(0);
    expect(first.trace[0]!.status).toBe("partial");
    const second = await buildPlan({ client: fake.client }, { ...input, confirmations: { "Haruki Murakami": "E-author" } });
    expect(second.session.needsConfirmation).toEqual([]);
    expect(second.session.signals.some((signal) => signal.id === "E-author")).toBe(true);
  });

  it("notes an unmatched interest and still builds", async () => {
    const { result } = build(largeRaw(), { ...BASE_INPUT, interests: ["indie bookstores", "zzqx"] });
    const { session } = await result;
    expect(session.notes.join(" ")).toContain("“zzqx” matched nothing in Qloo");
    expect(itemsOf(session).length).toBeGreaterThan(0);
  });

  it("drops off-category noise and reports it in the constraints step", async () => {
    const { result } = build();
    const { session, trace } = await result;
    const ids = itemsOf(session).map((item) => item.qlooEntityId);
    for (const noise of ["c4", "b4", "k4", "m3"]) expect(ids).not.toContain(noise);
    expect(trace.find((step) => step.id === "apply_constraints")!.counts!["offCategoryRemoved"]).toBe(4);
  });

  it("applies the radius and price ceiling as hard limits; unpriced museums survive and are flagged", async () => {
    const { result } = build(largeRaw(), { ...BASE_INPUT, radiusMeters: 7_500, maxPriceLevel: 1 });
    const { session } = await result;
    const candidates = Object.values(session.candidates);
    expect(candidates.every((c) => (c.evidence.distanceMeters ?? Infinity) <= 7_500)).toBe(true);
    expect(candidates.filter((c) => c.priceLevel !== undefined).every((c) => c.priceLevel! <= 1)).toBe(true);
    const museums = itemsOf(session).filter((item) => item.category === "museum");
    expect(museums.length).toBeGreaterThan(0);
    expect(museums.every((item) => item.notices.some((n) => n.startsWith("Price not available")))).toBe(true);
    expect(evaluateSession(session).allPass).toBe(true);
  });

  it("sends no price filter to Qloo for museums (it has no prices for them)", async () => {
    const { fake, result } = build(largeRaw(), { ...BASE_INPUT, maxPriceLevel: 2 });
    await result;
    const calls = fake.placeInsights.mock.calls.map(([p]) => p as Record<string, unknown>);
    expect(calls.find((p) => p["filter.tags"] === MUSEUM_TAG)!["filter.price_level.max"]).toBeUndefined();
    expect(calls.find((p) => p["filter.tags"] === CAFE_TAG)!["filter.price_level.max"]).toBe(2);
  });

  it("explains an empty category instead of silently dropping it", async () => {
    const raw = largeRaw();
    raw[BOOK_TAG] = []; // Qloo returns nothing for bookstores
    const { result } = build(raw);
    const { session } = await result;
    expect(session.notes.join(" ")).toContain("No verified bookstores met your limits");
  });

  it("explains an empty category under a price ceiling (Qloo drops places with no listed price)", async () => {
    const raw = largeRaw();
    raw[CAFE_TAG] = [];
    const { result } = build(raw, { ...BASE_INPUT, maxPriceLevel: 2 });
    const { session } = await result;
    expect(session.notes.join(" ")).toContain("No verified cafés met your limits (Qloo returned none at or below $$");
  });

  it("CR-004: keeps unpriced bookstores under a price ceiling, flagged, and sends Qloo no price filter for them", async () => {
    const { fake, result } = build(largeRaw(), { ...BASE_INPUT, maxPriceLevel: 1 });
    const { session } = await result;
    const bookstores = itemsOf(session).filter((item) => item.category === "bookstore");
    expect(bookstores.length).toBeGreaterThan(0);
    for (const item of bookstores) {
      const price = session.candidates[item.qlooEntityId]!.priceLevel;
      if (price === undefined) expect(item.notices).toContain("Price not available \u2014 check current details.");
      else expect(price).toBeLessThanOrEqual(1);
    }
    const calls = fake.placeInsights.mock.calls.map(([p]) => p as Record<string, unknown>);
    expect(calls.find((p) => p["filter.tags"] === BOOK_TAG)!["filter.price_level.max"]).toBeUndefined();
    expect(evaluateSession(session).checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("keeps working when one category fails, and says which", async () => {
    const raw: Record<string, unknown[] | Error> = { ...largeRaw(), [KOREAN_TAG]: new QlooError("server", "boom", { status: 503 }) };
    const fake = fakeClient(raw);
    const { session, trace } = await buildPlan({ client: fake.client }, BASE_INPUT);
    expect(trace.find((step) => step.id === "discover_places")!.status).toBe("partial");
    expect(session.notes.join(" ")).toContain("Could not load: Korean restaurants");
    expect(itemsOf(session).some((item) => item.category === "restaurant")).toBe(false);
    expect(itemsOf(session).length).toBeGreaterThan(0);
  });

  it("fails clearly (retryable) when every category fails", async () => {
    const down = new QlooError("timeout", "slow");
    const fake = fakeClient({ [CAFE_TAG]: down, [BOOK_TAG]: down, [KOREAN_TAG]: down, [MUSEUM_TAG]: down });
    const error = await buildPlan({ client: fake.client }, BASE_INPUT).catch((e) => e);
    expect(error).toBeInstanceOf(WorkflowError);
    expect(error).toMatchObject({ kind: "all_failed", retryable: true });
  });

  it("never has more than two Qloo requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const raw = largeRaw();
    const fake = fakeClient({}, {
      placeInsights: async (params) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return raw[String(params["filter.tags"])] ?? [];
      },
    });
    await buildPlan({ client: fake.client }, BASE_INPUT);
    expect(peak).toBe(2);
  });

  it("stops on a rate limit instead of continuing (no retry storm)", async () => {
    const limited = new QlooError("rate_limit", "slow down", { status: 429 });
    const fake = fakeClient({ ...largeRaw(), [BOOK_TAG]: limited });
    const error = await buildPlan({ client: fake.client }, BASE_INPUT).catch((e) => e);
    expect(error).toMatchObject({ kind: "rate_limit" });
  });

  it("returns a nonempty-notes empty plan (not an error) when nothing qualifies", async () => {
    const { result } = build(largeRaw(), { ...BASE_INPUT, radiusMeters: 1_000, maxPriceLevel: 1, categories: ["restaurant"] });
    const { session } = await result;
    expect(itemsOf(session)).toHaveLength(0);
    expect(session.notes.join(" ")).toContain("No verified places matched your limits");
  });

  it("anchors the search at a chosen neighborhood and names it in the explanation", async () => {
    const { fake, result } = build(largeRaw(), { ...BASE_INPUT, neighborhoodKey: "five-points" });
    const { session } = await result;
    const location = fake.placeInsights.mock.calls[0]![0]["filter.location"];
    expect(location).toBe("POINT(-78.6402 35.8056)");
    const withDistance = itemsOf(session).find((item) => item.why.includes("km from"))!;
    expect(withDistance.why).toContain("km from Five Points");
  });

  it("rejects an unknown neighborhood", () => {
    expect(() => validateTasteInput({ ...BASE_INPUT, neighborhoodKey: "narnia" })).toThrow(WorkflowError);
  });

  it("reports per-category coverage for the Building and partial states", async () => {
    const raw = largeRaw();
    raw[BOOK_TAG] = [];
    const { result } = build(raw);
    const { session } = await result;
    const by = Object.fromEntries((session.coverage ?? []).map((c) => [c.category, c]));
    expect(by["bookstore"]).toMatchObject({ loaded: true, eligible: 0, inPlan: 0 });
    expect(by["cafe"]!.eligible).toBeGreaterThan(0);
    expect(by["cafe"]!.inPlan).toBeGreaterThan(0);
  });

  it("emits each step as it completes (used to stream progress)", async () => {
    const seen: string[] = [];
    await buildPlan({ client: fakeClient(largeRaw()).client, onStep: (step) => seen.push(step.id) }, BASE_INPUT);
    expect(seen).toEqual(["resolve_interests", "discover_places", "apply_constraints", "construct_plan", "explain"]);
  });

  it("is deterministic for identical input and Qloo data", async () => {
    const a = await build().result;
    const b = await build().result;
    expect(JSON.stringify(a.session)).toBe(JSON.stringify(b.session));
  });

  it("changing an interest visibly changes the plan", async () => {
    const swapped = { ...BASE_INPUT, interests: ["indie bookstores", "art museums", "coffee shops", "quiet mornings"] };
    const a = (await build().result).session;
    const b = (await build(largeRaw(), swapped).result).session;
    const count = (s: PlanSession, category: string) => itemsOf(s).filter((i) => i.category === category).length;
    expect(count(b, "museum")).toBeGreaterThanOrEqual(count(a, "museum"));
    expect(count(b, "restaurant")).toBeLessThanOrEqual(count(a, "restaurant"));
    expect(b.signals.map((s) => s.label)).not.toEqual(a.signals.map((s) => s.label));
  });
});

describe("input validation", () => {
  const bad = (patch: Partial<typeof BASE_INPUT>) => () => validateTasteInput({ ...BASE_INPUT, ...patch });
  it("rejects unsupported areas, empty or excessive interests, bad radius and no categories", () => {
    expect(bad({ areaKey: "seattle" })).toThrow(WorkflowError);
    expect(bad({ interests: [] })).toThrow(WorkflowError);
    expect(bad({ interests: ["a", "b", "c", "d", "e", "f"] })).toThrow(WorkflowError);
    expect(bad({ radiusMeters: 100 })).toThrow(WorkflowError);
    expect(bad({ categories: [] })).toThrow(WorkflowError);
  });
  it("accepts the demo input", () => expect(bad({})).not.toThrow());
});
