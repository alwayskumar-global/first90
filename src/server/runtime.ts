import "server-only";
import { readQlooConfig } from "@/lib/config";
import { createTtlCache, withCache } from "@/lib/qloo/cache";
import { createQlooClient, type QlooClient } from "@/lib/qloo/client";
import { createGate, createLimits } from "./limits";
import { readGeocoderUrl, searchPlaces } from "@/lib/geocode/photon";
import { cachedSearch, type GeocodeApiDeps } from "./geocodeApi";
import type { PlanApiDeps } from "./planApi";
import { readSessionSecret } from "./sessionSigning";

/** Process-wide wiring for the public routes: cached and paced Qloo client, usage limits, session signing. */
let client: QlooClient | undefined;
const limits = createLimits();
const buildGate = createGate(limits.maxConcurrentBuilds);

const ttlSeconds = Number(process.env.QLOO_CACHE_TTL_SECONDS);
const cache = createTtlCache({ ttlMs: (Number.isFinite(ttlSeconds) && ttlSeconds >= 0 ? ttlSeconds : 1800) * 1000, maxEntries: 64 });

export const planApiDeps: PlanApiDeps = {
  client() {
    if (!client) {
      // 200 ms spacing keeps a plan build (4-6 requests) well inside the event key's burst tolerance.
      client = withCache(createQlooClient({ ...readQlooConfig(), minIntervalMs: 200 }), cache);
    }
    return client;
  },
  limits,
  sessionSecret: () => readSessionSecret(),
  buildGate,
};

const geocodeTtl = Number(process.env.GEOCODER_CACHE_TTL_SECONDS);
const geocodeTtlSeconds = Number.isFinite(geocodeTtl) && geocodeTtl >= 0 && process.env.GEOCODER_CACHE_TTL_SECONDS ? geocodeTtl : 3600;

/** Area search (CR-007). Independent of the Qloo key: it works, and fails, on its own. */
export const geocodeApiDeps: GeocodeApiDeps = {
  search: cachedSearch((query) => searchPlaces(query, { baseUrl: readGeocoderUrl() }), { ttlMs: geocodeTtlSeconds * 1000 }),
  perVisitor: limits.geocode,
  global: limits.globalLookups,
};
