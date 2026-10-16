import { NEIGHBORHOODS, SEARCH_SCOPES, type ScopeKey } from "@/domain/demo";
import type { AtmosphereChoice, BudgetChoice, FlowState, RoutineId } from "./types";

export const ROUTINE_CARDS: { id: RoutineId; title: string; desc: string; icon: "book-open" | "utensils" | "footprints" | "landmark" }[] = [
  { id: "work", title: "A place to work or read", desc: "Quiet spots for a laptop or a long book", icon: "book-open" },
  { id: "meals", title: "Easy meals out", desc: "Dependable, relaxed places to eat", icon: "utensils" },
  { id: "weekend", title: "Weekend exploring", desc: "Something to wander into on a free day", icon: "footprints" },
  { id: "arts", title: "Arts and culture", desc: "Galleries, venues, and cultural spaces", icon: "landmark" },
];
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
