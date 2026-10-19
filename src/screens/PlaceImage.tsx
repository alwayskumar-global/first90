"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanItem, PlanSession } from "@/domain/types";
import { Icon } from "@/components/Icon";
import { CATEGORY_ICON, imageSourceLabel, placeBadge } from "./placeView";

/**
 * A place's photo, or the category tile when there is none (CR-010). The tile is the same image-free variant the
 * design ships with, so a plan looks right whether no photo was found, the image failed to load, or it never will.
 * The photo is shown only if the server verified it; a browser-side load error falls back to the tile as well, so a
 * broken-image icon is never visible.
 */
export function usePlaceImage(item: PlanItem): { src: string | undefined; failed: () => void } {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = item.imageUrl && item.imageUrl !== failedSrc ? item.imageUrl : undefined;
  return { src, failed: () => setFailedSrc(item.imageUrl ?? null) };
}

function Photo({ name, src, onFail, hero }: { name: string; src: string; onFail: () => void; hero?: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) onFail(); // it failed before this component could listen
  }, [src, onFail]);
  return (
    // A plain <img>: the host is whatever Qloo or the venue returned, so Next's image optimizer is not used.
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} src={src} alt={name} loading={hero ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={onFail} />
  );
}

/** Top of a plan card: photo with category chip and source label, or the category tile. */
export function PlaceCardHeader({ item, session, name }: { item: PlanItem; session: PlanSession; name: string }) {
  const { src, failed } = usePlaceImage(item);
  const badge = placeBadge(item.category, session);
  if (!src) {
    return (
      <div className="f90-place__tile">
        <span className="f90-place__tile-ico"><Icon name={CATEGORY_ICON[item.category]} size={20} /></span>
        {badge}
      </div>
    );
  }
  return (
    <div className="f90-place__photo" data-image-source={item.imageSource}>
      <Photo name={name} src={src} onFail={failed} />
      <span className="f90-place__photo-cat"><Icon name={CATEGORY_ICON[item.category]} size={16} />{badge}</span>
      <span className="f90-place__photo-src">{imageSourceLabel(item)}</span>
    </div>
  );
}

/** Large image on the place detail screen; falls back to the category panel when there is no photo. */
export function PlaceHero({ item, session, name }: { item: PlanItem; session: PlanSession; name: string }) {
  const { src, failed } = usePlaceImage(item);
  const badge = placeBadge(item.category, session);
  if (!src) {
    return (
      <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 18, background: "var(--apricot-50)", border: "1px solid var(--apricot-100)", borderRadius: 20, padding: "clamp(20px,3vw,28px)" }}>
        <span style={{ flex: "none", width: 64, height: 64, borderRadius: "50%", background: "var(--apricot-100)", color: "var(--apricot-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={CATEGORY_ICON[item.category]} size={28} />
        </span>
        <div>
          <div style={{ font: "500 17px/1.3 var(--font-sans)" }}>{badge}</div>
          <p style={{ margin: "4px 0 0", font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)" }}>We only show a photo when a source provides one we can verify. There isn’t one for this place.</p>
        </div>
      </div>
    );
  }
  return (
    <figure style={{ margin: "18px 0 0" }}>
      <div className="f90-place__photo f90-place__photo--hero" data-image-source={item.imageSource}>
        <Photo name={name} src={src} onFail={failed} hero />
        <span className="f90-place__photo-cat"><Icon name={CATEGORY_ICON[item.category]} size={16} />{badge}</span>
      </div>
      <figcaption style={{ marginTop: 8, font: "400 13px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
        {item.imageSource === "wikimedia" && item.imageLink ? (
          <>
            Photo: {item.imageCredit ? `${item.imageCredit} · ` : ""}
            <a href={item.imageLink} target="_blank" rel="noopener noreferrer" aria-label="Wikimedia Commons file page (opens in a new tab)" style={{ color: "var(--text-action)" }}>Wikimedia Commons</a>
          </>
        ) : (
          imageSourceLabel(item)
        )}
        . It may not show the place as it is today.
      </figcaption>
    </figure>
  );
}
