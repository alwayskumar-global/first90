import { createHmac, timingSafeEqual } from "node:crypto";
import { ConfigError } from "@/lib/config";
import type { PlanSession } from "@/domain/types";
import { STAGE_KEYS } from "@/domain/types";

/**
 * A plan session round-trips through the browser (the app keeps no database), so the server signs every
 * session it returns and rejects any session whose signature does not match. That makes the place facts
 * in a session (names, addresses, prices, Qloo entity IDs) tamper-evident: a visitor cannot edit a
 * candidate or inject a place and have the server treat it as Qloo data.
 *
 * Item `status` (saved / suggested) is the one thing the browser changes without calling the server, so it
 * is normalized out of the signed payload.
 */

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}

export function canonicalSession(session: PlanSession): string {
  const copy = structuredClone(session) as PlanSession;
  delete copy.signature;
  for (const stage of STAGE_KEYS) for (const item of copy.plan.stages[stage]) item.status = "suggested";
  return JSON.stringify(sortKeys(copy));
}

const mac = (session: PlanSession, secret: string) => createHmac("sha256", secret).update(canonicalSession(session)).digest("hex");

export function signSession(session: PlanSession, secret: string): PlanSession {
  return { ...session, signature: mac(session, secret) };
}

export function verifySession(session: PlanSession, secret: string): boolean {
  const given = session.signature;
  if (typeof given !== "string" || given.length !== 64 || !/^[0-9a-f]+$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(mac(session, secret), "hex"));
}

/**
 * SESSION_SECRET if set (recommended; at least 16 characters). Otherwise a key is derived from the Qloo key,
 * so a deployment with only QLOO_API_KEY still verifies sessions. Never logged or returned.
 */
export function readSessionSecret(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SESSION_SECRET?.trim();
  if (explicit) {
    if (explicit.length < 16) throw new ConfigError("SESSION_SECRET must be at least 16 characters.");
    return explicit;
  }
  const qloo = env.QLOO_API_KEY?.trim();
  if (!qloo) throw new ConfigError("Set SESSION_SECRET (or QLOO_API_KEY) to sign sessions.");
  return createHmac("sha256", qloo).update("first90:session-signing:v1").digest("hex");
}
