import * as THREE from 'three'

const ROOF_TILE_COLOR = 0x7a5a3a  // overridden by spec materials at the call site

/**
 * Rotate `mesh` around +Y so its local X-axis aligns with `wallDir`.
 * Three.js Y-rotation by θ maps (1,0,0) → (cos θ, 0, -sin θ),
 * so for wallDir = (cos α, 0, sin α) we need θ = -α = -atan2(wallDir.z, wallDir.x).
 */
function alignWithWallDir(mesh: THREE.Object3D, wallDir: THREE.Vector3): void {
  const angle = -Math.atan2(wallDir.z, wallDir.x)
  mesh.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
}

export interface ChimneyInput {
  x: number; z: number
  widthM: number; depthM: number; heightAboveRoofM: number
  roofTopY: number
}

export function buildChimney(opts: ChimneyInput): THREE.Mesh {
  const geom = new THREE.BoxGeometry(opts.widthM, opts.heightAboveRoofM, opts.depthM)
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.set(opts.x, opts.roofTopY + opts.heightAboveRoofM / 2, opts.z)
  mesh.userData.featureKind = 'chimney'
  return mesh
}

export interface DormerInput {
  wallStart: THREE.Vector3        // y can be 0 — only x/z used
  wallEnd: THREE.Vector3
  offsetAlongEdgeM: number
  widthM: number; heightM: number; projectionM: number
  eaveHeightM: number
  roofType: 'gable' | 'hip' | 'flat'
}

export function buildDormer(opts: DormerInput): THREE.Group {
  const group = new THREE.Group()
  group.userData.featureKind = 'dormer'

  const wallVec = new THREE.Vector3().subVectors(opts.wallEnd, opts.wallStart)
  const wallLen = wallVec.length()
  if (wallLen < 0.01) return group  // degenerate
  const wallDir = wallVec.clone().normalize()
  // Outward normal: rotate wallDir 90° clockwise around +y (matches the
  // footprint winding used by specWalls.ts; will be re-projected if needed)
  const outward = new THREE.Vector3(-wallDir.z, 0, wallDir.x)

  const centreAlong = Math.min(Math.max(opts.offsetAlongEdgeM + opts.widthM / 2, opts.widthM / 2), wallLen - opts.widthM / 2)
  const baseY = opts.eaveHeightM - opts.heightM
  const centre = opts.wallStart.clone()
    .addScaledVector(wallDir, centreAlong)
    .addScaledVector(outward, opts.projectionM / 2)
  centre.y = baseY + opts.heightM / 2

  // Box body
  const body = new THREE.BoxGeometry(opts.widthM, opts.heightM, opts.projectionM)
  const bodyMesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color: 0xcccccc }))
  bodyMesh.position.copy(centre)
  alignWithWallDir(bodyMesh, wallDir)
  group.add(bodyMesh)

  // Dormer roof cone: radius = max(width, projection)/2 × √2 so the 4-segment
  // cone's bounding box equals the larger of widthM / projectionM exactly.
  if (opts.roofType !== 'flat') {
    const coneH = Math.max(0.5, Math.max(opts.widthM, opts.projectionM) * 0.25)
    const roof = new THREE.ConeGeometry(Math.max(opts.widthM, opts.projectionM) * 0.5 * Math.SQRT2, coneH, 4, 1, false, Math.PI / 4)
    const roofMesh = new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ color: ROOF_TILE_COLOR }))
    roofMesh.position.set(centre.x, baseY + opts.heightM + coneH / 2, centre.z)
    alignWithWallDir(roofMesh, wallDir)
    group.add(roofMesh)
  }

  return group
}

export interface ConservatoryInput {
  wallStart: THREE.Vector3
  wallEnd: THREE.Vector3
  offsetAlongEdgeM: number
  widthM: number; depthM: number; heightM: number
}

export function buildConservatory(opts: ConservatoryInput): THREE.Group {
  const group = new THREE.Group()
  group.userData.featureKind = 'conservatory'

  const wallVec = new THREE.Vector3().subVectors(opts.wallEnd, opts.wallStart)
  const wallLen = wallVec.length()
  if (wallLen < 0.01) return group
  const wallDir = wallVec.clone().normalize()
  const outward = new THREE.Vector3(-wallDir.z, 0, wallDir.x)

  const centreAlong = Math.min(Math.max(opts.offsetAlongEdgeM + opts.widthM / 2, opts.widthM / 2), wallLen - opts.widthM / 2)
  const centre = opts.wallStart.clone()
    .addScaledVector(wallDir, centreAlong)
    .addScaledVector(outward, opts.depthM / 2)
  centre.y = opts.heightM / 2

  const geom = new THREE.BoxGeometry(opts.widthM, opts.heightM, opts.depthM)
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf2f6,
    transmission: 0.7,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.5,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.copy(centre)
  alignWithWallDir(mesh, wallDir)
  group.add(mesh)

  return group
}

export interface GarageInput {
  wallStart: THREE.Vector3
  wallEnd: THREE.Vector3
  offsetAlongEdgeM: number
  widthM: number; depthM: number; heightM: number
  attachment: 'attached' | 'detached'
}

export function buildGarage(opts: GarageInput): THREE.Group {
  const group = new THREE.Group()
  group.userData.featureKind = 'garage'

  const wallVec = new THREE.Vector3().subVectors(opts.wallEnd, opts.wallStart)
  const wallLen = wallVec.length()
  if (wallLen < 0.01) return group
  const wallDir = wallVec.clone().normalize()
  const outward = new THREE.Vector3(-wallDir.z, 0, wallDir.x)

  const detachGap = opts.attachment === 'detached' ? 0.5 : 0
  const centreAlong = Math.min(Math.max(opts.offsetAlongEdgeM + opts.widthM / 2, opts.widthM / 2), wallLen - opts.widthM / 2)
  const centre = opts.wallStart.clone()
    .addScaledVector(wallDir, centreAlong)
    .addScaledVector(outward, opts.depthM / 2 + detachGap)
  centre.y = opts.heightM / 2

  const geom = new THREE.BoxGeometry(opts.widthM, opts.heightM, opts.depthM)
  const mat = new THREE.MeshStandardMaterial({ color: 0xb0a89a })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.copy(centre)
  alignWithWallDir(mesh, wallDir)
  group.add(mesh)

  return group
}
