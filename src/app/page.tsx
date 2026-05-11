import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { SunscanMark } from '@/components/SunscanMark'

export const metadata = {
  title: 'SunScan · From postcode to MCS-aligned spec in 60 seconds',
  description: 'Engineering-grade solar surveys for UK installers. UPRN-locked roof detection, MCS-aligned generation forecasts, export-ready reports.',
}

// Front-slope panel polygons (4 cols × 3 rows), MCS-style edge setbacks
// Bilinear map: x(u,v) = 70 + 230u + 55v,  y(u,v) = 250 − 87v
// Setbacks ≈ 9 % horizontally / 14 % vertically (≈ 400 mm on a 3 m slope) so a
// clear gap is visible from eaves, ridge, and gables - installer-grade aesthetic.
// Each panel carries its column index so its illumination can be staggered to
// match the sun's screen position as it orbits overhead.
//
// The chimney is treated as an obstacle: any panel whose bounding box overlaps
// the chimney + a ≈ 300 mm setback is dropped, so the array packs *around* it
// rather than running through it (matches the "Obstacle-aware" feature claim).
const OBSTACLE_SETBACK_UV = 0.045
const ROOF_OBSTACLES_UV: { u0: number; u1: number; v0: number; v1: number; label: string }[] = [
  // Chimney bounds derived from its on-screen polygon (220-244 px × 207-232 px)
  { u0: 0.565, u1: 0.681, v0: 0.207, v1: 0.437, label: 'chimney' },
]

const PANEL_LAYOUT: { points: string; col: number; row: number }[] = (() => {
  const cols = 4, rows = 3
  const setbackU = 0.09, setbackV = 0.14
  const gapU = 0.015, gapV = 0.020
  const pW = (1 - 2 * setbackU - (cols - 1) * gapU) / cols
  const pH = (1 - 2 * setbackV - (rows - 1) * gapV) / rows
  const xy = (u: number, v: number): [string, string] => [
    (70 + 230 * u + 55 * v).toFixed(1),
    (250 - 87 * v).toFixed(1),
  ]
  const overlapsObstacle = (u0: number, u1: number, v0: number, v1: number) =>
    ROOF_OBSTACLES_UV.some(o =>
      u1 > o.u0 - OBSTACLE_SETBACK_UV && u0 < o.u1 + OBSTACLE_SETBACK_UV &&
      v1 > o.v0 - OBSTACLE_SETBACK_UV && v0 < o.v1 + OBSTACLE_SETBACK_UV
    )
  const out: { points: string; col: number; row: number }[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const u0 = setbackU + col * (pW + gapU)
      const u1 = u0 + pW
      const v0 = setbackV + row * (pH + gapV)
      const v1 = v0 + pH
      if (overlapsObstacle(u0, u1, v0, v1)) continue
      const [bx0, by0] = xy(u0, v0)
      const [bx1, by1] = xy(u1, v0)
      const [tx1, ty1] = xy(u1, v1)
      const [tx0, ty0] = xy(u0, v1)
      out.push({ points: `${bx0},${by0} ${bx1},${by1} ${tx1},${ty1} ${tx0},${ty0}`, col, row })
    }
  }
  return out
})()

// Sun-overhead time for each column (matches the sun-orbit animation: -90°→+90°
// over 20 s, sun screen x = 240 + 300·sin(angle)). Calculated against each
// column's centre x so the brightest panel always sits directly under the sun.
const PANEL_PEAK_T: readonly number[] = [0.37, 0.42, 0.48, 0.53]

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
      style={{ filter: 'drop-shadow(0 20px 60px rgba(176,64,32,0.18))' }}
    >
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <clipPath id="fslope"><polygon points="70,250 300,250 355,163 125,163" /></clipPath>
        <linearGradient id="wf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F4ECD6" />
          <stop offset="100%" stopColor="#E8D9B0" />
        </linearGradient>
        <linearGradient id="wr" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#E8D9B0" />
          <stop offset="100%" stopColor="#D6BC85" />
        </linearGradient>
        {/* Panel-lit overlay - gold→amber, fades in as the sun crosses the panel's column */}
        <linearGradient id="panel-lit" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="#FCD34D" />
          <stop offset="55%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>

      {/* Ground shadow - soft warm */}
      <ellipse cx="240" cy="350" rx="200" ry="18" fill="rgba(120,70,40,0.18)" />

      {/* Back slope - north-facing, in shadow (warm dark roof tile) */}
      <polygon points="180,185 410,185 355,163 125,163" fill="#7A4221" stroke="rgba(120,70,40,0.25)" strokeWidth="1" />
      {/* Right wall */}
      <polygon points="300,320 410,255 410,185 300,250" fill="url(#wr)" stroke="rgba(120,70,40,0.18)" strokeWidth="1" />
      {/* Front wall */}
      <polygon points="70,320 300,320 300,250 70,250" fill="url(#wf)" stroke="rgba(120,70,40,0.18)" strokeWidth="1" />
      {/* Front slope base - terracotta tile */}
      <polygon points="70,250 300,250 355,163 125,163" fill="#C25A2A" stroke="rgba(80,30,10,0.35)" strokeWidth="1" />

      {/* Solar panels - base navy + sun-tracking amber illumination wave */}
      <g clipPath="url(#fslope)">
        <polygon points="70,250 300,250 355,163 125,163" fill="rgba(20,30,50,0.05)" />
        {PANEL_LAYOUT.map(({ points, col }, i) => {
          const peak = PANEL_PEAK_T[col]
          const ramp = 0.13
          const keyTimes = `0;${(peak - ramp).toFixed(3)};${peak.toFixed(3)};${(peak + ramp).toFixed(3)};1`
          return (
            <g key={i}>
              {/* Base panel - always visible, deep navy */}
              <polygon points={points} fill="#1A2540" stroke="rgba(50,80,140,0.55)" strokeWidth="0.5" />
              {/* Lit overlay - fades in around this column's overhead-sun moment */}
              <polygon points={points} fill="url(#panel-lit)" opacity="0.08">
                <animate attributeName="opacity"
                  values="0.08;0.08;1;0.08;0.08"
                  keyTimes={keyTimes}
                  dur="20s" repeatCount="indefinite" />
              </polygon>
              {/* Filament outline - bright gold trace at peak */}
              <polygon points={points} fill="none" stroke="#FCD34D" strokeWidth="0.45" opacity="0">
                <animate attributeName="opacity"
                  values="0;0;0.85;0;0"
                  keyTimes={keyTimes}
                  dur="20s" repeatCount="indefinite" />
              </polygon>
            </g>
          )
        })}
      </g>

      {/* Ridge */}
      <line x1="125" y1="163" x2="355" y2="163" stroke="rgba(120,60,30,0.55)" strokeWidth="1.5" />

      {/* Chimney */}
      <polygon points="220,232 238,232 242,212 224,212" fill="#A35A2E" stroke="rgba(80,30,10,0.35)" strokeWidth="1" />
      <polygon points="218,212 244,212 248,207 222,207" fill="#8B4520" stroke="rgba(80,30,10,0.4)" strokeWidth="1" />

      {/* Windows - warm glow inside */}
      <rect x="95" y="270" width="42" height="34" rx="3" fill="rgba(252,211,77,0.35)" stroke="rgba(120,70,40,0.4)" strokeWidth="1" />
      <line x1="116" y1="270" x2="116" y2="304" stroke="rgba(120,70,40,0.4)" strokeWidth="0.5" />
      <line x1="95" y1="287" x2="137" y2="287" stroke="rgba(120,70,40,0.4)" strokeWidth="0.5" />
      <rect x="176" y="270" width="42" height="34" rx="3" fill="rgba(252,211,77,0.35)" stroke="rgba(120,70,40,0.4)" strokeWidth="1" />
      <line x1="197" y1="270" x2="197" y2="304" stroke="rgba(120,70,40,0.4)" strokeWidth="0.5" />
      <line x1="176" y1="287" x2="218" y2="287" stroke="rgba(120,70,40,0.4)" strokeWidth="0.5" />

      {/* Door - front entrance */}
      <rect x="252" y="282" width="26" height="38" rx="2" fill="#8B4520" stroke="rgba(60,20,5,0.5)" strokeWidth="1" />
      <circle cx="272" cy="301" r="2" fill="#F59E0B" />

      {/* Corner markers - sun-coloured pulse points */}
      {([[125, 163, 0.85], [355, 163, 0.85], [70, 250, 0.6], [300, 250, 0.6]] as const).map(([x, y, o]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="2.5" fill="#D97706" opacity={o} filter="url(#glow)" />
      ))}

      {/* Ground dash - hand-drawn earth line */}
      <line x1="30" y1="325" x2="450" y2="325" stroke="rgba(120,70,40,0.22)" strokeWidth="1" strokeDasharray="4,8" />

      {/* Scan beam - sun-amber sweep along the roof slope */}
      <line stroke="rgba(217,119,6,0.85)" strokeWidth="1.5" filter="url(#glow)">
        <animate attributeName="x1" values="125;70;125" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y1" values="163;250;163" dur="3s" repeatCount="indefinite" />
        <animate attributeName="x2" values="355;300;355" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y2" values="163;250;163" dur="3s" repeatCount="indefinite" />
      </line>
      <line stroke="rgba(252,211,77,0.30)" strokeWidth="10" filter="url(#glow)">
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
      style={{ background: 'rgba(250,246,236,0.85)', backdropFilter: 'blur(20px) saturate(180%)', borderColor: 'var(--ss-border)' }}
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <SunscanMark className="flex-shrink-0" />
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
      background: 'rgba(244,236,214,0.94)',
      border: '1px solid var(--ss-border-h)',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 6px 18px rgba(120,70,40,0.10), 0 1px 2px rgba(120,70,40,0.06)',
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
    <section className="relative flex items-center pt-20 pb-16 overflow-hidden ss-paper" style={{ minHeight: '100vh', background: 'var(--ss-ink)' }}>
      {/* Engineering grid - soft warm rule */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage:
          'linear-gradient(rgba(176,64,32,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(176,64,32,0.06) 1px,transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
      {/* Atmospheric sun glows - warm */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background:
          'radial-gradient(ellipse at 25% 55%,rgba(252,211,77,0.22) 0%,transparent 55%),' +
          'radial-gradient(ellipse at 78% 25%,rgba(217,119,6,0.18) 0%,transparent 50%),' +
          'radial-gradient(ellipse at 95% 95%,rgba(176,64,32,0.10) 0%,transparent 55%)',
      }} />
      {/* Horizon fade - bottom transitions to deeper toasted cream */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: 180, background: 'linear-gradient(transparent,rgba(222,203,153,0.4))' }} />

      <div className="relative z-10 max-w-6xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">

          {/* Content */}
          <div>
            <h1 className="ss-heading font-extrabold tracking-tight mb-5 leading-[1.04]"
              style={{ fontSize: 'clamp(32px,5vw,62px)', color: 'var(--ss-t1)' }}>
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

