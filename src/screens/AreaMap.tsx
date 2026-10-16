"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEMO_AREA } from "@/domain/demo";

/** OpenFreeMap serves free vector tiles from OpenStreetMap data, with no API key. */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export interface MapPoint {
  lat: number;
  lon: number;
}

export interface AreaMapProps {
  /** Pin: the chosen neighborhood or searched place. */
  pin: (MapPoint & { label: string }) | null;
  /** Distance limit shown as a circle around `ring`. Null = nothing chosen yet. */
  ring: (MapPoint & { radiusMeters: number }) | null;
  /** Description for assistive technology. */
  description: string;
  /** Rendered instead of the map when it cannot load (no WebGL, tiles blocked, offline). */
  fallback: React.ReactNode;
  onStateChange?: (state: "ready" | "fallback") => void;
}

/** A closed GeoJSON ring approximating a circle of `radiusMeters` around a point. */
export function circleRing(center: MapPoint, radiusMeters: number, steps = 72): [number, number][] {
  const earth = 6_371_000;
  const lat = (center.lat * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusMeters / earth) * Math.cos(angle);
    const dLon = (radiusMeters / (earth * Math.cos(lat))) * Math.sin(angle);
    ring.push([center.lon + (dLon * 180) / Math.PI, center.lat + (dLat * 180) / Math.PI]);
  }
  return ring;
}

const RING_SOURCE = "area-ring";

function pinElement(label: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none";
  const pill = document.createElement("span");
  pill.textContent = label;
  pill.style.cssText =
    "padding:6px 12px;border-radius:999px;background:#1c2420;color:#fcfbf8;font:600 13px/1.2 var(--font-sans),sans-serif;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.25)";
  const dot = document.createElement("span");
  dot.style.cssText = "width:20px;height:20px;border-radius:50%;background:#fcfbf8;border:3.5px solid #1d4740;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.3)";
  el.append(pill, dot);
  return el;
}

/**
 * Real map of the area (CR-007): MapLibre GL with OpenFreeMap tiles. Falls back to the supplied illustration
 * when WebGL or the tile server is unavailable, so the setup flow never depends on the map.
 */
export function AreaMap({ pin, ring, description, fallback, onStateChange }: AreaMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const latest = useRef({ pin, ring });
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");

  const notify = useRef(onStateChange);
  useEffect(() => {
    notify.current = onStateChange;
  });

  // Applies the current pin and ring to the map. Reads from `latest` so it is safe to call from any event.
  const sync = useRef(() => {});
  useEffect(() => {
    sync.current = () => {
      const m = map.current;
      const maplibre = lib.current;
      if (!m || !maplibre || !m.isStyleLoaded()) return;
      const { pin: nextPin, ring: nextRing } = latest.current;
      const source = m.getSource(RING_SOURCE) as { setData(data: unknown): void } | undefined;
      const data = nextRing
        ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(nextRing, nextRing.radiusMeters)] } }
        : { type: "FeatureCollection", features: [] };
      source?.setData(data);

      marker.current?.remove();
      marker.current = null;
      if (nextPin) {
        marker.current = new maplibre.Marker({ element: pinElement(nextPin.label), anchor: "bottom" }).setLngLat([nextPin.lon, nextPin.lat]).addTo(m);
      }

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (nextRing) {
        const ringCoords = circleRing(nextRing, nextRing.radiusMeters, 8);
        const bounds = ringCoords.reduce((b, c) => b.extend(c), new maplibre.LngLatBounds(ringCoords[0], ringCoords[0]));
        m.fitBounds(bounds, { padding: 36, maxZoom: 14, duration: reduce ? 0 : 600 });
      } else {
        m.easeTo({ center: [DEMO_AREA.center.lon, DEMO_AREA.center.lat], zoom: 9.6, duration: reduce ? 0 : 600 });
      }
    };
  });

  useEffect(() => {
    latest.current = { pin, ring };
    sync.current();
  }, [pin, ring]);

  useEffect(() => {
    let cancelled = false;
    const fail = () => {
      if (cancelled) return;
      setState("fallback");
      notify.current?.("fallback");
    };
    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !container.current) return;
        maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // copied by scripts/copy-maplibre-worker.mjs
        lib.current = maplibre;
        const m = new maplibre.Map({
          container: container.current,
          style: MAP_STYLE_URL,
          center: [DEMO_AREA.center.lon, DEMO_AREA.center.lat],
          zoom: 9.6,
          cooperativeGestures: true,
          attributionControl: { compact: true },
          maxBounds: [-79.4, 35.3, -77.9, 36.4],
        });
        map.current = m;
        m.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        let ready = false;
        const timeout = window.setTimeout(() => {
          if (!ready) fail();
        }, 10_000);
        m.on("load", () => {
          window.clearTimeout(timeout);
          ready = true;
          if (cancelled) return;
          m.addSource(RING_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          m.addLayer({ id: "area-ring-fill", type: "fill", source: RING_SOURCE, paint: { "fill-color": "#2e7064", "fill-opacity": 0.14 } });
          m.addLayer({ id: "area-ring-line", type: "line", source: RING_SOURCE, paint: { "line-color": "#2e7064", "line-width": 2, "line-dasharray": [2, 2] } });
          setState("ready");
          notify.current?.("ready");
          sync.current();
        });
        m.on("error", () => {
          // Before the style has loaded an error means there is no map to show (offline, blocked, bad response).
          // Later errors are single tiles, which MapLibre retries on its own.
          if (!ready) fail();
        });
      } catch {
        fail(); // WebGL unsupported or the library failed to load
      }
    })();
    return () => {
      cancelled = true;
      marker.current?.remove();
      marker.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  if (state === "fallback") return <div data-map-state="fallback">{fallback}</div>;
  return (
    <div style={{ position: "relative", aspectRatio: "1 / 1", background: "var(--ivory-200)" }} data-map-state={state}>
      <div ref={container} role="group" aria-label={description} style={{ position: "absolute", inset: 0 }} />
      {state === "loading" ? <div aria-hidden="true" style={{ position: "absolute", inset: 0 }}>{fallback}</div> : null}
    </div>
  );
}
