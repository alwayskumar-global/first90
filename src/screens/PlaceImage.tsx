"use client";

import { useEffect, useRef, useState } from "react";
import { createLoadWatchdog, type LoadWatchdog } from "@/lib/images/loadWatch";
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

/**
 * The photo frame: a tile-coloured placeholder with the category chip while the photo loads (never an empty box), the
 * photo fading in once it has, and a fall back to the tile if it errors or has not loaded 8 s after it came near the
 * viewport. The source credit appears only once the photo is actually showing.
 */
function PhotoFrame({ item, session, name, src, onFail, hero }: { item: PlanItem; session: PlanSession; name: string; src: string; onFail: () => void; hero?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const watchdog = useRef<LoadWatchdog | null>(null);
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  });

  useEffect(() => {
    const dog = createLoadWatchdog({ onTimeout: () => failRef.current() });
    watchdog.current = dog;
    const element = img.current;
    if (element?.complete) {
      if (element.naturalWidth > 0) {
        dog.settle();
        setLoaded(true);
      } else {
        dog.settle();
        failRef.current(); // it failed before this component could listen
      }
      return () => dog.settle();
    }
    // Time the photo only once it is near the viewport: a lazy image far below the fold has not started loading.
    const target = frame.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      dog.start();
      return () => dog.settle();
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        dog.start();
        observer.disconnect();
      }
    }, { rootMargin: "300px" });
    observer.observe(target);
    return () => {
      observer.disconnect();
      dog.settle();
    };
  }, [src]);

  const badge = placeBadge(item.category, session);
  return (
    <div ref={frame} className={`f90-place__photo${hero ? " f90-place__photo--hero" : ""}`} data-image-source={item.imageSource} data-loaded={loaded}>
      {loaded ? null : (
        <span className="f90-place__photo-ph" aria-hidden="true">
          <span className="f90-place__tile-ico f90-place__photo-ph-ico"><Icon name={CATEGORY_ICON[item.category]} size={26} /></span>
        </span>
      )}
      {/* A plain <img>: the host is whatever Qloo or the venue returned, so Next's image optimizer is not used. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={img}
        src={src}
        alt={name}
        loading={hero ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => {
          watchdog.current?.settle();
          setLoaded(true);
        }}
        onError={() => {
          watchdog.current?.settle();
          onFail();
        }}
      />
      <span className="f90-place__photo-cat"><Icon name={CATEGORY_ICON[item.category]} size={16} />{badge}</span>
      {loaded && !hero ? <span className="f90-place__photo-src">{imageSourceLabel(item)}</span> : null}
    </div>
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
  return <PhotoFrame key={src} item={item} session={session} name={name} src={src} onFail={failed} />;
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
      <PhotoFrame key={src} item={item} session={session} name={name} src={src} onFail={failed} hero />
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
