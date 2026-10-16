"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { DEMO_AREA, NEIGHBORHOODS, SEARCH_SCOPES, type ScopeKey } from "@/domain/demo";
import { Icon } from "@/components/Icon";
import { StepHeader, StepTitle, eyebrow } from "@/components/StepHeader";
import { Button, Chip, StateBanner } from "@/components/ui";
import { searchAreasRequest } from "@/lib/flow/api";
import { useFlow } from "@/lib/flow/FlowProvider";
import type { GeocodeResult } from "@/lib/geocode/photon";
import { AreaIllustration } from "./AreaIllustration";
import { AreaMap } from "./AreaMap";
import { NEIGHBORHOOD_CARDS, SCOPE_CARDS, type NeighborhoodCard } from "./areaData";

/** Arrow-key navigation inside a radio group, as in the design prototypes. */
function onGroupKey(event: KeyboardEvent<HTMLElement>) {
  const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
  if (!delta) return;
  event.preventDefault();
  const group = event.currentTarget.closest("[role=radiogroup]");
  if (!group) return;
  const radios = Array.from(group.querySelectorAll<HTMLElement>("[role=radio]")).filter((el) => el.getAttribute("aria-disabled") !== "true");
  const next = radios[(radios.indexOf(event.currentTarget) + delta + radios.length) % radios.length];
  next?.focus();
  next?.click();
}

const radioDot = (on: boolean, size = 22) =>
  on ? (
    <span style={{ flex: "none", color: "var(--evergreen-600)", display: "inline-flex" }}><Icon name="circle-check" size={size + 2} /></span>
  ) : (
    <span style={{ flex: "none", width: size, height: size, borderRadius: "50%", border: "1.5px solid var(--border-control)", margin: 1 }} />
  );

