import type { CategoryKey, CustomArea, NeighborhoodKey, ScopeKey } from "@/domain/demo";
import type { PlanSession } from "@/domain/types";

export type RoutineId = "work" | "meals" | "weekend" | "arts";
export type AtmosphereChoice = "quiet" | "mix" | "lively";
export type BudgetChoice = "budget" | "flex" | "more" | "none";

/** One thing the user told us they like, plus how it resolved. */
export interface Anchor {
  /** The text sent to the engine (what the user typed or picked). */
  input: string;
  /** Display name. */
  name: string;
  /** Display type chip, e.g. "Author", "Place", "Your words". */
  type: string;
  kind: "resolved" | "preference" | "confirmed" | "own";
  /** Qloo tag/entity id for resolved or confirmed matches. */
  matchId?: string;
  /** Category this interest names, if any (drives category selection). */
  category?: CategoryKey;
}

export interface FlowState {
  hydrated: boolean;
  /** `custom` (CR-007) is a searched place; it excludes a curated neighborhood. */
  area: { neighborhoodKey: NeighborhoodKey | null; custom: CustomArea | null; unsure: boolean; scope: ScopeKey };
  anchors: Anchor[];
  prefs: {
    routines: RoutineId[];
    atmosphere: AtmosphereChoice | null;
    budget: BudgetChoice | null;
    skipped: { routines: boolean; atmosphere: boolean; budget: boolean };
  };
  session: PlanSession | null;
  /** One level of undo for "Replace". */
  previousSession: PlanSession | null;
  /** Latest revision message, shown on the replaced item until the next action. */
  lastChange: { itemId: string; message: string; limitation?: string } | null;
  stage: "week" | "month" | "later";
  reviewed: ("week" | "month" | "later")[];
}
