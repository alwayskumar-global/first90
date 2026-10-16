import { describe, expect, it, vi } from "vitest";
import { createQlooClient } from "@/lib/qloo/client";
import { QlooError } from "@/lib/qloo/errors";
import { insightsBody, jsonResponse, rawPlace, TEST_KEY, tagsBody } from "./fixtures/qloo";

const baseUrl = "https://hackathon.api.qloo.com";
const placeParams = {
  "filter.type": "urn:entity:place",
  "filter.tags": "urn:tag:category:place:cafe",
};

function client(fetchImpl: typeof fetch, extra: { maxRetries?: number } = {}) {
  return createQlooClient({ apiKey: TEST_KEY, baseUrl, fetchImpl, sleep: async () => {}, ...extra });
}

describe("qloo client", () => {
  it("sends the key only in the X-Api-Key header, never in the URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(insightsBody([rawPlace()])));
    await client(fetchImpl as unknown as typeof fetch).placeInsights(placeParams);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://hackathon.api.qloo.com/v2/insights?");
    expect(url).not.toContain(TEST_KEY);
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe(TEST_KEY);
  });

  it("maps 401 to an auth error that does not contain the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const error = await client(fetchImpl as unknown as typeof fetch)
      .placeInsights(placeParams)
      .catch((e) => e);
    expect(error).toBeInstanceOf(QlooError);
    expect(error.kind).toBe("auth");
    expect(JSON.stringify({ message: error.message, ...error })).not.toContain(TEST_KEY);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry on auth
  });

  it("does not retry 429 and surfaces Retry-After", async () => {
    const fetchImpl = vi.fn(async () => new Response("slow down", { status: 429, headers: { "retry-after": "7" } }));
    const error = await client(fetchImpl as unknown as typeof fetch)
      .placeInsights(placeParams)
      .catch((e) => e);
    expect(error.kind).toBe("rate_limit");
    expect(error.retryAfterSeconds).toBe(7);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx within the bound, then fails as retryable", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));
    const error = await client(fetchImpl as unknown as typeof fetch, { maxRetries: 2 })
      .placeInsights(placeParams)
      .catch((e) => e);
    expect(error.kind).toBe("server");
    expect(error.retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("recovers when a retry succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(insightsBody([rawPlace()])));
    const result = await client(fetchImpl as unknown as typeof fetch).placeInsights(placeParams);
    expect(result).toHaveLength(1);
  });

  it("maps a timeout to a timeout error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const error = await client(fetchImpl as unknown as typeof fetch, { maxRetries: 0 })
      .placeInsights(placeParams)
      .catch((e) => e);
    expect(error.kind).toBe("timeout");
  });

  it("maps a network failure to a network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await client(fetchImpl as unknown as typeof fetch, { maxRetries: 0 })
      .placeInsights(placeParams)
      .catch((e) => e);
    expect(error.kind).toBe("network");
  });

  it("rejects non-JSON and wrong-shape 200 responses as invalid_response", async () => {
    const notJson = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect((await client(notJson as unknown as typeof fetch).placeInsights(placeParams).catch((e) => e)).kind).toBe(
      "invalid_response",
    );
    const wrongShape = vi.fn(async () => jsonResponse({ success: true, results: {} }));
    expect(
      (await client(wrongShape as unknown as typeof fetch).placeInsights(placeParams).catch((e) => e)).kind,
    ).toBe("invalid_response");
  });

  it("returns an empty list for a valid empty result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(insightsBody([])));
    expect(await client(fetchImpl as unknown as typeof fetch).placeInsights(placeParams)).toEqual([]);
  });

  it("calls /v2/tags with filter.query", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(tagsBody([])));
    await client(fetchImpl as unknown as typeof fetch).tags("jazz");
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("/v2/tags?");
    expect(url).toContain("filter.query=jazz");
  });
});
