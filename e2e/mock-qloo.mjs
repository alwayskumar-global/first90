// A small stand-in for the Qloo hackathon API, used only by the end-to-end tests. All data is synthetic.
// It speaks the subset the app uses (/search, /v2/tags, /v2/insights), checks the X-Api-Key header, and can be
// switched into failure modes with POST /__mode so the app's recovery paths can be exercised deterministically.
import http from "node:http";

const PORT = Number(process.env.MOCK_QLOO_PORT ?? 4010);
const KEY = "mock-key";

const TAG = {
  cafe: "urn:tag:category:place:cafe",
  bookstore: "urn:tag:category:place:book_store",
  korean: "urn:tag:genre:place:restaurant:korean",
  museum: "urn:tag:category:place:museum",
  japanese: "urn:tag:genre:place:restaurant:japanese",
};

const t = (name, type) => ({ id: `${type}:${name}`, name, type });
// Synthetic image URLs on Qloo's image host (the browser tests stub that host): most load, some are broken, some are absent.
const BROKEN_IMAGE = new Set(["mock-c2", "mock-b2", "mock-k3", "mock-m2"]);
const NO_IMAGE = new Set(["mock-c3", "mock-c5", "mock-b3", "mock-k2", "mock-m4"]);
const imageProps = (id) =>
  NO_IMAGE.has(id) ? {} : (() => {
    const url = `https://images.qloo.com/i/${BROKEN_IMAGE.has(id) ? "mock-broken" : "mock-ok"}-${id}`;
    return { image: { url }, images: [{ url, type: "urn:image:place:unknown" }] };
  })();

function entity({ id, name, genre, distance, price, affinity, ambience = [], noise, time = [], website, address }) {
  return {
    entity_id: id,
    name,
    location: { lat: 35.78, lon: -78.64 },
    popularity: 0.5,
    properties: {
      ...imageProps(id),
      address: address ?? `${id.length} Mock St Raleigh, NC`,
      primary_genre: { id: "g", name: genre, type: "urn:tag:genre:place" },
      ...(price ? { price_level: price } : {}),
      ...(website ? { website } : {}),
      business_rating: 4.4,
      hours: { monday: [{ open: "09:00", close: "17:00" }] },
    },
    tags: [
      t(genre, "urn:tag:genre:place"),
      ...ambience.map((n) => t(n, "urn:tag:ambience:qloo")),
      ...(noise ? [t(noise, "urn:tag:noise_level:qloo")] : []),
      ...time.map((n) => t(n, "urn:tag:time_of_day_fit:qloo")),
    ],
    query: { distance, ...(affinity ? { affinity } : {}) },
  };
}

const DATA = {
  [TAG.cafe]: [
    entity({ id: "mock-c1", name: "Mock Morning Cafe", genre: "Coffee shop", distance: 300, price: 1, affinity: 0.86, ambience: ["Cozy"], noise: "Quiet", time: ["Morning"], website: "https://mock-morning.example/" }),
    entity({ id: "mock-c2", name: "Mock Corner Cafe", genre: "Cafe", distance: 3000, price: 2, affinity: 0.84, ambience: ["Lively"], time: ["Afternoon"] }),
    entity({ id: "mock-c3", name: "Mock Slow Roast", genre: "Coffee shop", distance: 9000, price: 3, affinity: 0.82, ambience: ["Relaxing"], time: ["Morning"] }),
    entity({ id: "mock-c4", name: "Mock Juice Bar", genre: "Juice shop", distance: 500, price: 1, affinity: 0.9 }), // off-category noise
    entity({ id: "mock-c5", name: "Mock Quiet Bean", genre: "Cafe", distance: 1500, price: 1, affinity: 0.8, ambience: ["Cozy"], time: ["Morning"] }),
    entity({ id: "mock-c6", name: "Mock Far Beans", genre: "Coffee shop", distance: 11000, price: 2, affinity: 0.79, ambience: ["Cozy"] }),
  ],
  [TAG.bookstore]: [
    entity({ id: "mock-b1", name: "Mock Page Turner Books", genre: "Book store", distance: 6000, affinity: 0.8, ambience: ["Cozy", "Relaxing"], time: ["Morning"] }),
    entity({ id: "mock-b2", name: "Mock Used Books", genre: "Used book store", distance: 7000, affinity: 0.78, ambience: ["Quiet"] }),
    entity({ id: "mock-b3", name: "Mock Big Books", genre: "Book store", distance: 13000, price: 2, affinity: 0.77 }),
    entity({ id: "mock-b4", name: "Mock Discount Outlet", genre: "Discount store", distance: 1000, affinity: 0.95 }), // noise
  ],
  [TAG.korean]: [
    entity({ id: "mock-k1", name: "Mock Seoul Kitchen", genre: "Korean restaurant", distance: 800, price: 2, affinity: 0.8 }),
    entity({ id: "mock-k2", name: "Mock BBQ House", genre: "Korean barbecue restaurant", distance: 12000, price: 3, affinity: 0.79, ambience: ["Lively"] }),
    entity({ id: "mock-k3", name: "Mock Kimchi Corner", genre: "Korean restaurant", distance: 4000, price: 1, affinity: 0.78, ambience: ["Relaxing"] }),
    entity({ id: "mock-k4", name: "Mock Asian Grocery", genre: "Asian grocery store", distance: 400, price: 1 }), // noise
  ],
  [TAG.japanese]: [
    entity({ id: "mock-j1", name: "Mock Sushi Bar", genre: "Sushi restaurant", distance: 900, price: 3, affinity: 0.82 }),
    entity({ id: "mock-j2", name: "Mock Ramen House", genre: "Ramen restaurant", distance: 2500, price: 1, affinity: 0.8 }),
    entity({ id: "mock-j3", name: "Mock Izakaya", genre: "Japanese restaurant", distance: 6000, price: 2, affinity: 0.78, ambience: ["Lively"] }),
    entity({ id: "mock-j4", name: "Mock Wok Express", genre: "Chinese restaurant", distance: 300, price: 1, affinity: 0.9 }), // tagged Japanese, but Chinese: dropped
  ],
  [TAG.museum]: [
    entity({ id: "mock-m1", name: "Mock Art Museum", genre: "Art museum", distance: 6700, affinity: 0.81, ambience: ["Serene"] }),
    entity({ id: "mock-m2", name: "Mock History Museum", genre: "History museum", distance: 200, affinity: 0.76 }),
    entity({ id: "mock-m3", name: "Mock Park", genre: "Park", distance: 100 }), // noise
    entity({ id: "mock-m4", name: "Mock Science Museum", genre: "Science museum", distance: 14000, affinity: 0.75 }),
  ],
};

