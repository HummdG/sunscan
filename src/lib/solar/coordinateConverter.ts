import { wgs84ToLocalMetres } from '@/lib/geometry'
import type { LatLng } from '@/lib/types'

export function latLngToLocal(
  point: LatLng,
  centre: LatLng,
): { x: number; z: number } {
  const [[x, z]] = wgs84ToLocalMetres(
    [[point.longitude, point.latitude]],
    [centre.longitude, centre.latitude],
  )
  return { x, z }
}

export function bboxToLocal(
  sw: LatLng,
  ne: LatLng,
  centre: LatLng,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const swLocal = latLngToLocal(sw, centre)
  const neLocal = latLngToLocal(ne, centre)
  return {
    minX: Math.min(swLocal.x, neLocal.x),
    maxX: Math.max(swLocal.x, neLocal.x),
    minZ: Math.min(swLocal.z, neLocal.z),
    maxZ: Math.max(swLocal.z, neLocal.z),
  }
}
