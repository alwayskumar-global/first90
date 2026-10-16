"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, type CategoryKey } from "@/domain/demo";
import { Icon, type IconName } from "@/components/Icon";
import { StepHeader, StepTitle } from "@/components/StepHeader";
import { Badge, Button, Chip, StateBanner } from "@/components/ui";
import { ApiError, resolveInterestRequest } from "@/lib/flow/api";
import { useFlow } from "@/lib/flow/FlowProvider";
import { anchorFromMatch, anchorFromPreference, anchorOwnWords, outcomeFromResolved, type InterestOutcome } from "@/lib/flow/labels";
import { MAX_ANCHORS } from "@/lib/flow/state";
import { unsearchedNote } from "@/lib/flow/summary";
import type { Anchor } from "@/lib/flow/types";

const EXAMPLES: { label: string; make: () => Anchor }[] = [
  { label: "Independent bookstores", make: () => curated("Independent bookstores", "bookstore") },
  { label: "Korean food", make: () => curated("Korean food", "korean_restaurant") },
  { label: "Coffee shops", make: () => curated("Coffee shops", "cafe") },
  { label: "Quiet mornings", make: () => anchorFromPreference("Quiet mornings") },
  { label: "Art museums", make: () => curated("Art museums", "museum") },
];

function curated(input: string, key: CategoryKey): Anchor {
  return anchorFromMatch(input, { kind: "tag", id: CATEGORIES[key].filterTagId, name: CATEGORIES[key].label, source: "curated" }, "resolved");
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Result of the latest lookup, tagged with the text it was for so a stale result is never shown. */
type LookupResult =
  | { kind: "done"; text: string; outcome: InterestOutcome }
  | { kind: "error"; text: string; message: string };

export function Interests() {
  const router = useRouter();
  const { state, dispatch } = useFlow();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const anchors = state.anchors;
  const full = anchors.length >= MAX_ANCHORS;
  const unsearched = unsearchedNote(anchors);
  const q = query.trim();

  // Look the text up (debounced) as the user types. Aliases and preferences resolve without calling Qloo.
  useEffect(() => {
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const resolved = await resolveInterestRequest(q, controller.signal);
        setResult({ kind: "done", text: q, outcome: outcomeFromResolved(resolved) });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({
          kind: "error",
          text: q,
          message: error instanceof ApiError && error.kind === "rate_limit" ? "We’re checking a lot at once. Give it a moment, then try again." : "We couldn’t check that just now. Your list is saved.",
        });
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const current = q.length >= 2 && result?.text === q ? result : null;
  const checking = q.length >= 2 && !current;

  const add = (anchor: Anchor) => {
    dispatch({ type: "addAnchor", anchor });
    setQuery("");
    inputRef.current?.focus();
  };
  const has = (anchor: Anchor) => anchors.some((a) => same(a.input, anchor.input));

  const done = current?.kind === "done" ? current : null;
  const single = done?.outcome.status === "single" ? done.outcome.option : null;
  const ambiguous = done?.outcome.status === "ambiguous" ? done.outcome.options : null;
  const unmatched = done?.outcome.status === "unmatched";
  const alreadyAdded = !!single && has(single);

  const n = anchors.length;
  const under = n > 0 && n < 3;
  const countText =
    n === 0 ? "None yet · 3–5 recommended" : n < 3 ? `${n} selected · add a few more (3–5 recommended)` : n < MAX_ANCHORS ? `${n} selected · in the 3–5 range for a balanced plan` : `${n} selected · that’s the most we use`;

  return (
    <div className="f90-page">
      <main id="main" className="f90-wrap">
        <StepHeader backHref="/location" step={2} label="Your interests" />
        <StepTitle
          title="What already feels like you?"
          intro="Pick a few things you enjoy. We’ll use them to find connections to places in your new city, without generic tourism checklists."
          maxWidth={700}
        />

        <div className="f90-split">
          <div className="f90-split__form">
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <section style={{ background: "var(--bg-raised)", borderRadius: 16, padding: "clamp(18px,2.4vw,28px)", boxShadow: "var(--shadow-1)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "4px 16px" }}>
                  <label htmlFor={inputId} style={{ font: "600 16px/1.3 var(--font-sans)" }}>Search interests, authors, or places</label>
                  <span style={{ font: "600 11px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>We confirm each match</span>
                </div>
                <div className="f90-input-wrap" style={{ marginTop: 14 }}>
                  <Icon name="search" size={18} />
                  <input
                    id={inputId}
                    ref={inputRef}
                    className="f90-input f90-input--icon"
                    style={{ paddingRight: 48 }}
                    autoComplete="off"
                    placeholder="Try Korean food or an author"
                    value={query}
                    disabled={full}
                    aria-describedby={`${inputId}-hint`}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query ? (
                    <span className="f90-input-wrap__end">
                      <button
                        type="button"
                        aria-label="Clear search"
                        className="f90-focusable"
                        onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                        style={{ width: 40, height: 40, border: 0, borderRadius: 10, background: "transparent", color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                      >
                        <Icon name="circle-x" size={20} />
                      </button>
                    </span>
                  ) : null}
                </div>
                <p id={`${inputId}-hint`} style={{ margin: "10px 0 0", font: "400 13px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>
                  {full ? "You’ve added five, which is the most we use. Remove one to add another." : "Type artists, favorite authors, regional dishes, or specific pastimes."}
                </p>

                <div aria-live="polite">
                  {checking ? (
                    <p style={{ margin: "14px 0 0", display: "flex", gap: 8, alignItems: "center", font: "400 14px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>
                      <Icon name="loader-circle" size={16} className="f90-spin" />Checking “{q}”…
                    </p>
                  ) : null}

                  {single && !alreadyAdded ? (
                    <ul aria-label="Match" style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
                      <li>
                        <button
                          type="button"
                          className="f90-focusable"
                          onClick={() => add(single)}
                          style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 48, padding: "8px 14px", border: "1px solid var(--border-subtle)", borderRadius: 12, background: "var(--bg-surface)", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}
                        >
                          <span style={{ flex: 1, minWidth: 0, font: "500 15px/1.3 var(--font-sans)" }}>{single.name}</span>
                          <span style={{ font: "600 11px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-secondary)", background: "var(--ivory-200)", padding: "5px 8px", borderRadius: 6 }}>{single.type}</span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, font: "600 14px/1 var(--font-sans)", color: "var(--text-action)" }}>
                            <Icon name="plus" size={16} strokeWidth={2.25} />Add
                          </span>
                        </button>
                      </li>
                    </ul>
                  ) : null}

                  {alreadyAdded ? (
                    <p role="status" style={{ margin: "14px 0 0", display: "flex", gap: 8, alignItems: "center", font: "400 14px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
                      <Icon name="circle-check" size={18} />Already in your anchors.
                    </p>
                  ) : null}

                  {ambiguous ? (
                    <div style={{ marginTop: 16 }}>
                      <StateBanner tone="partial" icon="circle-alert" title={`“${done?.text}” could mean more than one thing`}>
                        <p className="f90-state__body">Choose the one you meant so we match it correctly.</p>
                        <div className="f90-chips">
                          {ambiguous.map((option, i) => (
                            <Chip key={`${option.label}-${i}`} label={option.label} onClick={() => add(option.anchor)} />
                          ))}
                        </div>
                      </StateBanner>
                    </div>
                  ) : null}

                  {unmatched ? (
                    <div style={{ marginTop: 16 }}>
                      <StateBanner tone="empty" icon="search" title={`We couldn’t confirm “${done?.text}”`}>
                        <p className="f90-state__body">Check the spelling, or keep it as your own words. We’ll keep it as a personal note; it won’t change your suggestions because we couldn’t match it.</p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                          <Button variant="secondary" size="sm" onClick={() => add(anchorOwnWords(done?.text ?? q))}>Keep as my own words</Button>
                          <Button variant="text" size="sm" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>Try different words</Button>
                        </div>
                      </StateBanner>
                    </div>
                  ) : null}

                  {current?.kind === "error" ? (
                    <div style={{ marginTop: 16 }}>
                      <StateBanner tone="partial" icon="circle-alert" title="We couldn’t check that just now" role="alert">
                        <p className="f90-state__body">{current.message}</p>
                        <div><Button variant="secondary" size="sm" iconLeft="refresh-cw" onClick={() => setQuery(`${query} `.trimEnd())}>Try again</Button></div>
                      </StateBanner>
                    </div>
                  ) : null}
                </div>
              </section>

              <section style={{ background: "var(--bg-raised)", borderRadius: 16, padding: "clamp(18px,2.4vw,28px)", boxShadow: "var(--shadow-1)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "6px 16px" }}>
                  <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 10, font: "500 17px/1.3 var(--font-sans)" }}>
                    <span style={{ color: "var(--evergreen-600)", display: "inline-flex" }}><Icon name="badge-check" size={22} /></span>
                    Your selected anchors
                  </h2>
                  <span style={{ font: "500 13px/1.4 var(--font-sans)", color: under || n === 0 ? "var(--text-warm)" : "var(--text-action)" }}>{countText}</span>
                </div>
                {n > 0 ? (
                  <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {anchors.map((a) => (
                      <li key={a.input} style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "var(--stone-100)", borderRadius: 999, padding: "6px 6px 6px 16px", maxWidth: "100%" }}>
                        <span style={{ font: "500 15px/1.3 var(--font-sans)", minWidth: 0 }}>{a.name}</span>
                        <span style={{ flex: "none", font: "600 10.5px/1 var(--font-sans)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-secondary)", background: "var(--bg-raised)", padding: "5px 8px", borderRadius: 6 }}>{a.type}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${a.name}`}
                          className="f90-focusable"
                          onClick={() => dispatch({ type: "removeAnchor", input: a.input })}
                          style={{ flex: "none", width: 32, height: 32, border: 0, borderRadius: "50%", background: "transparent", color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                        >
                          <Icon name="x" size={16} strokeWidth={2} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ marginTop: 16, border: "1px dashed var(--border-default)", borderRadius: 12, padding: 18, font: "400 14px/1.5 var(--font-sans)", color: "var(--text-muted)" }}>
                    Nothing added yet. Search above, or start with an example below.
                  </div>
                )}
                {unsearched ? (
                  <p role="note" style={{ margin: "14px 0 0", display: "flex", alignItems: "flex-start", gap: 8, font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>
                    <span style={{ flex: "none", marginTop: 2, display: "inline-flex", color: "var(--apricot-700)" }}><Icon name="info" size={16} /></span>
                    <span>{unsearched}</span>
                  </p>
                ) : null}
                {under ? (
                  <div style={{ marginTop: 16 }}>
                    <StateBanner tone="partial" icon="circle-alert" title="A few more will help">
                      <p className="f90-state__body">Add two or three more so your first suggestions feel like you. You can continue anytime.</p>
                    </StateBanner>
                  </div>
                ) : null}
              </section>

              <section style={{ background: "var(--stone-100)", borderRadius: 16, padding: "clamp(18px,2.4vw,28px)" }}>
                <h2 style={{ margin: 0, font: "500 17px/1.3 var(--font-sans)" }}>Examples to get started</h2>
                <p style={{ margin: "6px 0 0", font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>Tap to add a sample taste. These are illustrative, so change them to fit you.</p>
                <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {EXAMPLES.map((example) => {
                    const added = anchors.some((a) => same(a.input, example.label));
                    const icon: IconName = added ? "check" : "plus";
                    return (
                      <button
                        key={example.label}
                        type="button"
                        aria-disabled={added || full}
                        className="f90-focusable"
                        onClick={() => { if (!added && !full) dispatch({ type: "addAnchor", anchor: example.make() }); }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 16px", borderRadius: 999, border: `1px solid ${added ? "var(--evergreen-200)" : "transparent"}`, background: added ? "var(--evergreen-50)" : "var(--bg-raised)", color: added ? "var(--evergreen-700)" : "var(--text-primary)", font: "500 14px/1 var(--font-sans)", cursor: added || full ? "default" : "pointer", boxShadow: added ? "none" : "var(--shadow-1)" }}
                      >
                        <Icon name={icon} size={16} strokeWidth={2} />{example.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>

          <div className="f90-split__actions">
            <div className="f90-actions-row">
              <Button variant="secondary" size="lg" iconLeft="arrow-left" onClick={() => router.push("/location")}>Back to Location</Button>
              <Button variant="primary" size="lg" iconRight="arrow-right" disabled={n === 0} onClick={() => router.push("/preferences")}>Continue to preferences</Button>
            </div>
            <p style={{ margin: "14px 0 0", display: "flex", alignItems: "center", gap: 8, font: "400 13px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>
              <Icon name="lock" size={14} />We only use what you add here. You can edit your taste anchors anytime.
            </p>
          </div>

          <aside aria-label="How this works" className="f90-split__aside">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(20px,2.6vw,28px)", boxShadow: "var(--shadow-1)" }}>
                <span style={{ width: 50, height: 50, borderRadius: "50%", background: "var(--ivory-200)", color: "var(--evergreen-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="compass" size={22} />
                </span>
                <h2 style={{ margin: "20px 0 0", font: "500 clamp(1.25rem,2vw,1.5rem)/1.3 var(--font-sans)", letterSpacing: "-.01em" }}>How your tastes connect to places</h2>
                <p style={{ margin: "12px 0 0", font: "400 15px/1.65 var(--font-sans)", color: "var(--text-secondary)" }}>
                  We look at the atmosphere and community behind what you enjoy. If you love quiet bookstores and acoustic folk, we look for places that share that unhurried feel.
                </p>
                <div style={{ marginTop: 20, background: "var(--stone-100)", borderRadius: 12, padding: "16px 18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, font: "600 11px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    <span>Your taste</span><span>A place that fits</span>
                  </div>
                  <div aria-hidden="true" style={{ margin: "14px 0", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--evergreen-700)" }} />
                    <span style={{ flex: 1, borderTop: "2px dashed var(--stone-300)" }} />
                    <span style={{ color: "var(--evergreen-700)", display: "inline-flex" }}><Icon name="chevron-right" size={22} /></span>
                    <span style={{ flex: 1, borderTop: "2px dashed var(--stone-300)" }} />
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--evergreen-200)", border: "2px solid var(--evergreen-700)" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, font: "500 14px/1.35 var(--font-sans)" }}>
                    <span>{anchors[0]?.name ?? "Something you enjoy"}</span>
                    <span style={{ textAlign: "right", color: "var(--text-secondary)" }}>Somewhere that shares the mood</span>
                  </div>
                </div>
              </div>

              <div className="f90-wide-only">
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(20px,2.6vw,28px)", boxShadow: "var(--shadow-1)" }}>
                    <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: 12, font: "500 clamp(1.125rem,2vw,1.375rem)/1.3 var(--font-sans)" }}>
                      <span style={{ color: "var(--apricot-700)", display: "inline-flex" }}><Icon name="landmark" size={24} /></span>
                      Matches we confirm
                    </h2>
                    <p style={{ margin: "12px 0 0", font: "400 15px/1.65 var(--font-sans)", color: "var(--text-secondary)" }}>
                      Each interest is matched to a known artist, place, or topic before we use it. Anything we can’t confirm stays in your own words, never presented as a match.
                    </p>
                    <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px 12px" }}>
                      <span style={{ font: "400 13px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>Your words stay yours</span>
                      <Badge tone="verified">Confirmed matches only</Badge>
                    </div>
                  </div>
                  <div style={{ background: "var(--stone-100)", borderRadius: 20, padding: "clamp(20px,2.6vw,28px)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ font: "600 12px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-warm)" }}>Example of what you’ll see</span>
                      <span style={{ color: "var(--apricot-700)", display: "inline-flex" }}><Icon name="sun" size={22} /></span>
                    </div>
                    <div style={{ marginTop: 12, font: "400 clamp(1.5rem,2.4vw,1.75rem)/1.2 var(--font-serif)", letterSpacing: "-.01em" }}>Quiet mornings, creative evenings</div>
                    <p style={{ margin: "12px 0 0", font: "400 14px/1.6 var(--font-sans)", color: "var(--text-secondary)" }}>
                      Your tastes might point toward independent neighborhood pockets: unhurried counter service, shelves worth browsing, and gentle evening events.
                    </p>
                    <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {["Low-key pace", "Walkable third places", "Independent shops"].map((t) => (
                        <span key={t} style={{ font: "500 13px/1 var(--font-sans)", background: "var(--bg-raised)", padding: "8px 12px", borderRadius: 6 }}>{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