const murakami = [
  { entity_id: "mock-e-author", name: "Haruki Murakami", types: ["urn:entity:author"] },
  { entity_id: "mock-e-artist", name: "Haruki Murakami", types: ["urn:entity:artist"] },
];

let mode = { mode: "ok", ids: [] };
const served = new Map();
let lastLocation = null; // WKT point and radius of the most recent /v2/insights request
const geoQueries = []; // raw query strings the mock geocoder received // entity_id -> { name, address, price, website }

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(b)); });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/__mode" && req.method === "POST") {
      mode = { mode: "ok", ids: [], ...JSON.parse((await readBody(req)) || "{}") };
      return json(res, 200, mode);
    }
    if (url.pathname === "/__last") return json(res, 200, { lastLocation, geoQueries });
    if (url.pathname === "/__served") return json(res, 200, Object.fromEntries(served));
    if (url.pathname === "/__reset") { served.clear(); lastLocation = null; geoQueries.length = 0; mode = { mode: "ok", ids: [] }; return json(res, 200, {}); }
    if (url.pathname === "/__health") return json(res, 200, { ok: true });

    // Stand-in for the Photon geocoder (no API key). Synthetic places, plus one far outside the demo area.
    if (url.pathname === "/photon/api") {
      geoQueries.push(url.search);
      if (mode.geo === "down") return json(res, 503, { error: "down" });
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const f = (name, lon, lat, extra = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { name, city: "Raleigh", state: "North Carolina", ...extra } });
      const features = q.includes("hillsborough")
        ? [f("Hillsborough Street", -78.67929, 35.79051, { district: "West Raleigh" }), f("Hillsborough Street Lofts", -78.65391, 35.78145, { district: "Glenwood South" })]
        : q.includes("charlotte") ? [f("Charlotte Uptown", -80.8431, 35.2271, { city: "Charlotte" })] : [];
      return json(res, 200, { type: "FeatureCollection", features });
    }

    if (req.headers["x-api-key"] !== KEY) return json(res, 401, { error: "unauthorized" });
    if (mode.mode === "rate_limit") return json(res, 429, { error: "rate limited" });
    if (mode.mode === "down") return json(res, 503, { error: "down" });

    if (url.pathname === "/search") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      return json(res, 200, { results: q === "haruki murakami" ? murakami : [] });
    }
    if (url.pathname === "/v2/tags") {
      const q = (url.searchParams.get("filter.query") ?? "").toLowerCase();
      const lib = (id, type) => ({ id, name: "Library", type });
      const tags = q === "ramen" ? [{ id: "urn:tag:genre:place:restaurant:ramen", name: "Ramen", type: "urn:tag:genre:place" }]
        : q === "japanese food" ? [{ id: "urn:tag:genre:place:restaurant:japanese_food", name: "Japanese Food", type: "urn:tag:genre:place" }]
        : q === "library" ? [lib("urn:tag:genre:place:library", "urn:tag:genre:place"), lib("urn:tag:category:place:library", "urn:tag:category:place"), lib("urn:tag:genre:place:restaurant:library", "urn:tag:genre:place"), lib("urn:tag:genre:place:hotel:library", "urn:tag:genre:place")]
        : [];
      return json(res, 200, { success: true, results: { tags } });
    }
    if (url.pathname === "/v2/insights") {
      if (mode.mode === "empty") return json(res, 200, { success: true, results: { entities: [] } });
      const p = url.searchParams;
      lastLocation = { point: p.get("filter.location"), radius: p.get("filter.location.radius") };
      let list = (DATA[p.get("filter.tags")] ?? []).map((e) => structuredClone(e));
      const max = p.get("filter.price_level.max");
      if (max) list = list.filter((e) => e.properties.price_level && e.properties.price_level <= Number(max));
      const exclude = (p.get("filter.exclude.entities") ?? "").split(",").filter(Boolean);
      list = list.filter((e) => !exclude.includes(e.entity_id));
      if (mode.mode === "only") list = list.filter((e) => mode.ids.includes(e.entity_id));
      const entitySignals = (p.get("signal.interests.entities") ?? "").split(",").filter(Boolean);
      if (entitySignals.length && p.get("feature.explainability") === "true") {
        for (const e of list) e.query.explainability = { "signal.interests.entities": entitySignals.map((id) => ({ entity_id: id, score: 1 / entitySignals.length })) };
      }
      for (const e of list) {
        served.set(e.entity_id, { name: e.name, address: e.properties.address, price: e.properties.price_level ?? null, website: e.properties.website ?? null, distance: e.query.distance });
      }
      return json(res, 200, { success: true, results: { entities: list.slice(0, Number(p.get("take") ?? 20)) } });
    }
    return json(res, 404, { error: "not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock qloo on ${PORT}`));
