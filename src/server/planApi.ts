import { z } from "zod";
import { feedbackSchema, planSessionSchema, tasteInputSchema } from "@/domain/schemas";
import type { PlanSession } from "@/domain/types";
import type { QlooClient } from "@/lib/qloo/client";
import { resolveInterest } from "@/lib/qloo/resolveInterests";
import { buildPlan, revisePlan, type WorkflowDeps } from "@/lib/agent/workflow";
import type { StepTrace } from "@/lib/agent/trace";
import { describeError, errorResponse } from "./errors";
import { createGate, type Limits } from "./limits";
import { clientKey, type RateLimiter } from "./rateLimit";
import { signSession, verifySession } from "./sessionSigning";

export interface PlanApiDeps {
  /** Returns the (cached, paced) Qloo client. Called per request so a missing key becomes a clean 503. */
  client(): QlooClient;
  limits: Limits;
  /** HMAC secret for session signing. Called per request so a missing secret becomes a clean 503. */
  sessionSecret(): string;
  /** Shared across requests; created once by the runtime. */
  buildGate: ReturnType<typeof createGate>;
}

const bad = (message: string, kind = "bad_request", status = 400) =>
  Response.json({ error: message, kind, retryable: false }, { status });

function tooFast(retryAfterSeconds: number, message = "You’re going a little fast. Try again in a moment.") {
  return Response.json(
    { error: message, kind: "rate_limit", retryable: false, retryAfterSeconds },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

/** Check a per-visitor limiter, then a global one. Returns a 429 response, or null when allowed. */
function limited(request: Request, perVisitor: RateLimiter, global: RateLimiter): Response | null {
  const visitor = perVisitor.check(clientKey(request.headers));
  if (!visitor.ok) return tooFast(visitor.retryAfterSeconds);
  const all = global.check("all");
  if (!all.ok) return tooFast(all.retryAfterSeconds, "We’re busy right now. Try again in a moment.");
  return null;
}

async function readJson(request: Request): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const planBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("build"), input: tasteInputSchema }),
  z.object({ action: z.literal("revise"), session: planSessionSchema, feedback: feedbackSchema }),
]);

/**
 * POST /api/plan
 *  - build:  streams NDJSON: {type:"step",step} ... then {type:"result",session,trace} or {type:"error",...}
 *  - revise: JSON {session, revision, trace}; the session must carry the server's signature (else 400 bad_session)
 * Every returned session is signed.
 */
export async function handlePlan(request: Request, deps: PlanApiDeps): Promise<Response> {
  const raw = await readJson(request);
  if (raw === undefined) return bad("Body must be JSON.");
  const action = (raw as { action?: unknown } | null)?.action;
  const blocked =
    action === "revise"
      ? limited(request, deps.limits.revise, deps.limits.globalLookups)
      : limited(request, deps.limits.build, deps.limits.globalBuild);
  if (blocked) return blocked;

  const parsed = planBodySchema.safeParse(raw);
  if (!parsed.success) return bad("Invalid request.");
  const body = parsed.data;

  let client: QlooClient;
  let secret: string;
  try {
    client = deps.client();
    secret = deps.sessionSecret();
  } catch (error) {
    return errorResponse(error);
  }

  if (body.action === "revise") {
    const session = body.session as PlanSession;
    if (!verifySession(session, secret)) {
      return bad("This plan can’t be verified. Start over to build a new one.", "bad_session");
    }
    try {
      const result = await revisePlan({ client }, session, body.feedback);
      return Response.json({ ...result, session: signSession(result.session, secret) });
    } catch (error) {
      return errorResponse(error);
    }
  }

  const release = deps.buildGate.tryAcquire();
  if (!release) return tooFast(5, "We’re busy right now. Try again in a moment.");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      const workflow: WorkflowDeps = { client, onStep: (step: StepTrace) => send({ type: "step", step }) };
      try {
        const result = await buildPlan(workflow, body.input);
        send({ type: "result", ...result, session: signSession(result.session, secret) });
      } catch (error) {
        send({ type: "error", ...describeError(error).body });
      } finally {
        release();
        controller.close();
      }
    },
    cancel() {
      release();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

const interestBodySchema = z.object({
  text: z.string().trim().min(1).max(80),
  confirmedId: z.string().max(200).optional(),
});

/** POST /api/interests: resolve one free-text interest (preference, alias, Qloo tag or named entity). */
export async function handleInterest(request: Request, deps: PlanApiDeps): Promise<Response> {
  const blocked = limited(request, deps.limits.interests, deps.limits.globalLookups);
  if (blocked) return blocked;
  const raw = await readJson(request);
  if (raw === undefined) return bad("Body must be JSON.");
  const parsed = interestBodySchema.safeParse(raw);
  if (!parsed.success) return bad("Enter between 1 and 80 characters.");
  try {
    const resolved = await resolveInterest(deps.client(), parsed.data.text, parsed.data.confirmedId);
    return Response.json({ resolved });
  } catch (error) {
    return errorResponse(error);
  }
}
