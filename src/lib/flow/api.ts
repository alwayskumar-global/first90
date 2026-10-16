import type { Feedback, PlanRevision, PlanSession, ResolvedInterest, TasteInput } from "@/domain/types";
import type { StepTrace } from "@/lib/agent/trace";

export class ApiError extends Error {
  readonly kind: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  constructor(body: { error?: string; kind?: string; retryable?: boolean; retryAfterSeconds?: number }) {
    super(body.error ?? "Something went wrong.");
    this.name = "ApiError";
    this.kind = body.kind ?? "internal";
    this.retryable = body.retryable ?? true;
    if (body.retryAfterSeconds !== undefined) this.retryAfterSeconds = body.retryAfterSeconds;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    return new ApiError(await response.json());
  } catch {
    return new ApiError({ error: "Something went wrong.", kind: "internal", retryable: true });
  }
}

/** Read an NDJSON response body line by line. Exported for tests. */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as Record<string, unknown>;
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest) as Record<string, unknown>;
}

export interface BuildResult {
  session: PlanSession;
  trace: StepTrace[];
}

/** Build a plan; `onStep` fires as each workflow step completes. */
export async function buildPlanRequest(
  input: TasteInput,
  onStep: (step: StepTrace) => void,
  signal?: AbortSignal,
): Promise<BuildResult> {
  let response: Response;
  try {
    response = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "build", input }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({ error: "We couldn't reach the server.", kind: "network", retryable: true });
  }
  if (!response.ok || !response.body) throw await parseError(response);
  for await (const line of readNdjson(response.body)) {
    if (line["type"] === "step") onStep(line["step"] as StepTrace);
    else if (line["type"] === "result") return { session: line["session"] as PlanSession, trace: line["trace"] as StepTrace[] };
    else if (line["type"] === "error") throw new ApiError(line as { error?: string });
  }
  throw new ApiError({ error: "The connection ended before your plan was ready.", kind: "network", retryable: true });
}

export interface ReviseResult {
  session: PlanSession;
  revision: PlanRevision;
}

export async function reviseRequest(session: PlanSession, feedback: Feedback): Promise<ReviseResult> {
  let response: Response;
  try {
    response = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "revise", session, feedback }),
    });
  } catch {
    throw new ApiError({ error: "We couldn't reach the server.", kind: "network", retryable: true });
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as ReviseResult;
}

export async function resolveInterestRequest(text: string, signal?: AbortSignal): Promise<ResolvedInterest> {
  let response: Response;
  try {
    response = await fetch("/api/interests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({ error: "We couldn't reach the server.", kind: "network", retryable: true });
  }
  if (!response.ok) throw await parseError(response);
  return ((await response.json()) as { resolved: ResolvedInterest }).resolved;
}
