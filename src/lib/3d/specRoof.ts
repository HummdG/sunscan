import * as THREE from 'three'
import type { BuildingSpec } from './buildingSpec'

export interface RoofFaceMeta {
  planeIndex: number
  kind: 'roof' | 'gable' | 'fill'
  normal: THREE.Vector3
}

export interface RoofBuildResult {
  group: THREE.Group
  faces: RoofFaceMeta[]
  /** Y-coordinate of the highest roof point — used by chimney placement */
  ridgeY: number
}

/**
 * Build a roof for the given footprint and spec.
 *
 * Strategy:
 *   - 'flat': a horizontal cap at eaveHeightM + 0.3m parapet.
 *   - 'gable': pair planes; resolve their ridge by intersecting the two
 *     pitched plane equations.
 *   - 'hip': all valid planes meet at the footprint centroid raised to
 *     the height implied by their average pitch.
 *   - 'mansard': two-tier — lower steep slope + upper shallow slope sharing
 *     a break line at half the total roof height.
 *   - 'mixed': each valid plane rendered independently; uncovered area gets
 *     a fallback gable at the average pitch.
 *
 * Degenerate inputs (no valid plane / out-of-range edge indices) fall back
 * to a generic gable along the longest footprint axis at 30°.
 */
export function buildRoof(
  ring: Array<[number, number]>,
  roof: BuildingSpec['roof'],
  eaveHeightM: number,
): RoofBuildResult {
  const group = new THREE.Group()
  group.name = 'roof'
  const faces: RoofFaceMeta[] = []

  const n = ring.length
  if (n < 3) return { group, faces, ridgeY: eaveHeightM }

  // Centroid for hip apex and fallback
  let cx = 0, cz = 0
  for (const [x, z] of ring) { cx += x; cz += z }
  cx /= n; cz /= n

  // ── Flat roof ────────────────────────────────────────────────────────
  if (roof.type === 'flat') {
    const capY = eaveHeightM + 0.3
    addPolygonCap(group, faces, ring, capY, 0)
    return { group, faces, ridgeY: capY }
  }

  // Filter to valid planes (edgeIndex within range)
  const validPlanes = roof.planes.filter((p) => p.footprintEdgeIndex >= 0 && p.footprintEdgeIndex < n)
  if (validPlanes.length === 0) {
    return buildFallbackGable(ring, eaveHeightM)
  }

  // ── Gable: pair of opposite planes ───────────────────────────────────
  if (roof.type === 'gable' && validPlanes.length >= 2) {
    return buildGableRoof(ring, validPlanes, eaveHeightM, cx, cz)
  }

  // ── Hip: all planes converge at apex over centroid ───────────────────
  if (roof.type === 'hip') {
    return buildHipRoof(ring, validPlanes, eaveHeightM, cx, cz)
  }

  // ── Mansard: lower (steep) + upper (shallow) tier ────────────────────
  if (roof.type === 'mansard') {
    return buildMansardRoof(ring, validPlanes, eaveHeightM, cx, cz)
  }

  // ── Mixed / fallback: render planes independently, fill gaps with gable
  return buildMixedRoof(ring, validPlanes, eaveHeightM, cx, cz)
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildFallbackGable(
  ring: Array<[number, number]>,
  eaveHeightM: number,
): RoofBuildResult {
  // Find longest axis to orient ridge along
  let longestEdge = 0; let longestLen = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len > longestLen) { longestLen = len; longestEdge = i }
  }
  return buildGableRoof(
    ring,
    [
      { footprintEdgeIndex: longestEdge, pitchDeg: 30, azimuthDeg: 0 },
      { footprintEdgeIndex: (longestEdge + 2) % ring.length, pitchDeg: 30, azimuthDeg: 180 },
    ],
    eaveHeightM,
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  )
}

