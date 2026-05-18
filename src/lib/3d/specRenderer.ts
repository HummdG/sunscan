/**
 * @deprecated Superseded by the Meshy + roof-correction pipeline in
 * `/api/report/[id]/reconstruction/generate`. Retained until that pipeline
 * has ~2 weeks of production validation, then this module can be removed.
 * Note: `buildRoof()` from `./specRoof` is still load-bearing — it's reused
 * by `src/lib/3d/glbRoofCorrector.ts` to graft the corrected roof.
 */
import * as THREE from 'three'
import type { BuildingSpec } from './buildingSpec'
import { buildWalls } from './specWalls'
import { buildRoof } from './specRoof'
import {
  buildChimney,
  buildDormer,
  buildConservatory,
  buildGarage,
} from './specFeatures'

export interface SpecRenderInput {
  spec: BuildingSpec
  /** Footprint ring in local x/z metres (CCW preferred, but handled either way) */
  footprintLocal: Array<[number, number]>
}

export type FaceKind = 'wall' | 'roof' | 'gable' | 'fill'

export interface FaceMeta {
  kind: FaceKind
  /** Outward face normal */
  normal: THREE.Vector3
  /** edgeIndex for walls, planeIndex for roof faces */
  index: number
}

export interface SpecRenderResult {
  group: THREE.Group
  bbox: THREE.Box3
  faceMetadata: FaceMeta[]
  ridgeY: number
}

export function renderSpec(input: SpecRenderInput): SpecRenderResult {
  const { spec, footprintLocal } = input
  const root = new THREE.Group()
  root.name = 'spec-building'
  const faceMetadata: FaceMeta[] = []

  // 1. Walls
  const wallResult = buildWalls(footprintLocal, spec.eaveHeightM)
  root.add(wallResult.group)
  applyMaterialColor(wallResult.group, spec.materials.wallColor)
  for (const f of wallResult.faces) {
    faceMetadata.push({ kind: 'wall', normal: f.normal, index: f.edgeIndex })
  }

  // 2. Roof
  const roofResult = buildRoof(footprintLocal, spec.roof, spec.eaveHeightM)
  root.add(roofResult.group)
  applyMaterialColor(roofResult.group, spec.materials.roofColor)
  for (const f of roofResult.faces) {
    faceMetadata.push({ kind: f.kind, normal: f.normal, index: f.planeIndex })
  }

  // 3. Features
  for (const c of spec.features.chimneys) {
    const inside = pointInRing(c.x, c.z, footprintLocal)
    if (!inside) continue
    root.add(buildChimney({
      x: c.x, z: c.z,
      widthM: c.widthM, depthM: c.depthM, heightAboveRoofM: c.heightAboveRoofM,
      roofTopY: roofResult.ridgeY,
    }))
  }

  for (const d of spec.features.dormers) {
    if (d.footprintEdgeIndex < 0 || d.footprintEdgeIndex >= footprintLocal.length) continue
    const edgeFace = wallResult.faces.find((f) => f.edgeIndex === d.footprintEdgeIndex)
    if (!edgeFace) continue
    const widthClamped = Math.min(d.widthM, edgeFace.lengthM - 0.4)
    if (widthClamped <= 0.3) continue
    root.add(buildDormer({
      wallStart: edgeFace.start,
      wallEnd: edgeFace.end,
      offsetAlongEdgeM: d.offsetAlongEdgeM,
      widthM: widthClamped,
      heightM: d.heightM,
      projectionM: d.projectionM,
      eaveHeightM: spec.eaveHeightM,
      roofType: d.roofType,
    }))
  }

  if (spec.features.conservatory) {
    const c = spec.features.conservatory
    const edgeFace = wallResult.faces.find((f) => f.edgeIndex === c.footprintEdgeIndex)
    if (edgeFace) {
      root.add(buildConservatory({
        wallStart: edgeFace.start,
        wallEnd: edgeFace.end,
        offsetAlongEdgeM: c.offsetAlongEdgeM,
        widthM: c.widthM, depthM: c.depthM, heightM: c.heightM,
      }))
    }
  }

  if (spec.features.garage) {
    const g = spec.features.garage
    const edgeFace = wallResult.faces.find((f) => f.edgeIndex === g.footprintEdgeIndex)
    if (edgeFace) {
      root.add(buildGarage({
        wallStart: edgeFace.start,
        wallEnd: edgeFace.end,
        offsetAlongEdgeM: g.offsetAlongEdgeM,
        widthM: g.widthM, depthM: g.depthM, heightM: g.heightM,
        attachment: g.attachment,
      }))
    }
  }

  // 4. Centre & lift so y_min=0 and footprint centroid at origin
  const bbBefore = new THREE.Box3().setFromObject(root)
  let cx = 0, cz = 0
  for (const [x, z] of footprintLocal) { cx += x; cz += z }
  cx /= footprintLocal.length; cz /= footprintLocal.length
  root.position.set(-cx, -bbBefore.min.y, -cz)

  const bbox = new THREE.Box3().setFromObject(root)
  return {
    group: root,
    bbox,
    faceMetadata,
    ridgeY: roofResult.ridgeY + root.position.y,
  }
}

function applyMaterialColor(group: THREE.Object3D, hex: string): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat && 'color' in mat) {
      mat.color = new THREE.Color(hex)
      mat.needsUpdate = true
    }
  })
}

function pointInRing(x: number, z: number, ring: Array<[number, number]>): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = ring[i]; const [xj, zj] = ring[j]
    const intersects = (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi
    if (intersects) inside = !inside
  }
  return inside
}
