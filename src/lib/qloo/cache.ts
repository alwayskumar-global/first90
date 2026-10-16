import type { QlooClient } from "./client";
import type { QlooParams } from "./validate";

/**
 * Small in-memory TTL cache for Qloo responses (server-side, private).
 * The hackathon guide allows private caching and forbids committing Qloo data
 * to a public repo; this cache lives only in process memory and is never
 * written to disk. Bounded in size and age so it cannot grow without limit.
 */
export interface TtlCache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  size(): number;
}

export function createTtlCache(options: { ttlMs: number; maxEntries: number; now?: () => number }): TtlCache {
  const { ttlMs, maxEntries, now = Date.now } = options;
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    get<T>(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= now()) {
        store.delete(key);
        return undefined;
      }
      return hit.value as T;
    },
    set<T>(key: string, value: T) {
      store.delete(key);
      store.set(key, { value, expiresAt: now() + ttlMs });
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },
    size: () => store.size,
  };
}

function stableKey(method: string, args: unknown): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]))
        : value;
  return `${method}:${JSON.stringify(sorted(args))}`;
}

/** Wrap a client so identical requests within the TTL are answered from memory. */
export function withCache(client: QlooClient, cache: TtlCache): QlooClient {
  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await load();
    cache.set(key, value);
    return value;
  }
  return {
    search: (query, opts) => cached(stableKey("search", { query, opts }), () => client.search(query, opts)),
    tags: (query, opts) => cached(stableKey("tags", { query, opts }), () => client.tags(query, opts)),
    placeInsights: (params: QlooParams) => cached(stableKey("insights", params), () => client.placeInsights(params)),
  };
}

let shared: TtlCache | undefined;
/** Process-wide cache for server routes: 30 minutes, at most 64 responses. */
export function sharedCache(): TtlCache {
  shared ??= createTtlCache({ ttlMs: 30 * 60_000, maxEntries: 64 });
  return shared;
}
