import * as THREE from 'three'

export interface WallFaceMeta {
  edgeIndex: number
  /** Wall start in local x/z (y=0) */
  start: THREE.Vector3
  /** Wall end in local x/z (y=0) */
  end: THREE.Vector3
  /** Outward-pointing unit normal (horizontal) */
  normal: THREE.Vector3
  /** Length of the wall in metres */
  lengthM: number
}

export interface WallBuildResult {
  group: THREE.Group
  faces: WallFaceMeta[]
}

/**
 * Extrude a closed footprint ring upward to `eaveHeightM`. One quad per edge.
 * Footprint ring assumed in CCW order (which is what wgs84ToLocalMetres
 * produces when the WGS84 polygon is CCW). For CW rings, outward normals
 * flip — we detect winding by signed area and orient normals outward.
 *
 *   ring index:    [0]──edge 0──[1]──edge 1──[2]──edge 2──[3]──edge 3──[0]
 *   wall index:           0            1            2            3
 *   outward:    perpendicular to (end - start), pointing away from centroid
 */
export function buildWalls(
  ring: Array<[number, number]>,
  eaveHeightM: number,
): WallBuildResult {
  const group = new THREE.Group()
  group.name = 'walls'
  const faces: WallFaceMeta[] = []

  const n = ring.length
  if (n < 3) return { group, faces }

  // Centroid for outward-normal orientation
  let cx = 0, cz = 0
  for (const [x, z] of ring) { cx += x; cz += z }
  cx /= n; cz /= n

  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i]
    const [x1, z1] = ring[(i + 1) % n]
    const dx = x1 - x0
    const dz = z1 - z0
    const lengthM = Math.hypot(dx, dz)
    if (lengthM < 0.01) continue

    // Two candidate normals; pick the one pointing away from centroid
    const nA = new THREE.Vector3(-dz, 0,  dx).normalize()
    const nB = new THREE.Vector3( dz, 0, -dx).normalize()
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    const towardCentroid = new THREE.Vector3(cx - mx, 0, cz - mz)
    const outward = nA.dot(towardCentroid) < 0 ? nA : nB

    // Quad vertices (two triangles): bottom-left, bottom-right, top-right, top-left
    const v0 = new THREE.Vector3(x0, 0, z0)
    const v1 = new THREE.Vector3(x1, 0, z1)
    const v2 = new THREE.Vector3(x1, eaveHeightM, z1)
    const v3 = new THREE.Vector3(x0, eaveHeightM, z0)

    const geom = new THREE.BufferGeometry()
    const positions = new Float32Array([
      v0.x, v0.y, v0.z,
      v1.x, v1.y, v1.z,
      v2.x, v2.y, v2.z,
      v0.x, v0.y, v0.z,
      v2.x, v2.y, v2.z,
      v3.x, v3.y, v3.z,
    ])
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const normals = new Float32Array(positions.length)
    for (let k = 0; k < 6; k++) {
      normals[k * 3]     = outward.x
      normals[k * 3 + 1] = outward.y
      normals[k * 3 + 2] = outward.z
    }
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    // Stretched [0,1] UVs across the wall
    const uvs = new Float32Array([0, 0,  1, 0,  1, 1,  0, 0,  1, 1,  0, 1])
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.userData.faceKind = 'wall'
    mesh.userData.edgeIndex = i
    group.add(mesh)

    faces.push({
      edgeIndex: i,
      start: v0,
      end: v1,
      normal: outward,
      lengthM,
    })
  }

  return { group, faces }
}
