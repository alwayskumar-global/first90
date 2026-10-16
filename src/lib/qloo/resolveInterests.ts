import { CATEGORIES, INTEREST_ALIASES } from "@/domain/demo";
import type { InterestMatch, ResolvedInterest } from "@/domain/types";
import { classifyPreference } from "@/lib/agent/preferences";
import type { QlooClient } from "./client";
import { rawSearchEntitySchema, rawTagSchema } from "./schemas";
import { normalizePhrase } from "./text";

/** Tag ids in a place namespace are the only ones usable for place discovery. */
const isPlaceTag = (id: string) => id.includes(":place:");

async function tagCandidates(client: QlooClient, input: string, normalized: string): Promise<InterestMatch[]> {
  const exact = new Map<string, InterestMatch>();
  for (const raw of await client.tags(input)) {
    const parsed = rawTagSchema.safeParse(raw);
    if (!parsed.success) continue; // malformed tag record: skip
    const { id, name, type } = parsed.data;
    if (normalizePhrase(name) !== normalized) continue;
    if (!exact.has(id)) exact.set(id, { kind: "tag", id, name, ...(type ? { type } : {}), source: "qloo" });
  }
  const all = [...exact.values()];
  const placeScoped = all.filter((match) => isPlaceTag(match.id));
  return (placeScoped.length > 0 ? placeScoped : all).sort((a, b) => a.id.localeCompare(b.id));
}

async function entityCandidates(client: QlooClient, input: string, normalized: string): Promise<InterestMatch[]> {
  const exact = new Map<string, InterestMatch>();
  for (const raw of await client.search(input, { take: 10 })) {
    const parsed = rawSearchEntitySchema.safeParse(raw);
    if (!parsed.success) continue;
    const { entity_id: id, name, types } = parsed.data;
    if (normalizePhrase(name) !== normalized) continue;
    if (!exact.has(id)) exact.set(id, { kind: "entity", id, name, ...(types?.[0] ? { type: types[0] } : {}), source: "qloo" });
  }
  return [...exact.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Resolve one free-text interest.
 *  - Atmosphere/routine phrases ("quiet mornings") become preferences.
 *  - Built-in aliases resolve without a network call.
 *  - Otherwise /v2/tags is queried; only exact (normalized) name matches
 *    count. If no tag matches, /search is tried for a named entity (author,
 *    artist, place...). A near-miss is never presented as a match.
 *  - Several distinct exact matches => "ambiguous"; a `confirmedId` that is
 *    one of them resolves it. No exact match => "unmatched" (not an error).
 */
export async function resolveInterest(
  client: QlooClient,
  input: string,
  confirmedId?: string,
): Promise<ResolvedInterest> {
  const normalized = normalizePhrase(input);
  if (!normalized) return { status: "unmatched", input };

  const preference = classifyPreference(input);
  if (preference) return { status: "preference", input, preference };

  const aliasCategory = INTEREST_ALIASES[normalized];
  if (aliasCategory) {
    const category = CATEGORIES[aliasCategory];
    return {
      status: "resolved",
      input,
      match: { kind: "tag", id: category.filterTagId, name: category.label, source: "curated" },
    };
  }

  let candidates = await tagCandidates(client, input, normalized);
  if (candidates.length === 0) candidates = await entityCandidates(client, input, normalized);

  const [only] = candidates;
  if (!only) return { status: "unmatched", input };
  if (candidates.length === 1) return { status: "resolved", input, match: only };

  const confirmed = confirmedId ? candidates.find((match) => match.id === confirmedId) : undefined;
  if (confirmed) return { status: "resolved", input, match: confirmed };
  return { status: "ambiguous", input, matches: candidates };
}

export async function resolveInterests(
  client: QlooClient,
  inputs: string[],
  confirmations: Record<string, string> = {},
): Promise<ResolvedInterest[]> {
  const results: ResolvedInterest[] = [];
  for (const input of inputs) results.push(await resolveInterest(client, input, confirmations[input])); // sequential: stay inside quota
  return results;
}
