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

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).replace(/_/g, " ");

/**
 * Plain-language kind of a Qloo tag, read from its id namespace. Qloo has several tags with the same name
 * ("Library" as a kind of place, a restaurant style, a hotel style...); this is what tells the chips apart.
 */
export function tagKindLabel(id: string): string | null {
  const [ns, domain, group, ...rest] = id.replace(/^urn:tag:/, "").split(":");
  if (ns === "category" && domain === "place") return "Kind of place";
  if (ns === "genre" && domain === "place") return group && rest.length > 0 ? `${cap(group)} style` : "Place style";
  const named: Record<string, string> = {
    amenity: "Amenity", setting: "Setting", nearby_attraction: "Nearby attraction",
    specialty_dish: "Specialty dish", cuisine: "Cuisine", good_for: "Good for",
  };
  return ns ? (named[ns] ?? null) : null;
}

/** Chip text for one of several matches: the name plus whatever tells it apart from the others. */
const optionLabel = (match: InterestMatch) =>
  `${match.name} · ${(match.kind === "tag" ? tagKindLabel(match.id) : null) ?? typeLabel(match)}`;

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

/**
 * CR-008: interests that name a kind of place Qloo knows but this demo does not search (Japanese food, libraries...).
 * They are still sent to Qloo as taste signals; they just cannot add suggestions of their own.
 */
export function unsearchedAnchors(anchors: Anchor[]): Anchor[] {
  return anchors.filter(
    (a) => (a.kind === "resolved" || a.kind === "confirmed") && !a.category && !!a.matchId?.startsWith("urn:tag:") && a.matchId.includes(":place:"),
  );
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
    case "ambiguous": {
      // Choices the user cannot tell apart are not choices: keep the first of any identical pair.
      const seen = new Set<string>();
      const options = resolved.matches
        .map((match) => ({ label: optionLabel(match), anchor: anchorFromMatch(resolved.input, match, "confirmed") }))
        .filter((option) => !seen.has(option.label) && !!seen.add(option.label));
      return options.length === 1 && options[0]
        ? { status: "single", option: { ...options[0].anchor, kind: "resolved" } }
        : { status: "ambiguous", options };
    }
    case "unmatched":
      return { status: "unmatched" };
  }
}

export const categoryLabel = (key: keyof typeof CATEGORIES) => CATEGORIES[key].label;
