"use client";

import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { Button } from "@/components/ui";
import { useFlow } from "@/lib/flow/FlowProvider";

const S = { display: "block" } as const;

function CafeIllustration() {
  const stripes = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <svg viewBox="0 0 260 220" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={S}>
      <rect width="260" height="220" fill="#F8E0CF" />
      {stripes.map((i) => (
        <rect key={`s${i}`} x={i * 32.5} y="0" width="32.5" height="46" fill={i % 2 === 0 ? "#E8AE89" : "#FCFBF8"} />
      ))}
      {stripes.map((i) => (
        <circle key={`c${i}`} cx={16.25 + i * 32.5} cy="46" r="16.25" fill={i % 2 === 0 ? "#E8AE89" : "#FCFBF8"} />
      ))}
      <rect x="28" y="72" width="204" height="116" rx="6" fill="#FCF1E9" stroke="#203431" style={{ strokeWidth: 4 }} />
      <rect x="79" y="74" width="2" height="18" fill="#203431" />
      <path d="M68 106a12 12 0 0 1 24 0z" fill="#E8AE89" />
      <rect x="189" y="74" width="2" height="12" fill="#203431" />
      <path d="M178 98a12 12 0 0 1 24 0z" fill="#E8AE89" />
      <rect x="124" y="74" width="3" height="112" fill="#203431" />
      <rect x="146" y="112" width="70" height="3" fill="#203431" />
      <rect x="152" y="101" width="9" height="11" rx="2" fill="#A9CCC3" />
      <rect x="167" y="99" width="9" height="13" rx="2" fill="#2E7064" />
      <rect x="182" y="102" width="9" height="10" rx="2" fill="#C97F4F" />
      <rect x="40" y="152" width="70" height="4" rx="2" fill="#203431" />
      <rect x="73" y="156" width="4" height="26" fill="#203431" />
      <rect x="56" y="144" width="11" height="8" rx="2" fill="#E8AE89" />
      <rect x="82" y="145" width="10" height="7" rx="2" fill="#A9CCC3" />
      <circle cx="168" cy="128" r="9" fill="#C97F4F" />
      <rect x="155" y="138" width="26" height="34" rx="11" fill="#2E7064" />
      <rect x="140" y="156" width="70" height="4" rx="2" fill="#203431" />
      <rect x="172" y="160" width="4" height="26" fill="#203431" />
      <rect x="150" y="148" width="11" height="8" rx="2" fill="#FCFBF8" />
      <rect x="20" y="188" width="220" height="8" fill="#203431" />
      <rect x="28" y="196" width="64" height="30" fill="#25594F" />
      <circle cx="46" cy="192" r="14" fill="#2E7064" />
      <circle cx="66" cy="188" r="17" fill="#1D4740" />
      <circle cx="82" cy="194" r="11" fill="#2E7064" />
    </svg>
  );
}

// [x, y, width, height, fill] for each book spine, copied from the design illustration.
const BOOKS: [number, number, number, number, string][] = [
  [38,74,10,34,"#E8AE89"],[48,80,8,28,"#2E7064"],[56,70,12,38,"#C7C2B2"],[68,78,9,30,"#C97F4F"],[77,72,10,36,"#203431"],[87,76,11,32,"#A9CCC3"],[98,70,8,38,"#E8AE89"],[106,78,12,30,"#1D4740"],[118,72,9,36,"#C7C2B2"],[127,80,11,28,"#2E7064"],[138,74,10,34,"#C97F4F"],[148,70,12,38,"#A9CCC3"],[160,78,8,30,"#E8AE89"],[168,72,10,36,"#203431"],[178,76,9,32,"#2E7064"],[187,70,12,38,"#C97F4F"],[199,80,10,28,"#C7C2B2"],[209,74,12,34,"#1D4740"],
  [38,120,12,36,"#A9CCC3"],[50,126,9,30,"#E8AE89"],[59,118,10,38,"#203431"],[69,128,11,28,"#C7C2B2"],[80,122,8,34,"#2E7064"],[88,118,12,38,"#C97F4F"],[100,126,10,30,"#1D4740"],[110,120,9,36,"#E8AE89"],[119,124,11,32,"#A9CCC3"],[130,118,10,38,"#C7C2B2"],[140,128,8,28,"#2E7064"],[148,122,12,34,"#203431"],[160,120,10,36,"#C97F4F"],[170,126,9,30,"#E8AE89"],[179,118,12,38,"#A9CCC3"],[191,124,10,32,"#1D4740"],[201,120,11,36,"#C7C2B2"],[212,128,9,28,"#2E7064"],
  [38,172,10,32,"#203431"],[48,168,12,36,"#E8AE89"],[60,176,9,28,"#2E7064"],[69,170,11,34,"#C97F4F"],[80,174,10,30,"#C7C2B2"],[90,168,8,36,"#A9CCC3"],[98,172,12,32,"#1D4740"],[110,166,10,38,"#E8AE89"],[120,174,9,30,"#203431"],[129,168,11,36,"#2E7064"],[140,176,10,28,"#C97F4F"],[150,170,12,34,"#C7C2B2"],[162,166,8,38,"#A9CCC3"],[170,174,10,30,"#E8AE89"],[180,168,11,36,"#1D4740"],[191,172,9,32,"#203431"],[200,176,12,28,"#2E7064"],[212,170,9,34,"#C97F4F"],
];

