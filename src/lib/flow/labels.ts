import { CATEGORIES } from "@/domain/demo";
import type { InterestMatch, ResolvedInterest } from "@/domain/types";
import { categoryOfTag } from "./input";
import type { Anchor } from "./types";

const ENTITY_TYPES: Record<string, string> = {
  author: "Author", artist: "Artist", person: "Person", book: "Book", movie: "Film", tv_show: "TV show",
  podcast: "Podcast", video_game: "Game", place: "Place", brand: "Brand", destination: "Place",
};

/** Short type chip for a Qloo match (what kind of thing it is). */
export function typeLabel(match: InterestMatch): string {
  if (match.kind === "entity") return ENTITY_TYPES[(match.type ?? "").replace("urn:entity:", "")] ?? "Interest";
  const category = categoryOfTag(match.id);
  if (category) return category === "korean_restaurant" ? "Food" : "Place";
  if ((match.type ?? "").includes("cuisine")) return "Food";
  if ((match.id ?? "").includes(":place:")) return "Place";
  return "Interest";
}

export function anchorFromMatch(input: string, match: InterestMatch, kind: "resolved" | "confirmed"): Anchor {
  const category = categoryOfTag(match.id);
  return {
    input,
    name: match.source === "curated" ? input : match.name,
    type: typeLabel(match),
    kind,
    matchId: match.id,
    ...(category ? { category } : {}),
  };
}

export function anchorFromPreference(input: string): Anchor {
  return { input, name: input, type: "Preference", kind: "preference" };
}

export function anchorOwnWords(input: string): Anchor {
  return { input, name: input, type: "Your words", kind: "own" };
}

/** What the interest search shows for one resolved interest. */
export type InterestOutcome =
  | { status: "single"; option: Anchor }
  | { status: "ambiguous"; options: { label: string; anchor: Anchor }[] }
  | { status: "unmatched" };

export function outcomeFromResolved(resolved: ResolvedInterest): InterestOutcome {
  switch (resolved.status) {
    case "resolved":
      return { status: "single", option: anchorFromMatch(resolved.input, resolved.match, "resolved") };
    case "preference":
      return { status: "single", option: anchorFromPreference(resolved.input) };
    case "ambiguous":
      return {
        status: "ambiguous",
        options: resolved.matches.map((match) => ({
          label: `${match.name} · ${typeLabel(match)}`,
          anchor: anchorFromMatch(resolved.input, match, "confirmed"),
        })),
      };
    case "unmatched":
      return { status: "unmatched" };
  }
}

export const categoryLabel = (key: keyof typeof CATEGORIES) => CATEGORIES[key].label;
