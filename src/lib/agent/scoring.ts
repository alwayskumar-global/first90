import type { CategoryKey } from "@/domain/demo";
import type { PlaceCandidate, StageKey, TasteInput } from "@/domain/types";
import { morningSignals, quietScore } from "./atmosphere";
import { assessRelevance } from "./relevance";

/**
 * Planner fit score. This is OUR composite ranking aid, not a Qloo score and
 * not a probability that anyone will enjoy a place. It is only ever used to
 * order eligible candidates; it is never shown to users.
 *
 *   fit = 0.30 * affinity        Qloo `query.affinity`, min-max within the category pool; 0.5 if absent or flat
 *       + 0.08 * popularity      Qloo `popularity` (0-1); 0.5 if absent
 *       + 0.08 * rating          Qloo `business_rating` / 5 when 0 < r <= 5 (assumed 0-5 scale); else 0.5
 *       + w_prox(stage) * proximity   1 - distance/radius (closer is better), clamped 0..1
 *       + 0.14 * atmosphere      quietScore (+1 quiet .. -1 lively) when the user prefers quiet; negated for lively
 *       + 0.10 * morning         1 if Qloo lists a Morning fit and the user prefers mornings
 *       + 0.08 * interestBoost   1 if the category matches a stated interest
 *       + 0.12 * stageFit        how well the category suits the stage (table below)
 *       + 0.06 * directness      1 if Qloo's primary genre matches the category, 0.5 if matched by name/tags
 *       + adjustments            feedback continuity (+) / "not interested" category penalty (-), chain penalty (-0.15)
 *
 * Ties are broken by Qloo entity ID (ascending), so identical inputs and
 * identical Qloo data always yield the identical plan.
 */
export const WEIGHTS = {
  affinity: 0.3,
  popularity: 0.08,
  rating: 0.08,
  atmosphere: 0.14,
  morning: 0.1,
  interestBoost: 0.08,
  stageFit: 0.12,
  directness: 0.06,
} as const;

export const PROXIMITY_WEIGHT: Record<StageKey, number> = {
  first_week: 0.24,
  first_month: 0.16,
  months_2_3: 0.08,
};

/** Which categories suit which stage: everyday routines first, bigger outings later. */
export const STAGE_CATEGORY_FIT: Record<StageKey, Record<CategoryKey, number>> = {
  first_week: { cafe: 1, bookstore: 0.8, korean_restaurant: 0.5, museum: 0.2 },
  first_month: { cafe: 0.6, bookstore: 0.8, korean_restaurant: 1, museum: 0.6 },
  months_2_3: { cafe: 0.3, bookstore: 0.6, korean_restaurant: 0.6, museum: 1 },
};

export const CHAIN_PENALTY = 0.15;
/**
 * Heuristic for "indie"/"local" interests only: national chains are ranked
 * lower. Matched on the place name; never displayed as a claim about the place.
 */
const CHAIN_NAME = /\b(barnes\s*&\s*noble|starbucks|caribou coffee|panera|dunkin|tropical smoothie|bruegger)/i;

export interface AffinityRange {
  min: number;
  max: number;
}

export interface ScoringContext {
  input: TasteInput;
  /** Categories directly named by a stated interest. */
  interestCategories: ReadonlySet<CategoryKey>;
  preferIndependent: boolean;
  /** Feedback-driven per-category adjustments (continuity bonus / penalty). */
  categoryAdjust: ReadonlyMap<CategoryKey, number>;
  affinityRanges: ReadonlyMap<CategoryKey, AffinityRange>;
}

export function buildAffinityRanges(candidates: PlaceCandidate[]): Map<CategoryKey, AffinityRange> {
  const ranges = new Map<CategoryKey, AffinityRange>();
  for (const candidate of candidates) {
    const affinity = candidate.evidence.affinity;
    if (affinity === undefined) continue;
    const current = ranges.get(candidate.category);
    ranges.set(candidate.category, {
      min: Math.min(current?.min ?? affinity, affinity),
      max: Math.max(current?.max ?? affinity, affinity),
    });
  }
  return ranges;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

export interface ScoreBreakdown {
  score: number;
  parts: Record<string, number>;
}

export function fitScore(candidate: PlaceCandidate, stage: StageKey, ctx: ScoringContext): ScoreBreakdown {
  const range = ctx.affinityRanges.get(candidate.category);
  const affinity = candidate.evidence.affinity;
  const affinityPart =
    affinity !== undefined && range && range.max > range.min ? (affinity - range.min) / (range.max - range.min) : 0.5;
  const popularityPart = candidate.popularity !== undefined ? clamp(candidate.popularity, 0, 1) : 0.5;
  const rating = candidate.businessRating;
  const ratingPart = rating !== undefined && rating > 0 && rating <= 5 ? rating / 5 : 0.5;
  const distance = candidate.evidence.distanceMeters ?? ctx.input.radiusMeters;
  const proximityPart = clamp(1 - distance / Math.max(1, ctx.input.radiusMeters), 0, 1);

  const wantsQuiet = ctx.input.atmosphere === "quiet" || ctx.input.strictQuiet === true;
  const atmospherePart = wantsQuiet ? quietScore(candidate) : ctx.input.atmosphere === "lively" ? -quietScore(candidate) : 0;
  const morningPart = ctx.input.preferMornings && morningSignals(candidate).length > 0 ? 1 : 0;
  const interestPart = ctx.interestCategories.has(candidate.category) ? 1 : 0;
  const stageFitPart = STAGE_CATEGORY_FIT[stage][candidate.category];
  const verdict = assessRelevance(candidate);
  const directnessPart = verdict.strength === "primary" ? 1 : 0.5;
  const adjust = ctx.categoryAdjust.get(candidate.category) ?? 0;
  const chain = ctx.preferIndependent && CHAIN_NAME.test(candidate.name) ? -CHAIN_PENALTY : 0;

  const parts = {
    affinity: WEIGHTS.affinity * affinityPart,
    popularity: WEIGHTS.popularity * popularityPart,
    rating: WEIGHTS.rating * ratingPart,
    proximity: PROXIMITY_WEIGHT[stage] * proximityPart,
    atmosphere: WEIGHTS.atmosphere * atmospherePart,
    morning: WEIGHTS.morning * morningPart,
    interestBoost: WEIGHTS.interestBoost * interestPart,
    stageFit: WEIGHTS.stageFit * stageFitPart,
    directness: WEIGHTS.directness * directnessPart,
    adjustments: adjust + chain,
  };
  const score = round6(Object.values(parts).reduce((sum, part) => sum + part, 0));
  return { score, parts };
}

/** Descending score, then ascending Qloo entity ID. */
export function compareScored(
  a: { score: number; candidate: PlaceCandidate },
  b: { score: number; candidate: PlaceCandidate },
): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.candidate.qlooEntityId < b.candidate.qlooEntityId ? -1 : a.candidate.qlooEntityId > b.candidate.qlooEntityId ? 1 : 0;
}