function buildGableRoof(
  ring: Array<[number, number]>,
  planes: Array<{ footprintEdgeIndex: number; pitchDeg: number; azimuthDeg: number }>,
  eaveHeightM: number,
  _cx: number,
  _cz: number,
): RoofBuildResult {
  const group = new THREE.Group()
  group.name = 'roof-gable'
  const faces: RoofFaceMeta[] = []

  // Take the first two planes that share a parallel-ish footprint edge
  const p1 = planes[0]
  const p2 = planes[1] ?? p1

  const e1 = edgeOf(ring, p1.footprintEdgeIndex)
  const e2 = edgeOf(ring, p2.footprintEdgeIndex)

  // Heights from pitch: rise = run × tan(pitch). Run is perpendicular
  // distance from the edge to the ridge line, which we approximate as
  // half the perpendicular distance from edge → opposite edge midpoint.
  const opposite1 = midpointOfEdge(e2)
  const perpRun1 = perpDistanceFromPoint(opposite1, e1) / 2
  const rise1 = perpRun1 * Math.tan(p1.pitchDeg * Math.PI / 180)
  const ridgeY = eaveHeightM + Math.max(rise1, 0.5)

  // Ridge line: midpoint between e1 and e2 midpoints, at ridgeY
  const m1 = midpointOfEdge(e1)
  const m2 = midpointOfEdge(e2)
  const ridgeStart = new THREE.Vector3(
    (m1.x + m2.x) / 2 - (e1.b.x - e1.a.x) / 2,
    ridgeY,
    (m1.z + m2.z) / 2 - (e1.b.z - e1.a.z) / 2,
  )
  const ridgeEnd = new THREE.Vector3(
    (m1.x + m2.x) / 2 + (e1.b.x - e1.a.x) / 2,
    ridgeY,
    (m1.z + m2.z) / 2 + (e1.b.z - e1.a.z) / 2,
  )

  // Lift eave-level vertices to eaveHeightM before building quads
  const e1aEave = new THREE.Vector3(e1.a.x, eaveHeightM, e1.a.z)
  const e1bEave = new THREE.Vector3(e1.b.x, eaveHeightM, e1.b.z)
  const e2aEave = new THREE.Vector3(e2.a.x, eaveHeightM, e2.a.z)
  const e2bEave = new THREE.Vector3(e2.b.x, eaveHeightM, e2.b.z)

  // Plane 1: from e1 → ridge
  addQuad(group, faces, e1aEave, e1bEave, ridgeEnd, ridgeStart, eaveHeightM, ridgeY, 0, 'roof')
  // Plane 2: from e2 → ridge (note: e2 vertices reversed to close)
  addQuad(group, faces, e2bEave, e2aEave, ridgeStart, ridgeEnd, eaveHeightM, ridgeY, 1, 'roof')

  // Gable ends: triangles between the other two footprint edges and the ridge
  const n = ring.length
  for (let i = 0; i < n; i++) {
    if (i === p1.footprintEdgeIndex || i === p2.footprintEdgeIndex) continue
    const e = edgeOf(ring, i)
    // Pick the ridge endpoint closer to this edge's midpoint
    const em = midpointOfEdge(e)
    const apex = em.distanceTo(ridgeStart) < em.distanceTo(ridgeEnd) ? ridgeStart : ridgeEnd
    addTriangle(group, faces, e.a, e.b, apex, eaveHeightM, faces.length, 'gable')
  }

  return { group, faces, ridgeY }
}

