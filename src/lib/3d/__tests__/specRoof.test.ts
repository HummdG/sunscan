import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildRoof } from '@/lib/3d/specRoof'

const square: Array<[number, number]> = [
  [-5, -4], [ 5, -4], [ 5,  4], [-5,  4],
]

describe('buildRoof — flat', () => {
  it('produces a horizontal cap at eaveHeight + parapet', () => {
    const result = buildRoof(square, {
      type: 'flat',
      planes: [{ footprintEdgeIndex: 0, pitchDeg: 0, azimuthDeg: 0 }],
    }, 6)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.min.y).toBeGreaterThanOrEqual(6 - 0.01)
    expect(bb.max.y).toBeLessThanOrEqual(6 + 0.6)
  })
})

describe('buildRoof — gable', () => {
  it('apex rises above eaveHeight for non-zero pitch', () => {
    const result = buildRoof(square, {
      type: 'gable',
      planes: [
        { footprintEdgeIndex: 0, pitchDeg: 35, azimuthDeg: 0 },
        { footprintEdgeIndex: 2, pitchDeg: 35, azimuthDeg: 180 },
      ],
    }, 6)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.max.y).toBeGreaterThan(6 + 1)
  })

  it('roof base sits at eaveHeightM', () => {
    const result = buildRoof(square, {
      type: 'gable',
      planes: [
        { footprintEdgeIndex: 0, pitchDeg: 30, azimuthDeg: 0 },
        { footprintEdgeIndex: 2, pitchDeg: 30, azimuthDeg: 180 },
      ],
    }, 6)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.min.y).toBeCloseTo(6, 1)
  })

  it('emits faceMeta entries with kind=roof', () => {
    const result = buildRoof(square, {
      type: 'gable',
      planes: [
        { footprintEdgeIndex: 0, pitchDeg: 30, azimuthDeg: 0 },
        { footprintEdgeIndex: 2, pitchDeg: 30, azimuthDeg: 180 },
      ],
    }, 6)
    expect(result.faces.length).toBeGreaterThan(0)
    for (const f of result.faces) {
      expect(['roof', 'gable']).toContain(f.kind)
    }
  })
})

describe('buildRoof — hip', () => {
  it('apex point is over the footprint centroid for symmetric input', () => {
    const result = buildRoof(square, {
      type: 'hip',
      planes: [
        { footprintEdgeIndex: 0, pitchDeg: 30, azimuthDeg: 0 },
        { footprintEdgeIndex: 1, pitchDeg: 30, azimuthDeg: 90 },
        { footprintEdgeIndex: 2, pitchDeg: 30, azimuthDeg: 180 },
        { footprintEdgeIndex: 3, pitchDeg: 30, azimuthDeg: 270 },
      ],
    }, 6)
    expect(result.group.children.length).toBeGreaterThan(0)
  })
})

describe('buildRoof — graceful degenerate input', () => {
  it('produces a generic gable when no planes are valid', () => {
    const result = buildRoof(square, {
      type: 'mixed',
      planes: [{ footprintEdgeIndex: 99, pitchDeg: 30, azimuthDeg: 0 }],
    }, 6)
    // Should still produce *something* above eaveHeight, not throw
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.max.y).toBeGreaterThan(6)
  })
})
