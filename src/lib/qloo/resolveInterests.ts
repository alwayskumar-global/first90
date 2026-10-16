import { CATEGORIES, INTEREST_ALIASES } from "@/domain/demo";
import type { InterestMatch, ResolvedInterest } from "@/domain/types";
import type { QlooClient } from "./client";
import { rawTagSchema } from "./schemas";
import { normalizePhrase } from "./text";

/** Tag ids in a place namespace are the only ones usable for place discovery. */
const isPlaceTag = (id: string) => id.includes(":place:");

/**
 * Resolve one free-text interest to Qloo tag candidates.
 *  - Built-in aliases resolve without a network call.
 *  - Otherwise /v2/tags is queried and only exact (normalized) name matches
 *    count; a partial match is never presented as a match.
 *  - Several distinct exact matches in place namespaces => "ambiguous", so the
 *    UI can ask the user. No exact match => "unmatched" (not an error).
 */
export async function resolveInterest(client: QlooClient, input: string): Promise<ResolvedInterest> {
  const normalized = normalizePhrase(input);
  if (!normalized) return { status: "unmatched", input };

  const aliasCategory = INTEREST_ALIASES[normalized];
  if (aliasCategory) {
    const category = CATEGORIES[aliasCategory];
    return {
      status: "resolved",
      input,
      match: { kind: "tag", id: category.filterTagId, name: category.label, source: "curated" },
    };
  }

  const rawTags = await client.tags(input);
  const exact = new Map<string, InterestMatch>();
  for (const raw of rawTags) {
    const parsed = rawTagSchema.safeParse(raw);
    if (!parsed.success) continue; // malformed tag record: skip
    const { id, name, type } = parsed.data;
    if (normalizePhrase(name) !== normalized) continue;
    if (!exact.has(id)) exact.set(id, { kind: "tag", id, name, ...(type ? { type } : {}), source: "qloo" });
  }

  const all = [...exact.values()];
  const placeScoped = all.filter((match) => isPlaceTag(match.id));
  const candidates = (placeScoped.length > 0 ? placeScoped : all).sort((a, b) => a.id.localeCompare(b.id));

  const [only] = candidates;
  if (!only) return { status: "unmatched", input };
  if (candidates.length === 1) return { status: "resolved", input, match: only };
  return { status: "ambiguous", input, matches: candidates };
}

export async function resolveInterests(client: QlooClient, inputs: string[]): Promise<ResolvedInterest[]> {
  const results: ResolvedInterest[] = [];
  for (const input of inputs) results.push(await resolveInterest(client, input)); // sequential: stay inside quota
  return results;
}
