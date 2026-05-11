import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  buildChimney,
  buildDormer,
  buildConservatory,
  buildGarage,
} from '@/lib/3d/specFeatures'

function bboxSize(obj: THREE.Object3D): THREE.Vector3 {
  const bb = new THREE.Box3().setFromObject(obj)
  const s = new THREE.Vector3()
  bb.getSize(s)
  return s
}

describe('buildChimney', () => {
  it('produces a box sized roughly w × (heightAboveRoof) × d', () => {
    const mesh = buildChimney({
      x: 2, z: 1, widthM: 0.9, depthM: 0.9, heightAboveRoofM: 1.2,
      roofTopY: 7.5,
    })
    const size = bboxSize(mesh)
    expect(size.x).toBeCloseTo(0.9, 2)
    expect(size.z).toBeCloseTo(0.9, 2)
    expect(size.y).toBeCloseTo(1.2, 2)
  })

  it('sits with its base on roofTopY', () => {
    const mesh = buildChimney({
      x: 0, z: 0, widthM: 0.8, depthM: 0.8, heightAboveRoofM: 1.0,
      roofTopY: 6.5,
    })
    const bb = new THREE.Box3().setFromObject(mesh)
    expect(bb.min.y).toBeCloseTo(6.5, 2)
    expect(bb.max.y).toBeCloseTo(7.5, 2)
  })
})

describe('buildDormer', () => {
  it('produces geometry within the requested width and height', () => {
    const mesh = buildDormer({
      wallStart: new THREE.Vector3(-5, 0, 0),
      wallEnd:   new THREE.Vector3( 5, 0, 0),
      offsetAlongEdgeM: 2,
      widthM: 1.5,
      heightM: 1.2,
      projectionM: 0.8,
      eaveHeightM: 5.5,
      roofType: 'gable',
    })
    const size = bboxSize(mesh)
    expect(size.x).toBeCloseTo(1.5, 1)
    expect(size.y).toBeGreaterThan(1.2)  // includes the small dormer roof
    expect(size.z).toBeGreaterThanOrEqual(0.8)  // cone eave overhangs body depth
  })
})

describe('buildConservatory', () => {
  it('uses transmissive material (transmission > 0)', () => {
    const mesh = buildConservatory({
      wallStart: new THREE.Vector3(-3, 0, 0),
      wallEnd:   new THREE.Vector3( 3, 0, 0),
      offsetAlongEdgeM: 0.5,
      widthM: 3, depthM: 3, heightM: 2.5,
    })
    let foundTransmissive = false
    mesh.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined
      if (m && 'transmission' in m && m.transmission > 0) foundTransmissive = true
    })
    expect(foundTransmissive).toBe(true)
  })
})

describe('buildGarage', () => {
  it('placed 0 m off the wall when attached', () => {
    const mesh = buildGarage({
      wallStart: new THREE.Vector3(-4, 0, 0),
      wallEnd:   new THREE.Vector3( 4, 0, 0),
      offsetAlongEdgeM: 0, widthM: 3, depthM: 5, heightM: 2.5,
      attachment: 'attached',
    })
    const bb = new THREE.Box3().setFromObject(mesh)
    // outward = +Z for wallDir=+X; garage extends +Z from z=0
    expect(bb.min.z).toBeGreaterThanOrEqual(-0.05)  // touches the wall plane (z=0)
  })

  it('placed 0.5 m off the wall when detached', () => {
    const mesh = buildGarage({
      wallStart: new THREE.Vector3(-4, 0, 0),
      wallEnd:   new THREE.Vector3( 4, 0, 0),
      offsetAlongEdgeM: 0, widthM: 3, depthM: 5, heightM: 2.5,
      attachment: 'detached',
    })
    const bb = new THREE.Box3().setFromObject(mesh)
    // outward = +Z; detach gap pushes min.z to +0.5
    expect(bb.min.z).toBeGreaterThan(0.4)  // pushed outward away from wall
  })
})

describe('rotation correctness on non-±X walls', () => {
  it('buildConservatory: width axis aligns with wallDir for a N-S wall', () => {
    // Wall along +Z (north-south); width should end up along Z, depth along X
    const mesh = buildConservatory({
      wallStart: new THREE.Vector3(0, 0, -4),
      wallEnd:   new THREE.Vector3(0, 0,  4),
      offsetAlongEdgeM: 0.5,
      widthM: 6, depthM: 2, heightM: 2.5,
    })
    const bb = new THREE.Box3().setFromObject(mesh)
    const size = new THREE.Vector3()
    bb.getSize(size)
    // With width along Z and depth along X, bbox.z ≈ 6, bbox.x ≈ 2
    expect(size.z).toBeCloseTo(6, 1)
    expect(size.x).toBeCloseTo(2, 1)
  })

  it('buildGarage: width axis aligns with wallDir for a N-S wall', () => {
    const mesh = buildGarage({
      wallStart: new THREE.Vector3(0, 0, -4),
      wallEnd:   new THREE.Vector3(0, 0,  4),
      offsetAlongEdgeM: 0, widthM: 3, depthM: 5, heightM: 2.5,
      attachment: 'attached',
    })
    const bb = new THREE.Box3().setFromObject(mesh)
    const size = new THREE.Vector3()
    bb.getSize(size)
    expect(size.z).toBeCloseTo(3, 1)  // width along Z
    expect(size.x).toBeCloseTo(5, 1)  // depth along X
  })
})
