import { describe, expect, it } from "vitest";
import { DEMO_AREA, isInDemoBounds, resolveCenter } from "@/domain/demo";
import { tasteInputSchema } from "@/domain/schemas";
import { buildPlan, validateTasteInput, WorkflowError } from "@/lib/agent/workflow";
import { buildTasteInput } from "@/lib/flow/input";
import { flowReducer, initialState } from "@/lib/flow/state";
import { areaText } from "@/lib/flow/summary";
import type { FlowState } from "@/lib/flow/types";
import { circleRing } from "@/screens/AreaMap";
import { BASE_INPUT, fakeClient, largeRaw } from "./helpers";

const AREA = { lat: 35.79051, lon: -78.67929, label: "Hillsborough Street" };

describe("searched area (CR-007)", () => {
  it("resolveCenter prefers a searched place, then a neighborhood, then downtown", () => {
    expect(resolveCenter("five-points", AREA)).toEqual({ center: { lat: AREA.lat, lon: AREA.lon }, label: "Hillsborough Street" });
    expect(resolveCenter("five-points").label).toBe("Five Points");
    expect(resolveCenter()).toEqual({ center: DEMO_AREA.center, label: DEMO_AREA.centerLabel });
  });

  it("the schema accepts a place in bounds and rejects out-of-bounds points and unsafe labels", () => {
    const parse = (customArea: unknown) => tasteInputSchema.safeParse({ ...BASE_INPUT, customArea }).success;
    expect(parse(AREA)).toBe(true);
    expect(parse({ ...AREA, lat: 35.2271, lon: -80.8431 })).toBe(false); // Charlotte
    expect(parse({ ...AREA, label: "" })).toBe(false);
    expect(parse({ ...AREA, label: "x".repeat(61) })).toBe(false);
    expect(parse({ ...AREA, label: "<script>" })).toBe(false);
    expect(parse({ ...AREA, label: "line\nbreak" })).toBe(false);
    expect(parse({ ...AREA, lat: "35.7" })).toBe(false);
    expect(isInDemoBounds(AREA.lat, AREA.lon)).toBe(true);
  });

  it("the workflow rejects a searched place combined with a neighborhood", () => {
    expect(() => validateTasteInput({ ...BASE_INPUT, neighborhoodKey: "five-points", customArea: AREA })).toThrow(WorkflowError);
  });

  it("builds a plan around the searched point and words distances from its name", async () => {
    const { client, placeInsights } = fakeClient(largeRaw());
    const { session } = await buildPlan({ client }, { ...BASE_INPUT, customArea: AREA });
    expect(session.plan.input.customArea).toEqual(AREA);
    const wording = JSON.stringify(session.plan.stages);
    expect(wording).toContain("from Hillsborough Street");
    const sent = JSON.stringify(placeInsights.mock.calls);
    expect(sent).toContain(String(AREA.lat));
    expect(sent).toContain(String(AREA.lon));
  });

  it("flow state: choosing a place clears a neighborhood and vice versa; the TasteInput carries it", () => {
    let state: FlowState = flowReducer(initialState, { type: "setNeighborhood", key: "five-points" });
    state = flowReducer(state, { type: "setCustomArea", area: AREA });
    expect(state.area).toMatchObject({ neighborhoodKey: null, custom: AREA, unsure: false });
    expect(areaText(state)).toBe("Hillsborough Street, Raleigh area");
    expect(areaText(state, true)).toBe("Hillsborough Street");
    const input = buildTasteInput({ ...state, anchors: [{ input: "coffee", name: "coffee", type: "Place", kind: "own" }] });
    expect(input.customArea).toEqual(AREA);
    expect(input.neighborhoodKey).toBeUndefined();

    state = flowReducer(state, { type: "setNeighborhood", key: "downtown" });
    expect(state.area.custom).toBeNull();
    state = flowReducer(flowReducer(state, { type: "setCustomArea", area: AREA }), { type: "setUnsure" });
    expect(state.area).toMatchObject({ custom: null, unsure: true });
    state = flowReducer(flowReducer(state, { type: "setCustomArea", area: AREA }), { type: "clearArea" });
    expect(state.area.custom).toBeNull();
  });

  it("changing the area invalidates a built plan", () => {
    const withPlan = { ...initialState, session: {} as FlowState["session"] };
    expect(flowReducer(withPlan, { type: "setCustomArea", area: AREA }).session).toBeNull();
  });

  it("hydrating state saved before CR-007 (no `custom`) still works", () => {
    const legacy = { ...initialState, area: { neighborhoodKey: "five-points", unsure: false, scope: "nearby" } } as unknown as FlowState;
    const hydrated = flowReducer(initialState, { type: "hydrate", state: legacy });
    expect(hydrated.area.custom).toBeNull();
    expect(hydrated.area.neighborhoodKey).toBe("five-points");
  });
});

describe("circleRing", () => {
  it("returns a closed ring whose points sit at the requested distance", () => {
    const ring = circleRing({ lat: 35.78, lon: -78.64 }, 5_000, 36);
    expect(ring[0]).toEqual(ring.at(-1));
    for (const [lon, lat] of ring) {
      const dy = (lat - 35.78) * 111_320;
      const dx = (lon + 78.64) * 111_320 * Math.cos((35.78 * Math.PI) / 180);
      expect(Math.hypot(dx, dy)).toBeGreaterThan(4_900);
      expect(Math.hypot(dx, dy)).toBeLessThan(5_100);
    }
  });
});
