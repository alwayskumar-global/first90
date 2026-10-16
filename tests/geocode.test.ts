import { describe, expect, it, vi } from "vitest";
import { GeocoderError, normalizePhoton, readGeocoderUrl, searchPlaces, type GeocodeResult } from "@/lib/geocode/photon";
import { cachedSearch, handleGeocode, type GeocodeApiDeps } from "@/server/geocodeApi";
import { createRateLimiter } from "@/server/rateLimit";

const feature = (name: unknown, lon: unknown, lat: unknown, props: Record<string, unknown> = {}) => ({
  geometry: { coordinates: [lon, lat] },
  properties: { name, city: "Raleigh", state: "North Carolina", ...props },
});

describe("normalizePhoton", () => {
  it("keeps named places inside the demo bounds with a readable detail line", () => {
    const rows = normalizePhoton({ features: [feature("Cameron Village", -78.6565, 35.7902, { district: "West Raleigh" })] });
    expect(rows).toEqual([{ label: "Cameron Village", detail: "West Raleigh, Raleigh, North Carolina", lat: 35.7902, lon: -78.6565 }]);
  });

  it("drops places outside the bounds, unnamed ones and malformed features", () => {
    const rows = normalizePhoton({
      features: [
        feature("Charlotte Uptown", -80.8431, 35.2271), // far outside
        feature("", -78.64, 35.78), // no name
        feature("No coords", undefined, undefined),
        null,
        { geometry: { coordinates: "nope" } },
        feature("Downtown Raleigh", -78.6382, 35.7796),
      ],
    });
    expect(rows.map((r) => r.label)).toEqual(["Downtown Raleigh"]);
  });

  it("removes duplicates, caps the list at six and strips markup and control characters", () => {
    const many = Array.from({ length: 12 }, (_, i) => feature(`Place ${i}`, -78.64 - i / 1000, 35.78));
    expect(normalizePhoton({ features: [feature("Same", -78.64, 35.78), feature("same", -78.64, 35.78), ...many] })).toHaveLength(6);
    const [row] = normalizePhoton({ features: [feature("<b>Bad</b>\u0007 Name", -78.64, 35.78)] });
    expect(row?.label).toBe("b Bad /b Name");
  });

  it("rejects labels too long to be a place name", () => {
    expect(normalizePhoton({ features: [feature("x".repeat(61), -78.64, 35.78)] })).toEqual([]);
  });

  it("returns nothing for unexpected bodies", () => {
    for (const body of [null, {}, { features: "x" }, "x", 5]) expect(normalizePhoton(body)).toEqual([]);
  });
});

describe("searchPlaces", () => {
  const okFetch = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it("sends the query with the Raleigh bounding box and an identifying user agent, and nothing else", async () => {
    const fetchImpl = okFetch({ features: [feature("Five Points", -78.6402, 35.8056)] });
    const results = await searchPlaces("five points", { baseUrl: "https://geo.example/", fetchImpl });
    expect(results).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://geo.example/api");
    expect(parsed.searchParams.get("q")).toBe("five points");
    expect(parsed.searchParams.get("bbox")).toBe("-79,35.55,-78.25,36.05");
    expect([...parsed.searchParams.keys()].sort()).toEqual(["bbox", "lang", "lat", "limit", "lon", "q"]);
    expect(String((init.headers as Record<string, string>)["user-agent"])).toContain("First90");
    expect(Object.keys(init.headers as object).map((h) => h.toLowerCase())).not.toContain("cookie");
  });

  it("turns network failures, bad statuses and unreadable bodies into GeocoderError", async () => {
    await expect(searchPlaces("x", { fetchImpl: vi.fn(async () => { throw new Error("offline"); }) })).rejects.toBeInstanceOf(GeocoderError);
    await expect(searchPlaces("x", { fetchImpl: vi.fn(async () => new Response("no", { status: 429 })) })).rejects.toBeInstanceOf(GeocoderError);
    await expect(searchPlaces("x", { fetchImpl: vi.fn(async () => new Response("<html>", { status: 200 })) })).rejects.toBeInstanceOf(GeocoderError);
  });
});

