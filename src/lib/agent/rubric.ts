import { CATEGORIES } from "@/domain/demo";
import { STAGE_KEYS, type PlanSession } from "@/domain/types";
import { livelySignals } from "./atmosphere";
import { findOutOfLimit } from "./constraints";
import { PRICE_UNKNOWN_NOTICE, UNVERIFIED_NOTICE } from "./explain";

/**
 * Handwritten acceptance rubric (PROJECT_PLAN.md sections 7 and 8): factual
 * grounding, plan diversity and constraint adherence. Pure, so the same checks
 * run in unit tests and against live Qloo data.
 */
export interface RubricCheck {
  id: string;
  group: "grounding" | "diversity" | "constraints";
  description: string;
  pass: boolean;
  detail?: string;
}

export interface RubricReport {
  checks: RubricCheck[];
  passed: number;
  total: number;
  allPass: boolean;
}

const OVERCLAIM = /%|percent|probab|guarantee|\bchance\b/i;

export function evaluateSession(session: PlanSession): RubricReport {
  const { plan, candidates } = session;
  const items = STAGE_KEYS.flatMap((stage) => plan.stages[stage]);
  const checks: RubricCheck[] = [];
  const add = (check: RubricCheck) => checks.push(check);

  // ---- grounding
  const ungrounded = items.filter((item) => candidates[item.qlooEntityId]?.qlooEntityId !== item.qlooEntityId);
  add({ id: "G1", group: "grounding", description: "Every item traces to a returned Qloo entity", pass: ungrounded.length === 0, detail: `${items.length - ungrounded.length}/${items.length} traced` });
  const noQuery = items.filter((item) => (candidates[item.qlooEntityId]?.evidence.filterTagIds.length ?? 0) === 0);
  add({ id: "G2", group: "grounding", description: "Every candidate carries the Qloo query that returned it", pass: noQuery.length === 0 });
  const overclaims = items.filter((item) => OVERCLAIM.test(item.why) || OVERCLAIM.test(item.routine));
  add({ id: "G3", group: "grounding", description: "No percentage/probability language", pass: overclaims.length === 0 });
  const badLinks = items.filter((item) => item.externalUrl !== undefined && item.externalUrl !== candidates[item.qlooEntityId]?.website);
  add({ id: "G4", group: "grounding", description: "External links only where Qloo returned a website", pass: badLinks.length === 0 });
  const noNotice = items.filter((item) => !item.notices.includes(UNVERIFIED_NOTICE));
  add({ id: "G5", group: "grounding", description: "Every item says details are unverified", pass: noNotice.length === 0 });
  const dishonest = items.filter((item) => {
    const evidence = candidates[item.qlooEntityId]?.evidence;
    if (item.basis === "input_attribution") return !evidence?.explainability?.length;
    if (item.basis === "taste_signals") return evidence?.affinity === undefined || evidence.signalTagIds.length === 0;
    return false;
  });
  add({ id: "G6", group: "grounding", description: "Explanation basis is backed by returned Qloo data", pass: dishonest.length === 0 });

  // ---- diversity
  const ids = items.map((item) => item.qlooEntityId);
  add({ id: "D1", group: "diversity", description: "No place appears twice", pass: new Set(ids).size === ids.length });
  const categories = new Set(items.map((item) => item.category));
  const wanted = Math.min(3, plan.input.categories.length);
  add({ id: "D2", group: "diversity", description: `At least ${wanted} categories across the plan`, pass: categories.size >= wanted, detail: `${categories.size} categories` });
  // After feedback, hard limits outrank variety (a replacement may have to repeat a category).
  const afterFeedback = plan.constraints.length > 0;
  const crowded = afterFeedback
    ? []
    : STAGE_KEYS.filter((stage) => {
        const inStage = plan.stages[stage].map((item) => item.category);
        return inStage.length > 1 && new Set(inStage).size < Math.min(inStage.length, plan.input.categories.length);
      });
  add({
    id: "D3",
    group: "diversity",
    description: "Categories are varied within each stage",
    pass: crowded.length === 0,
    detail: afterFeedback ? "not applied after feedback: limits take priority" : crowded.join(", ") || undefined,
  });
  add({ id: "D4", group: "diversity", description: "Every stage has at least one suggestion", pass: STAGE_KEYS.every((stage) => plan.stages[stage].length > 0) });

  // ---- constraints
  // Items that predate a tightened limit are flagged for the user (outOfLimitItemIds); the
  // checks below apply to everything else, and C5 proves the flag list is complete.
  const flagged = new Set(session.outOfLimitItemIds);
  const checked = items.filter((item) => !flagged.has(item.id));
  const outside = checked.filter((item) => (candidates[item.qlooEntityId]?.evidence.distanceMeters ?? Infinity) > plan.input.radiusMeters);
  add({ id: "C1", group: "constraints", description: `All within ${plan.input.radiusMeters / 1000} km`, pass: outside.length === 0 });
  const ceiling = plan.input.maxPriceLevel;
  const priceViolations = checked.filter((item) => {
    if (ceiling === undefined) return false;
    const candidate = candidates[item.qlooEntityId];
    if (!candidate) return true;
    if (candidate.priceLevel !== undefined) return candidate.priceLevel > ceiling;
    return CATEGORIES[candidate.category].pricesAvailable || !item.notices.includes(PRICE_UNKNOWN_NOTICE);
  });
  add({ id: "C2", group: "constraints", description: ceiling === undefined ? "No price ceiling set" : `Price at or below ${"$".repeat(ceiling)} (unpriced cultural venues flagged)`, pass: priceViolations.length === 0 });
  const dismissed = new Set(plan.dismissedEntityIds);
  add({ id: "C3", group: "constraints", description: "No dismissed place is suggested", pass: !ids.some((id) => dismissed.has(id)) });
  const loud = plan.input.strictQuiet ? checked.filter((item) => livelySignals(candidates[item.qlooEntityId]!).length > 0) : [];
  add({ id: "C4", group: "constraints", description: plan.input.strictQuiet ? "No loud/lively-tagged place" : "Strict quiet not requested", pass: loud.length === 0 });

  const actualOutOfLimit = findOutOfLimit(items, candidates, plan.input);
  const unflagged = actualOutOfLimit.filter((id) => !flagged.has(id));
  add({
    id: "C5",
    group: "constraints",
    description: "Every item outside the current limits is flagged, never shown as compliant",
    pass: unflagged.length === 0,
    detail: `${flagged.size} flagged`,
  });

  const passed = checks.filter((check) => check.pass).length;
  return { checks, passed, total: checks.length, allPass: passed === checks.length };
}

/** How two sessions differ, for the "changing an input visibly changes the plan" check. */
export function comparePlans(a: PlanSession, b: PlanSession) {
  const ids = (session: PlanSession) => new Set(STAGE_KEYS.flatMap((stage) => session.plan.stages[stage].map((item) => item.qlooEntityId)));
  const idsA = ids(a);
  const idsB = ids(b);
  const shared = [...idsA].filter((id) => idsB.has(id));
  const counts = (session: PlanSession) => {
    const out: Record<string, number> = {};
    for (const stage of STAGE_KEYS) for (const item of session.plan.stages[stage]) out[item.category] = (out[item.category] ?? 0) + 1;
    return out;
  };
  return {
    sharedPlaces: shared.length,
    onlyInFirst: idsA.size - shared.length,
    onlyInSecond: idsB.size - shared.length,
    categoryCountsFirst: counts(a),
    categoryCountsSecond: counts(b),
    changed: idsA.size !== shared.length || idsB.size !== shared.length,
  };
}
