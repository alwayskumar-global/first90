import { NEIGHBORHOODS, SEARCH_SCOPES, type ScopeKey } from "@/domain/demo";
import { cuisineName } from "@/domain/cuisine";
import { cuisineOf } from "./input";
import { extraCuisineAnchors, unsearchedAnchors } from "./labels";
import type { Anchor, AtmosphereChoice, BudgetChoice, FlowState, RoutineId } from "./types";

/** What the demo can suggest, in the words used in notes. */
export const DEMO_COVERS = "cafés, bookstores, restaurants, and museums";

export const ROUTINE_CARDS: { id: RoutineId; title: string; desc: string; covers: string; icon: "book-open" | "utensils" | "footprints" | "landmark" }[] = [
  { id: "work", title: "A place to work or read", desc: "Quiet spots for a laptop or a long book", covers: "cafés and bookstores", icon: "book-open" },
  { id: "meals", title: "Easy meals out", desc: "Dependable, relaxed places to eat", covers: "restaurants (your cuisine, if you named one)", icon: "utensils" },
  { id: "weekend", title: "Weekend exploring", desc: "Something to wander into on a free day", covers: "museums and bookstores", icon: "footprints" },
  { id: "arts", title: "Arts and culture", desc: "Galleries, venues, and cultural spaces", covers: "museums and cultural venues", icon: "landmark" },
];

const listNames = (anchors: Anchor[]) => anchors.map((a) => `“${a.name}”`);

/** Full sentence(s) for the interest step, or null when every interest can add suggestions (or is not a place type). */
export function unsearchedNote(anchors: Anchor[]): string | null {
  const parts: string[] = [];
  const other = unsearchedAnchors(anchors);
  if (other.length > 0) {
    const many = other.length > 1;
    parts.push(
      `${listNames(other).join(", ")} ${many ? "aren’t" : "isn’t"} one of this demo’s place types (${DEMO_COVERS}). ${many ? "They’ll" : "It’ll"} still help rank places as ${many ? "taste signals" : "a taste signal"}, but won’t add suggestions of ${many ? "their" : "its"} own.`,
    );
  }
  const extra = extraCuisineAnchors(anchors);
  if (extra.length > 0) {
    const many = extra.length > 1;
    parts.push(
      `Your plan looks for one cuisine at a time (${cuisineName(cuisineOf(anchors)) ?? "your first"}), so ${listNames(extra).join(", ")} ${many ? "aren’t" : "isn’t"} searched. ${many ? "They’ll" : "It’ll"} still help rank places.`,
    );
  }
  return parts.length ? parts.join(" ") : null;
}

/** Short form for the plan and progress summaries. */
export function unsearchedShort(anchors: Anchor[]): string | null {
  const other = unsearchedAnchors(anchors);
  const extra = extraCuisineAnchors(anchors);
  const parts: string[] = [];
  if (other.length > 0) parts.push(`${other.map((a) => a.name).join(", ")}: taste signal only. This demo covers ${DEMO_COVERS}.`);
  if (extra.length > 0) parts.push(`${extra.map((a) => a.name).join(", ")}: taste signal only. One cuisine per plan.`);
  return parts.length ? parts.join(" ") : null;
}

export const ATMOSPHERE_CARDS: { id: AtmosphereChoice; title: string; desc: string }[] = [
  { id: "quiet", title: "Quiet and relaxed", desc: "Calmer places, easy to talk or focus" },
  { id: "mix", title: "A mix of both", desc: "Some of each, depending on the day" },
  { id: "lively", title: "Lively and social", desc: "Busier places with more going on" },
];
export const BUDGET_CARDS: { id: BudgetChoice; title: string }[] = [
  { id: "budget", title: "Budget-friendly" },
  { id: "flex", title: "Flexible" },
  { id: "more", title: "Prefer to spend more" },
  { id: "none", title: "No preference" },
];

export function areaText(state: Pick<FlowState, "area">, short = false): string {
  const { neighborhoodKey, custom, unsure } = state.area;
  if (custom && !unsure) return short ? custom.label : `${custom.label}, Raleigh area`;
  if (neighborhoodKey && !unsure) return short ? NEIGHBORHOODS[neighborhoodKey].name : `${NEIGHBORHOODS[neighborhoodKey].name}, Raleigh`;
  return short ? "Raleigh" : "All of Raleigh, NC";
}

export function rangeText(state: Pick<FlowState, "area">): string {
  const scope: ScopeKey = state.area.unsure && state.area.scope === "nearby" ? "city" : state.area.scope;
  return SEARCH_SCOPES[scope].label;
}

/** Plain-language summary of the choices on the preferences step. */
export function choicesText(prefs: FlowState["prefs"]): string {
  const parts: string[] = [];
  if (prefs.routines.length) parts.push(`${prefs.routines.length} ${prefs.routines.length === 1 ? "routine" : "routines"}`);
  if (prefs.atmosphere) parts.push(ATMOSPHERE_CARDS.find((a) => a.id === prefs.atmosphere)!.title.toLowerCase());
  if (prefs.budget) parts.push(`dining: ${BUDGET_CARDS.find((b) => b.id === prefs.budget)!.title.toLowerCase()}`);
  if (parts.length) return parts.join(" · ");
  const { skipped } = prefs;
  return skipped.routines && skipped.atmosphere && skipped.budget ? "All skipped. We’ll start with a balanced mix." : "Nothing chosen yet. All of this is optional.";
}
