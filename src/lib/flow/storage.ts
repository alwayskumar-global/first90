import type { FlowState } from "./types";

/**
 * Parse the saved setup state (localStorage). State saved before CR-009 names a "korean_restaurant" category:
 * keep the answers under the new name and drop the saved plan, which was signed with the old one.
 */
export function parseSavedState(raw: string | null): FlowState | null {
  if (!raw) return null;
  try {
    const legacy = raw.includes("korean_restaurant");
    const parsed = JSON.parse(legacy ? raw.replaceAll("korean_restaurant", "restaurant") : raw) as FlowState;
    if (!parsed || typeof parsed !== "object" || !parsed.area || !parsed.prefs) return null;
    if (legacy) Object.assign(parsed, { session: null, previousSession: null, lastChange: null, stage: "week", reviewed: [] });
    return { ...parsed, hydrated: true };
  } catch {
    return null; // corrupt: start fresh
  }
}
