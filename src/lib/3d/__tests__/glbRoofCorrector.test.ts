import { describe, it, expect } from 'vitest'
import { NodeIO, Document } from '@gltf-transform/core'
import { replaceRoofInGlb } from '@/lib/3d/glbRoofCorrector'

/**
 * Build a fixture GLB that imitates Meshy output: one upward-facing roof
 * triangle plus one vertical wall triangle on a 10×8 m rectangular footprint
 * at eave height 5. Winding chosen so the right-handed cross product yields
 * a +y normal on the roof triangle (a, c, b order).
 */
async function buildFixtureGlb(): Promise<Buffer> {
  const doc = new Document()
  const buf = doc.createBuffer()

  // Triangle 0: roof (all vertices at y=5, normal points up after CCW-from-above winding)
  // Triangle 1: wall (vertical face, normal horizontal)
  const positions = new Float32Array([
    -5, 5, -4,   0, 5,  4,   5, 5, -4,
    -5, 0,  4,   0, 5,  4,   5, 0,  4,
  ])
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5])

  const posAcc = doc.createAccessor('pos').setType('VEC3').setArray(positions).setBuffer(buf)
  const idxAcc = doc.createAccessor('idx').setType('SCALAR').setArray(indices).setBuffer(buf)
  const prim = doc.createPrimitive().setMode(4).setAttribute('POSITION', posAcc).setIndices(idxAcc)
  const mesh = doc.createMesh('main').addPrimitive(prim)
  const node = doc.createNode('main').setMesh(mesh)
  const scene = doc.createScene('main').addChild(node)
  doc.getRoot().setDefaultScene(scene)

  const io = new NodeIO()
  return Buffer.from(await io.writeBinary(doc))
}

function countUpwardTriangles(positions: Float32Array, indices: Uint16Array | Uint32Array | null): number {
  let count = 0
  const triCount = indices ? indices.length / 3 : positions.length / 9
  for (let t = 0; t < triCount; t++) {
    const ia = indices ? indices[t * 3] : t * 3
    const ib = indices ? indices[t * 3 + 1] : t * 3 + 1
    const ic = indices ? indices[t * 3 + 2] : t * 3 + 2
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2]
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2]
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const len = Math.hypot(nx, ny, nz) + 1e-9
    if (ny / len > 0.3) count++
  }
  return count
}

describe('replaceRoofInGlb', () => {
  const footprintLocal: Array<[number, number]> = [
    [-5, -4], [ 5, -4], [ 5,  4], [-5,  4],
  ]
  const eaveHeightM = 5

  it('replaces the original roof faces with a new procedural roof', async () => {
    const fixture = await buildFixtureGlb()
    const segments = [
      { pitchDeg: 35, azimuthDeg: 180, areaM2: 22, centerX: 0, centerZ: -2 },
      { pitchDeg: 35, azimuthDeg: 0,   areaM2: 22, centerX: 0, centerZ:  2 },
    ]

    const { glb, replaced } = await replaceRoofInGlb(fixture, segments, footprintLocal, eaveHeightM)
    expect(replaced).toBe(true)

    const io = new NodeIO()
    const doc = await io.readBinary(new Uint8Array(glb))

    let upwardCount = 0
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const positionsAcc = prim.getAttribute('POSITION')
        if (!positionsAcc) continue
        const positions = positionsAcc.getArray() as Float32Array
        const indexAcc = prim.getIndices()
        const indices = (indexAcc?.getArray() as Uint16Array | Uint32Array | undefined) ?? null
        upwardCount += countUpwardTriangles(positions, indices)
      }
    }
    expect(upwardCount).toBeGreaterThan(0)
  })

  it('returns the raw GLB unmodified when no roof faces are found', async () => {
    // Build a single non-upward triangle
    const doc = new Document()
    const buf = doc.createBuffer()
    const positions = new Float32Array([
      -5, 0, 0,   5, 0, 0,   0, 5, 0,  // vertical, normal in +/-z
    ])
    const idx = new Uint32Array([0, 1, 2])
    const posAcc = doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buf)
    const idxAcc = doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf)
    const prim = doc.createPrimitive().setMode(4).setAttribute('POSITION', posAcc).setIndices(idxAcc)
    doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)))
    const io = new NodeIO()
    const fixture = Buffer.from(await io.writeBinary(doc))

    const { glb, replaced } = await replaceRoofInGlb(
      fixture,
      [{ pitchDeg: 35, azimuthDeg: 0, areaM2: 10, centerX: 0, centerZ: 0 }],
      footprintLocal,
      eaveHeightM,
    )
    expect(replaced).toBe(false)
    expect(glb).toBe(fixture)
  })

  it('falls back gracefully on malformed GLB input', async () => {
    const garbage = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00])
    const { glb, replaced } = await replaceRoofInGlb(
      garbage,
      [{ pitchDeg: 35, azimuthDeg: 0, areaM2: 10, centerX: 0, centerZ: 0 }],
      footprintLocal,
      eaveHeightM,
    )
    expect(replaced).toBe(false)
    expect(glb).toBe(garbage)
  })
})
