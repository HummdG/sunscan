import Link from 'next/link'
import { SurveyForm } from '@/components/SurveyForm'
import { SunscanMark } from '@/components/SunscanMark'

export const metadata = {
  title: 'Solar Survey · SunScan',
  description: 'Get your free solar panel estimate in minutes.',
}

const NAV_HEIGHT = 65 // approx px — used to size the plate to exactly fill the viewport below

export default function SurveyPage() {
  return (
    <main
      className="ss-paper relative flex flex-col"
      style={{ background: 'var(--ss-ink)', minHeight: '100vh' }}
    >
      {/* Engineering grid - soft warm rule */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(176,64,32,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(176,64,32,0.05) 1px,transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />
      {/* Atmospheric sun glows */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at 18% 12%,rgba(252,211,77,0.18) 0%,transparent 45%),' +
            'radial-gradient(ellipse at 82% 88%,rgba(217,119,6,0.14) 0%,transparent 50%),' +
            'radial-gradient(ellipse at 95% 5%,rgba(176,64,32,0.10) 0%,transparent 45%)',
        }}
      />

      {/* ── Sticky nav (mirrors homepage) ──────────────────────────────── */}
      <header
        className="sticky top-0 z-50 border-b shrink-0"
        style={{
          background: 'rgba(250,246,236,0.85)',
          backdropFilter: 'blur(20px) saturate(180%)',
          borderColor: 'var(--ss-border)',
        }}
      >
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <SunscanMark />
            <span
              className="ss-heading font-bold text-lg tracking-wide"
              style={{ color: 'var(--ss-t1)' }}
            >
              SUN<span style={{ color: 'var(--ss-blue)' }}>SCAN</span>
            </span>
          </Link>

          <div
            className="hidden md:flex items-center gap-2 ss-mono text-[10px] uppercase"
            style={{ letterSpacing: '0.22em', color: 'var(--ss-t3)' }}
          >
            <span
              className="inline-flex items-center gap-1.5"
              style={{ color: 'var(--ss-blue)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--ss-blue)' }}
              />
              Survey
            </span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Doc.&nbsp;SUR-2026.A</span>
            <span style={{ color: 'var(--ss-t4)' }}>·</span>
            <span>Rev.&nbsp;01</span>
          </div>

          <Link
            href="/"
            className="ss-mono text-[11px] uppercase tracking-widest no-underline px-3 py-1.5 transition-colors"
            style={{
              color: 'var(--ss-t2)',
              border: '1px solid var(--ss-border-h)',
              borderRadius: 2,
              letterSpacing: '0.2em',
            }}
          >
            ← Home
          </Link>
        </div>
      </header>

      {/* ── Drawing plate filling viewport ─────────────────────────────── */}
      <section
        className="relative z-10 flex-1 flex flex-col max-w-[1400px] w-full mx-auto px-4 md:px-6 py-6 md:py-8"
        style={{ minHeight: `calc(100vh - ${NAV_HEIGHT}px)` }}
      >
        <div
          className="relative flex-1 flex flex-col"
          style={{
            background: 'var(--ss-s1)',
            border: '1px solid var(--ss-border-h)',
            borderRadius: 4,
          }}
        >
          {/* Heavy corner brackets */}
          {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
            <span
              key={c}
              className="absolute pointer-events-none"
              style={{
                width: 18,
                height: 18,
                borderTop: c.includes('t') ? '2px solid var(--ss-blue)' : 'none',
                borderBottom: c.includes('b') ? '2px solid var(--ss-blue)' : 'none',
                borderLeft: c.includes('l') ? '2px solid var(--ss-blue)' : 'none',
                borderRight: c.includes('r') ? '2px solid var(--ss-blue)' : 'none',
                top: c.includes('t') ? -3 : 'auto',
                bottom: c.includes('b') ? -3 : 'auto',
                left: c.includes('l') ? -3 : 'auto',
                right: c.includes('r') ? -3 : 'auto',
              }}
            />
          ))}

          {/* The form fills the plate */}
          <div className="flex-1 flex flex-col">
            <SurveyForm />
          </div>
        </div>
      </section>
    </main>
  )
}
