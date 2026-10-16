import { QlooError } from "./errors";

export type QlooParamValue = string | number | boolean | undefined | null;
export type QlooParams = Record<string, QlooParamValue>;

/**
 * Parameters valid for filter.type=urn:entity:place, from the Qloo
 * "available parameters by entity type" guide, plus feature.explainability
 * (not in the guide's table but verified to work on places in Milestone 0).
 * Qloo silently ignores unsupported parameters, so we reject them locally.
 */
const PLACE_PARAMS = new Set([
  "filter.type",
  "signal.interests.entities",
  "signal.interests.tags",
  "operator.signal.interests.tags",
  "filter.location",
  "filter.location.radius",
  "filter.location.geohash",
  "filter.exclude.location.geohash",
  "filter.price_level.min",
  "filter.price_level.max",
  "filter.price_range.from",
  "filter.price_range.to",
  "filter.tags",
  "operator.filter.tags",
  "filter.exclude.tags",
  "operator.exclude.tags",
  "filter.exclude.entities",
  "filter.external.exists",
  "operator.filter.external.exists",
  "feature.explainability",
  "offset",
  "take",
]);

export const PLACE_TYPE = "urn:entity:place";
export const MAX_TAKE = 50;

/** Throws QlooError("invalid_request") for a request Qloo would ignore or reject. */
export function validatePlaceInsightsParams(params: QlooParams): void {
  const fail = (message: string): never => {
    throw new QlooError("invalid_request", message);
  };

  if (params["filter.type"] !== PLACE_TYPE) {
    fail(`Only filter.type=${PLACE_TYPE} is supported; got ${String(params["filter.type"])}.`);
  }

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (!PLACE_PARAMS.has(key)) fail(`Parameter "${key}" is not supported for ${PLACE_TYPE}.`);
  }

  const has = (key: string) => params[key] !== undefined && params[key] !== null && params[key] !== "";

  if (has("filter.location") && !has("filter.location.radius")) {
    fail("filter.location requires filter.location.radius (Qloo returns no results without it).");
  }
  if (has("filter.location.radius") && !has("filter.location")) {
    fail("filter.location.radius requires filter.location.");
  }
  if (has("take")) {
    const take = Number(params["take"]);
    if (!Number.isInteger(take) || take < 1 || take > MAX_TAKE) {
      fail(`take must be an integer between 1 and ${MAX_TAKE}.`);
    }
  }
  if (!has("signal.interests.entities") && !has("signal.interests.tags") && !has("filter.tags")) {
    fail("At least one of signal.interests.entities, signal.interests.tags or filter.tags is required.");
  }
  const min = params["filter.price_level.min"];
  const max = params["filter.price_level.max"];
  for (const value of [min, max]) {
    if (value !== undefined && value !== null && !(Number(value) >= 1 && Number(value) <= 4)) {
      fail("Price level bounds must be between 1 and 4.");
    }
  }
}

/** WKT point; Qloo expects longitude first. */
export function wktPoint(center: { lat: number; lon: number }): string {
  return `POINT(${center.lon} ${center.lat})`;
}
