import { describe, expect, it } from "vitest";
import { STAGE_KEYS } from "@/domain/types";
import { makeScoringContext } from "@/lib/agent/pipeline";
import { constructStages } from "@/lib/agent/planner";
import { fitScore } from "@/lib/agent/scoring";
import { BASE_INPUT, candidate } from "./helpers";
import type { CategoryKey } from "@/domain/demo";
import type { PlaceCandidate } from "@/domain/types";

const ALL_CATS: CategoryKey[] = ["cafe", "bookstore", "restaurant", "museum"];
const ctxFor = (pool: PlaceCandidate[], patch: Partial<typeof BASE_INPUT> = {}, interests: CategoryKey[] = []) =>
  makeScoringContext({ ...BASE_INPUT, ...patch }, pool, new Set(interests));

function varied(): PlaceCandidate[] {
  const pool: PlaceCandidate[] = [];
  ALL_CATS.forEach((category, c) => {
    for (let i = 0; i < 4; i++) {
      const base = candidate({ id: `${category}-${i}`, category });
      pool.push({
        ...base,
        evidence: { ...base.evidence, affinity: 0.7 + 0.01 * i + 0.002 * c, distanceMeters: 1_000 + 1_500 * i + 300 * c },
      });
    }
  });
  return pool;
}

const idsOf = (stages: ReturnType<typeof constructStages>) =>
  Object.fromEntries(STAGE_KEYS.map((key) => [key, stages[key].map((pick) => pick.candidate.qlooEntityId)]));

describe("plan construction", () => {
  it("fills three stages with three distinct-category suggestions each, and no repeats", () => {
    const pool = varied();
    const stages = constructStages(pool, ctxFor(pool));
    const all = STAGE_KEYS.flatMap((key) => stages[key].map((pick) => pick.candidate.qlooEntityId));
    expect(all).toHaveLength(9);
    expect(new Set(all).size).toBe(9);
    for (const key of STAGE_KEYS) {
      const categories = stages[key].map((pick) => pick.candidate.category);
      expect(new Set(categories).size).toBe(categories.length);
    }
  });

  it("is deterministic and independent of input order", () => {
    const pool = varied();
    const a = idsOf(constructStages(pool, ctxFor(pool)));
    const reversed = [...pool].reverse();
    const b = idsOf(constructStages(reversed, ctxFor(reversed)));
    expect(b).toEqual(a);
    expect(idsOf(constructStages(pool, ctxFor(pool)))).toEqual(a);
  });

  it("breaks exact ties by Qloo entity id (ascending)", () => {
    const a = candidate({ id: "aaa" });
    const z = candidate({ id: "zzz" });
    const stages = constructStages([z, a], ctxFor([a, z]));
    expect(stages.first_week.map((pick) => pick.candidate.qlooEntityId)).toEqual(["aaa"]);
    expect(stages.first_month.map((pick) => pick.candidate.qlooEntityId)).toEqual(["zzz"]);
  });

  it("suits categories to stages: cafes lead the first week, museums the last stage", () => {
    const pool = varied().map((c) => ({ ...c, evidence: { ...c.evidence, affinity: 0.8, distanceMeters: 2_000 } }));
    const stages = constructStages(pool, ctxFor(pool));
    expect(stages.first_week[0]?.candidate.category).toBe("cafe");
    expect(stages.months_2_3[0]?.candidate.category).toBe("museum");
  });

  it("allows a repeated category within a stage only when no other category is left", () => {
    const pool = ["a", "b", "c", "d", "e", "f"].map((id) => candidate({ id }));
    const stages = constructStages(pool, ctxFor(pool));
    expect(STAGE_KEYS.map((key) => stages[key].length)).toEqual([2, 2, 2]);
    expect(stages.first_week.map((pick) => pick.candidate.category)).toEqual(["cafe", "cafe"]);
  });

  it("spreads a scarce pool across all three stages instead of front-loading", () => {
    const pool = varied().slice(0, 5);
    const stages = constructStages(pool, ctxFor(pool));
    expect(STAGE_KEYS.map((key) => stages[key].length)).toEqual([2, 2, 1]);
  });

  it("returns empty stages for an empty pool", () => {
    expect(idsOf(constructStages([], ctxFor([])))).toEqual({ first_week: [], first_month: [], months_2_3: [] });
  });
});

