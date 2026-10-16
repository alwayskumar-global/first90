import { describe, expect, it } from "vitest";
import { ConfigError } from "@/lib/config";
import { QlooError } from "@/lib/qloo/errors";
import { createRateLimiter, clientKey } from "@/server/rateLimit";
import { handleInterest, handlePlan, type PlanApiDeps } from "@/server/planApi";
import { BASE_INPUT, BOOK_TAG, fakeClient, largeRaw } from "./helpers";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x.test/api", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

const deps = (raw = largeRaw(), limit = 100): PlanApiDeps => ({
  client: () => fakeClient(raw).client,
  limiter: createRateLimiter({ limit, windowMs: 60_000 }),
});

async function ndjson(response: Response) {
  const text = await response.text();
  return text.trim().split("\n").map((line) => JSON.parse(line) as { type: string } & Record<string, unknown>);
}

describe("POST /api/plan", () => {
  it("streams each step as it completes, then the finished session", async () => {
    const response = await handlePlan(post({ action: "build", input: BASE_INPUT }), deps());
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = await ndjson(response);
    expect(lines.filter((l) => l.type === "step").map((l) => (l["step"] as { id: string }).id)).toEqual([
      "resolve_interests", "discover_places", "apply_constraints", "construct_plan", "explain",
    ]);
    const result = lines.at(-1)!;
    expect(result.type).toBe("result");
    expect(Object.keys(result["session"] as object)).toEqual(expect.arrayContaining(["plan", "candidates", "coverage"]));
  });

  it("revises a session and returns the revision", async () => {
    const built = (await ndjson(await handlePlan(post({ action: "build", input: BASE_INPUT }), deps()))).at(-1)!;
    const session = built["session"] as { plan: { stages: { first_week: { id: string }[] } } };
    const itemId = session.plan.stages.first_week[0]!.id;
    const response = await handlePlan(post({ action: "revise", session, feedback: { itemId, action: "replace", reason: "too_far" } }), deps());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revision: { appliedConstraint: { kind: string } } };
    expect(body.revision.appliedConstraint.kind).toBe("radius");
  });

  it("returns an error line (not a 500) when the build fails midway", async () => {
    const raw = { ...largeRaw() } as Record<string, unknown[] | Error>;
    for (const key of Object.keys(raw)) raw[key] = new QlooError("rate_limit", "slow", { status: 429 });
    const d: PlanApiDeps = { client: () => fakeClient(raw).client, limiter: createRateLimiter({ limit: 10, windowMs: 1000 }) };
    const lines = await ndjson(await handlePlan(post({ action: "build", input: BASE_INPUT }), d));
    expect(lines.at(-1)).toMatchObject({ type: "error", kind: "rate_limit", retryable: false });
  });

  it("rejects bad JSON, bad shape and unsupported input before calling Qloo", async () => {
    expect((await handlePlan(post("not json"), deps())).status).toBe(400);
    expect((await handlePlan(post({ action: "build", input: { ...BASE_INPUT, interests: [] } }), deps())).status).toBe(400);
    expect((await handlePlan(post({ action: "nope" }), deps())).status).toBe(400);
  });

  it("answers 503 without leaking details when the Qloo key is not configured", async () => {
    const d: PlanApiDeps = { client: () => { throw new ConfigError("QLOO_API_KEY is not set."); }, limiter: createRateLimiter({ limit: 5, windowMs: 1000 }) };
    const response = await handlePlan(post({ action: "build", input: BASE_INPUT }), d);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("QLOO_API_KEY");
  });

  it("rate limits a visitor with a Retry-After header", async () => {
    const d = deps(largeRaw(), 1);
    expect((await handlePlan(post({ action: "nope" }, { "x-forwarded-for": "1.2.3.4" }), d)).status).toBe(400);
    const second = await handlePlan(post({ action: "nope" }, { "x-forwarded-for": "1.2.3.4" }), d);
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await handlePlan(post({ action: "nope" }, { "x-forwarded-for": "5.6.7.8" }), d)).status).toBe(400); // other visitor unaffected
  });
});

describe("POST /api/interests", () => {
  it("resolves aliases and preferences without touching Qloo", async () => {
    const d = deps();
    const alias = await (await handleInterest(post({ text: "Korean food" }), d)).json();
    expect(alias).toMatchObject({ resolved: { status: "resolved", match: { source: "curated" } } });
    const pref = await (await handleInterest(post({ text: "quiet mornings" }), d)).json();
    expect(pref).toMatchObject({ resolved: { status: "preference" } });
  });
  it("validates length and surfaces upstream rate limits", async () => {
    expect((await handleInterest(post({ text: "" }), deps())).status).toBe(400);
    expect((await handleInterest(post({ text: "x".repeat(81) }), deps())).status).toBe(400);
    const d: PlanApiDeps = {
      client: () => fakeClient({}, { tags: async () => { throw new QlooError("rate_limit", "slow", { status: 429 }); } }).client,
      limiter: createRateLimiter({ limit: 5, windowMs: 1000 }),
    };
    expect((await handleInterest(post({ text: "ramen" }), d)).status).toBe(429);
  });
});

describe("rate limiter", () => {
  it("resets after the window and derives a visitor key from proxy headers", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("a")).toMatchObject({ ok: false, retryAfterSeconds: 1 });
    now = 1001;
    expect(limiter.check("a").ok).toBe(true);
    expect(clientKey(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientKey(new Headers())).toBe("local");
  });
  it("unused tag import stays referenced", () => expect(BOOK_TAG).toContain("urn:tag"));
});
