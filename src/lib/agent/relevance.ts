import { cuisineWords, isCuisineTag } from "@/domain/cuisine";
import type { CategoryKey } from "@/domain/demo";
import type { PlaceCandidate } from "@/domain/types";

/**
 * Off-category noise filter. Qloo's category tags are broad (a discount store
 * can carry "Book store", a roller rink can carry "Cafe"), so each result is
 * checked against Qloo's own `primary_genre` for the place:
 *   1. deny list on primary genre (wins over everything),
 *   2. deny list on genre tags,
 *   3. primary genre on the allow list      -> keep, strength "primary",
 *   4. no primary genre but an allowed genre tag -> keep, strength "name",
 *   5. the name itself says it (e.g. "... Cafe") -> keep, strength "name",
 *   6. otherwise drop, with a reason.
 * Everything compared is a verbatim Qloo field or the place's own name; no
 * attribute is invented. Rules were derived from live Raleigh results.
 */
interface Rules {
  allowPrimary: string[];
  /** Allow any primary genre ending with one of these suffixes. */
  allowSuffix?: string[];
  denyPrimary: string[];
  denyGenreTags?: string[];
  nameRescue?: RegExp;
}

const RULES: Record<CategoryKey, Rules> = {
  cafe: {
    allowPrimary: [
      "cafe", "coffee shop", "coffee store", "coffee roasters", "coffee roaster", "espresso bar",
      "tea house", "bakery", "patisserie", "pastry shop", "bagel shop", "breakfast restaurant",
    ],
    denyPrimary: [
      "juice shop", "ice cream shop", "dessert shop", "dessert restaurant", "bubble tea store",
      "creperie", "fast food restaurant", "smoothie shop", "convenience store", "department store",
      "book store", "grocery store", "skating rink", "roller skating rink", "gym",
    ],
    denyGenreTags: ["fast food restaurant", "skating rink", "roller skating rink"],
    nameRescue: /\b(caf[eéè]|caff[eè]|coffee|espresso)\b/i,
  },
  bookstore: {
    allowPrimary: [
      "book store", "used book store", "childrens book store", "comic book store",
      "antiquarian and rare book store", "rare book store", "bookstore",
    ],
    denyPrimary: [
      "discount store", "variety store", "toy store", "antique store", "metaphysical supply store",
      "gift shop", "electronics store", "department store", "thrift store", "cafe", "coffee shop",
    ],
    nameRescue: /\b(books?|bookstore|bookshop)\b/i,
  },
  // Restaurants: the generic rule. A plan with a cuisine adds that cuisine's words (see `restaurantVerdict`).
  restaurant: {
    allowPrimary: ["restaurant", "pizzeria", "diner", "bistro", "brasserie", "gastropub", "steakhouse"],
    allowSuffix: [" restaurant", " steakhouse"],
    denyPrimary: [
      "fast food restaurant", "grocery store", "asian grocery store", "supermarket", "market", "convenience store",
      "hotel", "beer garden", "bar", "pub", "bakery", "dessert shop", "ice cream shop",
    ],
    denyGenreTags: ["fast food restaurant"],
  },
  museum: {
    allowPrimary: [
      "museum", "art gallery", "historical landmark", "cultural center", "performing arts theater",
      "concert hall",
    ],
    allowSuffix: [" museum"],
    denyPrimary: ["park", "imax theater", "movie theater", "zoo", "playground"],
    nameRescue: /\b(museum|gallery)\b/i,
  },
};

const clean = (value: string) => value.toLowerCase().replace(/[’']/g, "").trim();

export type RelevanceStrength = "primary" | "name";

export interface RelevanceVerdict {
  keep: boolean;
  /** How directly Qloo's data says the place is in this category. */
  strength?: RelevanceStrength;
  /** Why a place was dropped (for traces and tests). */
  reason?: string;
}

/**
 * Restaurants with a cuisine (CR-009). Qloo's cuisine tags are broad: a Chinese restaurant can carry the Japanese
 * tag. Keep a place when its own primary genre names the cuisine ("Japanese restaurant", "Sushi restaurant"), or,
 * weakly, when it is a general Asian/pan-Asian/plain restaurant that Qloo also tags with the cuisine.
 */
function restaurantVerdict(candidate: PlaceCandidate, words: string[]): RelevanceVerdict {
  const generic = assessGeneric(candidate);
  if (!generic.keep) return generic;
  const primary = candidate.primaryGenre ? clean(candidate.primaryGenre) : undefined;
  const genreTags = candidate.genreTags.map(clean);
  const says = (text: string) => words.some((word) => text.includes(word));
  if (primary && says(primary)) return { keep: true, strength: "primary" };
  const loose = !primary || ["restaurant", "asian restaurant", "pan-asian restaurant"].includes(primary);
  if (loose && genreTags.some(says)) return { keep: true, strength: "name" };
  if (new RegExp(`\\b(${words.map((w) => w.replace(/[^a-z ]/g, "")).join("|")})\\b`, "i").test(candidate.name)) return { keep: true, strength: "name" };
  return {
    keep: false,
    reason: candidate.primaryGenre ? `primary genre "${candidate.primaryGenre}" is not ${words[0] ?? "this cuisine"}` : "no cuisine evidence in Qloo's genre data",
  };
}

export function assessRelevance(candidate: PlaceCandidate): RelevanceVerdict {
  if (candidate.category === "restaurant") {
    const cuisineTag = candidate.evidence.filterTagIds.find(isCuisineTag);
    if (cuisineTag) return restaurantVerdict(candidate, cuisineWords(cuisineTag));
  }
  return assessGeneric(candidate);
}

function assessGeneric(candidate: PlaceCandidate): RelevanceVerdict {
  const rules = RULES[candidate.category];
  const primary = candidate.primaryGenre ? clean(candidate.primaryGenre) : undefined;
  const genreTags = candidate.genreTags.map(clean);

  if (primary && rules.denyPrimary.includes(primary)) {
    return { keep: false, reason: `primary genre "${candidate.primaryGenre}" is off-category` };
  }
  const deniedTag = rules.denyGenreTags?.find((tag) => genreTags.includes(tag));
  if (deniedTag) return { keep: false, reason: `tagged "${deniedTag}", which is off-category` };

  const allowedPrimary =
    primary !== undefined &&
    (rules.allowPrimary.includes(primary) || (rules.allowSuffix ?? []).some((suffix) => primary.endsWith(suffix)));
  if (allowedPrimary) return { keep: true, strength: "primary" };

  if (!primary && rules.allowPrimary.some((allowed) => genreTags.includes(allowed))) {
    return { keep: true, strength: "name" };
  }
  if (rules.nameRescue?.test(candidate.name)) return { keep: true, strength: "name" };

  return {
    keep: false,
    reason: candidate.primaryGenre
      ? `primary genre "${candidate.primaryGenre}" is not a ${candidate.category.replace("_", " ")}`
      : "no category evidence in Qloo's genre data",
  };
}
