import "server-only";

export const DEFAULT_QLOO_BASE_URL = "https://hackathon.api.qloo.com";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface QlooConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * Read Qloo settings from the environment at call time (never at import time,
 * so `next build` and CI work without a key). The error message never includes
 * the key value.
 */
export function readQlooConfig(env: Record<string, string | undefined> = process.env): QlooConfig {
  const apiKey = env.QLOO_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      "QLOO_API_KEY is not set. Copy .env.example to .env.local and add the event-issued key.",
    );
  }
  const baseUrl = (env.QLOO_BASE_URL?.trim() || DEFAULT_QLOO_BASE_URL).replace(/\/+$/, "");
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") throw new Error("not https");
  } catch {
    throw new ConfigError("QLOO_BASE_URL must be a valid https URL.");
  }
  return { apiKey, baseUrl };
}

export function diagnosticsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.DIAGNOSTICS_ENABLED === "true";
}
