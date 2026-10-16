import { describe, expect, it, vi } from "vitest";
import { feedbackSchema, planSessionSchema, tasteInputSchema } from "@/domain/schemas";
import { classifyPreference, mentionsIndependent } from "@/lib/agent/preferences";
import { createTraceRecorder } from "@/lib/agent/trace";
import { createTtlCache, withCache } from "@/lib/qloo/cache";
import { buildPlan } from "@/lib/agent/workflow";
import { BASE_INPUT, fakeClient, largeRaw } from "./helpers";

describe("ttl cache", () => {
  it("expires entries and bounds size", () => {
    let now = 0;
    const cache = createTtlCache({ ttlMs: 100, maxEntries: 2, now: () => now });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined(); // evicted (oldest)
    expect(cache.get("c")).toBe(3);
    now = 150;
    expect(cache.get("c")).toBeUndefined(); // expired
    expect(cache.size()).toBeLessThanOrEqual(2);
  });

  it("answers identical Qloo requests from memory, regardless of parameter order", async () => {
    const fake = fakeClient(largeRaw());
    const cached = withCache(fake.client, createTtlCache({ ttlMs: 1_000, maxEntries: 10 }));
    const params = { "filter.type": "urn:entity:place", "filter.tags": "urn:tag:category:place:cafe", take: 5 };
    await cached.placeInsights(params);
    await cached.placeInsights({ take: 5, "filter.tags": "urn:tag:category:place:cafe", "filter.type": "urn:entity:place" });
    await cached.placeInsights({ ...params, take: 6 });
    expect(fake.placeInsights).toHaveBeenCalledTimes(2);
  });

  it("a second identical plan build makes no new Qloo calls", async () => {
    const fake = fakeClient(largeRaw());
    const cached = withCache(fake.client, createTtlCache({ ttlMs: 1_000, maxEntries: 10 }));
    await buildPlan({ client: cached }, BASE_INPUT);
    const first = fake.placeInsights.mock.calls.length;
    await buildPlan({ client: cached }, BASE_INPUT);
    expect(fake.placeInsights.mock.calls.length).toBe(first);
  });
});

describe("trace recorder", () => {
  it("records label, status, summary and a non-negative duration", async () => {
    let t = 0;
    const trace = createTraceRecorder(() => (t += 5));
    const value = await trace.step("resolve_interests", () => 42, (v) => ({ status: "done", summary: `got ${v}` }));
    expect(value).toBe(42);
    expect(trace.steps()).toEqual([
      { id: "resolve_interests", label: "Understanding your interests", status: "done", summary: "got 42", durationMs: 5 },
    ]);
  });
});

describe("preferences", () => {
  it("recognizes quiet/morning phrases and nothing else", () => {
    expect(classifyPreference("quiet mornings")).toEqual({ atmosphere: "quiet", morning: true });
    expect(classifyPreference("lively")).toEqual({ atmosphere: "lively" });
    expect(classifyPreference("early morning")).toEqual({ morning: true });
    expect(classifyPreference("morning coffee")).toBeNull();
    expect(classifyPreference("jazz")).toBeNull();
    expect(classifyPreference("")).toBeNull();
  });
  it("detects indie/local wording", () => {
    expect(mentionsIndependent(["Indie bookstores"])).toBe(true);
    expect(mentionsIndependent(["bookstores"])).toBe(false);
  });
});

describe("request schemas", () => {
  it("accepts the demo input and rejects out-of-range values", () => {
    expect(tasteInputSchema.safeParse(BASE_INPUT).success).toBe(true);
    expect(tasteInputSchema.safeParse({ ...BASE_INPUT, radiusMeters: 5 }).success).toBe(false);
    expect(tasteInputSchema.safeParse({ ...BASE_INPUT, interests: [] }).success).toBe(false);
    expect(tasteInputSchema.safeParse({ ...BASE_INPUT, maxPriceLevel: 7 }).success).toBe(false);
  });
  it("round-trips a real session through JSON and validates feedback", async () => {
    const { session } = await buildPlan({ client: fakeClient(largeRaw()).client }, BASE_INPUT);
    expect(planSessionSchema.safeParse(JSON.parse(JSON.stringify(session))).success).toBe(true);
    expect(planSessionSchema.safeParse({ ...session, plan: { ...session.plan, stages: {} } }).success).toBe(false);
    expect(feedbackSchema.safeParse({ itemId: "item:x", action: "replace", reason: "too_far" }).success).toBe(true);
    expect(feedbackSchema.safeParse({ itemId: "item:x", action: "replace", reason: "bored" }).success).toBe(false);
  });
  it("vi is available", () => expect(vi).toBeDefined());
});
