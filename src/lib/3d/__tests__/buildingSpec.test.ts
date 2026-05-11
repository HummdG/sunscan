import { describe, it, expect } from 'vitest'
import {
  BuildingSpecSchema,
  FALLBACK_SPEC,
  buildingSpecJsonSchema,
} from '@/lib/3d/buildingSpec'

describe('BuildingSpecSchema', () => {
  it('accepts FALLBACK_SPEC', () => {
    expect(() => BuildingSpecSchema.parse(FALLBACK_SPEC)).not.toThrow()
  })

  it('rejects negative eaveHeight', () => {
    const bad = { ...FALLBACK_SPEC, eaveHeightM: -1 }
    expect(() => BuildingSpecSchema.parse(bad)).toThrow()
  })

  it('rejects pitchDeg > 60', () => {
    const bad = {
      ...FALLBACK_SPEC,
      roof: {
        type: 'gable' as const,
        planes: [{ footprintEdgeIndex: 0, pitchDeg: 75, azimuthDeg: 0 }],
      },
    }
    expect(() => BuildingSpecSchema.parse(bad)).toThrow()
  })

  it('rejects non-hex wall color', () => {
    const bad = {
      ...FALLBACK_SPEC,
      materials: { ...FALLBACK_SPEC.materials, wallColor: 'red' as const },
    }
    expect(() => BuildingSpecSchema.parse(bad as never)).toThrow()
  })

  it('accepts a spec with chimneys and dormers', () => {
    const good = {
      ...FALLBACK_SPEC,
      features: {
        chimneys: [{ x: 1, z: 0, widthM: 1.0, depthM: 1.0, heightAboveRoofM: 1.2 }],
        dormers:  [{ footprintEdgeIndex: 0, offsetAlongEdgeM: 2, widthM: 1.2,
                     heightM: 1.2, projectionM: 0.8, roofType: 'gable' as const }],
      },
    }
    expect(() => BuildingSpecSchema.parse(good)).not.toThrow()
  })

  it('emits a JSON Schema compatible with Anthropic tool_use', () => {
    expect(buildingSpecJsonSchema).toMatchObject({ type: 'object', properties: expect.any(Object) })
    expect(buildingSpecJsonSchema.properties).toHaveProperty('eaveHeightM')
    expect(buildingSpecJsonSchema.properties).toHaveProperty('roof')
  })
})
