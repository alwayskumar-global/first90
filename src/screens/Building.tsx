"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/domain/demo";
import { STAGE_KEYS, type PlanSession } from "@/domain/types";
import { Icon, type IconName } from "@/components/Icon";
import { Button, StateBanner } from "@/components/ui";
import type { StepId } from "@/lib/agent/trace";
import { ApiError, buildPlanRequest } from "@/lib/flow/api";
import { useFlow } from "@/lib/flow/FlowProvider";
import { buildTasteInput } from "@/lib/flow/input";
import { areaText, choicesText, rangeText } from "@/lib/flow/summary";

type Mode = "building" | "slow" | "partial" | "error" | "empty";

const UI_STEPS: { label: string; doneWhen: StepId }[] = [
  { label: "Matching your interests", doneWhen: "resolve_interests" },
  { label: "Finding places in your area", doneWhen: "apply_constraints" },
  { label: "Putting your plan together", doneWhen: "explain" },
];

const HEAD: Record<Mode, { heading: string; copy: string; icon: IconName; tile: [string, string] }> = {
  building: { heading: "Finding your first familiar places", copy: "We’re looking for local options that connect with your interests and preferences.", icon: "map-pin", tile: ["var(--evergreen-50)", "var(--evergreen-700)"] },
  slow: { heading: "Still working on your plan", copy: "We’re still looking for local options that connect with your interests and preferences.", icon: "clock", tile: ["var(--evergreen-50)", "var(--evergreen-700)"] },
  partial: { heading: "Your plan is ready, with fewer suggestions", copy: "We found options for most of what you asked for, and a few areas came up short.", icon: "circle-alert", tile: ["var(--apricot-100)", "var(--apricot-700)"] },
  error: { heading: "We couldn’t build your plan just now", copy: "Something interrupted the search before it finished.", icon: "triangle-alert", tile: ["var(--clay-50)", "var(--clay-600)"] },
  empty: { heading: "We didn’t find enough close matches", copy: "We looked in your area, but nothing we could confirm fit your choices.", icon: "search", tile: ["var(--stone-100)", "var(--stone-700)"] },
};

const planSize = (session: PlanSession) => STAGE_KEYS.reduce((n, key) => n + session.plan.stages[key].length, 0);

