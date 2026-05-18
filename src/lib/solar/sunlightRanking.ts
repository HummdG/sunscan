import type { LocalRoofSegment } from '@/types/solar'
import { gridCapacity } from '@/lib/solar/layoutConstants'

/** Sunlight weight in the combined rank score. */
export const W_SUN = 0.7
/** Orientation weight in the combined rank score. */
export const W_ORI = 0.3

export interface SegmentScore {
  segmentIndex: number
  sunshineP50: number
  /** MCS orientation, |azimuth - 180|, 0 = due south. */
  mcsOrientationDeg: number
  /** [0.4, 1.0]; 1.0 ≈ due south at an ideal pitch. */
  orientationFactor: number
  /** Max landscape panels this segment can hold. */
  capacityPanels: number
  /** Combined desirability — higher fills first. */
  rankScore: number
}

/**
 * Median sunshine quantile. Matches the existing viewer convention
 * (SolarRoofViewer.tsx): the floor(n/2) element, not an average. Empty → 0.
 */
export function sunshineP50(quantiles: number[]): number {
  if (!quantiles?.length) return 0
  return quantiles[Math.floor(quantiles.length / 2)]
}

/**
 * Desirability of a roof face from its compass azimuth and pitch.
 * Orientation dominates (0.4 north → 1.0 south); pitch is a gentle multiplier
 * peaking near 35°. Result clamped to [0.4, 1.0].
 */
export function orientationFactor(azimuthDeg: number, pitchDeg: number): number {
  const mcsOri = Math.min(180, Math.abs(azimuthDeg - 180)) // 0 = S, 180 = N
  const oriComponent = 0.7 + 0.3 * Math.cos((mcsOri * Math.PI) / 180) // [0.4, 1.0]
  const pitchComponent = 1 - 0.3 * Math.min(1, Math.abs(pitchDeg - 35) / 35) // [0.7, 1.0]
  const f = oriComponent * pitchComponent
  return Math.max(0.4, Math.min(1.0, f))
}

/**
 * Rank roof segments best-first by sunshine (min-max normalised across the
 * set) plus orientation. When no segment carries sunshine data, ranking falls
 * back to orientation only. Ties break toward the larger-capacity face.
 */
export function rankSegments(
  segments: LocalRoofSegment[],
  panelWidthM: number,
  panelHeightM: number,
): SegmentScore[] {
  const sun = segments.map(s => sunshineP50(s.sunshineQuantiles))
  const anyData = sun.some(v => v > 0)
  const min = Math.min(...sun)
  const max = Math.max(...sun)
  const span = max - min

  const scores: SegmentScore[] = segments.map((s, i) => {
    const normSun = !anyData ? 0 : span > 0 ? (sun[i] - min) / span : 1
    const ori = orientationFactor(s.azimuthDeg, s.pitchDeg)
    const { cols, rows } = gridCapacity(
      s.ridgeLenM,
      s.groundDepthM,
      s.pitchDeg,
      panelWidthM,
      panelHeightM,
    )
    return {
      segmentIndex: s.segmentIndex,
      sunshineP50: sun[i],
      mcsOrientationDeg: Math.min(180, Math.abs(s.azimuthDeg - 180)),
      orientationFactor: ori,
      capacityPanels: cols * rows,
      rankScore: W_SUN * normSun + W_ORI * ori,
    }
  })

  return scores.sort(
    (a, b) =>
      b.rankScore - a.rankScore ||
      b.capacityPanels - a.capacityPanels ||
      a.segmentIndex - b.segmentIndex,
  )
}