function BookshopIllustration() {
  return (
    <svg viewBox="0 0 260 220" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={S}>
      <rect width="260" height="220" fill="#25594F" />
      <rect width="260" height="40" fill="#1D4740" />
      <path d="M130 14c-8-5-17-5-24-3v18c7-2 16-2 24 3z" fill="#E8AE89" />
      <path d="M130 14c8-5 17-5 24-3v18c-7-2-16-2-24 3z" fill="#F8E0CF" />
      <rect x="28" y="56" width="204" height="150" fill="#FCF1E9" stroke="#203431" style={{ strokeWidth: 4 }} />
      <rect x="30" y="108" width="200" height="4" fill="#203431" />
      <rect x="30" y="156" width="200" height="4" fill="#203431" />
      {BOOKS.map(([x, y, w, h, fill], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />
      ))}
    </svg>
  );
}

function StreetIllustration() {
  return (
    <svg viewBox="0 0 300 520" preserveAspectRatio="xMidYMax slice" width="100%" height="100%" style={S}>
      <rect width="300" height="520" fill="#FCF1E9" />
      <rect x="-10" y="220" width="112" height="232" fill="#DDD9CC" />
      <rect x="16" y="250" width="26" height="38" fill="#FCFBF8" />
      <rect x="60" y="250" width="26" height="38" fill="#FCFBF8" />
      <rect x="16" y="308" width="26" height="38" fill="#FCFBF8" />
      <rect x="60" y="308" width="26" height="38" fill="#FCFBF8" />
      <rect x="100" y="168" width="114" height="284" fill="#A9CCC3" />
      <rect x="118" y="196" width="28" height="48" rx="14" fill="#FCFBF8" />
      <rect x="168" y="196" width="28" height="48" rx="14" fill="#FCFBF8" />
      <rect x="118" y="262" width="28" height="48" rx="14" fill="#FCFBF8" />
      <rect x="168" y="262" width="28" height="48" rx="14" fill="#FCFBF8" />
      <rect x="108" y="352" width="98" height="22" fill="#E8AE89" />
      <rect x="108" y="374" width="98" height="4" fill="#C97F4F" />
      <rect x="116" y="382" width="82" height="70" fill="#FCFBF8" />
      <rect x="152" y="382" width="3" height="70" fill="#203431" />
      <rect x="212" y="250" width="100" height="202" fill="#2E7064" />
      <rect x="212" y="242" width="100" height="8" fill="#1D4740" />
      <rect x="230" y="274" width="24" height="34" fill="#F8E0CF" />
      <rect x="266" y="274" width="24" height="34" fill="#F8E0CF" />
      <rect x="230" y="328" width="24" height="34" fill="#F8E0CF" />
      <rect x="266" y="328" width="24" height="34" fill="#F8E0CF" />
      <rect x="244" y="384" width="34" height="68" fill="#203431" />
      <rect x="-10" y="450" width="320" height="34" fill="#EBE8DE" />
      <rect x="-10" y="482" width="320" height="4" fill="#C7C2B2" />
      <rect x="-10" y="486" width="320" height="40" fill="#DDD9CC" />
      <rect x="20" y="502" width="36" height="4" fill="#FCFBF8" />
      <rect x="120" y="502" width="36" height="4" fill="#FCFBF8" />
      <rect x="220" y="502" width="36" height="4" fill="#FCFBF8" />
      <rect x="44" y="376" width="8" height="84" fill="#203431" />
      <circle cx="48" cy="346" r="40" fill="#2E7064" />
      <circle cx="72" cy="370" r="26" fill="#25594F" />
      <circle cx="26" cy="372" r="24" fill="#1D4740" />
      <rect x="190" y="338" width="4" height="116" fill="#203431" />
      <circle cx="192" cy="332" r="9" fill="#E8AE89" />
      <circle cx="146" cy="420" r="8" fill="#C97F4F" />
      <rect x="138" y="429" width="16" height="34" rx="8" fill="#25594F" />
      <rect x="141" y="460" width="5" height="16" rx="2" fill="#203431" />
      <rect x="148" y="460" width="5" height="16" rx="2" fill="#203431" />
      <circle cx="174" cy="426" r="7" fill="#E8AE89" />
      <rect x="167" y="434" width="14" height="30" rx="7" fill="#203431" />
      <rect x="169" y="460" width="4" height="16" rx="2" fill="#203431" />
      <rect x="175" y="460" width="4" height="16" rx="2" fill="#203431" />
    </svg>
  );
}

