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
  /** Qloo returns zero results when a radius is omitted, so always send one. */
  defaultRadiusMeters: 15_000,
  maxRadiusMeters: 50_000,
} as const;

export const CATEGORY_KEYS = ["cafe", "bookstore", "korean_restaurant", "museum"] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface CategoryDefinition {
  key: CategoryKey;
  label: string;
  /** Qloo tag used as `filter.tags` for this category. */
  filterTagId: string;
}

export const CATEGORIES: Record<CategoryKey, CategoryDefinition> = {
  cafe: { key: "cafe", label: "Cafés", filterTagId: "urn:tag:category:place:cafe" },
  bookstore: {
    key: "bookstore",
    label: "Bookstores",
    filterTagId: "urn:tag:category:place:book_store",
  },
  korean_restaurant: {
    key: "korean_restaurant",
    label: "Korean restaurants",
    filterTagId: "urn:tag:genre:place:restaurant:korean",
  },
  museum: {
    key: "museum",
    label: "Museums & cultural venues",
    filterTagId: "urn:tag:category:place:museum",
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
