import { vi } from "vitest";
import type { CategoryKey } from "@/domain/demo";
import { CATEGORIES } from "@/domain/demo";
import type { QlooClient } from "@/lib/qloo/client";
import type { PlaceCandidate, TasteInput } from "@/domain/types";

export const BASE_INPUT: TasteInput = {
  interests: ["indie bookstores", "Korean food", "coffee shops", "quiet mornings"],
  areaKey: "raleigh-nc",
  radiusMeters: 15_000,
  categories: ["cafe", "bookstore", "korean_restaurant", "museum"],
  atmosphere: "no_preference",
  preferMornings: false,
};

const PRIMARY: Record<CategoryKey, string> = {
  cafe: "Coffee shop",
  bookstore: "Book store",
  korean_restaurant: "Korean restaurant",
  museum: "Museum",
};

/** Domain-level candidate builder. Defaults are valid, eligible and unremarkable. */
export function candidate(overrides: Partial<PlaceCandidate> & { id: string; category?: CategoryKey }): PlaceCandidate {
  const category = overrides.category ?? "cafe";
  const { id, ...rest } = overrides;
  return {
    qlooEntityId: id,
    name: `Place ${id}`,
    category,
    location: { lat: 35.78, lon: -78.64 },
    primaryGenre: PRIMARY[category],
    genreTags: [PRIMARY[category]],
    atmosphere: { ambience: [], timeOfDay: [], visitIntent: [] },
    hasHoursData: true,
    priceLevel: CATEGORIES[category].pricesAvailable ? 1 : undefined,
    evidence: {
      signalEntityIds: [],
      signalTagIds: [],
      filterTagIds: [CATEGORIES[category].filterTagId],
      affinity: 0.8,
      distanceMeters: 2_000,
      tagNames: [],
    },
    ...rest,
  } as PlaceCandidate;
}

/** Raw Qloo-shaped entity (what the fake client returns before normalization). */
export function rawEntity(options: {
  id: string;
  name?: string;
  genre: string;
  distance?: number;
  price?: number;
  affinity?: number;
  ambience?: string[];
  noise?: string;
  time?: string[];
  website?: string;
  explain?: { entity_id: string; score: number }[];
}): Record<string, unknown> {
  const tag = (name: string, type: string) => ({ id: `${type}:${name}`, name, type });
  return {
    entity_id: options.id,
    name: options.name ?? `Place ${options.id}`,
    location: { lat: 35.78, lon: -78.64 },
    popularity: 0.5,
    properties: {
      address: "1 Test St",
      primary_genre: { id: "g", name: options.genre, type: "urn:tag:genre:place" },
      ...(options.price !== undefined ? { price_level: options.price } : {}),
      ...(options.website ? { website: options.website } : {}),
      business_rating: 4.4,
      hours: { monday: [] },
    },
    tags: [
      tag(options.genre, "urn:tag:genre:place"),
      ...(options.ambience ?? []).map((name) => tag(name, "urn:tag:ambience:qloo")),
      ...(options.noise ? [tag(options.noise, "urn:tag:noise_level:qloo")] : []),
      ...(options.time ?? []).map((name) => tag(name, "urn:tag:time_of_day_fit:qloo")),
    ],
    query: {
      ...(options.affinity !== undefined ? { affinity: options.affinity } : {}),
      distance: options.distance ?? 1_000,
      ...(options.explain ? { explainability: { "signal.interests.entities": options.explain } } : {}),
    },
  };
}

/** Fake client: insights results are chosen by the category tag in `filter.tags`. */
export function fakeClient(byCategoryTag: Record<string, unknown[] | Error>, extras?: Partial<QlooClient>) {
  const placeInsights = vi.fn(async (params: Record<string, unknown>) => {
    const result = byCategoryTag[String(params["filter.tags"])];
    if (result instanceof Error) throw result;
    return result ?? [];
  });
  const client = {
    search: vi.fn(async () => []),
    tags: vi.fn(async () => []),
    placeInsights,
    ...extras,
  } as unknown as QlooClient;
  return { client, placeInsights };
}

export const CAFE_TAG = CATEGORIES.cafe.filterTagId;
export const BOOK_TAG = CATEGORIES.bookstore.filterTagId;
export const KOREAN_TAG = CATEGORIES.korean_restaurant.filterTagId;
export const MUSEUM_TAG = CATEGORIES.museum.filterTagId;