// ─── Features ─ Engineering Specification Sheet ──────────────────────────────
type FeatureCode = 'ROOF' | 'IRR' | 'GRID' | 'FCST' | 'OCR' | '3D'

const FEATURES: { num: string; code: FeatureCode; title: string; desc: string; specs: string[]; accent: string; ref: string }[] = [
  {
    num: '01', code: 'ROOF', accent: 'var(--ss-blue)',
    title: 'AI Roof Detection',
    desc: 'UPRN-linked OS NGD polygons fused with geometry analysis identify exact roof surfaces, pitch, and usable area from address alone.',
    specs: ['UPRN-locked', 'OS NGD polygons', 'Sub-metre precision'],
    ref: 'OS-NGD-2026',
  },
  {
    num: '02', code: 'IRR', accent: 'var(--ss-amber)',
    title: 'Irradiance Modelling',
    desc: 'MCS-certified zone and irradiance lookup with orientation-corrected kWh/m² figures. Pitch, azimuth, and regional climate accounted for.',
    specs: ['21 MCS zones', '7 pitch bands', 'Azimuth corrected'],
    ref: 'MCS-IRR-2026',
  },
  {
    num: '03', code: 'GRID', accent: 'var(--ss-violet-l)',
    title: 'Panel Layout Optimisation',
    desc: 'Grid packing respects edge setbacks, thermal gaps, and roof obstacles per BS 5534 wind-loading practice. Outputs exact row/column count with kWp system size.',
    specs: ['BS 5534 setbacks', 'Thermal gaps', 'Obstacle-aware'],
    ref: 'BS-5534-2026',
  },
  {
    num: '04', code: 'FCST', accent: 'var(--ss-green)',
    title: 'Generation Forecasting',
    desc: '25-year production model following MCS MIS 3002 methodology, with 4 % tariff inflation, self-consumption analysis, and battery-storage uplift modelling.',
    specs: ['25-yr horizon', '4 % tariff drift', 'Battery uplift'],
    ref: 'MIS-3002-2026',
  },
  {
    num: '05', code: 'OCR', accent: 'var(--ss-blue)',
    title: 'Bill OCR Parsing',
    desc: 'Upload an electricity bill. The unit rate, standing charge, and annual consumption are pulled straight off the page. No manual data entry.',
    specs: ['Unit rate', 'Standing charge', 'Annual kWh'],
    ref: 'BILL-OCR-2026',
  },
  {
    num: '06', code: '3D', accent: 'var(--ss-violet-l)',
    title: '3D Property Viewer',
    desc: 'An interactive 3D view of the property with panel overlay. Inspect from any angle, then drop the same render straight into the customer report.',
    specs: ['Drag to rotate', 'Panel overlay', 'In your report'],
    ref: 'VIS-3D-2026',
  },
]

// ─── Bespoke per-capability glyphs (technical illustrations, not icons) ──────
function GlyphRoof({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display: 'block' }}>
      <defs>
        <pattern id="roof-hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(38)">
          <line x1="0" y1="0" x2="0" y2="5" stroke={accent} strokeWidth="0.5" opacity="0.4" />
        </pattern>
      </defs>
      {/* Top dimension line */}
      <g stroke="var(--ss-t3)" strokeWidth="0.5">
        <line x1="38" y1="20" x2="178" y2="20" />
        <line x1="38" y1="16" x2="38" y2="24" />
        <line x1="178" y1="16" x2="178" y2="24" />
      </g>
      <text x="108" y="14" textAnchor="middle" fontSize="8" fontFamily="ui-monospace" fill="var(--ss-t3)">8.4 m</text>
      {/* Roof footprint */}
      <polygon points="38,28 178,28 186,116 30,116" fill="url(#roof-hatch)" stroke={accent} strokeWidth="1.2" />
      {/* Ridge */}
      <line x1="38" y1="72" x2="178" y2="72" stroke={accent} strokeDasharray="3 2.5" strokeWidth="0.7" />
      {/* Pitch chip */}
      <g transform="translate(108 55)">
        <rect x="-19" y="-9" width="38" height="18" rx="3" fill="var(--ss-ink)" stroke={accent} strokeWidth="0.8" />
        <text textAnchor="middle" y="4" fontSize="10" fontFamily="ui-monospace" fontWeight="700" fill={accent}>34°</text>
      </g>
      {/* Right dimension */}
      <g stroke="var(--ss-t3)" strokeWidth="0.5">
        <line x1="200" y1="28" x2="200" y2="116" />
        <line x1="196" y1="28" x2="204" y2="28" />
        <line x1="196" y1="116" x2="204" y2="116" />
      </g>
      <text x="200" y="74" textAnchor="middle" fontSize="8" fontFamily="ui-monospace" fill="var(--ss-t3)" transform="rotate(90 200 74)">5.2 m</text>
      {/* Stamp */}
      <text x="38" y="138" fontSize="7" fontFamily="ui-monospace" fill="var(--ss-t4)" letterSpacing="1">UPRN · 100094872</text>
    </svg>
  )
}

function GlyphIrradiance({ accent }: { accent: string }) {
  const positions = [
    { cx: 30, cy: 120, r: 2.5 },
    { cx: 70, cy: 56, r: 3 },
    { cx: 110, cy: 28, r: 5, big: true },
    { cx: 150, cy: 56, r: 3 },
    { cx: 190, cy: 120, r: 2.5 },
  ]
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display: 'block' }}>
      {/* Solar arc */}
      <path d="M 30 120 Q 110 -10 190 120" fill="none" stroke={accent} strokeDasharray="2 3" strokeWidth="0.8" opacity="0.6" />
      {positions.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.big ? '#F59E0B' : accent} opacity={p.big ? 1 : 0.7} />
          {p.big && <circle cx={p.cx} cy={p.cy} r={p.r + 4} fill="none" stroke="#F59E0B" strokeWidth="0.8" opacity="0.5" />}
        </g>
      ))}
      {/* Rays striking the surface */}
      <g stroke={accent} strokeWidth="0.6" opacity="0.55" strokeDasharray="1.5 2">
        <line x1="110" y1="32" x2="78" y2="120" />
        <line x1="110" y1="32" x2="98" y2="120" />
        <line x1="110" y1="32" x2="118" y2="120" />
        <line x1="110" y1="32" x2="138" y2="120" />
      </g>
      {/* Tilted roof surface */}
      <line x1="60" y1="124" x2="160" y2="124" stroke="var(--ss-t1)" strokeWidth="1.5" />
      <line x1="60" y1="124" x2="160" y2="106" stroke={accent} strokeWidth="1.5" opacity="0.78" />
      <path d="M 80 124 A 20 20 0 0 0 80 121" fill="none" stroke="var(--ss-t3)" strokeWidth="0.6" />
      <text x="86" y="120" fontSize="7" fontFamily="ui-monospace" fill="var(--ss-t3)">35°</text>
      {/* Reading chip */}
      <g transform="translate(176 96)">
        <rect x="-34" y="-9" width="68" height="18" rx="2" fill="var(--ss-ink)" stroke={accent} strokeWidth="0.6" />
        <text textAnchor="middle" y="4" fontSize="9" fontFamily="ui-monospace" fontWeight="700" fill={accent}>1067 kWh/m²</text>
      </g>
    </svg>
  )
}

function GlyphGrid({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display: 'block' }}>
      {/* Roof outline */}
      <rect x="20" y="22" width="180" height="106" rx="2" fill="none" stroke="var(--ss-t1)" strokeWidth="1.2" />
      {/* Setback dashed boundary */}
      <rect x="34" y="36" width="152" height="78" rx="1" fill="none" stroke={accent} strokeWidth="0.8" strokeDasharray="2 2.5" />
      {/* 5×3 panel grid */}
      {Array.from({ length: 15 }).map((_, i) => {
        const col = i % 5, row = Math.floor(i / 5)
        return (
          <rect key={i} x={36 + col * 30} y={38 + row * 26} width="26" height="22" rx="0.5"
            fill="#1A2540" stroke={accent} strokeWidth="0.4" opacity="0.92" />
        )
      })}
      {/* Setback annotation */}
      <g stroke={accent} strokeWidth="0.5">
        <line x1="20" y1="76" x2="34" y2="76" />
        <line x1="20" y1="73" x2="20" y2="79" />
        <line x1="34" y1="73" x2="34" y2="79" />
      </g>
      <text x="6" y="79" fontSize="7" fontFamily="ui-monospace" fill={accent}>300</text>
      {/* Top-right ref */}
      <text x="200" y="18" textAnchor="end" fontSize="7" fontFamily="ui-monospace" fill="var(--ss-t4)" letterSpacing="1">5×3 · 6.08 kWp</text>
      <text x="200" y="142" textAnchor="end" fontSize="7" fontFamily="ui-monospace" fill="var(--ss-t4)" letterSpacing="1">PLAN VIEW</text>
    </svg>
  )
}

