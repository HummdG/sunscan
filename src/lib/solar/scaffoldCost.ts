import type { ElevationSpan, Elevation } from '@/lib/solar/segmentElevation'

export interface ScaffoldRates {
  /** £ per linear metre of scaffold along an elevation. */
  perLinearMetrePounds: number
  /** Fixed £ to set scaffold up on one elevation (erect/strike/transport). */
  perElevationSetupPounds: number
}

export const DEFAULT_SCAFFOLD_RATES: ScaffoldRates = {
  perLinearMetrePounds: 25,
  perElevationSetupPounds: 150,
}

export interface ScaffoldCostResult {
  totalPounds: number
  activeElevationCount: number
  perElevation: { elevation: Elevation; spanM: number; costPounds: number }[]
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** Scaffold rates from env (SCAFFOLD_PER_M_POUNDS / SCAFFOLD_SETUP_POUNDS),
 *  falling back to DEFAULT_SCAFFOLD_RATES for unset or non-finite values. */
export function getScaffoldRates(): ScaffoldRates {
  return {
    perLinearMetrePounds: envNumber(
      'SCAFFOLD_PER_M_POUNDS',
      DEFAULT_SCAFFOLD_RATES.perLinearMetrePounds,
    ),
    perElevationSetupPounds: envNumber(
      'SCAFFOLD_SETUP_POUNDS',
      DEFAULT_SCAFFOLD_RATES.perElevationSetupPounds,
    ),
  }
}

/**
 * Estimated scaffold cost: each elevation with panels incurs a fixed setup fee
 * plus a per-linear-metre charge over its summed block span. The fixed
 * per-elevation fee is what makes concentrating panels onto fewer elevations
 * cheaper than spreading them.
 */
export function computeScaffoldCost(
  spans: ElevationSpan[],
  rates: ScaffoldRates = getScaffoldRates(),
): ScaffoldCostResult {
  const active = spans.filter(s => s.spanM > 0)
  const perElevation = active.map(s => ({
    elevation: s.elevation,
    spanM: s.spanM,
    costPounds:
      rates.perElevationSetupPounds + s.spanM * rates.perLinearMetrePounds,
  }))
  return {
    totalPounds: perElevation.reduce((sum, e) => sum + e.costPounds, 0),
    activeElevationCount: perElevation.length,
    perElevation,
  }
}
