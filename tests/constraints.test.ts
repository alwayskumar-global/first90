import { describe, expect, it } from "vitest";
import { checkEligibility, constraintsFromInput, findOutOfLimit } from "@/lib/agent/constraints";
import { BASE_INPUT, candidate } from "./helpers";

const hard = (patch: Partial<typeof BASE_INPUT> = {}, excluded: string[] = []) =>
  constraintsFromInput({ ...BASE_INPUT, ...patch }, excluded);

describe("hard constraints", () => {
  it("excludes dismissed entities", () => {
    expect(checkEligibility(candidate({ id: "x" }), hard({}, ["x"]))).toMatchObject({ eligible: false, reason: "excluded" });
  });
  it("enforces the radius using Qloo's returned distance", () => {
    const far = candidate({ id: "f", evidence: { ...candidate({ id: "f" }).evidence, distanceMeters: 16_000 } });
    expect(checkEligibility(far, hard()).reason).toBe("outside_radius");
    expect(checkEligibility(far, hard({ radiusMeters: 20_000 })).eligible).toBe(true);
  });
  it("cannot verify a radius without a distance, so it excludes", () => {
    const noDistance = candidate({ id: "n", evidence: { ...candidate({ id: "n" }).evidence, distanceMeters: undefined } });
    expect(checkEligibility(noDistance, hard()).reason).toBe("distance_unknown");
  });
  it("enforces the price ceiling for priced categories", () => {
    expect(checkEligibility(candidate({ id: "p", priceLevel: 3 }), hard({ maxPriceLevel: 2 })).reason).toBe("over_price_ceiling");
    expect(checkEligibility(candidate({ id: "p", priceLevel: 2 }), hard({ maxPriceLevel: 2 })).eligible).toBe(true);
  });
  it("drops an unpriced cafe under a ceiling: the ceiling can't be verified", () => {
    const unpriced = candidate({ id: "u", priceLevel: undefined });
    expect(checkEligibility(unpriced, hard({ maxPriceLevel: 2 }))).toMatchObject({ eligible: false, reason: "price_unverifiable" });
  });
  it("CR-003: keeps an unpriced museum under a ceiling and flags it", () => {
    const museum = candidate({ id: "m", category: "museum" });
    expect(checkEligibility(museum, hard({ maxPriceLevel: 1 }))).toEqual({ eligible: true, priceUnknown: true });
  });
  it("CR-004: keeps an unpriced bookstore under a ceiling and flags it, but still enforces a known price", () => {
    const unpriced = candidate({ id: "b", category: "bookstore" });
    expect(checkEligibility(unpriced, hard({ maxPriceLevel: 1 }))).toEqual({ eligible: true, priceUnknown: true });
    const pricey = candidate({ id: "b2", category: "bookstore", priceLevel: 3 });
    expect(checkEligibility(pricey, hard({ maxPriceLevel: 1 })).reason).toBe("over_price_ceiling");
  });
  it("does not flag price at all when no ceiling is set", () => {
    expect(checkEligibility(candidate({ id: "m", category: "museum" }), hard())).toEqual({ eligible: true, priceUnknown: false });
  });
  it("strict quiet excludes loud or lively places, keeps places with no atmosphere data", () => {
    const loud = candidate({ id: "l", atmosphere: { ambience: ["Lively"], noiseLevel: "Loud", timeOfDay: [], visitIntent: [] } });
    const unknown = candidate({ id: "k" });
    expect(checkEligibility(loud, hard({ strictQuiet: true })).reason).toBe("loud_or_lively");
    expect(checkEligibility(unknown, hard({ strictQuiet: true })).eligible).toBe(true);
  });
  it("findOutOfLimit lists exactly the items that break the current limits", () => {
    const near = candidate({ id: "near" });
    const far = candidate({ id: "far", evidence: { ...near.evidence, distanceMeters: 9_000 } });
    const items = [
      { id: "item:near", qlooEntityId: "near" },
      { id: "item:far", qlooEntityId: "far" },
    ];
    expect(findOutOfLimit(items, { near, far }, { ...BASE_INPUT, radiusMeters: 7_500 })).toEqual(["item:far"]);
    expect(findOutOfLimit(items, { near, far }, BASE_INPUT)).toEqual([]);
  });
});
