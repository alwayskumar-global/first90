import type { InterestPreference } from "@/domain/types";
import { normalizePhrase } from "@/lib/qloo/text";

/**
 * Words that make an interest an atmosphere/routine preference rather than a
 * thing Qloo can resolve ("quiet mornings"). An interest counts as a
 * preference only when EVERY word is one of these, so "morning coffee" is not
 * swallowed (it stays a normal interest).
 */
const QUIET_WORDS = new Set(["quiet", "calm", "peaceful", "relaxed", "slow", "unhurried"]);
const LIVELY_WORDS = new Set(["lively", "energetic", "buzzy", "vibrant"]);
const MORNING_WORDS = new Set(["morning", "early", "sunrise"]);
const FILLER_WORDS = new Set(["and", "a", "the", "my", "in", "on", "weekend", "time", "start", "day", "vibe", "place"]);

export function classifyPreference(input: string): InterestPreference | null {
  const words = normalizePhrase(input).split(" ").filter(Boolean);
  if (words.length === 0) return null;

  const preference: InterestPreference = {};
  for (const word of words) {
    if (QUIET_WORDS.has(word)) preference.atmosphere = "quiet";
    else if (LIVELY_WORDS.has(word)) preference.atmosphere = "lively";
    else if (MORNING_WORDS.has(word)) preference.morning = true;
    else if (!FILLER_WORDS.has(word)) return null;
  }
  return preference.atmosphere || preference.morning ? preference : null;
}

/** True when any interest asks for independent/local shops (used for honest wording only). */
export function mentionsIndependent(interests: string[]): boolean {
  return interests.some((interest) => /\b(indie|independent|local)\b/i.test(interest));
}
