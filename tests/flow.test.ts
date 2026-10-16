import { describe, expect, it } from "vitest";
import { NEIGHBORHOODS, SEARCH_SCOPES } from "@/domain/demo";
import { allItems, findItem, setSaved } from "@/domain/session";
import { buildPlan } from "@/lib/agent/workflow";
import { ApiError, readNdjson } from "@/lib/flow/api";
import { buildTasteInput, selectCategories } from "@/lib/flow/input";
import { anchorFromMatch, anchorFromPreference, anchorOwnWords, outcomeFromResolved, tagKindLabel, unsearchedAnchors } from "@/lib/flow/labels";
import { flowReducer, initialState, MAX_ANCHORS, sampleAnchors } from "@/lib/flow/state";
import { areaText, choicesText, rangeText, ROUTINE_CARDS, unsearchedNote, unsearchedShort } from "@/lib/flow/summary";
import type { FlowState } from "@/lib/flow/types";
import { BASE_INPUT, fakeClient, largeRaw } from "./helpers";

const sample = (): FlowState => flowReducer(initialState, { type: "loadSample" });

describe("TasteInput from the setup answers", () => {
  it("builds the demo persona: all four categories, 15 km, no ceiling, atmosphere from the interest", () => {
    const input = buildTasteInput(sample());
    expect(input).toMatchObject({
      interests: ["indie bookstores", "Korean food", "coffee shops", "quiet mornings"],
      areaKey: "raleigh-nc",
      radiusMeters: SEARCH_SCOPES.city.radiusMeters,
      categories: ["cafe", "bookstore", "korean_restaurant", "museum"],
      atmosphere: "no_preference",
    });
    expect(input.neighborhoodKey).toBeUndefined();
    expect(input.maxPriceLevel).toBeUndefined();
  });

  it("uses the chosen neighborhood, scope, atmosphere and a budget ceiling", () => {
    let state = sample();
    state = flowReducer(state, { type: "setNeighborhood", key: "five-points" });
    state = flowReducer(state, { type: "setScope", scope: "nearby" });
    state = flowReducer(state, { type: "setAtmosphere", value: "quiet" });
    state = flowReducer(state, { type: "setBudget", value: "budget" });
    expect(buildTasteInput(state)).toMatchObject({ neighborhoodKey: "five-points", radiusMeters: 5_000, atmosphere: "quiet", maxPriceLevel: 2 });
    expect(NEIGHBORHOODS["five-points"].name).toBe("Five Points");
  });

  it("only 'Budget-friendly' sets a ceiling; skipping or other choices set none", () => {
    for (const value of ["flex", "more", "none"] as const) {
      expect(buildTasteInput(flowReducer(sample(), { type: "setBudget", value })).maxPriceLevel).toBeUndefined();
    }
    const skipped = flowReducer(flowReducer(sample(), { type: "setBudget", value: "budget" }), { type: "skip", field: "budget", skipped: true });
    expect(buildTasteInput(skipped).maxPriceLevel).toBeUndefined();
  });

  it("'Nearby' needs a neighborhood: not-sure falls back to the whole city", () => {
    const state = flowReducer(flowReducer(initialState, { type: "setScope", scope: "nearby" }), { type: "setUnsure" });
    expect(state.area.scope).toBe("city");
    expect(buildTasteInput({ ...state, anchors: sampleAnchors() }).radiusMeters).toBe(15_000);
  });

  it("maps routines to categories, adds categories the interests name, and defaults to all four", () => {
    const base = { ...sample(), anchors: [anchorOwnWords("zines")] };
    expect(selectCategories(base)).toEqual(["cafe", "bookstore", "korean_restaurant", "museum"]);
    const work = flowReducer(base, { type: "toggleRoutine", routine: "work" });
    expect(selectCategories(work)).toEqual(["cafe", "bookstore"]);
    expect(selectCategories({ ...work, anchors: sampleAnchors() })).toEqual(["cafe", "bookstore", "korean_restaurant"]);
    const skipped = flowReducer(work, { type: "skip", field: "routines", skipped: true });
    expect(selectCategories(skipped)).toHaveLength(4);
  });

  it("sends confirmations only for interests the user picked from several matches", () => {
    const confirmed = anchorFromMatch("Haruki Murakami", { kind: "entity", id: "E-author", name: "Haruki Murakami", type: "urn:entity:author", source: "qloo" }, "confirmed");
    const state = flowReducer(sample(), { type: "addAnchor", anchor: confirmed });
    expect(buildTasteInput(state).confirmations).toEqual({ "Haruki Murakami": "E-author" });
    expect(confirmed.type).toBe("Author");
  });

  it("the built input is accepted by the engine", async () => {
    const { session } = await buildPlan({ client: fakeClient(largeRaw()).client }, buildTasteInput(sample()));
    expect(allItems(session).length).toBeGreaterThan(0);
  });
});

