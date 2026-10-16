import { CATEGORIES, CATEGORY_KEYS, POOL_SIZE_PER_CATEGORY, DEMO_AREA, type CategoryKey } from "@/domain/demo";
import type {
  InterestMatch,
  PlaceCandidate,
  ResolvedInterest,
  SignalSummary,
  TasteInput,
} from "@/domain/types";
import type { QlooClient } from "@/lib/qloo/client";
import { discoverPlaces } from "@/lib/qloo/discoverPlaces";
import { QlooError } from "@/lib/qloo/errors";
import { checkEligibility, constraintsFromInput, type IneligibleReason } from "./constraints";
import { mentionsIndependent } from "./preferences";
import { assessRelevance } from "./relevance";
import { buildAffinityRanges, type ScoringContext } from "./scoring";

export interface ResolutionSummary {
  /** Input with preferences found among the interests ("quiet mornings") applied. */
  input: TasteInput;
  signals: SignalSummary[];
  interestCategories: Set<CategoryKey>;
  needsConfirmation: { input: string; matches: InterestMatch[] }[];
  notes: string[];
}

/** Turn resolved interests into Qloo signals, preferences and user-facing notes. */
export function summarizeResolution(input: TasteInput, resolved: ResolvedInterest[]): ResolutionSummary {
  const signals: SignalSummary[] = [];
  const interestCategories = new Set<CategoryKey>();
  const needsConfirmation: ResolutionSummary["needsConfirmation"] = [];
  const notes: string[] = [];
  let atmosphere = input.atmosphere;
  let preferMornings = input.preferMornings;

  for (const interest of resolved) {
    switch (interest.status) {
      case "resolved": {
        if (!signals.some((signal) => signal.id === interest.match.id)) {
          signals.push({ id: interest.match.id, kind: interest.match.kind, label: interest.input });
        }
        for (const key of CATEGORY_KEYS) {
          if (CATEGORIES[key].filterTagId === interest.match.id) interestCategories.add(key);
        }
        break;
      }
      case "preference": {
        const parts: string[] = [];
        if (interest.preference.atmosphere && atmosphere === "no_preference") {
          atmosphere = interest.preference.atmosphere;
          parts.push(`${interest.preference.atmosphere} atmosphere`);
        }
        if (interest.preference.morning && !preferMornings) {
          preferMornings = true;
          parts.push("morning routine");
        }
        notes.push(`“${interest.input}” was applied as a preference${parts.length ? ` (${parts.join(", ")})` : ""}, not searched in Qloo.`);
        break;
      }
      case "ambiguous":
        needsConfirmation.push({ input: interest.input, matches: interest.matches });
        notes.push(`“${interest.input}” matches several things in Qloo. Pick one to use it.`);
        break;
      case "unmatched":
        notes.push(`“${interest.input}” matched nothing in Qloo and was not used.`);
        break;
    }
  }
  return {
    input: { ...input, atmosphere, preferMornings },
    signals,
    interestCategories,
    needsConfirmation,
    notes,
  };
}

const POOL_CONCURRENCY = 2;

export interface PoolResult {
  candidates: PlaceCandidate[];
  perCategory: Record<CategoryKey, number>;
  failedCategories: CategoryKey[];
  warnings: string[];
}

/**
 * Query Qloo once per category: the category tag is the filter; the user's
 * other picks are the taste signals (the category's own tag is left out).
 * A rate limit stops everything; any other failure is reported per category.
 */
