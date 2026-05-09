import { wgs84ToBng27700 } from '@/lib/geometry'
import type { LidarGrid } from './lidarProcessor'
import type { LidarRoofPlane } from '@/types/solar'

interface PixelData {
  row: number
  col: number
  pitchDeg: number
  azimuthDeg: number
  height: number
}

function weightedCircularMean(angles: number[], weights: number[]): number {
  let sx = 0, cx = 0
  for (let i = 0; i < angles.length; i++) {
    const rad = (angles[i] * Math.PI) / 180
    sx += weights[i] * Math.sin(rad)
    cx += weights[i] * Math.cos(rad)
  }
  return ((Math.atan2(sx, cx) * 180 / Math.PI) + 360) % 360
}

function circularDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

export function segmentRoofPlanes(
  grid: LidarGrid,
  buildingCentroidWgs84: [number, number],
  minAreaM2 = 2.0,
): LidarRoofPlane[] {
  const { ndsm, width, height, bboxBng, cellSizeM } = grid
  const [minE, , , maxN] = bboxBng
  const [centLng, centLat] = buildingCentroidWgs84
  const [centreE, centreN] = wgs84ToBng27700(centLng, centLat)

  // Pass 1: compute pitch and facing azimuth per interior pixel
  const pixels: PixelData[] = []
  for (let row = 1; row < height - 1; row++) {
    for (let col = 1; col < width - 1; col++) {
      const h = ndsm[row * width + col]
      if (h < 0.5) continue

      // Finite differences — eastward and northward height gradients
      const dhDx = (ndsm[row * width + col + 1] - ndsm[row * width + col - 1]) / 2
      const dhDn = (ndsm[(row - 1) * width + col] - ndsm[(row + 1) * width + col]) / 2

      const gradMag = Math.sqrt(dhDx * dhDx + dhDn * dhDn)
      const pitchDeg = Math.atan(gradMag) * 180 / Math.PI
      if (gradMag < 0.01 || pitchDeg > 70) continue

      // Facing direction = downhill = uphill rotated 180°
      const uphillRad = Math.atan2(dhDx, dhDn)
      const azimuthDeg = ((uphillRad * 180 / Math.PI) + 180 + 360) % 360

      pixels.push({ row, col, pitchDeg, azimuthDeg, height: h })
    }
  }

  if (pixels.length === 0) return []

  // Pass 2: bin by nearest 10° then merge bins within ±20°
  const bins = new Map<number, PixelData[]>()
  for (const px of pixels) {
    const bin = (Math.round(px.azimuthDeg / 10) * 10) % 360
    if (!bins.has(bin)) bins.set(bin, [])
    bins.get(bin)!.push(px)
  }

  const sortedBins = [...bins.entries()].sort((a, b) => b[1].length - a[1].length)
  const used = new Set<number>()
  const clusters: PixelData[][] = []

  for (const [binAngle, binPixels] of sortedBins) {
    if (used.has(binAngle)) continue
    const cluster = [...binPixels]
    used.add(binAngle)

    for (const [other, otherPixels] of bins) {
      if (used.has(other)) continue
      if (circularDiff(other, binAngle) <= 20) {
        cluster.push(...otherPixels)
        used.add(other)
      }
    }
    clusters.push(cluster)
  }

  // Pass 3: build an oriented bounding rectangle per cluster
  const planes: LidarRoofPlane[] = []

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci]
    const areaM2 = cluster.length * cellSizeM * cellSizeM
    if (areaM2 < minAreaM2) continue

    const meanAz = weightedCircularMean(
      cluster.map(p => p.azimuthDeg),
      cluster.map(() => 1),
    )
    const meanPitch = cluster.reduce((s, p) => s + p.pitchDeg, 0) / cluster.length
    const meanH     = cluster.reduce((s, p) => s + p.height, 0)   / cluster.length

    // Convert pixels to local metres: x = east offset, z = south offset
    const localPts: [number, number][] = cluster.map(({ row, col }) => {
      const e = minE + (col + 0.5) * cellSizeM
      const n = maxN - (row + 0.5) * cellSizeM
      return [e - centreE, centreN - n]
    })

    // Pixel centroid — this is the point where heightM actually applies.
    // Using the OBR geometric centre would mismatch because cluster pixels
    // are denser near the eave (ridge-adjacent pixels get filtered by gradMag).
    const pixelCentroidX = localPts.reduce((s, [x]) => s + x, 0) / localPts.length
    const pixelCentroidZ = localPts.reduce((s, [, z]) => s + z, 0) / localPts.length

    // Rotate by -azimuthRad so ridge direction aligns with +x axis
    const azRad = (meanAz * Math.PI) / 180
    const cosA = Math.cos(-azRad)
    const sinA = Math.sin(-azRad)

    let minRidge = Infinity, maxRidge = -Infinity
    let minFace  = Infinity, maxFace  = -Infinity

    for (const [x, z] of localPts) {
      const rx = x * cosA - z * sinA
      const rz = x * sinA + z * cosA
      if (rx < minRidge) minRidge = rx
      if (rx > maxRidge) maxRidge = rx
      if (rz < minFace)  minFace  = rz
      if (rz > maxFace)  maxFace  = rz
    }

    // Rotate 4 OBR corners back to local space
    const cosB = Math.cos(azRad)
    const sinB = Math.sin(azRad)
    const obrCorners: [number, number][] = [
      [minRidge, minFace],
      [maxRidge, minFace],
      [maxRidge, maxFace],
      [minRidge, maxFace],
    ].map(([rx, rz]): [number, number] => [
      rx * cosB - rz * sinB,
      rx * sinB + rz * cosB,
    ])

    const polygon: [number, number][] = [...obrCorners, obrCorners[0]]

    planes.push({
      id: `lidar-${ci}`,
      pitchDegrees: meanPitch,
      azimuthDegrees: meanAz,
      heightM: meanH,
      polygon,
      areaM2,
      source: 'lidar',
      refX: pixelCentroidX,
      refZ: pixelCentroidZ,
    })
  }

  return planes
}
