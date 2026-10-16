import type { ZodType } from "zod";
import { QlooError } from "./errors";
import {
  insightsResponseSchema,
  searchResponseSchema,
  tagsResponseSchema,
} from "./schemas";
import { validatePlaceInsightsParams, type QlooParams } from "./validate";

export interface QlooClientOptions {
  apiKey: string;
  baseUrl: string;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Extra attempts for timeouts, network errors and 5xx. Never used for 429 or 4xx. */
  maxRetries?: number;
  /**
   * Minimum gap between request starts (ms), to stay under Qloo's rate limit
   * during bursts such as the diagnostic scenario runner. 0 disables pacing.
   */
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface QlooClient {
  search(query: string, opts?: { types?: string; take?: number }): Promise<unknown[]>;
  tags(query: string, opts?: { take?: number }): Promise<unknown[]>;
  placeInsights(params: QlooParams): Promise<unknown[]>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function toSearchParams(params: QlooParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  return search;
}

export function createQlooClient(options: QlooClientOptions): QlooClient {
  const {
    apiKey,
    baseUrl,
    timeoutMs = 15_000,
    maxRetries = 2,
    minIntervalMs = 0,
    fetchImpl = fetch,
    sleep = defaultSleep,
    now = Date.now,
  } = options;

  let nextSlot = 0;
  async function pace(): Promise<void> {
    if (minIntervalMs <= 0) return;
    const current = now();
    const start = Math.max(current, nextSlot);
    nextSlot = start + minIntervalMs; // reserve the slot synchronously so concurrent callers queue up
    if (start > current) await sleep(start - current);
  }

  async function attempt(url: string): Promise<Response> {
    await pace();
    try {
      return await fetchImpl(url, {
        method: "GET",
        // The key lives only in this header. It is never put in a URL, a log
        // line or an error message.
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new QlooError("timeout", `Qloo request timed out after ${timeoutMs} ms.`);
      }
      throw new QlooError("network", "Could not reach Qloo.");
    }
  }

  async function request<T>(path: string, params: QlooParams, schema: ZodType<T>): Promise<T> {
    const url = `${baseUrl}${path}?${toSearchParams(params).toString()}`;
    let lastError: QlooError | undefined;

    for (let n = 0; n <= maxRetries; n++) {
      if (n > 0) await sleep(250 * 2 ** (n - 1));
      let response: Response;
      try {
        response = await attempt(url);
      } catch (error) {
        lastError = error as QlooError;
        continue; // timeout / network: retry within the bound
      }

      const status = response.status;
      if (status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        throw new QlooError("rate_limit", "Qloo rate limit reached. Try again shortly.", {
          status,
          ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
        });
      }
      if (status === 401 || status === 403) {
        throw new QlooError(
          "auth",
          "Qloo rejected the credentials or request type (check QLOO_API_KEY and QLOO_BASE_URL).",
          { status },
        );
      }
      if (status === 404) {
        throw new QlooError("not_found", "Qloo endpoint not found.", { status });
      }
      if (status >= 500) {
        lastError = new QlooError("server", `Qloo returned a server error (${status}).`, { status });
        continue;
      }
      if (status >= 400) {
        throw new QlooError("bad_request", `Qloo rejected the request (${status}).`, { status });
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new QlooError("invalid_response", "Qloo response was not valid JSON.", { status });
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new QlooError("invalid_response", "Qloo response did not have the expected shape.", {
          status,
        });
      }
      return parsed.data;
    }
    throw lastError ?? new QlooError("network", "Could not reach Qloo.");
  }

  return {
    async search(query, opts = {}) {
      const data = await request(
        "/search",
        { query, types: opts.types, take: opts.take },
        searchResponseSchema,
      );
      return data.results;
    },
    async tags(query, opts = {}) {
      const data = await request(
        "/v2/tags",
        { "filter.query": query, take: opts.take ?? 8 },
        tagsResponseSchema,
      );
      return data.results.tags;
    },
    async placeInsights(params) {
      validatePlaceInsightsParams(params);
      const data = await request("/v2/insights", params, insightsResponseSchema);
      return data.results.entities;
    },
  };
}
