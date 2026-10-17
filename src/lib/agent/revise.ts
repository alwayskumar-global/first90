import { categoryLabelFor, categoryNounFor } from "@/domain/cuisine";
import { MIN_RADIUS_METERS, STAGE_LABELS, type CategoryKey } from "@/domain/demo";
import type {
  AppliedConstraint,
  Feedback,
  NoVerifiedMatch,
  PlaceCandidate,
  Plan,
  PlanItem,
  PlanRevision,
  PlanSession,
  StageKey,
  TasteInput,
} from "@/domain/types";
import { STAGE_KEYS } from "@/domain/types";
import { findOutOfLimit } from "./constraints";
import { explainCandidate, formatKm, PRICE_UNKNOWN_NOTICE, type WordingAdapter } from "./explain";
import { lacksAtmosphereData, quietSignals } from "./atmosphere";
import { makeScoringContext, selectEligible, summarizeResolution } from "./pipeline";
import { pickForStage } from "./planner";

export class FeedbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackError";
  }
}

const CATEGORY_PENALTY = -0.15;

export const itemId = (qlooEntityId: string) => `item:${qlooEntityId}`;
const dollars = (level: number) => "$".repeat(level);

function locate(plan: Plan, id: string): { stage: StageKey; index: number; item: PlanItem } | null {
  for (const stage of STAGE_KEYS) {
    const index = plan.stages[stage].findIndex((item) => item.id === id);
    const item = plan.stages[stage][index];
    if (item) return { stage, index, item };
  }
  return null;
}

/** Cumulative "not interested" penalties already recorded on the plan. */
export function categoryAdjustFromConstraints(constraints: AppliedConstraint[]): Map<CategoryKey, number> {
  const adjust = new Map<CategoryKey, number>();
  for (const constraint of constraints) {
    if (constraint.kind === "category_penalty" && constraint.category) {
      adjust.set(constraint.category, (adjust.get(constraint.category) ?? 0) + CATEGORY_PENALTY);
    }
  }
  return adjust;
}

export interface DerivedConstraint {
  input: TasteInput;
  constraint?: AppliedConstraint;
  /** Set when the data could not honor the reason fully. */
  limitation?: string;
}

/** Translate a feedback reason into an explicit constraint (or an honest limitation). */
export function deriveConstraint(
  reason: Feedback["reason"],
  item: PlanItem,
  candidate: PlaceCandidate | undefined,
  input: TasteInput,
): DerivedConstraint {
  const name = candidate?.name ?? "this place";
  switch (reason) {
    case "too_expensive": {
      const price = candidate?.priceLevel;
      if (price === undefined) {
        return {
          input,
          limitation: `Qloo has no price level for ${name}, so a cheaper alternative can't be verified. It was removed; the replacement's price may also be unavailable.`,
        };
      }
      const next = Math.min(input.maxPriceLevel ?? 4, price - 1);
      if (next < 1) {
        return {
          input,
          limitation: `${name} is already at Qloo's lowest price level (${dollars(1)}), so the price ceiling can't be tightened further.`,
        };
      }
      return {
        input: { ...input, maxPriceLevel: next as 1 | 2 | 3 | 4 },
        constraint: { kind: "max_price", label: `Price ceiling lowered to ${dollars(next)}`, reason: "too_expensive", sourceItemId: item.id },
      };
    }
    case "too_far": {
      const next = Math.max(MIN_RADIUS_METERS, Math.round(input.radiusMeters / 2 / 500) * 500);
      if (next >= input.radiusMeters) {
        return { input, limitation: `The distance limit is already at its minimum (${formatKm(input.radiusMeters)}).` };
      }
      return {
        input: { ...input, radiusMeters: next },
        constraint: { kind: "radius", label: `Distance limit reduced to ${formatKm(next)}`, reason: "too_far", sourceItemId: item.id },
      };
    }
    case "too_loud": {
      if (input.strictQuiet) {
        return { input, limitation: "Places Qloo tags as loud or lively were already being excluded." };
      }
      return {
        input: { ...input, atmosphere: "quiet", strictQuiet: true },
        constraint: { kind: "strict_quiet", label: "Excluding places Qloo tags as loud or lively", reason: "too_loud", sourceItemId: item.id },
      };
    }
    case "not_interested":
      return {
        input,
        constraint: {
          kind: "category_penalty",
          label: `Fewer ${categoryLabelFor(item.category, input.cuisineTagId).toLowerCase()} suggestions`,
          reason: "not_interested",
          sourceItemId: item.id,
          category: item.category,
        },
      };
    default:
      return { input };
  }
}

