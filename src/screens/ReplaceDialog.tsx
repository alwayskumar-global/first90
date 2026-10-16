"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/domain/demo";
import type { FeedbackReason, PlaceCandidate, PlanItem, PlanRevision, PlanSession } from "@/domain/types";
import { Icon, type IconName } from "@/components/Icon";
import { Button, StateBanner } from "@/components/ui";
import { ApiError, reviseRequest } from "@/lib/flow/api";
import { CATEGORY_ICON, CATEGORY_LABEL } from "./placeView";

interface ReasonOption {
  id: string;
  reason: FeedbackReason | undefined;
  label: string;
  icon: IconName;
  hint: string;
}

const REASONS: ReasonOption[] = [
  { id: "far", reason: "too_far", label: "Too far", icon: "route", hint: "Uses your chosen area and search range" },
  { id: "expensive", reason: "too_expensive", label: "Too expensive", icon: "wallet", hint: "Applies to places with price information" },
  { id: "lively", reason: "too_loud", label: "Too lively", icon: "volume-2", hint: "Applies where we have atmosphere details" },
  { id: "no", reason: "not_interested", label: "Not interested", icon: "ban", hint: "We’ll avoid this place and show fewer like it" },
  { id: "other", reason: undefined, label: "Something else", icon: "message-square", hint: "We’ll swap in a different place" },
];

/** What we will actually do for each reason (matches the engine's behavior, and says where data limits it). */
function reasonNote(option: ReasonOption, candidate: PlaceCandidate): string {
  switch (option.id) {
    case "far":
      return "We’ll look for a closer place, within half your current search range. We won’t widen it without asking.";
    case "expensive":
      return candidate.priceLevel !== undefined && CATEGORIES[candidate.category].pricesAvailable
        ? "We’ll look for a place at a lower price level, where price information exists."
        : "We don’t have price information for this kind of place, so we can’t filter by cost. We’ll still look for another option and say so.";
    case "lively":
      return "We’ll look for calmer places, using atmosphere details where we have them. Places with no such details are marked as unverified.";
    case "no":
      return "We’ll skip this place and show fewer of this kind.";
    default:
      return "We can’t act on free-text notes yet, so we’ll swap in a different place without changing your limits.";
  }
}

type Phase = { name: "feedback" } | { name: "revising" } | { name: "nomatch"; revision: PlanRevision } | { name: "error"; error: ApiError };

const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * "What didn't fit?" flow (Replace screen in the design): reason -> looking -> updated plan or an honest no-match.
 * A no-match leaves the plan exactly as it was.
 */
