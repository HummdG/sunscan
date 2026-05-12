import * as THREE from 'three'

/**
 * Close small geometry holes by triangulating boundary loops.
 *
 * Algorithm:
 *  1. Build an edge → triangle-count map from the mesh's indices (or implicit
 *     indices if the mesh is non-indexed).
 *  2. Edges referenced by exactly 1 triangle are boundary edges.
 *  3. Walk the half-edge graph to group boundary edges into closed loops.
 *  4. For each loop with ≤ `maxHoleEdges` vertices, fan-triangulate from the
 *     loop centroid. Larger loops are left untouched — they represent missing
 *     structural elements that we shouldn't invent.
 *
 * Returns a new `BufferGeometry` with added vertices/indices. Groups are
 * cleared because the patch triangles don't belong to any source material.
 */
export function fillSmallHoles(geometry: THREE.BufferGeometry, maxHoleEdges = 30): THREE.BufferGeometry {
  // Work on a non-indexed snapshot for easier triangle iteration, then we
  // rebuild a clean indexed geometry at the end.
  const src = geometry.index ? geometry : geometry.clone()
  if (!src.index) {
    // Synthesise an index buffer matching the non-indexed layout
    const pos = src.getAttribute('position') as THREE.BufferAttribute
    const idx = new Uint32Array(pos.count)
    for (let i = 0; i < pos.count; i++) idx[i] = i
    src.setIndex(new THREE.BufferAttribute(idx, 1))
  }

  const posAttr = src.getAttribute('position') as THREE.BufferAttribute
  const idxAttr = src.getIndex()!
  const triCount = idxAttr.count / 3

  // Build edge → triangles map. Key is `min(a,b) * 1e8 + max(a,b)`; with
  // typical mesh sizes (≪ 1e8 vertices) the encoding is unambiguous.
  const edgeMap = new Map<number, number[]>()
  const key = (a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b)
    return lo * 1e8 + hi
  }
  for (let t = 0; t < triCount; t++) {
    const a = idxAttr.getX(t * 3 + 0)
    const b = idxAttr.getX(t * 3 + 1)
    const c = idxAttr.getX(t * 3 + 2)
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const k = key(x, y)
      const arr = edgeMap.get(k)
      if (arr) arr.push(t)
      else edgeMap.set(k, [t])
    }
  }

  // Boundary edges = edges with exactly 1 incident triangle. Store as
  // directed edges using the triangle's winding (so loops can be walked).
  const boundaryNext = new Map<number, number>()  // vertexA → vertexB along boundary
  for (let t = 0; t < triCount; t++) {
    const a = idxAttr.getX(t * 3 + 0)
    const b = idxAttr.getX(t * 3 + 1)
    const c = idxAttr.getX(t * 3 + 2)
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      if ((edgeMap.get(key(x, y)) ?? []).length === 1) {
        boundaryNext.set(x, y)
      }
    }
  }

  // Walk boundary loops.
  const visited = new Set<number>()
  const loops: number[][] = []
  for (const startVertex of boundaryNext.keys()) {
    if (visited.has(startVertex)) continue
    const loop: number[] = []
    let cur = startVertex
    while (!visited.has(cur)) {
      visited.add(cur)
      loop.push(cur)
      const next = boundaryNext.get(cur)
      if (next === undefined) break
      cur = next
      if (cur === startVertex) break  // closed loop
    }
    if (loop.length >= 3) loops.push(loop)
  }

  // Filter and triangulate.
  const newPositions: number[] = []
  const newIndices: number[] = []
  const baseVertexCount = posAttr.count
  let nextNewVertexId = baseVertexCount

  const vTmp = new THREE.Vector3()
  for (const loop of loops) {
    if (loop.length > maxHoleEdges) continue

    // Centroid of the loop
    const centroid = new THREE.Vector3()
    for (const v of loop) {
      vTmp.fromBufferAttribute(posAttr, v)
      centroid.add(vTmp)
    }
    centroid.multiplyScalar(1 / loop.length)
    const centroidId = nextNewVertexId++
    newPositions.push(centroid.x, centroid.y, centroid.z)

    // Fan-triangulate. Winding follows the boundary direction so the patch's
    // normal points outward from the existing surface.
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]
      const b = loop[(i + 1) % loop.length]
      newIndices.push(a, b, centroidId)
    }
  }

  if (newIndices.length === 0) {
    // Nothing to patch — return as-is.
    return geometry
  }

  // Rebuild geometry: copy original positions/normals, append new positions,
  // append new indices. Drop original groups (mixed material assignment
  // doesn't apply to patch triangles).
  const finalPos = new Float32Array(baseVertexCount * 3 + newPositions.length)
  for (let i = 0; i < baseVertexCount; i++) {
    finalPos[i * 3 + 0] = posAttr.getX(i)
    finalPos[i * 3 + 1] = posAttr.getY(i)
    finalPos[i * 3 + 2] = posAttr.getZ(i)
  }
  finalPos.set(newPositions, baseVertexCount * 3)

  const finalIndex = new Uint32Array(idxAttr.count + newIndices.length)
  for (let i = 0; i < idxAttr.count; i++) finalIndex[i] = idxAttr.getX(i)
  for (let i = 0; i < newIndices.length; i++) finalIndex[idxAttr.count + i] = newIndices[i]

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(finalPos, 3))
  out.setIndex(new THREE.BufferAttribute(finalIndex, 1))
  out.computeVertexNormals()
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}
