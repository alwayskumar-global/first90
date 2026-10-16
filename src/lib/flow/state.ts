import { CATEGORIES, DEMO_PERSONA, type CustomArea, type NeighborhoodKey, type ScopeKey } from "@/domain/demo";
import { setSaved } from "@/domain/session";
import type { PlanSession } from "@/domain/types";
import { anchorFromMatch, anchorFromPreference } from "./labels";
import type { Anchor, AtmosphereChoice, BudgetChoice, FlowState, RoutineId } from "./types";

export const MAX_ANCHORS = 5;

export const initialState: FlowState = {
  hydrated: false,
  area: { neighborhoodKey: null, custom: null, unsure: false, scope: "nearby" },
  anchors: [],
  prefs: { routines: [], atmosphere: null, budget: null, skipped: { routines: false, atmosphere: false, budget: false } },
  session: null,
  previousSession: null,
  lastChange: null,
  stage: "week",
  reviewed: [],
};

export type FlowAction =
  | { type: "hydrate"; state: FlowState | null }
  | { type: "setNeighborhood"; key: NeighborhoodKey }
  | { type: "setCustomArea"; area: CustomArea }
  | { type: "setUnsure" }
  | { type: "clearArea" }
  | { type: "setScope"; scope: ScopeKey }
  | { type: "addAnchor"; anchor: Anchor }
  | { type: "removeAnchor"; input: string }
  | { type: "toggleRoutine"; routine: RoutineId }
  | { type: "setAtmosphere"; value: AtmosphereChoice }
  | { type: "setBudget"; value: BudgetChoice }
  | { type: "skip"; field: "routines" | "atmosphere" | "budget"; skipped: boolean }
  | { type: "loadSample" }
  | { type: "setSession"; session: PlanSession }
  | { type: "applyRevision"; session: PlanSession; itemId: string; message: string; limitation?: string }
  | { type: "undoRevision" }
  | { type: "toggleSaved"; itemId: string; saved: boolean }
  | { type: "setStage"; stage: FlowState["stage"] }
  | { type: "reset" };

const sameInput = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Inputs that feed a plan changed, so any built plan is stale. */
const invalidatePlan = (state: FlowState): FlowState => ({ ...state, session: null, previousSession: null, lastChange: null, stage: "week", reviewed: [] });

export function sampleAnchors(): Anchor[] {
  const tag = (key: keyof typeof CATEGORIES, input: string) =>
    anchorFromMatch(input, { kind: "tag", id: CATEGORIES[key].filterTagId, name: CATEGORIES[key].label, source: "curated" }, "resolved");
  return [
    tag("bookstore", "indie bookstores"),
    tag("korean_restaurant", "Korean food"),
    tag("cafe", "coffee shops"),
    anchorFromPreference("quiet mornings"),
  ];
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "hydrate": {
      const saved = action.state;
      // State saved before CR-007 has no `custom`; fill it in.
      return { ...(saved ? { ...saved, area: { ...saved.area, custom: saved.area.custom ?? null } } : state), hydrated: true };
    }
    case "setNeighborhood":
      return invalidatePlan({ ...state, area: { ...state.area, neighborhoodKey: action.key, custom: null, unsure: false } });
    case "setCustomArea":
      return invalidatePlan({ ...state, area: { ...state.area, neighborhoodKey: null, custom: action.area, unsure: false } });
    case "setUnsure":
      return invalidatePlan({ ...state, area: { neighborhoodKey: null, custom: null, unsure: true, scope: state.area.scope === "nearby" ? "city" : state.area.scope } });
    case "clearArea":
      return invalidatePlan({ ...state, area: { ...state.area, neighborhoodKey: null, custom: null, unsure: false } });
    case "setScope":
      return invalidatePlan({ ...state, area: { ...state.area, scope: action.scope } });
    case "addAnchor": {
      if (state.anchors.some((a) => sameInput(a.input, action.anchor.input)) || state.anchors.length >= MAX_ANCHORS) return state;
      return invalidatePlan({ ...state, anchors: [...state.anchors, action.anchor] });
    }
    case "removeAnchor":
      return invalidatePlan({ ...state, anchors: state.anchors.filter((a) => !sameInput(a.input, action.input)) });
    case "toggleRoutine": {
      const has = state.prefs.routines.includes(action.routine);
      const routines = has ? state.prefs.routines.filter((r) => r !== action.routine) : [...state.prefs.routines, action.routine];
      return invalidatePlan({ ...state, prefs: { ...state.prefs, routines, skipped: { ...state.prefs.skipped, routines: false } } });
    }
    case "setAtmosphere":
      return invalidatePlan({ ...state, prefs: { ...state.prefs, atmosphere: action.value, skipped: { ...state.prefs.skipped, atmosphere: false } } });
    case "setBudget":
      return invalidatePlan({ ...state, prefs: { ...state.prefs, budget: action.value, skipped: { ...state.prefs.skipped, budget: false } } });
    case "skip": {
      const prefs = { ...state.prefs, skipped: { ...state.prefs.skipped, [action.field]: action.skipped } };
      if (action.skipped) {
        if (action.field === "routines") prefs.routines = [];
        if (action.field === "atmosphere") prefs.atmosphere = null;
        if (action.field === "budget") prefs.budget = null;
      }
      return invalidatePlan({ ...state, prefs });
    }
    case "loadSample":
      return {
        ...initialState,
        hydrated: true,
        area: { neighborhoodKey: null, custom: null, unsure: true, scope: "city" },
        anchors: sampleAnchors(),
      };
    case "setSession":
      return { ...state, session: action.session, previousSession: null, lastChange: null, stage: "week", reviewed: [] };
    case "applyRevision":
      return {
        ...state,
        previousSession: state.session,
        session: action.session,
        lastChange: { itemId: action.itemId, message: action.message, ...(action.limitation ? { limitation: action.limitation } : {}) },
      };
    case "undoRevision":
      return state.previousSession ? { ...state, session: state.previousSession, previousSession: null, lastChange: null } : state;
    case "toggleSaved":
      return state.session ? { ...state, session: setSaved(state.session, action.itemId, action.saved), lastChange: null } : state;
    case "setStage":
      return {
        ...state,
        stage: action.stage,
        reviewed: state.reviewed.includes(state.stage) || state.stage === action.stage ? state.reviewed : [...state.reviewed, state.stage],
      };
    case "reset":
      return { ...initialState, hydrated: true };
  }
}

export const DEMO_STORY = DEMO_PERSONA.story;
