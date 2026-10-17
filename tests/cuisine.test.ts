import { describe, expect, it } from "vitest";
import { categoryBadgeFor, categoryLabelFor, categoryNounFor, cuisineName, cuisineWords, isCuisineTag, mealPhrase } from "@/domain/cuisine";
import { INTEREST_ALIASES } from "@/domain/demo";
import { tasteInputSchema } from "@/domain/schemas";
import { buildPlan } from "@/lib/agent/workflow";
import { assessRelevance } from "@/lib/agent/relevance";
import { discoverPlaces } from "@/lib/qloo/discoverPlaces";
import { resolveInterest } from "@/lib/qloo/resolveInterests";
import { flowReducer, initialState, sampleAnchors } from "@/lib/flow/state";
import { parseSavedState } from "@/lib/flow/storage";
import { BASE_INPUT, JAPANESE_TAG, KOREAN_TAG, candidate, fakeClient, largeRaw, rawEntity } from "./helpers";

const JP = JAPANESE_TAG;

describe("cuisine tags", () => {
  it("recognise Qloo restaurant-style tags and name them from the tag itself", () => {
    expect(isCuisineTag(JP)).toBe(true);
    expect(isCuisineTag("urn:tag:category:place:restaurant")).toBe(false);
    expect(isCuisineTag("urn:tag:genre:place:restaurant:japanese; drop")).toBe(false);
    expect(cuisineName(JP)).toBe("Japanese");
    expect(cuisineName("urn:tag:genre:place:restaurant:japanese_curry")).toBe("Japanese curry");
    expect(cuisineName(undefined)).toBeNull();
    expect(cuisineWords(JP)).toContain("sushi");
    expect(cuisineWords("urn:tag:genre:place:restaurant:ethiopian")).toEqual(["ethiopian"]);
  });

  it("make cuisine-aware labels, nouns and wording; no cuisine means restaurants in general", () => {
    expect(categoryLabelFor("restaurant", JP)).toBe("Japanese restaurants");
    expect(categoryLabelFor("restaurant")).toBe("Restaurants");
    expect(categoryNounFor("restaurant", JP)).toBe("Japanese restaurant");
    expect(categoryBadgeFor("restaurant", JP)).toBe("Japanese restaurant");
    expect(categoryBadgeFor("cafe", JP)).toBe("Café");
    expect(mealPhrase(JP)).toBe("a Japanese meal");
    expect(mealPhrase()).toBe("a meal out");
  });

  it("the API accepts a cuisine tag and rejects anything else", () => {
    const parse = (cuisineTagId: unknown) => tasteInputSchema.safeParse({ ...BASE_INPUT, cuisineTagId }).success;
    expect(parse(JP)).toBe(true);
    expect(parse("urn:tag:genre:place:restaurant:")).toBe(false);
    expect(parse("urn:tag:category:place:cafe")).toBe(false);
    expect(parse("japanese")).toBe(false);
    expect(parse(`${JP}&filter.type=x`)).toBe(false);
  });
});

describe("interest aliases", () => {
  it("map cuisine phrases to the Qloo tag that has Raleigh coverage", () => {
    expect(INTEREST_ALIASES["japanese food"]).toEqual({ category: "restaurant", tagId: JP });
    expect(INTEREST_ALIASES["korean food"]).toEqual({ category: "restaurant", tagId: KOREAN_TAG });
  });
});

