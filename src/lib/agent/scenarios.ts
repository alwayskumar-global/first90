import { DEMO_AREA, DEMO_PERSONA } from "@/domain/demo";
import { STAGE_KEYS, type Feedback, type FeedbackReason, type PlanSession, type TasteInput } from "@/domain/types";
import { comparePlans, evaluateSession, type RubricReport } from "./rubric";
import { revisePlan, buildPlan, type WorkflowDeps } from "./workflow";

/** Scenario 1: the demo persona in Raleigh. */
export const BASELINE_INPUT: TasteInput = {
  interests: [...DEMO_PERSONA.interests],
  areaKey: DEMO_AREA.key,
  radiusMeters: DEMO_AREA.defaultRadiusMeters,
  categories: ["cafe", "bookstore", "restaurant", "museum"],
  atmosphere: "no_preference",
  preferMornings: false,
};

/** Scenario 2: swap one interest, tighten the radius and set a budget. */
export const CHANGED_INPUT: TasteInput = {
  ...BASELINE_INPUT,
  interests: ["indie bookstores", "art museums", "coffee shops", "quiet mornings"],
  radiusMeters: 7_500,
  maxPriceLevel: 2,
};

/** Bonus scenario: a named-entity interest (ambiguous), then confirmed, to exercise Qloo explainability. */
export const ENTITY_INPUT: TasteInput = {
  ...BASELINE_INPUT,
  interests: ["indie bookstores", "Haruki Murakami", "coffee shops", "quiet mornings"],
};

const km = (meters: number | undefined) => (meters === undefined ? null : Number((meters / 1000).toFixed(1)));

/** Compact, payload-free view of a session for reports. */
export function summarizeSession(session: PlanSession) {
  return Object.fromEntries(
    STAGE_KEYS.map((stage) => [
      stage,
      session.plan.stages[stage].map((item) => {
        const candidate = session.candidates[item.qlooEntityId]!;
        return {
          id: item.qlooEntityId.slice(0, 8),
          name: candidate.name,
          category: item.category,
          km: km(candidate.evidence.distanceMeters),
          price: candidate.priceLevel ?? null,
          basis: item.basis,
          highlights: item.highlights,
          status: item.status,
        };
      }),
    ]),
  );
}

function plainStages(session: PlanSession) {
  return JSON.stringify(session.plan.stages);
}

export interface ScenarioReport {
  baseline: {
    input: TasteInput;
    effectiveInput: Pick<TasteInput, "atmosphere" | "preferMornings">;
    notes: string[];
    stages: ReturnType<typeof summarizeSession>;
    rubric: RubricReport;
    deterministic: boolean;
    trace: { id: string; status: string; summary: string }[];
  };
  changed: {
    input: TasteInput;
    notes: string[];
    stages: ReturnType<typeof summarizeSession>;
    rubric: RubricReport;
    diffVsBaseline: ReturnType<typeof comparePlans>;
  };
  entityInterest: {
    firstBuildNeedsConfirmation: { input: string; options: { type?: string; name: string }[] }[];
    confirmedAs: string | null;
    attributionItems: number;
    totalItems: number;
    sampleWhy: string[];
    stages: ReturnType<typeof summarizeSession>;
    rubric: RubricReport;
  };
  revision: {
    steps: {
      feedback: Feedback;
      target: { name: string; stage: string; km: number | null; price: number | null };
      outcome: "replaced" | "no_verified_match";
      appliedConstraint: string | null;
      limitation: string | null;
      replacement: { name: string; category: string; km: number | null; price: number | null } | null;
      noMatch: { message: string; suggestion: string } | null;
      otherItemsUnchanged: boolean;
      savedItemsKept: boolean;
      rubric: RubricReport;
    }[];
  };
}

