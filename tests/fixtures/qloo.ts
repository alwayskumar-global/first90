/**
 * Synthetic fixtures. Shapes mirror responses observed on the hackathon
 * environment (Milestone 0); names and ids are invented so no real Qloo data
 * is committed.
 */
export const TEST_KEY = "test-key-should-never-leak-123456789";

export function rawPlace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entity_id: "00000000-0000-4000-8000-000000000001",
    name: "Example Books",
    subtype: "urn:entity:place",
    location: { lat: 35.8, lon: -78.64, geohash: "dq25fkhwghqq" },
    popularity: 0.9,
    properties: {
      address: "1 Example St Raleigh, NC 27601",
      description: "A neighborhood bookshop.",
      ambience_description: "Calm and cozy.",
      price_level: 2,
      primary_genre: { id: "urn:tag:genre:place:book_store", name: "Book store", type: "urn:tag:genre:place" },
      business_rating: 4.6,
      website: "https://example.test/books",
      phone: "+1 919 555 0100",
      hours: { monday: [{ open: "09:00", close: "17:00" }] },
    },
    tags: [
      { id: "urn:tag:1", name: "Cozy", type: "urn:tag:ambience:qloo" },
      { id: "urn:tag:2", name: "Book store", type: "urn:tag:genre:place" },
      { id: "urn:tag:3", name: "Quiet", type: "urn:tag:noise_level:qloo" },
      { id: "urn:tag:4", name: "Morning", type: "urn:tag:time_of_day_fit:qloo" },
      { id: "urn:tag:5", name: "Routine visit", type: "urn:tag:visit_intent:qloo" },
      { id: "urn:tag:6", name: "Free street parking", type: "urn:tag:parking:place" },
    ],
    query: {
      affinity: 0.97,
      distance: 1234.5,
      explainability: {
        "signal.interests.entities": [
          { entity_id: "sig-a", score: 0.6 },
          { entity_id: "sig-b", score: 0.4 },
        ],
      },
    },
    ...overrides,
  };
}

export const insightsBody = (entities: unknown[]) => ({ success: true, results: { entities } });
export const tagsBody = (tags: unknown[]) => ({ success: true, results: { tags } });

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}
