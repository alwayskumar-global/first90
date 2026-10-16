import { ConfigError } from "@/lib/config";
import { FeedbackError } from "@/lib/agent/revise";
import { WorkflowError } from "@/lib/agent/workflow";
import { QlooError } from "@/lib/qloo/errors";

export interface ApiErrorBody {
  error: string;
  kind: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

/** Map any thrown error to a safe, user-presentable body and HTTP status. Never includes secrets or raw payloads. */
export function describeError(error: unknown): { status: number; body: ApiErrorBody } {
  if (error instanceof ConfigError) {
    return { status: 503, body: { error: "The service is not configured yet.", kind: "not_configured", retryable: false } };
  }
  if (error instanceof WorkflowError) {
    return {
      status: error.kind === "invalid_input" ? 400 : 502,
      body: { error: error.message, kind: error.kind, retryable: error.retryable },
    };
  }
  if (error instanceof FeedbackError) {
    return { status: 400, body: { error: error.message, kind: "bad_feedback", retryable: false } };
  }
  if (error instanceof QlooError) {
    const status = error.kind === "rate_limit" ? 429 : error.kind === "invalid_request" ? 400 : 502;
    return {
      status,
      body: {
        error: error.message,
        kind: error.kind,
        retryable: error.retryable,
        ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      },
    };
  }
  return { status: 500, body: { error: "Unexpected server error.", kind: "internal", retryable: true } };
}

export const errorResponse = (error: unknown) => {
  const { status, body } = describeError(error);
  return Response.json(body, { status });
};