export async function loadPool(
  client: QlooClient,
  args: {
    categories: CategoryKey[];
    signals: SignalSummary[];
    queryRadiusMeters: number;
    queryMaxPriceLevel?: number;
  },
): Promise<PoolResult> {
  const queryCategory = async (category: CategoryKey) => {
      const definition = CATEGORIES[category];
      try {
        const result = await discoverPlaces(client, {
          category,
          center: DEMO_AREA.center,
          radiusMeters: args.queryRadiusMeters,
          signalEntityIds: args.signals.filter((s) => s.kind === "entity").map((s) => s.id),
          signalTagIds: args.signals.filter((s) => s.kind === "tag" && s.id !== definition.filterTagId).map((s) => s.id),
          ...(args.queryMaxPriceLevel !== undefined && definition.pricesAvailable
            ? { maxPriceLevel: args.queryMaxPriceLevel }
            : {}),
          take: POOL_SIZE_PER_CATEGORY,
          explain: true,
        });
        return { ok: true, category, result } as const;
      } catch (error) {
        if (error instanceof QlooError) return { ok: false, category, error } as const;
        throw error;
      }
  };

  // At most two requests in flight: a four-way burst tripped Qloo's rate limit on the hackathon key.
  const outcomes: Awaited<ReturnType<typeof queryCategory>>[] = [];
  for (let i = 0; i < args.categories.length; i += POOL_CONCURRENCY) {
    const batch = args.categories.slice(i, i + POOL_CONCURRENCY);
    outcomes.push(...(await Promise.all(batch.map(queryCategory))));
    if (outcomes.some((o) => !o.ok && o.error.kind === "rate_limit")) break; // stop at the first 429
  }

  for (const outcome of outcomes) {
    if (!outcome.ok && outcome.error.kind === "rate_limit") throw outcome.error;
  }

  const candidates: PlaceCandidate[] = [];
  const perCategory = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0])) as Record<CategoryKey, number>;
  const failedCategories: CategoryKey[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failedCategories.push(outcome.category);
      warnings.push(`${CATEGORIES[outcome.category].label} could not be loaded (${outcome.error.kind}).`);
      continue;
    }
    perCategory[outcome.category] = outcome.result.candidates.length;
    warnings.push(...outcome.result.warnings);
    for (const candidate of outcome.result.candidates) {
      if (seen.has(candidate.qlooEntityId)) continue; // same place returned under two categories: first wins
      seen.add(candidate.qlooEntityId);
      candidates.push(candidate);
    }
  }
  return { candidates, perCategory, failedCategories, warnings };
}

export interface CategoryEligibility {
  inPool: number;
  eligible: number;
  offCategory: number;
  outsideRadius: number;
  priceUnverified: number;
  overPrice: number;
}

export interface EligibleResult {
  eligible: PlaceCandidate[];
  byCategory: Record<CategoryKey, CategoryEligibility>;
  dropped: { offCategory: number; byReason: Partial<Record<IneligibleReason, number>> };
  /** Eligible places with no Qloo price while a price ceiling is active. */
  priceUnknownCount: number;
}

/** Noise filter first (category relevance), then hard constraints. */
export function selectEligible(pool: PlaceCandidate[], input: TasteInput, excludedEntityIds: Iterable<string>): EligibleResult {
  const hard = constraintsFromInput(input, excludedEntityIds);
  const byReason: Partial<Record<IneligibleReason, number>> = {};
  const eligible: PlaceCandidate[] = [];
  const byCategory = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, { inPool: 0, eligible: 0, offCategory: 0, outsideRadius: 0, priceUnverified: 0, overPrice: 0 }]),
  ) as Record<CategoryKey, CategoryEligibility>;
  let offCategory = 0;
  let priceUnknownCount = 0;
  for (const candidate of pool) {
    const stats = byCategory[candidate.category];
    stats.inPool++;
    if (!assessRelevance(candidate).keep) {
      offCategory++;
      stats.offCategory++;
      continue;
    }
    const verdict = checkEligibility(candidate, hard);
    if (!verdict.eligible) {
      byReason[verdict.reason!] = (byReason[verdict.reason!] ?? 0) + 1;
      if (verdict.reason === "outside_radius") stats.outsideRadius++;
      if (verdict.reason === "price_unverifiable") stats.priceUnverified++;
      if (verdict.reason === "over_price_ceiling") stats.overPrice++;
      continue;
    }
    if (verdict.priceUnknown) priceUnknownCount++;
    stats.eligible++;
    eligible.push(candidate);
  }
  return { eligible, byCategory, dropped: { offCategory, byReason }, priceUnknownCount };
}

export function makeScoringContext(
  input: TasteInput,
  eligible: PlaceCandidate[],
  interestCategories: ReadonlySet<CategoryKey>,
  categoryAdjust: ReadonlyMap<CategoryKey, number> = new Map(),
): ScoringContext {
  return {
    input,
    interestCategories,
    preferIndependent: mentionsIndependent(input.interests),
    categoryAdjust,
    affinityRanges: buildAffinityRanges(eligible),
  };
}
