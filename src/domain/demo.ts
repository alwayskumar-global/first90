/**
 * Locked demo scope from Milestone 0 (approved CR-001/CR-003): Raleigh, NC and
 * four place categories. Tag IDs come from live /v2/tags lookups on the
 * hackathon environment. Climbing was dropped (no Raleigh coverage).
 */

export const DEMO_AREA = {
  key: "raleigh-nc",
  label: "Raleigh, NC",
  /** Downtown Raleigh. */
  center: { lat: 35.7796, lon: -78.6382 },
  /** How the search center is described in user-facing text. */
  centerLabel: "downtown Raleigh",
  /** Qloo returns zero results when a radius is omitted, so always send one. */
  defaultRadiusMeters: 15_000,
  maxRadiusMeters: 50_000,
} as const;

export const CATEGORY_KEYS = ["cafe", "bookstore", "korean_restaurant", "museum"] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface CategoryDefinition {
  key: CategoryKey;
  label: string;
  /** Singular noun for sentences ("a café"). */
  noun: string;
  /** Qloo tag used as `filter.tags` for this category. */
  filterTagId: string;
  /**
   * Whether Qloo carries price levels for this category. Museums and cultural
   * venues return none, so a price ceiling cannot be checked for them (CR-003).
   */
  pricesAvailable: boolean;
}

export const CATEGORIES: Record<CategoryKey, CategoryDefinition> = {
  cafe: {
    key: "cafe",
    label: "Cafés",
    noun: "café",
    filterTagId: "urn:tag:category:place:cafe",
    pricesAvailable: true,
  },
  bookstore: {
    key: "bookstore",
    label: "Bookstores",
    noun: "bookstore",
    filterTagId: "urn:tag:category:place:book_store",
    pricesAvailable: true,
  },
  korean_restaurant: {
    key: "korean_restaurant",
    label: "Korean restaurants",
    noun: "Korean restaurant",
    filterTagId: "urn:tag:genre:place:restaurant:korean",
    pricesAvailable: true,
  },
  museum: {
    key: "museum",
    label: "Museums & cultural venues",
    noun: "museum or cultural venue",
    filterTagId: "urn:tag:category:place:museum",
    pricesAvailable: false,
  },
};

export const DEMO_PERSONA = {
  story:
    "I'm moving from Seattle to Raleigh. I like indie bookstores, Korean food, coffee shops and quiet mornings. Help me build a life, not just find an apartment.",
  interests: ["indie bookstores", "Korean food", "coffee shops", "quiet mornings"],
} as const;

export function isCategoryKey(value: string): value is CategoryKey {
  return (CATEGORY_KEYS as readonly string[]).includes(value);
}

/**
 * Built-in aliases from normalized interest phrases to locked demo categories.
 * Avoids a live lookup for the phrases the demo persona uses and makes their
 * resolution deterministic. Anything else goes to Qloo's /v2/tags.
 */
export const INTEREST_ALIASES: Record<string, CategoryKey> = {
  "indie bookstore": "bookstore",
  "independent bookstore": "bookstore",
  bookstore: "bookstore",
  "book store": "bookstore",
  "korean food": "korean_restaurant",
  "korean restaurant": "korean_restaurant",
  "korean bbq": "korean_restaurant",
  "coffee shop": "cafe",
  coffee: "cafe",
  cafe: "cafe",
  museum: "museum",
  "art museum": "museum",
};

// ------------------------------------------------------------- planner

export const STAGE_LABELS = {
  first_week: "First Week",
  first_month: "First Month",
  months_2_3: "Months 2\u20133",
} as const;

/** Suggestions per stage. Four categories, so every stage can show 3 distinct ones. */
export const ITEMS_PER_STAGE = 3;

/** Smallest radius feedback may tighten to, in meters. */
export const MIN_RADIUS_METERS = 2_000;

/** Candidates requested per category; depth for diversification and replacements. */
export const POOL_SIZE_PER_CATEGORY = 30;
