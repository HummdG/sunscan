import { NodeIO, type Document, type Primitive, type Accessor } from '@gltf-transform/core'
import * as THREE from 'three'
import { buildRoof } from './specRoof'
import type { BuildingSpec } from './buildingSpec'

export interface RoofSegmentLocal {
  pitchDeg: number
  azimuthDeg: number
  areaM2: number
  centerX: number
  centerZ: number
}

const ROOF_NORMAL_Y_THRESHOLD = 0.3

export async function replaceRoofInGlb(
  meshyGlb: Buffer,
  roofSegments: RoofSegmentLocal[],
  footprintLocal: Array<[number, number]>,
  eaveHeightM: number,
): Promise<{ glb: Buffer; replaced: boolean }> {
  try {
    const io = new NodeIO()
    const doc = await io.readBinary(new Uint8Array(meshyGlb))

    const roofAabb = stripRoofFaces(doc)
    if (!roofAabb || roofAabb.triangleCount === 0) {
      return { glb: meshyGlb, replaced: false }
    }

    // Sanity check: if Meshy's eave AABB area is dramatically smaller than
    // the real footprint area, the input mesh was too soft for Meshy to
    // reconstruct (typical failure: a tiny crumpled blob). Grafting a
    // footprint-sized procedural roof onto that produces the worst of both
    // worlds — a huge plane with a wisp of geometry under it. Better to
    // surface the raw Meshy output so the toggle lets the user see what
    // happened and the caller can retry.
    const meshyAabbAreaM2 = (roofAabb.maxX - roofAabb.minX) * (roofAabb.maxZ - roofAabb.minZ)
    const footprintAreaM2 = polygonAreaAbs(footprintLocal)
    if (footprintAreaM2 > 1 && meshyAabbAreaM2 < footprintAreaM2 * 0.4) {
      console.warn('[glbRoofCorrector] meshy mesh too small relative to footprint', {
        meshyAabbAreaM2,
        footprintAreaM2,
        ratio: meshyAabbAreaM2 / footprintAreaM2,
      })
      return { glb: meshyGlb, replaced: false }
    }

    const synthRoof = buildSyntheticRoofSpec(roofSegments, footprintLocal)
    const result = buildRoof(footprintLocal, synthRoof, eaveHeightM)

    const newPositions = extractRoofPositions(result.group)
    if (newPositions.length === 0) {
      return { glb: meshyGlb, replaced: false }
    }

    alignToEaveAabb(newPositions, roofAabb)

    appendRoofPrimitive(doc, newPositions)

    const out = await io.writeBinary(doc)
    return { glb: Buffer.from(out), replaced: true }
  } catch (err) {
    console.warn('[glbRoofCorrector] roof replacement failed', err)
    return { glb: meshyGlb, replaced: false }
  }
}

interface RoofAabb {
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
  triangleCount: number
}

