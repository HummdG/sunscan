import { wgs84ToBng27700 } from '@/lib/geometry'

export interface LidarGrid {
  ndsm: Float32Array
  width: number
  height: number
  bboxBng: [number, number, number, number]
  cellSizeM: number
}

function pointInPolygon(e: number, n: number, polygon: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ei, ni] = polygon[i]
    const [ej, nj] = polygon[j]
    const intersect = ni > n !== nj > n && e < ((ej - ei) * (n - ni)) / (nj - ni) + ei
    if (intersect) inside = !inside
  }
  return inside
}

export function processLidar(
  dsmValues: number[],
  dtmValues: number[] | null,
  width: number,
  height: number,
  bboxBng: [number, number, number, number],
  cellSizeM: number,
  footprintWgs84: [number, number][] | null | undefined,
): LidarGrid {
  const [minE, , , maxN] = bboxBng
  const count = width * height
  const ndsm = new Float32Array(count)

  // EA GeoTIFFs use −9999 as the nodata sentinel. Any pixel at or below this
  // threshold must be treated as missing — subtracting −9999 from a valid DSM
  // elevation would produce a +9999 m spike that breaks the segmenter.
  const NODATA = -100

  let minDsm = Infinity
  if (!dtmValues) {
    for (let i = 0; i < count; i++) {
      const v = dsmValues[i]
      if (v > NODATA && v < minDsm) minDsm = v
    }
  }

  for (let i = 0; i < count; i++) {
    const dsmVal = dsmValues[i]
    if (dsmVal <= NODATA) { ndsm[i] = 0; continue }
    if (dtmValues) {
      const dtmVal = dtmValues[i]
      ndsm[i] = dtmVal <= NODATA ? 0 : dsmVal - dtmVal
    } else {
      ndsm[i] = minDsm < Infinity ? dsmVal - minDsm : 0
    }
  }

  if (footprintWgs84 && footprintWgs84.length >= 3) {
    const footprintBng: [number, number][] = footprintWgs84.map(([lng, lat]) => wgs84ToBng27700(lng, lat))
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const e = minE + (col + 0.5) * cellSizeM
        const n = maxN - (row + 0.5) * cellSizeM
        if (!pointInPolygon(e, n, footprintBng)) {
          ndsm[row * width + col] = 0
        }
      }
    }
  }

  return { ndsm, width, height, bboxBng, cellSizeM }
}
