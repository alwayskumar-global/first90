import { z } from "zod";
import { feedbackSchema, planSessionSchema, tasteInputSchema } from "@/domain/schemas";
import type { PlanSession } from "@/domain/types";
import type { QlooClient } from "@/lib/qloo/client";
import { resolveInterest } from "@/lib/qloo/resolveInterests";
import { buildPlan, revisePlan, type WorkflowDeps } from "@/lib/agent/workflow";
import type { StepTrace } from "@/lib/agent/trace";
import { describeError, errorResponse } from "./errors";
import { clientKey, type RateLimiter } from "./rateLimit";

export interface PlanApiDeps {
  /** Returns the (cached, paced) Qloo client. Called per request so a missing key becomes a clean 503. */
  client(): QlooClient;
  limiter: RateLimiter;
}

const bad = (message: string, status = 400) =>
  Response.json({ error: message, kind: "bad_request", retryable: false }, { status });

function limited(deps: PlanApiDeps, request: Request): Response | null {
  const check = deps.limiter.check(clientKey(request.headers));
  if (check.ok) return null;
  return Response.json(
    { error: "You're going a little fast. Try again in a moment.", kind: "rate_limit", retryable: false, retryAfterSeconds: check.retryAfterSeconds },
    { status: 429, headers: { "retry-after": String(check.retryAfterSeconds) } },
  );
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
 *  - revise: JSON {session, revision, trace}
 */
export async function handlePlan(request: Request, deps: PlanApiDeps): Promise<Response> {
  const tooFast = limited(deps, request);
  if (tooFast) return tooFast;

  const raw = await readJson(request);
  if (raw === undefined) return bad("Body must be JSON.");
  const parsed = planBodySchema.safeParse(raw);
  if (!parsed.success) return bad("Invalid request.");
  const body = parsed.data;

  let client: QlooClient;
  try {
    client = deps.client();
  } catch (error) {
    return errorResponse(error);
  }

  if (body.action === "revise") {
    try {
      const result = await revisePlan({ client }, body.session as PlanSession, body.feedback);
      return Response.json(result);
    } catch (error) {
      return errorResponse(error);
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      const workflow: WorkflowDeps = { client, onStep: (step: StepTrace) => send({ type: "step", step }) };
      try {
        const result = await buildPlan(workflow, body.input);
        send({ type: "result", ...result });
      } catch (error) {
        send({ type: "error", ...describeError(error).body });
      } finally {
        controller.close();
      }
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
  const tooFast = limited(deps, request);
  if (tooFast) return tooFast;
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
