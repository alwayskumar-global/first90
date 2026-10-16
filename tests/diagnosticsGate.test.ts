import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as planGet, POST as planPost } from "@/app/api/diagnostics/plan/route";
import { GET as qlooGet } from "@/app/api/diagnostics/qloo/route";
import { NextRequest } from "next/server";

afterEach(() => vi.unstubAllEnvs());
const req = (path: string, init?: { method?: string; body?: string }) => new NextRequest(`http://x.test${path}`, init);

describe("diagnostics routes in production", () => {
  it("return 404 unless DIAGNOSTICS_ENABLED=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DIAGNOSTICS_ENABLED", "");
    expect((await planGet(req("/api/diagnostics/plan?scenarios=1"))).status).toBe(404);
    expect((await planPost(req("/api/diagnostics/plan", { method: "POST", body: "{}" }))).status).toBe(404);
    expect((await qlooGet(req("/api/diagnostics/qloo?category=cafe"))).status).toBe(404);
  });

  it("are reachable in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await planGet(req("/api/diagnostics/plan"))).status).toBe(400); // reachable, asks for ?scenarios=1
  });
});