function noMatchFor(
  stage: StageKey,
  reason: Feedback["reason"],
  before: TasteInput,
  after: TasteInput,
): NoVerifiedMatch {
  const stageLabel = STAGE_LABELS[stage];
  switch (reason) {
    case "too_far":
      return {
        stage,
        message: `No other verified place within ${formatKm(after.radiusMeters)} fits ${stageLabel}.`,
        suggestion: `Widen the distance limit back to ${formatKm(before.radiusMeters)}.`,
      };
    case "too_expensive":
      return {
        stage,
        message: `No other verified place at or below ${dollars(after.maxPriceLevel ?? 1)} fits ${stageLabel}.`,
        suggestion: after.maxPriceLevel && after.maxPriceLevel < 4
          ? `Raise the price ceiling to ${dollars(after.maxPriceLevel + 1)} or remove it.`
          : "Remove the price ceiling.",
      };
    case "too_loud":
      return {
        stage,
        message: `No other place without loud or lively tags in Qloo's data fits ${stageLabel}.`,
        suggestion: "Allow lively places for this stage, or add another interest.",
      };
    default:
      return {
        stage,
        message: `No other verified place fits ${stageLabel}.`,
        suggestion: "Add or change an interest, or widen the distance limit.",
      };
  }
}

export interface ReviseOutcome {
  session: PlanSession;
  revision: PlanRevision;
}

/**
 * Apply one piece of feedback. Pure given the candidate pool: only the
 * affected item changes; every other item (saved or not) keeps its exact
 * content and position. A hard constraint is never relaxed to find a match.
 */
