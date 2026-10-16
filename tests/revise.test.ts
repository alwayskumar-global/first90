import { beforeEach, describe, expect, it } from "vitest";
import { STAGE_KEYS, type Feedback, type PlanSession } from "@/domain/types";
import { evaluateSession } from "@/lib/agent/rubric";
import { FeedbackError } from "@/lib/agent/revise";
import { buildPlan, revisePlan } from "@/lib/agent/workflow";
import { BASE_INPUT, fakeClient, largeRaw, rawEntity, CAFE_TAG, KOREAN_TAG, MUSEUM_TAG, BOOK_TAG } from "./helpers";
import { createTtlCache, withCache } from "@/lib/qloo/cache";
import type { QlooClient } from "@/lib/qloo/client";

let client: QlooClient;
let calls: () => number;
let session: PlanSession;

const items = (s: PlanSession) => STAGE_KEYS.flatMap((stage) => s.plan.stages[stage]);
const find = (s: PlanSession, predicate: (id: string, s: PlanSession) => boolean) =>
  items(s).find((item) => predicate(item.qlooEntityId, s))!;
const replace = (itemId: string, reason?: Feedback["reason"]): Feedback => ({ itemId, action: "replace", ...(reason ? { reason } : {}) });

async function setup(raw = largeRaw(), input = BASE_INPUT) {
  const fake = fakeClient(raw);
  client = fake.client;
  calls = () => fake.placeInsights.mock.calls.length;
  session = (await buildPlan({ client }, input)).session;
}

