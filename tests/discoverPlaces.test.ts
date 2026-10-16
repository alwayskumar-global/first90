import { describe, expect, it, vi } from "vitest";
import { DEMO_AREA } from "@/domain/demo";
import type { QlooClient } from "@/lib/qloo/client";
import { discoverPlaces } from "@/lib/qloo/discoverPlaces";
import { rawPlace } from "./fixtures/qloo";

function clientReturning(entities: unknown[]) {
  const placeInsights = vi.fn(async () => entities);
  return { client: { search: vi.fn(), tags: vi.fn(), placeInsights } as unknown as QlooClient, placeInsights };
}

const base = { category: "bookstore", center: DEMO_AREA.center, radiusMeters: DEMO_AREA.defaultRadiusMeters } as const;

describe("discoverPlaces", () => {
  it("builds a validated place query with an explicit radius and category tag", async () => {
    const { client, placeInsights } = clientReturning([rawPlace()]);
    await discoverPlaces(client, { ...base, maxPriceLevel: 2 });
    expect(placeInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        "filter.type": "urn:entity:place",
        "filter.location": "POINT(-78.6382 35.7796)",
        "filter.location.radius": 15000,
        "filter.tags": "urn:tag:category:place:book_store",
        "filter.price_level.max": 2,
      }),
    );
  });

  it("normalizes a record and preserves entity id, signals and Qloo evidence", async () => {
    const { client } = clientReturning([rawPlace()]);
    const { candidates } = await discoverPlaces(client, { ...base, signalEntityIds: ["sig-a", "sig-b"], explain: true });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      qlooEntityId: "00000000-0000-4000-8000-000000000001",
      name: "Example Books",
      category: "bookstore",
      priceLevel: 2,
      website: "https://example.test/books",
      hasHoursData: true,
      evidence: {
        signalEntityIds: ["sig-a", "sig-b"],
        filterTagIds: ["urn:tag:category:place:book_store"],
        affinity: 0.97,
        distanceMeters: 1234.5,
        explainability: [
          { entityId: "sig-a", score: 0.6 },
          { entityId: "sig-b", score: 0.4 },
        ],
        tagNames: ["Cozy", "Book store"],
      },
    });
  });

  it("returns an empty candidate list for an empty result (no error)", async () => {
    const { client } = clientReturning([]);
    const result = await discoverPlaces(client, base);
    expect(result.candidates).toEqual([]);
  });

  it("drops malformed records, counts them, and keeps the valid ones", async () => {
    const { client } = clientReturning([
      rawPlace(),
      { entity_id: "x" },
      rawPlace({ entity_id: "no-loc", location: undefined }),
      rawPlace({ entity_id: "bad-loc", location: { lat: "n/a", lon: 1 } }),
      null,
    ]);
    const result = await discoverPlaces(client, base);
    expect(result.candidates).toHaveLength(1);
    expect(result.dropped.malformed).toBe(4);
    expect(result.warnings.join(" ")).toContain("4 malformed");
  });

  it("de-duplicates by entity id", async () => {
    const { client } = clientReturning([rawPlace(), rawPlace({ name: "Example Books again" })]);
    const result = await discoverPlaces(client, base);
    expect(result.candidates).toHaveLength(1);
    expect(result.dropped.duplicate).toBe(1);
  });

  it("copies optional fields only when present and well-typed (no guessing)", async () => {
    const { client } = clientReturning([
      rawPlace({
        entity_id: "sparse",
        properties: { website: "javascript:alert(1)", price_level: 9, hours: null, phone: "  " },
        tags: [],
        query: undefined,
      }),
    ]);
    const [candidate] = (await discoverPlaces(client, base)).candidates;
    expect(candidate).toBeDefined();
    expect(candidate?.website).toBeUndefined();
    expect(candidate?.priceLevel).toBeUndefined();
    expect(candidate?.phone).toBeUndefined();
    expect(candidate?.hasHoursData).toBe(false);
    expect(candidate?.evidence.affinity).toBeUndefined();
    expect(candidate?.evidence.explainability).toBeUndefined();
  });

  it("warns when explainability was requested but absent", async () => {
    const { client } = clientReturning([rawPlace({ query: { affinity: 0.9 } })]);
    const result = await discoverPlaces(client, { ...base, signalEntityIds: ["sig-a"], explain: true });
    expect(result.warnings.join(" ")).toContain("Explainability was requested");
  });

  it("warns when a price limit cannot be checked for unpriced places", async () => {
    const { client } = clientReturning([rawPlace({ properties: {} })]);
    const result = await discoverPlaces(client, { ...base, maxPriceLevel: 1 });
    expect(result.warnings.join(" ")).toContain("no price level");
  });

  it("never surfaces an excluded entity even if Qloo returns it", async () => {
    const { client } = clientReturning([rawPlace({ entity_id: "ex" }), rawPlace({ entity_id: "keep" })]);
    const result = await discoverPlaces(client, { ...base, excludeEntityIds: ["ex"] });
    expect(result.candidates.map((c) => c.qlooEntityId)).toEqual(["keep"]);
  });
});