/** A varied pool: 4 cafes, 3 bookstores, 3 korean, 3 museums with distinct distances/prices. */
export function sampleRaw(): Record<string, unknown[]> {
  return {
    [CAFE_TAG]: [
      rawEntity({ id: "c1", genre: "Coffee shop", distance: 300, price: 1, affinity: 0.86, ambience: ["Cozy"], noise: "Quiet", time: ["Morning"], website: "https://c1.test" }),
      rawEntity({ id: "c2", genre: "Cafe", distance: 3_000, price: 2, affinity: 0.84, ambience: ["Lively"], time: ["Afternoon"] }),
      rawEntity({ id: "c3", genre: "Coffee shop", distance: 9_000, price: 3, affinity: 0.82, ambience: ["Relaxing"], time: ["Morning"] }),
      rawEntity({ id: "c4", genre: "Juice shop", distance: 500, price: 1, affinity: 0.9 }), // noise: dropped
    ],
    [BOOK_TAG]: [
      rawEntity({ id: "b1", genre: "Book store", distance: 6_000, affinity: 0.8, ambience: ["Cozy", "Relaxing"], time: ["Morning"] }),
      rawEntity({ id: "b2", genre: "Used book store", distance: 7_000, affinity: 0.78, ambience: ["Quiet"] }),
      rawEntity({ id: "b3", genre: "Discount store", distance: 1_000, affinity: 0.95 }), // noise: dropped
    ],
    [KOREAN_TAG]: [
      rawEntity({ id: "k1", genre: "Korean restaurant", distance: 800, price: 2, affinity: 0.8 }),
      rawEntity({ id: "k2", genre: "Korean barbecue restaurant", distance: 12_000, price: 3, affinity: 0.79, ambience: ["Lively"] }),
      rawEntity({ id: "k3", genre: "Asian grocery store", distance: 400, price: 1 }), // noise: dropped
    ],
    [MUSEUM_TAG]: [
      rawEntity({ id: "m1", genre: "Art museum", distance: 6_700, affinity: 0.81, ambience: ["Serene"] }),
      rawEntity({ id: "m2", genre: "History museum", distance: 200, affinity: 0.76 }),
      rawEntity({ id: "m3", genre: "Park", distance: 100 }), // noise: dropped
    ],
  };
}

/** Larger pool (14 eligible + 3 noise) so a nine-item plan still has spare alternates. */
export function largeRaw(): Record<string, unknown[]> {
  return {
    [CAFE_TAG]: [
      rawEntity({ id: "c1", genre: "Coffee shop", distance: 300, price: 1, affinity: 0.86, ambience: ["Cozy"], noise: "Quiet", time: ["Morning"], website: "https://c1.test" }),
      rawEntity({ id: "c2", genre: "Cafe", distance: 3_000, price: 2, affinity: 0.84, ambience: ["Lively"], time: ["Afternoon"] }),
      rawEntity({ id: "c3", genre: "Coffee shop", distance: 9_000, price: 3, affinity: 0.82, ambience: ["Relaxing"], time: ["Morning"] }),
      rawEntity({ id: "c4", genre: "Juice shop", distance: 500, price: 1, affinity: 0.9 }),
      rawEntity({ id: "c5", genre: "Cafe", distance: 1_500, price: 1, affinity: 0.8, ambience: ["Cozy"], time: ["Morning"] }),
      rawEntity({ id: "c6", genre: "Coffee shop", distance: 11_000, price: 2, affinity: 0.79, ambience: ["Cozy"] }),
    ],
    [BOOK_TAG]: [
      rawEntity({ id: "b1", genre: "Book store", distance: 6_000, affinity: 0.8, ambience: ["Cozy", "Relaxing"], time: ["Morning"] }),
      rawEntity({ id: "b2", genre: "Used book store", distance: 7_000, affinity: 0.78, ambience: ["Quiet"] }),
      rawEntity({ id: "b3", genre: "Book store", distance: 13_000, price: 2, affinity: 0.77 }),
      rawEntity({ id: "b4", genre: "Discount store", distance: 1_000, affinity: 0.95 }),
    ],
    [KOREAN_TAG]: [
      rawEntity({ id: "k1", genre: "Korean restaurant", distance: 800, price: 2, affinity: 0.8 }),
      rawEntity({ id: "k2", genre: "Korean barbecue restaurant", distance: 12_000, price: 3, affinity: 0.79, ambience: ["Lively"] }),
      rawEntity({ id: "k3", genre: "Korean restaurant", distance: 4_000, price: 1, affinity: 0.78, ambience: ["Relaxing"] }),
      rawEntity({ id: "k4", genre: "Asian grocery store", distance: 400, price: 1 }),
    ],
    [MUSEUM_TAG]: [
      rawEntity({ id: "m1", genre: "Art museum", distance: 6_700, affinity: 0.81, ambience: ["Serene"] }),
      rawEntity({ id: "m2", genre: "History museum", distance: 200, affinity: 0.76 }),
      rawEntity({ id: "m3", genre: "Park", distance: 100 }),
      rawEntity({ id: "m4", genre: "Science museum", distance: 14_000, affinity: 0.75 }),
    ],
  };
}
