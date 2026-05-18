import * as THREE from 'three'
import { wgs84ToLocalMetres } from '@/lib/geometry'

export interface FootprintPrism {
  contains(p: THREE.Vector3): boolean
  bbox: THREE.Box3
  /** Local-metre polygon ring used to build this prism (x = east, z = south, Three.js convention) */
  ring: [number, number][]
  /** Vertical extent of the prism */
  minY: number
  maxY: number
}

/**
 * Build a vertical prism from a WGS84 polygon ring. Returns containment test in
 * Three.js local-metre frame anchored on `centre` (lng, lat).
 *
 * minY/maxY are absolute world-space y values (metres) — use a generous range
 * (e.g. -10 to +40 above eave height) so we don't accidentally clip the roof.
 */
export function buildFootprintPrism(
  polygon: [number, number][],
  centre: [number, number],
  minY: number,
  maxY: number,
  paddingM = 0.5,
): FootprintPrism {
  const local = wgs84ToLocalMetres(polygon, centre)

  // Compute centroid for outward padding
  const cx = local.reduce((s, [x]) => s + x, 0) / local.length
  const cz = local.reduce((s, [, z]) => s + z, 0) / local.length

  const padded: [number, number][] = local.map(([x, z]) => {
    const dx = x - cx
    const dz = z - cz
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) return [x, z]
    return [x + (dx / len) * paddingM, z + (dz / len) * paddingM]
  })

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of padded) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  const bbox = new THREE.Box3(
    new THREE.Vector3(minX, minY, minZ),
    new THREE.Vector3(maxX, maxY, maxZ),
  )

  return {
    ring: padded,
    minY,
    maxY,
    bbox,
    contains(p: THREE.Vector3) {
      if (p.y < minY || p.y > maxY) return false
      if (p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ) return false
      return pointInRing(p.x, p.z, padded)
    },
  }
}

function pointInRing(x: number, z: number, ring: [number, number][]): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = ring[i]
    const [xj, zj] = ring[j]
    const intersects = (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi
    if (intersects) inside = !inside
  }
  return inside
}
