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
  korean_restaurant: {
    allowPrimary: ["korean restaurant", "korean barbecue restaurant"],
    denyPrimary: ["grocery store", "asian grocery store", "supermarket", "korean grocery store"],
    nameRescue: /\bkorean\b/i,
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

export function assessRelevance(candidate: PlaceCandidate): RelevanceVerdict {
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

  // Korean restaurants: pan-Asian places that Qloo also tags as a Korean restaurant count, weakly.
  if (
    candidate.category === "korean_restaurant" &&
    (primary === "asian restaurant" || primary === "pan-asian restaurant") &&
    genreTags.includes("korean restaurant")
  ) {
    return { keep: true, strength: "name" };
  }
  return {
    keep: false,
    reason: candidate.primaryGenre
      ? `primary genre "${candidate.primaryGenre}" is not a ${candidate.category.replace("_", " ")}`
      : "no category evidence in Qloo's genre data",
  };
}