export function Building() {
  const router = useRouter();
  const { state, dispatch } = useFlow();
  const [mode, setMode] = useState<Mode>("building");
  const [seen, setSeen] = useState<StepId[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [partial, setPartial] = useState<PlanSession | null>(null);

  // Hydrated state is needed to know the user's answers; wait for it, then build once per attempt.
  useEffect(() => {
    if (!state.hydrated) return;
    if (state.anchors.length === 0) {
      router.replace("/interests");
      return;
    }
    const controller = new AbortController();
    const slow = setTimeout(() => setMode((m) => (m === "building" ? "slow" : m)), 12_000);
    buildPlanRequest(buildTasteInput(state), (step) => setSeen((prev) => [...prev, step.id]), controller.signal)
      .then(({ session }) => {
        clearTimeout(slow);
        if (planSize(session) === 0) {
          setMode("empty");
          return;
        }
        const short = (session.coverage ?? []).some((c) => !c.loaded || c.inPlan === 0);
        dispatch({ type: "setSession", session });
        if (short) {
          setPartial(session);
          setMode("partial");
        } else {
          router.replace("/plan");
        }
      })
      .catch((err: unknown) => {
        clearTimeout(slow);
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiError ? err : new ApiError({ error: "Something went wrong.", kind: "internal", retryable: true }));
        setMode("error");
      });
    return () => {
      clearTimeout(slow);
      controller.abort();
    };
    // `state` is read once per attempt on purpose: editing answers navigates away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated, attempt]);

  const retry = () => {
    setMode("building");
    setSeen([]);
    setError(null);
    setPartial(null);
    setAttempt((a) => a + 1);
  };

  const head = HEAD[mode];
  const firstActive = UI_STEPS.findIndex((step) => !seen.includes(step.doneWhen));
  const stepRows = UI_STEPS.map((step, i) => {
    if (mode === "partial" || mode === "empty") {
      const done = mode === "partial" || i === 0;
      return { ...step, status: done ? "done" : i === 1 ? "empty" : "pending", text: done ? "Done" : i === 1 ? "No matches" : "Not started" };
    }
    if (mode === "error") {
      const done = seen.includes(step.doneWhen);
      const failedAt = firstActive === -1 ? UI_STEPS.length : firstActive;
      return { ...step, status: done ? "done" : i === failedAt ? "error" : "pending", text: done ? "Done" : i === failedAt ? "Didn’t finish" : "Not started" };
    }
    if (seen.includes(step.doneWhen)) return { ...step, status: "done", text: "Done" };
    if (i === firstActive) return { ...step, status: "active", text: mode === "slow" ? "Taking longer" : "In progress" };
    return { ...step, status: "pending", text: "Waiting" };
  });
  const iconFor: Record<string, [IconName, string] | undefined> = {
    done: ["circle-check", "var(--evergreen-500)"], active: ["loader-circle", "var(--evergreen-500)"], error: ["triangle-alert", "var(--clay-600)"], empty: ["info", "var(--stone-600)"],
  };

  const interests = state.anchors;
  const retryAfter = error?.retryAfterSeconds;

  return (
    <div className="f90-page">
      <header style={{ maxWidth: 1120, margin: "0 auto", padding: "clamp(20px,3vw,32px) clamp(16px,3vw,32px) 0", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--evergreen-500)" }} />
        <span style={{ font: "500 22px/1 var(--font-sans)", letterSpacing: "-.01em" }}>First 90 Days</span>
      </header>

      <main id="main" style={{ maxWidth: 680, margin: "0 auto", padding: "clamp(24px,5vw,56px) clamp(16px,3vw,32px) clamp(32px,6vw,80px)" }}>
        <div style={{ background: "var(--bg-raised)", borderRadius: 24, padding: "clamp(22px,4.4vw,44px)", boxShadow: "var(--shadow-1)" }}>
          <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", background: head.tile[0], color: head.tile[1] }}>
            <Icon name={head.icon} size={26} />
          </span>
          <h1 style={{ margin: "24px 0 0", font: "400 clamp(1.875rem,4.4vw,2.75rem)/1.1 var(--font-serif)", letterSpacing: "-.02em", textWrap: "balance" }}>{head.heading}</h1>
          <p style={{ margin: "14px 0 0", font: "400 clamp(1rem,1.6vw,1.125rem)/1.6 var(--font-sans)", color: "var(--text-secondary)", textWrap: "pretty" }}>{head.copy}</p>

          <ol aria-label="Plan progress" aria-live="polite" className="f90-progress__list" style={{ marginTop: 28 }}>
            {stepRows.map((row, i) => {
              const icon = iconFor[row.status];
              return (
                <li key={row.label} className="f90-progress__step" data-status={row.status} aria-current={i === firstActive && (mode === "building" || mode === "slow") ? "step" : undefined} style={{ minHeight: 44 }}>
                  {row.status === "pending" ? (
                    <span className="f90-progress__ring" />
                  ) : icon ? (
                    <span style={{ display: "inline-flex", color: icon[1] }}><Icon name={icon[0]} size={20} className={row.status === "active" ? "f90-spin" : ""} /></span>
                  ) : null}
                  <span>{row.label}</span>
                  <span className="f90-progress__status" style={{ color: row.status === "error" ? "var(--clay-600)" : "var(--text-muted)", fontWeight: row.status === "error" ? 600 : 400, fontSize: 13 }}>{row.text}</span>
                </li>
              );
            })}
          </ol>

          {mode === "slow" ? (
            <div style={{ marginTop: 24 }}>
              <StateBanner icon="clock" title="This is taking longer than expected">
                <p className="f90-state__body">Your answers are saved, so nothing is lost. You can keep waiting here, or adjust your preferences.</p>
                <div style={{ marginTop: 4 }}><Button variant="secondary" onClick={() => router.push("/preferences")}>Edit preferences</Button></div>
              </StateBanner>
            </div>
          ) : null}

          {mode === "partial" && partial ? (
            <div style={{ marginTop: 24 }}>
              <StateBanner tone="partial" icon="circle-alert" title="Some categories came up short">
                <p className="f90-state__body">Your plan will have fewer suggestions in the areas below. You can replace suggestions once it’s ready.</p>
                <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {(partial.coverage ?? []).map((c) => {
                    const ok = c.loaded && c.inPlan > 0;
                    return (
                      <li key={c.category} style={{ display: "flex", alignItems: "center", gap: 10, font: "400 15px/1.4 var(--font-sans)" }}>
                        <span style={{ display: "inline-flex", color: ok ? "var(--evergreen-600)" : "var(--apricot-700)" }}><Icon name={ok ? "circle-check" : "circle-alert"} size={18} /></span>
                        <span style={{ flex: 1, minWidth: 0 }}>{CATEGORIES[c.category].label}</span>
                        <span style={{ font: "500 13px/1.3 var(--font-sans)", color: "var(--text-secondary)", textAlign: "right" }}>{ok ? "Options found" : c.loaded ? "Not enough yet" : "Couldn’t load"}</span>
                      </li>
                    );
                  })}
                </ul>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
                  <div style={{ flex: "1 1 180px" }}><Button variant="primary" size="lg" fullWidth iconRight="arrow-right" onClick={() => router.push("/plan")}>View my plan</Button></div>
                  <div style={{ flex: "1 1 180px" }}><Button variant="secondary" size="lg" fullWidth onClick={() => router.push("/preferences")}>Edit preferences</Button></div>
                </div>
              </StateBanner>
            </div>
          ) : null}

          {mode === "error" ? (
            <div style={{ marginTop: 24 }}>
              <StateBanner tone="error" icon="triangle-alert" title="Your answers are saved" role="alert">
                <p className="f90-state__body">
                  {error?.kind === "rate_limit"
                    ? `We’ve asked our data source for a lot just now. Please wait${retryAfter ? ` about ${retryAfter} seconds` : " a moment"}, then try again.`
                    : "The problem was on our side, not yours. Nothing you entered was lost."}
                </p>
                <div className="f90-state__kept">
                  <span>Still saved:</span>
                  <b>{areaText(state, true)}</b><b>{rangeText(state)}</b><b>{interests.length} interests</b><b>Preferences</b>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
                  <div style={{ flex: "1 1 180px" }}><Button variant="primary" size="lg" fullWidth iconLeft="refresh-cw" onClick={retry}>Try again</Button></div>
                  <div style={{ flex: "1 1 180px" }}><Button variant="secondary" size="lg" fullWidth onClick={() => router.push("/preferences")}>Edit preferences</Button></div>
                </div>
              </StateBanner>
            </div>
          ) : null}

          {mode === "empty" ? (
            <div style={{ marginTop: 24 }}>
              <StateBanner tone="empty" icon="search" title="Nothing we could confirm fits all of this yet">
                <p className="f90-state__body">The mix of your area, limits and interests is quite specific, and this demo covers one city. Widening the area or changing interests are the two quickest ways forward.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
                  <div style={{ flex: "1 1 200px" }}><Button variant="primary" size="lg" fullWidth onClick={() => router.push("/location")}>Broaden my search area</Button></div>
                  <div style={{ flex: "1 1 200px" }}><Button variant="secondary" size="lg" fullWidth onClick={() => router.push("/interests")}>Change interests</Button></div>
                </div>
              </StateBanner>
            </div>
          ) : null}

          <div style={{ marginTop: 28, background: "var(--stone-100)", borderRadius: 16, padding: "18px 20px" }}>
            <div style={{ font: "600 11px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Using your choices</div>
            <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: "10px 18px", font: "400 14px/1.5 var(--font-sans)" }}>
              <dt style={{ color: "var(--text-muted)" }}>Area</dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>{areaText(state)} {"·"} {rangeText(state)}</dd>
              <dt style={{ color: "var(--text-muted)" }}>Interests</dt>
              <dd style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {interests.slice(0, 3).map((a) => (
                  <span key={a.input} style={{ font: "500 13px/1 var(--font-sans)", background: "var(--bg-raised)", padding: "7px 11px", borderRadius: 999 }}>{a.name}</span>
                ))}
                {interests.length > 3 ? <span style={{ font: "500 13px/1 var(--font-sans)", color: "var(--text-secondary)", padding: "7px 2px" }}>+{interests.length - 3} more</span> : null}
              </dd>
              <dt style={{ color: "var(--text-muted)" }}>Preferences</dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>{choicesText(state.prefs)}</dd>
            </dl>
          </div>

          {mode === "building" || mode === "slow" || mode === "partial" ? (
            <p style={{ margin: "20px 0 0", display: "flex", alignItems: "center", gap: 10, font: "400 14px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>
              <Icon name="repeat" size={16} />You can change any suggestion once your plan is ready.
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
