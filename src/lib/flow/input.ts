import { isCuisineTag } from "@/domain/cuisine";
import { CATEGORIES, CATEGORY_KEYS, SEARCH_SCOPES, type CategoryKey } from "@/domain/demo";
import type { TasteInput } from "@/domain/types";
import type { Anchor, FlowState, RoutineId } from "./types";

/** Routine cards in the setup flow, mapped to the place categories the demo supports. */
export const ROUTINE_CATEGORIES: Record<RoutineId, CategoryKey[]> = {
  work: ["cafe", "bookstore"],
  meals: ["restaurant"],
  weekend: ["museum", "bookstore"],
  arts: ["museum"],
};

/** Dining budget choices -> Qloo price-level ceiling. Only "Budget-friendly" sets a ceiling. */
export const BUDGET_CEILING = { budget: 2 } as const;

export function categoryOfTag(matchId: string | undefined): CategoryKey | undefined {
  if (isCuisineTag(matchId)) return "restaurant"; // CR-009: any cuisine tag asks for restaurants
  return CATEGORY_KEYS.find((key) => CATEGORIES[key].filterTagId === matchId);
}

/** The cuisine to plan around (CR-009): the first cuisine interest. Others are noted and still rank places. */
export function cuisineOf(anchors: Pick<Anchor, "kind" | "matchId">[]): string | undefined {
  return anchors.find((a) => (a.kind === "resolved" || a.kind === "confirmed") && isCuisineTag(a.matchId))?.matchId;
}

/** Categories to search: routines (plus any category a stated interest names); none chosen = all four. */
export function selectCategories(state: Pick<FlowState, "prefs" | "anchors">): CategoryKey[] {
  const chosen = new Set<CategoryKey>();
  if (!state.prefs.skipped.routines) for (const routine of state.prefs.routines) ROUTINE_CATEGORIES[routine].forEach((c) => chosen.add(c));
  if (chosen.size === 0) return [...CATEGORY_KEYS];
  for (const anchor of state.anchors) if (anchor.category) chosen.add(anchor.category);
  return CATEGORY_KEYS.filter((key) => chosen.has(key));
}

/** Build the engine's TasteInput from what the user entered. Pure. */
export function buildTasteInput(state: FlowState): TasteInput {
  const { area, anchors, prefs } = state;
  const scope = area.unsure && area.scope === "nearby" ? "city" : area.scope; // "Nearby" needs an area
  const confirmations = Object.fromEntries(
    anchors.filter((a: Anchor) => a.kind === "confirmed" && a.matchId).map((a) => [a.input, a.matchId as string]),
  );
  const atmosphere = prefs.skipped.atmosphere ? null : prefs.atmosphere;
  return {
    interests: anchors.map((a) => a.input),
    ...(Object.keys(confirmations).length > 0 ? { confirmations } : {}),
    areaKey: "raleigh-nc",
    ...(area.neighborhoodKey && !area.unsure ? { neighborhoodKey: area.neighborhoodKey } : {}),
    ...(area.custom && !area.unsure ? { customArea: area.custom } : {}),
    ...(cuisineOf(anchors) ? { cuisineTagId: cuisineOf(anchors) as string } : {}),
    radiusMeters: SEARCH_SCOPES[scope].radiusMeters,
    categories: selectCategories(state),
    ...(!prefs.skipped.budget && prefs.budget === "budget" ? { maxPriceLevel: BUDGET_CEILING.budget } : {}),
    atmosphere: atmosphere === "quiet" ? "quiet" : atmosphere === "lively" ? "lively" : "no_preference",
    preferMornings: false,
  };
}
