/**
 * Small in-memory fixed-window limiter for the public demo routes. It is a
 * courtesy guard (per server instance, not global): it keeps one visitor from
 * burning the event key's quota, nothing more.
 */
export interface RateLimiter {
  check(key: string): { ok: true } | { ok: false; retryAfterSeconds: number };
}

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}): RateLimiter {
  const { limit, windowMs, maxKeys = 2_000, now = Date.now } = options;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    check(key) {
      const current = now();
      for (const [k, w] of windows) {
        if (current - w.start >= windowMs) windows.delete(k);
        if (windows.size <= maxKeys) break; // opportunistic cleanup keeps the map bounded
      }
      const window = windows.get(key);
      if (!window || current - window.start >= windowMs) {
        windows.set(key, { start: current, count: 1 });
        return { ok: true };
      }
      if (window.count >= limit) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((window.start + windowMs - current) / 1000)) };
      }
      window.count++;
      return { ok: true };
    },
  };
}

export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "local";
}
