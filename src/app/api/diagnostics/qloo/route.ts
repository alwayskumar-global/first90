import { NextResponse, type NextRequest } from "next/server";
import { DEMO_AREA, isCategoryKey } from "@/domain/demo";
import { diagnosticsEnabled, readQlooConfig, ConfigError } from "@/lib/config";
import { createQlooClient } from "@/lib/qloo/client";
import { discoverPlaces } from "@/lib/qloo/discoverPlaces";
import { QlooError } from "@/lib/qloo/errors";
import { resolveInterest } from "@/lib/qloo/resolveInterests";

/**
 * Diagnostic only (Milestone 1): proves server-side Qloo access works without
 * exposing the key. Disabled in production unless DIAGNOSTICS_ENABLED=true.
 *   GET /api/diagnostics/qloo?category=cafe          -> up to 5 normalized places
 *   GET /api/diagnostics/qloo?interest=indie%20books -> interest resolution
 */
export async function GET(request: NextRequest) {
  if (!diagnosticsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const client = createQlooClient(readQlooConfig());
    const { searchParams } = request.nextUrl;
    const interest = searchParams.get("interest");
    if (interest) {
      return NextResponse.json({ resolved: await resolveInterest(client, interest) });
    }

    const category = searchParams.get("category") ?? "cafe";
    if (!isCategoryKey(category)) {
      return NextResponse.json({ error: `Unknown category "${category}".` }, { status: 400 });
    }
    const result = await discoverPlaces(client, {
      category,
      center: DEMO_AREA.center,
      radiusMeters: DEMO_AREA.defaultRadiusMeters,
      take: 5,
    });
    return NextResponse.json({
      category,
      count: result.candidates.length,
      dropped: result.dropped,
      warnings: result.warnings,
      candidates: result.candidates,
    });
  } catch (error) {
    if (error instanceof ConfigError) return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof QlooError) {
      const status = error.kind === "rate_limit" ? 429 : error.kind === "invalid_request" ? 400 : 502;
      return NextResponse.json({ error: error.message, kind: error.kind }, { status });
    }
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
