import { describe, expect, it } from "vitest";
import {
  acceptWording,
  explainCandidate,
  INDEPENDENCE_NOTICE,
  NO_ATMOSPHERE_NOTICE,
  PRICE_UNKNOWN_NOTICE,
  UNVERIFIED_NOTICE,
} from "@/lib/agent/explain";
import { BASE_INPUT, candidate } from "./helpers";

const signals = [
  { id: "sig-a", kind: "entity" as const, label: "Haruki Murakami" },
  { id: "sig-b", kind: "entity" as const, label: "Quail Ridge" },
  { id: "urn:tag:korean", kind: "tag" as const, label: "Korean food" },
  { id: "urn:tag:books", kind: "tag" as const, label: "indie bookstores" },
];
const ctx = { input: BASE_INPUT, signals, preferIndependent: false };
const withEvidence = (patch: object) => {
  const base = candidate({ id: "e", name: "Test Cafe" });
  return { ...base, evidence: { ...base.evidence, ...patch } };
};

describe("explanations", () => {
  it("uses Qloo's per-pick attribution when returned, strongest contributor first", async () => {
    const c = withEvidence({
      signalEntityIds: ["sig-a", "sig-b"],
      explainability: [
        { entityId: "sig-b", score: 0.3 },
        { entityId: "sig-a", score: 0.7 },
        { entityId: "sig-low", score: 0.05 },
      ],
    });
    const out = await explainCandidate(c, "first_week", ctx);
    expect(out.basis).toBe("input_attribution");
    expect(out.why).toContain("Your picks “Haruki Murakami” and “Quail Ridge” contributed to how Qloo ranked it.");
  });

  it("without attribution but with tag signals, says only that the picks were used", async () => {
    const out = await explainCandidate(withEvidence({ signalTagIds: ["urn:tag:korean", "urn:tag:books"] }), "first_week", ctx);
    expect(out.basis).toBe("taste_signals");
    expect(out.why).toContain("Qloo ranked it using your picks: “Korean food” and “indie bookstores”.");
    expect(out.why).not.toMatch(/contributed/);
  });

  it("with no taste ranking, labels the basis as category and distance only", async () => {
    const out = await explainCandidate(withEvidence({ affinity: undefined }), "first_week", ctx);
    expect(out.basis).toBe("category_and_distance");
    expect(out.why).toContain("Matched by category and distance only");
  });

  it("states the distance from the search center in km and never uses percentages or odds", async () => {
    const out = await explainCandidate(withEvidence({ distanceMeters: 2_340, affinity: 0.97 }), "first_week", ctx);
    expect(out.why).toContain("2.3 km from downtown Raleigh");
    expect(out.why).not.toMatch(/%|percent|probab|chance|0\.97|97/i);
  });

  it("always carries the unverified-details notice", async () => {
    expect((await explainCandidate(candidate({ id: "n" }), "first_week", ctx)).notices[0]).toBe(UNVERIFIED_NOTICE);
  });

  it("adds the honest price notice only when a ceiling is active and Qloo has no price", async () => {
    const museum = candidate({ id: "m", category: "museum" });
    const capped = { ...ctx, input: { ...BASE_INPUT, maxPriceLevel: 2 as const } };
    expect((await explainCandidate(museum, "months_2_3", capped)).notices).toContain(PRICE_UNKNOWN_NOTICE);
    expect((await explainCandidate(museum, "months_2_3", ctx)).notices).not.toContain(PRICE_UNKNOWN_NOTICE);
    expect(PRICE_UNKNOWN_NOTICE).toBe("Price not available — check current details.");
  });

  it("attaches an external link only when Qloo returned a website", async () => {
    expect((await explainCandidate(candidate({ id: "w", website: "https://example.test/" }), "first_week", ctx)).externalUrl).toBe("https://example.test/");
    expect("externalUrl" in (await explainCandidate(candidate({ id: "x" }), "first_week", ctx))).toBe(false);
  });

  it("shows only verbatim Qloo tags that back stated preferences", async () => {
    const quietMorning = candidate({ id: "q", atmosphere: { ambience: ["Cozy", "Casual"], noiseLevel: "Quiet", timeOfDay: ["Morning", "Evening"], visitIntent: [] } });
    const prefs = { ...ctx, input: { ...BASE_INPUT, atmosphere: "quiet" as const, preferMornings: true } };
    const out = await explainCandidate(quietMorning, "first_week", prefs);
    expect(out.highlights).toEqual(["Quiet", "Cozy", "Morning"]);
    expect(out.why).toContain("Qloo tags it: Quiet, Cozy, Morning.");
    expect((await explainCandidate(quietMorning, "first_week", ctx)).highlights).toEqual([]);
  });

  it("says when Qloo has no atmosphere data for a place the user wants quiet", async () => {
    const prefs = { ...ctx, input: { ...BASE_INPUT, atmosphere: "quiet" as const } };
    expect((await explainCandidate(candidate({ id: "z" }), "first_week", prefs)).notices).toContain(NO_ATMOSPHERE_NOTICE);
  });

  it("does not claim a bookstore is independent", async () => {
    const out = await explainCandidate(candidate({ id: "b", category: "bookstore" }), "first_week", { ...ctx, preferIndependent: true });
    expect(out.notices).toContain(INDEPENDENCE_NOTICE);
    expect(out.why).not.toMatch(/independent|indie/i);
  });

  it("frames each suggestion as an idea, not a scheduled event", async () => {
    for (const category of ["cafe", "bookstore", "korean_restaurant", "museum"] as const) {
      const { routine } = await explainCandidate(candidate({ id: category, category, name: "Name" }), "first_week", ctx);
      expect(routine).toMatch(/^(Try|Browse|Spend)/);
      expect(routine).not.toMatch(/\b(at \d|on (mon|tue|wed|thu|fri|sat|sun)|reserved|booked)\b/i);
    }
  });
});

describe("optional wording adapter", () => {
  it("accepts wording that adds nothing new", () => {
    expect(acceptWording("A cafe about 2.3 km away.", ["2.3"])).toBe(true);
  });
  it("rejects percentages, odds, links and invented numbers", () => {
    expect(acceptWording("96% match", [])).toBe(false);
    expect(acceptWording("You will love it, guaranteed", [])).toBe(false);
    expect(acceptWording("See https://x.test", [])).toBe(false);
    expect(acceptWording("About 9 km away", ["2.3"])).toBe(false);
  });
  it("falls back to the deterministic wording when the adapter output is rejected or throws", async () => {
    const c = candidate({ id: "w" });
    const baseline = await explainCandidate(c, "first_week", ctx);
    const bad = await explainCandidate(c, "first_week", ctx, { rewrite: () => "A 96% match for you" });
    const boom = await explainCandidate(c, "first_week", ctx, { rewrite: () => { throw new Error("down"); } });
    expect(bad.why).toBe(baseline.why);
    expect(boom.why).toBe(baseline.why);
  });
  it("uses acceptable rewritten wording", async () => {
    const out = await explainCandidate(candidate({ id: "w" }), "first_week", ctx, { rewrite: () => "A friendly cafe nearby." });
    expect(out.why).toBe("A friendly cafe nearby.");
  });
});