export function ReplaceDialog({
  session, item, candidate, onClose, onReplaced,
}: {
  session: PlanSession;
  item: PlanItem;
  candidate: PlaceCandidate;
  onClose: () => void;
  onReplaced: (next: PlanSession, revision: PlanRevision, message: string) => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "feedback" });
  const option = REASONS.find((r) => r.id === optionId) ?? null;

  // Focus trap + restore, Escape to keep the suggestion.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cardRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => previous?.focus?.();
  }, [phase.name]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && phase.name !== "revising") {
      onClose();
      return;
    }
    if (event.key !== "Tab" || !cardRef.current) return;
    const nodes = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getAttribute("aria-disabled") !== "true");
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const find = async () => {
    if (!option) return;
    setPhase({ name: "revising" });
    try {
      const { session: next, revision } = await reviseRequest(session, { itemId: item.id, action: "replace", ...(option.reason ? { reason: option.reason } : {}) });
      if (revision.noMatch || !revision.addedItemId) {
        setPhase({ name: "nomatch", revision });
        return;
      }
      onReplaced(next, revision, revision.appliedConstraint?.label ?? "We swapped in a different place");
    } catch (error) {
      setPhase({ name: "error", error: error instanceof ApiError ? error : new ApiError({ error: "Something went wrong." }) });
    }
  };

  const onGroupKey = (event: KeyboardEvent<HTMLElement>) => {
    const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const radios = Array.from(event.currentTarget.closest("[role=radiogroup]")?.querySelectorAll<HTMLElement>("[role=radio]") ?? []);
    const next = radios[(radios.indexOf(event.currentTarget) + delta + radios.length) % radios.length];
    next?.focus();
    next?.click();
  };

  const reasonLower = option?.label.toLowerCase() ?? "";

  return (
    <div className="f90-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && phase.name !== "revising") onClose(); }}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="f90-dialog-card" onKeyDown={onKeyDown}>
        {phase.name === "feedback" ? (
          <div style={{ padding: "clamp(24px,3vw,32px)", display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <h2 id={titleId} style={{ margin: 0, font: "400 clamp(1.75rem,3.4vw,2.125rem)/1.12 var(--font-serif)", letterSpacing: "-.015em" }}>What didn’t fit?</h2>
                <p style={{ margin: "10px 0 0", font: "400 15px/1.55 var(--font-sans)", color: "var(--text-secondary)" }}>Tell us what to change. We’ll look for another option while keeping the rest of your plan.</p>
              </div>
              <button type="button" aria-label="Keep this suggestion and close" className="f90-focusable" onClick={onClose} style={{ flex: "none", width: 44, height: 44, margin: "-6px -8px 0 0", border: 0, borderRadius: 12, background: "transparent", color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Icon name="x" size={20} />
              </button>
            </div>

            <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ flex: "none", width: 44, height: 44, borderRadius: "50%", background: "var(--apricot-100)", color: "var(--apricot-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={CATEGORY_ICON[candidate.category]} size={20} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ font: "600 11px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Replacing {"·"} {item.routine}</div>
                <div style={{ marginTop: 3, font: "500 16px/1.3 var(--font-sans)" }}>{candidate.name}</div>
                <div style={{ font: "400 13px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{CATEGORY_LABEL[candidate.category]}</div>
              </div>
            </div>

            <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <legend style={{ padding: 0, font: "600 14px/1.3 var(--font-sans)" }}>Choose one reason</legend>
              <div role="radiogroup" aria-label="What didn’t fit" style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {REASONS.map((r) => {
                  const on = optionId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className="f90-radio-card f90-focusable"
                      onClick={() => setOptionId(r.id)}
                      onKeyDown={onGroupKey}
                      style={{ minHeight: 60, padding: on ? "11px 15px" : "12px 16px", borderRadius: 14, border: on ? "2px solid var(--evergreen-500)" : "1.5px solid var(--border-subtle)", background: on ? "var(--evergreen-50)" : "var(--bg-raised)" }}
                    >
                      <span style={{ flex: "none", color: on ? "var(--evergreen-600)" : "var(--text-secondary)", display: "inline-flex" }}><Icon name={r.icon} size={20} /></span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ font: "500 16px/1.3 var(--font-sans)" }}>{r.label}</span>
                        <span style={{ font: "400 13px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{r.hint}</span>
                      </span>
                      {on ? (
                        <span style={{ flex: "none", color: "var(--evergreen-600)", display: "inline-flex" }}><Icon name="circle-check" size={22} /></span>
                      ) : (
                        <span style={{ flex: "none", width: 20, height: 20, borderRadius: "50%", border: "1.5px solid var(--border-control)", margin: 1 }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {option ? (
              <p role="status" style={{ margin: 0, display: "flex", alignItems: "flex-start", gap: 10, background: "var(--bg-sunken)", borderRadius: 12, padding: "12px 14px", font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>
                <span style={{ marginTop: 2, display: "inline-flex" }}><Icon name="info" size={16} /></span>
                {reasonNote(option, candidate)}
              </p>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Button variant="primary" size="lg" iconRight="arrow-right" fullWidth disabled={!option} onClick={find}>Find another place</Button>
              <Button variant="text" size="lg" fullWidth onClick={onClose}>Keep this suggestion</Button>
              {!option ? <p style={{ margin: 0, textAlign: "center", font: "400 13px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>Choose a reason to continue.</p> : null}
            </div>
            <p style={{ margin: 0, font: "400 12px/1.5 var(--font-sans)", color: "var(--text-muted)" }}>A reason only changes the next suggestion where we have data to support it. Saved places stay put.</p>
          </div>
        ) : null}

        {phase.name === "revising" ? (
          <div style={{ padding: "clamp(24px,3vw,32px)", display: "flex", flexDirection: "column", gap: 20 }} aria-live="polite">
            <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--evergreen-50)", color: "var(--evergreen-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="loader-circle" size={26} className="f90-spin" />
            </span>
            <div>
              <h2 id={titleId} style={{ margin: 0, font: "400 clamp(1.75rem,3.4vw,2.125rem)/1.12 var(--font-serif)", letterSpacing: "-.015em" }}>Looking for another place</h2>
              <p style={{ margin: "10px 0 0", font: "400 15px/1.55 var(--font-sans)", color: "var(--text-secondary)" }}>We’re checking places for “{reasonLower}”. The rest of your plan stays as it is.</p>
            </div>
            <ol className="f90-progress__list">
              <li className="f90-progress__step" data-status="done" style={{ minHeight: 44 }}>
                <span style={{ color: "var(--evergreen-500)", display: "inline-flex" }}><Icon name="circle-check" size={20} /></span><span>Applying your feedback</span><span className="f90-progress__status">Done</span>
              </li>
              <li className="f90-progress__step" data-status="active" aria-current="step" style={{ minHeight: 44 }}>
                <span style={{ color: "var(--evergreen-500)", display: "inline-flex" }}><Icon name="loader-circle" size={20} className="f90-spin" /></span><span>Checking places</span><span className="f90-progress__status">In progress</span>
              </li>
            </ol>
            <div style={{ background: "var(--stone-100)", borderRadius: 14, padding: "14px 16px", font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>
              Keeping: <b style={{ fontWeight: 600, color: "var(--text-primary)" }}>your saved places, your other stages, and your preferences.</b>
            </div>
          </div>
        ) : null}

        {phase.name === "nomatch" ? (
          <div style={{ padding: "clamp(24px,3vw,32px)", display: "flex", flexDirection: "column", gap: 20 }}>
            <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--stone-100)", color: "var(--stone-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="search" size={26} />
            </span>
            <div>
              <h2 id={titleId} style={{ margin: 0, font: "400 clamp(1.625rem,3.2vw,2rem)/1.15 var(--font-serif)", letterSpacing: "-.015em", textWrap: "balance" }}>We couldn’t find another match with those preferences</h2>
              <p style={{ margin: "10px 0 0", font: "400 15px/1.55 var(--font-sans)", color: "var(--text-secondary)" }}>
                We looked for “{reasonLower}” and found nothing that fits. We haven’t loosened your choice or made up a replacement.
              </p>
              {phase.revision.noMatch ? <p style={{ margin: "10px 0 0", font: "400 15px/1.55 var(--font-sans)", color: "var(--text-secondary)" }}>{phase.revision.noMatch.suggestion}</p> : null}
            </div>
            <div className="f90-state__kept" style={{ fontSize: 13 }}>
              <span>Still in place:</span><b>{candidate.name}</b><b>Your saved places</b><b>Your preferences</b>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Button variant="primary" size="lg" fullWidth onClick={onClose}>Keep the original</Button>
              <Button variant="secondary" size="lg" fullWidth onClick={() => setPhase({ name: "feedback" })}>Change the reason</Button>
              <Button variant="text" size="lg" fullWidth onClick={() => router.push("/location")}>Broaden the search area</Button>
            </div>
          </div>
        ) : null}

        {phase.name === "error" ? (
          <div style={{ padding: "clamp(24px,3vw,32px)", display: "flex", flexDirection: "column", gap: 20 }}>
            <h2 id={titleId} style={{ margin: 0, font: "400 clamp(1.625rem,3.2vw,2rem)/1.15 var(--font-serif)", letterSpacing: "-.015em" }}>We couldn’t look just now</h2>
            <StateBanner tone="error" icon="triangle-alert" title="Your plan is unchanged" role="alert">
              <p className="f90-state__body">
                {phase.error.kind === "rate_limit"
                  ? "We’ve asked our data source for a lot just now. Please wait a moment, then try again."
                  : phase.error.kind === "bad_session"
                    ? "We can’t verify this saved plan any more, so we can’t revise it. Your answers are still saved; rebuild the plan to keep going."
                    : "The problem was on our side, not yours. Nothing was lost."}
              </p>
            </StateBanner>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {phase.error.kind === "bad_session" ? (
                <Button variant="primary" size="lg" fullWidth iconLeft="refresh-cw" onClick={() => router.push("/building")}>Rebuild my plan</Button>
              ) : (
                <Button variant="primary" size="lg" fullWidth iconLeft="refresh-cw" onClick={find}>Try again</Button>
              )}
              <Button variant="text" size="lg" fullWidth onClick={onClose}>Keep this suggestion</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
