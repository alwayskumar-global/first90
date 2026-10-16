/**
 * Domain contracts (PROJECT_PLAN.md section 6). Milestone 1 implements the
 * input/candidate side (TasteInput, ResolvedInterest, PlaceCandidate, Evidence).
 * Plan, PlanItem, Feedback and PlanRevision are declared here so the Milestone 2
 * planner builds against reviewed interfaces; nothing constructs them yet.
 *
 * Truth rules baked into the shapes:
 *  - A PlaceCandidate only ever holds fields Qloo returned. Absent data is
 *    `undefined`, never a guess.
 *  - `affinity` is a Qloo ranking signal, not a probability of enjoyment.
 *  - A PlanItem references a candidate by `qlooEntityId`; it carries no place
 *    facts of its own.
 */

import type { CategoryKey } from "./demo";

// ---------------------------------------------------------------- inputs

export type Atmosphere = "quiet" | "lively" | "no_preference";

export interface TasteInput {
  /** Free-text interests as the user typed them (3-5 in the product). */
  interests: string[];
  /** Destination key; Milestone 1 supports only the locked demo area. */
  areaKey: string;
  /** Search radius in meters. Always explicit: Qloo returns nothing without it. */
  radiusMeters: number;
  categories: CategoryKey[];
  /** Maximum Qloo price level (1-4). Applies only to places that return one. */
  maxPriceLevel?: 1 | 2 | 3 | 4;
  atmosphere: Atmosphere;
}

export type QlooSignalKind = "entity" | "tag";

/** One concrete Qloo candidate an interest could resolve to. */
export interface InterestMatch {
  kind: QlooSignalKind;
  /** Qloo entity UUID, or tag URN (e.g. urn:tag:category:place:cafe). */
  id: string;
  name: string;
  /** Qloo tag namespace or entity subtype, to help disambiguation in the UI. */
  type?: string;
  /** "curated" = built-in alias for a locked demo category; "qloo" = live lookup. */
  source: "curated" | "qloo";
}

export type ResolvedInterest =
  | { status: "resolved"; input: string; match: InterestMatch }
  | { status: "ambiguous"; input: string; matches: InterestMatch[] }
  | { status: "unmatched"; input: string };

// ------------------------------------------------------------ candidates

export interface PlaceLocation {
  lat: number;
  lon: number;
  geohash?: string;
}

/** What a Qloo result says about why it appeared. Never fabricated. */
export interface Evidence {
  /** The exact signal IDs sent to Qloo for this query (may be empty). */
  signalEntityIds: string[];
  signalTagIds: string[];
  /** Filter tag(s) the query used, e.g. the category tag. */
  filterTagIds: string[];
  /** Qloo `query.affinity` as returned; a ranking signal only. */
  affinity?: number;
  /** Meters from the query point, as returned by Qloo. */
  distanceMeters?: number;
  /**
   * Per-signal-entity contribution to this result's ranking, as returned by
   * `feature.explainability`. Input attribution only, not reasons.
   */
  explainability?: { entityId: string; score: number }[];
  /** Tag names Qloo attached to the entity (verbatim). */
  tagNames: string[];
}

export interface PlaceCandidate {
  /** Stable key: the Qloo entity ID. */
  qlooEntityId: string;
  name: string;
  category: CategoryKey;
  location: PlaceLocation;
  address?: string;
  neighborhood?: string;
  /** Qloo `properties.description` / short_description, verbatim. */
  description?: string;
  ambienceDescription?: string;
  /** 1-4 when Qloo returns one; museums commonly have none. */
  priceLevel?: number;
  /** Qloo `properties.business_rating`, verbatim, unit not asserted. */
  businessRating?: number;
  website?: string;
  phone?: string;
  /** Returned hours blob is not parsed or shown; "check current hours". */
  hasHoursData: boolean;
  popularity?: number;
  evidence: Evidence;
}

// ------------------------------------------------- Milestone 2 contracts

export type StageKey = "first_week" | "first_month" | "months_2_3";

export interface PlanItem {
  id: string;
  stage: StageKey;
  /** References a PlaceCandidate; no place facts are copied. */
  qlooEntityId: string;
  /** Wording generated only from the candidate's Evidence and TasteInput. */
  why: string;
  status: "suggested" | "saved";
}

export interface Plan {
  input: TasteInput;
  stages: Record<StageKey, PlanItem[]>;
  /** IDs dismissed this session; never re-suggested. */
  dismissedEntityIds: string[];
}

export type FeedbackReason =
  | "too_far"
  | "too_expensive"
  | "too_loud"
  | "not_interested"
  | "other";

export interface Feedback {
  itemId: string;
  action: "save" | "dismiss" | "replace";
  reason?: FeedbackReason;
}

export interface PlanRevision {
  before: Plan;
  after: Plan;
  /** Explicit constraint derived from the reason, if any. */
  appliedConstraint?: string;
  /** Honest note when the data could not honor the reason. */
  limitation?: string;
}
