/** Simplified illustration of the area, used while the real map loads and when it cannot (CR-007 fallback). */
export function AreaIllustration({ cx, cy, label, city, near, flex }: { cx: number; cy: number; label: string | null; city: boolean; near: boolean; flex: boolean }) {
  return (
    <div style={{ position: "relative", background: "var(--ivory-200)" }}>
      <Svg cx={cx} cy={cy} hasSel={label !== null} city={city} near={near} flex={flex} />
      {label ? (
        <span style={{ position: "absolute", left: `${(cx / 400) * 100}%`, top: `${((cy - 20 - 28) / 400) * 100}%`, transform: "translate(-50%,-100%)", padding: "6px 12px", borderRadius: 999, background: "var(--ink-900)", color: "var(--ivory-100)", font: "600 13px/1.2 var(--font-sans)", whiteSpace: "nowrap", boxShadow: "var(--shadow-2)" }}>
          {label}
        </span>
      ) : null}
    </div>
  );
}

function Svg({ cx, cy, hasSel, city, near, flex }: { cx: number; cy: number; hasSel: boolean; city: boolean; near: boolean; flex: boolean }) {
  const outline = "M60 120C80 50 190 30 270 50C350 70 380 150 360 240C345 330 300 400 210 410C120 420 50 360 40 270C35 210 45 170 60 120Z";
  return (
    <svg viewBox="0 20 400 400" width="100%" style={{ display: "block" }} aria-hidden="true" focusable="false">
      <defs><clipPath id="cityclip"><path d={outline} /></clipPath></defs>
      <rect y="0" width="400" height="440" fill="#EFEDE4" />
      <path d={outline} fill="#FCFBF8" />
      <g style={{ clipPath: "url(#cityclip)" }}>
        {city ? <rect width="400" height="440" fill="#EAF3F0" /> : null}
        {flex ? <circle cx={cx} cy={cy} r="128" fill="#EAF3F0" stroke="#2E7064" style={{ strokeWidth: 1.5, strokeDasharray: "6 6" }} /> : null}
        {near ? <circle cx={cx} cy={cy} r="66" fill="#D3E6E0" stroke="#2E7064" style={{ strokeWidth: 2 }} /> : null}
        <g transform="rotate(-14 200 220)" fill="none" style={{ stroke: "#DDD9CC", strokeWidth: 2 }}>
          <path d="M-80 20H480M-80 64H480M-80 108H480M-80 152H480M-80 196H480M-80 240H480M-80 284H480M-80 328H480M-80 372H480M-80 416H480M-80 460H480" />
          <path d="M-20 -80V520M28 -80V520M76 -80V520M124 -80V520M172 -80V520M220 -80V520M268 -80V520M316 -80V520M364 -80V520M412 -80V520" />
        </g>
        <g transform="rotate(-14 200 220)" fill="none" style={{ stroke: "#C7C2B2", strokeWidth: 5, strokeLinecap: "round" }}><path d="M-80 240H480M220 -80V520" /></g>
        <path d="M262 286h62a14 14 0 0 1 14 14v34a14 14 0 0 1-14 14h-62a14 14 0 0 1-14-14v-34a14 14 0 0 1 14-14z" fill="#A9CCC3" />
        <path d="M70 330C120 300 150 340 200 320S270 250 330 190" fill="none" style={{ stroke: "#A9CCC3", strokeWidth: 7, strokeLinecap: "round" }} />
        <path d="M90 110h46a10 10 0 0 1 10 10v26a10 10 0 0 1-10 10H90a10 10 0 0 1-10-10v-26a10 10 0 0 1 10-10z" fill="#A9CCC3" />
      </g>
      <path d={outline} fill="none" stroke="#858170" style={{ strokeWidth: 1.5 }} />
      {hasSel ? (
        <g transform={`translate(${cx} ${cy})`}>
          <circle r="10" fill="#FCFBF8" stroke="#1D4740" style={{ strokeWidth: 3.5 }} />
          <circle r="3.5" fill="#1D4740" />
        </g>
      ) : null}
    </svg>
  );
}