describe("flow reducer", () => {
  it("changing any answer discards the built plan", async () => {
    const { session } = await buildPlan({ client: fakeClient(largeRaw()).client }, BASE_INPUT);
    const withPlan = flowReducer(sample(), { type: "setSession", session });
    expect(withPlan.session).not.toBeNull();
    expect(flowReducer(withPlan, { type: "setScope", scope: "flexible" }).session).toBeNull();
    expect(flowReducer(withPlan, { type: "removeAnchor", input: "Korean food" }).session).toBeNull();
  });

  it("caps interests at five, ignores duplicates, and removes by text", () => {
    let state = sample();
    state = flowReducer(state, { type: "addAnchor", anchor: anchorOwnWords("KOREAN FOOD") });
    expect(state.anchors).toHaveLength(4);
    state = flowReducer(state, { type: "addAnchor", anchor: anchorOwnWords("zines") });
    state = flowReducer(state, { type: "addAnchor", anchor: anchorOwnWords("one more") });
    expect(state.anchors).toHaveLength(MAX_ANCHORS);
    expect(flowReducer(state, { type: "removeAnchor", input: "zines" }).anchors).toHaveLength(MAX_ANCHORS - 1);
  });

  it("save toggles one item; undo restores the plan from before a replacement", async () => {
    const { session } = await buildPlan({ client: fakeClient(largeRaw()).client }, BASE_INPUT);
    const id = allItems(session)[0]!.id;
    let state = flowReducer(sample(), { type: "setSession", session });
    state = flowReducer(state, { type: "toggleSaved", itemId: id, saved: true });
    expect(findItem(state.session!, id)!.status).toBe("saved");
    const changed = setSaved(state.session!, id, false);
    state = flowReducer(state, { type: "applyRevision", session: changed, itemId: id, message: "x" });
    expect(state.lastChange?.itemId).toBe(id);
    state = flowReducer(state, { type: "undoRevision" });
    expect(findItem(state.session!, id)!.status).toBe("saved");
    expect(state.lastChange).toBeNull();
  });

  it("setSaved changes only the chosen item and leaves the input untouched", async () => {
    const { session } = await buildPlan({ client: fakeClient(largeRaw()).client }, BASE_INPUT);
    const [first, ...rest] = allItems(session);
    const next = setSaved(session, first!.id, true);
    expect(allItems(next).slice(1)).toEqual(rest);
    expect(session.plan.stages.first_week[0]!.status).toBe("suggested"); // original not mutated
  });

  it("tracks reviewed stages and resets everything on start over", () => {
    let state = sample();
    state = flowReducer(state, { type: "setStage", stage: "month" });
    expect(state.reviewed).toEqual(["week"]);
    expect(flowReducer(state, { type: "reset" })).toMatchObject({ anchors: [], session: null, stage: "week", hydrated: true });
  });
});

describe("labels and summaries", () => {
  it("turns each resolution outcome into what the interests screen shows", () => {
    expect(outcomeFromResolved({ status: "preference", input: "quiet mornings", preference: { atmosphere: "quiet", morning: true } })).toMatchObject({ status: "single", option: { type: "Preference" } });
    expect(outcomeFromResolved({ status: "unmatched", input: "zzz" })).toEqual({ status: "unmatched" });
    const ambiguous = outcomeFromResolved({
      status: "ambiguous",
      input: "Dune",
      matches: [
        { kind: "entity", id: "1", name: "Dune", type: "urn:entity:book", source: "qloo" },
        { kind: "entity", id: "2", name: "Dune", type: "urn:entity:movie", source: "qloo" },
      ],
    });
    expect(ambiguous.status === "ambiguous" && ambiguous.options.map((o) => o.label)).toEqual(["Dune · Book", "Dune · Film"]);
    expect(anchorFromPreference("quiet mornings").kind).toBe("preference");
  });

  it("describes the area, range and choices in plain words", () => {
    const state = flowReducer(flowReducer(sample(), { type: "setNeighborhood", key: "cameron" }), { type: "setScope", scope: "flexible" });
    expect(areaText(state)).toBe("Cameron Village, Raleigh");
    expect(rangeText(state)).toBe("Flexible");
    expect(areaText(sample())).toBe("All of Raleigh, NC");
    expect(choicesText(initialState.prefs)).toContain("optional");
    expect(choicesText(flowReducer(sample(), { type: "toggleRoutine", routine: "arts" }).prefs)).toBe("1 routine");
  });
});

describe("streaming client", () => {
  const streamOf = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
        controller.close();
      },
    });

  it("reassembles NDJSON lines split across chunks", async () => {
    const lines: unknown[] = [];
    for await (const line of readNdjson(streamOf(['{"a":1}\n{"b"', ':2}\n', '{"c":3}']))) lines.push(line);
    expect(lines).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("carries error details", () => {
    const error = new ApiError({ error: "slow", kind: "rate_limit", retryable: false, retryAfterSeconds: 9 });
    expect(error).toMatchObject({ kind: "rate_limit", retryable: false, retryAfterSeconds: 9, message: "slow" });
  });
});

