import { describe, expect, it, vi } from "vitest";
import type { QlooClient } from "@/lib/qloo/client";
import { resolveInterest, resolveInterests } from "@/lib/qloo/resolveInterests";

function clientWithTags(tags: unknown[]): QlooClient & { tags: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn(),
    placeInsights: vi.fn(),
    tags: vi.fn(async () => tags),
  } as unknown as QlooClient & { tags: ReturnType<typeof vi.fn> };
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
    expect((await resolveInterest(client, "quiet mornings")).status).toBe("unmatched");
  });

  it("skips malformed tag records instead of failing", async () => {
    const client = clientWithTags([null, { id: 5 }, { id: "urn:tag:genre:place:x", name: "Zine shop" }]);
    expect(await resolveInterest(client, "zine shop")).toMatchObject({ status: "resolved" });
  });

  it("resolves several interests sequentially, preserving order", async () => {
    const client = clientWithTags([]);
    const results = await resolveInterests(client, ["coffee shops", "quiet mornings"]);
    expect(results.map((r) => r.status)).toEqual(["resolved", "unmatched"]);
  });
});
