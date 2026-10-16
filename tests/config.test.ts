import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_QLOO_BASE_URL, diagnosticsEnabled, readQlooConfig } from "@/lib/config";

describe("readQlooConfig", () => {
  it("throws a helpful error without echoing anything when the key is missing", () => {
    expect(() => readQlooConfig({})).toThrow(ConfigError);
    expect(() => readQlooConfig({ QLOO_API_KEY: "   " })).toThrow(/QLOO_API_KEY is not set/);
  });
  it("defaults to the hackathon base URL and trims trailing slashes", () => {
    expect(readQlooConfig({ QLOO_API_KEY: "k" }).baseUrl).toBe(DEFAULT_QLOO_BASE_URL);
    expect(readQlooConfig({ QLOO_API_KEY: "k", QLOO_BASE_URL: "https://example.test/" }).baseUrl).toBe("https://example.test");
  });
  it("rejects a non-https base URL, except a local mock server", () => {
    expect(() => readQlooConfig({ QLOO_API_KEY: "k", QLOO_BASE_URL: "http://example.test" })).toThrow(ConfigError);
    expect(readQlooConfig({ QLOO_API_KEY: "k", QLOO_BASE_URL: "http://127.0.0.1:4010" }).baseUrl).toBe("http://127.0.0.1:4010");
  });
  it("disables diagnostics in production unless explicitly enabled", () => {
    expect(diagnosticsEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(diagnosticsEnabled({ NODE_ENV: "production", DIAGNOSTICS_ENABLED: "true" })).toBe(true);
    expect(diagnosticsEnabled({ NODE_ENV: "development" })).toBe(true);
  });
});
