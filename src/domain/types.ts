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
  /** Free-text interests as the user typed them (1-5; the product UI asks for 3-5). */
  interests: string[];
  /**
   * User choices for ambiguous interests: interest text -> chosen Qloo id
   * (a tag URN or entity UUID from that interest's `matches`).
   */
  confirmations?: Record<string, string>;
  /** Destination key; the product supports only the locked demo area. */
  areaKey: string;
  /** Hard distance limit in meters. Always explicit: Qloo returns nothing without it. */
  radiusMeters: number;
  categories: CategoryKey[];
  /** Hard price ceiling (Qloo price level 1-4). Applies only to categories that carry prices. */
  maxPriceLevel?: 1 | 2 | 3 | 4;
  atmosphere: Atmosphere;
  /** Prefer places Qloo lists as a good fit for mornings. */
  preferMornings: boolean;
  /** Hard rule (set by "too loud" feedback): exclude places with loud/lively signals. */
  strictQuiet?: boolean;
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

/** An interest that is an atmosphere/routine preference rather than a Qloo signal. */
export interface InterestPreference {
  atmosphere?: "quiet" | "lively";
  morning?: boolean;
}

export type ResolvedInterest =
  | { status: "resolved"; input: string; match: InterestMatch }
  | { status: "preference"; input: string; preference: InterestPreference }
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
  /** Display-worthy tag names (ambience, noise, time of day, genre), verbatim. */
  tagNames: string[];
}

/** Structured vocabulary Qloo attaches to places; every value is verbatim from a result. */
export interface PlaceAtmosphere {
  ambience: string[];
  /** e.g. "Quiet", "Moderate", "Loud". */
  noiseLevel?: string;
  /** e.g. "Morning", "Afternoon". */
  timeOfDay: string[];
  visitIntent: string[];
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
  /** Qloo's primary genre name for the place (e.g. "Coffee shop"), verbatim. */
  primaryGenre?: string;
  /** Genre/category tag names Qloo attached, verbatim. */
  genreTags: string[];
  atmosphere: PlaceAtmosphere;
  /** Returned hours blob is not parsed or shown; "check current hours". */
  hasHoursData: boolean;
  popularity?: number;
  evidence: Evidence;
}

// ------------------------------------------------- Milestone 2 contracts

export type StageKey = "first_week" | "first_month" | "months_2_3";
export const STAGE_KEYS: StageKey[] = ["first_week", "first_month", "months_2_3"];

/**
 * How much of an explanation Qloo's response supports:
 *  - input_attribution: Qloo returned per-pick contribution (entity signals).
 *  - taste_signals: Qloo ranked with the user's tag picks but returned no attribution.
 *  - category_and_distance: no taste ranking; matched by category and distance only.
 */
export type ExplanationBasis = "input_attribution" | "taste_signals" | "category_and_distance";

export interface PlanItem {
  /** `item:<qlooEntityId>`; stable for the life of the item. */
  id: string;
  stage: StageKey;
  /** References a PlaceCandidate; no place facts are copied here except the category. */
  qlooEntityId: string;
  category: CategoryKey;
  /** Suggested routine, phrased as an idea, never a scheduled event. */
  routine: string;
  /** One concise sentence or two built only from Qloo fields and the user's input. */
  why: string;
  basis: ExplanationBasis;
  /** Verbatim Qloo tags that support the user's stated preferences (may be empty). */
  highlights: string[];
  /** Unverified-details and data-gap notices to show with the card. */
  notices: string[];
  /** Present only when Qloo returned a valid http(s) website. */
  externalUrl?: string;
  status: "suggested" | "saved";
}

export type ConstraintKind = "max_price" | "radius" | "strict_quiet" | "exclude_entity" | "category_penalty";

export interface AppliedConstraint {
  kind: ConstraintKind;
  /** Human-readable, e.g. "Price ceiling lowered to $$". */
  label: string;
  reason: FeedbackReason | "user_setting";
  /** Item whose feedback produced the constraint, if any. */
  sourceItemId?: string;
  /** Category the constraint applies to (category_penalty only). */
  category?: CategoryKey;
}

export interface Plan {
  /** Effective input, including any constraints tightened by feedback. */
  input: TasteInput;
  /** Radius used for the Qloo queries; local radius tightening never changes it. */
  queryRadiusMeters: number;
  /** Price ceiling sent to Qloo with the queries (so revisions can reuse the same request). */
  queryMaxPriceLevel?: number;
  stages: Record<StageKey, PlanItem[]>;
  /** Entity IDs dismissed this session; never re-suggested. */
  dismissedEntityIds: string[];
  constraints: AppliedConstraint[];
}

export type FeedbackReason = "too_far" | "too_expensive" | "too_loud" | "not_interested";
export const FEEDBACK_REASONS: FeedbackReason[] = ["too_far", "too_expensive", "too_loud", "not_interested"];

export interface Feedback {
  itemId: string;
  action: "save" | "dismiss" | "replace";
  reason?: FeedbackReason;
}

export interface NoVerifiedMatch {
  stage: StageKey;
  message: string;
  /** Concrete way to broaden the search; never applied automatically. */
  suggestion: string;
}

export interface PlanRevision {
  feedback: Feedback;
  before: Plan;
  after: Plan;
  /** Constraint derived from the reason, if the data could honor one. */
  appliedConstraint?: AppliedConstraint;
  /** Honest note when the data could not honor the reason fully. */
  limitation?: string;
  removedItemId?: string;
  addedItemId?: string;
  noMatch?: NoVerifiedMatch;
}

/** A resolved Qloo signal sent with the place queries, labeled with the interest it came from. */
export interface SignalSummary {
  id: string;
  kind: QlooSignalKind;
  label: string;
}

export interface PlanSession {
  plan: Plan;
  /** Normalized Qloo records for the items currently in the plan (keyed by entity ID). */
  candidates: Record<string, PlaceCandidate>;
  interests: ResolvedInterest[];
  signals: SignalSummary[];
  /**
   * Items that no longer meet the current limits after feedback tightened them.
   * They are left in place (only the item the user acted on is revised) but must be
   * shown as outside the limit so the user can replace them. Empty after a fresh build.
   */
  outOfLimitItemIds: string[];
  /** Interests that need the user to pick one of several matches. */
  needsConfirmation: { input: string; matches: InterestMatch[] }[];
  notes: string[];
}
