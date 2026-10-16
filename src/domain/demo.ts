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

/**
 * CR-007: searched places are accepted only inside this box around Raleigh and the rest of Wake County's core.
 * It bounds the geocoder query and is re-checked on the server for every plan.
 */
export const DEMO_BOUNDS = { minLat: 35.55, maxLat: 36.05, minLon: -79.0, maxLon: -78.25 } as const;

export interface CustomArea {
  lat: number;
  lon: number;
  /** Short place name from the geocoder, used in "about 2.3 km from ...". */
  label: string;
}

export const isInDemoBounds = (lat: number, lon: number): boolean =>
  lat >= DEMO_BOUNDS.minLat && lat <= DEMO_BOUNDS.maxLat && lon >= DEMO_BOUNDS.minLon && lon <= DEMO_BOUNDS.maxLon;

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
   * Whether Qloo reliably carries price levels for this category. Museums and
   * cultural venues return none (CR-003) and most bookstores none (CR-004), so a
   * price ceiling cannot be checked for them: unpriced places are kept and flagged
   * "Price not available", and no price filter is sent to Qloo for the category.
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
    // CR-004: Qloo lists no price for most Raleigh bookstores, so a price ceiling keeps unpriced ones, flagged.
    pricesAvailable: false,
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

// ------------------------------------------------------- areas (Milestone 3)

/**
 * Search anchors for the neighborhoods offered in the setup flow. Coordinates are
 * approximate neighborhood centers chosen by hand for this demo (not from Qloo);
 * distances shown to users are measured from these points, so the UI labels them
 * "from <name>". The default anchor is downtown Raleigh.
 */
export const NEIGHBORHOODS = {
  "five-points": { name: "Five Points", lat: 35.8056, lon: -78.6402 },
  warehouse: { name: "Warehouse District", lat: 35.7790, lon: -78.6445 },
  oakwood: { name: "Historic Oakwood", lat: 35.79, lon: -78.629 },
  downtown: { name: "Downtown Raleigh", lat: 35.7796, lon: -78.6382 },
  glenwood: { name: "Glenwood South", lat: 35.7885, lon: -78.6455 },
  cameron: { name: "Cameron Village", lat: 35.7902, lon: -78.6565 },
  boylan: { name: "Boylan Heights", lat: 35.7698, lon: -78.6522 },
  "north-hills": { name: "North Hills", lat: 35.8383, lon: -78.6419 },
} as const;
export type NeighborhoodKey = keyof typeof NEIGHBORHOODS;
export const NEIGHBORHOOD_KEYS = Object.keys(NEIGHBORHOODS) as NeighborhoodKey[];
export const isNeighborhoodKey = (value: string): value is NeighborhoodKey =>
  (NEIGHBORHOOD_KEYS as string[]).includes(value);

/** How wide to look: a hard distance limit, applied by the planner. */
export const SEARCH_SCOPES = {
  nearby: { label: "Nearby", radiusMeters: 5_000 },
  flexible: { label: "Flexible", radiusMeters: 10_000 },
  city: { label: "Across the city", radiusMeters: 15_000 },
} as const;
export type ScopeKey = keyof typeof SEARCH_SCOPES;

/**
 * Search center and the name used in "about 2.3 km from ..." for a searched place (CR-007), a chosen
 * neighborhood, or downtown.
 */
export function resolveCenter(
  neighborhoodKey?: string,
  customArea?: CustomArea,
): { center: { lat: number; lon: number }; label: string } {
  if (customArea) return { center: { lat: customArea.lat, lon: customArea.lon }, label: customArea.label };
  if (neighborhoodKey && isNeighborhoodKey(neighborhoodKey)) {
    const n = NEIGHBORHOODS[neighborhoodKey];
    return { center: { lat: n.lat, lon: n.lon }, label: neighborhoodKey === "downtown" ? "downtown Raleigh" : n.name };
  }
  return { center: DEMO_AREA.center, label: DEMO_AREA.centerLabel };
}