function GlyphForecast({ accent }: { accent: string }) {
  const heights = [22, 30, 50, 64, 76, 82, 86, 78, 60, 42, 26, 18]
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display: 'block' }}>
      <line x1="22" y1="120" x2="200" y2="120" stroke="var(--ss-t3)" strokeWidth="0.6" />
      {[40, 70, 100].map((y, i) => (
        <line key={i} x1="22" y1={y} x2="200" y2={y} stroke="var(--ss-border)" strokeWidth="0.5" strokeDasharray="1 2" />
      ))}
      {heights.map((h, i) => {
        const x = 28 + i * 14
        const peak = i === 6
        return (
          <rect key={i} x={x} y={120 - h} width="9" height={h} fill={peak ? '#F59E0B' : accent} opacity={peak ? 1 : 0.85} />
        )
      })}
      {/* 25-yr drift overlay */}
      <path d="M 22 50 Q 110 56 200 70" fill="none" stroke="var(--ss-t1)" strokeWidth="1" strokeDasharray="3 2" />
      {/* Peak callout */}
      <g transform="translate(116 22)">
        <rect x="-26" y="-9" width="52" height="16" rx="2" fill="var(--ss-ink)" stroke={accent} strokeWidth="0.6" />
        <text textAnchor="middle" y="3" fontSize="8" fontFamily="ui-monospace" fontWeight="700" fill={accent}>JUL · PEAK</text>
      </g>
      <line x1="116" y1="22" x2="116" y2="36" stroke={accent} strokeWidth="0.6" strokeDasharray="1 1" />
      {/* Months axis */}
      <text x="22" y="138" fontSize="7" fontFamily="ui-monospace" fill="var(--ss-t4)" letterSpacing="1">J F M A M J J A S O N D · 25-yr horizon</text>
    </svg>
  )
}

function GlyphOCR({ accent }: { accent: string }) {
  const fields: { label: string; val: string }[] = [
    { label: 'unit_rate', val: '£0.245' },
    { label: 'standing', val: '£0.59' },
    { label: 'kwh_yr', val: '4 210' },
  ]
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display: 'block' }}>
      {/* Receipt at slight angle */}
      <g transform="translate(20 18) rotate(-4)">
        <rect x="0" y="0" width="92" height="112" fill="var(--ss-ink)" stroke="var(--ss-t3)" strokeWidth="0.8" />
        <path d="M 0 112 L 8 108 L 16 112 L 24 108 L 32 112 L 40 108 L 48 112 L 56 108 L 64 112 L 72 108 L 80 112 L 88 108 L 92 112"
          fill="none" stroke="var(--ss-t3)" strokeWidth="0.8" />
        <text x="46" y="14" textAnchor="middle" fontSize="6.2" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t1)">ENERGY BILL</text>
        <line x1="8" y1="20" x2="84" y2="20" stroke="var(--ss-t3)" strokeWidth="0.4" strokeDasharray="1 1" />
        {[28, 38, 48, 64, 74, 84, 94].map((y, i) => (
          <line key={i} x1="8" y1={y} x2={i % 2 === 0 ? 70 : 78} y2={y} stroke="var(--ss-t4)" strokeWidth="0.6" />
        ))}
        <rect x="6" y="58" width="80" height="10" fill={accent} opacity="0.18" />
        <rect x="6" y="58" width="80" height="10" fill="none" stroke={accent} strokeWidth="0.6" strokeDasharray="2 1.5" />
      </g>
      {/* Arrow */}
      <g stroke={accent} strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1="118" y1="74" x2="138" y2="74" />
        <polyline points="134,70 138,74 134,78" />
      </g>
      {/* Extracted JSON card */}
      <g transform="translate(146 36)">
        <rect x="0" y="0" width="64" height="78" rx="3" fill="var(--ss-ink)" stroke={accent} strokeWidth="0.8" />
        <circle cx="6" cy="6" r="1.5" fill={accent} />
        <text x="11" y="9" fontSize="5.5" fontFamily="ui-monospace" fill="var(--ss-t4)" letterSpacing="1">EXTRACTED</text>
        {fields.map((f, i) => (
          <g key={f.label} transform={`translate(0 ${22 + i * 18})`}>
            <text x="6" y="0" fontSize="6" fontFamily="ui-monospace" fill="var(--ss-t3)">{f.label}</text>
            <text x="58" y="9" textAnchor="end" fontSize="7" fontFamily="ui-monospace" fontWeight="700" fill={accent}>{f.val}</text>
          </g>
        ))}
      </g>
    </svg>
  )
}

function Glyph3D({ accent }: { accent: string }) {
  // Bilinear projection of 3×2 panel grid onto front roof slope
  const fp = (u: number, v: number) => {
    const x = (1 - u) * (1 - v) * 40 + u * (1 - v) * 110 + u * v * 142 + (1 - u) * v * 72
    const y = (1 - u) * (1 - v) * 116 + u * (1 - v) * 116 + u * v * 68 + (1 - u) * v * 68
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display: 'block' }}>
      {/* Construction wireframe */}
      <g stroke="var(--ss-border-h)" strokeWidth="0.4" strokeDasharray="2 2" fill="none">
        <line x1="20" y1="40" x2="200" y2="40" />
        <line x1="20" y1="120" x2="200" y2="120" />
        <line x1="60" y1="20" x2="60" y2="140" />
        <line x1="160" y1="20" x2="160" y2="140" />
      </g>
      {/* Front slope (panels live here) */}
      <polygon points="40,116 110,116 142,68 72,68" fill="#C25A2A" stroke="var(--ss-t1)" strokeWidth="1" />
      {/* Back slope */}
      <polygon points="110,116 178,116 142,68" fill="#7A4221" stroke="var(--ss-t1)" strokeWidth="1" />
      {/* Right wall */}
      <polygon points="110,116 110,140 178,140 178,116" fill="#E8D9B0" stroke="var(--ss-t1)" strokeWidth="1" />
      {/* Front wall */}
      <polygon points="40,116 40,140 110,140 110,116" fill="#F4ECD6" stroke="var(--ss-t1)" strokeWidth="1" />
      {/* 3×2 panel grid on front slope */}
      {Array.from({ length: 6 }).map((_, i) => {
        const col = i % 3, row = Math.floor(i / 3)
        const u0 = 0.1 + col * 0.27, u1 = u0 + 0.24
        const v0 = 0.16 + row * 0.4, v1 = v0 + 0.34
        return (
          <polygon key={i}
            points={`${fp(u0, v0)} ${fp(u1, v0)} ${fp(u1, v1)} ${fp(u0, v1)}`}
            fill="#1A2540" stroke={accent} strokeWidth="0.4" opacity="0.95" />
        )
      })}
      {/* Axis indicator */}
      <g transform="translate(190 28)" stroke="var(--ss-t1)" strokeWidth="0.7" fill="none">
        <line x1="0" y1="0" x2="9" y2="0" />
        <line x1="0" y1="0" x2="0" y2="-9" />
        <line x1="0" y1="0" x2="-7" y2="4" />
      </g>
      <text x="202" y="29" fontSize="6" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t1)">x</text>
      <text x="190" y="16" fontSize="6" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t1)">y</text>
      <text x="178" y="36" fontSize="6" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t1)">z</text>
      {/* Stamp */}
      <text x="20" y="14" fontSize="6.5" fontFamily="ui-monospace" fill="var(--ss-t4)" letterSpacing="1.5">ISO · 1:60</text>
    </svg>
  )
}

function renderGlyph(code: FeatureCode, accent: string): ReactNode {
  switch (code) {
    case 'ROOF': return <GlyphRoof accent={accent} />
    case 'IRR':  return <GlyphIrradiance accent={accent} />
    case 'GRID': return <GlyphGrid accent={accent} />
    case 'FCST': return <GlyphForecast accent={accent} />
    case 'OCR':  return <GlyphOCR accent={accent} />
    case '3D':   return <Glyph3D accent={accent} />
  }
}

// ─── A single specification entry on the schedule ────────────────────────────
function SpecEntry({ entry, index, reverse }: { entry: typeof FEATURES[number]; index: number; reverse: boolean }) {
  return (
    <li className="relative grid grid-cols-12 gap-x-4 md:gap-x-10 gap-y-6 py-8 md:py-12"
        style={{ borderTop: index === 0 ? 'none' : '1px solid var(--ss-border)' }}>

      {/* Glyph plate */}
      <div className={`col-span-12 md:col-span-5 flex items-center justify-center ${reverse ? 'md:order-2' : ''}`}>
        <div className="relative w-full max-w-[320px]"
             style={{ padding: '20px 22px', background: 'var(--ss-ink)', border: '1px solid var(--ss-border)', borderRadius: 4 }}>
          {/* Hairline corner brackets */}
          {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
            <span key={c} className="absolute pointer-events-none" style={{
              width: 7, height: 7,
              borderTop:    c.includes('t') ? `1px solid ${entry.accent}` : 'none',
              borderBottom: c.includes('b') ? `1px solid ${entry.accent}` : 'none',
              borderLeft:   c.includes('l') ? `1px solid ${entry.accent}` : 'none',
              borderRight:  c.includes('r') ? `1px solid ${entry.accent}` : 'none',
              top:    c.includes('t') ? -1 : 'auto',
              bottom: c.includes('b') ? -1 : 'auto',
              left:   c.includes('l') ? -1 : 'auto',
              right:  c.includes('r') ? -1 : 'auto',
            }} />
          ))}
          {renderGlyph(entry.code, entry.accent)}
        </div>
      </div>

      {/* Body */}
      <div className={`col-span-12 md:col-span-7 flex flex-col justify-center ${reverse ? 'md:order-1' : ''}`}>
        {/* Reference stamp */}
        <div className="ss-mono text-[10px] uppercase flex items-center gap-2 mb-4 flex-wrap" style={{ letterSpacing: '0.18em' }}>
          <span style={{ background: entry.accent, color: '#FAF6EC', padding: '3px 7px', borderRadius: 2, fontWeight: 800 }}>
            {entry.num}
          </span>
          <span style={{ color: 'var(--ss-t4)' }}>/</span>
          <span style={{ color: entry.accent, fontWeight: 700 }}>{entry.code}</span>
          <span style={{ color: 'var(--ss-t4)' }}>·</span>
          <span style={{ color: 'var(--ss-t4)' }}>{entry.ref}</span>
        </div>

        <h3 className="ss-heading font-extrabold mb-3"
            style={{ fontSize: 'clamp(22px,2.6vw,30px)', color: 'var(--ss-t1)', lineHeight: 1.05 }}>
          {entry.title}
        </h3>
        <p className="text-[15px] leading-relaxed mb-5" style={{ color: 'var(--ss-t3)', maxWidth: 480 }}>
          {entry.desc}
        </p>

        <div className="flex flex-wrap gap-2">
          {entry.specs.map((s) => (
            <span key={s} className="ss-mono text-[11px] uppercase tracking-wider px-2.5 py-1 inline-flex items-center gap-1.5"
                  style={{ background: 'var(--ss-ink)', border: '1px solid var(--ss-border-h)', borderRadius: 2, color: 'var(--ss-t2)' }}>
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: entry.accent }} />
              {s}
            </span>
          ))}
        </div>
      </div>
    </li>
  )
}

