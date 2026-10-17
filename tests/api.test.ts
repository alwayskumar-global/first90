import { describe, expect, it } from "vitest";
import { ConfigError } from "@/lib/config";
import { QlooError } from "@/lib/qloo/errors";
import { setSaved } from "@/domain/session";
import type { PlanSession } from "@/domain/types";
import { createGate, createLimits } from "@/server/limits";
import { handleInterest, handlePlan, type PlanApiDeps } from "@/server/planApi";
import { clientKey, createRateLimiter } from "@/server/rateLimit";
import { readSessionSecret, signSession, verifySession } from "@/server/sessionSigning";
import { BASE_INPUT, fakeClient, largeRaw } from "./helpers";

const SECRET = "test-secret-at-least-16-chars";
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x.test/api", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

function makeDeps(overrides: Partial<PlanApiDeps> = {}, env: Record<string, string> = {}, raw: Record<string, unknown[] | Error> = largeRaw()): PlanApiDeps {
  const limits = createLimits({ RATE_LIMIT_BUILDS_PER_MIN: "100", RATE_LIMIT_REVISIONS_PER_MIN: "100", RATE_LIMIT_LOOKUPS_PER_MIN: "100", RATE_LIMIT_GLOBAL_BUILDS_PER_MIN: "1000", RATE_LIMIT_GLOBAL_LOOKUPS_PER_MIN: "1000", ...env });
  return { client: () => fakeClient(raw).client, limits, sessionSecret: () => SECRET, buildGate: createGate(limits.maxConcurrentBuilds), ...overrides };
}

async function ndjson(response: Response) {
  const text = await response.text();
  return text.trim().split("\n").map((line) => JSON.parse(line) as { type: string } & Record<string, unknown>);
}
async function build(deps = makeDeps()): Promise<PlanSession> {
  const lines = await ndjson(await handlePlan(post({ action: "build", input: BASE_INPUT }), deps));
  return lines.at(-1)!["session"] as PlanSession;
}
const revise = (session: unknown, itemId: string, deps = makeDeps()) =>
  handlePlan(post({ action: "revise", session, feedback: { itemId, action: "replace", reason: "too_far" } }), deps);

describe("POST /api/plan", () => {
  it("streams each step as it completes, then a signed session", async () => {
    const response = await handlePlan(post({ action: "build", input: BASE_INPUT }), makeDeps());
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = await ndjson(response);
    expect(lines.filter((l) => l.type === "step").map((l) => (l["step"] as { id: string }).id)).toEqual([
      "resolve_interests", "discover_places", "apply_constraints", "construct_plan", "explain",
    ]);
    const session = lines.at(-1)!["session"] as PlanSession;
    expect(session.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySession(session, SECRET)).toBe(true);
  });

  it("revises a signed session and returns a newly signed one", async () => {
    const session = await build();
    const response = await revise(session, session.plan.stages.first_week[0]!.id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { session: PlanSession; revision: { appliedConstraint: { kind: string } } };
    expect(body.revision.appliedConstraint.kind).toBe("radius");
    expect(verifySession(body.session, SECRET)).toBe(true);
    expect(body.session.signature).not.toBe(session.signature);
  });

  it("rejects a session with an edited place, an injected place, edited text, or no signature (400 bad_session)", async () => {
    const session = await build();
    const id = session.plan.stages.first_week[0]!.id;
    const entity = session.plan.stages.first_week[0]!.qlooEntityId;

    const renamed = structuredClone(session);
    renamed.candidates[entity]!.name = "Invented Place";
    const injected = structuredClone(session);
    injected.candidates["fake-id"] = { ...injected.candidates[entity]!, qlooEntityId: "fake-id", name: "Fake" };
    const reworded = structuredClone(session);
    reworded.plan.stages.first_week[0]!.why = "A 99% match";
    const priced = structuredClone(session);
    priced.candidates[entity]!.priceLevel = (priced.candidates[entity]!.priceLevel ?? 0) === 4 ? 3 : 4;
    const unsigned = structuredClone(session);
    delete unsigned.signature;
    const forged = { ...structuredClone(session), signature: "0".repeat(64) };

    for (const tampered of [renamed, injected, reworded, priced, unsigned, forged]) {
      const response = await revise(tampered, id);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ kind: "bad_session" });
    }
  });

  it("allows saving (a browser-only change) without breaking the signature", async () => {
    const session = await build();
    const id = session.plan.stages.first_week[0]!.id;
    const saved = setSaved(session, id, true);
    expect(verifySession(saved, SECRET)).toBe(true);
    expect((await revise(saved, session.plan.stages.first_month[0]!.id)).status).toBe(200);
  });

  it("a session signed with a different secret is rejected", async () => {
    const session = await build();
    expect(verifySession(signSession(session, "another-secret-value-123"), SECRET)).toBe(false);
  });

  it("returns an error line (not a 500) when the build fails midway", async () => {
    const raw = { ...largeRaw() } as Record<string, unknown[] | Error>;
    for (const key of Object.keys(raw)) raw[key] = new QlooError("rate_limit", "slow", { status: 429 });
    const lines = await ndjson(await handlePlan(post({ action: "build", input: BASE_INPUT }), makeDeps({}, {}, raw)));
    expect(lines.at(-1)).toMatchObject({ type: "error", kind: "rate_limit", retryable: false });
  });

  it("rejects bad JSON, bad shape and unsupported input before calling Qloo", async () => {
    expect((await handlePlan(post("not json"), makeDeps())).status).toBe(400);
    expect((await handlePlan(post({ action: "build", input: { ...BASE_INPUT, interests: [] } }), makeDeps())).status).toBe(400);
    expect((await handlePlan(post({ action: "nope" }), makeDeps())).status).toBe(400);
  });

  it("answers 503 without leaking details when the key or secret is not configured", async () => {
    const noKey = makeDeps({ client: () => { throw new ConfigError("QLOO_API_KEY is not set."); } });
    const response = await handlePlan(post({ action: "build", input: BASE_INPUT }), noKey);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("QLOO_API_KEY");
    const noSecret = makeDeps({ sessionSecret: () => { throw new ConfigError("Set SESSION_SECRET"); } });
    expect((await handlePlan(post({ action: "build", input: BASE_INPUT }), noSecret)).status).toBe(503);
  });
});

