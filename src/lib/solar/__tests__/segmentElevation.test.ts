import { describe, it, expect } from 'vitest'
import {
  azimuthToElevation,
  computeElevationSpans,
} from '@/lib/solar/segmentElevation'

describe('azimuthToElevation', () => {
  it('maps cardinal azimuths', () => {
    expect(azimuthToElevation(0)).toBe('N')
    expect(azimuthToElevation(90)).toBe('E')
    expect(azimuthToElevation(180)).toBe('S')
    expect(azimuthToElevation(270)).toBe('W')
    expect(azimuthToElevation(360)).toBe('N')
  })

  it('rounds to the nearest cardinal at the diagonals', () => {
    expect(azimuthToElevation(45)).toBe('E')
    expect(azimuthToElevation(135)).toBe('S')
    expect(azimuthToElevation(225)).toBe('W')
    expect(azimuthToElevation(315)).toBe('N')
  })
})

describe('computeElevationSpans', () => {
  it('sums block widths within the same elevation bucket', () => {
    const spans = computeElevationSpans([
      { segmentIndex: 0, azimuthDeg: 180, blockWidthM: 5 },
      { segmentIndex: 1, azimuthDeg: 175, blockWidthM: 3 },
    ])
    expect(spans).toHaveLength(1)
    expect(spans[0].elevation).toBe('S')
    expect(spans[0].spanM).toBeCloseTo(8)
    expect(spans[0].segmentIndexes).toEqual([0, 1])
  })

  it('splits segments on different azimuths into separate elevations', () => {
    const spans = computeElevationSpans([
      { segmentIndex: 0, azimuthDeg: 180, blockWidthM: 4 },
      { segmentIndex: 1, azimuthDeg: 90, blockWidthM: 6 },
    ])
    const byEl = Object.fromEntries(spans.map(s => [s.elevation, s.spanM]))
    expect(byEl['S']).toBeCloseTo(4)
    expect(byEl['E']).toBeCloseTo(6)
  })

  it('ignores zero-width blocks', () => {
    const spans = computeElevationSpans([
      { segmentIndex: 0, azimuthDeg: 180, blockWidthM: 0 },
    ])
    expect(spans).toHaveLength(0)
  })
})
