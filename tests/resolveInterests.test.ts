import { describe, expect, it, vi } from "vitest";
import type { QlooClient } from "@/lib/qloo/client";
import { resolveInterest, resolveInterests } from "@/lib/qloo/resolveInterests";

function clientWithTags(
  tags: unknown[],
  entities: unknown[] = [],
): QlooClient & { tags: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn(async () => entities),
    placeInsights: vi.fn(),
    tags: vi.fn(async () => tags),
  } as unknown as QlooClient & { tags: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> };
}

describe("resolveInterest", () => {
  it("resolves a built-in alias without any network call", async () => {
    const client = clientWithTags([]);
    const result = await resolveInterest(client, "Indie bookstores");
    expect(result).toMatchObject({ status: "resolved", match: { id: "urn:tag:category:place:book_store", source: "curated" } });
    expect(client.tags).not.toHaveBeenCalled();
  });

  it("resolves a single exact place-scoped tag", async () => {
    const client = clientWithTags([
      { id: "urn:tag:genre:place:restaurant:ramen", name: "Ramen", type: "urn:tag:genre:place" },
      { id: "urn:tag:nearby_attraction:qloo:ramen_street", name: "Ramen Street" },
    ]);
    const result = await resolveInterest(client, "ramen");
    expect(result).toMatchObject({ status: "resolved", match: { id: "urn:tag:genre:place:restaurant:ramen", source: "qloo" } });
  });

  it("reports ambiguity when several exact place tags exist", async () => {
    const client = clientWithTags([
      { id: "urn:tag:genre:place:restaurant:tea", name: "Tea" },
      { id: "urn:tag:offerings:place:tea", name: "Tea" },
      { id: "urn:tag:genre:media:tea", name: "Tea" },
    ]);
    const result = await resolveInterest(client, "Tea");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.matches.map((m) => m.id)).toEqual([
        "urn:tag:genre:place:restaurant:tea",
        "urn:tag:offerings:place:tea",
      ]);
    }
  });

  it("falls back to non-place tags only when no place-scoped exact match exists", async () => {
    const client = clientWithTags([{ id: "urn:tag:keyword:qloo:origami", name: "Origami" }]);
    expect(await resolveInterest(client, "origami")).toMatchObject({ status: "resolved" });
  });

  it("is unmatched when only partial names come back (never presents a near-miss)", async () => {
    const client = clientWithTags([{ id: "urn:tag:nearby_attraction:qloo:climbing_park", name: "Climbing Park" }]);
    expect(await resolveInterest(client, "climbing")).toEqual({ status: "unmatched", input: "climbing" });
  });

  it("is unmatched for empty input and for empty results", async () => {
    const client = clientWithTags([]);
    expect(await resolveInterest(client, "   ")).toEqual({ status: "unmatched", input: "   " });
    expect(client.tags).not.toHaveBeenCalled();
    expect((await resolveInterest(client, "zzqx")).status).toBe("unmatched");
  });

  it("skips malformed tag records instead of failing", async () => {
    const client = clientWithTags([null, { id: 5 }, { id: "urn:tag:genre:place:x", name: "Zine shop" }]);
    expect(await resolveInterest(client, "zine shop")).toMatchObject({ status: "resolved" });
  });

  it("resolves several interests sequentially, preserving order", async () => {
    const client = clientWithTags([]);
    const results = await resolveInterests(client, ["coffee shops", "quiet mornings", "zzqx"]);
    expect(results.map((r) => r.status)).toEqual(["resolved", "preference", "unmatched"]);
  });

  it("treats atmosphere/routine phrases as preferences without any network call", async () => {
    const client = clientWithTags([]);
    expect(await resolveInterest(client, "Quiet mornings")).toEqual({
      status: "preference",
      input: "Quiet mornings",
      preference: { atmosphere: "quiet", morning: true },
    });
    expect(client.tags).not.toHaveBeenCalled();
    expect(client.search).not.toHaveBeenCalled();
  });

  it("does not swallow mixed phrases like 'morning coffee' as a preference", async () => {
    const client = clientWithTags([]);
    expect((await resolveInterest(client, "morning coffee")).status).toBe("unmatched");
    expect(client.tags).toHaveBeenCalled();
  });

  it("falls back to /search for a named entity when no tag matches", async () => {
    const client = clientWithTags([], [
      { entity_id: "E1", name: "Haruki Murakami", types: ["urn:entity:author"] },
      { entity_id: "B1", name: "Haruki Murakami and the Music of Words", types: ["urn:entity:book"] },
    ]);
    const result = await resolveInterest(client, "Haruki Murakami");
    expect(result).toMatchObject({ status: "resolved", match: { kind: "entity", id: "E1", type: "urn:entity:author" } });
  });

  it("reports several same-name entities as ambiguous and honors a confirmation", async () => {
    const entities = [
      { entity_id: "E-artist", name: "Haruki Murakami", types: ["urn:entity:artist"] },
      { entity_id: "E-author", name: "Haruki Murakami", types: ["urn:entity:author"] },
    ];
    const client = clientWithTags([], entities);
    const ambiguous = await resolveInterest(client, "Haruki Murakami");
    expect(ambiguous.status).toBe("ambiguous");
    const confirmed = await resolveInterest(client, "Haruki Murakami", "E-author");
    expect(confirmed).toMatchObject({ status: "resolved", match: { id: "E-author" } });
    const invalid = await resolveInterest(client, "Haruki Murakami", "not-a-candidate");
    expect(invalid.status).toBe("ambiguous");
  });
});
