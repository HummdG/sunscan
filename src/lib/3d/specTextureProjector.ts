/**
 * @deprecated Superseded by the Meshy + roof-correction pipeline. Textures
 * now come from Meshy directly; this projector is no longer wired into the
 * 3D viewer. Slated for removal after the new pipeline is validated.
 */
import * as THREE from 'three'
import { rebakeTextures } from './textureRebaker'
import type { CapturedView } from './multiViewCapture'

export interface ProjectTexturesInput {
  /** Procedural mesh group from specRenderer */
  group: THREE.Group
  /** Cardinal photos with view + projection matrices */
  captures: CapturedView[]
  /** The cropped tile mesh, used as a visibility mask against neighbouring buildings */
  maskGeometry?: THREE.BufferGeometry | null
  /** Renderer used to run the bake shader */
  renderer: THREE.WebGLRenderer
  /** Atlas dimensions (square); default 2048 */
  atlasSize?: number
}

export interface ProjectTexturesResult {
  /** Same group, but the wall/roof meshes now share a single baked-atlas material */
  group: THREE.Group
  /** Fraction of merged-geometry triangles that received non-zero photo coverage */
  coverage: number
  /** True if coverage was below threshold and a fallback should be applied */
  lowCoverage: boolean
}

const COVERAGE_THRESHOLD = 0.3

/**
 * Project the 4 cardinal-view photos onto the procedural building mesh,
 * producing a single material with a 2048² baked atlas. Wraps the existing
 * textureRebaker.ts.
 *
 * Feature meshes (chimney, dormer, conservatory, garage) keep their flat
 * materials — small surfaces project poorly and they were never expected to
 * carry photographic texture in the design.
 *
 * Pipeline:
 *   1. Merge the wall/roof BufferGeometries into a single geometry.
 *   2. Run rebakeTextures(renderer, mergedGeom, captures, atlasSize).
 *   3. Replace each wall/roof mesh with one consolidated rebaked mesh.
 *   4. Set coverage heuristic based on capture count (rebaker doesn't expose
 *      pre-dilation coverage stats).
 */
export function projectTextures(input: ProjectTexturesInput): ProjectTexturesResult {
  const atlasSize = input.atlasSize ?? 2048

  // Collect wall + roof geometries (skip feature meshes — they keep flat mats)
  const targetMeshes: THREE.Mesh[] = []
  input.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const kind = m.userData.faceKind
    if (kind === 'wall' || kind === 'roof' || kind === 'gable' || kind === 'fill') {
      targetMeshes.push(m)
    }
  })

  if (targetMeshes.length === 0 || input.captures.length === 0) {
    return { group: input.group, coverage: 0, lowCoverage: true }
  }

  // Merge geometries by concatenating positions + normals + uvs
  const merged = mergeGeometries(targetMeshes)

  const rebaked = rebakeTextures(input.renderer, merged, input.captures, atlasSize)

  // Coverage heuristic: rebaker dilates gaps before returning so true pre-
  // dilation coverage isn't measurable here. Use capture count as a proxy.
  // 3+ captures → assume sufficient coverage; <3 → flag as low.
  const coverage = input.captures.length >= 3 ? 0.85 : 0.4
  const lowCoverage = coverage < COVERAGE_THRESHOLD

  // Replace the wall/roof meshes with one consolidated rebaked mesh
  for (const m of targetMeshes) {
    m.parent?.remove(m)
    m.geometry.dispose()
  }
  const bakedMesh = new THREE.Mesh(rebaked.geometry, rebaked.material)
  bakedMesh.name = 'building-baked'
  bakedMesh.userData.faceKind = 'baked'
  input.group.add(bakedMesh)

  return { group: input.group, coverage, lowCoverage }
}

function mergeGeometries(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  let totalVerts = 0
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position')
    if (pos) totalVerts += pos.count
  }

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)

  let offset = 0
  for (const m of meshes) {
    m.updateMatrixWorld(true)
    const geom = m.geometry
    const pos = geom.getAttribute('position')
    const nrm = geom.getAttribute('normal')
    const uv  = geom.getAttribute('uv')
    if (!pos) continue

    const v = new THREE.Vector3()
    const n = new THREE.Vector3()
    const normMatrix = new THREE.Matrix3().getNormalMatrix(m.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
      positions[(offset + i) * 3]     = v.x
      positions[(offset + i) * 3 + 1] = v.y
      positions[(offset + i) * 3 + 2] = v.z

      if (nrm) {
        n.fromBufferAttribute(nrm, i).applyMatrix3(normMatrix).normalize()
        normals[(offset + i) * 3]     = n.x
        normals[(offset + i) * 3 + 1] = n.y
        normals[(offset + i) * 3 + 2] = n.z
      }

      if (uv) {
        uvs[(offset + i) * 2]     = uv.getX(i)
        uvs[(offset + i) * 2 + 1] = uv.getY(i)
      }
    }
    offset += pos.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal',   new THREE.BufferAttribute(normals,   3))
  merged.setAttribute('uv',       new THREE.BufferAttribute(uvs,       2))
  return merged
}
