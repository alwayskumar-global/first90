import { ITEMS_PER_STAGE } from "@/domain/demo";
import type { CategoryKey } from "@/domain/demo";
import { STAGE_KEYS, type PlaceCandidate, type StageKey } from "@/domain/types";
import { compareScored, fitScore, type ScoringContext } from "./scoring";

export interface StagePick {
  candidate: PlaceCandidate;
  score: number;
}

/**
 * Best candidate for one stage slot. Prefers a category not already in the
 * stage (diversity); only when no such candidate exists does it allow a
 * repeat. Pure and deterministic.
 */
export function pickForStage(
  pool: PlaceCandidate[],
  stage: StageKey,
  ctx: ScoringContext,
  categoriesInStage: ReadonlySet<CategoryKey>,
): StagePick | null {
  const scored = pool.map((candidate) => ({ candidate, score: fitScore(candidate, stage, ctx).score })).sort(compareScored);
  const fresh = scored.find((entry) => !categoriesInStage.has(entry.candidate.category));
  return fresh ?? scored[0] ?? null;
}

/**
 * Three-stage assignment: stages are filled in order, each up to
 * ITEMS_PER_STAGE slots; an entity appears at most once across the plan.
 * When fewer than nine candidates remain, slots are spread across the
 * remaining stages (e.g. 5 -> 2, 2, 1) so no stage is left empty.
 */
export function constructStages(pool: PlaceCandidate[], ctx: ScoringContext): Record<StageKey, StagePick[]> {
  const stages: Record<StageKey, StagePick[]> = { first_week: [], first_month: [], months_2_3: [] };
  const taken = new Set<string>();

  for (const [stageIndex, stage] of STAGE_KEYS.entries()) {
    const categories = new Set<CategoryKey>();
    const stagesLeft = STAGE_KEYS.length - stageIndex;
    const slots = Math.min(ITEMS_PER_STAGE, Math.ceil((pool.length - taken.size) / stagesLeft));
    for (let slot = 0; slot < slots; slot++) {
      const remaining = pool.filter((candidate) => !taken.has(candidate.qlooEntityId));
      const pick = pickForStage(remaining, stage, ctx, categories);
      if (!pick) break;
      stages[stage].push(pick);
      taken.add(pick.candidate.qlooEntityId);
      categories.add(pick.candidate.category);
    }
  }
  return stages;
}