function stripRoofFaces(doc: Document): RoofAabb | null {
  const meshes = doc.getRoot().listMeshes()
  if (meshes.length === 0) return null

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let totalRoofTriangles = 0

  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4 /* TRIANGLES */) continue
      const positionAcc = prim.getAttribute('POSITION')
      if (!positionAcc) continue

      const positions = positionAcc.getArray() as Float32Array | null
      if (!positions) continue
      const stride = 3

      const indexAcc = prim.getIndices()
      const indexArray = indexAcc?.getArray() as Uint16Array | Uint32Array | null

      const triCount = indexArray ? indexArray.length / 3 : positions.length / stride / 3
      const keepIndices: number[] = []

      for (let t = 0; t < triCount; t++) {
        const ia = indexArray ? indexArray[t * 3] : t * 3
        const ib = indexArray ? indexArray[t * 3 + 1] : t * 3 + 1
        const ic = indexArray ? indexArray[t * 3 + 2] : t * 3 + 2

        const ax = positions[ia * stride], ay = positions[ia * stride + 1], az = positions[ia * stride + 2]
        const bx = positions[ib * stride], by = positions[ib * stride + 1], bz = positions[ib * stride + 2]
        const cx = positions[ic * stride], cy = positions[ic * stride + 1], cz = positions[ic * stride + 2]

        const e1x = bx - ax, e1y = by - ay, e1z = bz - az
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
        const nx = e1y * e2z - e1z * e2y
        const ny = e1z * e2x - e1x * e2z
        const nz = e1x * e2y - e1y * e2x
        const nlen = Math.hypot(nx, ny, nz) + 1e-9
        const normalY = ny / nlen

        if (normalY > ROOF_NORMAL_Y_THRESHOLD) {
          totalRoofTriangles++
          // Track AABB across ALL 3 vertices of every roof triangle.
          // - XZ extent gives the roof's horizontal footprint (eave perimeter).
          // - minY gives Meshy's inferred eave height; maxY gives the ridge.
          // We translate the new roof so its lowest vertices land at this
          // minY layer, with XZ centred on the AABB midpoint.
          if (ax < minX) minX = ax
          if (bx < minX) minX = bx
          if (cx < minX) minX = cx
          if (ax > maxX) maxX = ax
          if (bx > maxX) maxX = bx
          if (cx > maxX) maxX = cx
          if (ay < minY) minY = ay
          if (by < minY) minY = by
          if (cy < minY) minY = cy
          if (ay > maxY) maxY = ay
          if (by > maxY) maxY = by
          if (cy > maxY) maxY = cy
          if (az < minZ) minZ = az
          if (bz < minZ) minZ = bz
          if (cz < minZ) minZ = cz
          if (az > maxZ) maxZ = az
          if (bz > maxZ) maxZ = bz
          if (cz > maxZ) maxZ = cz
        } else {
          if (indexArray) {
            keepIndices.push(ia, ib, ic)
          } else {
            // Non-indexed: we need to construct an index that excludes roof tris.
            keepIndices.push(t * 3, t * 3 + 1, t * 3 + 2)
          }
        }
      }

      if (totalRoofTriangles > 0) {
        const buf = doc.getRoot().listBuffers()[0]
        const newIndexAcc = doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Uint32Array(keepIndices))
          .setBuffer(buf)
        prim.setIndices(newIndexAcc)
      }
    }
  }

  if (totalRoofTriangles === 0) return null

  return { minX, minY, minZ, maxX, maxY, maxZ, triangleCount: totalRoofTriangles }
}

function buildSyntheticRoofSpec(
  segments: RoofSegmentLocal[],
  footprintLocal: Array<[number, number]>,
): BuildingSpec['roof'] {
  if (segments.length === 0 || footprintLocal.length < 3) {
    return {
      type: 'gable',
      planes: [
        { footprintEdgeIndex: 0, pitchDeg: 35, azimuthDeg: 0 },
        { footprintEdgeIndex: 2 % Math.max(1, footprintLocal.length), pitchDeg: 35, azimuthDeg: 180 },
      ],
    }
  }

  const planes = segments.map((seg) => {
    let bestEdge = 0
    let bestDist = Infinity
    for (let i = 0; i < footprintLocal.length; i++) {
      const a = footprintLocal[i]
      const b = footprintLocal[(i + 1) % footprintLocal.length]
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const len = Math.hypot(dx, dz) + 1e-9
      // Perpendicular distance from segment center to edge AB.
      const dist = Math.abs(dx * (a[1] - seg.centerZ) - (a[0] - seg.centerX) * dz) / len
      if (dist < bestDist) {
        bestDist = dist
        bestEdge = i
      }
    }
    return {
      footprintEdgeIndex: bestEdge,
      pitchDeg: clamp(seg.pitchDeg, 0.5, 60),
      azimuthDeg: ((seg.azimuthDeg % 360) + 360) % 360,
    }
  })

  const type: BuildingSpec['roof']['type'] = segments.length >= 3 ? 'mixed' : 'gable'
  return { type, planes }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Shoelace area of a 2D polygon, always positive. */
function polygonAreaAbs(ring: Array<[number, number]>): number {
  let a = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const [x1, z1] = ring[i]
    const [x2, z2] = ring[(i + 1) % n]
    a += x1 * z2 - x2 * z1
  }
  return Math.abs(a) / 2
}

