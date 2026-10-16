import { CATEGORIES, DEMO_AREA, resolveCenter } from "@/domain/demo";
import type {
  ExplanationBasis,
  PlaceCandidate,
  PlanItem,
  SignalSummary,
  StageKey,
  TasteInput,
} from "@/domain/types";
import { lacksAtmosphereData, livelySignals, morningSignals, quietSignals } from "./atmosphere";

export const UNVERIFIED_NOTICE = "Check current hours, prices, and details before visiting.";
export const PRICE_UNKNOWN_NOTICE = "Price not available — check current details.";
export const INDEPENDENCE_NOTICE = "Qloo doesn't say whether this shop is independent.";
export const NO_ATMOSPHERE_NOTICE = "Qloo returned no noise or ambience data for this place.";
const NO_RANKING_SENTENCE = "Matched by category and distance only; Qloo returned no taste ranking for it.";

export interface ExplainContext {
  input: TasteInput;
  /** Every signal sent to Qloo, to turn signal IDs back into the user's own words. */
  signals: SignalSummary[];
  preferIndependent: boolean;
}

export type ExplainedItem = Pick<
  PlanItem,
  "routine" | "why" | "basis" | "highlights" | "notices" | "externalUrl" | "category"
>;

/** Optional LLM wording hook; disabled by default. Output is validated, never trusted. */
export interface WordingAdapter {
  rewrite(facts: { text: string; allowedNumbers: string[] }): Promise<string> | string;
}

const label = (signals: SignalSummary[], id: string) => signals.find((signal) => signal.id === id)?.label;

function joinLabels(labels: string[]): string {
  const quoted = labels.map((value) => `“${value}”`);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function basisFor(candidate: PlaceCandidate, ctx: ExplainContext): { basis: ExplanationBasis; sentence: string } {
  const { explainability, signalTagIds } = candidate.evidence;
  if (explainability && explainability.length > 0) {
    // Qloo guarantees entries scoring >= 0.1; list contributors in score order.
    const contributors = [...explainability]
      .filter((entry) => entry.score >= 0.1)
      .sort((a, b) => b.score - a.score || a.entityId.localeCompare(b.entityId))
      .map((entry) => label(ctx.signals, entry.entityId))
      .filter((value): value is string => value !== undefined);
    if (contributors.length > 0) {
      const noun = contributors.length === 1 ? "pick" : "picks";
      return {
        basis: "input_attribution",
        sentence: `Your ${noun} ${joinLabels(contributors)} contributed to how Qloo ranked it.`,
      };
    }
  }
  const tagLabels = signalTagIds.map((id) => label(ctx.signals, id)).filter((value): value is string => value !== undefined);
  if (candidate.evidence.affinity !== undefined && tagLabels.length > 0) {
    return { basis: "taste_signals", sentence: `Qloo ranked it using your picks: ${joinLabels(tagLabels)}.` };
  }
  return { basis: "category_and_distance", sentence: NO_RANKING_SENTENCE };
}

/** Verbatim Qloo tags that back the user's stated atmosphere/routine preferences. */
function highlightsFor(candidate: PlaceCandidate, input: TasteInput): string[] {
  const picked: string[] = [];
  const wantsQuiet = input.atmosphere === "quiet" || input.strictQuiet === true;
  if (wantsQuiet) picked.push(...quietSignals(candidate).slice(0, 2));
  if (input.atmosphere === "lively") picked.push(...livelySignals(candidate).slice(0, 2));
  if (input.preferMornings) picked.push(...morningSignals(candidate).slice(0, 1));
  return [...new Set(picked)];
}

function routineFor(candidate: PlaceCandidate, input: TasteInput): string {
  const { name } = candidate;
  switch (candidate.category) {
    case "cafe":
      return input.preferMornings && morningSignals(candidate).length > 0
        ? `Try ${name} as a regular morning coffee stop`
        : `Try ${name} as a regular coffee stop`;
    case "bookstore":
      return `Browse ${name} on a slow day`;
    case "korean_restaurant":
      return `Try ${name} for a Korean meal`;
    case "museum":
      return `Spend an afternoon at ${name}`;
  }
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Words that would turn a ranking signal into a promise; wording must never contain them. */
const OVERCLAIM = /%|percent|probab|guarantee|\bchance\b|\bsure to\b|\bwill love\b|\bperfect match\b/i;

/**
 * Accept rewritten wording only if it adds no URL, no percentage/probability
 * language and no number that is not already in the facts.
 */
export function acceptWording(text: string, allowedNumbers: string[]): boolean {
  if (OVERCLAIM.test(text) || /https?:\/\//i.test(text)) return false;
  const numbers = text.match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.every((value) => allowedNumbers.includes(value));
}

/** Deterministic explanation grounded in the candidate's Qloo fields and the user's input. */
export async function explainCandidate(
  candidate: PlaceCandidate,
  stage: StageKey,
  ctx: ExplainContext,
  wording?: WordingAdapter,
): Promise<ExplainedItem> {
  void stage; // reserved: stage does not change facts, only the routine ordering in the plan
  const category = CATEGORIES[candidate.category];
  const distance = candidate.evidence.distanceMeters;
  const where =
    distance !== undefined
      ? `${capitalize(category.noun)} about ${formatKm(distance)} from ${resolveCenter(ctx.input.neighborhoodKey, ctx.input.customArea).label}.`
      : `${capitalize(category.noun)} in ${DEMO_AREA.label}.`;
  const { basis, sentence } = basisFor(candidate, ctx);
  const highlights = highlightsFor(candidate, ctx.input);
  const tagSentence = highlights.length > 0 ? ` Qloo tags it: ${highlights.join(", ")}.` : "";
  let why = `${where} ${sentence}${tagSentence}`;

  if (wording) {
    const allowedNumbers = why.match(/\d+(?:\.\d+)?/g) ?? [];
    try {
      const rewritten = (await wording.rewrite({ text: why, allowedNumbers })).trim();
      if (rewritten && acceptWording(rewritten, allowedNumbers)) why = rewritten;
    } catch {
      /* keep the deterministic wording */
    }
  }

  const notices = [UNVERIFIED_NOTICE];
  if (ctx.input.maxPriceLevel !== undefined && candidate.priceLevel === undefined) notices.push(PRICE_UNKNOWN_NOTICE);
  if (candidate.category === "bookstore" && ctx.preferIndependent) notices.push(INDEPENDENCE_NOTICE);
  const wantsAtmosphere = ctx.input.atmosphere !== "no_preference" || ctx.input.strictQuiet === true;
  if (wantsAtmosphere && lacksAtmosphereData(candidate)) notices.push(NO_ATMOSPHERE_NOTICE);

  return {
    category: candidate.category,
    routine: routineFor(candidate, ctx.input),
    why,
    basis,
    highlights,
    notices,
    ...(candidate.website ? { externalUrl: candidate.website } : {}),
  };
}