// ─── Solar-azimuth compass (title-block ornament) ────────────────────────────
function AzimuthCompass() {
  return (
    <svg viewBox="0 0 160 140" width="100%" height="100%">
      <circle cx="80" cy="80" r="44" fill="none" stroke="var(--ss-t3)" strokeWidth="0.7" />
      <circle cx="80" cy="80" r="36" fill="none" stroke="var(--ss-border-h)" strokeWidth="0.5" strokeDasharray="2 2" />
      {Array.from({ length: 24 }).map((_, i) => {
        const a = (i * 15 - 90) * Math.PI / 180
        const major = i % 6 === 0
        return (
          <line key={i}
            x1={(80 + Math.cos(a) * 44).toFixed(2)} y1={(80 + Math.sin(a) * 44).toFixed(2)}
            x2={(80 + Math.cos(a) * (major ? 36 : 40)).toFixed(2)} y2={(80 + Math.sin(a) * (major ? 36 : 40)).toFixed(2)}
            stroke={major ? 'var(--ss-t1)' : 'var(--ss-t3)'} strokeWidth={major ? 1 : 0.5} />
        )
      })}
      <text x="80" y="33"  textAnchor="middle" fontSize="9" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t1)">N</text>
      <text x="80" y="132" textAnchor="middle" fontSize="9" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-blue)">S</text>
      <text x="33"  y="84" textAnchor="middle" fontSize="9" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t1)">W</text>
      <text x="127" y="84" textAnchor="middle" fontSize="9" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t1)">E</text>
      {/* Solar arc */}
      <path d="M 36 80 Q 80 30 124 80" fill="none" stroke="var(--ss-amber)" strokeWidth="1" strokeDasharray="3 2" opacity="0.85" />
      <circle cx="80" cy="42" r="5"   fill="var(--ss-amber-l)" />
      <circle cx="80" cy="42" r="2.5" fill="#FEF3C7" />
      {/* True-south needle */}
      <line x1="80" y1="80" x2="80" y2="118" stroke="var(--ss-blue)" strokeWidth="1.4" />
      <polygon points="80,118 76,114 84,114" fill="var(--ss-blue)" />
      <circle cx="80" cy="80" r="2" fill="var(--ss-t1)" />
      <text x="80" y="14" textAnchor="middle" fontSize="7" fontFamily="ui-monospace" fill="var(--ss-t3)" letterSpacing="1.5">SOLAR AZIMUTH · UK</text>
    </svg>
  )
}

function Features() {
  return (
    <section id="features" className="relative py-16 md:py-28 ss-paper" style={{ background: 'var(--ss-ink)' }}>
      {/* Faint engineering grid (subtler than hero) */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage:
          'linear-gradient(rgba(176,64,32,0.04) 1px,transparent 1px),' +
          'linear-gradient(90deg,rgba(176,64,32,0.04) 1px,transparent 1px)',
        backgroundSize: '48px 48px',
      }} />

      <div className="relative max-w-[1100px] mx-auto px-4 md:px-6">

        {/* ── Title block ─ drawing-style metadata strip + heading + compass ── */}
        <div className="mb-8 md:mb-12">
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap ss-mono text-[10px] uppercase pb-3 mb-8"
               style={{ letterSpacing: '0.22em', color: 'var(--ss-t3)', borderBottom: '1px solid var(--ss-border)' }}>
            <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ss-blue)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ss-blue)' }} />
              Capabilities
            </span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Doc.&nbsp;Spec-2026.A</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Rev.&nbsp;04</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>MCS-aligned</span>
            <span className="ml-auto hidden md:inline" style={{ color: 'var(--ss-t4)' }}>Sheet 01 / 06</span>
          </div>

          <div className="grid md:grid-cols-[1fr_auto] gap-8 items-end">
            <div>
              <h2 className="ss-heading font-extrabold tracking-tight mb-4"
                  style={{ fontSize: 'clamp(26px,5vw,56px)', color: 'var(--ss-t1)', lineHeight: 1.04 }}>
                Built for installation-<br />grade accuracy.
              </h2>
              <p className="text-[15px] leading-relaxed max-w-[480px]" style={{ color: 'var(--ss-t3)' }}>
                Six subsystems, drawn to MCS-2024 standard. Each one outputs export-ready
                data for your proposal workflow. No manual remeasurement, no satellite uploads.
              </p>
            </div>
            <div className="hidden md:block flex-shrink-0" style={{ width: 160, height: 140 }}>
              <AzimuthCompass />
            </div>
          </div>
        </div>

        {/* ── Drawing plate ─ corner-bracketed schedule of subsystems ──────── */}
        <div className="relative" style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border-h)', borderRadius: 4 }}>
          {/* Heavy corner brackets */}
          {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
            <span key={c} className="absolute pointer-events-none" style={{
              width: 18, height: 18,
              borderTop:    c.includes('t') ? '2px solid var(--ss-blue)' : 'none',
              borderBottom: c.includes('b') ? '2px solid var(--ss-blue)' : 'none',
              borderLeft:   c.includes('l') ? '2px solid var(--ss-blue)' : 'none',
              borderRight:  c.includes('r') ? '2px solid var(--ss-blue)' : 'none',
              top:    c.includes('t') ? -3 : 'auto',
              bottom: c.includes('b') ? -3 : 'auto',
              left:   c.includes('l') ? -3 : 'auto',
              right:  c.includes('r') ? -3 : 'auto',
            }} />
          ))}

          {/* Plate header strip */}
          <div className="flex items-center gap-3 px-6 py-3 flex-wrap"
               style={{ borderBottom: '1px dashed var(--ss-border-h)', color: 'var(--ss-t3)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="1" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
            <span className="ss-mono text-[10px] uppercase" style={{ letterSpacing: '0.22em' }}>
              Plate&nbsp;A · Subsystem schedule (6&nbsp;entries)
            </span>
            <span className="ml-auto ss-mono text-[10px]" style={{ letterSpacing: '0.22em', color: 'var(--ss-t4)' }}>
              SCALE 1:1
            </span>
          </div>

          {/* Entries */}
          <ol className="px-4 md:px-12">
            {FEATURES.map((entry, i) => (
              <SpecEntry key={entry.num} entry={entry} index={i} reverse={i % 2 === 1} />
            ))}
          </ol>

          {/* Plate footer strip */}
          <div className="flex items-center gap-x-3 gap-y-1 px-6 py-3 ss-mono text-[10px] uppercase flex-wrap"
               style={{ letterSpacing: '0.22em', borderTop: '1px dashed var(--ss-border-h)', color: 'var(--ss-t4)' }}>
            <span>Drawn:</span>
            <span style={{ color: 'var(--ss-t2)' }}>SunScan&nbsp;Engineering</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Checked:</span>
            <span style={{ color: 'var(--ss-t2)' }}>MCS-2024 Annex&nbsp;C</span>
            <span className="ml-auto inline-flex items-center gap-1.5" style={{ color: 'var(--ss-blue)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ss-blue)' }} />
              APPROVED
            </span>
          </div>
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

// ─── How It Works ─ Method Statement ────────────────────────────────────────
type StepCode = 'INTAKE' | 'COMPUTE' | 'DELIVER'

const STEPS: { num: string; code: StepCode; title: string; desc: string; deliverable: string; eta: string; accent: string }[] = [
  {
    num: '01', code: 'INTAKE', accent: 'var(--ss-blue)',
    title: 'Enter Address',
    desc: 'Type any UK address or postcode. OS Places autocomplete locks onto the UPRN. Drop in the customer’s electricity bill for accurate tariff modelling.',
    deliverable: 'UPRN locked',
    eta: '~ 5 s',
  },
  {
    num: '02', code: 'COMPUTE', accent: 'var(--ss-amber)',
    title: 'AI Analysis',
    desc: 'Roof geometry pulled from OS NGD. Irradiance read from MCS lookup tables. Panel count, kWp, and annual generation calculated automatically.',
    deliverable: 'Specification ready',
    eta: '~ 30 s',
  },
  {
    num: '03', code: 'DELIVER', accent: 'var(--ss-violet-l)',
    title: 'Download Report',
    desc: 'A full report rendered with the 3D model, panel layout, 25-year savings projection, and MCS-compliant generation estimates.',
    deliverable: 'Report exported',
    eta: '~ 60 s',
  },
]

function GlyphIntake({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display: 'block' }}>
      {/* Search input */}
      <rect x="20" y="22" width="180" height="30" rx="4" fill="var(--ss-ink)" stroke={accent} strokeWidth="1" />
      <circle cx="34" cy="37" r="4.5" fill="none" stroke="var(--ss-t3)" strokeWidth="1" />
      <line x1="38" y1="41" x2="42" y2="45" stroke="var(--ss-t3)" strokeWidth="1" strokeLinecap="round" />
      <text x="50" y="41" fontSize="9" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t1)">NR1 3LP</text>
      {/* Blinking cursor */}
      <line x1="89" y1="32" x2="89" y2="44" stroke={accent} strokeWidth="1.2">
        <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
      </line>
      {/* Suggestions panel */}
      <rect x="20" y="56" width="180" height="58" rx="4" fill="var(--ss-ink)" stroke="var(--ss-border-h)" strokeWidth="0.6" />
      {/* Highlighted suggestion */}
      <rect x="22" y="74" width="176" height="14" fill={accent} opacity="0.10" />
      <line x1="32" y1="68"  x2="170" y2="68"  stroke="var(--ss-t4)" strokeWidth="0.6" />
      <line x1="32" y1="82"  x2="184" y2="82"  stroke={accent} strokeWidth="0.7" />
      <line x1="32" y1="96"  x2="156" y2="96"  stroke="var(--ss-t4)" strokeWidth="0.6" />
      <line x1="32" y1="108" x2="148" y2="108" stroke="var(--ss-t4)" strokeWidth="0.6" />
      <polygon points="186,80 192,84 186,88" fill={accent} />
      {/* Result tag */}
      <g transform="translate(110 132)">
        <rect x="-50" y="-9" width="100" height="18" rx="2" fill={accent} />
        <text textAnchor="middle" y="4" fontSize="8" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-ink)" letterSpacing="1.5">→ UPRN 100094872</text>
      </g>
    </svg>
  )
}