describe("feedback and revision", () => {
  beforeEach(async () => setup());

  it("saves an item without touching Qloo or any other item", async () => {
    const before = calls();
    const target = items(session)[0]!;
    const { session: next, revision } = await revisePlan({ client }, session, { itemId: target.id, action: "save" });
    expect(calls()).toBe(before);
    expect(items(next).find((i) => i.id === target.id)!.status).toBe("saved");
    expect(items(next).filter((i) => i.id !== target.id)).toEqual(items(session).filter((i) => i.id !== target.id));
    expect(revision.after.stages).not.toEqual(revision.before.stages);
  });

  it("dismisses an item for the rest of the session without adding a replacement", async () => {
    const target = items(session)[3]!;
    const { session: next } = await revisePlan({ client }, session, { itemId: target.id, action: "dismiss" });
    expect(items(next)).toHaveLength(items(session).length - 1);
    expect(next.plan.dismissedEntityIds).toEqual([target.qlooEntityId]);
    expect(next.candidates[target.qlooEntityId]).toBeUndefined();
  });

  it("replaces only the chosen slot, keeping every other item and the saved ones byte-identical", async () => {
    const saved = (await revisePlan({ client }, session, { itemId: items(session)[0]!.id, action: "save" })).session;
    const target = items(saved)[4]!;
    const { session: next, revision } = await revisePlan({ client }, saved, replace(target.id));
    const keep = (s: PlanSession) => items(s).filter((i) => i.id !== target.id && i.id !== revision.addedItemId);
    expect(keep(next)).toEqual(keep(saved));
    expect(items(next).find((i) => i.id === items(saved)[0]!.id)!.status).toBe("saved");
    const added = items(next).find((i) => i.id === revision.addedItemId)!;
    expect(added.stage).toBe(target.stage);
    expect(added.qlooEntityId).not.toBe(target.qlooEntityId);
    expect(next.plan.stages[target.stage].indexOf(added)).toBe(saved.plan.stages[target.stage].indexOf(target));
    expect(evaluateSession(next).checks.find((c) => c.id === "G1")!.pass).toBe(true);
  });

  it("never re-suggests a dismissed place, across repeated feedback", async () => {
    let current = session;
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const target = items(current).find((item) => item.status !== "saved")!;
      seen.add(target.qlooEntityId);
      current = (await revisePlan({ client }, current, replace(target.id, "not_interested"))).session;
      for (const id of seen) expect(items(current).map((item) => item.qlooEntityId)).not.toContain(id);
    }
    expect(new Set(current.plan.dismissedEntityIds)).toEqual(seen);
  });

  it("too_expensive lowers the price ceiling below the item's price and honors it for the replacement", async () => {
    const target = find(session, (id, s) => (s.candidates[id]!.priceLevel ?? 0) >= 2);
    const price = session.candidates[target.qlooEntityId]!.priceLevel!;
    const { session: next, revision } = await revisePlan({ client }, session, replace(target.id, "too_expensive"));
    expect(revision.appliedConstraint).toMatchObject({ kind: "max_price", label: `Price ceiling lowered to ${"$".repeat(price - 1)}` });
    expect(next.plan.input.maxPriceLevel).toBe(price - 1);
    const added = next.candidates[revision.addedItemId!.replace("item:", "")]!;
    expect(added.priceLevel === undefined || added.priceLevel <= price - 1).toBe(true);
    expect(added.category).toBe(target.category); // same kind of place when one still qualifies
    // items Qloo has no price for now carry the honest notice; nothing else about them changed
    const unpriced = items(next).filter((i) => next.candidates[i.qlooEntityId]!.priceLevel === undefined);
    expect(unpriced.length).toBeGreaterThan(0);
    expect(unpriced.every((i) => i.notices.includes("Price not available \u2014 check current details."))).toBe(true);
    expect(evaluateSession(next).checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("too_expensive on a place Qloo has no price for says so honestly, and still removes it", async () => {
    const museum = find(session, (id, s) => s.candidates[id]!.priceLevel === undefined);
    const { revision, session: next } = await revisePlan({ client }, session, replace(museum.id, "too_expensive"));
    expect(revision.appliedConstraint).toBeUndefined();
    expect(revision.limitation).toContain("Qloo has no price level");
    expect(next.plan.input.maxPriceLevel).toBeUndefined();
    expect(items(next).map((i) => i.qlooEntityId)).not.toContain(museum.qlooEntityId);
  });

  it("too_far halves the radius, picks a closer replacement, and flags older items now outside it", async () => {
    const target = find(session, (id, s) => (s.candidates[id]!.evidence.distanceMeters ?? 0) > 5_000);
    const { session: next, revision } = await revisePlan({ client }, session, replace(target.id, "too_far"));
    expect(revision.appliedConstraint).toMatchObject({ kind: "radius", label: "Distance limit reduced to 7.5 km" });
    expect(next.plan.input.radiusMeters).toBe(7_500);
    expect(next.plan.queryRadiusMeters).toBe(15_000); // Qloo queries unchanged, so no new calls are needed
    const added = next.candidates[revision.addedItemId!.replace("item:", "")]!;
    expect(added.evidence.distanceMeters!).toBeLessThanOrEqual(7_500);
    const farKept = items(next).filter((i) => (next.candidates[i.qlooEntityId]!.evidence.distanceMeters ?? 0) > 7_500);
    expect(next.outOfLimitItemIds.sort()).toEqual(farKept.map((i) => i.id).sort());
    expect(evaluateSession(next).checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("too_loud turns on strict quiet and picks a replacement without loud/lively tags", async () => {
    const target = items(session).find((i) => i.category === "cafe")!;
    const { session: next, revision } = await revisePlan({ client }, session, replace(target.id, "too_loud"));
    expect(revision.appliedConstraint?.kind).toBe("strict_quiet");
    expect(next.plan.input).toMatchObject({ strictQuiet: true, atmosphere: "quiet" });
    const added = next.candidates[revision.addedItemId!.replace("item:", "")]!;
    expect(added.atmosphere.ambience).not.toContain("Lively");
    expect(added.atmosphere.noiseLevel).not.toBe("Loud");
  });

  it("not_interested excludes the place, records a category penalty, and may switch category", async () => {
    const target = items(session)[0]!;
    const { session: next, revision } = await revisePlan({ client }, session, replace(target.id, "not_interested"));
    expect(next.plan.constraints.map((c) => c.kind)).toEqual(["exclude_entity", "category_penalty"]);
    expect(next.plan.constraints[1]!.category).toBe(target.category);
    expect(items(next).map((i) => i.qlooEntityId)).not.toContain(target.qlooEntityId);
    expect(revision.addedItemId).toBeDefined();
  });

  it("returns an honest 'no verified match' with a concrete suggestion and does not relax the limit", async () => {
    // Only two cafes exist, both used; nothing else qualifies once the radius is tightened to 2 km... so ask twice.
    await setup({ [CAFE_TAG]: largeRaw()[CAFE_TAG]!.slice(0, 1), [BOOK_TAG]: [], [KOREAN_TAG]: [], [MUSEUM_TAG]: [] }, { ...BASE_INPUT, categories: ["cafe"] });
    const only = items(session)[0]!;
    const { session: next, revision } = await revisePlan({ client }, session, replace(only.id, "too_far"));
    expect(revision.noMatch).toMatchObject({ stage: only.stage });
    expect(revision.noMatch!.message).toContain("7.5 km");
    expect(revision.noMatch!.suggestion).toContain("15.0 km");
    expect(revision.addedItemId).toBeUndefined();
    expect(next.plan.input.radiusMeters).toBe(7_500); // the tightened limit stays
    expect(items(next)).toHaveLength(0);
  });

  it("explains a category switch when no same-kind place still qualifies", async () => {
    const raw = largeRaw();
    raw[KOREAN_TAG] = raw[KOREAN_TAG]!.slice(0, 1); // a single Korean restaurant: used in the plan
    await setup(raw);
    const korean = items(session).find((i) => i.category === "korean_restaurant")!;
    const { revision } = await revisePlan({ client }, session, replace(korean.id, "too_expensive"));
    if (revision.addedItemId) expect(revision.limitation ?? "").toContain("was suggested instead");
    else expect(revision.noMatch).toBeDefined();
  });

  it("rejects feedback for an unknown item", async () => {
    await expect(revisePlan({ client }, session, { itemId: "item:nope", action: "save" })).rejects.toBeInstanceOf(FeedbackError);
  });

  it("re-queries Qloo with the tighter price filter only when the cached pool has no alternate", async () => {
    const mk = (id: string, price: number) => rawEntity({ id, genre: "Coffee shop", distance: 1_000, price, affinity: 0.8 });
    const seen: Record<string, unknown>[] = [];
    const fake = fakeClient({}, {
      placeInsights: async (params) => {
        seen.push(params);
        return params["filter.price_level.max"] === 2 ? [mk("y1", 1)] : [mk("x1", 3), mk("x2", 3), mk("x3", 3)];
      },
    });
    const input = { ...BASE_INPUT, categories: ["cafe" as const] };
    const built = (await buildPlan({ client: fake.client }, input)).session;
    expect(items(built).map((i) => i.qlooEntityId).sort()).toEqual(["x1", "x2", "x3"]);
    const { session: next, revision } = await revisePlan({ client: fake.client }, built, replace("item:x1", "too_expensive"));
    expect(seen.some((p) => p["filter.price_level.max"] === 2)).toBe(true);
    expect(revision.addedItemId).toBe("item:y1");
    expect(next.candidates["y1"]!.priceLevel).toBe(1);
    expect(items(next).map((i) => i.qlooEntityId)).not.toContain("x1");
  });

  it("tightening the radius needs no new Qloo requests when responses are cached", async () => {
    const fake = fakeClient(largeRaw());
    const cached = withCache(fake.client, createTtlCache({ ttlMs: 60_000, maxEntries: 20 }));
    const built = (await buildPlan({ client: cached }, BASE_INPUT)).session;
    const before = fake.placeInsights.mock.calls.length;
    const far = items(built).find((i) => (built.candidates[i.qlooEntityId]!.evidence.distanceMeters ?? 0) > 5_000)!;
    await revisePlan({ client: cached }, built, replace(far.id, "too_far"));
    expect(fake.placeInsights.mock.calls.length).toBe(before);
  });
});
