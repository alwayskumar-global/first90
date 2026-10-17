import { categoryLabelFor } from "@/domain/cuisine";
import { CATEGORIES, CATEGORY_KEYS, DEMO_AREA, isInDemoBounds, isNeighborhoodKey, resolveCenter } from "@/domain/demo";
import {
  STAGE_KEYS,
  type CategoryCoverage,
  type Feedback,
  type PlaceCandidate,
  type Plan,
  type PlanItem,
  type PlanRevision,
  type PlanSession,
  type StageKey,
  type TasteInput,
} from "@/domain/types";
import type { QlooClient } from "@/lib/qloo/client";
import { resolveInterests } from "@/lib/qloo/resolveInterests";
import { mentionsIndependent } from "./preferences";
import { explainCandidate, type WordingAdapter } from "./explain";
import { loadPool, makeScoringContext, selectEligible, summarizeResolution } from "./pipeline";
import { constructStages } from "./planner";
import { itemId, reviseWithPool } from "./revise";
import { createTraceRecorder, type StepTrace } from "./trace";

export class WorkflowError extends Error {
  readonly kind: "invalid_input" | "all_failed";
  readonly retryable: boolean;
  constructor(kind: WorkflowError["kind"], message: string, retryable = false) {
    super(message);
    this.name = "WorkflowError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

export interface WorkflowDeps {
  client: QlooClient;
  now?: () => number;
  /** Optional LLM wording; off by default. Output is validated against the facts. */
  wording?: WordingAdapter;
  /** Called as each workflow step completes (used to stream progress to the UI). */
  onStep?: (step: StepTrace) => void;
}

export function validateTasteInput(input: TasteInput): void {
  const bad = (message: string): never => {
    throw new WorkflowError("invalid_input", message);
  };
  if (input.areaKey !== DEMO_AREA.key) bad(`Only ${DEMO_AREA.label} is supported.`);
  if (input.neighborhoodKey !== undefined && !isNeighborhoodKey(input.neighborhoodKey)) bad("Unknown neighborhood.");
  if (input.customArea !== undefined) {
    if (input.neighborhoodKey !== undefined) bad("Choose a neighborhood or a searched place, not both.");
    if (!isInDemoBounds(input.customArea.lat, input.customArea.lon)) bad("That place is outside the Raleigh demo area.");
  }
  const interests = input.interests.map((value) => value.trim()).filter(Boolean);
  if (interests.length < 1 || interests.length > 5) bad("Provide between 1 and 5 interests.");
  if (input.categories.length < 1 || input.categories.some((key) => !CATEGORY_KEYS.includes(key))) {
    bad("Choose at least one supported category.");
  }
  if (!(input.radiusMeters >= 1_000 && input.radiusMeters <= DEMO_AREA.maxRadiusMeters)) {
    bad(`Distance limit must be between 1 and ${DEMO_AREA.maxRadiusMeters / 1000} km.`);
  }
}

export interface BuildResult {
  session: PlanSession;
  trace: StepTrace[];
}

export async function buildPlan(deps: WorkflowDeps, rawInput: TasteInput): Promise<BuildResult> {
  validateTasteInput(rawInput);
  const { client, wording } = deps;
  const trace = createTraceRecorder(deps.now, deps.onStep);
  const base: TasteInput = { ...rawInput, interests: rawInput.interests.map((value) => value.trim()).filter(Boolean) };

  // 1. resolve interests
  const { resolved, summary } = await trace.step(
    "resolve_interests",
    async () => {
      const resolved = await resolveInterests(client, base.interests, base.confirmations);
      return { resolved, summary: summarizeResolution(base, resolved) };
    },
    ({ resolved: items, summary: s }) => ({
      status: s.needsConfirmation.length > 0 || items.some((i) => i.status === "unmatched") ? "partial" : "done",
      summary: `${items.filter((i) => i.status === "resolved").length} interest(s) matched, ${
        items.filter((i) => i.status === "preference").length
      } applied as preferences`,
      counts: {
        matched: items.filter((i) => i.status === "resolved").length,
        preferences: items.filter((i) => i.status === "preference").length,
        needConfirmation: s.needsConfirmation.length,
        unmatched: items.filter((i) => i.status === "unmatched").length,
      },
      notes: s.notes,
    }),
  );
  const input = summary.input;

  // 2. query Qloo for eligible places
  const queryMaxPriceLevel = input.maxPriceLevel;
  const pool = await trace.step(
    "discover_places",
    () =>
      loadPool(client, {
        categories: input.categories,
        signals: summary.signals,
        center: resolveCenter(input.neighborhoodKey, input.customArea).center,
        queryRadiusMeters: input.radiusMeters,
        ...(queryMaxPriceLevel !== undefined ? { queryMaxPriceLevel } : {}),
        ...(input.cuisineTagId ? { cuisineTagId: input.cuisineTagId } : {}),
      }),
    (result) => ({
      status: result.failedCategories.length > 0 ? "partial" : "done",
      summary: `Found ${result.candidates.length} places across ${input.categories.length} categories`,
      counts: { ...result.perCategory },
      notes: result.warnings,
    }),
  );
  if (pool.failedCategories.length === input.categories.length) {
    throw new WorkflowError("all_failed", "Qloo could not be reached for any category. Try again.", true);
  }

  // 3. noise filter + hard constraints
  const selection = await trace.step(
    "apply_constraints",
    () => selectEligible(pool.candidates, input, []),
    (result) => ({
      status: "done",
      summary: `${result.eligible.length} places meet your limits`,
      counts: {
        eligible: result.eligible.length,
        offCategoryRemoved: result.dropped.offCategory,
        outsideRadius: result.dropped.byReason.outside_radius ?? 0,
        overPrice: (result.dropped.byReason.over_price_ceiling ?? 0) + (result.dropped.byReason.price_unverifiable ?? 0),
        priceUnknownKept: result.priceUnknownCount,
      },
    }),
  );

  // 4. construct the three stages
  const ctx = makeScoringContext(input, selection.eligible, summary.interestCategories);
  const picks = await trace.step(
    "construct_plan",
    () => constructStages(selection.eligible, ctx),
    (stages) => ({
      status: STAGE_KEYS.some((key) => stages[key].length > 0) ? "done" : "partial",
      summary: `Placed ${STAGE_KEYS.reduce((n, key) => n + stages[key].length, 0)} suggestions across three stages`,
      counts: Object.fromEntries(STAGE_KEYS.map((key) => [key, stages[key].length])),
    }),
  );

  // 5. explain each pick from its Qloo fields
  const explainCtx = { input, signals: summary.signals, preferIndependent: mentionsIndependent(input.interests) };
  const stages = await trace.step(
    "explain",
    async () => {
      const out: Record<StageKey, PlanItem[]> = { first_week: [], first_month: [], months_2_3: [] };
      for (const stage of STAGE_KEYS) {
        for (const pick of picks[stage]) {
          const explained = await explainCandidate(pick.candidate, stage, explainCtx, wording);
          out[stage].push({
            id: itemId(pick.candidate.qlooEntityId),
            stage,
            qlooEntityId: pick.candidate.qlooEntityId,
            ...explained,
            status: "suggested",
          });
        }
      }
      return out;
    },
    (out) => ({
      status: "done",
      summary: `Explained ${STAGE_KEYS.reduce((n, key) => n + out[key].length, 0)} suggestions from Qloo's data`,
    }),
  );

  const candidates: Record<string, PlaceCandidate> = {};
  for (const stage of STAGE_KEYS) for (const pick of picks[stage]) candidates[pick.candidate.qlooEntityId] = pick.candidate;

  const coverage: CategoryCoverage[] = input.categories.map((category) => ({
    category,
    loaded: !pool.failedCategories.includes(category),
    eligible: selection.byCategory[category].eligible,
    inPlan: STAGE_KEYS.reduce((n, key) => n + stages[key].filter((item) => item.category === category).length, 0),
  }));

  const plan: Plan = {
    input,
    queryRadiusMeters: input.radiusMeters,
    ...(queryMaxPriceLevel !== undefined ? { queryMaxPriceLevel } : {}),
    stages,
    dismissedEntityIds: [],
    constraints: [],
  };
  const notes = [...summary.notes];
  if (pool.failedCategories.length > 0) {
    notes.push(`Could not load: ${pool.failedCategories.map((key) => categoryLabelFor(key, input.cuisineTagId)).join(", ")}. Retry for a fuller plan.`);
  }
  for (const key of input.categories) {
    const stats = selection.byCategory[key];
    if (stats.eligible > 0 || pool.failedCategories.includes(key)) continue;
    const reasons: string[] = [];
    if (stats.inPool === 0 && queryMaxPriceLevel !== undefined && CATEGORIES[key].pricesAvailable) {
      reasons.push(
        `Qloo returned none at or below ${"$".repeat(queryMaxPriceLevel)}; places without a listed price can't be matched to a price ceiling`,
      );
    }
    if (stats.priceUnverified > 0) reasons.push(`Qloo has no price for ${stats.priceUnverified}, so the price ceiling can't be verified`);
    if (stats.overPrice > 0) reasons.push(`${stats.overPrice} exceed the price ceiling`);
    if (stats.outsideRadius > 0) reasons.push(`${stats.outsideRadius} are outside the distance limit`);
    if (stats.offCategory > 0) reasons.push(`${stats.offCategory} were not really ${categoryLabelFor(key, input.cuisineTagId).toLowerCase()}`);
    notes.push(
      `No verified ${categoryLabelFor(key, input.cuisineTagId).toLowerCase()} met your limits${reasons.length ? ` (${reasons.join("; ")})` : ""}.`,
    );
  }
  if (STAGE_KEYS.every((key) => stages[key].length === 0)) {
    notes.push("No verified places matched your limits. Try a wider distance or a higher price ceiling.");
  }

  return {
    session: {
      plan,
      candidates,
      interests: resolved,
      signals: summary.signals,
      outOfLimitItemIds: [],
      coverage,
      needsConfirmation: summary.needsConfirmation,
      notes,
    },
    trace: trace.steps(),
  };
}

export interface ReviseResult extends BuildResult {
  revision: PlanRevision;
}

/**
 * Apply feedback to a session. Qloo is queried only when needed: saving needs
 * no data; replacing reuses the same queries as the original build (cached),
 * and only re-queries with a tighter server-side price filter if the cached
 * pool has no alternate under the new ceiling.
 */
export async function revisePlan(deps: WorkflowDeps, session: PlanSession, feedback: Feedback): Promise<ReviseResult> {
  const trace = createTraceRecorder(deps.now, deps.onStep);
  const { client, wording } = deps;
  const { plan } = session;

  const outcome = await trace.step(
    "revise",
    async () => {
      if (feedback.action === "save") return reviseWithPool({ session, feedback, pool: [], wording });
      const center = resolveCenter(plan.input.neighborhoodKey, plan.input.customArea).center;
      const pool = await loadPool(client, {
        categories: plan.input.categories,
        signals: session.signals,
        center,
        queryRadiusMeters: plan.queryRadiusMeters,
        ...(plan.queryMaxPriceLevel !== undefined ? { queryMaxPriceLevel: plan.queryMaxPriceLevel } : {}),
        ...(plan.input.cuisineTagId ? { cuisineTagId: plan.input.cuisineTagId } : {}),
      });
      let result = await reviseWithPool({ session, feedback, pool: pool.candidates, wording });

      const ceiling = result.session.plan.input.maxPriceLevel;
      if (result.revision.noMatch && result.revision.appliedConstraint?.kind === "max_price" && ceiling !== undefined) {
        const tighter = await loadPool(client, {
          categories: plan.input.categories,
          signals: session.signals,
          center,
          queryRadiusMeters: plan.queryRadiusMeters,
          queryMaxPriceLevel: ceiling,
          ...(plan.input.cuisineTagId ? { cuisineTagId: plan.input.cuisineTagId } : {}),
        });
        const known = new Set(pool.candidates.map((c) => c.qlooEntityId));
        const merged = [...pool.candidates, ...tighter.candidates.filter((c) => !known.has(c.qlooEntityId))];
        result = await reviseWithPool({ session, feedback, pool: merged, wording });
      }
      return result;
    },
    (result) => ({
      status: result.revision.noMatch ? "partial" : "done",
      summary: result.revision.noMatch
        ? "No verified alternate met your limits"
        : feedback.action === "replace"
          ? "Replaced one suggestion; everything else stayed put"
          : feedback.action === "dismiss"
            ? "Removed one suggestion"
            : "Saved one suggestion",
      ...(result.revision.appliedConstraint ? { notes: [result.revision.appliedConstraint.label] } : {}),
    }),
  );

  return { session: outcome.session, revision: outcome.revision, trace: trace.steps() };
}
