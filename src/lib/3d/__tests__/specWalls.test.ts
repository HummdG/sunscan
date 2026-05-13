import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildWalls } from '@/lib/3d/specWalls'

const square: Array<[number, number]> = [
  [-5, -4], [ 5, -4], [ 5,  4], [-5,  4],
]

describe('buildWalls', () => {
  it('produces one wall mesh per footprint edge', () => {
    const result = buildWalls(square, 6)
    expect(result.faces.length).toBe(4)
  })

  it('wall heights span y=0 to y=eaveHeightM', () => {
    const result = buildWalls(square, 6)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.min.y).toBeCloseTo(0, 5)
    expect(bb.max.y).toBeCloseTo(6, 5)
  })

  it('horizontal bbox matches footprint extent', () => {
    const result = buildWalls(square, 5)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.min.x).toBeCloseTo(-5, 5)
    expect(bb.max.x).toBeCloseTo( 5, 5)
    expect(bb.min.z).toBeCloseTo(-4, 5)
    expect(bb.max.z).toBeCloseTo( 4, 5)
  })

  it('exposes per-face metadata with edgeIndex and outward normal', () => {
    const result = buildWalls(square, 6)
    expect(result.faces[0].edgeIndex).toBe(0)
    // Edge 0 runs from (-5,-4) to (5,-4); outward normal in CCW polygon is -z
    expect(result.faces[0].normal.z).toBeLessThan(-0.9)
  })

  it('handles a triangle footprint', () => {
    const tri: Array<[number, number]> = [[0, 0], [4, 0], [2, 3]]
    const result = buildWalls(tri, 4)
    expect(result.faces.length).toBe(3)
  })
})