export async function reviseWithPool(args: {
  session: PlanSession;
  feedback: Feedback;
  pool: PlaceCandidate[];
  wording?: WordingAdapter;
}): Promise<ReviseOutcome> {
  const { session, feedback, pool, wording } = args;
  const before = structuredClone(session.plan);
  const found = locate(before, feedback.itemId);
  if (!found) throw new FeedbackError(`Unknown plan item "${feedback.itemId}".`);
  const { stage, index, item } = found;

  const after = structuredClone(before);
  if (feedback.action === "save") {
    after.stages[stage][index]!.status = "saved";
    return { session: { ...session, plan: after }, revision: { feedback, before, after } };
  }

  const removedCandidate = session.candidates[item.qlooEntityId];
  const derived = deriveConstraint(feedback.reason, item, removedCandidate, before.input);
  after.input = derived.input;
  after.stages[stage].splice(index, 1);
  if (!after.dismissedEntityIds.includes(item.qlooEntityId)) after.dismissedEntityIds.push(item.qlooEntityId);
  after.constraints.push({
    kind: "exclude_entity",
    label: `${removedCandidate?.name ?? "A place"} won't be suggested again`,
    reason: feedback.reason ?? "user_setting",
    sourceItemId: item.id,
  });
  if (derived.constraint) after.constraints.push(derived.constraint);

  const candidates = { ...session.candidates };
  delete candidates[item.qlooEntityId];

  // A price ceiling now exists: existing items Qloo has no price for must say so (only their notices change).
  if (derived.constraint?.kind === "max_price") {
    for (const key of STAGE_KEYS) {
      for (const entry of after.stages[key]) {
        if (candidates[entry.qlooEntityId]?.priceLevel === undefined && !entry.notices.includes(PRICE_UNKNOWN_NOTICE)) {
          entry.notices.push(PRICE_UNKNOWN_NOTICE);
        }
      }
    }
  }

  const revision: PlanRevision = {
    feedback,
    before,
    after,
    removedItemId: item.id,
    ...(derived.constraint ? { appliedConstraint: derived.constraint } : {}),
    ...(derived.limitation ? { limitation: derived.limitation } : {}),
  };
  const finishDismiss = (): ReviseOutcome => ({
    session: {
      ...session,
      plan: after,
      candidates,
      outOfLimitItemIds: findOutOfLimit(STAGE_KEYS.flatMap((key) => after.stages[key]), candidates, after.input),
    },
    revision,
  });
  if (feedback.action === "dismiss") return finishDismiss();

  // replace: choose the best eligible alternate for the same stage
  const inPlan = STAGE_KEYS.flatMap((key) => after.stages[key].map((entry) => entry.qlooEntityId));
  const { eligible } = selectEligible(pool, after.input, [...after.dismissedEntityIds, ...inPlan]);
  const { interestCategories } = summarizeResolution(after.input, session.interests);
  const adjust = categoryAdjustFromConstraints(after.constraints);
  const ctx = makeScoringContext(after.input, eligible, interestCategories, adjust);
  const stageCategories = new Set(after.stages[stage].map((entry) => entry.category));

  // A limit-based reason ("too far", "too expensive", "too loud") should keep the same kind of
  // place when one still qualifies; "not interested" and plain replacements may switch category.
  const keepCategory = feedback.reason === "too_far" || feedback.reason === "too_expensive" || feedback.reason === "too_loud";
  const sameCategory = keepCategory ? eligible.filter((candidate) => candidate.category === item.category) : [];
  let pick = sameCategory.length > 0 ? pickForStage(sameCategory, stage, ctx, stageCategories) : null;
  const switchedCategory = keepCategory && !pick;
  pick ??= pickForStage(eligible, stage, ctx, stageCategories);

  const finish = (nextCandidates: Record<string, PlaceCandidate>): ReviseOutcome => {
    const flagged = findOutOfLimit(
      STAGE_KEYS.flatMap((key) => after.stages[key]),
      nextCandidates,
      after.input,
    );
    return { session: { ...session, plan: after, candidates: nextCandidates, outOfLimitItemIds: flagged }, revision };
  };

  if (!pick) {
    revision.noMatch = noMatchFor(stage, feedback.reason, before.input, after.input);
    return finish(candidates);
  }

  const explained = await explainCandidate(
    pick.candidate,
    stage,
    { input: after.input, signals: session.signals, preferIndependent: ctx.preferIndependent },
    wording,
  );
  const added: PlanItem = {
    id: itemId(pick.candidate.qlooEntityId),
    stage,
    qlooEntityId: pick.candidate.qlooEntityId,
    ...explained,
    status: "suggested",
  };
  after.stages[stage].splice(index, 0, added);
  candidates[pick.candidate.qlooEntityId] = pick.candidate;
  revision.addedItemId = added.id;

  // Be honest when the replacement can't be verified against the reason given.
  const notes: string[] = revision.limitation ? [revision.limitation] : [];
  if (switchedCategory) {
    notes.push(`No other ${categoryLabelFor(item.category, session.plan.input.cuisineTagId).toLowerCase()} met your limits, so a ${categoryNounFor(pick.candidate.category, session.plan.input.cuisineTagId)} was suggested instead.`);
  }
  if (feedback.reason === "too_loud" && quietSignals(pick.candidate).length === 0) {
    notes.push(
      `${pick.candidate.name} has no loud or lively tags in Qloo's data, but it isn't verified as quiet either (${
        lacksAtmosphereData(pick.candidate) ? "Qloo has no noise data for it" : "Qloo lists no quiet tags for it"
      }).`,
    );
  }
  if (feedback.reason === "too_expensive" && pick.candidate.priceLevel === undefined) {
    notes.push(`Qloo has no price level for ${pick.candidate.name}, so its price is unverified.`);
  }
  if (notes.length > 0) revision.limitation = notes.join(" ");
  return finish(candidates);
}