function GlyphCompute({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display: 'block' }}>
      {/* Roof footprint w/ panels */}
      <polygon points="60,46 160,46 168,114 52,114" fill="none" stroke={accent} strokeWidth="1" strokeDasharray="3 2" />
      {Array.from({ length: 9 }).map((_, i) => {
        const col = i % 3, row = Math.floor(i / 3)
        return (
          <rect key={i} x={70 + col * 26} y={56 + row * 19} width="22" height="16"
            fill="#1A2540" stroke={accent} strokeWidth="0.4" opacity="0.92" />
        )
      })}
      {/* Animated scan beam */}
      <line stroke={accent} strokeWidth="0.8" opacity="0.6">
        <animate attributeName="x1" values="40;200;40" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y1" values="20;20;20" dur="3s" repeatCount="indefinite" />
        <animate attributeName="x2" values="40;200;40" dur="3s" repeatCount="indefinite" />
        <animate attributeName="y2" values="140;140;140" dur="3s" repeatCount="indefinite" />
      </line>
      {/* Floating data chips */}
      <g transform="translate(20 22)">
        <rect x="-2" y="-7" width="56" height="14" rx="2" fill="var(--ss-ink)" stroke="var(--ss-amber)" strokeWidth="0.6" />
        <text x="0" y="3" fontSize="7" fontFamily="ui-monospace" fill="var(--ss-amber)" fontWeight="700" letterSpacing="0.5">ZONE 5</text>
      </g>
      <g transform="translate(176 22)">
        <rect x="-32" y="-7" width="34" height="14" rx="2" fill="var(--ss-ink)" stroke={accent} strokeWidth="0.6" />
        <text x="-30" y="3" fontSize="7" fontFamily="ui-monospace" fill={accent} fontWeight="700" letterSpacing="0.5">35°</text>
      </g>
      <g transform="translate(20 134)">
        <rect x="-2" y="-7" width="58" height="14" rx="2" fill="var(--ss-ink)" stroke={accent} strokeWidth="0.6" />
        <text x="0" y="3" fontSize="7" fontFamily="ui-monospace" fill={accent} fontWeight="700" letterSpacing="0.5">6.08 kWp</text>
      </g>
      <g transform="translate(192 134)">
        <rect x="-50" y="-7" width="52" height="14" rx="2" fill="var(--ss-ink)" stroke="var(--ss-amber)" strokeWidth="0.6" />
        <text x="-48" y="3" fontSize="7" fontFamily="ui-monospace" fill="var(--ss-amber)" fontWeight="700" letterSpacing="0.5">8 340 kWh</text>
      </g>
      {/* Connector lines from chips into roof */}
      <line x1="54" y1="22" x2="60" y2="46"   stroke="var(--ss-border-h)" strokeWidth="0.5" strokeDasharray="1.5 1.5" />
      <line x1="142" y1="22" x2="160" y2="46"  stroke="var(--ss-border-h)" strokeWidth="0.5" strokeDasharray="1.5 1.5" />
      <line x1="56" y1="134" x2="60" y2="114"  stroke="var(--ss-border-h)" strokeWidth="0.5" strokeDasharray="1.5 1.5" />
      <line x1="142" y1="134" x2="168" y2="114" stroke="var(--ss-border-h)" strokeWidth="0.5" strokeDasharray="1.5 1.5" />
    </svg>
  )
}

function GlyphDeliver({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display: 'block' }}>
      {/* Stack: back & middle pages, lightly fanned */}
      <g transform="rotate(-4 100 80)">
        <rect x="46" y="32" width="100" height="100" fill="var(--ss-s2)" stroke="var(--ss-t3)" strokeWidth="0.7" />
      </g>
      <g transform="rotate(2.5 110 76)">
        <rect x="56" y="26" width="100" height="100" fill="var(--ss-s1)" stroke="var(--ss-t3)" strokeWidth="0.7" />
      </g>
      {/* Front page */}
      <rect x="58" y="22" width="104" height="106" fill="var(--ss-ink)" stroke="var(--ss-t1)" strokeWidth="0.9" />
      {/* Header band */}
      <rect x="58" y="22" width="104" height="14" fill={accent} />
      <text x="68" y="32" fontSize="7" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-ink)" letterSpacing="2">SUNSCAN · REPORT</text>
      {/* Mini chart */}
      {[16, 24, 34, 44, 52, 58, 60, 54, 42, 30, 22, 16].map((h, i) => (
        <rect key={i} x={64 + i * 7.5} y={102 - h} width="5" height={h} fill="#1A2540" opacity="0.78" />
      ))}
      <line x1="62" y1="102" x2="158" y2="102" stroke="var(--ss-t3)" strokeWidth="0.5" />
      {/* Header lines */}
      <line x1="62" y1="44" x2="120" y2="44" stroke="var(--ss-t4)" strokeWidth="0.6" />
      <line x1="62" y1="50" x2="142" y2="50" stroke="var(--ss-t4)" strokeWidth="0.6" />
      {/* Footer stat */}
      <text x="62" y="118" fontSize="7" fontFamily="ui-monospace" fill="var(--ss-t3)" letterSpacing="0.5">25-yr · £42,800</text>
      {/* MCS approval stamp */}
      <g transform="translate(186 110) rotate(-12)">
        <ellipse cx="0" cy="0" rx="22" ry="11" fill="none" stroke={accent} strokeWidth="1" opacity="0.85" />
        <ellipse cx="0" cy="0" rx="18" ry="8"  fill="none" stroke={accent} strokeWidth="0.5" opacity="0.55" />
        <text textAnchor="middle" y="3" fontSize="6.5" fontFamily="ui-monospace" fontWeight="700" fill={accent} letterSpacing="1.5">MCS · OK</text>
      </g>
      {/* Download arrow at top */}
      <g transform="translate(110 12)" stroke={accent} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <line x1="0" y1="-4" x2="0" y2="6" />
        <polyline points="-4,2 0,6 4,2" />
      </g>
    </svg>
  )
}

function renderStepGlyph(code: StepCode, accent: string): ReactNode {
  switch (code) {
    case 'INTAKE':  return <GlyphIntake  accent={accent} />
    case 'COMPUTE': return <GlyphCompute accent={accent} />
    case 'DELIVER': return <GlyphDeliver accent={accent} />
  }
}

function FlowArrow({ accent }: { accent: string }) {
  return (
    <div className="hidden md:flex items-center justify-center self-center" style={{ width: 72 }}>
      <svg viewBox="0 0 80 28" width="80" height="28" style={{ display: 'block', overflow: 'visible' }}>
        {/* Dashed shaft */}
        <line x1="2" y1="14" x2="64" y2="14" stroke={accent} strokeWidth="1.2" strokeDasharray="4 3" />
        {/* Engineering double-line arrowhead */}
        <polyline points="58,7 70,14 58,21" stroke={accent} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Centre tick */}
        <line x1="33" y1="9" x2="33" y2="19" stroke={accent} strokeWidth="0.7" opacity="0.6" />
      </svg>
    </div>
  )
}

function StationCard({ step }: { step: typeof STEPS[number] }) {
  return (
    <article className="relative flex flex-col" style={{ background: 'var(--ss-ink)', border: '1px solid var(--ss-border)', borderRadius: 4 }}>
      {/* Hairline corner ticks */}
      {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
        <span key={c} className="absolute pointer-events-none" style={{
          width: 8, height: 8,
          borderTop:    c.includes('t') ? `1px solid ${step.accent}` : 'none',
          borderBottom: c.includes('b') ? `1px solid ${step.accent}` : 'none',
          borderLeft:   c.includes('l') ? `1px solid ${step.accent}` : 'none',
          borderRight:  c.includes('r') ? `1px solid ${step.accent}` : 'none',
          top:    c.includes('t') ? -1 : 'auto',
          bottom: c.includes('b') ? -1 : 'auto',
          left:   c.includes('l') ? -1 : 'auto',
          right:  c.includes('r') ? -1 : 'auto',
        }} />
      ))}

      {/* Stage stamp */}
      <div className="ss-mono text-[10px] uppercase flex items-center gap-2 px-5 pt-5" style={{ letterSpacing: '0.18em' }}>
        <span style={{ background: step.accent, color: '#FAF6EC', padding: '3px 7px', borderRadius: 2, fontWeight: 800 }}>
          STAGE {step.num}
        </span>
        <span style={{ color: 'var(--ss-t4)' }}>/</span>
        <span style={{ color: step.accent, fontWeight: 700 }}>{step.code}</span>
      </div>

      {/* Glyph plate */}
      <div className="px-5 pt-5 pb-1">
        <div className="relative" style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border)', borderRadius: 3, padding: '14px 14px' }}>
          {renderStepGlyph(step.code, step.accent)}
        </div>
      </div>

      {/* Title + body */}
      <div className="px-5 pt-4 pb-5 flex-1 flex flex-col">
        <h3 className="ss-heading font-extrabold mb-2" style={{ fontSize: 22, color: 'var(--ss-t1)', lineHeight: 1.1 }}>
          {step.title}
        </h3>
        <p className="text-[14px] leading-relaxed mb-4" style={{ color: 'var(--ss-t3)' }}>
          {step.desc}
        </p>

        {/* Spec mini-table */}
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 ss-mono text-[10px] uppercase pt-3 mt-auto"
             style={{ letterSpacing: '0.18em', borderTop: '1px solid var(--ss-border)' }}>
          <span style={{ color: 'var(--ss-t4)' }}>Output</span>
          <span className="text-right md:text-left" style={{ color: 'var(--ss-t2)', fontWeight: 700 }}>↳ {step.deliverable}</span>
          <span style={{ color: 'var(--ss-t4)' }}>Elapsed</span>
          <span className="text-right md:text-left" style={{ color: step.accent, fontWeight: 700 }}>{step.eta}</span>
        </div>
      </div>
    </article>
  )
}