export function Location() {
  const router = useRouter();
  const { state, dispatch } = useFlow();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { neighborhoodKey, custom, unsure } = state.area;
  const scope: ScopeKey = unsure && state.area.scope === "nearby" ? "city" : state.area.scope;
  const selected = NEIGHBORHOOD_CARDS.find((n) => n.key === neighborhoodKey) ?? null;
  const selectedName = selected?.name ?? custom?.label ?? null;
  const [query, setQuery] = useState(selectedName ?? "");
  const [mapState, setMapState] = useState<"ready" | "fallback" | null>(null);

  const q = query.trim();
  const ql = q.toLowerCase();
  const searching = !!q && !(selectedName && ql === selectedName.toLowerCase());

  // Live place search (CR-007): typed text goes to our /api/geocode, debounced. State is only set from async callbacks.
  const remoteWanted = searching && q.length >= 2;
  const [remote, setRemote] = useState<{ q: string; status: "ok" | "error"; results: GeocodeResult[] }>({ q: "", status: "ok", results: [] });
  useEffect(() => {
    if (!remoteWanted) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setRemote({ q, status: "ok", results: await searchAreasRequest(q, controller.signal) });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRemote({ q, status: "error", results: [] });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, remoteWanted]);
  const remoteState = remoteWanted && remote.q === q ? remote : null;
  const loading = remoteWanted && !remoteState;

  const curated = useMemo<NeighborhoodCard[]>(
    () => (searching ? NEIGHBORHOOD_CARDS.filter((n) => `${n.name} ${n.tag}`.toLowerCase().includes(ql)) : []),
    [searching, ql],
  );
  const searched = useMemo<GeocodeResult[]>(
    () => (remoteState?.status === "ok" ? remoteState.results.filter((r) => !NEIGHBORHOOD_CARDS.some((n) => n.name.toLowerCase() === r.label.toLowerCase())) : []),
    [remoteState],
  );
  const searchDown = searching && remoteState?.status === "error";
  const list = useMemo<NeighborhoodCard[]>(() => {
    if (searching && !(searchDown && curated.length === 0)) return curated;
    const base = selected ? [selected, ...NEIGHBORHOOD_CARDS.filter((n) => n.key !== selected.key)] : NEIGHBORHOOD_CARDS;
    return base.slice(0, 4);
  }, [searching, searchDown, curated, selected]);
  const noMatch = searching && curated.length === 0 && remoteState?.status === "ok" && searched.length === 0;
  const notReady = !selectedName && !unsure;

  const pick = (card: NeighborhoodCard) => {
    dispatch({ type: "setNeighborhood", key: card.key });
    setQuery(card.name);
  };
  const pickSearched = (result: GeocodeResult) => {
    dispatch({ type: "setCustomArea", area: { lat: result.lat, lon: result.lon, label: result.label } });
    setQuery(result.label);
  };
  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  const pinPoint = useMemo(() => {
    if (selected) return { lat: NEIGHBORHOODS[selected.key].lat, lon: NEIGHBORHOODS[selected.key].lon, label: selected.name };
    if (custom) return { lat: custom.lat, lon: custom.lon, label: custom.label };
    return null;
  }, [selected, custom]);
  const radiusMeters = SEARCH_SCOPES[scope].radiusMeters;
  const ringPoint = useMemo(() => {
    if (pinPoint) return { lat: pinPoint.lat, lon: pinPoint.lon, radiusMeters };
    if (unsure) return { lat: DEMO_AREA.center.lat, lon: DEMO_AREA.center.lon, radiusMeters };
    return null;
  }, [pinPoint, unsure, radiusMeters]);

  // Position on the simplified illustration (about 13 px per km around downtown), used only as the map fallback.
  const clamp = (v: number) => Math.max(60, Math.min(340, v));
  const cx = selected ? selected.x : custom ? clamp(200 + (custom.lon - DEMO_AREA.center.lon) * Math.cos((DEMO_AREA.center.lat * Math.PI) / 180) * 111.32 * 13) : 200;
  const cy = selected ? selected.y : custom ? clamp(215 - (custom.lat - DEMO_AREA.center.lat) * 110.57 * 13) : 215;
  const hasArea = !!selectedName || unsure;
  let mapTitle = "Raleigh";
  let mapChip = "Pick an area";
  let mapBody = "Choose a neighborhood and we’ll show the area we’ll start from.";
  if (selectedName) {
    mapTitle = `${selectedName} focus`;
    mapChip = scope === "nearby" ? "Close-by focus" : scope === "city" ? "Across the city" : "Close, with room to stretch";
    mapBody =
      scope === "nearby"
        ? `We’ll focus on places close to ${selectedName}.`
        : scope === "city"
          ? `We’ll look across Raleigh, beginning from ${selectedName}.`
          : `We’ll lean close to ${selectedName}, and look further out when a place fits.`;
  } else if (unsure) {
    mapTitle = "All of Raleigh";
    mapChip = "City-wide start";
    mapBody = scope === "flexible" ? "We’ll start across the city and narrow in as you tell us more." : "We’ll start across the city. You can pick a neighborhood anytime.";
  }
  const statusText = selectedName
    ? `Ready: ${selectedName} • Selected for your first recommendations`
    : unsure
      ? "Ready: All of Raleigh • You can narrow in anytime"
      : "Choose a neighborhood, or “I’m not sure yet”, to continue.";

  const rowCard = (on: boolean) => ({
    padding: "14px 18px", minHeight: 64, borderRadius: 12,
    border: on ? "1.5px solid var(--evergreen-500)" : "1.5px solid transparent",
    background: on ? "var(--stone-100)" : "var(--bg-raised)", boxShadow: on ? "none" : "var(--shadow-1)",
  });

  const renderSearched = (r: { label: string; detail: string; lat: number; lon: number }) => {
    const on = !!custom && custom.lat === r.lat && custom.lon === r.lon && !unsure;
    return (
      <button key={`${r.label}|${r.lat}|${r.lon}`} type="button" role="radio" aria-checked={on} className="f90-radio-card f90-focusable" onClick={() => pickSearched(r)} onKeyDown={onGroupKey} style={rowCard(on)}>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ font: "500 16px/1.3 var(--font-sans)" }}>{r.label}</span>
          {r.detail ? <span style={{ font: "400 14px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{r.detail}</span> : null}
        </span>
        {radioDot(on, 22)}
      </button>
    );
  };

  return (
    <div className="f90-page">
      <main id="main" className="f90-wrap">
        <StepHeader backHref="/" step={1} label="Your location" />
        <StepTitle
          title="Where are you settling in?"
          intro="We’ll start close to your neighborhood so your first everyday spots feel easy to try on a quiet morning."
        />

        <div className="f90-split">
          <div className="f90-split__form">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={eyebrow}>Demo territory</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, background: "var(--bg-raised)", borderRadius: 16, padding: "18px 20px", boxShadow: "var(--shadow-1)" }}>
                <span style={{ flex: "none", width: 48, height: 48, borderRadius: 12, background: "var(--ivory-200)", color: "var(--evergreen-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name="building-2" size={22} />
                </span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px" }}>
                    <span style={{ font: "500 clamp(1.125rem,2vw,1.375rem)/1.2 var(--font-sans)" }}>Raleigh, North Carolina</span>
                    <span style={{ font: "600 11px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--apricot-700)", background: "var(--apricot-100)", padding: "6px 10px", borderRadius: 999 }}>Demo city</span>
                  </div>
                  <div style={{ font: "400 14px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>Carefully mapped for Greater Raleigh. This demo covers one city.</div>
                </div>
                <span aria-hidden="true" style={{ flex: "none", color: "var(--stone-500)" }}><Icon name="lock" size={20} /></span>
              </div>
            </div>

            <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "4px 16px" }}>
                <label htmlFor={inputId} style={eyebrow}>Neighborhood or area</label>
                <span style={{ font: "400 13px/1.3 var(--font-sans)", color: "var(--text-muted)" }}>Pick an area, or let us start wide</span>
              </div>
              <div className="f90-input-wrap">
                <Icon name="search" size={18} />
                <input
                  id={inputId}
                  ref={inputRef}
                  className="f90-input f90-input--icon"
                  style={{ paddingRight: 48, borderColor: "var(--stone-200)", boxShadow: "var(--shadow-1)" }}
                  autoComplete="off"
                  placeholder="Search a neighborhood, like Five Points"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    dispatch({ type: "clearArea" });
                  }}
                />
                {query ? (
                  <span className="f90-input-wrap__end">
                    <button
                      type="button"
                      aria-label="Clear area"
                      className="f90-focusable"
                      onClick={() => {
                        setQuery("");
                        dispatch({ type: "clearArea" });
                        focusInput();
                      }}
                      style={{ width: 40, height: 40, border: 0, borderRadius: 10, background: "transparent", color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                    >
                      <Icon name="x" size={18} />
                    </button>
                  </span>
                ) : null}
              </div>

              <div role="radiogroup" aria-label="Neighborhood" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {custom && !unsure && !searching ? renderSearched({ ...custom, label: custom.label, detail: "Searched place" }) : null}
                {list.map((n) => {
                  const on = n.key === neighborhoodKey && !unsure;
                  return (
                    <button key={n.key} type="button" role="radio" aria-checked={on} className="f90-radio-card f90-focusable" onClick={() => pick(n)} onKeyDown={onGroupKey} style={rowCard(on)}>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" }}>
                          <span style={{ font: "500 16px/1.3 var(--font-sans)" }}>{n.name}</span>
                          <span style={{ font: "500 12px/1 var(--font-sans)", color: "var(--text-secondary)", background: "var(--ivory-200)", padding: "5px 8px", borderRadius: 6 }}>{n.tag}</span>
                        </span>
                        <span style={{ font: "400 14px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>{n.desc}</span>
                      </span>
                      {radioDot(on, 22)}
                    </button>
                  );
                })}
                {searched.map(renderSearched)}
                <button
                  type="button"
                  role="radio"
                  aria-checked={unsure}
                  className="f90-radio-card f90-focusable"
                  onClick={() => {
                    dispatch({ type: "setUnsure" });
                    setQuery("");
                  }}
                  onKeyDown={onGroupKey}
                  style={{ padding: 18, borderRadius: 12, border: unsure ? "1.5px solid var(--evergreen-500)" : "1.5px solid transparent", background: "var(--stone-100)", marginTop: 4 }}
                >
                  <span style={{ flex: "none", width: 44, height: 44, borderRadius: "50%", background: "var(--bg-raised)", color: "var(--apricot-700)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="compass" size={20} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ font: "500 clamp(1.0625rem,2vw,1.25rem)/1.3 var(--font-sans)" }}>I’m not sure yet</span>
                    <span style={{ font: "400 14px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>Start from all of Raleigh, then narrow in as your first weeks unfold.</span>
                  </span>
                  {radioDot(unsure, 22)}
                </button>
              </div>

              {loading ? <p role="status" style={{ margin: 0, font: "400 13px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>Searching Raleigh…</p> : null}
              {searchDown ? (
                <p role="status" style={{ margin: 0, font: "400 13px/1.45 var(--font-sans)", color: "var(--text-secondary)" }}>
                  Live place search isn’t available right now. You can still pick one of our areas, or start from all of Raleigh.
                </p>
              ) : null}
              {noMatch ? (
                <StateBanner tone="empty" icon="search" title={`No area found for “${q}”`}>
                  <p className="f90-state__body">This demo covers the Raleigh area only. Check the spelling, try one of these areas, or start from all of Raleigh.</p>
                  <div className="f90-chips">
                    {(["downtown", "five-points", "cameron"] as const).map((key) => {
                      const card = NEIGHBORHOOD_CARDS.find((n) => n.key === key)!;
                      return <Chip key={key} label={card.name} onClick={() => pick(card)} />;
                    })}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                    <Button variant="secondary" size="sm" onClick={() => { setQuery(""); dispatch({ type: "clearArea" }); focusInput(); }}>Try another area</Button>
                    <Button variant="text" size="sm" onClick={() => { dispatch({ type: "setUnsure" }); setQuery(""); }}>I’m not sure yet</Button>
                  </div>
                </StateBanner>
              ) : null}
              <div style={{ font: "400 12px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>
                Neighborhood notes are illustrative for this demo. Typed searches go through our server to Photon (data © OpenStreetMap contributors) and are not stored; the map loads from OpenFreeMap.
              </div>
            </div>

            <fieldset style={{ border: 0, margin: "36px 0 0", padding: 0, minWidth: 0 }}>
              <legend style={{ padding: 0, ...eyebrow }}>How wide should we look?</legend>
              <div role="radiogroup" aria-label="Search area" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))", gap: 12 }}>
                {SCOPE_CARDS.map((card) => {
                  const on = scope === card.value;
                  const disabled = card.value === "nearby" && unsure;
                  return (
                    <button
                      key={card.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-disabled={disabled}
                      className="f90-focusable"
                      onClick={() => { if (!disabled) dispatch({ type: "setScope", scope: card.value }); }}
                      onKeyDown={onGroupKey}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, width: "100%", textAlign: "left", font: "inherit",
                        cursor: disabled ? "not-allowed" : "pointer", color: disabled ? "var(--stone-500)" : "var(--text-primary)",
                        border: on ? "2px solid var(--evergreen-500)" : "2px solid transparent", background: disabled ? "var(--bg-sunken)" : "var(--bg-raised)",
                        boxShadow: on || disabled ? "none" : "var(--shadow-1)", borderRadius: 16, padding: on ? "15px 17px" : "16px 18px",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
                        <span style={{ font: "500 17px/1.3 var(--font-sans)" }}>{card.title}</span>
                        {radioDot(on, 20)}
                      </span>
                      <span style={{ font: "400 14px/1.5 var(--font-sans)", color: "var(--text-secondary)", flex: 1 }}>
                        {disabled ? "Needs a neighborhood. Choose one to use this." : card.desc}
                      </span>
                      <span style={{ font: "500 13px/1.3 var(--font-sans)", color: "var(--text-muted)" }}>
                        {card.foot} {"·"} up to {SEARCH_SCOPES[card.value].radiusMeters / 1000} km
                      </span>
                    </button>
                  );
                })}
              </div>
              <p style={{ margin: "12px 0 0", font: "400 13px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>
                We only suggest places inside the distance you pick. You can change it anytime.
              </p>
            </fieldset>
          </div>

          <div className="f90-split__actions">
            <div className="f90-actions-row">
              <Button variant="text" onClick={() => router.push("/")}>Back to Welcome</Button>
              <div style={{ flex: "0 1 240px", minWidth: 180 }} className="f90-continue">
                <Button variant="primary" size="lg" iconRight="arrow-right" fullWidth disabled={notReady} onClick={() => router.push("/interests")}>Continue</Button>
              </div>
            </div>
            <p style={{ margin: "14px 0 0", display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 8, textAlign: "center", font: "400 13px/1.45 var(--font-sans)", color: "var(--text-muted)" }}>
              {notReady ? <Icon name="info" size={16} /> : null}
              <span role="status">{statusText}</span>
            </p>
          </div>

          <aside aria-label="Area preview" className="f90-split__aside">
            <div style={{ background: "var(--bg-raised)", borderRadius: 20, padding: "clamp(16px,2.4vw,24px)", boxShadow: "var(--shadow-1)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "8px 12px" }}>
                <div>
                  <div style={eyebrow}>Area preview</div>
                  <div style={{ marginTop: 6, font: "500 clamp(1.125rem,2vw,1.375rem)/1.25 var(--font-sans)" }}>{mapTitle}</div>
                </div>
                <span style={{ font: "500 12px/1 var(--font-sans)", color: "var(--text-secondary)", background: "var(--ivory-200)", padding: "7px 12px", borderRadius: 999, whiteSpace: "nowrap" }}>Raleigh, NC</span>
              </div>
              <div style={{ position: "relative", marginTop: 16, borderRadius: 14, overflow: "hidden", background: "var(--ivory-200)" }}>
                <AreaMap
                  pin={pinPoint}
                  ring={ringPoint}
                  description={`Map of ${mapTitle}. ${mapBody}`}
                  onStateChange={setMapState}
                  fallback={<AreaIllustration cx={cx} cy={cy} label={pinPoint?.label ?? null} city={scope === "city" && hasArea} near={!!pinPoint && scope !== "city"} flex={!!pinPoint && scope === "flexible"} />}
                />
                <span style={{ position: "absolute", left: 12, bottom: 12, display: "inline-flex", alignItems: "center", gap: 8, background: "var(--bg-raised)", padding: "7px 12px", borderRadius: 8, font: "500 13px/1 var(--font-sans)", boxShadow: "var(--shadow-1)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--evergreen-500)" }} />
                  {mapChip}
                </span>
              </div>
              <p style={{ margin: "16px 0 0", font: "400 14px/1.55 var(--font-sans)", color: "var(--text-secondary)" }}>{mapBody}</p>
              <p style={{ margin: "8px 0 0", font: "400 12px/1.4 var(--font-sans)", color: "var(--text-muted)" }}>
                {mapState === "ready" ? "Map © OpenStreetMap contributors, tiles by OpenFreeMap. The dashed circle is your distance limit." : "Simplified illustration. Not a verified map."}
              </p>
            </div>

            <div className="f90-wide-only">
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "var(--bg-raised)", borderRadius: 20, padding: 24, boxShadow: "var(--shadow-1)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, font: "500 20px/1.3 var(--font-sans)" }}>
                    <span style={{ color: "var(--apricot-700)", display: "inline-flex" }}><Icon name="badge-check" size={24} /></span>
                    What your area shapes
                  </div>
                  <ul style={{ listStyle: "none", margin: "18px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
                    {[
                      { icon: "map-pin" as const, head: "Starting point.", text: "First suggestions begin near your neighborhood, or across Raleigh if you’re not sure yet." },
                      { icon: "footprints" as const, head: "How wide we look.", text: "Nearby, Flexible, or Across the city sets the distance limit for suggestions." },
                      { icon: "repeat" as const, head: "Always adjustable.", text: "You can change your area and preferences anytime." },
                    ].map((row) => (
                      <li key={row.head} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                        <span style={{ color: "var(--evergreen-600)", marginTop: 2, display: "inline-flex" }}><Icon name={row.icon} size={20} /></span>
                        <span style={{ font: "400 14px/1.55 var(--font-sans)", color: "var(--text-secondary)" }}>
                          <b style={{ fontWeight: 600, color: "var(--text-primary)" }}>{row.head}</b> {row.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", background: "var(--stone-100)", borderRadius: 20, padding: "22px 24px" }}>
                  <span style={{ color: "var(--apricot-700)", marginTop: 2, display: "inline-flex" }}><Icon name="armchair" size={22} /></span>
                  <p style={{ margin: 0, font: "italic 400 18px/1.55 var(--font-serif)", color: "var(--ink-800)" }}>
                    “You don’t discover a city by doing everything at once. You discover it by finding one bench, one counter, and one walk that feels yours.”
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
