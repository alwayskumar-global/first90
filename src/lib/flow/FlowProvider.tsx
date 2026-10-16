"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { flowReducer, initialState, type FlowAction } from "./state";
import type { FlowState } from "./types";

const STORAGE_KEY = "f90.flow.v1";

interface FlowContextValue {
  state: FlowState;
  dispatch: Dispatch<FlowAction>;
}

const FlowContext = createContext<FlowContextValue | null>(null);

function load(): FlowState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FlowState;
    return parsed && typeof parsed === "object" && parsed.area && parsed.prefs ? { ...parsed, hydrated: true } : null;
  } catch {
    return null; // storage can be blocked or corrupt: start fresh
  }
}

/** Account-free session state. Saved in this browser only, so a refresh keeps the user's answers and plan. */
export function FlowProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(flowReducer, initialState);

  useEffect(() => {
    dispatch({ type: "hydrate", state: load() });
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota or blocked storage: the flow still works in memory */
    }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowContextValue {
  const context = useContext(FlowContext);
  if (!context) throw new Error("useFlow must be used inside FlowProvider");
  return context;
}
