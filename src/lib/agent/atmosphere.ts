import type { PlaceCandidate } from "@/domain/types";

/**
 * Atmosphere and routine signals, read only from Qloo's structured tags on a
 * result (ambience, noise level, time-of-day fit). Vocabulary was taken from
 * live Raleigh results; values are matched case-insensitively and reported
 * back verbatim.
 */
const QUIET_AMBIENCE = new Set(["quiet", "relaxing", "peaceful", "serene", "cozy", "calm", "laid back", "homey", "comforting"]);
const LIVELY_AMBIENCE = new Set(["lively", "social", "high energy", "energetic", "fast paced", "chaotic", "stimulating"]);
const MORNING_TIMES = new Set(["morning", "early morning"]);

const lower = (value: string) => value.trim().toLowerCase();

/** Tags that point to a quiet-leaning place (verbatim). */
export function quietSignals(candidate: PlaceCandidate): string[] {
  const { ambience, noiseLevel } = candidate.atmosphere;
  const tags = ambience.filter((tag) => QUIET_AMBIENCE.has(lower(tag)));
  if (noiseLevel && lower(noiseLevel) === "quiet") tags.unshift(noiseLevel);
  return tags;
}

/** Tags that point to a loud or lively place (verbatim). */
export function livelySignals(candidate: PlaceCandidate): string[] {
  const { ambience, noiseLevel } = candidate.atmosphere;
  const tags = ambience.filter((tag) => LIVELY_AMBIENCE.has(lower(tag)));
  if (noiseLevel && lower(noiseLevel) === "loud") tags.unshift(noiseLevel);
  return tags;
}

export function morningSignals(candidate: PlaceCandidate): string[] {
  return candidate.atmosphere.timeOfDay.filter((tag) => MORNING_TIMES.has(lower(tag)));
}

/** True when Qloo returned no noise or ambience data at all for the place. */
export function lacksAtmosphereData(candidate: PlaceCandidate): boolean {
  return candidate.atmosphere.ambience.length === 0 && !candidate.atmosphere.noiseLevel;
}

/** -1 (lively/loud) .. +1 (quiet); 0 when Qloo gives no usable signal. */
export function quietScore(candidate: PlaceCandidate): number {
  const { noiseLevel } = candidate.atmosphere;
  const quietAmbience = candidate.atmosphere.ambience.filter((tag) => QUIET_AMBIENCE.has(lower(tag))).length;
  const livelyAmbience = candidate.atmosphere.ambience.filter((tag) => LIVELY_AMBIENCE.has(lower(tag))).length;
  const positive = (noiseLevel && lower(noiseLevel) === "quiet" ? 0.5 : 0) + Math.min(0.5, 0.25 * quietAmbience);
  const negative = (noiseLevel && lower(noiseLevel) === "loud" ? 0.5 : 0) + Math.min(0.5, 0.25 * livelyAmbience);
  return positive - negative;
}
