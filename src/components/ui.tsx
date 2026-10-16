"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "text" | "destructive";

interface ButtonOwnProps {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  iconLeft?: IconName;
  iconRight?: IconName;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** Render as a link. Internal paths use next/link; external URLs open in a new tab. */
  href?: string;
  children: ReactNode;
}

type ButtonProps = ButtonOwnProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "disabled" | "type">;

/** Design-system button (f90-btn). Disabled buttons stay focusable and use aria-disabled, per the design system. */
export function Button({
  variant = "primary", size = "md", iconLeft, iconRight, fullWidth, loading, disabled, href, onClick, children, ...rest
}: ButtonProps) {
  const cls = ["f90-btn", `f90-btn--${variant}`, size !== "md" && `f90-btn--${size}`, fullWidth && "f90-btn--block"]
    .filter(Boolean)
    .join(" ");
  const blocked = disabled || loading;
  const iconSize = size === "sm" ? 16 : 18;
  const content = (
    <>
      {loading ? <Icon name="loader-circle" size={iconSize} className="f90-spin" /> : iconLeft ? <Icon name={iconLeft} size={iconSize} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
      {loading ? <span className="f90-sr">Loading</span> : null}
    </>
  );
  if (href) {
    const external = /^https?:\/\//.test(href);
    const common = { className: cls, "aria-disabled": blocked ? true : undefined, "aria-label": rest["aria-label"] };
    return external ? (
      <a href={href} target="_blank" rel="noopener noreferrer" {...common}>{content}</a>
    ) : (
      <Link href={href} {...common}>{content}</Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      aria-disabled={blocked ? true : undefined}
      aria-busy={loading ? true : undefined}
      onClick={(event) => {
        if (blocked) return event.preventDefault();
        onClick?.(event);
      }}
      {...rest}
    >
      {content}
    </button>
  );
}

type BadgeTone = "neutral" | "verified" | "check" | "danger" | "saved";
const DEFAULT_BADGE_ICON: Record<BadgeTone, IconName | null> = {
  verified: "circle-check", check: "clock", neutral: null, danger: "circle-alert", saved: "bookmark-check",
};

export function Badge({ tone = "neutral", icon, children }: { tone?: BadgeTone; icon?: IconName | null; children: ReactNode }) {
  const name = icon === undefined ? DEFAULT_BADGE_ICON[tone] : icon;
  return (
    <span className={`f90-badge f90-badge--${tone}`}>
      {name ? <Icon name={name} size={14} strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

export function Chip({ label, onClick, pressed }: { label: string; onClick?: () => void; pressed?: boolean }) {
  return (
    <button type="button" className="f90-chip" aria-pressed={pressed} onClick={onClick}>
      {pressed ? <Icon name="check" size={16} strokeWidth={2.25} /> : null}
      {label}
    </button>
  );
}

export type StageId = "week" | "month" | "later";
export const STAGES: { id: StageId; key: "first_week" | "first_month" | "months_2_3"; label: string; short: string; range: string }[] = [
  { id: "week", key: "first_week", label: "First Week", short: "Week 1", range: "Days 1–7" },
  { id: "month", key: "first_month", label: "First Month", short: "Month 1", range: "Days 8–30" },
  { id: "later", key: "months_2_3", label: "Months 2–3", short: "Months 2–3", range: "Days 31–90" },
];

export function StageNav({ current, reviewed, onSelect }: { current: StageId; reviewed: StageId[]; onSelect: (id: StageId) => void }) {
  return (
    <nav className="f90-stage-wrap" aria-label="Your first 90 days">
      <ol className="f90-stage">
        {STAGES.map((stage, i) => {
          const isCurrent = stage.id === current;
          const state = isCurrent ? "current" : reviewed.includes(stage.id) ? "done" : "upcoming";
          return (
            <li key={stage.id}>
              <button
                type="button"
                className="f90-stage__item"
                data-state={state}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => onSelect(stage.id)}
              >
                <span className="f90-stage__top">
                  <span className="f90-stage__num" aria-hidden="true">{state === "done" ? "✓" : i + 1}</span>
                  <span className="f90-stage__tag">{isCurrent ? "Current" : state === "done" ? "Reviewed" : ""}</span>
                </span>
                <span className="f90-stage__label f90-stage__long">{stage.label}</span>
                <span className="f90-stage__short">{stage.short}</span>
                <span className="f90-stage__range">{stage.range}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type StateTone = "default" | "partial" | "error" | "empty";

/** Design-system state banner (loading/empty/partial/error messages). */
export function StateBanner({
  tone = "default", icon, title, role = "status", children,
}: { tone?: StateTone; icon: IconName; title: string; role?: "status" | "alert"; children?: ReactNode }) {
  return (
    <section className={`f90-state${tone === "default" ? "" : ` f90-state--${tone}`}`} role={role}>
      <span className="f90-state__icon"><Icon name={icon} size={20} /></span>
      <div className="f90-state__main">
        <h3 className="f90-state__title">{title}</h3>
        {children}
      </div>
    </section>
  );
}

export const eyebrowStyle = {
  font: "600 12px/1.3 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase" as const, color: "var(--text-secondary)",
};
