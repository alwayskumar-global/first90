import { DEMO_AREA, DEMO_BOUNDS, isInDemoBounds } from "@/domain/demo";

/** One searchable place near Raleigh, as shown in the area search (CR-007). */
export interface GeocodeResult {
  label: string;
  /** Secondary line, e.g. "Cameron Village, Raleigh, North Carolina". */
  detail: string;
  lat: number;
  lon: number;
}

export const GEOCODER_DEFAULT_URL = "https://photon.komoot.io";
export const MAX_QUERY_LENGTH = 80;
export const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 6;

export class GeocoderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocoderError";
  }
}

/** Strip control characters and angle brackets; geocoder text ends up in plan wording. */
const clean = (value: unknown): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim() : "";

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

/**
 * Turn a Photon (OpenStreetMap) GeoJSON response into result rows: keep only named places inside the
 * demo bounds, drop duplicates, and cap the list. Pure, so it is unit-tested without a network.
 */
export function normalizePhoton(body: unknown): GeocodeResult[] {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const results: GeocodeResult[] = [];
  for (const feature of features as PhotonFeature[]) {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || typeof coordinates[0] !== "number" || typeof coordinates[1] !== "number") continue;
    const [lon, lat] = coordinates as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isInDemoBounds(lat, lon)) continue;
    const props = feature.properties ?? {};
    const label = clean(props.name) || clean(props.street);
    if (!label || label.length > 60) continue;
    const parts = [props.district, props.locality, props.city, props.state].map(clean).filter((part) => part && part !== label);
    const detail = [...new Set(parts)].join(", ");
    const key = `${label.toLowerCase()}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ label, detail, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

export interface GeocoderOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Search Photon for places inside the demo bounds. Only the query text leaves this server. */
export async function searchPlaces(query: string, options: GeocoderOptions = {}): Promise<GeocodeResult[]> {
  const { baseUrl = GEOCODER_DEFAULT_URL, fetchImpl = fetch, timeoutMs = 4_000 } = options;
  const params = new URLSearchParams({
    q: query,
    limit: "10",
    lang: "en",
    lat: String(DEMO_AREA.center.lat),
    lon: String(DEMO_AREA.center.lon),
    bbox: `${DEMO_BOUNDS.minLon},${DEMO_BOUNDS.minLat},${DEMO_BOUNDS.maxLon},${DEMO_BOUNDS.maxLat}`,
  });
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api?${params}`, {
      headers: { "user-agent": "First90/0.1 (Qloo hackathon demo; https://github.com/alwayskumar-global/first90)", accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new GeocoderError("The place search is not reachable.");
  }
  if (!response.ok) throw new GeocoderError(`The place search returned ${response.status}.`);
  try {
    return normalizePhoton(await response.json());
  } catch {
    throw new GeocoderError("The place search returned an unreadable response.");
  }
}

/** Geocoder base URL from the environment. https only, except loopback for the end-to-end mock. */
export function readGeocoderUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.GEOCODER_BASE_URL?.trim() || GEOCODER_DEFAULT_URL).replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return raw;
  } catch {
    /* fall through */
  }
  return GEOCODER_DEFAULT_URL;
}
