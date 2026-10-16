"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { StepHeader, StepTitle } from "@/components/StepHeader";
import { Button } from "@/components/ui";
import { useFlow } from "@/lib/flow/FlowProvider";
import { areaText, ATMOSPHERE_CARDS, BUDGET_CARDS, choicesText, rangeText, ROUTINE_CARDS } from "@/lib/flow/summary";

function onGroupKey(event: KeyboardEvent<HTMLElement>) {
  const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
  if (!delta) return;
  event.preventDefault();
  const group = event.currentTarget.closest("[role=radiogroup]");
  if (!group) return;
  const radios = Array.from(group.querySelectorAll<HTMLElement>("[role=radio]"));
  const next = radios[(radios.indexOf(event.currentTarget) + delta + radios.length) % radios.length];
  next?.focus();
  next?.click();
}

const cardStyle = (on: boolean) => ({
  display: "flex", flexDirection: "column" as const, alignItems: "flex-start", gap: 8, width: "100%", minHeight: 56, textAlign: "left" as const, font: "inherit", color: "inherit", cursor: "pointer",
  padding: on ? "15px 17px" : "16px 18px", borderRadius: 16, border: on ? "2px solid var(--evergreen-500)" : "2px solid transparent",
  background: on ? "var(--evergreen-50)" : "var(--bg-raised)", boxShadow: on ? "none" : "var(--shadow-1)",
});

function SkipRow({ id, children, canSkip, onSkip, hint }: { id: string; children: ReactNode; canSkip: boolean; onSkip: () => void; hint: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "4px 16px" }}>
      <h2 id={id} style={{ margin: 0, font: "500 clamp(1.1875rem,2vw,1.375rem)/1.3 var(--font-sans)", letterSpacing: "-.01em" }}>{children}</h2>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12, font: "400 13px/1.3 var(--font-sans)", color: "var(--text-muted)" }}>
        {hint}
        {canSkip ? <button type="button" className="f90-linkbtn" onClick={onSkip}>Skip</button> : null}
      </span>
    </div>
  );
}

function SkippedNote({ text, onUndo }: { text: string; onUndo: () => void }) {
  return (
    <div role="status" style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px 16px", border: "1px dashed var(--border-default)", borderRadius: 16, padding: "16px 20px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10, font: "400 14px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}><Icon name="info" size={18} />{text}</span>
      <Button variant="text" onClick={onUndo}>Choose instead</Button>
    </div>
  );
}

