import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'

export const metadata = {
  title: 'SunScan — AI Solar Survey Platform',
  description: 'AI-powered solar survey for UK solar installers. Full installation spec in under 60 seconds.',
}

// Front-slope panel polygons (4 cols × 3 rows)
// Bilinear map: x(u,v) = 70 + 230u + 55v,  y(u,v) = 250 − 87v  (7 % margin each side)
const PANELS = [
  '75,248 125,248 141,223 91,223',
  '133,248 182,248 198,223 149,223',
  '190,248 240,248 256,223 206,223',
  '248,248 297,248 313,223 264,223',
  '94,219 143,219 159,194 109,194',
  '151,219 200,219 216,194 167,194',
  '209,219 258,219 274,194 225,194',
  '266,219 316,219 331,194 282,194',
  '112,190 161,190 177,165 128,165',
  '169,190 219,190 235,165 185,165',
  '227,190 276,190 292,165 243,165',
  '284,190 334,190 349,165 300,165',
]

const MONTHS = [
  { m: 'J', h: 28 }, { m: 'F', h: 38 }, { m: 'M', h: 56 }, { m: 'A', h: 72 },
  { m: 'M', h: 86 }, { m: 'J', h: 92 }, { m: 'J', h: 95 }, { m: 'A', h: 88 },
  { m: 'S', h: 68 }, { m: 'O', h: 48 }, { m: 'N', h: 30 }, { m: 'D', h: 22 },
]

