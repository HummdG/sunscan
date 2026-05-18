import { describe, it, expect } from 'vitest'
import { parseAndValidateSpec, buildContextBlock } from '@/lib/ai/buildingSpecAgent'
import { FALLBACK_SPEC, BuildingSpecSchema } from '@/lib/3d/buildingSpec'

describe('parseAndValidateSpec', () => {
  it('parses a valid spec', () => {
    const result = parseAndValidateSpec(FALLBACK_SPEC)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.spec.confidence).toBe('low')
  })

  it('reports schema errors on invalid input', () => {
    const bad = { ...FALLBACK_SPEC, eaveHeightM: 'tall' }
    const result = parseAndValidateSpec(bad as unknown)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('buildContextBlock', () => {
  it('formats footprint edges with lengths and bearings', () => {
    const text = buildContextBlock({
      footprint: [[0, 0], [10, 0], [10, 10], [0, 10]],
      roofSegments: [
        { pitchDeg: 35, azimuthDeg: 0, areaM2: 60, centerLng: 0, centerLat: 51 },
      ],
      eaveHeightM: 5.5,
      dimensionsM: { x: 10, y: 7, z: 10 },
    })
    expect(text).toContain('EDGE 0')
    expect(text).toContain('5.5')
    expect(text).toContain('pitch 35')
  })

  it('handles empty roof segments', () => {
    const text = buildContextBlock({
      footprint: [[0, 0], [5, 0], [5, 4], [0, 4]],
      roofSegments: [],
      eaveHeightM: 5,
      dimensionsM: { x: 5, y: 6, z: 4 },
    })
    expect(text).toContain('no Solar API segments available')
  })
})
