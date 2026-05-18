import { describe, it, expect } from 'vitest'
import {
  sunshineP50,
  orientationFactor,
  rankSegments,
} from '@/lib/solar/sunlightRanking'
import type { LocalRoofSegment } from '@/types/solar'

function seg(p: Partial<LocalRoofSegment> & { segmentIndex: number }): LocalRoofSegment {
  return {
    azimuthDeg: 180,
    pitchDeg: 35,
    heightAtCenterM: 6,
    areaM2: 30,
    sunshineQuantiles: [],
    center: { x: 0, z: 0 },
    ridgeLenM: 8,
    groundDepthM: 5,
    ...p,
  }
}

describe('sunshineP50', () => {
  it('returns 0 for an empty array', () => {
    expect(sunshineP50([])).toBe(0)
  })

  it('picks the floor(n/2) index (matching the existing viewer convention)', () => {
    // odd length: middle element
    expect(sunshineP50([100, 200, 300])).toBe(200)
    // even length: floor(4/2) = index 2, NOT an average
    expect(sunshineP50([100, 200, 300, 400])).toBe(300)
  })
})

describe('orientationFactor', () => {
  it('is highest for a due-south roof and within [0.4, 1.0]', () => {
    const south = orientationFactor(180, 35)
    const north = orientationFactor(0, 35)
    expect(south).toBeGreaterThan(north)
    expect(south).toBeLessThanOrEqual(1.0)
    expect(north).toBeGreaterThanOrEqual(0.4)
  })

  it('decreases monotonically as the roof turns away from south (fixed pitch)', () => {
    const s = orientationFactor(180, 35) // due S
    const se = orientationFactor(135, 35) // SE
    const e = orientationFactor(90, 35) // E
    const n = orientationFactor(0, 35) // N
    expect(s).toBeGreaterThan(se)
    expect(se).toBeGreaterThan(e)
    expect(e).toBeGreaterThan(n)
  })
})

describe('rankSegments', () => {
  it('ranks the sunnier segment first when sunshine data is present', () => {
    const segs = [
      seg({ segmentIndex: 0, sunshineQuantiles: [100, 100, 100] }), // dim
      seg({ segmentIndex: 1, sunshineQuantiles: [900, 900, 900] }), // sunny
    ]
    const ranked = rankSegments(segs, 1.722, 1.134)
    expect(ranked[0].segmentIndex).toBe(1)
    expect(ranked[1].segmentIndex).toBe(0)
  })

  it('falls back to orientation when no segment has sunshine data', () => {
    const segs = [
      seg({ segmentIndex: 0, azimuthDeg: 0, sunshineQuantiles: [] }), // north
      seg({ segmentIndex: 1, azimuthDeg: 180, sunshineQuantiles: [] }), // south
    ]
    const ranked = rankSegments(segs, 1.722, 1.134)
    expect(ranked[0].segmentIndex).toBe(1) // south first
  })

  it('breaks ties by larger panel capacity', () => {
    const segs = [
      seg({ segmentIndex: 0, sunshineQuantiles: [500], ridgeLenM: 6, groundDepthM: 4 }),
      seg({ segmentIndex: 1, sunshineQuantiles: [500], ridgeLenM: 14, groundDepthM: 9 }),
    ]
    const ranked = rankSegments(segs, 1.722, 1.134)
    expect(ranked[0].segmentIndex).toBe(1) // bigger roof first
    expect(ranked[0].capacityPanels).toBeGreaterThan(ranked[1].capacityPanels)
  })

  it('handles equal sunshine across all segments without producing NaN', () => {
    const segs = [
      seg({ segmentIndex: 0, azimuthDeg: 0, sunshineQuantiles: [500] }),
      seg({ segmentIndex: 1, azimuthDeg: 180, sunshineQuantiles: [500] }),
    ]
    const ranked = rankSegments(segs, 1.722, 1.134)
    for (const r of ranked) expect(Number.isFinite(r.rankScore)).toBe(true)
    expect(ranked[0].segmentIndex).toBe(1) // tie on sun → orientation wins
  })
})