const STEPS: { icon: IconName; iconColor: string; title: string; body: string; foot: string; footColor: string }[] = [
  { icon: "coffee", iconColor: "var(--ink-900)", title: "Share your interests", body: "Name what brings you comfort: an early-morning roast, quiet book stacks, green paths, or a weekly farmers stall.", foot: "Simple prompts", footColor: "var(--text-action)" },
  { icon: "compass", iconColor: "var(--apricot-700)", title: "Explore local places", body: "Discover dependable spots close to where you live, each with a plain reason why it fits you.", foot: "Reasons, not rankings", footColor: "var(--text-warm)" },
  { icon: "sun", iconColor: "var(--evergreen-600)", title: "Shape your routine", body: "Pace your arrival across your first week, month, and the months after. Slowly turn unfamiliar blocks into everyday rituals.", foot: "Unhurried rhythm", footColor: "var(--text-action)" },
];

export function Welcome() {
  const router = useRouter();
  const { dispatch } = useFlow();
  return (
    <div className="f90-page">
      <header style={{ maxWidth: 1040, margin: "0 auto", padding: "0 clamp(16px,4vw,32px)", height: 84, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, font: "500 22px/1 var(--font-sans)", letterSpacing: "-.01em" }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--evergreen-500)" }} />
          First 90 Days
        </span>
        <span style={{ font: "500 12px/1 var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--stone-600)", background: "var(--stone-100)", padding: "10px 14px", borderRadius: 999, whiteSpace: "nowrap" }}>
          Settling in companion
        </span>
      </header>

      <main id="main" style={{ maxWidth: 1040, margin: "0 auto", padding: "clamp(8px,2vw,24px) clamp(16px,4vw,32px) clamp(48px,7vw,96px)" }}>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: "clamp(32px,5vw,64px)", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", maxWidth: 520 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, font: "600 13px/1.3 var(--font-sans)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-warm)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--apricot-700)" }} />
              A new city, made familiar
            </div>
            <h1 style={{ margin: "20px 0 0", font: "400 clamp(2.75rem,5.6vw,4.125rem)/1.04 var(--font-serif)", letterSpacing: "-.025em", color: "var(--text-primary)", textWrap: "balance" }}>
              Feel at home, <em style={{ fontStyle: "italic", color: "var(--evergreen-600)" }}>one place</em> at a time.
            </h1>
            <p style={{ margin: "28px 0 0", font: "400 clamp(1.0625rem,1.6vw,1.25rem)/1.65 var(--font-sans)", color: "var(--text-secondary)", textWrap: "pretty" }}>
              Tell us what you enjoy. We’ll help you find quiet corners, essential anchors, and small domestic routines that fit your life in your new neighborhood.
            </p>
            <div style={{ marginTop: 36, display: "flex", flexWrap: "wrap", gap: 12, width: "100%" }}>
              <div style={{ flex: "1 1 200px", maxWidth: 260 }}>
                <Button variant="primary" size="lg" iconRight="arrow-right" fullWidth onClick={() => router.push("/location")}>Build my plan</Button>
              </div>
              <div style={{ flex: "1 1 200px", maxWidth: 260 }}>
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={() => {
                    dispatch({ type: "loadSample" });
                    router.push("/interests");
                  }}
                >
                  Try a sample plan
                </Button>
              </div>
            </div>
            <p style={{ margin: "22px 0 0", display: "flex", alignItems: "flex-start", gap: 10, font: "400 15px/1.5 var(--font-sans)", color: "var(--text-muted)", maxWidth: "30em" }}>
              <span style={{ color: "var(--evergreen-600)", marginTop: 1 }}><Icon name="circle-check" size={20} /></span>
              <span>No account needed. You can reshape your preferences anytime.</span>
            </p>
          </div>

          <figure style={{ margin: 0, justifySelf: "center", width: "100%", maxWidth: 480, background: "var(--bg-raised)", borderRadius: 24, padding: 14, boxShadow: "var(--shadow-2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gridTemplateRows: "1fr 1fr", gap: 4, aspectRatio: "4/3", width: "100%" }}>
              <div role="img" aria-label="Illustration of a café front with a striped awning, pendant lamps and two people at small tables" style={{ gridRow: "1 / span 2", borderRadius: "14px 4px 4px 14px", overflow: "hidden" }}>
                <CafeIllustration />
              </div>
              <div role="img" aria-label="Illustration of a bookshop window filled with shelves of books" style={{ borderRadius: "4px 14px 4px 4px", overflow: "hidden" }}>
                <BookshopIllustration />
              </div>
              <div role="img" aria-label="Illustration of a walkable street with a tree and two people walking" style={{ borderRadius: "4px 4px 14px 4px", overflow: "hidden" }}>
                <StreetIllustration />
              </div>
            </div>
            <figcaption style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 8px 4px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, font: "500 14px/1.35 var(--font-sans)", color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--text-muted)" }}><Icon name="map-pin" size={16} /></span>
                Everyday neighborhood rhythm
              </span>
              <span style={{ font: "italic 400 12px/1.3 var(--font-sans)", color: "var(--text-muted)", textAlign: "right" }}>Illustrative moments</span>
            </figcaption>
          </figure>
        </section>

        <section style={{ marginTop: "clamp(56px,8vw,104px)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "8px 24px" }}>
            <h2 style={{ margin: 0, font: "400 clamp(1.75rem,3vw,2.125rem)/1.2 var(--font-serif)", letterSpacing: "-.015em" }}>How we begin together</h2>
            <p style={{ margin: 0, font: "400 15px/1.5 var(--font-sans)", color: "var(--text-muted)" }}>Three quiet steps, no rush.</p>
          </div>
          <ol style={{ listStyle: "none", margin: "28px 0 0", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 20 }}>
            {STEPS.map((step, i) => (
              <li key={step.title} style={{ display: "flex", flexDirection: "column", background: "var(--bg-raised)", borderRadius: 16, padding: "28px 28px 24px", boxShadow: "var(--shadow-1)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ width: 50, height: 50, borderRadius: 12, background: "var(--ivory-200)", color: step.iconColor, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={step.icon} size={22} />
                  </span>
                  <span style={{ font: "500 14px/1 var(--font-sans)", color: "var(--text-muted)" }}>{`0${i + 1}`}</span>
                </div>
                <h3 style={{ margin: "24px 0 0", font: "500 22px/1.3 var(--font-sans)", letterSpacing: "-.01em" }}>{step.title}</h3>
                <p style={{ margin: "12px 0 0", font: "400 15px/1.65 var(--font-sans)", color: "var(--text-secondary)", flex: 1 }}>{step.body}</p>
                <span style={{ marginTop: 24, display: "inline-flex", alignItems: "center", gap: 8, font: "600 14px/1 var(--font-sans)", color: step.footColor }}>
                  {step.foot}
                  <Icon name="arrow-right" size={16} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