describe("resolving a cuisine", () => {
  it("'japanese food' resolves from the built-in aliases with no lookup", async () => {
    const { client } = fakeClient({});
    const result = await resolveInterest(client, "Japanese Food");
    expect(result).toMatchObject({ status: "resolved", match: { id: JP, source: "curated" } });
    expect(client.tags).not.toHaveBeenCalled();
  });

  it("an unlisted cuisine phrase finds Qloo's restaurant-style tag for the cuisine", async () => {
    const lookups: string[] = [];
    const { client } = fakeClient({}, {
      tags: async (query: string) => {
        lookups.push(query);
        return [
        { id: "urn:tag:genre:place:hotel:ethiopian", name: "Ethiopian" },
        { id: "urn:tag:genre:place:restaurant:ethiopian", name: "Ethiopian", type: "urn:tag:genre:place" },
        { id: "urn:tag:specialty_dish:place:ethiopian_food", name: "Ethiopian food" },
        ];
      },
    });
    const result = await resolveInterest(client, "ethiopian food");
    expect(result).toMatchObject({ status: "resolved", match: { id: "urn:tag:genre:place:restaurant:ethiopian", source: "qloo" } });
    expect(lookups).toEqual(["ethiopian"]);
  });

  it("a phrase that is not a cuisine keeps the old behaviour", async () => {
    const { client } = fakeClient({}, { tags: async () => [] });
    expect(await resolveInterest(client, "ethiopian food")).toMatchObject({ status: "unmatched" });
  });
});

describe("restaurants with a cuisine: relevance", () => {
  const verdict = (genre: string | undefined, name: string, tags: string[] = [], tag = JP) =>
    assessRelevance(candidate({ id: "r", category: "restaurant", ...(genre ? { primaryGenre: genre } : {}), name, genreTags: tags, evidence: { filterTagIds: [tag], signalEntityIds: [], signalTagIds: [], tagNames: [] } }));

  it("keeps places whose own genre names the cuisine, including sushi and ramen for Japanese", () => {
    for (const genre of ["Japanese restaurant", "Sushi restaurant", "Ramen restaurant", "Conveyor belt sushi restaurant", "Japanese steakhouse"]) {
      expect(verdict(genre, "Place").keep, genre).toBe(true);
    }
  });

  it("drops other cuisines that Qloo also tagged Japanese, and groceries", () => {
    expect(verdict("Chinese restaurant", "Golden Wok").keep).toBe(false);
    expect(verdict("Korean restaurant", "Seoul Grill").keep).toBe(false);
    expect(verdict("Asian grocery store", "Mart").keep).toBe(false);
    expect(verdict("Japanese confectionery shop", "Sweets").keep).toBe(false);
  });

  it("accepts a general Asian place Qloo also tags with the cuisine, weakly", () => {
    expect(verdict("Asian restaurant", "Fusion House", ["Sushi restaurant"])).toMatchObject({ keep: true, strength: "name" });
    expect(verdict("Asian restaurant", "Wok Place", ["Chinese restaurant"]).keep).toBe(false);
  });

  it("the Korean persona keeps working under the same rules", () => {
    expect(verdict("Korean barbecue restaurant", "Seoul BBQ", [], KOREAN_TAG).keep).toBe(true);
    expect(verdict("Japanese restaurant", "Sushi Spot", [], KOREAN_TAG).keep).toBe(false);
  });

  it("without a cuisine, any real restaurant counts and fast food does not", () => {
    const generic = (genre: string) =>
      assessRelevance(candidate({ id: "g", category: "restaurant", primaryGenre: genre, genreTags: [genre], evidence: { filterTagIds: ["urn:tag:category:place:restaurant"], signalEntityIds: [], signalTagIds: [], tagNames: [] } }));
    expect(generic("Mexican restaurant").keep).toBe(true);
    expect(generic("Restaurant").keep).toBe(true);
    expect(generic("Fast food restaurant").keep).toBe(false);
    expect(generic("Hotel").keep).toBe(false);
  });
});

