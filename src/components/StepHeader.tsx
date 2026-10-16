"use client";

import { useRouter } from "next/navigation";
import { Button } from "./ui";

/** Back link, wordmark and "Step n of 3" pill used by the three setup screens. */
export function StepHeader({ backHref, step, label }: { backHref: string; step: 1 | 2 | 3; label: string }) {
  const router = useRouter();
  return (
    <div className="f90-topbar">
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Button variant="text" iconLeft="arrow-left" onClick={() => router.push(backHref)}>Back</Button>
        <span aria-hidden="true" style={{ color: "var(--stone-300)", font: "300 22px/1 var(--font-sans)" }}>/</span>
        <span style={{ marginLeft: 8, font: "italic 400 26px/1 var(--font-serif)", color: "var(--ink-800)" }}>First 90 Days</span>
      </div>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={step}
        aria-valuetext={`Step ${step} of 3 — ${label}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "var(--bg-raised)", padding: "10px 18px", borderRadius: 999, boxShadow: "var(--shadow-1)", font: "500 14px/1 var(--font-sans)" }}
      >
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--evergreen-500)" }} />
        {`Step ${step} of 3 — ${label}`}
      </div>
    </div>
  );
}

export function StepTitle({ title, intro, maxWidth = 640 }: { title: string; intro: string; maxWidth?: number }) {
  return (
    <div style={{ marginTop: "clamp(28px,4vw,48px)", maxWidth }}>
      <h1 style={{ margin: 0, font: "400 clamp(2.125rem,4.4vw,3rem)/1.08 var(--font-serif)", letterSpacing: "-.02em", textWrap: "balance" }}>{title}</h1>
      <p style={{ margin: "16px 0 0", font: "400 clamp(1.0625rem,1.6vw,1.1875rem)/1.6 var(--font-sans)", color: "var(--text-secondary)", textWrap: "pretty" }}>{intro}</p>
    </div>
  );
}

export const eyebrow = {
  font: "600 12px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase" as const, color: "var(--text-secondary)",
};