// ─── Isometric house SVG ─────────────────────────────────────────────────────
function HouseSVG() {
  const SUN_RAYS = [0, 45, 90, 135, 180, 225, 270, 315]
  return (
    <svg
      viewBox="0 0 480 380"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      style={{ filter: 'drop-shadow(0 20px 60px rgba(14,165,233,0.13))' }}
    >
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <clipPath id="fslope"><polygon points="70,250 300,250 355,163 125,163" /></clipPath>
        <linearGradient id="wf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#152848" />
          <stop offset="100%" stopColor="#0C1E38" />
        </linearGradient>
        <linearGradient id="wr" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0C1E38" />
          <stop offset="100%" stopColor="#071325" />
        </linearGradient>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="240" cy="350" rx="200" ry="18" fill="rgba(0,0,0,0.35)" />

      {/* Back slope — north-facing, dark */}
      <polygon points="180,185 410,185 355,163 125,163" fill="#09152a" stroke="rgba(56,189,248,0.07)" strokeWidth="1" />
      {/* Right wall */}
      <polygon points="300,320 410,255 410,185 300,250" fill="url(#wr)" stroke="rgba(56,189,248,0.1)" strokeWidth="1" />
      {/* Front wall */}
      <polygon points="70,320 300,320 300,250 70,250" fill="url(#wf)" stroke="rgba(56,189,248,0.12)" strokeWidth="1" />
      {/* Front slope base */}
      <polygon points="70,250 300,250 355,163 125,163" fill="#1a3a6e" stroke="rgba(56,189,248,0.15)" strokeWidth="1" />

      {/* Solar panels */}
      <g clipPath="url(#fslope)">
        <polygon points="70,250 300,250 355,163 125,163" fill="rgba(14,165,233,0.05)" />
        {PANELS.map((pts, i) => (
          <polygon key={i} points={pts} fill="rgba(14,165,233,0.21)" stroke="rgba(56,189,248,0.45)" strokeWidth="0.5" />
        ))}
      </g>

      {/* Ridge */}
      <line x1="125" y1="163" x2="355" y2="163" stroke="rgba(56,189,248,0.42)" strokeWidth="1.5" />

      {/* Chimney */}
      <polygon points="220,232 238,232 242,212 224,212" fill="#0C1E38" stroke="rgba(56,189,248,0.14)" strokeWidth="1" />
      <polygon points="218,212 244,212 248,207 222,207" fill="#152848" stroke="rgba(56,189,248,0.14)" strokeWidth="1" />

      {/* Windows */}
      <rect x="95" y="270" width="42" height="34" rx="3" fill="rgba(56,189,248,0.07)" stroke="rgba(56,189,248,0.22)" strokeWidth="1" />
      <line x1="116" y1="270" x2="116" y2="304" stroke="rgba(56,189,248,0.17)" strokeWidth="0.5" />
      <line x1="95" y1="287" x2="137" y2="287" stroke="rgba(56,189,248,0.17)" strokeWidth="0.5" />
      <rect x="176" y="270" width="42" height="34" rx="3" fill="rgba(56,189,248,0.07)" stroke="rgba(56,189,248,0.22)" strokeWidth="1" />
      <line x1="197" y1="270" x2="197" y2="304" stroke="rgba(56,189,248,0.17)" strokeWidth="0.5" />
      <line x1="176" y1="287" x2="218" y2="287" stroke="rgba(56,189,248,0.17)" strokeWidth="0.5" />

      {/* Door */}
      <rect x="252" y="282" width="26" height="38" rx="2" fill="rgba(56,189,248,0.05)" stroke="rgba(56,189,248,0.18)" strokeWidth="1" />
      <circle cx="272" cy="301" r="2" fill="rgba(56,189,248,0.5)" />

      {/* Corner markers */}
      {([[125, 163, 0.7], [355, 163, 0.7], [70, 250, 0.45], [300, 250, 0.45]] as const).map(([x, y, o]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="2.5" fill="#38BDF8" opacity={o} filter="url(#glow)" />
      ))}

      {/* Ground dash */}
      <line x1="30" y1="325" x2="450" y2="325" stroke="rgba(56,189,248,0.08)" strokeWidth="1" strokeDasharray="4,8" />

      {/* Scan beam — SMIL animated along the roof slope */}
      <line stroke="rgba(56,189,248,0.85)" strokeWidth="1.5" filter="url(#glow)">
        <animate attributeName="x1" values="125;70;125" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y1" values="163;250;163" dur="3s" repeatCount="indefinite" />
        <animate attributeName="x2" values="355;300;355" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y2" values="163;250;163" dur="3s" repeatCount="indefinite" />
      </line>
      <line stroke="rgba(56,189,248,0.18)" strokeWidth="10" filter="url(#glow)">
        <animate attributeName="x1" values="125;70;125" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y1" values="163;250;163" dur="3s" repeatCount="indefinite" />
        <animate attributeName="x2" values="355;300;355" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y2" values="163;250;163" dur="3s" repeatCount="indefinite" />
      </line>

      {/* Sun orbiting (−90° → +90° around ground centre) */}
      <g>
        <animateTransform attributeName="transform" type="rotate" from="-90 240 330" to="90 240 330" dur="20s" repeatCount="indefinite" />
        <circle cx="240" cy="28" r="24" fill="rgba(245,158,11,0.07)" />
        <circle cx="240" cy="28" r="12" fill="#F59E0B" opacity="0.92" />
        <circle cx="240" cy="28" r="6.5" fill="#FCD34D" />
        {SUN_RAYS.map((deg) => {
          const rad = (deg * Math.PI) / 180
          return (
            <line
              key={deg}
              x1={Math.round(240 + 17 * Math.cos(rad))}
              y1={Math.round(28 + 17 * Math.sin(rad))}
              x2={Math.round(240 + 24 * Math.cos(rad))}
              y2={Math.round(28 + 24 * Math.sin(rad))}
              stroke="#FCD34D"
              strokeWidth="1.5"
              opacity="0.6"
            />
          )
        })}
      </g>
    </svg>
  )
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function Nav() {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 border-b"
      style={{ background: 'rgba(3,11,23,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--ss-border)' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <div className="w-8 h-8 flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,var(--ss-blue),var(--ss-violet))', clipPath: 'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
            </svg>
          </div>
          <span className="ss-heading font-bold text-lg tracking-wide" style={{ color: 'var(--ss-t1)' }}>
            SUN<span style={{ color: 'var(--ss-blue)' }}>SCAN</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {[['#features', 'Features'], ['#how-it-works', 'How It Works'], ['#dashboard', 'Dashboard']].map(([href, label]) => (
            <a key={href} href={href} className="text-sm font-medium transition-colors duration-200 hover:text-slate-100"
              style={{ color: 'var(--ss-t3)', textDecoration: 'none' }}>
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/survey"
            className="hidden sm:flex items-center text-sm font-semibold px-4 py-2 rounded-lg border transition-all duration-200 ss-heading hover:text-slate-100"
            style={{ border: '1px solid var(--ss-border-h)', color: 'var(--ss-t2)', background: 'transparent', textDecoration: 'none' }}>
            Sign In
          </Link>
          <Link href="/survey"
            className="flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-lg ss-heading text-white transition-all duration-200 hover:brightness-110"
            style={{ background: 'var(--ss-blue)', boxShadow: '0 0 20px rgba(14,165,233,0.28)', textDecoration: 'none' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            Start Free Trial
          </Link>
        </div>
      </div>
    </header>
  )
}

// ─── Floating data badge ──────────────────────────────────────────────────────
function DataBadge({ label, value, sub, color = 'var(--ss-t1)', delay = '0s', style: s }: {
  label: string; value: string; sub: string; color?: string; delay?: string; style?: CSSProperties
}) {
  return (
    <div className="absolute rounded-xl px-3.5 py-2.5" style={{
      background: 'rgba(7,19,37,0.92)',
      border: '1px solid var(--ss-border-h)',
      backdropFilter: 'blur(12px)',
      animation: `ss-float 4s ease-in-out infinite`,
      animationDelay: delay,
      ...s,
    }}>
      <p className="ss-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--ss-t4)' }}>{label}</p>
      <p className="ss-mono text-base font-bold leading-none" style={{ color }}>{value}</p>
      <p className="text-[10px] mt-1" style={{ color: 'var(--ss-t4)' }}>{sub}</p>
    </div>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative flex items-center pt-20 pb-16 overflow-hidden" style={{ minHeight: '100vh', background: 'var(--ss-ink)' }}>
      {/* Grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(14,165,233,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,0.05) 1px,transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
      {/* Radial glows */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 25% 55%,rgba(14,165,233,0.07) 0%,transparent 55%),radial-gradient(ellipse at 75% 30%,rgba(124,58,237,0.05) 0%,transparent 45%)' }} />
      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: 180, background: 'linear-gradient(transparent,var(--ss-ink))' }} />

      <div className="relative z-10 max-w-6xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* Content */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 mb-6 ss-mono text-xs uppercase tracking-widest"
              style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid var(--ss-border-h)', color: 'var(--ss-blue)' }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: 'var(--ss-blue)', boxShadow: '0 0 6px var(--ss-blue)', animation: 'ss-pulse-dot 2s infinite' }} />
              AI Solar Survey Platform
            </div>

            <h1 className="ss-heading font-extrabold tracking-tight mb-5 leading-[1.04]"
              style={{ fontSize: 'clamp(38px,5vw,62px)', color: 'var(--ss-t1)' }}>
              Precision Solar<br />
              Analysis{' '}
              <span style={{
                background: 'linear-gradient(135deg,var(--ss-blue),var(--ss-violet))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>Engineered</span>
              <br />by AI
            </h1>

            <p className="mb-8 leading-relaxed" style={{ fontSize: 17, color: 'var(--ss-t3)', maxWidth: 440 }}>
              Enter any UK address. SunScan detects roof geometry, models irradiance, optimises panel placement,
              and outputs a full MCS-aligned specification in under 60 seconds.
            </p>

            {/* Address CTA */}
            <Link href="/survey" className="block max-w-[460px] mb-8 no-underline">
              <div className="flex rounded-xl overflow-hidden transition-all duration-200 hover:shadow-[0_0_20px_rgba(14,165,233,0.22)]"
                style={{ background: 'var(--ss-s2)', border: '1px solid var(--ss-border-h)' }}>
                <div className="flex-1 flex items-center gap-2 px-4 py-3.5" style={{ color: 'var(--ss-t4)' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                  <span className="text-sm">Enter address or postcode...</span>
                </div>
                <div className="flex items-center gap-1.5 px-5 ss-heading text-sm font-bold text-white"
                  style={{ background: 'var(--ss-blue)' }}>
                  RUN AI SCAN
                </div>
              </div>
            </Link>

            {/* Stats */}
            <div className="flex gap-8">
              {[['12,400+', 'Properties Scanned'], ['97.3%', 'Model Accuracy'], ['<60s', 'Report Time']].map(([n, l]) => (
                <div key={l}>
                  <div className="ss-mono text-xl font-bold" style={{ color: 'var(--ss-t1)' }}>{n}</div>
                  <div className="text-xs mt-0.5 uppercase tracking-wider" style={{ color: 'var(--ss-t4)' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Visual */}
          <div className="relative flex items-center justify-center">
            <div className="relative w-full" style={{ maxWidth: 520, height: 420 }}>
              <HouseSVG />
              <DataBadge label="System Efficiency" value="94.2%" sub="↑ Optimal orientation"
                color="var(--ss-blue-l)" delay="0s" style={{ top: 12, left: -8 }} />
              <DataBadge label="Est. Annual Output" value="8,340 kWh" sub="MCS-aligned figure"
                color="var(--ss-t1)" delay="-1.3s" style={{ top: 32, right: -8 }} />
              <DataBadge label="25yr Net Savings" value="£42,800" sub="At 4% inflation"
                color="var(--ss-amber)" delay="-2.6s" style={{ bottom: 80, right: -8 }} />
              <DataBadge label="Panel Count" value="16 panels" sub="6.08 kWp system"
                color="var(--ss-violet-l)" delay="-0.7s" style={{ bottom: 100, left: -8 }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Features ─────────────────────────────────────────────────────────────────
const FEATURES: { num: string; color: string; title: string; desc: string; icon: ReactNode }[] = [
  {
    num: '01', color: 'var(--ss-blue)', title: 'AI Roof Detection',
    desc: 'UPRN-linked OS NGD polygons combined with geometry analysis identify exact roof surfaces, pitch, and usable area from address alone.',
    icon: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>,
  },
  {
    num: '02', color: 'var(--ss-amber)', title: 'Irradiance Modelling',
    desc: 'MCS-certified zone and irradiance lookup with orientation-corrected kWh/m² figures. Accounts for pitch, azimuth, and regional climate.',
    icon: <><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /></>,
  },
  {
    num: '03', color: 'var(--ss-violet-l)', title: 'Panel Layout Optimisation',
    desc: 'Grid packing algorithm respects 300mm edge setbacks, 20mm panel gaps, and obstacles. Outputs exact row/column count with kWp system size.',
    icon: <><line x1="3" y1="3" x2="21" y2="3" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="3" y1="21" x2="21" y2="21" /></>,
  },
  {
    num: '04', color: '#10B981', title: 'Generation Forecasting',
    desc: '25-year production model with 4% annual tariff inflation, self-consumption analysis, and battery storage uplift modelling.',
    icon: <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></>,
  },
  {
    num: '05', color: 'var(--ss-blue)', title: 'Bill OCR Parsing',
    desc: 'GPT-4o Vision reads uploaded electricity bills and extracts unit rate, standing charge, and annual consumption automatically.',
    icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>,
  },
  {
    num: '06', color: 'var(--ss-violet-l)', title: '3D Property Viewer',
    desc: 'React Three Fiber renders an interactive 3D model with panel overlay. Canvas captured as base64 and embedded in the PDF report.',
    icon: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></>,
  },
]

function Features() {
  return (
    <section id="features" className="py-24" style={{ background: 'var(--ss-ink)' }}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <EyebrowTag>Capabilities</EyebrowTag>
          <h2 className="ss-heading font-extrabold tracking-tight mt-4 mb-3" style={{ fontSize: 'clamp(26px,4vw,40px)', color: 'var(--ss-t1)' }}>
            Built for installation-grade accuracy
          </h2>
          <p style={{ color: 'var(--ss-t3)', maxWidth: 480, margin: '0 auto' }}>
            Every calculation follows MCS standards. Every output is export-ready for your proposal workflow.
          </p>
        </div>

        <div className="grid md:grid-cols-3" style={{ border: '1px solid var(--ss-border)', borderRadius: 16, overflow: 'hidden', gap: 1, background: 'var(--ss-border)' }}>
          {FEATURES.map(({ num, color, title, desc, icon }) => (
            <div key={num} className="ss-feature-card relative p-8 cursor-default">
              <span className="ss-mono absolute top-6 right-6 text-[11px]" style={{ color: 'rgba(100,116,139,0.4)' }}>{num}</span>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-5"
                style={{ background: 'var(--ss-s3)', border: '1px solid var(--ss-border-h)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {icon}
                </svg>
              </div>
              <h3 className="ss-heading font-bold mb-2.5 text-[15px]" style={{ color: 'var(--ss-t1)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--ss-t4)' }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Eyebrow tag (shared) ─────────────────────────────────────────────────────
function EyebrowTag({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 ss-mono text-xs uppercase tracking-widest"
      style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid var(--ss-border-h)', color: 'var(--ss-blue)' }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--ss-blue)' }} />
      {children}
    </div>
  )
}

// ─── How It Works ─────────────────────────────────────────────────────────────
function Process() {
  const steps = [
    { num: '01', color: 'var(--ss-blue)', border: 'rgba(14,165,233,0.3)', title: 'Enter Address', desc: 'Type any UK address or postcode. OS Places autocomplete resolves the UPRN. Upload an electricity bill for accurate tariff modelling.' },
    { num: '02', color: 'var(--ss-violet-l)', border: 'rgba(124,58,237,0.3)', title: 'AI Analysis', desc: 'Roof geometry extracted from OS NGD. Irradiance pulled from MCS lookup tables. Panel count, kWp, and annual generation calculated.' },
    { num: '03', color: 'var(--ss-amber)', border: 'rgba(245,158,11,0.3)', title: 'Download Report', desc: 'Full PDF rendered with 3D model, panel layout, 25-year savings projection, and MCS-compliant generation estimates.' },
  ]

  return (
    <section id="how-it-works" className="py-24" style={{ background: 'linear-gradient(180deg,var(--ss-ink) 0%,var(--ss-s1) 50%,var(--ss-ink) 100%)' }}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <EyebrowTag>Workflow</EyebrowTag>
          <h2 className="ss-heading font-extrabold tracking-tight mt-4 mb-3" style={{ fontSize: 'clamp(26px,4vw,40px)', color: 'var(--ss-t1)' }}>
            From address to report in 3 steps
          </h2>
          <p style={{ color: 'var(--ss-t3)' }}>No satellite images to upload. No manual measurements. Just a postcode.</p>
        </div>

        <div className="relative grid md:grid-cols-3 gap-8">
          <div className="hidden md:block absolute top-7 left-[17%] right-[17%] h-px"
            style={{ background: 'linear-gradient(90deg,var(--ss-blue),var(--ss-violet),var(--ss-amber))', opacity: 0.28 }} />
          {steps.map(({ num, color, border, title, desc }) => (
            <div key={num} className="relative text-center px-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-6 ss-mono text-lg font-bold relative z-10"
                style={{ background: 'var(--ss-s2)', border: `1px solid ${border}`, color }}>
                {num}
              </div>
              <h3 className="ss-heading font-bold text-lg mb-3" style={{ color: 'var(--ss-t1)' }}>{title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--ss-t4)' }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Dashboard Preview ────────────────────────────────────────────────────────
function DashPreview() {
  const metrics = [
    { label: 'Annual Output', value: '8,340', unit: 'kWh / year', accent: 'var(--ss-blue)', change: '↑ 12% above avg' },
    { label: '25yr Net Savings', value: '£42.8k', unit: 'at 4% inflation', accent: 'var(--ss-amber)', change: '↑ Strong ROI' },
    { label: 'System Size', value: '6.08', unit: 'kWp · 16 panels', accent: 'var(--ss-violet-l)', change: 'Optimal fit' },
    { label: 'AI Confidence', value: '94.2%', unit: 'Model certainty', accent: '#10B981', change: 'High quality' },
  ]
  const nav = [
    { label: 'Overview', active: true },
    { label: 'Property', active: false },
    { label: 'Solar Analysis', active: false },
    { label: 'Financials', active: false },
    { label: 'PDF Report', active: false },
  ]

  return (
    <section id="dashboard" className="py-24 overflow-hidden" style={{ background: 'var(--ss-ink)' }}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <EyebrowTag>Platform</EyebrowTag>
          <h2 className="ss-heading font-extrabold tracking-tight mt-4 mb-3" style={{ fontSize: 'clamp(26px,4vw,40px)', color: 'var(--ss-t1)' }}>
            Every metric. One screen.
          </h2>
          <p style={{ color: 'var(--ss-t3)', maxWidth: 440, margin: '0 auto' }}>
            Engineering-grade analysis delivered through a dashboard built for surveyors, not consumers.
          </p>
        </div>

        {/* Browser chrome */}
        <div className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid var(--ss-border)', background: 'var(--ss-s1)', boxShadow: '0 40px 120px rgba(0,0,0,0.5)' }}>
          <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,var(--ss-blue),var(--ss-violet),transparent)', opacity: 0.6 }} />

          {/* Tab bar */}
          <div className="flex items-center gap-4 px-5 py-3.5 border-b" style={{ background: 'var(--ss-ink)', borderColor: 'var(--ss-border)' }}>
            <div className="flex gap-1.5">
              {['#FF5F57', '#FFBD2E', '#28C840'].map(c => (
                <div key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
              ))}
            </div>
            <div className="rounded-md px-3 py-1 ss-mono text-xs" style={{ background: 'var(--ss-s2)', border: '1px solid var(--ss-border)', color: 'var(--ss-t4)' }}>
              app.sunscan.io/report/rpt_8f3a2c1e
            </div>
          </div>

          {/* App body */}
          <div className="flex" style={{ minHeight: 460 }}>
            {/* Sidebar */}
            <div className="w-52 flex-shrink-0 border-r p-4" style={{ background: 'var(--ss-ink)', borderColor: 'var(--ss-border)' }}>
              <div className="flex items-center gap-2 px-2 mb-5">
                <div className="w-5 h-5 flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg,var(--ss-blue),var(--ss-violet))', clipPath: 'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)' }} />
                <span className="ss-heading font-bold text-sm" style={{ color: 'var(--ss-t1)' }}>SUNSCAN</span>
              </div>
              {nav.map(({ label, active }) => (
                <div key={label}
                  className="px-3 py-2 rounded-lg text-xs font-medium mb-0.5 cursor-default"
                  style={{ background: active ? 'var(--ss-s2)' : 'transparent', color: active ? 'var(--ss-blue-l)' : 'var(--ss-t4)' }}>
                  {label}
                </div>
              ))}
            </div>

            {/* Main */}
            <div className="flex-1 p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="ss-mono text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--ss-t4)' }}>Property Survey Report</div>
                  <h3 className="ss-heading font-bold text-base" style={{ color: 'var(--ss-t1)' }}>14 Oak Street, Norwich, NR1 3EH</h3>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs"
                    style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10B981' }}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981' }} />
                    Analysis Complete
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ss-heading text-white"
                    style={{ background: 'var(--ss-blue)' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download PDF
                  </div>
                </div>
              </div>

              {/* Metric cards */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {metrics.map(({ label, value, unit, accent, change }) => (
                  <div key={label} className="rounded-xl p-3.5 relative overflow-hidden"
                    style={{ background: 'var(--ss-s2)', border: '1px solid var(--ss-border)' }}>
                    <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: accent }} />
                    <div className="ss-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--ss-t4)' }}>{label}</div>
                    <div className="ss-mono text-xl font-bold mb-0.5" style={{ color: 'var(--ss-t1)' }}>{value}</div>
                    <div className="text-[10px] mb-1" style={{ color: 'var(--ss-t4)' }}>{unit}</div>
                    <div className="text-[10px]" style={{ color: '#10B981' }}>{change}</div>
                  </div>
                ))}
              </div>

              {/* Bottom row */}
              <div className="grid grid-cols-2 gap-3">
                {/* Monthly generation chart */}
                <div className="rounded-xl p-4" style={{ background: 'var(--ss-s2)', border: '1px solid var(--ss-border)' }}>
                  <div className="flex justify-between items-center mb-3">
                    <span className="ss-heading font-semibold text-xs" style={{ color: 'var(--ss-t2)' }}>Monthly Generation</span>
                    <span className="ss-mono text-[10px]" style={{ color: 'var(--ss-t4)' }}>kWh · estimate</span>
                  </div>
                  <div className="flex items-end gap-1" style={{ height: 90 }}>
                    {MONTHS.map(({ m, h }) => (
                      <div key={m} className="flex-1 flex flex-col items-center justify-end gap-1" style={{ height: '100%' }}>
                        <div className="w-full rounded-t-sm" style={{ height: `${h}%`, background: 'linear-gradient(180deg,var(--ss-blue),var(--ss-violet))', opacity: 0.8 }} />
                        <span className="ss-mono text-[8px]" style={{ color: 'var(--ss-t4)' }}>{m}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Panel layout grid */}
                <div className="rounded-xl p-4" style={{ background: 'var(--ss-s2)', border: '1px solid var(--ss-border)' }}>
                  <div className="flex justify-between items-center mb-3">
                    <span className="ss-heading font-semibold text-xs" style={{ color: 'var(--ss-t2)' }}>Panel Layout</span>
                    <span className="ss-mono text-[10px]" style={{ color: 'var(--ss-t4)' }}>4×4 · South facing</span>
                  </div>
                  <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(8,1fr)' }}>
                    {Array.from({ length: 32 }).map((_, i) => {
                      const row = Math.floor(i / 8), col = i % 8
                      const empty = (row === 0 && (col === 0 || col === 7)) || (row === 3 && (col <= 1 || col >= 6))
                      return (
                        <div key={i} className="rounded-sm" style={{
                          aspectRatio: '0.58',
                          background: empty ? 'var(--ss-s3)' : 'rgba(14,165,233,0.21)',
                          border: empty ? 'none' : '1px solid rgba(56,189,248,0.38)',
                        }} />
                      )
                    })}
                  </div>
                  <div className="flex gap-3 mt-2.5 ss-mono" style={{ fontSize: 9, color: 'var(--ss-t4)' }}>
                    <span>16 × 380Wp</span><span>6.08 kWp</span><span>34.8m²</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── CTA ──────────────────────────────────────────────────────────────────────
function CTA() {
  return (
    <section className="py-28 text-center relative overflow-hidden" style={{ background: 'var(--ss-ink)' }}>
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 50% 50%,rgba(14,165,233,0.07) 0%,transparent 65%)' }} />
      <div className="relative z-10 max-w-xl mx-auto px-6">
        <div className="flex justify-center mb-6"><EyebrowTag>Get Started</EyebrowTag></div>
        <h2 className="ss-heading font-extrabold tracking-tight mb-4" style={{ fontSize: 'clamp(28px,5vw,48px)', color: 'var(--ss-t1)' }}>
          Ready to scan your first property?
        </h2>
        <p className="mb-8 text-base" style={{ color: 'var(--ss-t3)' }}>Free trial. No credit card. Full report in under 60 seconds.</p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/survey"
            className="flex items-center gap-2 px-6 py-3.5 rounded-xl ss-heading font-bold text-sm text-white transition-all duration-200 hover:brightness-110 hover:scale-[1.02]"
            style={{ background: 'var(--ss-blue)', boxShadow: '0 0 24px rgba(14,165,233,0.35)', textDecoration: 'none' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            Run AI Scan — Free
          </Link>
          <Link href="/survey"
            className="flex items-center gap-2 px-6 py-3.5 rounded-xl ss-heading font-bold text-sm transition-all duration-200 hover:text-slate-100 hover:scale-[1.02]"
            style={{ border: '1px solid var(--ss-border-h)', color: 'var(--ss-t2)', background: 'transparent', textDecoration: 'none' }}>
            View Sample Report
          </Link>
        </div>
        <p className="mt-6 ss-mono text-xs" style={{ color: 'var(--ss-t4)' }}>Trusted by 340+ UK solar installers</p>
      </div>
    </section>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  const cols = [
    { title: 'Product', links: ['Features', 'Pricing', 'API Access', 'Integrations', 'Changelog'] },
    { title: 'Resources', links: ['Documentation', 'MCS Standards', 'Sample Reports', 'Case Studies'] },
    { title: 'Company', links: ['About', 'Contact', 'Privacy Policy', 'Terms of Service'] },
  ]
  return (
    <footer className="border-t py-14" style={{ borderColor: 'var(--ss-border)', background: 'var(--ss-ink)' }}>
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-7 h-7 flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,var(--ss-blue),var(--ss-violet))', clipPath: 'polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)' }} />
              <span className="ss-heading font-bold" style={{ color: 'var(--ss-t1)' }}>SUNSCAN</span>
            </div>
            <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--ss-t4)', maxWidth: 240 }}>
              AI-powered solar survey platform built for UK installers, manufacturers, and energy consultants.
            </p>
            <div className="flex gap-2">
              {[['var(--ss-blue)', 'rgba(14,165,233,0.15)', 'MCS Compliant'], ['#10B981', 'rgba(16,185,129,0.15)', 'GDPR Ready']].map(([c, b, l]) => (
                <div key={l} className="px-2.5 py-1 rounded-md ss-mono text-[10px]"
                  style={{ color: c, background: b, border: `1px solid ${c}30` }}>{l}</div>
              ))}
            </div>
          </div>
          {cols.map(({ title, links }) => (
            <div key={title}>
              <h4 className="ss-heading font-bold text-sm mb-4" style={{ color: 'var(--ss-t2)' }}>{title}</h4>
              <ul className="space-y-2.5">
                {links.map(l => (
                  <li key={l}>
                    <a href="#" className="text-sm transition-colors duration-200 hover:text-slate-200"
                      style={{ color: 'var(--ss-t4)', textDecoration: 'none' }}>{l}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t"
          style={{ borderColor: 'var(--ss-border)' }}>
          <p className="ss-mono text-xs text-center sm:text-left" style={{ color: 'var(--ss-t4)' }}>
            © 2024 SunScan Ltd. Solar estimates are indicative only. A site survey is required for a firm quotation.
          </p>
          <div className="flex gap-5">
            {['Privacy', 'Terms', 'Cookies'].map(l => (
              <a key={l} href="#" className="ss-mono text-xs transition-colors hover:text-slate-200"
                style={{ color: 'var(--ss-t4)', textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HomePage() {
  return (
    <div style={{ background: 'var(--ss-ink)', color: 'var(--ss-t2)' }}>
      <Nav />
      <Hero />
      <Features />
      <Process />
      <DashPreview />
      <CTA />
      <Footer />
    </div>
  )
}
