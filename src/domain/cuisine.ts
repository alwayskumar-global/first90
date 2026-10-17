import type { CategoryKey } from "./demo";

/**
 * The restaurant category is driven by the user's cuisine (CR-009). A cuisine is a Qloo restaurant-style tag
 * such as `urn:tag:genre:place:restaurant:japanese`. With none, the plan asks Qloo for restaurants in general.
 */
export const GENERIC_RESTAURANT_TAG = "urn:tag:category:place:restaurant";

/** Qloo restaurant-style tag ids; also what the API accepts as `cuisineTagId`. */
export const CUISINE_TAG_PATTERN = /^urn:tag:genre:place:restaurant:[a-z0-9_]{2,40}$/;

export const isCuisineTag = (id: string | undefined): id is string => !!id && CUISINE_TAG_PATTERN.test(id);

/** "urn:tag:genre:place:restaurant:japanese_curry" -> "japanese_curry" */
export const cuisineSlug = (id: string | undefined): string | null => (isCuisineTag(id) ? (id.split(":").pop() ?? null) : null);

const sentenceCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** "japanese_curry" -> "Japanese curry" (the tag's own slug; nothing is invented). */
export function cuisineName(id: string | undefined): string | null {
  const slug = cuisineSlug(id);
  return slug ? sentenceCase(slug.replace(/_/g, " ")) : null;
}

/** Words that, in a place's Qloo genre, mean it serves this cuisine. */
const CUISINE_WORDS: Record<string, string[]> = {
  japanese: ["japanese", "sushi", "ramen", "izakaya", "yakitori", "teppanyaki", "tempura", "udon", "soba", "hibachi"],
  korean: ["korean"],
  chinese: ["chinese", "dim sum", "szechuan", "sichuan", "cantonese", "dumpling"],
  italian: ["italian", "pizza", "pizzeria", "pasta", "trattoria"],
  mexican: ["mexican", "taco", "taqueria", "burrito"],
  indian: ["indian"],
  thai: ["thai"],
  vietnamese: ["vietnamese", "pho"],
  sushi: ["sushi", "japanese"],
  ramen: ["ramen", "japanese"],
};

export function cuisineWords(id: string | undefined): string[] {
  const slug = cuisineSlug(id);
  if (!slug) return [];
  return CUISINE_WORDS[slug] ?? slug.split("_").filter((word) => word.length > 2);
}

/** Plural label for a category, cuisine-aware: "Japanese restaurants". */
export function categoryLabelFor(category: CategoryKey, cuisineTagId?: string): string {
  if (category === "cafe") return "Cafés";
  if (category === "bookstore") return "Bookstores";
  if (category === "museum") return "Museums & cultural venues";
  const cuisine = cuisineName(cuisineTagId);
  return cuisine ? `${cuisine} restaurants` : "Restaurants";
}

/** Singular noun for a sentence ("a Japanese restaurant"). */
export function categoryNounFor(category: CategoryKey, cuisineTagId?: string): string {
  if (category === "cafe") return "café";
  if (category === "bookstore") return "bookstore";
  if (category === "museum") return "museum or cultural venue";
  const cuisine = cuisineName(cuisineTagId);
  return cuisine ? `${cuisine} restaurant` : "restaurant";
}

/** Short badge label ("Japanese restaurant"). */
export function categoryBadgeFor(category: CategoryKey, cuisineTagId?: string): string {
  if (category === "cafe") return "Café";
  if (category === "bookstore") return "Bookstore";
  if (category === "museum") return "Cultural venue";
  return sentenceCase(categoryNounFor(category, cuisineTagId));
}

/** "Try X for a Japanese meal" / "Try X for a meal out". */
export function mealPhrase(cuisineTagId?: string): string {
  const cuisine = cuisineName(cuisineTagId);
  return cuisine ? `a ${cuisine} meal` : "a meal out";
}