describe("ambiguous choices the user can tell apart", () => {
  const tag = (id: string) => ({ kind: "tag" as const, id, name: "Library", source: "qloo" as const });

  it("labels same-named Qloo tags by what kind of tag they are", () => {
    expect(tagKindLabel("urn:tag:category:place:library")).toBe("Kind of place");
    expect(tagKindLabel("urn:tag:genre:place:library")).toBe("Place style");
    expect(tagKindLabel("urn:tag:genre:place:restaurant:library")).toBe("Restaurant style");
    expect(tagKindLabel("urn:tag:genre:place:hotel:library")).toBe("Hotel style");
    expect(tagKindLabel("urn:tag:amenity:qloo:library")).toBe("Amenity");
    expect(tagKindLabel("urn:tag:something:else")).toBeNull();
  });

  it("shows four distinct chips for 'library', never four identical ones", () => {
    const outcome = outcomeFromResolved({
      status: "ambiguous",
      input: "library",
      matches: ["category:place:library", "genre:place:library", "genre:place:restaurant:library", "genre:place:hotel:library"].map((id) => tag(`urn:tag:${id}`)),
    });
    expect(outcome.status).toBe("ambiguous");
    if (outcome.status !== "ambiguous") return;
    const labels = outcome.options.map((o) => o.label);
    expect(new Set(labels).size).toBe(4);
    expect(labels).toContain("Library · Kind of place");
    expect(labels).toContain("Library · Restaurant style");
  });

  it("collapses choices that stay identical, and resolves when only one is left", () => {
    const dupes = { status: "ambiguous" as const, input: "x", matches: [tag("urn:tag:mystery:a"), tag("urn:tag:mystery:b")] };
    const outcome = outcomeFromResolved(dupes);
    expect(outcome.status).toBe("single");
  });
});

describe("interests the demo cannot search (CR-008)", () => {
  const japanese = anchorFromMatch("Japanese Food", { kind: "tag", id: "urn:tag:genre:place:restaurant:japanese_food", name: "Japanese Food", source: "qloo" }, "confirmed");
  const korean = sampleAnchors().find((a) => a.input === "Korean food")!;
  const author = anchorFromMatch("Haruki Murakami", { kind: "entity", id: "00000000-0000-4000-8000-000000000001", name: "Haruki Murakami", type: "urn:entity:author", source: "qloo" }, "resolved");
  const jazz = anchorFromMatch("Jazz", { kind: "tag", id: "urn:tag:genre:music:jazz", name: "Jazz", source: "qloo" }, "resolved");

  it("flags place and cuisine tags outside the four categories, and nothing else", () => {
    expect(unsearchedAnchors([japanese]).map((a) => a.input)).toEqual(["Japanese Food"]);
    expect(unsearchedAnchors([korean, author, jazz, anchorFromPreference("quiet mornings"), anchorOwnWords("zzqx")])).toEqual([]);
    expect(unsearchedAnchors(sampleAnchors())).toEqual([]); // the demo persona is fully searchable
  });

  it("explains what the demo covers, honestly, for one or several interests", () => {
    expect(unsearchedNote([japanese])).toContain("“Japanese Food” isn’t one of this demo’s place types (cafés, bookstores, Korean restaurants, and museums)");
    expect(unsearchedNote([japanese])).toContain("won’t add suggestions of its own");
    const ramen = anchorFromMatch("Ramen", { kind: "tag", id: "urn:tag:genre:place:restaurant:ramen", name: "Ramen", source: "qloo" }, "resolved");
    expect(unsearchedNote([japanese, ramen])).toContain("“Japanese Food”, “Ramen” aren’t");
    expect(unsearchedNote([korean])).toBeNull();
    expect(unsearchedShort([japanese])).toBe("Japanese Food: taste signal only. This demo covers cafés, bookstores, Korean restaurants, and museums.");
    expect(unsearchedShort([korean])).toBeNull();
  });

  it("an unsearched interest adds no category of its own", () => {
    const state: FlowState = { ...sample(), anchors: [japanese] };
    expect(selectCategories(state)).toEqual(["cafe", "bookstore", "korean_restaurant", "museum"]); // no routine chosen: all four
    expect(buildTasteInput(state).interests).toEqual(["Japanese Food"]); // still sent as a taste signal
  });

  it("each routine card says what it covers in this demo", () => {
    expect(Object.fromEntries(ROUTINE_CARDS.map((r) => [r.id, r.covers]))).toEqual({
      work: "cafés and bookstores", meals: "Korean restaurants", weekend: "museums and bookstores", arts: "museums and cultural venues",
    });
  });
});
