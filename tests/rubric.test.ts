import { describe, expect, it } from "vitest";
import type { PlanSession } from "@/domain/types";
import { comparePlans, evaluateSession } from "@/lib/agent/rubric";
import { buildPlan } from "@/lib/agent/workflow";
import { BASE_INPUT, fakeClient, largeRaw } from "./helpers";

async function good(): Promise<PlanSession> {
  return (await buildPlan({ client: fakeClient(largeRaw()).client }, BASE_INPUT)).session;
}
const failing = (session: PlanSession) => evaluateSession(session).checks.filter((c) => !c.pass).map((c) => c.id);

describe("handwritten rubric", () => {
  it("passes a real plan on every check", async () => {
    const report = evaluateSession(await good());
    expect(report.allPass).toBe(true);
    expect(report.total).toBe(15);
  });

  it("flags an ungrounded item (G1)", async () => {
    const session = await good();
    delete session.candidates[session.plan.stages.first_week[0]!.qlooEntityId];
    expect(failing(session)).toContain("G1");
  });

  it("flags probability wording (G3), invented links (G4), and a missing unverified notice (G5)", async () => {
    const a = await good();
    a.plan.stages.first_week[0]!.why = "A 96% match";
    expect(failing(a)).toContain("G3");
    const b = await good();
    b.plan.stages.first_week[0]!.externalUrl = "https://invented.test";
    expect(failing(b)).toContain("G4");
    const c = await good();
    c.plan.stages.first_week[0]!.notices = [];
    expect(failing(c)).toContain("G5");
  });

  it("flags an attribution claim Qloo did not return (G6)", async () => {
    const session = await good();
    session.plan.stages.first_week[0]!.basis = "input_attribution";
    expect(failing(session)).toContain("G6");
  });

  it("flags duplicate places (D1) and an empty stage (D4)", async () => {
    const dup = await good();
    dup.plan.stages.first_month[0] = { ...dup.plan.stages.first_week[0]! };
    expect(failing(dup)).toContain("D1");
    const empty = await good();
    empty.plan.stages.months_2_3 = [];
    expect(failing(empty)).toContain("D4");
  });

  it("flags limit violations that are not flagged for the user (C1, C3, C5), but accepts flagged ones", async () => {
    const session = await good();
    session.plan.input.radiusMeters = 1_000;
    expect(failing(session)).toEqual(expect.arrayContaining(["C5"]));
    session.outOfLimitItemIds = Object.values(session.plan.stages).flat().map((i) => i.id);
    expect(failing(session)).toEqual([]);
    const dismissed = await good();
    dismissed.plan.dismissedEntityIds = [dismissed.plan.stages.first_week[0]!.qlooEntityId];
    expect(failing(dismissed)).toContain("C3");
  });

  it("compares two plans by shared places and category counts", async () => {
    const a = await good();
    expect(comparePlans(a, a)).toMatchObject({ changed: false, onlyInFirst: 0 });
    const b = await good();
    b.plan.stages.first_week = [];
    expect(comparePlans(a, b).changed).toBe(true);
  });
});
