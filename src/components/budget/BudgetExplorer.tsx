'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Slider } from '@/components/ui/slider'
import { activeStep } from '@/lib/recommend/buildBudgetLadder'
import type { BudgetLadder, BudgetStep } from '@/lib/recommend/ladderTypes'
import { gbp, kwh, pct, years, lifetimeSavings } from './format'

const BUDGET_STEP_GBP = 50

interface BudgetExplorerProps {
  ladder: BudgetLadder
  brandPrimary: string
  /** Overrides `ladder.initialGbp` (e.g. a persisted choice on the report page). */
  initialBudgetGbp?: number
  /** Fires whenever the active step changes — host wires this to lead/config state. */
  onStepChange?: (step: BudgetStep) => void
  /** Optional slot under the system summary (e.g. a Save button on the report page). */
  footer?: ReactNode
}

/** Smoothly animates a number towards `target` so the hero savings figure counts up. */
function useCountUp(target: number, durationMs = 500): number {
  const [display, setDisplay] = useState(target)
  // Latest animated value — written only inside the effect (never during render),
  // so a mid-animation target change continues smoothly from where it is.
  const currentRef = useRef(target)
  useEffect(() => {
    const from = currentRef.current
    if (from === target) return
    let raf = 0
    let start = 0
    const tick = (t: number) => {
      if (!start) start = t
      const p = Math.min(1, (t - start) / durationMs)
      const eased = 1 - (1 - p) ** 3
      const val = Math.round(from + (target - from) * eased)
      currentRef.current = val
      setDisplay(val)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return display
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="ss-mono text-[10px] uppercase"
        style={{ letterSpacing: '0.18em', color: 'var(--ss-t4)' }}
      >
        {label}
      </span>
      <span className="text-base font-semibold" style={{ color: accent ?? 'var(--ss-t1)' }}>
        {value}
      </span>
    </div>
  )
}

export function BudgetExplorer({
  ladder,
  brandPrimary,
  initialBudgetGbp,
  onStepChange,
  footer,
}: BudgetExplorerProps) {
  const { steps, tierStops, minGbp, maxGbp } = ladder
  const [budgetGbp, setBudgetGbp] = useState(() =>
    clamp(initialBudgetGbp ?? ladder.initialGbp, minGbp, maxGbp),
  )

  const active = activeStep(steps, budgetGbp) ?? steps[0]

  // Notify the host when the recommended system changes (keyed on identity).
  useEffect(() => {
    if (active) onStepChange?.(active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  const hero = useCountUp(active ? Math.round(lifetimeSavings(active.results.twentyFiveYearSavings)) : 0)
  const hasRange = maxGbp > minGbp

  if (!active) return null

  const currentTier = tierStops.find((t) => t.stepId === active.id)
  const batteryText = active.hasBattery ? `${active.batteryKwh} kWh battery` : 'No battery'

  const accentSoft = `color-mix(in srgb, ${brandPrimary} 8%, var(--ss-s1))`
  const accentBorder = `color-mix(in srgb, ${brandPrimary} 35%, var(--ss-border))`

  return (
    <section
      className="rounded-2xl p-5 sm:p-6"
      style={{ background: 'var(--ss-s1)', border: `1.5px solid ${accentBorder}` }}
    >
      {/* Hero: lifetime savings */}
      <div className="space-y-1">
        <span
          className="ss-mono text-[10px] uppercase"
          style={{ letterSpacing: '0.2em', color: brandPrimary }}
        >
          Estimated lifetime savings · 25 years
        </span>
        <p
          className="ss-heading text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums"
          style={{ color: 'var(--ss-t1)' }}
          aria-live="polite"
        >
          {gbp(hero)}
        </p>
        <p className="text-sm" style={{ color: 'var(--ss-t3)' }}>
          with a {gbp(active.priceGbp)} system{currentTier ? ` · around the ${currentTier.tier} package` : ''}
        </p>
      </div>

      {/* Secondary metrics */}
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Saving / year" value={gbp(active.results.annualSavingsPounds)} accent={brandPrimary} />
        <Metric label="Payback" value={years(active.results.paybackYears)} />
        <Metric label="Self-sufficiency" value={pct(active.results.selfConsumptionRate)} />
        <Metric label="Generation / yr" value={kwh(active.results.annualGenerationKwh)} />
      </div>

      {/* Budget slider with tier-stop markers */}
      {hasRange ? (
        <div className="mt-6 space-y-3">
          <div className="flex items-baseline justify-between">
            <span
              className="ss-mono text-[10px] uppercase"
              style={{ letterSpacing: '0.18em', color: 'var(--ss-t4)' }}
            >
              Your budget
            </span>
            <span className="text-lg font-semibold tabular-nums" style={{ color: 'var(--ss-t1)' }}>
              {gbp(budgetGbp)}
            </span>
          </div>

          <div className="relative pb-7">
            <Slider
              value={[budgetGbp]}
              min={minGbp}
              max={maxGbp}
              step={BUDGET_STEP_GBP}
              onValueChange={(v) => setBudgetGbp(Array.isArray(v) ? v[0] : (v as number))}
              aria-label="Budget"
              style={{ ['--primary' as string]: brandPrimary } as CSSProperties}
            />
            {/* Tier markers, positioned by price along the track. */}
            {tierStops.map((stop) => {
              const left = clamp(((stop.priceGbp - minGbp) / (maxGbp - minGbp)) * 100, 0, 100)
              const isCurrent = stop.stepId === active.id
              return (
                <div
                  key={stop.tier}
                  className="pointer-events-none absolute top-3 -translate-x-1/2 text-center"
                  style={{ left: `${left}%` }}
                >
                  <span
                    className="mx-auto block h-2 w-0.5"
                    style={{ background: isCurrent ? brandPrimary : 'var(--ss-border-h)' }}
                  />
                  <span
                    className="ss-mono mt-1 block text-[9px] uppercase"
                    style={{
                      letterSpacing: '0.14em',
                      color: isCurrent ? brandPrimary : 'var(--ss-t4)',
                      fontWeight: isCurrent ? 600 : 400,
                    }}
                  >
                    {stop.tier}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* "What you're getting" morph panel */}
      <div
        className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl p-4 sm:grid-cols-4"
        style={{ background: accentSoft, border: '1px solid var(--ss-border)' }}
      >
        <Metric label="Panels" value={`${active.panelCount}`} />
        <Metric label="System size" value={`${active.systemKwp} kWp`} />
        <Metric label="Storage" value={batteryText} accent={active.hasBattery ? brandPrimary : undefined} />
        <Metric label="System price" value={gbp(active.priceGbp)} />
      </div>

      {footer ? <div className="mt-5">{footer}</div> : null}
    </section>
  )
}