describe("fit score", () => {
  const withAtmosphere = (id: string, ambience: string[], timeOfDay: string[] = [], noiseLevel?: string) =>
    candidate({ id, atmosphere: { ambience, timeOfDay, visitIntent: [], ...(noiseLevel ? { noiseLevel } : {}) } });

  it("ranks a quiet place above a lively one only when the user prefers quiet", () => {
    const quiet = withAtmosphere("q", ["Cozy"], [], "Quiet");
    const lively = withAtmosphere("l", ["Lively"], [], "Loud");
    const prefer = ctxFor([quiet, lively], { atmosphere: "quiet" });
    expect(fitScore(quiet, "first_week", prefer).score).toBeGreaterThan(fitScore(lively, "first_week", prefer).score);
    const neutral = ctxFor([quiet, lively]);
    expect(fitScore(quiet, "first_week", neutral).score).toBe(fitScore(lively, "first_week", neutral).score);
  });

  it("rewards a Morning fit only when the user prefers mornings", () => {
    const morning = withAtmosphere("m", [], ["Morning"]);
    const evening = withAtmosphere("e", [], ["Evening"]);
    const prefer = ctxFor([morning, evening], { preferMornings: true });
    expect(fitScore(morning, "first_week", prefer).score).toBeGreaterThan(fitScore(evening, "first_week", prefer).score);
    expect(fitScore(morning, "first_week", ctxFor([morning, evening])).score).toBe(fitScore(evening, "first_week", ctxFor([morning, evening])).score);
  });

  it("uses Qloo affinity relative to the category pool; a flat or missing affinity is neutral", () => {
    const high = candidate({ id: "h", evidence: { ...candidate({ id: "h" }).evidence, affinity: 0.9 } });
    const low = candidate({ id: "l", evidence: { ...candidate({ id: "l" }).evidence, affinity: 0.7 } });
    const ctx = ctxFor([high, low]);
    expect(fitScore(high, "first_week", ctx).parts["affinity"]).toBeGreaterThan(fitScore(low, "first_week", ctx).parts["affinity"]!);
    const flat = candidate({ id: "f" });
    expect(fitScore(flat, "first_week", ctxFor([flat])).parts["affinity"]).toBeCloseTo(0.15, 6); // 0.30 * 0.5
  });

  it("prefers nearer places more strongly in the first week than later", () => {
    const near = candidate({ id: "n", evidence: { ...candidate({ id: "n" }).evidence, distanceMeters: 500 } });
    const far = candidate({ id: "f", evidence: { ...candidate({ id: "f" }).evidence, distanceMeters: 14_000 } });
    const ctx = ctxFor([near, far]);
    const gap = (stage: "first_week" | "months_2_3") => fitScore(near, stage, ctx).score - fitScore(far, stage, ctx).score;
    expect(gap("first_week")).toBeGreaterThan(gap("months_2_3"));
  });

  it("boosts categories that match a stated interest", () => {
    const book = candidate({ id: "b", category: "bookstore" });
    const withInterest = ctxFor([book], {}, ["bookstore"]);
    expect(fitScore(book, "first_week", withInterest).parts["interestBoost"]).toBeGreaterThan(0);
    expect(fitScore(book, "first_week", ctxFor([book])).parts["interestBoost"]).toBe(0);
  });

  it("penalizes national chains only for indie/local interests", () => {
    const chain = candidate({ id: "x", name: "Barnes & Noble", category: "bookstore" });
    const indie = makeScoringContext({ ...BASE_INPUT, interests: ["indie bookstores"] }, [chain], new Set());
    const plain = makeScoringContext({ ...BASE_INPUT, interests: ["bookstores"] }, [chain], new Set());
    expect(fitScore(chain, "first_week", indie).score).toBeLessThan(fitScore(chain, "first_week", plain).score);
  });
});