describe("readGeocoderUrl", () => {
  it("defaults to Photon, allows https and loopback http, and ignores anything else", () => {
    expect(readGeocoderUrl({})).toBe("https://photon.komoot.io");
    expect(readGeocoderUrl({ GEOCODER_BASE_URL: "https://geo.example/" })).toBe("https://geo.example");
    expect(readGeocoderUrl({ GEOCODER_BASE_URL: "http://127.0.0.1:4010/photon" })).toBe("http://127.0.0.1:4010/photon");
    expect(readGeocoderUrl({ GEOCODER_BASE_URL: "http://evil.example" })).toBe("https://photon.komoot.io");
    expect(readGeocoderUrl({ GEOCODER_BASE_URL: "not a url" })).toBe("https://photon.komoot.io");
  });
});

describe("handleGeocode", () => {
  const row: GeocodeResult = { label: "Five Points", detail: "Raleigh", lat: 35.8056, lon: -78.6402 };
  const deps = (over: Partial<GeocodeApiDeps> = {}): GeocodeApiDeps => ({
    search: async () => [row],
    perVisitor: createRateLimiter({ limit: 100, windowMs: 60_000 }),
    global: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    ...over,
  });
  const get = (q: string | null, headers: Record<string, string> = {}) =>
    new Request(`http://x.test/api/geocode${q === null ? "" : `?q=${encodeURIComponent(q)}`}`, { headers });

  it("returns results and never caches the response in the browser", async () => {
    const response = await handleGeocode(get("five"), deps());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ results: [row] });
  });

  it("rejects missing, one-character and over-long queries with 400", async () => {
    for (const q of [null, "a", " ", "x".repeat(81)]) expect((await handleGeocode(get(q), deps())).status).toBe(400);
  });

  it("answers 503 geocoder_unavailable when the upstream fails, without leaking detail", async () => {
    const response = await handleGeocode(get("five"), deps({ search: async () => { throw new GeocoderError("secret upstream detail"); } }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ kind: "geocoder_unavailable", retryable: true });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("throttles per visitor and across all visitors, with Retry-After", async () => {
    const tight = deps({ perVisitor: createRateLimiter({ limit: 2, windowMs: 60_000 }) });
    const headers = { "x-forwarded-for": "9.9.9.9" };
    expect((await handleGeocode(get("aa", headers), tight)).status).toBe(200);
    expect((await handleGeocode(get("bb", headers), tight)).status).toBe(200);
    const blocked = await handleGeocode(get("cc", headers), tight);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await handleGeocode(get("cc", { "x-forwarded-for": "8.8.8.8" }), tight)).status).toBe(200); // other visitor unaffected

    const busy = deps({ global: createRateLimiter({ limit: 1, windowMs: 60_000 }) });
    expect((await handleGeocode(get("aa"), busy)).status).toBe(200);
    expect((await handleGeocode(get("aa"), busy)).status).toBe(429);
  });

  it("does not need a Qloo key (its deps are independent)", async () => {
    const saved = process.env.QLOO_API_KEY;
    delete process.env.QLOO_API_KEY;
    try {
      expect((await handleGeocode(get("five"), deps())).status).toBe(200);
    } finally {
      if (saved !== undefined) process.env.QLOO_API_KEY = saved;
    }
  });
});

describe("cachedSearch", () => {
  it("serves repeated queries (any case) from memory and expires them", async () => {
    let now = 0;
    const upstream = vi.fn(async (): Promise<GeocodeResult[]> => []);
    const search = cachedSearch(upstream, { ttlMs: 1000, now: () => now });
    await search("Five Points");
    await search("five points");
    expect(upstream).toHaveBeenCalledTimes(1);
    now = 2000;
    await search("five points");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const upstream = vi.fn().mockRejectedValueOnce(new GeocoderError("down")).mockResolvedValue([]);
    const search = cachedSearch(upstream);
    await expect(search("abc")).rejects.toBeInstanceOf(GeocoderError);
    await expect(search("abc")).resolves.toEqual([]);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
