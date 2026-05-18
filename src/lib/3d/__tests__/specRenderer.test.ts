import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { renderSpec } from '@/lib/3d/specRenderer'
import { FALLBACK_SPEC } from '@/lib/3d/buildingSpec'

const square: Array<[number, number]> = [
  [-5, -4], [ 5, -4], [ 5,  4], [-5,  4],
]

describe('renderSpec', () => {
  it('produces a group containing walls and roof', () => {
    const { group } = renderSpec({ spec: FALLBACK_SPEC, footprintLocal: square })
    const names = new Set<string>()
    group.traverse((o) => { if (o.name) names.add(o.name) })
    expect(names.has('walls')).toBe(true)
    let hasRoof = false
    group.traverse((o) => { if (o.name?.startsWith('roof')) hasRoof = true })
    expect(hasRoof).toBe(true)
  })

  it('centres the building so footprint centroid is at x=z=0 and y_min=0', () => {
    const offset: Array<[number, number]> = [[10, 10], [20, 10], [20, 18], [10, 18]]
    const { group } = renderSpec({ spec: FALLBACK_SPEC, footprintLocal: offset })
    const bb = new THREE.Box3().setFromObject(group)
    expect(bb.min.y).toBeCloseTo(0, 1)
    expect((bb.min.x + bb.max.x) / 2).toBeCloseTo(0, 1)
    expect((bb.min.z + bb.max.z) / 2).toBeCloseTo(0, 1)
  })

  it('handles a borderline eaveHeight without crashing', () => {
    const safeSpec = { ...FALLBACK_SPEC, eaveHeightM: 20 }
    expect(() => renderSpec({ spec: safeSpec, footprintLocal: square })).not.toThrow()
  })

  it('attaches chimneys at roofTopY', () => {
    const spec = {
      ...FALLBACK_SPEC,
      features: {
        ...FALLBACK_SPEC.features,
        chimneys: [{ x: 1, z: 0, widthM: 0.9, depthM: 0.9, heightAboveRoofM: 1.0 }],
      },
    }
    const { group } = renderSpec({ spec, footprintLocal: square })
    let foundChimney = false
    group.traverse((o) => { if (o.userData.featureKind === 'chimney') foundChimney = true })
    expect(foundChimney).toBe(true)
  })

  it('exposes faceMetadata combining walls and roof', () => {
    const { faceMetadata } = renderSpec({ spec: FALLBACK_SPEC, footprintLocal: square })
    expect(faceMetadata.length).toBeGreaterThan(0)
    expect(faceMetadata.some((f) => f.kind === 'wall')).toBe(true)
    expect(faceMetadata.some((f) => f.kind === 'roof')).toBe(true)
  })
})