describe("planning around a cuisine", () => {
  const japaneseRaw = () => {
    const raw = largeRaw();
    delete raw[KOREAN_TAG];
    raw[JP] = [
      rawEntity({ id: "j1", genre: "Japanese restaurant", distance: 900, price: 2, affinity: 0.8 }),
      rawEntity({ id: "j2", genre: "Sushi restaurant", distance: 3_000, price: 3, affinity: 0.79 }),
      rawEntity({ id: "j3", genre: "Ramen restaurant", distance: 5_000, price: 1, affinity: 0.78 }),
      rawEntity({ id: "j4", genre: "Chinese restaurant", distance: 400, price: 1, affinity: 0.9 }), // tagged Japanese by Qloo, but Chinese
    ];
    return raw;
  };

  it("asks Qloo for the cuisine's tag instead of Korean, and words the plan with it", async () => {
    const { client, placeInsights } = fakeClient(japaneseRaw());
    const { session } = await buildPlan({ client }, { ...BASE_INPUT, cuisineTagId: JP });
    const queried = placeInsights.mock.calls.map(([params]) => String((params as Record<string, unknown>)["filter.tags"]));
    expect(queried).toContain(JP);
    expect(queried).not.toContain(KOREAN_TAG);

    const meals = Object.values(session.plan.stages).flat().filter((item) => item.category === "restaurant");
    expect(meals.length).toBeGreaterThan(0);
    for (const item of meals) {
      expect(item.routine).toMatch(/for a Japanese meal$/);
      expect(item.why).toMatch(/^Japanese restaurant about /);
      expect(["j1", "j2", "j3"]).toContain(item.qlooEntityId);
    }
    expect(session.plan.input.cuisineTagId).toBe(JP);
  });

  it("the Korean persona still plans Korean restaurants", async () => {
    const { client } = fakeClient(largeRaw());
    const { session } = await buildPlan({ client }, BASE_INPUT);
    const meals = Object.values(session.plan.stages).flat().filter((item) => item.category === "restaurant");
    expect(meals.length).toBeGreaterThan(0);
    for (const item of meals) expect(item.routine).toMatch(/for a Korean meal$/);
  });

  it("without a cuisine it asks for restaurants in general and says 'a meal out'", async () => {
    const raw = largeRaw();
    raw["urn:tag:category:place:restaurant"] = [rawEntity({ id: "g1", genre: "Mexican restaurant", distance: 1_000, price: 2, affinity: 0.8 })];
    const { client, placeInsights } = fakeClient(raw);
    const { cuisineTagId: _drop, ...noCuisine } = BASE_INPUT;
    void _drop;
    const { session } = await buildPlan({ client }, noCuisine);
    expect(placeInsights.mock.calls.map(([p]) => String((p as Record<string, unknown>)["filter.tags"]))).toContain("urn:tag:category:place:restaurant");
    const meal = Object.values(session.plan.stages).flat().find((item) => item.category === "restaurant");
    expect(meal?.routine).toMatch(/for a meal out$/);
  });

  it("discoverPlaces records the filter tag it used", async () => {
    const { client } = fakeClient(japaneseRaw());
    const result = await discoverPlaces(client, { category: "restaurant", filterTagId: JP, center: { lat: 35.78, lon: -78.64 }, radiusMeters: 15_000 });
    expect(result.candidates.every((c) => c.evidence.filterTagIds[0] === JP)).toBe(true);
  });
});

describe("saved state from before cuisines", () => {
  it("keeps answers, renames the category and drops the plan signed with the old name", () => {
    const old = { ...initialState, anchors: sampleAnchors().map((a) => (a.category ? { ...a, category: "korean_restaurant" } : a)), session: { plan: { stages: { x: [{ category: "korean_restaurant" }] } } } };
    const state = parseSavedState(JSON.stringify(old));
    expect(state?.hydrated).toBe(true);
    expect(state?.session).toBeNull();
    expect(state?.anchors.find((a) => a.input === "Korean food")?.category).toBe("restaurant");
    expect(JSON.stringify(state)).not.toContain("korean_restaurant");
  });

  it("leaves current state alone, and treats junk as no state", () => {
    const current = flowReducer(initialState, { type: "loadSample" });
    expect(parseSavedState(JSON.stringify(current))?.anchors).toHaveLength(4);
    expect(parseSavedState(null)).toBeNull();
    expect(parseSavedState("{")).toBeNull();
    expect(parseSavedState("{}")).toBeNull();
  });
});
