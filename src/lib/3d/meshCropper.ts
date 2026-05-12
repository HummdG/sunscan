import * as THREE from 'three'
import type { FootprintPrism } from './footprintPrism'

export interface CroppedMesh {
  geometry: THREE.BufferGeometry
  /** One material per geometry group; references source tile textures verbatim */
  materials: THREE.Material[]
  bbox: THREE.Box3
  triangleCount: number
}

/**
 * Walk a Three.js group of meshes (typically the TilesRenderer output), keep
 * triangles whose centroid lies inside the prism, and combine them into a
 * single BufferGeometry expressed in world-space coordinates.
 *
 * Original per-mesh materials (with their tile textures) are preserved by
 * partitioning the output geometry into groups, one per source material.
 */
export function cropMeshToPrism(
  root: THREE.Object3D,
  prism: FootprintPrism,
  /**
   * Loose prism used for the "no vertex extends beyond this" spike check.
   * If omitted, the tight `prism` is used for both checks (which is too
   * aggressive — kills legitimate boundary triangles).
   */
  vertexPrism: FootprintPrism = prism,
): CroppedMesh {
  // NOTE: We deliberately do NOT call root.updateMatrixWorld(true) here.
  // TilesRenderer sets each tile mesh's `matrix` directly, but leaves
  // `matrixAutoUpdate` at its default (true). Forcing a recompose would call
  // `updateMatrix()` on every child, recomputing matrix from stale TRS and
  // wiping out the library's tile placement. Trust matrixWorld as the
  // renderer left it after the last `renderer.render(scene, camera)` call.

  // Pass 1: collect kept triangles per source material.
  const perMat = new Map<THREE.Material, {
    pos: number[]
    nor: number[]
    uv: number[]
    hasUv: boolean
  }>()

  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const triNormal = new THREE.Vector3()

  const bbox = new THREE.Box3()
  bbox.makeEmpty()
  let triCount = 0

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return

    const geom = mesh.geometry as THREE.BufferGeometry
    if (!geom) return
    const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) return
    const uvAttr = geom.getAttribute('uv') as THREE.BufferAttribute | undefined
    const matWorld = mesh.matrixWorld

    // TilesRenderer always uses a single Material per Mesh
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined
    if (!material) return

    let bucket = perMat.get(material)
    if (!bucket) {
      bucket = { pos: [], nor: [], uv: [], hasUv: !!uvAttr }
      perMat.set(material, bucket)
    }
    if (uvAttr && !bucket.hasUv) bucket.hasUv = true

    const index = geom.getIndex()
    const triCountIn = index ? index.count / 3 : pos.count / 3

    for (let t = 0; t < triCountIn; t++) {
      const i0 = index ? index.getX(t * 3 + 0) : t * 3 + 0
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2

      va.fromBufferAttribute(pos, i0).applyMatrix4(matWorld)
      vb.fromBufferAttribute(pos, i1).applyMatrix4(matWorld)
      vc.fromBufferAttribute(pos, i2).applyMatrix4(matWorld)

      centroid.copy(va).add(vb).add(vc).multiplyScalar(1 / 3)
      if (!prism.contains(centroid)) continue

      // Reject "spike" triangles — centroid inside the tight building prism
      // but a vertex extending far outside. The vertex test uses a looser
      // prism (typically the same polygon expanded by 2-3 m) so legitimate
      // boundary triangles aren't all rejected.
      if (!vertexPrism.contains(va) || !vertexPrism.contains(vb) || !vertexPrism.contains(vc)) continue

      ab.subVectors(vb, va)
      ac.subVectors(vc, va)
      triNormal.crossVectors(ab, ac)
      const crossLen = triNormal.length()
      if (crossLen === 0 || !Number.isFinite(crossLen)) continue
      triNormal.divideScalar(crossLen)

      // Reject sliver triangles — tile-boundary artefacts that look like
      // thin spikes. area/maxEdge² ≈ 0.43 for equilateral, → 0 for slivers.
      const area = 0.5 * crossLen
      const maxEdge = Math.max(ab.length(), ac.length(), vc.distanceTo(vb))
      if (area / (maxEdge * maxEdge) < 0.03) continue

      bucket.pos.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z)
      bucket.nor.push(triNormal.x, triNormal.y, triNormal.z)
      bucket.nor.push(triNormal.x, triNormal.y, triNormal.z)
      bucket.nor.push(triNormal.x, triNormal.y, triNormal.z)
      if (uvAttr) {
        bucket.uv.push(uvAttr.getX(i0), uvAttr.getY(i0))
        bucket.uv.push(uvAttr.getX(i1), uvAttr.getY(i1))
        bucket.uv.push(uvAttr.getX(i2), uvAttr.getY(i2))
      } else if (bucket.hasUv) {
        bucket.uv.push(0, 0, 0, 0, 0, 0)
      }

      bbox.expandByPoint(va)
      bbox.expandByPoint(vb)
      bbox.expandByPoint(vc)
      triCount++
    }
  })

  // Pass 2: combine into a single BufferGeometry with groups.
  const allPos: number[] = []
  const allNor: number[] = []
  const allUv: number[] = []
  const materials: THREE.Material[] = []
  let vertexOffset = 0
  let anyHasUv = false
  for (const b of perMat.values()) { if (b.hasUv) { anyHasUv = true; break } }

  const geometry = new THREE.BufferGeometry()

  let groupIndex = 0
  for (const [material, bucket] of perMat.entries()) {
    if (bucket.pos.length === 0) continue
    const vertCount = bucket.pos.length / 3
    allPos.push(...bucket.pos)
    allNor.push(...bucket.nor)
    if (anyHasUv) {
      if (bucket.hasUv) {
        allUv.push(...bucket.uv)
      } else {
        for (let i = 0; i < vertCount; i++) allUv.push(0, 0)
      }
    }
    geometry.addGroup(vertexOffset, vertCount, groupIndex)
    // Clone the material so we can switch to DoubleSide without mutating the
    // live tile renderer's shared material instance. DoubleSide hides the
    // "looking inside the hollow building" effect from missing walls.
    const clone = material.clone()
    clone.side = THREE.DoubleSide
    materials.push(clone)
    vertexOffset += vertCount
    groupIndex++
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(allNor, 3))
  if (anyHasUv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(allUv, 2))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return { geometry, materials, bbox, triangleCount: triCount }
}
