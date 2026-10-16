"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanItem } from "@/domain/types";
import { allItems } from "@/domain/session";
import { Icon } from "@/components/Icon";
import { Badge, Button, StageNav, STAGES, StateBanner, type StageId } from "@/components/ui";
import { useFlow } from "@/lib/flow/FlowProvider";
import { areaText, choicesText, rangeText, unsearchedShort } from "@/lib/flow/summary";
import { CATEGORY_ICON, CATEGORY_LABEL, ROUTINE_BLURB, connectedInterests, distanceText } from "./placeView";
import { ReplaceDialog } from "./ReplaceDialog";

const STAGE_COPY: Record<StageId, { n: number; intro: string; next: StageId | null }> = {
  week: { n: 1, intro: "Start small and close to home. Two or three easy places are enough.", next: "month" },
  month: { n: 2, intro: "Settle into a few places you can return to.", next: "later" },
  later: { n: 3, intro: "Make a few of them yours, and widen out a little.", next: null },
};

const label = (font: string) => ({ font, letterSpacing: ".08em", textTransform: "uppercase" as const, color: "var(--text-muted)" });

export function Plan() {
  const router = useRouter();
  const { state, dispatch } = useFlow();
  const { session } = state;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [replacing, setReplacing] = useState<string | null>(null);

  useEffect(() => {
    if (state.hydrated && !session) router.replace("/");
  }, [state.hydrated, session, router]);

  if (!session) {
    return (
      <div className="f90-page">
        <main id="main" className="f90-wrap"><p role="status" style={{ color: "var(--text-muted)" }}>Loading your plan…</p></main>
      </div>
    );
  }

  const stage = STAGES.find((s) => s.id === state.stage) ?? STAGES[0]!;
  const copy = STAGE_COPY[stage.id];
  const items = session.plan.stages[stage.key];
  const next = copy.next ? STAGES.find((s) => s.id === copy.next) : null;
  const saved = allItems(session).filter((item) => item.status === "saved");
  const flagged = new Set(session.outOfLimitItemIds);
  const replacingItem: PlanItem | undefined = replacing ? allItems(session).find((item) => item.id === replacing) : undefined;
  const interests = state.anchors;
  const unsearchedText = unsearchedShort(interests);

  return (
    <div className="f90-page">
      <header style={{ maxWidth: 1120, margin: "0 auto", padding: "clamp(16px,2.4vw,24px) clamp(16px,3vw,32px) 0", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, font: "500 22px/1 var(--font-sans)", letterSpacing: "-.01em" }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--evergreen-500)" }} />First 90 Days
        </span>
        <Button variant="secondary" iconLeft="pencil" onClick={() => router.push("/preferences")}>Edit preferences</Button>
      </header>

      <main id="main" style={{ maxWidth: 1120, margin: "0 auto", padding: "clamp(20px,3vw,36px) clamp(16px,3vw,32px) clamp(32px,6vw,80px)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 10px", font: "500 14px/1.3 var(--font-sans)", color: "var(--text-secondary)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="map-pin" size={16} />{areaText(state)}</span>
          <span aria-hidden="true" style={{ color: "var(--stone-300)" }}>·</span><span>{rangeText(state)}</span>
          <span aria-hidden="true" style={{ color: "var(--stone-300)" }}>·</span>
          {interests.slice(0, 3).map((a) => (
            <span key={a.input} style={{ font: "500 13px/1 var(--font-sans)", background: "var(--bg-raised)", boxShadow: "var(--shadow-1)", padding: "8px 12px", borderRadius: 999, color: "var(--text-primary)" }}>{a.name}</span>
          ))}
          {interests.length > 3 ? <span style={{ fontSize: 13 }}>+{interests.length - 3} more</span> : null}
        </div>

        <div style={{ marginTop: "clamp(20px,3vw,32px)", maxWidth: 680 }}>
          <h1 style={{ margin: 0, font: "400 clamp(2.125rem,4.8vw,3.25rem)/1.06 var(--font-serif)", letterSpacing: "-.022em", textWrap: "balance" }}>Your first 90 days in Raleigh</h1>
          <p style={{ margin: "16px 0 0", font: "400 clamp(1.0625rem,1.6vw,1.1875rem)/1.6 var(--font-sans)", color: "var(--text-secondary)", textWrap: "pretty" }}>Start with a few easy places. Keep what fits, and change what doesn’t.</p>
        </div>

        <div className="f90-plan-grid">
          <div style={{ minWidth: 0 }}>
            <div style={{ position: "sticky", top: 0, zIndex: 6, background: "var(--bg-page)", padding: "8px 0 12px" }}>
              <StageNav current={stage.id} reviewed={state.reviewed.filter((v) => v !== stage.id)} onSelect={(id) => dispatch({ type: "setStage", stage: id })} />
            </div>

            <section aria-labelledby="stage-h" style={{ marginTop: "clamp(16px,2.4vw,28px)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 14px" }}>
                <h2 id="stage-h" style={{ margin: 0, font: "400 clamp(1.75rem,3.2vw,2.25rem)/1.15 var(--font-serif)", letterSpacing: "-.015em" }}>{stage.label}</h2>
                <span style={label("600 12px/1.3 var(--font-sans)")}>{`Stage ${copy.n} of 3 · ${stage.range}`}</span>
              </div>
              <p style={{ margin: "8px 0 0", font: "400 16px/1.55 var(--font-sans)", color: "var(--text-secondary)" }}>{copy.intro}</p>

              <div style={{ marginTop: "clamp(20px,3vw,32px)", display: "flex", flexDirection: "column", gap: "clamp(28px,4vw,40px)" }}>
                {items.map((item, index) => {
                  const candidate = session.candidates[item.qlooEntityId];
                  if (!candidate) return null;
                  const isSaved = item.status === "saved";
                  const isOpen = !!open[item.id];
                  const justChanged = state.lastChange?.itemId === item.id;
                  const interestsUsed = connectedInterests(item, candidate, session);
                  return (
                    <article key={item.id} aria-labelledby={`h-${item.id}`} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <header style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                        <span aria-hidden="true" style={{ flex: "none", width: 44, height: 44, borderRadius: 12, background: "var(--ivory-200)", color: "var(--ink-800)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon name={CATEGORY_ICON[item.category]} size={20} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px" }}>
                            <h3 id={`h-${item.id}`} style={{ margin: 0, font: "500 clamp(1.1875rem,2vw,1.375rem)/1.3 var(--font-sans)", letterSpacing: "-.01em" }}>{item.routine}</h3>
                            {stage.id === "week" && index === 0 ? (
                              <span style={{ font: "600 11px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--evergreen-700)", background: "var(--evergreen-50)", border: "1px solid var(--evergreen-200)", padding: "5px 9px", borderRadius: 999 }}>Start here</span>
                            ) : null}
                          </div>
                          <p style={{ margin: "4px 0 0", font: "400 15px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>{ROUTINE_BLURB[item.category]}</p>
                        </div>
                      </header>

                      {justChanged && state.lastChange ? (
                        <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "6px 12px", background: "var(--evergreen-50)", border: "1px solid var(--evergreen-200)", borderRadius: 12, padding: "6px 8px 6px 16px", font: "400 14px/1.45 var(--font-sans)", color: "var(--text-primary)" }}>
                          <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 10 }}>
                            <span style={{ color: "var(--evergreen-600)", display: "inline-flex", marginTop: 2 }}><Icon name="circle-check" size={18} /></span>
                            <span>
                              <b style={{ fontWeight: 600 }}>Updated based on your feedback.</b> We swapped in a different place. {state.lastChange.message}.
                              {state.lastChange.limitation ? <span style={{ display: "block", color: "var(--text-secondary)", marginTop: 2 }}>{state.lastChange.limitation}</span> : null}
                            </span>
                          </span>
                          <Button variant="text" aria-label={`Undo replacing ${candidate.name}`} onClick={() => dispatch({ type: "undoRevision" })}>Undo</Button>
                        </div>
                      ) : null}

                      <div className={`f90-place${isSaved ? " f90-place--saved" : ""}`}>
                        <div className="f90-place__tile">
                          <span className="f90-place__tile-ico"><Icon name={CATEGORY_ICON[item.category]} size={20} /></span>
                          {CATEGORY_LABEL[item.category]}
                        </div>
                        <div className="f90-place__body" style={{ minWidth: 0 }}>
                          <div className="f90-place__meta">
                            <span><Icon name="map-pin" size={15} />{distanceText(candidate, session)}</span>
                          </div>
                          <h4 className="f90-place__name">{candidate.name}</h4>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            <Badge tone="check">Check current details</Badge>
                            {isSaved ? <Badge tone="verified" icon="bookmark-check">Saved</Badge> : null}
                            {flagged.has(item.id) ? <Badge tone="danger" icon="circle-alert">Outside your new limit</Badge> : null}
                          </div>
                          <p className="f90-why" style={{ margin: 0 }}>
                            <span className="f90-why__label">Why this fits</span>
                            <span>{item.why}</span>
                          </p>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 }}>
                            <Button variant="secondary" iconRight={isOpen ? "chevron-down" : "chevron-right"} aria-expanded={isOpen} aria-label={`View details for ${candidate.name}`} onClick={() => setOpen((o) => ({ ...o, [item.id]: !o[item.id] }))}>View details</Button>
                            <Button variant="secondary" iconLeft={isSaved ? "bookmark-check" : "bookmark"} aria-pressed={isSaved} aria-label={`${isSaved ? "Saved: " : "Save "}${candidate.name}`} onClick={() => dispatch({ type: "toggleSaved", itemId: item.id, saved: !isSaved })}>{isSaved ? "Saved" : "Save"}</Button>
                            <Button variant="text" iconLeft="repeat" aria-label={`Replace ${candidate.name}`} onClick={() => setReplacing(item.id)}>Replace</Button>
                          </div>
                          {isOpen ? (
                            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10, font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>
                              <div>
                                <span style={label("600 11px/1.3 var(--font-sans)")}>Connects to</span>
                                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {interestsUsed.length > 0 ? (
                                    interestsUsed.map((name) => (
                                      <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "500 13px/1 var(--font-sans)", color: "var(--evergreen-700)", background: "var(--evergreen-50)", border: "1px solid var(--evergreen-200)", padding: "7px 11px", borderRadius: 999 }}>
                                        <Icon name="check" size={14} strokeWidth={2.25} />{name}
                                      </span>
                                    ))
                                  ) : (
                                    <span>Matched by category and distance only. Qloo returned no taste ranking for it.</span>
                                  )}
                                </div>
                              </div>
                              <div>
                                <span style={label("600 11px/1.3 var(--font-sans)")}>Still to check</span>
                                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                                  {item.notices.map((notice) => <li key={notice}>{notice}</li>)}
                                </ul>
                              </div>
                              <div><Button variant="primary" iconRight="arrow-right" aria-label={`See full details for ${candidate.name}`} onClick={() => router.push(`/plan/${encodeURIComponent(item.id)}`)}>See full details</Button></div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}

                {items.length < 3 ? (
                  <StateBanner tone="partial" icon="circle-alert" title={items.length === 0 ? "Nothing to show for this stage" : "Fewer suggestions than expected"}>
                    <p className="f90-state__body">
                      {items.length === 0 ? "We couldn’t confirm any places for this stage." : `We could confirm ${items.length === 1 ? "one place" : `${items.length} places`} for this stage.`} We’d rather show fewer than guess. Widening your search area may bring more.
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                      <Button variant="secondary" onClick={() => router.push("/location")}>Broaden my search area</Button>
                      <Button variant="text" onClick={() => router.push("/preferences")}>Edit preferences</Button>
                    </div>
                  </StateBanner>
                ) : null}
              </div>

              <div style={{ marginTop: "clamp(32px,5vw,48px)", background: "var(--stone-100)", borderRadius: 20, padding: "clamp(20px,3vw,28px)", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ minWidth: 0, maxWidth: 420 }}>
                  <div style={label("600 11px/1.3 var(--font-sans)")}>{next ? "Up next" : "You’ve seen the whole plan"}</div>
                  <div style={{ marginTop: 6, font: "400 clamp(1.375rem,2.4vw,1.625rem)/1.2 var(--font-serif)" }}>{next ? next.label : "Keep what fits, change what doesn’t"}</div>
                  <p style={{ margin: "6px 0 0", font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>
                    {next ? STAGE_COPY[next.id].intro : "You can replace any suggestion or update your preferences whenever you like."}
                  </p>
                </div>
                {next ? (
                  <Button variant="primary" size="lg" iconRight="arrow-right" onClick={() => dispatch({ type: "setStage", stage: next.id })}>{`Go to ${next.label}`}</Button>
                ) : (
                  <Button variant="secondary" size="lg" onClick={() => dispatch({ type: "setStage", stage: "week" })}>Back to First Week</Button>
                )}
              </div>
            </section>
          </div>

          <aside aria-label="Your preferences" className="f90-sticky-aside" style={{ minWidth: 0 }}>
            <div style={{ background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(18px,2.4vw,24px)", boxShadow: "var(--shadow-1)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h2 style={{ margin: 0, font: "500 18px/1.3 var(--font-sans)" }}>Your preferences</h2>
                <Button variant="text" iconLeft="pencil" aria-label="Edit preferences" onClick={() => router.push("/preferences")}>Edit</Button>
              </div>
              <dl style={{ margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 14, font: "400 14px/1.5 var(--font-sans)" }}>
                <div><dt style={label("600 11px/1.3 var(--font-sans)")}>Area</dt><dd style={{ margin: "4px 0 0", fontWeight: 500 }}>{areaText(state)} {"·"} {rangeText(state)}</dd></div>
                <div>
                  <dt style={label("600 11px/1.3 var(--font-sans)")}>Interests</dt>
                  <dd style={{ margin: "8px 0 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {interests.map((a) => <span key={a.input} style={{ font: "500 13px/1 var(--font-sans)", background: "var(--stone-100)", padding: "7px 11px", borderRadius: 999 }}>{a.name}</span>)}
                  </dd>
                </div>
                {unsearchedText ? (
                  <div><dt style={label("600 11px/1.3 var(--font-sans)")}>Not searched</dt><dd style={{ margin: "4px 0 0", color: "var(--text-secondary)" }}>{unsearchedText}</dd></div>
                ) : null}
                <div><dt style={label("600 11px/1.3 var(--font-sans)")}>Preferences</dt><dd style={{ margin: "4px 0 0", fontWeight: 500 }}>{choicesText(state.prefs)}</dd></div>
              </dl>
            </div>

            <div style={{ marginTop: 14, background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(18px,2.4vw,24px)", boxShadow: "var(--shadow-1)" }}>
              <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 10, font: "500 18px/1.3 var(--font-sans)" }}>
                <span style={{ color: "var(--evergreen-600)", display: "inline-flex" }}><Icon name="bookmark" size={20} /></span>
                Saved <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>({saved.length})</span>
              </h2>
              {saved.length > 0 ? (
                <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {saved.map((item) => {
                    const c = session.candidates[item.qlooEntityId];
                    return c ? (
                      <li key={item.id} style={{ font: "500 14px/1.4 var(--font-sans)", display: "flex", flexDirection: "column" }}>
                        <span>{c.name}</span>
                        <span style={{ font: "400 13px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{CATEGORY_LABEL[item.category]} · {distanceText(c, session)}</span>
                      </li>
                    ) : null;
                  })}
                </ul>
              ) : (
                <p style={{ margin: "10px 0 0", font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>Nothing saved yet. Save anything you’d like to keep as you go.</p>
              )}
            </div>

            {session.notes.length > 0 || session.plan.constraints.length > 0 ? (
              <div style={{ marginTop: 14, background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(18px,2.4vw,24px)", boxShadow: "var(--shadow-1)" }}>
                <h2 style={{ margin: 0, font: "500 18px/1.3 var(--font-sans)" }}>How we read your answers</h2>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8, font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>
                  {session.notes.map((note) => <li key={note}>{note}</li>)}
                  {session.plan.constraints.filter((c) => c.kind !== "exclude_entity").map((c) => <li key={c.label + (c.sourceItemId ?? "")}>{c.label}.</li>)}
                </ul>
              </div>
            ) : null}

            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <Button variant="text" iconLeft="refresh-cw" onClick={() => { dispatch({ type: "reset" }); router.push("/"); }}>Start over</Button>
              <p style={{ margin: "0 4px", font: "400 12px/1.5 var(--font-sans)", color: "var(--text-muted)" }}>
                Places and details come from Qloo. We haven’t confirmed hours, prices or availability, so check current details before you go.
              </p>
            </div>
          </aside>
        </div>
      </main>

      {replacingItem && session.candidates[replacingItem.qlooEntityId] ? (
        <ReplaceDialog
          session={session}
          item={replacingItem}
          candidate={session.candidates[replacingItem.qlooEntityId]!}
          onClose={() => setReplacing(null)}
          onReplaced={(nextSession, revision, message) => {
            dispatch({ type: "applyRevision", session: nextSession, itemId: revision.addedItemId ?? replacingItem.id, message, ...(revision.limitation ? { limitation: revision.limitation } : {}) });
            setReplacing(null);
          }}
        />
      ) : null}
    </div>
  );
}
