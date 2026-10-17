import { CATEGORIES, type CategoryKey } from "@/domain/demo";
import type { PlaceCandidate } from "@/domain/types";
import type { QlooClient } from "./client";
import { normalizePlace } from "./normalizePlace";
import { wktPoint } from "./validate";

export interface DiscoverPlacesArgs {
  category: CategoryKey;
  /** Overrides the category's default Qloo filter tag (CR-009: the user's cuisine for restaurants). */
  filterTagId?: string;
  center: { lat: number; lon: number };
  radiusMeters: number;
  signalEntityIds?: string[];
  signalTagIds?: string[];
  maxPriceLevel?: number;
  excludeEntityIds?: string[];
  take?: number;
  /** Ask Qloo for per-signal attribution. Only meaningful with entity signals. */
  explain?: boolean;
}

export interface DiscoverPlacesResult {
  candidates: PlaceCandidate[];
  /** Records dropped for missing required fields or duplicate ids. */
  dropped: { malformed: number; duplicate: number };
  warnings: string[];
}

export async function discoverPlaces(
  client: QlooClient,
  args: DiscoverPlacesArgs,
): Promise<DiscoverPlacesResult> {
  const filterTagId = args.filterTagId ?? CATEGORIES[args.category].filterTagId;
  const signalEntityIds = args.signalEntityIds ?? [];
  const signalTagIds = args.signalTagIds ?? [];
  const excluded = args.excludeEntityIds ?? [];

  const raw = await client.placeInsights({
    "filter.type": "urn:entity:place",
    "filter.location": wktPoint(args.center),
    "filter.location.radius": Math.round(args.radiusMeters),
    "filter.tags": filterTagId,
    "signal.interests.entities": signalEntityIds.join(",") || undefined,
    "signal.interests.tags": signalTagIds.join(",") || undefined,
    "filter.price_level.max": args.maxPriceLevel,
    "filter.exclude.entities": excluded.join(",") || undefined,
    "feature.explainability": args.explain && signalEntityIds.length > 0 ? true : undefined,
    take: args.take ?? 20,
  });

  const candidates: PlaceCandidate[] = [];
  const seen = new Set<string>();
  const excludedSet = new Set(excluded);
  const dropped = { malformed: 0, duplicate: 0 };
  const warnings: string[] = [];

  for (const record of raw) {
    const candidate = normalizePlace(record, {
      category: args.category,
      signalEntityIds,
      signalTagIds,
      filterTagIds: [filterTagId],
    });
    if (!candidate) {
      dropped.malformed++;
      continue;
    }
    if (seen.has(candidate.qlooEntityId)) {
      dropped.duplicate++;
      continue;
    }
    seen.add(candidate.qlooEntityId);
    // Defense in depth: never surface an entity the caller excluded, even if Qloo ignored the filter.
    if (excludedSet.has(candidate.qlooEntityId)) continue;
    candidates.push(candidate);
  }

  if (args.explain && signalEntityIds.length > 0 && candidates.length > 0) {
    if (candidates.every((c) => !c.evidence.explainability)) {
      warnings.push("Explainability was requested but Qloo returned none; explanations must say so.");
    }
  }
  if (args.maxPriceLevel !== undefined && candidates.some((c) => c.priceLevel === undefined)) {
    warnings.push("Some places have no price level, so the price limit could not be checked for them.");
  }
  if (dropped.malformed > 0) warnings.push(`${dropped.malformed} malformed Qloo record(s) were skipped.`);

  return { candidates, dropped, warnings };
}
