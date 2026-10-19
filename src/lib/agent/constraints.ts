import { CATEGORIES } from "@/domain/demo";
import type { PlaceCandidate, TasteInput } from "@/domain/types";
import { livelySignals } from "./atmosphere";

export interface HardConstraints {
  radiusMeters: number;
  maxPriceLevel?: number;
  excludedEntityIds: ReadonlySet<string>;
  strictQuiet: boolean;
}

export function constraintsFromInput(input: TasteInput, excludedEntityIds: Iterable<string>): HardConstraints {
  return {
    radiusMeters: input.radiusMeters,
    ...(input.maxPriceLevel !== undefined ? { maxPriceLevel: input.maxPriceLevel } : {}),
    excludedEntityIds: new Set(excludedEntityIds),
    strictQuiet: input.strictQuiet === true,
  };
}

export type IneligibleReason =
  | "excluded"
  | "distance_unknown"
  | "outside_radius"
  | "over_price_ceiling"
  | "price_unverifiable"
  | "loud_or_lively";

export interface EligibilityVerdict {
  eligible: boolean;
  reason?: IneligibleReason;
  /**
   * True when a price ceiling is active but Qloo has no price for this place.
   * Only cultural venues are kept in that case (CR-003); the UI must say so.
   */
  priceUnknown: boolean;
}

/**
 * Hard constraints, applied before any ranking:
 * exclusions, radius, price ceiling, strict quiet. Never relaxed silently.
 */
export function checkEligibility(candidate: PlaceCandidate, hard: HardConstraints): EligibilityVerdict {
  if (hard.excludedEntityIds.has(candidate.qlooEntityId)) {
    return { eligible: false, reason: "excluded", priceUnknown: false };
  }
  const distance = candidate.evidence.distanceMeters;
  if (distance === undefined) return { eligible: false, reason: "distance_unknown", priceUnknown: false };
  if (distance > hard.radiusMeters) return { eligible: false, reason: "outside_radius", priceUnknown: false };

  let priceUnknown = false;
  if (hard.maxPriceLevel !== undefined) {
    if (candidate.priceLevel !== undefined) {
      if (candidate.priceLevel > hard.maxPriceLevel) {
        return { eligible: false, reason: "over_price_ceiling", priceUnknown: false };
      }
    } else if (CATEGORIES[candidate.category].pricesAvailable) {
      // Qloo normally has a price for this category; without one the ceiling cannot be verified.
      return { eligible: false, reason: "price_unverifiable", priceUnknown: true };
    } else {
      priceUnknown = true; // cultural venue: kept, flagged
    }
  }
  if (hard.strictQuiet && livelySignals(candidate).length > 0) {
    return { eligible: false, reason: "loud_or_lively", priceUnknown };
  }
  return { eligible: true, priceUnknown };
}

/**
 * Plan items that no longer meet the CURRENT hard limits (radius, price
 * ceiling, strict quiet). Used after feedback tightens a limit: other items
 * stay put but are flagged, never presented as compliant.
 */
export function findOutOfLimit(
  items: { id: string; qlooEntityId: string }[],
  candidates: Record<string, PlaceCandidate>,
  input: TasteInput,
): string[] {
  const hard = constraintsFromInput(input, []);
  return items
    .filter((item) => {
      const candidate = candidates[item.qlooEntityId];
      return !candidate || !checkEligibility(candidate, hard).eligible;
    })
    .map((item) => item.id)
    .sort();
}
