import { NextResponse, type NextRequest } from "next/server";
import { feedbackSchema, planSessionSchema, tasteInputSchema } from "@/domain/schemas";
import { diagnosticsEnabled, ConfigError, readQlooConfig } from "@/lib/config";
import { FeedbackError } from "@/lib/agent/revise";
import { evaluateSession } from "@/lib/agent/rubric";
import { runScenarios } from "@/lib/agent/scenarios";
import { buildPlan, revisePlan, WorkflowError, type WorkflowDeps } from "@/lib/agent/workflow";
import { withCache, sharedCache } from "@/lib/qloo/cache";
import { createQlooClient } from "@/lib/qloo/client";
import { QlooError } from "@/lib/qloo/errors";

/**
 * Plan engine diagnostics (Milestone 2). Gated like the M1 diagnostics: on in
 * development, 404 in production unless DIAGNOSTICS_ENABLED=true. The M3 UI
 * will call the same workflow functions through its own routes.
 *
 *   GET  ?scenarios=1                            run the three live demo scenarios, return a rubric report
 *   POST { action: "build", input }              -> { session, trace, rubric }
 *   POST { action: "revise", session, feedback } -> { session, revision, trace, rubric }
 */
function deps(): WorkflowDeps {
  // Paced: the scenario runner makes ~30 requests in one go and a burst tripped Qloo's rate limit.
  return { client: withCache(createQlooClient({ ...readQlooConfig(), minIntervalMs: 400 }), sharedCache()) };
}

function errorResponse(error: unknown) {
  if (error instanceof ConfigError) return NextResponse.json({ error: error.message }, { status: 503 });
  if (error instanceof WorkflowError) {
    return NextResponse.json(
      { error: error.message, kind: error.kind, retryable: error.retryable },
      { status: error.kind === "invalid_input" ? 400 : 502 },
    );
  }
  if (error instanceof FeedbackError) return NextResponse.json({ error: error.message, kind: "bad_feedback" }, { status: 400 });
  if (error instanceof QlooError) {
    const status = error.kind === "rate_limit" ? 429 : error.kind === "invalid_request" ? 400 : 502;
    return NextResponse.json(
      { error: error.message, kind: error.kind, retryable: error.retryable, retryAfterSeconds: error.retryAfterSeconds },
      { status },
    );
  }
  return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (!diagnosticsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.nextUrl.searchParams.get("scenarios") !== "1") {
    return NextResponse.json({ error: "Use ?scenarios=1 or POST." }, { status: 400 });
  }
  try {
    return NextResponse.json(await runScenarios(deps()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!diagnosticsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const action = (body as { action?: unknown } | null)?.action;
  try {
    if (action === "build") {
      const input = tasteInputSchema.safeParse((body as { input?: unknown }).input);
      if (!input.success) {
        return NextResponse.json({ error: "Invalid input.", issues: input.error.issues.slice(0, 5) }, { status: 400 });
      }
      const result = await buildPlan(deps(), input.data);
      return NextResponse.json({ ...result, rubric: evaluateSession(result.session) });
    }
    if (action === "revise") {
      const session = planSessionSchema.safeParse((body as { session?: unknown }).session);
      const feedback = feedbackSchema.safeParse((body as { feedback?: unknown }).feedback);
      if (!session.success || !feedback.success) {
        return NextResponse.json({ error: "Invalid session or feedback." }, { status: 400 });
      }
      const result = await revisePlan(deps(), session.data, feedback.data);
      return NextResponse.json({ ...result, rubric: evaluateSession(result.session) });
    }
    return NextResponse.json({ error: 'action must be "build" or "revise".' }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
