import { describe, expect, it } from "vitest";
import { assessRelevance } from "@/lib/agent/relevance";
import { candidate } from "./helpers";

const verdict = (category: Parameters<typeof candidate>[0]["category"], primaryGenre: string | undefined, name = "X", genreTags: string[] = []) =>
  assessRelevance(candidate({ id: "t", category, primaryGenre, name, genreTags }));

describe("off-category noise filter", () => {
  it("keeps real cafes by primary genre", () => {
    expect(verdict("cafe", "Coffee shop")).toMatchObject({ keep: true, strength: "primary" });
    expect(verdict("cafe", "Bakery")).toMatchObject({ keep: true });
  });
  it("drops juice bars, ice cream and skating rinks tagged as cafes", () => {
    expect(verdict("cafe", "Juice shop", "Tropical Smoothie Cafe").keep).toBe(false); // deny wins over a 'Cafe' name
    expect(verdict("cafe", "Ice cream shop", "Two Roosters").keep).toBe(false);
    expect(verdict("cafe", "Roller skating rink", "United Skates").keep).toBe(false);
  });
  it("keeps a restaurant that is plainly a cafe by name, with lower strength", () => {
    expect(verdict("cafe", "Restaurant", "Manhattan Cafe")).toMatchObject({ keep: true, strength: "name" });
  });
  it("drops a bookstore-tagged discount, variety, toy or antique store", () => {
    for (const genre of ["Discount store", "Variety store", "Toy store", "Antique store", "Metaphysical supply store"]) {
      expect(verdict("bookstore", genre, "Some Outlet").keep).toBe(false);
    }
  });
  it("keeps used book stores and shops with 'Books' in the name", () => {
    expect(verdict("bookstore", "Used book store").keep).toBe(true);
    expect(verdict("bookstore", undefined, "Dog-Eared Books").keep).toBe(true);
  });
  it("keeps Korean restaurants; drops groceries; accepts a pan-Asian place Qloo also tags Korean (weakly)", () => {
    expect(verdict("restaurant", "Korean barbecue restaurant").keep).toBe(true);
    expect(verdict("restaurant", "Asian grocery store").keep).toBe(false);
    expect(verdict("restaurant", "Asian restaurant", "bul box", ["Korean restaurant"])).toMatchObject({ keep: true, strength: "name" });
    expect(verdict("restaurant", "Asian restaurant", "Wok Place", ["Chinese restaurant"]).keep).toBe(false);
  });
  it("keeps museums and cultural landmarks; drops parks and cinemas", () => {
    for (const genre of ["Art museum", "Children's museum", "Natural history museum", "Historical landmark"]) {
      expect(verdict("museum", genre).keep).toBe(true);
    }
    expect(verdict("museum", "Park", "Prairie Ridge Ecostation").keep).toBe(false);
    expect(verdict("museum", "IMAX theater", "Marbles IMAX").keep).toBe(false);
  });
  it("explains why something was dropped, and never invents a reason", () => {
    expect(verdict("bookstore", "Toy store").reason).toContain("Toy store");
    expect(verdict("bookstore", undefined, "Mystery").reason).toContain("no category evidence");
  });
});
