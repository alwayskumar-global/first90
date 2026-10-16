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
  return repairHomogeneousStages(stages, ctx);
}

const distinctCategories = (picks: StagePick[]) => new Set(picks.map((pick) => pick.candidate.category)).size;
const isHomogeneous = (picks: StagePick[]) => picks.length > 1 && distinctCategories(picks) === 1;

/**
 * Greedy fill can leave a late stage with several places of one category when
 * the pool is small. Swap one item with another stage (best total fit, ties by
 * id) when that gives both stages a mix. Deterministic; a no-op when no stage
 * is homogeneous.
 */
function repairHomogeneousStages(stages: Record<StageKey, StagePick[]>, ctx: ScoringContext): Record<StageKey, StagePick[]> {
  for (const stage of STAGE_KEYS) {
    if (!isHomogeneous(stages[stage])) continue;
    let best: { score: number; stageB: StageKey; a: number; b: number; key: string } | null = null;
    for (const stageB of STAGE_KEYS) {
      if (stageB === stage) continue;
      stages[stage].forEach((itemA, a) => {
        stages[stageB].forEach((itemB, b) => {
          if (itemB.candidate.category === itemA.candidate.category) return;
          const nextStage = stages[stage].map((pick, i) => (i === a ? itemB : pick));
          const nextOther = stages[stageB].map((pick, i) => (i === b ? itemA : pick));
          if (isHomogeneous(nextStage) || (isHomogeneous(nextOther) && !isHomogeneous(stages[stageB]))) return;
          const score =
            fitScore(itemB.candidate, stage, ctx).score + fitScore(itemA.candidate, stageB, ctx).score -
            fitScore(itemA.candidate, stage, ctx).score - fitScore(itemB.candidate, stageB, ctx).score;
          const key = `${itemA.candidate.qlooEntityId}|${itemB.candidate.qlooEntityId}`;
          if (!best || score > best.score || (score === best.score && key < best.key)) best = { score, stageB, a, b, key };
        });
      });
    }
    if (best) {
      const { stageB, a, b } = best as { stageB: StageKey; a: number; b: number };
      const itemA = stages[stage][a]!;
      stages[stage][a] = stages[stageB][b]!;
      stages[stageB][b] = itemA;
    }
  }
  return stages;
}