/** Run the three required live scenarios. Bounded: every Qloo call goes through the client's cache. */
export async function runScenarios(deps: WorkflowDeps): Promise<ScenarioReport> {
  // 1. baseline (built twice to prove determinism given identical Qloo data)
  const first = await buildPlan(deps, BASELINE_INPUT);
  const second = await buildPlan(deps, BASELINE_INPUT);
  const baseline = first.session;

  // 2. changed interests + constraints
  const changed = (await buildPlan(deps, CHANGED_INPUT)).session;

  // 3. feedback revisions on the baseline
  let current = baseline;
  const firstItem = baseline.plan.stages.first_week[0];
  const steps: ScenarioReport["revision"]["steps"] = [];
  const savedIds = new Set<string>();
  if (firstItem) {
    const saved = await revisePlan(deps, current, { itemId: firstItem.id, action: "save" });
    current = saved.session;
    savedIds.add(firstItem.id);
  }

  const pickTarget = (reason: FeedbackReason) => {
    const all = STAGE_KEYS.flatMap((stage) => current.plan.stages[stage]).filter((item) => !savedIds.has(item.id));
    const score = (id: string) => {
      const c = current.candidates[id]!;
      if (reason === "too_expensive") return c.priceLevel ?? -1;
      if (reason === "too_far") return c.evidence.distanceMeters ?? -1;
      return c.category === "cafe" ? 1 : 0; // too_loud: a cafe is where noise matters
    };
    return [...all].sort((a, b) => score(b.qlooEntityId) - score(a.qlooEntityId) || a.id.localeCompare(b.id))[0];
  };

  for (const reason of ["too_expensive", "too_far", "too_loud"] as const) {
    const target = pickTarget(reason);
    if (!target) break;
    const targetCandidate = current.candidates[target.qlooEntityId]!;
    const feedback: Feedback = { itemId: target.id, action: "replace", reason };
    const result = await revisePlan(deps, current, feedback);
    const { revision } = result;

    // "Unchanged" ignores notices: a new price ceiling adds a "price not available" notice to unpriced items.
    const strip = (items: PlanSession["plan"]["stages"][keyof PlanSession["plan"]["stages"]]) =>
      items.map((entry) => ({ ...entry, notices: [] as string[] }));
    const otherBefore = strip(STAGE_KEYS.flatMap((s) => revision.before.stages[s]).filter((i) => i.id !== target.id));
    const otherAfter = strip(STAGE_KEYS.flatMap((s) => revision.after.stages[s]).filter((i) => i.id !== revision.addedItemId));
    const addedCandidate = revision.addedItemId
      ? result.session.candidates[revision.addedItemId.replace("item:", "")]
      : undefined;

    steps.push({
      feedback,
      target: { name: targetCandidate.name, stage: target.stage, km: km(targetCandidate.evidence.distanceMeters), price: targetCandidate.priceLevel ?? null },
      outcome: revision.noMatch ? "no_verified_match" : "replaced",
      appliedConstraint: revision.appliedConstraint?.label ?? null,
      limitation: revision.limitation ?? null,
      replacement: addedCandidate
        ? { name: addedCandidate.name, category: addedCandidate.category, km: km(addedCandidate.evidence.distanceMeters), price: addedCandidate.priceLevel ?? null }
        : null,
      noMatch: revision.noMatch ? { message: revision.noMatch.message, suggestion: revision.noMatch.suggestion } : null,
      otherItemsUnchanged: JSON.stringify(otherBefore) === JSON.stringify(otherAfter),
      savedItemsKept: [...savedIds].every((id) => STAGE_KEYS.some((s) => result.session.plan.stages[s].some((i) => i.id === id && i.status === "saved"))),
      rubric: evaluateSession(result.session),
    });
    current = result.session;
  }

  // 4. bonus: entity interest with confirmation
  const unconfirmed = (await buildPlan(deps, ENTITY_INPUT)).session;
  const murakami = unconfirmed.needsConfirmation.find((entry) => entry.input === "Haruki Murakami");
  const choice = murakami?.matches.find((match) => match.type === "urn:entity:author") ?? murakami?.matches[0];
  const confirmed = (
    await buildPlan(deps, choice ? { ...ENTITY_INPUT, confirmations: { "Haruki Murakami": choice.id } } : ENTITY_INPUT)
  ).session;
  const confirmedItems = STAGE_KEYS.flatMap((stage) => confirmed.plan.stages[stage]);

  return {
    baseline: {
      input: BASELINE_INPUT,
      effectiveInput: { atmosphere: baseline.plan.input.atmosphere, preferMornings: baseline.plan.input.preferMornings },
      notes: baseline.notes,
      stages: summarizeSession(baseline),
      rubric: evaluateSession(baseline),
      deterministic: plainStages(baseline) === plainStages(second.session),
      trace: first.trace.map((step) => ({ id: step.id, status: step.status, summary: step.summary })),
    },
    changed: {
      input: CHANGED_INPUT,
      notes: changed.notes,
      stages: summarizeSession(changed),
      rubric: evaluateSession(changed),
      diffVsBaseline: comparePlans(baseline, changed),
    },
    entityInterest: {
      firstBuildNeedsConfirmation: unconfirmed.needsConfirmation.map((entry) => ({
        input: entry.input,
        options: entry.matches.map((match) => ({ ...(match.type ? { type: match.type } : {}), name: match.name })),
      })),
      confirmedAs: choice?.type ?? null,
      attributionItems: confirmedItems.filter((item) => item.basis === "input_attribution").length,
      totalItems: confirmedItems.length,
      sampleWhy: confirmedItems.filter((item) => item.basis === "input_attribution").slice(0, 2).map((item) => item.why),
      stages: summarizeSession(confirmed),
      rubric: evaluateSession(confirmed),
    },
    revision: { steps },
  };
}