function buildHipRoof(
  ring: Array<[number, number]>,
  planes: Array<{ footprintEdgeIndex: number; pitchDeg: number; azimuthDeg: number }>,
  eaveHeightM: number,
  cx: number,
  cz: number,
): RoofBuildResult {
  const group = new THREE.Group()
  group.name = 'roof-hip'
  const faces: RoofFaceMeta[] = []

  // Apex height: average pitch × min-perpendicular distance to centroid
  const avgPitch = planes.reduce((s, p) => s + p.pitchDeg, 0) / planes.length
  const apexPoint = new THREE.Vector3(cx, eaveHeightM, cz)

  let minR = Infinity
  for (let i = 0; i < ring.length; i++) {
    const e = edgeOf(ring, i)
    const r = perpDistanceFromPoint(new THREE.Vector3(cx, 0, cz), e)
    if (r < minR) minR = r
  }
  apexPoint.y = eaveHeightM + minR * Math.tan(avgPitch * Math.PI / 180)

  // Each footprint edge gets a triangle from edge → apex
  for (let i = 0; i < ring.length; i++) {
    const e = edgeOf(ring, i)
    addTriangle(group, faces, e.a, e.b, apexPoint, eaveHeightM, i, 'roof')
  }

  return { group, faces, ridgeY: apexPoint.y }
}

function buildMansardRoof(
  ring: Array<[number, number]>,
  planes: Array<{ footprintEdgeIndex: number; pitchDeg: number; azimuthDeg: number }>,
  eaveHeightM: number,
  cx: number,
  cz: number,
): RoofBuildResult {
  // Approximation: hip-style apex with a flat cap at 60% of the rise.
  const hipResult = buildHipRoof(ring, planes, eaveHeightM, cx, cz)
  const apexY = hipResult.ridgeY
  const breakY = eaveHeightM + (apexY - eaveHeightM) * 0.6

  // Wrap the hip mesh and add a flat cap at breakY × scaled-down footprint
  const cap = new THREE.Group()
  cap.name = 'roof-mansard-cap'
  const scale = 0.45
  const scaledRing = ring.map(([x, z]) => [cx + (x - cx) * scale, cz + (z - cz) * scale] as [number, number])
  addPolygonCap(cap, hipResult.faces, scaledRing, breakY, hipResult.faces.length)
  hipResult.group.add(cap)
  hipResult.ridgeY = apexY
  return hipResult
}

function buildMixedRoof(
  ring: Array<[number, number]>,
  planes: Array<{ footprintEdgeIndex: number; pitchDeg: number; azimuthDeg: number }>,
  eaveHeightM: number,
  cx: number,
  cz: number,
): RoofBuildResult {
  const group = new THREE.Group()
  group.name = 'roof-mixed'
  const faces: RoofFaceMeta[] = []

  const used = new Set<number>()
  const avgPitch = planes.reduce((s, p) => s + p.pitchDeg, 0) / Math.max(planes.length, 1)
  let maxY = eaveHeightM

  for (const p of planes) {
    const e = edgeOf(ring, p.footprintEdgeIndex)
    const m = midpointOfEdge(e)
    const towardCentre = new THREE.Vector3(cx - m.x, 0, cz - m.z)
    const run = towardCentre.length() * 0.5
    const apex = new THREE.Vector3(
      m.x + towardCentre.normalize().x * run,
      eaveHeightM + run * Math.tan(p.pitchDeg * Math.PI / 180),
      m.z + towardCentre.z * run,
    )
    if (apex.y > maxY) maxY = apex.y
    addTriangle(group, faces, e.a, e.b, apex, eaveHeightM, p.footprintEdgeIndex, 'roof')
    used.add(p.footprintEdgeIndex)
  }
  // Fallback fill for unused edges (generic gable apex)
  for (let i = 0; i < ring.length; i++) {
    if (used.has(i)) continue
    const e = edgeOf(ring, i)
    const m = midpointOfEdge(e)
    const towardCentre = new THREE.Vector3(cx - m.x, 0, cz - m.z)
    const run = towardCentre.length() * 0.5
    const apex = new THREE.Vector3(
      m.x + towardCentre.normalize().x * run,
      eaveHeightM + run * Math.tan(avgPitch * Math.PI / 180),
      m.z + towardCentre.z * run,
    )
    addTriangle(group, faces, e.a, e.b, apex, eaveHeightM, i, 'fill')
  }

  return { group, faces, ridgeY: maxY }
}

// ── Geometric primitives ─────────────────────────────────────────────────

interface Edge { a: THREE.Vector3; b: THREE.Vector3 }

