// Bounded probe of image sources for Raleigh places (CR-010, Step 1). Prints counts only: no key, no place names.
// Usage: set -a; . ./.env.local; set +a; node scripts/probe-images.mjs
const KEY = process.env.QLOO_API_KEY;
if (!KEY) throw new Error("QLOO_API_KEY is not set");
const BASE = "https://hackathon.api.qloo.com";
const UA = "First90ImageProbe/0.1 (Qloo hackathon demo; https://github.com/alwayskumar-global/first90)";
const TAGS = {
  cafe: "urn:tag:category:place:cafe",
  bookstore: "urn:tag:category:place:book_store",
  restaurant: "urn:tag:genre:place:restaurant:korean",
  museum: "urn:tag:category:place:museum",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function timedFetch(url, init = {}, ms = 3000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, headers: { "user-agent": UA, ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(t);
  }
}

/** Does this URL return an image? (GET, headers only.) */
async function imageWorks(url) {
  try {
    const res = await timedFetch(url, { redirect: "follow", headers: { accept: "image/*" } }, 4000);
    const ok = res.status === 200 && (res.headers.get("content-type") ?? "").startsWith("image/");
    await res.body?.cancel();
    return { ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** First 256 KB of the page, then og:image / twitter:image. */
async function pageImage(website) {
  try {
    const res = await timedFetch(website, { redirect: "follow", headers: { accept: "text/html" } }, 1500);
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return { fetched: res.ok, url: undefined };
    const reader = res.body.getReader();
    let html = "";
    const dec = new TextDecoder();
    while (html.length < 256 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    await reader.cancel();
    const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
    for (const key of ["og:image:secure_url", "og:image", "twitter:image"]) {
      for (const tag of metas) {
        const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
        const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
        if (name === key && content) {
          try {
            return { fetched: true, url: new URL(content.replace(/&amp;/g, "&"), res.url).toString() };
          } catch { /* ignore a malformed value */ }
        }
      }
    }
    return { fetched: true, url: undefined };
  } catch {
    return { fetched: false, url: undefined };
  }
}

const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "museum", "gallery", "center", "centre"].includes(w));

/** Wikimedia Commons files within 150 m; "named" = the file title or description mentions the venue. */
async function commons(name, lat, lon) {
  try {
    const geo = await (await timedFetch(`https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=150&gslimit=10&gsnamespace=6&format=json&origin=*`)).json();
    const titles = (geo.query?.geosearch ?? []).map((g) => g.title);
    if (titles.length === 0) return { nearby: 0, named: false, works: false };
    const info = await (await timedFetch(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join("|"))}&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime&iiurlwidth=800&format=json&origin=*`)).json();
    const vw = words(name);
    let best;
    for (const page of Object.values(info.query?.pages ?? {})) {
      const ii = page.imageinfo?.[0];
      if (!ii || !String(ii.mime).startsWith("image/")) continue;
      const text = `${page.title} ${ii.extmetadata?.ImageDescription?.value ?? ""} ${ii.extmetadata?.ObjectName?.value ?? ""}`.toLowerCase();
      const hit = vw.length > 0 && vw.filter((w) => text.includes(w)).length >= Math.min(2, vw.length);
      if (hit) best = ii;
    }
    return { nearby: titles.length, named: !!best, works: best ? (await imageWorks(best.thumburl ?? best.url)).ok : false };
  } catch {
    return { nearby: 0, named: false, works: false };
  }
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const n = i++; out[n] = await fn(items[n]); } }));
  return out;
}

const rows = [];
for (const [category, tag] of Object.entries(TAGS)) {
  const params = new URLSearchParams({
    "filter.type": "urn:entity:place", "filter.location": "POINT(-78.6382 35.7796)", "filter.location.radius": "15000", "filter.tags": tag, take: "20",
  });
  const res = await fetch(`${BASE}/v2/insights?${params}`, { headers: { "X-Api-Key": KEY } });
  if (!res.ok) throw new Error(`Qloo ${category}: HTTP ${res.status}`);
  const entities = (await res.json()).results.entities;
  const probed = await pool(entities, 5, async (e) => {
    const p = e.properties ?? {};
    const qlooUrl = p.image?.url ?? p.images?.[0]?.url;
    const q = qlooUrl && /^https:\/\//.test(qlooUrl) ? await imageWorks(qlooUrl) : { ok: false, status: -1 };
    const website = typeof p.website === "string" && /^https?:\/\//.test(p.website) ? p.website : undefined;
    let page = { fetched: false, url: undefined }, pageOk = false;
    if (!q.ok && website) {
      page = await pageImage(website);
      if (page.url && /^https?:\/\//.test(page.url)) pageOk = (await imageWorks(page.url)).ok;
    }
    const wiki = !q.ok && !pageOk && category === "museum" ? await commons(e.name, e.location.lat, e.location.lon) : undefined;
    return { hasField: !!qlooUrl, field: p.image?.url ? "properties.image.url" : p.images?.[0]?.url ? "properties.images[0].url" : "none", types: p.images?.map((i) => i.type), qlooOk: q.ok, qlooStatus: q.status, website: !!website, pageFetched: page.fetched, ogFound: !!page.url, ogOk: pageOk, wiki };
  });
  await sleep(300);
  const n = probed.length;
  const c = (f) => probed.filter(f).length;
  rows.push({
    category, places: n,
    "qloo field present": c((r) => r.hasField), "qloo image 200": c((r) => r.qlooOk),
    "no working qloo image": c((r) => !r.qlooOk), "...with website": c((r) => !r.qlooOk && r.website),
    "og:image found": c((r) => r.ogFound), "og:image loads": c((r) => r.ogOk),
    ...(category === "museum" ? { "commons nearby": c((r) => r.wiki?.nearby > 0), "commons name-matched": c((r) => r.wiki?.named), "commons loads": c((r) => r.wiki?.works) } : {}),
    "any image": c((r) => r.qlooOk || r.ogOk || r.wiki?.works),
    fieldPaths: [...new Set(probed.map((r) => r.field))].join(","),
    qloo_statuses: JSON.stringify(probed.reduce((a, r) => ({ ...a, [r.qlooStatus]: (a[r.qlooStatus] ?? 0) + 1 }), {})),
  });
}
console.table(rows);
