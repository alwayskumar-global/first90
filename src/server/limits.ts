import { createRateLimiter, type RateLimiter } from "./rateLimit";

/**
 * Usage protection for the public demo. All limits are per server instance (in memory); that is a courtesy
 * guard for a demo, not a global quota. Tunable by environment for tests and deployments.
 */
export interface Limits {
  /** Per visitor. A build makes about 4-6 Qloo requests. */
  build: RateLimiter;
  revise: RateLimiter;
  interests: RateLimiter;
  /** Area search (CR-007): cheap, but it calls a free third-party geocoder. */
  geocode: RateLimiter;
  /** Across all visitors, so one busy minute cannot spend the event key's request budget. */
  globalBuild: RateLimiter;
  globalLookups: RateLimiter;
  maxConcurrentBuilds: number;
}

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function createLimits(env: Record<string, string | undefined> = process.env): Limits {
  const windowMs = 60_000;
  return {
    build: createRateLimiter({ limit: int(env.RATE_LIMIT_BUILDS_PER_MIN, 6), windowMs }),
    revise: createRateLimiter({ limit: int(env.RATE_LIMIT_REVISIONS_PER_MIN, 20), windowMs }),
    interests: createRateLimiter({ limit: int(env.RATE_LIMIT_LOOKUPS_PER_MIN, 40), windowMs }),
    geocode: createRateLimiter({ limit: int(env.RATE_LIMIT_GEOCODE_PER_MIN, 60), windowMs }),
    globalBuild: createRateLimiter({ limit: int(env.RATE_LIMIT_GLOBAL_BUILDS_PER_MIN, 40), windowMs }),
    globalLookups: createRateLimiter({ limit: int(env.RATE_LIMIT_GLOBAL_LOOKUPS_PER_MIN, 200), windowMs }),
    maxConcurrentBuilds: int(env.MAX_CONCURRENT_BUILDS, 4),
  };
}

/** Counting gate: at most `max` holders at once. */
export function createGate(max: number) {
  let active = 0;
  return {
    tryAcquire(): (() => void) | null {
      if (active >= max) return null;
      active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active--;
        }
      };
    },
    active: () => active,
  };
}