const check = (on: boolean) =>
  on ? (
    <span style={{ width: 24, height: 24, borderRadius: 7, background: "var(--evergreen-500)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <Icon name="check" size={16} strokeWidth={3} />
    </span>
  ) : (
    <span style={{ width: 24, height: 24, borderRadius: 7, border: "1.5px solid var(--border-control)", background: "var(--bg-raised)" }} />
  );

const radioMark = (on: boolean) =>
  on ? (
    <span style={{ color: "var(--evergreen-600)", display: "inline-flex" }}><Icon name="circle-check" size={22} /></span>
  ) : (
    <span style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", border: "1.5px solid var(--border-control)" }} />
  );

export function Preferences() {
  const router = useRouter();
  const { state, dispatch } = useFlow();
  const { prefs, anchors } = state;
  const shown = anchors.slice(0, 3);

  return (
    <div className="f90-page">
      <main id="main" className="f90-wrap">
        <StepHeader backHref="/interests" step={3} label="Your preferences" />
        <StepTitle title="What would you like more of?" intro="A few practical choices will help us shape places into routines you’ll actually want to try." maxWidth={660} />

        <div className="f90-split">
          <div className="f90-split__form">
            <div style={{ display: "flex", flexDirection: "column", gap: "clamp(28px,3.4vw,40px)" }}>
              <section aria-labelledby="h-routines">
                <SkipRow id="h-routines" hint="Choose any that appeal" canSkip={!prefs.skipped.routines} onSkip={() => dispatch({ type: "skip", field: "routines", skipped: true })}>Routines to build</SkipRow>
                {prefs.skipped.routines ? (
                  <SkippedNote text="Skipped. We’ll include a bit of everything." onUndo={() => dispatch({ type: "skip", field: "routines", skipped: false })} />
                ) : (
                  <div role="group" aria-label="Routines to build" style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,230px),1fr))", gap: 12 }}>
                    {ROUTINE_CARDS.map((routine) => {
                      const on = prefs.routines.includes(routine.id);
                      return (
                        <button key={routine.id} type="button" role="checkbox" aria-checked={on} className="f90-focusable" onClick={() => dispatch({ type: "toggleRoutine", routine: routine.id })} style={cardStyle(on)}>
                          <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                            <span style={{ width: 40, height: 40, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", background: on ? "var(--evergreen-100)" : "var(--ivory-200)", color: on ? "var(--evergreen-700)" : "var(--ink-800)" }}>
                              <Icon name={routine.icon} size={20} />
                            </span>
                            {check(on)}
                          </span>
                          <span style={{ font: "500 16px/1.3 var(--font-sans)" }}>{routine.title}</span>
                          <span style={{ font: "400 14px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{routine.desc}</span>
                          <span style={{ font: "500 13px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>In this demo: {routine.covers}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section aria-labelledby="h-atmos">
                <SkipRow id="h-atmos" hint="Choose one" canSkip={!prefs.skipped.atmosphere} onSkip={() => dispatch({ type: "skip", field: "atmosphere", skipped: true })}>Your preferred atmosphere</SkipRow>
                {prefs.skipped.atmosphere ? (
                  <SkippedNote text="Skipped. We’ll include a mix of calm and lively places." onUndo={() => dispatch({ type: "skip", field: "atmosphere", skipped: false })} />
                ) : (
                  <>
                    <div role="radiogroup" aria-label="Preferred atmosphere" style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,190px),1fr))", gap: 12 }}>
                      {ATMOSPHERE_CARDS.map((option) => {
                        const on = prefs.atmosphere === option.id;
                        return (
                          <button key={option.id} type="button" role="radio" aria-checked={on} className="f90-focusable" onClick={() => dispatch({ type: "setAtmosphere", value: option.id })} onKeyDown={onGroupKey} style={cardStyle(on)}>
                            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
                              <span style={{ font: "500 16px/1.3 var(--font-sans)" }}>{option.title}</span>
                              {radioMark(on)}
                            </span>
                            <span style={{ font: "400 14px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{option.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p style={{ margin: "10px 0 0", font: "400 13px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>This only guides what we suggest. It isn’t a label.</p>
                  </>
                )}
              </section>

              <section aria-labelledby="h-budget">
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "6px 16px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px" }}>
                    <h2 id="h-budget" style={{ margin: 0, font: "500 clamp(1.1875rem,2vw,1.375rem)/1.3 var(--font-sans)", letterSpacing: "-.01em" }}>Dining budget</h2>
                    <span style={{ font: "600 11px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--apricot-700)", background: "var(--apricot-100)", padding: "6px 10px", borderRadius: 999 }}>Dining suggestions only</span>
                  </div>
                  {!prefs.skipped.budget ? <button type="button" className="f90-linkbtn" onClick={() => dispatch({ type: "skip", field: "budget", skipped: true })}>Skip</button> : null}
                </div>
                {prefs.skipped.budget ? (
                  <SkippedNote text="Skipped. We’ll show a range of dining options." onUndo={() => dispatch({ type: "skip", field: "budget", skipped: false })} />
                ) : (
                  <>
                    <div role="radiogroup" aria-label="Dining budget" style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))", gap: 12 }}>
                      {BUDGET_CARDS.map((option) => {
                        const on = prefs.budget === option.id;
                        return (
                          <button key={option.id} type="button" role="radio" aria-checked={on} className="f90-focusable" onClick={() => dispatch({ type: "setBudget", value: option.id })} onKeyDown={onGroupKey} style={{ ...cardStyle(on), flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ font: "500 15px/1.3 var(--font-sans)", textAlign: "left" }}>{option.title}</span>
                            {radioMark(on)}
                          </button>
                        );
                      })}
                    </div>
                    <p style={{ margin: "10px 0 0", font: "400 13px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>
                      “Budget-friendly” keeps priced cafés and restaurants at $$ or below, using the price level Qloo lists. Places with no listed price are marked, not hidden.
                    </p>
                  </>
                )}
              </section>
            </div>
          </div>

          <div className="f90-split__actions">
            <div className="f90-actions-row">
              <Button variant="secondary" size="lg" iconLeft="arrow-left" onClick={() => router.push("/interests")}>Back</Button>
              <Button variant="primary" size="lg" iconRight="arrow-right" onClick={() => router.push("/building")}>Build my plan</Button>
            </div>
            <p style={{ margin: "12px 0 0", display: "flex", alignItems: "center", gap: 8, font: "400 13px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>
              <Icon name="repeat" size={14} />You can replace suggestions and change your preferences later.
            </p>
          </div>

          <aside aria-label="Your plan so far" className="f90-split__aside f90-sticky-aside">
            <div style={{ background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(18px,2.4vw,26px)", boxShadow: "var(--shadow-1)" }}>
              <h2 style={{ margin: 0, font: "500 clamp(1.125rem,2vw,1.25rem)/1.3 var(--font-sans)", letterSpacing: "-.01em" }}>Your plan so far</h2>
              <dl style={{ margin: "6px 0 0", padding: 0 }}>
                {[
                  { term: "Area", value: areaText(state), href: "/location", label: "Edit area" },
                  { term: "Search range", value: rangeText(state), href: "/location", label: "Edit search range" },
                ].map((row) => (
                  <div key={row.term} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "16px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <div style={{ minWidth: 0 }}>
                      <dt style={{ font: "600 11px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{row.term}</dt>
                      <dd style={{ margin: "6px 0 0", font: "500 16px/1.4 var(--font-sans)" }}>{row.value}</dd>
                    </div>
                    <Button variant="text" iconLeft="pencil" aria-label={row.label} onClick={() => router.push(row.href)}>Edit</Button>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "16px 0 4px" }}>
                  <div style={{ minWidth: 0 }}>
                    <dt style={{ font: "600 11px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Interests</dt>
                    <dd style={{ margin: "8px 0 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {shown.map((a) => (
                        <span key={a.input} style={{ font: "500 13px/1 var(--font-sans)", background: "var(--stone-100)", padding: "8px 12px", borderRadius: 999 }}>{a.name}</span>
                      ))}
                      {anchors.length > 3 ? <span style={{ font: "500 13px/1 var(--font-sans)", color: "var(--text-secondary)", padding: "8px 4px" }}>+{anchors.length - 3} more</span> : null}
                    </dd>
                  </div>
                  <Button variant="text" iconLeft="pencil" aria-label="Edit interests" onClick={() => router.push("/interests")}>Edit</Button>
                </div>
              </dl>
            </div>
            <div style={{ marginTop: 12, background: "var(--stone-100)", borderRadius: 16, padding: "16px 20px" }}>
              <div style={{ font: "600 11px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Your choices on this step</div>
              <div style={{ marginTop: 6, font: "400 14px/1.55 var(--font-sans)", color: "var(--text-secondary)" }}>{choicesText(prefs)}</div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