function extractRoofPositions(group: THREE.Group): Float32Array[] {
  const out: Float32Array[] = []
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const geom = obj.geometry as THREE.BufferGeometry
    obj.updateMatrixWorld(true)
    const positionAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!positionAttr) return
    const indexAttr = geom.getIndex()
    const count = indexAttr ? indexAttr.count : positionAttr.count
    const buf = new Float32Array(count * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      const idx = indexAttr ? indexAttr.getX(i) : i
      v.fromBufferAttribute(positionAttr, idx).applyMatrix4(obj.matrixWorld)
      buf[i * 3] = v.x
      buf[i * 3 + 1] = v.y
      buf[i * 3 + 2] = v.z
    }
    out.push(buf)
  })
  return out
}

function alignToEaveAabb(newPositions: Float32Array[], target: RoofAabb): void {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const arr of newPositions) {
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
  }

  // Translate so the new roof's eave plane (its minY layer) matches the Meshy
  // eave AABB's minY layer, with footprint-centred XZ alignment.
  const tx = (target.minX + target.maxX) / 2 - (minX + maxX) / 2
  const ty = target.minY - minY
  const tz = (target.minZ + target.maxZ) / 2 - (minZ + maxZ) / 2

  for (const arr of newPositions) {
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += tx
      arr[i + 1] += ty
      arr[i + 2] += tz
    }
  }
}

function appendRoofPrimitive(doc: Document, positions: Float32Array[]): void {
  let totalVerts = 0
  for (const arr of positions) totalVerts += arr.length / 3
  if (totalVerts === 0) return

  const merged = new Float32Array(totalVerts * 3)
  let offset = 0
  for (const arr of positions) {
    merged.set(arr, offset)
    offset += arr.length
  }

  const normals = computeNormals(merged)
  const buf = doc.getRoot().listBuffers()[0] ?? doc.createBuffer('roof')

  const posAcc: Accessor = doc
    .createAccessor('roof_position')
    .setType('VEC3')
    .setArray(merged)
    .setBuffer(buf)
  const normalAcc: Accessor = doc
    .createAccessor('roof_normal')
    .setType('VEC3')
    .setArray(normals)
    .setBuffer(buf)

  const mat = doc
    .createMaterial('CorrectedRoof')
    .setBaseColorFactor([0xc2 / 255, 0x65 / 255, 0x3b / 255, 1])
    .setRoughnessFactor(0.85)
    .setMetallicFactor(0)

  const prim: Primitive = doc
    .createPrimitive()
    .setMode(4 /* TRIANGLES */)
    .setAttribute('POSITION', posAcc)
    .setAttribute('NORMAL', normalAcc)
    .setMaterial(mat)

  const mesh = doc.getRoot().listMeshes()[0] ?? doc.createMesh('main')
  mesh.addPrimitive(prim)
}

function computeNormals(positions: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(positions.length)
  for (let t = 0; t < positions.length / 9; t++) {
    const i = t * 9
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2]
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5]
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const len = Math.hypot(nx, ny, nz) + 1e-9
    nx /= len; ny /= len; nz /= len
    // Ensure upward normals for the roof
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz }
    out[i] = nx; out[i + 1] = ny; out[i + 2] = nz
    out[i + 3] = nx; out[i + 4] = ny; out[i + 5] = nz
    out[i + 6] = nx; out[i + 7] = ny; out[i + 8] = nz
  }
  return out
}
