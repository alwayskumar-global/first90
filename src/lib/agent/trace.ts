export type StepId =
  | "resolve_interests"
  | "discover_places"
  | "apply_constraints"
  | "construct_plan"
  | "explain"
  | "revise";

export type StepStatus = "done" | "partial" | "failed" | "skipped";

/** One observable workflow step. Safe to show: no raw payloads, IDs or keys. */
export interface StepTrace {
  id: StepId;
  /** Fixed progress copy for the Building state. */
  label: string;
  status: StepStatus;
  /** One factual sentence about what happened, e.g. "Found 30 cafés". */
  summary: string;
  counts?: Record<string, number>;
  notes?: string[];
  durationMs: number;
}

export const STEP_LABELS: Record<StepId, string> = {
  resolve_interests: "Understanding your interests",
  discover_places: "Finding places in Raleigh",
  apply_constraints: "Applying your limits",
  construct_plan: "Building your three stages",
  explain: "Writing why each place fits",
  revise: "Revising after your feedback",
};

export interface TraceRecorder {
  /** Runs `fn`, records a step with the result of `describe`, and returns `fn`'s value. */
  step<T>(
    id: StepId,
    fn: () => Promise<T> | T,
    describe: (value: T) => Pick<StepTrace, "status" | "summary"> & Partial<Pick<StepTrace, "counts" | "notes">>,
  ): Promise<T>;
  /** Record a step that failed before producing a value. */
  fail(id: StepId, summary: string, startedAt: number): void;
  steps(): StepTrace[];
}

export function createTraceRecorder(now: () => number = Date.now): TraceRecorder {
  const recorded: StepTrace[] = [];
  return {
    async step(id, fn, describe) {
      const startedAt = now();
      const value = await fn();
      const info = describe(value);
      recorded.push({ id, label: STEP_LABELS[id], durationMs: Math.max(0, now() - startedAt), ...info });
      return value;
    },
    fail(id, summary, startedAt) {
      recorded.push({ id, label: STEP_LABELS[id], status: "failed", summary, durationMs: Math.max(0, now() - startedAt) });
    },
    steps: () => [...recorded],
  };
}
