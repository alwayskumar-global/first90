import { STAGE_KEYS, type PlanSession } from "./types";

/**
 * Mark an item saved or not. Pure and client-safe: saving needs no Qloo data and
 * never touches any other item (revision behavior).
 */
export function setSaved(session: PlanSession, itemId: string, saved: boolean): PlanSession {
  const plan = structuredClone(session.plan);
  for (const stage of STAGE_KEYS) {
    const item = plan.stages[stage].find((entry) => entry.id === itemId);
    if (item) item.status = saved ? "saved" : "suggested";
  }
  return { ...session, plan };
}

export function allItems(session: PlanSession) {
  return STAGE_KEYS.flatMap((stage) => session.plan.stages[stage]);
}

export function findItem(session: PlanSession, itemId: string) {
  return allItems(session).find((item) => item.id === itemId);
}
