import "server-only";
import { readQlooConfig } from "@/lib/config";
import { sharedCache, withCache } from "@/lib/qloo/cache";
import { createQlooClient, type QlooClient } from "@/lib/qloo/client";
import { createRateLimiter } from "./rateLimit";
import type { PlanApiDeps } from "./planApi";

/** Process-wide wiring for the public routes: cached and paced Qloo client, per-visitor limits. */
let client: QlooClient | undefined;
const limiter = createRateLimiter({ limit: 24, windowMs: 60_000 });

export const planApiDeps: PlanApiDeps = {
  client() {
    if (!client) {
      // 200 ms spacing keeps a plan build (4-6 requests) well inside the event key's burst tolerance.
      client = withCache(createQlooClient({ ...readQlooConfig(), minIntervalMs: 200 }), sharedCache());
    }
    return client;
  },
  limiter,
};
