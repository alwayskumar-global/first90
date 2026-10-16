import { describe, expect, it } from "vitest";
import { QlooError } from "@/lib/qloo/errors";
import { validatePlaceInsightsParams, wktPoint } from "@/lib/qloo/validate";

const ok = {
  "filter.type": "urn:entity:place",
  "filter.location": "POINT(-78.6382 35.7796)",
  "filter.location.radius": 15000,
  "filter.tags": "urn:tag:category:place:cafe",
};

const kindOf = (params: Parameters<typeof validatePlaceInsightsParams>[0]) => {
  try {
    validatePlaceInsightsParams(params);
    return "ok";
  } catch (e) {
    return (e as QlooError).kind;
  }
};

describe("place insights parameter validation", () => {
  it("accepts a valid request", () => expect(kindOf(ok)).toBe("ok"));
  it("rejects other entity types", () => expect(kindOf({ ...ok, "filter.type": "urn:entity:movie" })).toBe("invalid_request"));
  it("rejects parameters Qloo would silently ignore", () => expect(kindOf({ ...ok, "bias.trends": "high" })).toBe("invalid_request"));
  it("requires a radius with a location (Qloo returns nothing otherwise)", () =>
    expect(kindOf({ ...ok, "filter.location.radius": undefined })).toBe("invalid_request"));
  it("requires at least one signal or filter tag", () =>
    expect(kindOf({ "filter.type": "urn:entity:place", "filter.location": "x", "filter.location.radius": 1 })).toBe("invalid_request"));
  it("bounds take", () => {
    expect(kindOf({ ...ok, take: 51 })).toBe("invalid_request");
    expect(kindOf({ ...ok, take: 0 })).toBe("invalid_request");
    expect(kindOf({ ...ok, take: 20 })).toBe("ok");
  });
  it("bounds price level", () => expect(kindOf({ ...ok, "filter.price_level.max": 9 })).toBe("invalid_request"));
  it("ignores undefined values", () => expect(kindOf({ ...ok, "signal.interests.entities": undefined })).toBe("ok"));
  it("formats WKT with longitude first", () => expect(wktPoint({ lat: 35.7796, lon: -78.6382 })).toBe("POINT(-78.6382 35.7796)"));
});
