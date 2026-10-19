import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against the PRODUCTION build (`pnpm build` first) and a local mock of the Qloo API,
 * so they are deterministic and need no key. Four app instances differ only in environment:
 *   4011  main app (mock Qloo, signing secret, generous limits)
 *   4012  no Qloo key configured (503 path)
 *   4013  tight rate limits (throttling path)
 * The suite runs on a desktop and a phone viewport.
 */
const mock = "http://127.0.0.1:4010";
const base = {
  QLOO_BASE_URL: mock,
  GEOCODER_BASE_URL: `${mock}/photon`,
  SESSION_SECRET: "e2e-session-secret-0123456789",
  QLOO_CACHE_TTL_SECONDS: "0",
  GEOCODER_CACHE_TTL_SECONDS: "0",
  IMAGE_VERIFY: "off", // no internet in the tests: the browser-side image host is stubbed instead
  DIAGNOSTICS_ENABLED: "",
};
const generous = {
  RATE_LIMIT_BUILDS_PER_MIN: "1000", RATE_LIMIT_REVISIONS_PER_MIN: "1000", RATE_LIMIT_LOOKUPS_PER_MIN: "1000", RATE_LIMIT_GEOCODE_PER_MIN: "1000",
  RATE_LIMIT_GLOBAL_BUILDS_PER_MIN: "1000", RATE_LIMIT_GLOBAL_LOOKUPS_PER_MIN: "1000", MAX_CONCURRENT_BUILDS: "50",
};
const app = (port: number, env: Record<string, string>) => ({
  command: `pnpm start -p ${port}`,
  url: `http://127.0.0.1:${port}/`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: { ...base, ...env },
});

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 1, // the mock Qloo server is shared state
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4011", trace: "retain-on-failure", launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "desktop-wide", testMatch: /flow\.spec\.ts|a11y\.spec\.ts/, use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: "node e2e/mock-qloo.mjs", url: `${mock}/__health`, reuseExistingServer: false, timeout: 15_000 },
    app(4011, { QLOO_API_KEY: "mock-key", ...generous }),
    app(4012, { QLOO_API_KEY: "", ...generous }),
    app(4013, { QLOO_API_KEY: "mock-key", RATE_LIMIT_BUILDS_PER_MIN: "2", RATE_LIMIT_GLOBAL_BUILDS_PER_MIN: "1000", RATE_LIMIT_LOOKUPS_PER_MIN: "1000", RATE_LIMIT_REVISIONS_PER_MIN: "1000", RATE_LIMIT_GLOBAL_LOOKUPS_PER_MIN: "1000", MAX_CONCURRENT_BUILDS: "50", RATE_LIMIT_GEOCODE_PER_MIN: "3" }),
  ],
});
