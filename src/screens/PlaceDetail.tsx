"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { PlaceCandidate, PlanItem, PlanSession } from "@/domain/types";
import { findItem } from "@/domain/session";
import { Icon } from "@/components/Icon";
import { Badge, Button, STAGES, StateBanner } from "@/components/ui";
import { UNVERIFIED_NOTICE } from "@/lib/agent/explain";
import { useFlow } from "@/lib/flow/FlowProvider";
import { rangeText } from "@/lib/flow/summary";
import { BASIS_LABEL, CATEGORY_ICON, CATEGORY_LABEL, areaLabelOf, connectedInterests, distanceText, priceText } from "./placeView";
import { ReplaceDialog } from "./ReplaceDialog";

type Support = "supported" | "general" | "unknown";
const BADGES: Record<Support, { tone: "verified" | "neutral" | "check"; icon: "circle-check" | "info" | "clock"; label: string }> = {
  supported: { tone: "verified", icon: "circle-check", label: "Supported by place data" },
  general: { tone: "neutral", icon: "info", label: "General suggestion" },
  unknown: { tone: "check", icon: "clock", label: "Not enough information" },
};

interface Reason { kind: string; name: string; text: string; support: Support }

function buildReasons(item: PlanItem, candidate: PlaceCandidate, session: PlanSession, rangeLabel: string): Reason[] {
  const input = session.plan.input;
  const reasons: Reason[] = [];
  const used = connectedInterests(item, candidate, session);

  reasons.push({
    kind: "Category",
    name: CATEGORY_LABEL[item.category],
    text: candidate.primaryGenre ? `Qloo lists it as “${candidate.primaryGenre}”.` : `It appears under ${CATEGORY_LABEL[item.category].toLowerCase()} in our data.`,
    support: "supported",
  });

  if (item.basis === "input_attribution") {
    reasons.push({ kind: "Your picks", name: used.join(", ") || "Your picks", text: "Qloo reported these picks as contributing to how this place was ranked.", support: "supported" });
  } else if (item.basis === "taste_signals") {
    reasons.push({ kind: "Your picks", name: used.join(", "), text: "Qloo ranked this place using these picks, but doesn’t say which one mattered most.", support: "general" });
  } else {
    reasons.push({ kind: "Your picks", name: "Category and distance", text: "Qloo returned no taste ranking for this place, so it’s suggested on category and distance alone.", support: "unknown" });
  }

  if (input.atmosphere === "quiet" || input.strictQuiet || input.atmosphere === "lively") {
    const wantsQuiet = input.atmosphere === "quiet" || input.strictQuiet;
    reasons.push({
      kind: "Preference",
      name: wantsQuiet ? "Quiet and relaxed" : "Lively and social",
      text: item.highlights.length > 0 ? `Qloo tags it: ${item.highlights.join(", ")}.` : "Qloo has no noise or ambience details that match this preference for this place.",
      support: item.highlights.length > 0 ? "supported" : "unknown",
    });
  }
  if (input.preferMornings) {
    const morning = item.highlights.filter((h) => /morning/i.test(h));
    reasons.push({
      kind: "Routine",
      name: "Mornings",
      text: morning.length > 0 ? `Qloo lists a good fit for: ${morning.join(", ")}.` : "Qloo doesn’t list mornings as a good time for this place.",
      support: morning.length > 0 ? "supported" : "unknown",
    });
  }
  reasons.push({ kind: "Area", name: `${areaLabelOf(session)} · ${rangeLabel}`, text: `${distanceText(candidate, session)}, inside the distance you chose.`, support: "supported" });
  return reasons;
}

const th = { padding: "12px 0", borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)" } as const;
const td = { margin: 0, padding: "12px 0", borderTop: "1px solid var(--border-subtle)" } as const;