function ProcessTimeline() {
  // Cumulative seconds at each stage end -> percentage of 60s timeline
  const ticks = [
    { p: 0,   l: '0 s'  },
    { p: 8,   l: '5 s'  },
    { p: 50,  l: '30 s' },
    { p: 100, l: '60 s' },
  ]
  return (
    <div className="hidden md:block relative mx-auto" style={{ height: 38, maxWidth: 720 }}>
      {/* baseline */}
      <div className="absolute" style={{ left: 0, right: 0, top: 14, height: 1, background: 'var(--ss-border-h)' }} />
      {/* progress fill underline (static, illustrative) */}
      <div className="absolute" style={{ left: 0, top: 14, height: 1, width: '100%', background: 'linear-gradient(90deg,var(--ss-blue),var(--ss-amber),var(--ss-violet-l))', opacity: 0.45 }} />
      {/* major ticks */}
      {ticks.map(t => (
        <div key={t.p} className="absolute" style={{ left: `${t.p}%`, top: 8, width: 1, height: 13, background: 'var(--ss-t3)' }} />
      ))}
      {/* tick labels */}
      {ticks.map(t => (
        <span key={`l-${t.p}`} className="absolute ss-mono text-[10px]"
              style={{
                left: `${t.p}%`,
                top: 24,
                transform: t.p === 0 ? 'translateX(0)' : t.p === 100 ? 'translateX(-100%)' : 'translateX(-50%)',
                color: 'var(--ss-t4)', letterSpacing: '0.18em',
              }}>
          {t.l}
        </span>
      ))}
      {/* minor ticks every 10% (1/10th sub-divisions) */}
      {Array.from({ length: 11 }).map((_, i) => (
        <div key={i} className="absolute" style={{ left: `${i * 10}%`, top: 12, width: 1, height: 5, background: 'var(--ss-border-h)' }} />
      ))}
      {/* travelling dot */}
      <span className="absolute" style={{
        top: 9, width: 11, height: 11,
        borderRadius: '50%',
        background: 'var(--ss-amber-l)',
        boxShadow: '0 0 8px rgba(245,158,11,0.55), 0 0 16px rgba(217,119,6,0.25)',
        transform: 'translateX(-50%)',
        animation: 'ss-eta-travel 9s ease-in-out infinite',
      }} />
      {/* "elapsed" label on left */}
      <span className="absolute ss-mono text-[10px] uppercase" style={{ left: 0, top: -16, letterSpacing: '0.22em', color: 'var(--ss-t3)' }}>
        Elapsed time →
      </span>
    </div>
  )
}

