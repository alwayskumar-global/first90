import type { NeighborhoodKey } from "@/domain/demo";

/** Neighborhood cards for the Location screen. Descriptions and map positions are the design's illustrative content. */
export interface NeighborhoodCard {
  key: NeighborhoodKey;
  name: string;
  tag: string;
  desc: string;
  /** Position on the simplified area illustration. */
  x: number;
  y: number;
}

export const NEIGHBORHOOD_CARDS: NeighborhoodCard[] = [
  { key: "five-points", name: "Five Points", tag: "North central", desc: "Historic residential streets, walkable cafés, quiet mornings", x: 232, y: 140 },
  { key: "warehouse", name: "Warehouse District", tag: "Downtown core", desc: "Converted brick buildings, galleries, and a transit hub", x: 150, y: 250 },
  { key: "oakwood", name: "Historic Oakwood", tag: "East central", desc: "Tree-lined brick streets and restored front porches", x: 262, y: 200 },
  { key: "downtown", name: "Downtown Raleigh", tag: "Central", desc: "Walkable core with cafés, plazas, and civic buildings", x: 200, y: 215 },
  { key: "glenwood", name: "Glenwood South", tag: "Northwest of downtown", desc: "Compact blocks of restaurants and small shops", x: 160, y: 170 },
  { key: "cameron", name: "Cameron Village", tag: "West central", desc: "Village-style shops around a historic center", x: 112, y: 214 },
  { key: "boylan", name: "Boylan Heights", tag: "Southwest of downtown", desc: "Quiet residential blocks with older homes", x: 118, y: 292 },
  { key: "north-hills", name: "North Hills", tag: "North Raleigh", desc: "Mixed-use area with shops, offices, and green space", x: 215, y: 88 },
];

export const SCOPE_CARDS = [
  { value: "nearby", title: "Nearby", desc: "Mostly places close to your neighborhood, easy to fit into a regular morning.", foot: "Closest to home" },
  { value: "flexible", title: "Flexible", desc: "A balanced mix of close spots and a few classics further out.", foot: "A comfortable stretch" },
  { value: "city", title: "Across the city", desc: "Places from around Raleigh, including green spaces and cultural centers.", foot: "The whole city" },
] as const;
