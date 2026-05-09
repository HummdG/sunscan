import type { GoogleSolarRoofSegment, LatLng } from '@/lib/types'
import type { LocalRoofSegment } from '@/types/solar'
import { latLngToLocal, bboxToLocal } from './coordinateConverter'

export function buildLocalSegment(
  seg: GoogleSolarRoofSegment,
  buildingCenter: LatLng,
  heightOffset: number,
  segmentIndex: number,
): LocalRoofSegment {
  const center = latLngToLocal(seg.center, buildingCenter)
  const heightAtCenterM = seg.planeHeightAtCenterMeters + heightOffset

  const azRad = (seg.azimuthDegrees * Math.PI) / 180
  // Downhill direction in XZ (+z = south)
  const faceX =  Math.sin(azRad)
  const faceZ = -Math.cos(azRad)
  // Along-ridge direction in XZ
  const ridgeX = Math.cos(azRad)
  const ridgeZ =  Math.sin(azRad)

  const bbox = bboxToLocal(seg.boundingBox.sw, seg.boundingBox.ne, buildingCenter)

  // Project all 4 bbox corners onto face/ridge directions to derive dimensions
  const corners = [
    { x: bbox.minX, z: bbox.maxZ }, // SW
    { x: bbox.maxX, z: bbox.minZ }, // NE
    { x: bbox.maxX, z: bbox.maxZ }, // SE
    { x: bbox.minX, z: bbox.minZ }, // NW
  ]
  const ridgeProjs = corners.map(c => c.x * ridgeX + c.z * ridgeZ)
  const faceProjs  = corners.map(c => c.x * faceX  + c.z * faceZ)

  const ridgeLenM    = Math.max(1.0, Math.max(...ridgeProjs) - Math.min(...ridgeProjs))
  const groundDepthM = Math.max(1.0, Math.max(...faceProjs)  - Math.min(...faceProjs))

  return {
    segmentIndex,
    azimuthDeg: seg.azimuthDegrees,
    pitchDeg: seg.pitchDegrees,
    heightAtCenterM,
    areaM2: seg.stats.areaMeters2,
    sunshineQuantiles: seg.stats.sunshineQuantiles ?? [],
    center,
    ridgeLenM,
    groundDepthM,
  }
}