export function PlaceDetail() {
  const router = useRouter();
  const params = useParams<{ itemId: string }>();
  const { state, dispatch } = useFlow();
  const { session } = state;
  const [replacing, setReplacing] = useState(false);
  const itemId = decodeURIComponent(params.itemId ?? "");
  const item = session ? findItem(session, itemId) : undefined;
  const candidate = session && item ? session.candidates[item.qlooEntityId] : undefined;

  useEffect(() => {
    if (state.hydrated && (!session || !item || !candidate)) router.replace(session ? "/plan" : "/");
  }, [state.hydrated, session, item, candidate, router]);

  if (!session || !item || !candidate) {
    return <div className="f90-page"><main id="main" className="f90-wrap"><p role="status" style={{ color: "var(--text-muted)" }}>Loading…</p></main></div>;
  }

  const stage = STAGES.find((s) => s.key === item.stage)!;
  const saved = item.status === "saved";
  const reasons = buildReasons(item, candidate, session, rangeText(state));
  const limited = item.basis === "category_and_distance";
  const price = priceText(candidate);
  const extraNotices = item.notices.filter((n) => n !== UNVERIFIED_NOTICE);
  let host = "";
  try { host = item.externalUrl ? new URL(item.externalUrl).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }

  return (
    <div className="f90-page">
      <main id="main" style={{ maxWidth: 1120, margin: "0 auto", padding: "clamp(16px,2.4vw,28px) clamp(16px,3vw,32px) clamp(32px,6vw,80px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Button variant="text" iconLeft="arrow-left" onClick={() => router.push("/plan")}>Back to my plan</Button>
          <span aria-hidden="true" style={{ color: "var(--stone-300)", font: "300 22px/1 var(--font-sans)" }}>/</span>
          <span style={{ marginLeft: 8, font: "italic 400 26px/1 var(--font-serif)", color: "var(--ink-800)" }}>First 90 Days</span>
        </div>

        <div className="f90-place-grid">
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "clamp(28px,4vw,40px)" }}>
            <section aria-label="Place overview">
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", font: "500 14px/1.4 var(--font-sans)", color: "var(--text-secondary)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "var(--evergreen-50)", border: "1px solid var(--evergreen-200)", color: "var(--evergreen-700)", padding: "7px 12px", borderRadius: 999 }}>
                  <Icon name="repeat" size={15} />{item.routine}
                </span>
                <span style={{ color: "var(--text-muted)" }}>{stage.label}</span>
              </div>

              <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 18, background: "var(--apricot-50)", border: "1px solid var(--apricot-100)", borderRadius: 20, padding: "clamp(20px,3vw,28px)" }}>
                <span style={{ flex: "none", width: 64, height: 64, borderRadius: "50%", background: "var(--apricot-100)", color: "var(--apricot-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={CATEGORY_ICON[item.category]} size={28} />
                </span>
                <div>
                  <div style={{ font: "500 17px/1.3 var(--font-sans)" }}>{CATEGORY_LABEL[item.category]}</div>
                  <p style={{ margin: "4px 0 0", font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>We don’t show photos of places, only what we can stand behind.</p>
                </div>
              </div>

              <h1 style={{ margin: "clamp(20px,3vw,28px) 0 0", font: "400 clamp(2.125rem,4.8vw,3.25rem)/1.06 var(--font-serif)", letterSpacing: "-.022em", textWrap: "balance" }}>{candidate.name}</h1>
              <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", font: "400 15px/1.4 var(--font-sans)", color: "var(--text-secondary)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={CATEGORY_ICON[item.category]} size={16} />{CATEGORY_LABEL[item.category]}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="map-pin" size={16} />{distanceText(candidate, session)}</span>
                {saved ? <Badge tone="verified" icon="bookmark-check">Saved</Badge> : null}
              </div>
            </section>

            <section aria-labelledby="why-h" style={{ background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(20px,3vw,32px)", boxShadow: "var(--shadow-1)" }}>
              <div style={{ font: "600 12px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-action)" }}>Why this fits</div>
              <h2 id="why-h" style={{ margin: "8px 0 0", font: "400 clamp(1.5rem,2.8vw,1.875rem)/1.2 var(--font-serif)", letterSpacing: "-.015em" }}>
                {limited ? "A general suggestion, with limited detail" : "It lines up with what you told us"}
              </h2>
              <p style={{ margin: "10px 0 0", font: "400 15px/1.6 var(--font-sans)", color: "var(--text-secondary)", maxWidth: "44em" }}>
                {limited ? "Here is what we can and can’t say about this place." : "These are the choices that shaped this suggestion, and how each connects to what we know about the place."}
              </p>
              <p style={{ margin: "10px 0 0", font: "500 14px/1.5 var(--font-sans)", color: "var(--text-primary)" }}>{item.why}</p>

              {limited ? (
                <div style={{ marginTop: 20 }}>
                  <StateBanner tone="partial" icon="circle-alert" title="Limited evidence">
                    <p className="f90-state__body">We have few details about this place, so we can’t say much about how it fits. Treat it as a starting point, and replace it if it doesn’t feel right.</p>
                  </StateBanner>
                </div>
              ) : null}

              <ul style={{ listStyle: "none", margin: "20px 0 0", padding: 0 }}>
                {reasons.map((reason) => {
                  const b = BADGES[reason.support];
                  return (
                    <li key={reason.kind} style={{ padding: "16px 0", borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px" }}>
                        <span style={{ font: "600 11px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{reason.kind}</span>
                        <span style={{ font: "500 13px/1 var(--font-sans)", background: "var(--stone-100)", padding: "7px 12px", borderRadius: 999 }}>{reason.name}</span>
                      </div>
                      <p style={{ margin: 0, font: "400 15px/1.55 var(--font-sans)", color: "var(--text-primary)" }}>{reason.text}</p>
                      <div><Badge tone={b.tone} icon={b.icon}>{b.label}</Badge></div>
                    </li>
                  );
                })}
              </ul>
              <p style={{ margin: "4px 0 0", paddingTop: 16, borderTop: "1px solid var(--border-subtle)", font: "400 13px/1.55 var(--font-sans)", color: "var(--text-muted)" }}>
                {BASIS_LABEL[item.basis]}. This is a suggestion based on what you chose, not a promise you’ll enjoy it.
              </p>
            </section>

            <section aria-labelledby="prac-h" style={{ background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(20px,3vw,32px)", boxShadow: "var(--shadow-1)" }}>
              <h2 id="prac-h" style={{ margin: 0, font: "500 clamp(1.1875rem,2vw,1.375rem)/1.3 var(--font-sans)", letterSpacing: "-.01em" }}>Practical details</h2>
              <dl style={{ margin: "14px 0 0", display: "grid", gridTemplateColumns: "minmax(96px,auto) minmax(0,1fr)", gap: "0 20px", font: "400 15px/1.5 var(--font-sans)" }}>
                <dt style={th}>Neighborhood</dt><dd style={{ ...td, fontWeight: candidate.neighborhood ? 500 : 400, color: candidate.neighborhood ? undefined : "var(--text-muted)" }}>{candidate.neighborhood ? `${candidate.neighborhood}, Raleigh, NC` : "Not available in our data yet"}</dd>
                <dt style={th}>Category</dt><dd style={{ ...td, fontWeight: 500 }}>{CATEGORY_LABEL[item.category]}</dd>
                <dt style={th}>Street address</dt><dd style={{ ...td, color: candidate.address ? undefined : "var(--text-muted)" }}>{candidate.address ?? "Not available in our data yet"}</dd>
                <dt style={th}>Price level</dt>
                <dd style={{ ...td, color: price ? undefined : "var(--text-muted)" }}>{price ? <>{price} <span style={{ color: "var(--text-muted)", fontSize: 13 }}>as listed by Qloo</span></> : "Price not available — check current details."}</dd>
                <dt style={th}>Website</dt>
                <dd style={td}>
                  {item.externalUrl ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                      <Button variant="secondary" iconRight="external-link" href={item.externalUrl} aria-label={`Visit ${candidate.name} website, opens in a new tab`}>Visit website</Button>
                      <span style={{ font: "400 12px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>{host}</span>
                    </div>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>No website available. We only link to a place’s own page when we have a reliable one.</span>
                  )}
                </dd>
              </dl>
              <p style={{ margin: "6px 0 0", display: "flex", alignItems: "center", gap: 10, background: "var(--apricot-50)", border: "1px dashed var(--apricot-500)", borderRadius: 12, padding: "12px 16px", font: "500 14px/1.45 var(--font-sans)", color: "var(--text-warm)" }}>
                <Icon name="clock" size={18} />{UNVERIFIED_NOTICE}
              </p>
              {extraNotices.length > 0 ? (
                <ul style={{ margin: "12px 0 0", paddingLeft: 18, font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>
                  {extraNotices.map((n) => <li key={n}>{n}</li>)}
                </ul>
              ) : null}
            </section>
          </div>

          <aside aria-label="Your decision" className="f90-decision">
            <div style={{ background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(18px,2.4vw,24px)", boxShadow: "var(--shadow-2)", display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="f90-decision__head">
                <div style={{ font: "600 11px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Your decision</div>
                <div style={{ font: "500 17px/1.35 var(--font-sans)" }}>Want to try {candidate.name}?</div>
                <p style={{ margin: 0, font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>Keep it in your plan, or swap in a different place for this routine.</p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <div style={{ flex: "1 1 150px" }}>
                  <Button variant={saved ? "secondary" : "primary"} size="lg" fullWidth iconLeft={saved ? "bookmark-check" : "bookmark"} aria-pressed={saved} onClick={() => dispatch({ type: "toggleSaved", itemId: item.id, saved: !saved })}>
                    {saved ? "Saved to my plan" : "Save this place"}
                  </Button>
                </div>
                <div style={{ flex: "1 1 150px" }}>
                  <Button variant="secondary" size="lg" fullWidth iconLeft="repeat" onClick={() => setReplacing(true)}>Replace suggestion</Button>
                </div>
              </div>
              <p className="f90-wide-only" style={{ margin: 0, font: "400 13px/1.5 var(--font-sans)", color: "var(--text-muted)" }}>Replacing keeps your preferences and offers a different place. You can undo it from your plan.</p>
            </div>
          </aside>
        </div>
      </main>

      {replacing ? (
        <ReplaceDialog
          session={session}
          item={item}
          candidate={candidate}
          onClose={() => setReplacing(false)}
          onReplaced={(nextSession, revision, message) => {
            dispatch({ type: "applyRevision", session: nextSession, itemId: revision.addedItemId ?? item.id, message, ...(revision.limitation ? { limitation: revision.limitation } : {}) });
            const addedStage = revision.addedItemId ? findItem(nextSession, revision.addedItemId)?.stage : undefined;
            dispatch({ type: "setStage", stage: addedStage === "first_month" ? "month" : addedStage === "months_2_3" ? "later" : "week" });
            router.push("/plan");
          }}
        />
      ) : null}
    </div>
  );
}
