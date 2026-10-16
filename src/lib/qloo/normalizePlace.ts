import type { CategoryKey } from "@/domain/demo";
import type { Evidence, PlaceCandidate } from "@/domain/types";
import { rawPlaceEntitySchema } from "./schemas";

export interface NormalizeContext {
  category: CategoryKey;
  signalEntityIds: string[];
  signalTagIds: string[];
  filterTagIds: string[];
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};

const asHttpUrl = (value: unknown): string | undefined => {
  const text = asString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function readExplainability(raw: Record<string, unknown> | undefined): Evidence["explainability"] {
  const entries = raw?.["signal.interests.entities"];
  if (!Array.isArray(entries)) return undefined;
  const out: { entityId: string; score: number }[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const { entity_id: entityId, score } = entry as Record<string, unknown>;
    if (typeof entityId === "string" && typeof score === "number" && Number.isFinite(score)) {
      out.push({ entityId, score });
    }
  }
  return out.length > 0 ? out : undefined;
}

function readTagNames(tags: unknown[] | undefined): string[] {
  const names: string[] = [];
  for (const tag of tags ?? []) {
    const name = typeof tag === "object" && tag !== null ? asString((tag as Record<string, unknown>)["name"]) : undefined;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Normalize one raw Qloo place record into a PlaceCandidate, or null when a
 * required field (id, name, coordinates) is missing or malformed. Optional
 * fields are copied only when present and well-typed; nothing is guessed.
 */
export function normalizePlace(record: unknown, context: NormalizeContext): PlaceCandidate | null {
  const parsed = rawPlaceEntitySchema.safeParse(record);
  if (!parsed.success) return null;
  const raw = parsed.data;
  const props = raw.properties ?? {};

  const priceLevel = asNumber(props["price_level"]);
  const evidence: Evidence = {
    signalEntityIds: context.signalEntityIds,
    signalTagIds: context.signalTagIds,
    filterTagIds: context.filterTagIds,
    tagNames: readTagNames(raw.tags),
    ...(raw.query?.affinity !== undefined ? { affinity: raw.query.affinity } : {}),
    ...(raw.query?.distance !== undefined ? { distanceMeters: raw.query.distance } : {}),
  };
  const explainability = readExplainability(raw.query?.explainability);
  if (explainability) evidence.explainability = explainability;

  const address = asString(props["address"]);
  const neighborhood = asString(props["neighborhood"]);
  const description = asString(props["description"]) ?? asString(props["short_description"]);
  const ambience = asString(props["ambience_description"]);
  const rating = asNumber(props["business_rating"]);
  const website = asHttpUrl(props["website"]);
  const phone = asString(props["phone"]);

  return {
    qlooEntityId: raw.entity_id,
    name: raw.name.trim(),
    category: context.category,
    location: {
      lat: raw.location.lat,
      lon: raw.location.lon,
      ...(raw.location.geohash ? { geohash: raw.location.geohash } : {}),
    },
    ...(address ? { address } : {}),
    ...(neighborhood ? { neighborhood } : {}),
    ...(description ? { description } : {}),
    ...(ambience ? { ambienceDescription: ambience } : {}),
    ...(priceLevel !== undefined && priceLevel >= 1 && priceLevel <= 4 ? { priceLevel } : {}),
    ...(rating !== undefined ? { businessRating: rating } : {}),
    ...(website ? { website } : {}),
    ...(phone ? { phone } : {}),
    hasHoursData: hasContent(props["hours"]),
    ...(raw.popularity !== undefined ? { popularity: raw.popularity } : {}),
    evidence,
  };
}
