import { z } from "zod";
import { createTtlCache } from "@/lib/qloo/cache";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, GeocoderError, type GeocodeResult } from "@/lib/geocode/photon";
import { clientKey, type RateLimiter } from "./rateLimit";

export interface GeocodeApiDeps {
  /** Searches places by free text; already cached by the runtime when wrapped with `withCache`. */
  search(query: string): Promise<GeocodeResult[]>;
  perVisitor: RateLimiter;
  global: RateLimiter;
}

const querySchema = z.string().trim().min(MIN_QUERY_LENGTH).max(MAX_QUERY_LENGTH);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/**
 * GET /api/geocode?q=...: search places inside the demo area (CR-007). Server-side proxy to the geocoder, so
 * the browser never sends the typed text, or its address, to a third party. Needs no Qloo key.
 */
export async function handleGeocode(request: Request, deps: GeocodeApiDeps): Promise<Response> {
  const blocked = [deps.perVisitor.check(clientKey(request.headers)), deps.global.check("all")].find((result) => !result.ok);
  if (blocked && !blocked.ok) {
    return json(
      429,
      { error: "You’re going a little fast. Try again in a moment.", kind: "rate_limit", retryable: false, retryAfterSeconds: blocked.retryAfterSeconds },
      { "retry-after": String(blocked.retryAfterSeconds) },
    );
  }
  const parsed = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!parsed.success) return json(400, { error: `Type at least ${MIN_QUERY_LENGTH} characters.`, kind: "bad_request", retryable: false });
  try {
    return json(200, { results: await deps.search(parsed.data) });
  } catch (error) {
    if (!(error instanceof GeocoderError)) throw error;
    return json(503, { error: "Place search is unavailable right now.", kind: "geocoder_unavailable", retryable: true });
  }
}

/** Cache successful searches in memory (1 hour, 300 entries), so repeated typing does not hit the free geocoder. */
export function cachedSearch(search: GeocodeApiDeps["search"], options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}): GeocodeApiDeps["search"] {
  const cache = createTtlCache({ ttlMs: options.ttlMs ?? 3_600_000, maxEntries: options.maxEntries ?? 300, ...(options.now ? { now: options.now } : {}) });
  return async (query) => {
    const key = query.toLowerCase();
    const hit = cache.get<GeocodeResult[]>(key);
    if (hit) return hit;
    const results = await search(query);
    cache.set(key, results);
    return results;
  };
}
