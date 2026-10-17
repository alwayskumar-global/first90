// Live grounding audit (needs a running app and a real Qloo key; ~5 Qloo requests).
//   QLOO_API_KEY=... node scripts/live-audit.mjs [http://127.0.0.1:3000]
// 1. builds the demo-persona plan through the app's own API,
// 2. repeats the same Qloo request for each category directly against Qloo,
// 3. checks every recommended place exists in Qloo's response with the SAME name, address, price level, website and
//    distance, and that no sentence shown for it contains a score, odds, hours or other invented fact.
// Prints counts and pass/fail only: no place data, ids or secrets.
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:3000";
const env = (name) => {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch { return undefined; }
};
const key = env("QLOO_API_KEY");
const qlooBase = (env("QLOO_BASE_URL") || "https://hackathon.api.qloo.com").replace(/\/+$/, "");
if (!key) { console.error("QLOO_API_KEY is required (env or .env.local)"); process.exit(2); }

const DOWNTOWN = { lat: 35.7796, lon: -78.6382 };
const input = {
  interests: ["indie bookstores", "Korean food", "coffee shops", "quiet mornings"],
  areaKey: "raleigh-nc", radiusMeters: 15000, categories: ["cafe", "bookstore", "restaurant", "museum"], cuisineTagId: "urn:tag:genre:place:restaurant:korean",
  atmosphere: "no_preference", preferMornings: false,
};

const res = await fetch(`${base}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "build", input }) });
const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
const result = lines.find((l) => l.type === "result");
if (!result) { console.error("build failed:", JSON.stringify(lines.at(-1)).slice(0, 200)); process.exit(1); }
const session = result.session;
const items = Object.values(session.plan.stages).flat();
console.log(`plan: ${items.length} items, ${new Set(items.map((i) => i.qlooEntityId)).size} distinct places`);

const failures = [];
const fail = (msg) => failures.push(msg);

// group candidates by the exact Qloo query that produced them
const queries = new Map();
for (const item of items) {
  const c = session.candidates[item.qlooEntityId];
  const e = c.evidence;
  const k = JSON.stringify([e.filterTagIds, e.signalTagIds, e.signalEntityIds]);
  queries.set(k, e);
}
const returned = new Map();
for (const e of queries.values()) {
  const params = new URLSearchParams({
    "filter.type": "urn:entity:place",
    "filter.location": `POINT(${DOWNTOWN.lon} ${DOWNTOWN.lat})`,
    "filter.location.radius": String(session.plan.queryRadiusMeters),
    "filter.tags": e.filterTagIds.join(","),
    take: "30",
  });
  if (e.signalTagIds.length) params.set("signal.interests.tags", e.signalTagIds.join(","));
  if (e.signalEntityIds.length) { params.set("signal.interests.entities", e.signalEntityIds.join(",")); params.set("feature.explainability", "true"); }
  if (session.plan.queryMaxPriceLevel) params.set("filter.price_level.max", String(session.plan.queryMaxPriceLevel));
  const r = await fetch(`${qlooBase}/v2/insights?${params}`, { headers: { "X-Api-Key": key } });
  if (!r.ok) { fail(`Qloo re-query failed with HTTP ${r.status}`); continue; }
  for (const entity of (await r.json()).results.entities) returned.set(entity.entity_id, entity);
  await new Promise((resolve) => setTimeout(resolve, 400)); // stay well inside the event key's burst tolerance
}

const OVERCLAIM = /%|percent|probab|guarantee|\bchance\b|\brating\b|\bstars?\b|\breviews?\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\bopen (now|today|until)\b|\bcloses (at|early)\b/i;
let checked = 0;
for (const item of items) {
  const c = session.candidates[item.qlooEntityId];
  const real = returned.get(item.qlooEntityId);
  if (!real) { fail(`a recommended place was not in Qloo's response (${item.category})`); continue; }
  checked++;
  const p = real.properties ?? {};
  if (c.name !== String(real.name).trim()) fail(`name differs (${item.category})`);
  if ((c.address ?? null) !== (typeof p.address === "string" && p.address.trim() ? p.address.trim() : null)) fail(`address differs (${item.category})`);
  const price = Number(p.price_level);
  if ((c.priceLevel ?? null) !== (Number.isFinite(price) && price >= 1 && price <= 4 ? price : null)) fail(`price level differs (${item.category})`);
  let site = null; try { const u = new URL(String(p.website)); if (/^https?:$/.test(u.protocol)) site = u.toString(); } catch {}
  if ((item.externalUrl ?? null) !== site) fail(`website differs (${item.category})`);
  if (Math.abs((c.evidence.distanceMeters ?? -1) - real.query.distance) > 1) fail(`distance differs (${item.category})`);
  if (OVERCLAIM.test(`${item.why} ${item.routine} ${item.notices.join(" ")}`)) fail(`invented-fact wording in text (${item.category})`);
  const km = item.why.match(/about (\d+\.\d) km/);
  if (km && Math.abs(Number(km[1]) - real.query.distance / 1000) > 0.06) fail(`stated distance differs (${item.category})`);
  for (const tag of item.highlights) {
    const names = (real.tags ?? []).map((t) => t.name);
    if (!names.includes(tag)) fail(`a shown tag is not in Qloo's data (${item.category})`);
  }
}
if (new Set(items.map((i) => i.qlooEntityId)).size !== items.length) fail("duplicate place in plan");
console.log(`checked ${checked}/${items.length} places against a fresh Qloo response (name, address, price level, website, distance, tags, wording)`);
if (failures.length) { console.log(`FAILED (${failures.length}):`); for (const f of failures) console.log(" -", f); process.exit(1); }
console.log("LIVE AUDIT PASSED");