describe("usage protection", () => {
  it("limits builds per visitor with Retry-After, without affecting other visitors", async () => {
    const deps = makeDeps({}, { RATE_LIMIT_BUILDS_PER_MIN: "2" });
    const ip = { "x-forwarded-for": "1.2.3.4" };
    expect((await handlePlan(post({ action: "build", input: BASE_INPUT }, ip), deps)).status).toBe(200);
    expect((await handlePlan(post({ action: "build", input: BASE_INPUT }, ip), deps)).status).toBe(200);
    const third = await handlePlan(post({ action: "build", input: BASE_INPUT }, ip), deps);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await third.json()).toMatchObject({ kind: "rate_limit", retryable: false });
    expect((await handlePlan(post({ action: "build", input: BASE_INPUT }, { "x-forwarded-for": "5.6.7.8" }), deps)).status).toBe(200);
  });

  it("revisions and interest lookups have their own limits", async () => {
    const deps = makeDeps({}, { RATE_LIMIT_LOOKUPS_PER_MIN: "1", RATE_LIMIT_REVISIONS_PER_MIN: "1" });
    expect((await handleInterest(post({ text: "ramen" }), deps)).status).not.toBe(429);
    expect((await handleInterest(post({ text: "ramen" }), deps)).status).toBe(429);
    expect((await handlePlan(post({ action: "revise", session: {}, feedback: {} }), deps)).status).toBe(400);
    expect((await handlePlan(post({ action: "revise", session: {}, feedback: {} }), deps)).status).toBe(429);
  });

  it("a global cap protects the Qloo key even when every visitor is under their own limit", async () => {
    const deps = makeDeps({}, { RATE_LIMIT_GLOBAL_BUILDS_PER_MIN: "2" });
    const codes: number[] = [];
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      codes.push((await handlePlan(post({ action: "build", input: BASE_INPUT }, { "x-forwarded-for": ip }), deps)).status);
    }
    expect(codes).toEqual([200, 200, 429]);
  });

  it("caps concurrent builds and frees the slot when a build ends", async () => {
    const deps = makeDeps({}, { MAX_CONCURRENT_BUILDS: "1" });
    const held = deps.buildGate.tryAcquire()!;
    const busy = await handlePlan(post({ action: "build", input: BASE_INPUT }), deps);
    expect(busy.status).toBe(429);
    held();
    const ok = await handlePlan(post({ action: "build", input: BASE_INPUT }), deps);
    await ok.text();
    expect(ok.status).toBe(200);
    expect(deps.buildGate.active()).toBe(0);
  });

  it("derives a visitor key from proxy headers and resets after the window", () => {
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
});

describe("session secret", () => {
  it("prefers SESSION_SECRET, rejects a short one, and otherwise derives from the Qloo key", () => {
    expect(readSessionSecret({ SESSION_SECRET: "x".repeat(20), QLOO_API_KEY: "k" })).toBe("x".repeat(20));
    expect(() => readSessionSecret({ SESSION_SECRET: "short" })).toThrow(ConfigError);
    const derived = readSessionSecret({ QLOO_API_KEY: "abc-key" });
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).not.toContain("abc-key");
    expect(readSessionSecret({ QLOO_API_KEY: "abc-key" })).toBe(derived);
    expect(() => readSessionSecret({})).toThrow(ConfigError);
  });
});

describe("POST /api/interests", () => {
  it("resolves aliases and preferences without touching Qloo", async () => {
    const d = makeDeps();
    expect(await (await handleInterest(post({ text: "Korean food" }), d)).json()).toMatchObject({ resolved: { status: "resolved", match: { source: "curated" } } });
    expect(await (await handleInterest(post({ text: "quiet mornings" }), d)).json()).toMatchObject({ resolved: { status: "preference" } });
  });
  it("validates length and surfaces upstream rate limits", async () => {
    expect((await handleInterest(post({ text: "" }), makeDeps())).status).toBe(400);
    expect((await handleInterest(post({ text: "x".repeat(81) }), makeDeps())).status).toBe(400);
    const d = makeDeps({ client: () => fakeClient({}, { tags: async () => { throw new QlooError("rate_limit", "slow", { status: 429 }); } }).client });
    expect((await handleInterest(post({ text: "tapas" }), d)).status).toBe(429);
  });
});
