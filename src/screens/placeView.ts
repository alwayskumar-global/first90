import { CATEGORIES, resolveCenter, type CategoryKey } from "@/domain/demo";
import type { ExplanationBasis, PlaceCandidate, PlanItem, PlanSession } from "@/domain/types";
import type { IconName } from "@/components/Icon";
import { formatKm } from "@/lib/agent/explain";

export const CATEGORY_ICON: Record<CategoryKey, IconName> = {
  cafe: "coffee", bookstore: "book-open", korean_restaurant: "utensils", museum: "landmark",
};

/** Short category label for badges and tiles. */
export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  cafe: "Café", bookstore: "Bookstore", korean_restaurant: "Korean restaurant", museum: "Cultural venue",
};

/** One line under each routine heading. Generic to the kind of place; it makes no claim about a specific place. */
export const ROUTINE_BLURB: Record<CategoryKey, string> = {
  cafe: "A café you can return to until it feels like yours.",
  bookstore: "A bookstore for browsing, with no plan needed.",
  korean_restaurant: "A relaxed place to eat that doesn’t take much planning.",
  museum: "A cultural stop for an unhurried afternoon.",
};

export const BASIS_LABEL: Record<ExplanationBasis, string> = {
  input_attribution: "Based on your picks",
  taste_signals: "Ranked using your picks",
  category_and_distance: "Matched by category and distance",
};

export function areaLabelOf(session: PlanSession): string {
  return resolveCenter(session.plan.input.neighborhoodKey, session.plan.input.customArea).label;
}

/** "0.2 km from Five Points" (Qloo's distance from the search center). */
export function distanceText(candidate: PlaceCandidate, session: PlanSession): string {
  const meters = candidate.evidence.distanceMeters;
  return meters === undefined ? areaLabelOf(session) : `${formatKm(meters)} from ${areaLabelOf(session)}`;
}

export function priceText(candidate: PlaceCandidate): string | null {
  return candidate.priceLevel ? "$".repeat(Math.min(4, Math.max(1, Math.round(candidate.priceLevel)))) : null;
}

/** The user's own words that this suggestion was ranked with (from the Qloo request, never invented). */
export function connectedInterests(item: PlanItem, candidate: PlaceCandidate, session: PlanSession): string[] {
  const label = (id: string) => session.signals.find((s) => s.id === id)?.label;
  const ids =
    item.basis === "input_attribution"
      ? [...(candidate.evidence.explainability ?? [])].filter((e) => e.score >= 0.1).sort((a, b) => b.score - a.score).map((e) => e.entityId)
      : item.basis === "taste_signals"
        ? candidate.evidence.signalTagIds
        : [];
  return [...new Set(ids.map(label).filter((v): v is string => !!v))];
}

export const categoryPlural = (key: CategoryKey) => CATEGORIES[key].label.toLowerCase();