function edgeOf(ring: Array<[number, number]>, i: number): Edge {
  const a = ring[i]; const b = ring[(i + 1) % ring.length]
  return {
    a: new THREE.Vector3(a[0], 0, a[1]),
    b: new THREE.Vector3(b[0], 0, b[1]),
  }
}

function midpointOfEdge(e: Edge): THREE.Vector3 {
  return new THREE.Vector3((e.a.x + e.b.x) / 2, 0, (e.a.z + e.b.z) / 2)
}

function perpDistanceFromPoint(p: THREE.Vector3, e: Edge): number {
  const dx = e.b.x - e.a.x; const dz = e.b.z - e.a.z
  const len = Math.hypot(dx, dz) + 1e-9
  // Distance from p to line through e.a, e.b
  return Math.abs(dx * (e.a.z - p.z) - (e.a.x - p.x) * dz) / len
}

function addTriangle(
  group: THREE.Group,
  faces: RoofFaceMeta[],
  a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
  baseY: number,
  planeIndex: number,
  kind: 'roof' | 'gable' | 'fill',
): void {
  const geom = new THREE.BufferGeometry()
  const positions = new Float32Array([
    a.x, baseY, a.z,
    b.x, baseY, b.z,
    c.x, c.y,    c.z,
  ])
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.computeVertexNormals()
  geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2))
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.userData.faceKind = kind
  mesh.userData.planeIndex = planeIndex
  group.add(mesh)

  const n = new THREE.Vector3()
  geom.computeBoundingSphere()
  const posAttr = geom.getAttribute('normal')
  if (posAttr) n.fromBufferAttribute(posAttr, 0)
  faces.push({ planeIndex, kind, normal: n })
}

function addQuad(
  group: THREE.Group,
  faces: RoofFaceMeta[],
  bL: THREE.Vector3, bR: THREE.Vector3, tR: THREE.Vector3, tL: THREE.Vector3,
  _baseY: number,
  _topY: number,
  planeIndex: number,
  kind: 'roof' | 'gable' | 'fill',
): void {
  const geom = new THREE.BufferGeometry()
  const positions = new Float32Array([
    bL.x, bL.y, bL.z,
    bR.x, bR.y, bR.z,
    tR.x, tR.y, tR.z,
    bL.x, bL.y, bL.z,
    tR.x, tR.y, tR.z,
    tL.x, tL.y, tL.z,
  ])
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.computeVertexNormals()
  geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,0, 1,0, 1,1, 0,0, 1,1, 0,1]), 2))
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.userData.faceKind = kind
  mesh.userData.planeIndex = planeIndex
  group.add(mesh)

  const n = new THREE.Vector3()
  const normAttr = geom.getAttribute('normal')
  if (normAttr) n.fromBufferAttribute(normAttr, 0)
  faces.push({ planeIndex, kind, normal: n })
}

function addPolygonCap(
  group: THREE.Group,
  faces: RoofFaceMeta[],
  ring: Array<[number, number]>,
  y: number,
  planeIndex: number,
): void {
  // Fan-triangulate from ring[0]
  if (ring.length < 3) return
  const positions: number[] = []
  for (let i = 1; i < ring.length - 1; i++) {
    positions.push(ring[0][0], y, ring[0][1])
    positions.push(ring[i][0], y, ring[i][1])
    positions.push(ring[i + 1][0], y, ring[i + 1][1])
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geom.computeVertexNormals()
  const uvs = new Float32Array(positions.length / 3 * 2)
  for (let i = 0; i < positions.length / 3; i++) {
    uvs[i * 2]     = (positions[i * 3] + 50) / 100
    uvs[i * 2 + 1] = (positions[i * 3 + 2] + 50) / 100
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.userData.faceKind = 'roof'
  mesh.userData.planeIndex = planeIndex
  group.add(mesh)
  faces.push({ planeIndex, kind: 'roof', normal: new THREE.Vector3(0, 1, 0) })
}