function Process() {
  return (
    <section id="how-it-works" className="relative py-16 md:py-28 ss-paper" style={{ background: 'var(--ss-ink)' }}>
      {/* Faint engineering grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage:
          'linear-gradient(rgba(176,64,32,0.04) 1px,transparent 1px),' +
          'linear-gradient(90deg,rgba(176,64,32,0.04) 1px,transparent 1px)',
        backgroundSize: '48px 48px',
      }} />

      <div className="relative max-w-[1100px] mx-auto px-4 md:px-6">

        {/* ── Title block ─ method-statement metadata strip ─────────────── */}
        <div className="mb-8 md:mb-12">
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap ss-mono text-[10px] uppercase pb-3 mb-8"
               style={{ letterSpacing: '0.22em', color: 'var(--ss-t3)', borderBottom: '1px solid var(--ss-border)' }}>
            <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ss-blue)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ss-blue)' }} />
              Workflow
            </span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Doc.&nbsp;Proc-2026.B</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Rev.&nbsp;04</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Method statement</span>
            <span className="ml-auto hidden md:inline" style={{ color: 'var(--ss-t4)' }}>3 stages · ≤ 60 s</span>
          </div>

          <div className="grid md:grid-cols-[1fr_auto] gap-8 items-end">
            <div>
              <h2 className="ss-heading font-extrabold tracking-tight mb-4"
                  style={{ fontSize: 'clamp(26px,5vw,56px)', color: 'var(--ss-t1)', lineHeight: 1.04 }}>
                From address to report.<br />In three stages.
              </h2>
              <p className="text-[15px] leading-relaxed max-w-[480px]" style={{ color: 'var(--ss-t3)' }}>
                No satellite uploads. No manual remeasurement. The entire procedure
                runs on a postcode and a bill. Field-tested under sixty seconds.
              </p>
            </div>

            {/* Procedure stamp - hand-drawn ink seal */}
            <div className="hidden md:flex flex-shrink-0 items-end justify-end" style={{ width: 160, height: 130 }}>
              <svg viewBox="0 0 160 130" width="100%" height="100%">
                {/* Outer ring */}
                <circle cx="80" cy="74" r="48" fill="none" stroke="var(--ss-blue)" strokeWidth="1.4" opacity="0.85" />
                <circle cx="80" cy="74" r="42" fill="none" stroke="var(--ss-blue)" strokeWidth="0.5" opacity="0.5" />
                {/* Curved ring text approximated via mono labels */}
                <text x="80" y="36" textAnchor="middle" fontSize="7" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-blue)" letterSpacing="2">FIELD-TESTED</text>
                <text x="80" y="118" textAnchor="middle" fontSize="7" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-blue)" letterSpacing="2">SUNSCAN · UK</text>
                {/* Hairlines top & bottom */}
                <line x1="42" y1="40" x2="118" y2="40" stroke="var(--ss-blue)" strokeWidth="0.5" opacity="0.5" />
                <line x1="42" y1="108" x2="118" y2="108" stroke="var(--ss-blue)" strokeWidth="0.5" opacity="0.5" />
                {/* Centre - countdown numerals */}
                <text x="80" y="72"  textAnchor="middle" fontSize="11" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t1)" letterSpacing="2">≤ 60</text>
                <text x="80" y="86" textAnchor="middle" fontSize="7"  fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-t3)" letterSpacing="2">SECONDS</text>
                {/* Tiny rivets */}
                {[0, 90, 180, 270].map(deg => {
                  const r = (deg * Math.PI) / 180
                  return <circle key={deg} cx={80 + Math.cos(r) * 48} cy={74 + Math.sin(r) * 48} r="1.5" fill="var(--ss-blue)" />
                })}
              </svg>
            </div>
          </div>
        </div>

        {/* ── Method-statement plate ─ stations + flow + timeline ───────── */}
        <div className="relative" style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border-h)', borderRadius: 4 }}>
          {/* Heavy corner brackets */}
          {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
            <span key={c} className="absolute pointer-events-none" style={{
              width: 18, height: 18,
              borderTop:    c.includes('t') ? '2px solid var(--ss-blue)' : 'none',
              borderBottom: c.includes('b') ? '2px solid var(--ss-blue)' : 'none',
              borderLeft:   c.includes('l') ? '2px solid var(--ss-blue)' : 'none',
              borderRight:  c.includes('r') ? '2px solid var(--ss-blue)' : 'none',
              top:    c.includes('t') ? -3 : 'auto',
              bottom: c.includes('b') ? -3 : 'auto',
              left:   c.includes('l') ? -3 : 'auto',
              right:  c.includes('r') ? -3 : 'auto',
            }} />
          ))}

          {/* Plate header strip */}
          <div className="flex items-center gap-3 px-6 py-3 flex-wrap"
               style={{ borderBottom: '1px dashed var(--ss-border-h)', color: 'var(--ss-t3)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span className="ss-mono text-[10px] uppercase" style={{ letterSpacing: '0.22em' }}>
              Plate&nbsp;B · Method statement (3&nbsp;stages)
            </span>
            <span className="ml-auto ss-mono text-[10px]" style={{ letterSpacing: '0.22em', color: 'var(--ss-t4)' }}>
              ELAPSED ≤ 60 s
            </span>
          </div>

          {/* Stations + flow arrows */}
          <div className="px-4 md:px-10 pt-8 md:pt-10 pb-6">
            <div className="grid md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-6 md:gap-3 items-stretch">
              <StationCard step={STEPS[0]} />
              <FlowArrow accent="var(--ss-blue)" />
              <StationCard step={STEPS[1]} />
              <FlowArrow accent="var(--ss-amber)" />
              <StationCard step={STEPS[2]} />
            </div>

            {/* Timeline ribbon */}
            <div className="mt-12 pt-2">
              <ProcessTimeline />
            </div>
          </div>

          {/* Plate footer strip */}
          <div className="flex items-center gap-x-3 gap-y-1 px-6 py-3 ss-mono text-[10px] uppercase flex-wrap"
               style={{ letterSpacing: '0.22em', borderTop: '1px dashed var(--ss-border-h)', color: 'var(--ss-t4)' }}>
            <span>Drawn:</span>
            <span style={{ color: 'var(--ss-t2)' }}>SunScan&nbsp;Field&nbsp;Ops</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Verified:</span>
            <span style={{ color: 'var(--ss-t2)' }}>MCS-2024 Annex&nbsp;C</span>
            <span className="ml-auto inline-flex items-center gap-1.5" style={{ color: 'var(--ss-blue)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ss-blue)' }} />
              FIELD-TESTED
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Dashboard Preview ────────────────────────────────────────────────────────
// ─── Lucide-style stat icons (matching the real product's StatCard icons) ───
const STAT_ICON: Record<string, ReactNode> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  home:  <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
  zap:   <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  trend: <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>,
  leaf:  <><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.5c1 1.5 1 5.7-2 8.7-4 4-7 4-7 4Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
}

function StatIcon({ name, color, size = 18 }: { name: keyof typeof STAT_ICON; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {STAT_ICON[name]}
    </svg>
  )
}

function DashStatCard({ label, value, unit, icon, accent }: { label: string; value: string; unit: string; icon: keyof typeof STAT_ICON; accent: string }) {
  return (
    <div className="relative" style={{
      background: 'var(--ss-ink)',
      border: '1px solid var(--ss-border)',
      borderRadius: 4,
      padding: '14px 14px 16px',
      overflow: 'hidden',
    }}>
      {/* Bottom accent rule */}
      <div className="absolute left-0 right-0 bottom-0" style={{ height: 2, background: accent, opacity: 0.85 }} />
      <div className="flex items-start justify-between mb-3">
        <div className="ss-mono text-[9px] uppercase" style={{ color: 'var(--ss-t4)', letterSpacing: '0.18em' }}>{label}</div>
        <StatIcon name={icon} color={accent} />
      </div>
      <div className="ss-mono font-bold" style={{ fontSize: 22, color: 'var(--ss-t1)', lineHeight: 1 }}>{value}</div>
      <div className="ss-mono text-[10px] mt-1.5" style={{ color: 'var(--ss-t4)', letterSpacing: '0.05em' }}>{unit}</div>
    </div>
  )
}

// ─── Mock report header (mirrors the real burgundy band on /report/[id]) ─────
function ReportHeaderMock() {
  return (
    <div className="relative overflow-hidden" style={{
      background: 'linear-gradient(135deg,#B04020 0%,#8B3219 55%,#5A1F0C 100%)',
      borderRadius: 6,
      padding: '22px 22px',
      boxShadow: 'inset 0 0 80px rgba(252,211,77,0.05)',
    }}>
      {/* Sun glow top-right */}
      <div className="absolute pointer-events-none" style={{
        top: -64, right: -64, width: 200, height: 200, borderRadius: '50%',
        background: 'radial-gradient(circle,rgba(252,211,77,0.30),transparent 60%)',
      }} />
      {/* Faint surveyor grid overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage:
          'linear-gradient(rgba(252,211,77,0.04) 1px,transparent 1px),' +
          'linear-gradient(90deg,rgba(252,211,77,0.04) 1px,transparent 1px)',
        backgroundSize: '32px 32px',
      }} />

      <div className="relative z-10 flex items-start justify-between flex-wrap gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <StatIcon name="sun" color="#FCD34D" size={16} />
            <span className="ss-heading font-bold text-sm tracking-[0.18em]" style={{ color: '#FCD34D' }}>SUNSCAN</span>
          </div>
          <h4 className="ss-heading font-bold mb-1.5" style={{ fontSize: 'clamp(18px,2.4vw,22px)', color: '#FAF6EC', letterSpacing: '-0.01em', lineHeight: 1.1 }}>
            14 Oak Street, Norwich, NR1 3EH
          </h4>
          <p className="ss-mono text-[10px] uppercase" style={{ color: 'rgba(250,246,236,0.6)', letterSpacing: '0.22em' }}>
            Quote SS-2026-0042 · 10 May 2026
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="inline-flex items-center gap-1.5 ss-mono text-[10px] uppercase px-2.5 py-1.5 rounded" style={{
            background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.4)', color: '#86EFAC', letterSpacing: '0.18em',
          }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981', boxShadow: '0 0 6px rgba(16,185,129,0.8)', animation: 'ss-pulse-dot 2s infinite' }} />
            Analysis Complete
          </div>
          <button type="button" className="inline-flex items-center gap-1.5 ss-heading font-bold text-xs px-3.5 py-2 rounded transition-transform hover:-translate-y-0.5" style={{
            background: '#FCD34D', color: '#5A1F0C',
          }}>
            <StatIcon name="download" color="#5A1F0C" size={13} />
            Download PDF
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Monthly Generation chart (mirrors the real chart styling) ──────────────
function MonthlyGenChartMock() {
  return (
    <div className="relative" style={{ background: 'var(--ss-ink)', border: '1px solid var(--ss-border)', borderRadius: 4 }}>
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <div>
          <h5 className="ss-heading font-bold text-[13px]" style={{ color: 'var(--ss-t1)' }}>Monthly Generation</h5>
          <p className="ss-mono text-[10px] mt-0.5" style={{ color: 'var(--ss-t4)', letterSpacing: '0.08em' }}>Total · 8 340 kWh / yr</p>
        </div>
        <span className="ss-mono text-[10px] uppercase" style={{ color: 'var(--ss-t4)', letterSpacing: '0.18em' }}>kWh</span>
      </div>
      <div className="px-4 pb-4">
        <div className="relative" style={{ height: 116 }}>
          {/* Gridlines */}
          {[0.25, 0.5, 0.75].map(p => (
            <div key={p} className="absolute" style={{ left: 0, right: 0, top: `${100 - p * 100}%`, height: 1, background: 'var(--ss-border)' }} />
          ))}
          <div className="relative flex items-end gap-1.5 h-full">
            {MONTHS.map(({ h }, i) => {
              const peak = i === 6
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div className="w-full rounded-t-sm" style={{
                    height: `${h}%`,
                    background: peak
                      ? 'linear-gradient(180deg,var(--ss-amber-l),var(--ss-amber))'
                      : 'linear-gradient(180deg,var(--ss-blue-l),var(--ss-blue))',
                    boxShadow: peak ? '0 0 12px rgba(245,158,11,0.40)' : 'none',
                    transformOrigin: 'bottom',
                    animation: 'ss-bar-grow 0.9s ease-out both',
                    animationDelay: `${i * 50}ms`,
                  }} />
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          {MONTHS.map(({ m }, i) => (
            <div key={i} className="flex-1 text-center ss-mono text-[9px] font-bold" style={{ color: i === 6 ? 'var(--ss-amber)' : 'var(--ss-t4)', letterSpacing: '0.1em' }}>{m}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Cumulative Net Savings chart (real product has CumulativeSavingsChart) ─
function CumulativeSavingsChartMock() {
  const w = 340, h = 130
  const padL = 34, padR = 14, padT = 16, padB = 26
  const yMin = -14, yMax = 46
  const yToPx = (y: number) => padT + ((yMax - y) / (yMax - yMin)) * (h - padT - padB)
  const xToPx = (yr: number) => padL + (yr / 25) * (w - padL - padR)
  // Cumulative (£k) - system cost ~£11.6k, annual savings inflate at 4%
  const cost = 11.6
  const points: Array<[number, number]> = []
  for (let yr = 0; yr <= 25; yr++) {
    let sum = 0
    for (let k = 0; k < yr; k++) sum += 1.5 * Math.pow(1.04, k)
    points.push([yr, sum - cost])
  }
  const lineD = points.map(([yr, v], i) => `${i === 0 ? 'M' : 'L'} ${xToPx(yr).toFixed(1)} ${yToPx(v).toFixed(1)}`).join(' ')
  const areaD = `${lineD} L ${xToPx(25)} ${yToPx(yMin)} L ${xToPx(0)} ${yToPx(yMin)} Z`
  const breakeven = 8.2
  return (
    <div className="relative" style={{ background: 'var(--ss-ink)', border: '1px solid var(--ss-border)', borderRadius: 4 }}>
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <div>
          <h5 className="ss-heading font-bold text-[13px]" style={{ color: 'var(--ss-t1)' }}>Cumulative Net Savings</h5>
          <p className="ss-mono text-[10px] mt-0.5" style={{ color: 'var(--ss-t4)', letterSpacing: '0.08em' }}>25-yr horizon · £42 800 total</p>
        </div>
        <span className="ss-mono text-[10px] uppercase" style={{ color: 'var(--ss-t4)', letterSpacing: '0.18em' }}>£ thousands</span>
      </div>
      <div className="px-4 pb-4">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <linearGradient id="sv-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor="var(--ss-blue)" stopOpacity="0.42" />
              <stop offset="100%" stopColor="var(--ss-blue)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Y gridlines */}
          {[40, 20, 0, -10].map(y => (
            <g key={y}>
              <line x1={padL} y1={yToPx(y)} x2={w - padR} y2={yToPx(y)}
                stroke={y === 0 ? 'var(--ss-t3)' : 'var(--ss-border)'}
                strokeWidth={y === 0 ? 0.7 : 0.5}
                strokeDasharray={y === 0 ? '0' : '2 2'} />
              <text x={padL - 5} y={yToPx(y) + 3} textAnchor="end" fontSize="7.5" fontFamily="ui-monospace" fill="var(--ss-t4)">
                {y < 0 ? `−£${Math.abs(y)}k` : `£${y}k`}
              </text>
            </g>
          ))}
          {/* Area */}
          <path d={areaD} fill="url(#sv-fill)" />
          {/* Line */}
          <path d={lineD} fill="none" stroke="var(--ss-blue)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
          {/* Endpoint marker */}
          <circle cx={xToPx(25)} cy={yToPx(points[25][1])} r="3" fill="var(--ss-blue)" />
          <text x={xToPx(25) - 4} y={yToPx(points[25][1]) - 6} textAnchor="end" fontSize="8" fontFamily="ui-monospace" fontWeight="700" fill="var(--ss-blue)">£42.8k</text>
          {/* Payback marker */}
          <line x1={xToPx(breakeven)} y1={padT} x2={xToPx(breakeven)} y2={h - padB}
            stroke="var(--ss-amber)" strokeWidth="0.9" strokeDasharray="3 2" />
          <circle cx={xToPx(breakeven)} cy={yToPx(0)} r="3.5" fill="var(--ss-amber)" />
          <g transform={`translate(${xToPx(breakeven) + 7} ${padT + 12})`}>
            <rect x="0" y="-9" width="92" height="16" rx="2" fill="var(--ss-amber)" />
            <text x="6" y="2" fontSize="8" fontFamily="ui-monospace" fontWeight="700" fill="#5A1F0C" letterSpacing="0.1em">PAYBACK · 8.2 yr</text>
          </g>
          {/* X axis labels */}
          {[0, 5, 10, 15, 20, 25].map(yr => (
            <text key={yr} x={xToPx(yr)} y={h - 8} textAnchor="middle" fontSize="7.5" fontFamily="ui-monospace" fill="var(--ss-t4)">
              {yr === 0 ? 'Yr 0' : yr === 25 ? 'Yr 25' : yr}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}

// ─── Title-block ornament: "live preview" specimen badge ────────────────────
function LivePreviewBadge() {
  return (
    <div className="hidden md:block flex-shrink-0" style={{ width: 220 }}>
      <div className="ss-mono text-[9px] uppercase mb-2" style={{ color: 'var(--ss-t4)', letterSpacing: '0.22em' }}>
        ↳ Specimen reference
      </div>
      <div style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border-h)', borderRadius: 3, padding: '12px 14px' }}>
        <div className="flex items-center gap-2 mb-3" style={{ borderBottom: '1px dashed var(--ss-border-h)', paddingBottom: 8 }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#10B981', boxShadow: '0 0 6px rgba(16,185,129,0.7)', animation: 'ss-pulse-dot 2s infinite' }} />
          <span className="ss-mono text-[9px] uppercase font-bold" style={{ color: 'var(--ss-green)', letterSpacing: '0.22em' }}>Live preview</span>
        </div>
        <dl className="ss-mono text-[10px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5" style={{ letterSpacing: '0.05em' }}>
          <dt style={{ color: 'var(--ss-t4)' }}>REPORT</dt>
          <dd className="text-right" style={{ color: 'var(--ss-t1)', fontWeight: 700 }}>SS-2026-0042</dd>
          <dt style={{ color: 'var(--ss-t4)' }}>POSTCODE</dt>
          <dd className="text-right" style={{ color: 'var(--ss-t1)', fontWeight: 700 }}>NR1 3EH</dd>
          <dt style={{ color: 'var(--ss-t4)' }}>BUILT</dt>
          <dd className="text-right" style={{ color: 'var(--ss-t1)', fontWeight: 700 }}>12.4 s ago</dd>
        </dl>
        <div className="mt-3 relative" style={{ height: 4, background: 'var(--ss-border)', borderRadius: 2, overflow: 'hidden' }}>
          <div className="absolute left-0 top-0 bottom-0" style={{ width: '100%', background: 'linear-gradient(90deg,var(--ss-blue),var(--ss-amber))' }} />
        </div>
      </div>
    </div>
  )
}

function DashPreview() {
  const stats: { label: string; value: string; unit: string; icon: keyof typeof STAT_ICON; accent: string }[] = [
    { label: 'System Size',       value: '6.08',    unit: 'kWp',          icon: 'sun',   accent: 'var(--ss-amber)'    },
    { label: 'Solar Panels',      value: '16',      unit: '× 380 Wp',     icon: 'home',  accent: 'var(--ss-t1)'       },
    { label: 'Annual Generation', value: '8 340',   unit: 'kWh / yr',     icon: 'zap',   accent: 'var(--ss-blue)'     },
    { label: 'Annual Savings',    value: '£1 427',  unit: 'at 4 % drift', icon: 'trend', accent: 'var(--ss-green)'    },
    { label: 'Payback Period',    value: '8.2',     unit: 'years',        icon: 'trend', accent: 'var(--ss-violet-l)' },
    { label: 'CO₂ Avoided',       value: '1.78',    unit: 't / yr',       icon: 'leaf',  accent: 'var(--ss-green)'    },
  ]

  return (
    <section id="dashboard" className="relative py-16 md:py-28 ss-paper" style={{ background: 'var(--ss-ink)' }}>
      {/* Faint engineering grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage:
          'linear-gradient(rgba(176,64,32,0.04) 1px,transparent 1px),' +
          'linear-gradient(90deg,rgba(176,64,32,0.04) 1px,transparent 1px)',
        backgroundSize: '48px 48px',
      }} />

      <div className="relative max-w-[1100px] mx-auto px-4 md:px-6">

        {/* ── Title block ─ platform metadata strip + heading + specimen tag ── */}
        <div className="mb-8 md:mb-12">
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap ss-mono text-[10px] uppercase pb-3 mb-8"
               style={{ letterSpacing: '0.22em', color: 'var(--ss-t3)', borderBottom: '1px solid var(--ss-border)' }}>
            <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ss-blue)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ss-blue)' }} />
              Platform
            </span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Doc.&nbsp;Plat-2026.C</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Rev.&nbsp;04</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Live report preview</span>
            <span className="ml-auto hidden md:inline" style={{ color: 'var(--ss-t4)' }}>app.sunscan.io</span>
          </div>

          <div className="grid md:grid-cols-[1fr_auto] gap-8 items-end">
            <div>
              <h2 className="ss-heading font-extrabold tracking-tight mb-4"
                  style={{ fontSize: 'clamp(26px,5vw,56px)', color: 'var(--ss-t1)', lineHeight: 1.04 }}>
                Every metric.<br />One screen.
              </h2>
              <p className="text-[15px] leading-relaxed max-w-[480px]" style={{ color: 'var(--ss-t3)' }}>
                Engineering-grade analysis delivered through a dashboard built for surveyors,
                not consumers. Every figure below comes from a real specimen report.
              </p>
            </div>
            <LivePreviewBadge />
          </div>
        </div>

        {/* ── Drawing plate ─ contains the live-product mock ─────────────── */}
        <div className="relative" style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border-h)', borderRadius: 4 }}>
          {/* Heavy corner brackets */}
          {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
            <span key={c} className="absolute pointer-events-none" style={{
              width: 18, height: 18,
              borderTop:    c.includes('t') ? '2px solid var(--ss-blue)' : 'none',
              borderBottom: c.includes('b') ? '2px solid var(--ss-blue)' : 'none',
              borderLeft:   c.includes('l') ? '2px solid var(--ss-blue)' : 'none',
              borderRight:  c.includes('r') ? '2px solid var(--ss-blue)' : 'none',
              top:    c.includes('t') ? -3 : 'auto',
              bottom: c.includes('b') ? -3 : 'auto',
              left:   c.includes('l') ? -3 : 'auto',
              right:  c.includes('r') ? -3 : 'auto',
            }} />
          ))}

          {/* Plate header strip */}
          <div className="flex items-center gap-3 px-6 py-3 flex-wrap"
               style={{ borderBottom: '1px dashed var(--ss-border-h)', color: 'var(--ss-t3)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="2" y1="9" x2="22" y2="9" />
            </svg>
            <span className="ss-mono text-[10px] uppercase" style={{ letterSpacing: '0.22em' }}>
              Plate&nbsp;C · Live report preview
            </span>
            <span className="ml-auto ss-mono text-[10px]" style={{ letterSpacing: '0.06em', color: 'var(--ss-t4)' }}>
              app.sunscan.io/r/SS-2026-0042
            </span>
          </div>

          {/* The actual mock - mirrors the real /report/[id] surface */}
          <div className="px-3 md:px-7 pt-5 md:pt-7 pb-5 md:pb-7 space-y-4">
            <ReportHeaderMock />

            {/* Recommended System */}
            <div>
              <div className="flex items-baseline justify-between mb-3 mt-2">
                <h4 className="ss-heading font-bold text-[15px]" style={{ color: 'var(--ss-t1)' }}>Recommended System</h4>
                <span className="ss-mono text-[10px] uppercase" style={{ color: 'var(--ss-t4)', letterSpacing: '0.18em' }}>
                  Auto-fitted to roof
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {stats.map(s => <DashStatCard key={s.label} {...s} />)}
              </div>
            </div>

            {/* Charts row */}
            <div className="grid md:grid-cols-2 gap-3 mt-4">
              <MonthlyGenChartMock />
              <CumulativeSavingsChartMock />
            </div>
          </div>

          {/* Plate footer strip */}
          <div className="flex items-center gap-x-3 gap-y-1 px-6 py-3 ss-mono text-[10px] uppercase flex-wrap"
               style={{ letterSpacing: '0.22em', borderTop: '1px dashed var(--ss-border-h)', color: 'var(--ss-t4)' }}>
            <span>Drawn:</span>
            <span style={{ color: 'var(--ss-t2)' }}>SunScan&nbsp;Report&nbsp;Engine</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Live data</span>
            <span className="ml-auto inline-flex items-center gap-1.5" style={{ color: 'var(--ss-green)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981', boxShadow: '0 0 6px rgba(16,185,129,0.7)', animation: 'ss-pulse-dot 2s infinite' }} />
              ANALYSIS COMPLETE
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── CTA ──────────────────────────────────────────────────────────────────────
function CTA() {
  return (
    <section className="py-16 md:py-28 text-center relative overflow-hidden" style={{ background: 'var(--ss-ink)' }}>
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 50% 50%,rgba(252,211,77,0.20) 0%,transparent 65%)' }} />
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
            Run Free AI Scan
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
              <SunscanMark size={28} className="flex-shrink-0" />
              <span className="ss-heading font-bold tracking-wide" style={{ color: 'var(--ss-t1)' }}>
                SUN<span style={{ color: 'var(--ss-blue)' }}>SCAN</span>
              </span>
            </div>
            <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--ss-t4)', maxWidth: 260 }}>
              Engineering-grade solar surveys for UK installers, manufacturers, and energy consultants. MCS-aligned, postcode-driven, export-ready.
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
            © 2026 SunScan Ltd. MCS-aligned solar proposals built from Ordnance Survey roof data and your real electricity bill.
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
