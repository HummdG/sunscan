import { NextRequest, NextResponse } from 'next/server'
import { wgs84ToBng27700 } from '@/lib/geometry'

// EA WCS 2.0.1 — geoservices endpoints (stable UUID-based URLs from GetCapabilities)
const DSM_WCS = 'https://environment.data.gov.uk/geoservices/datasets/df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb/wcs'
const DTM_WCS = 'https://environment.data.gov.uk/geoservices/datasets/13787b9a-26a4-4775-8523-806d13af58fc/wcs'

// Coverage IDs — from GetCapabilities (verified 2026-05-06)
const DSM_COVERAGE = 'df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m'
const DTM_COVERAGE = '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'

// Half-width of the clip area in metres. 40m each side = 80×80m window (covers any UK detached)
const HALF_M = 40

function buildWcsUrl(base: string, coverageId: string, minE: number, minN: number, maxE: number, maxN: number): string {
  // WCS 2.0.1 requires duplicate SUBSET params — must NOT use URLSearchParams.
  // Axis labels for EA EPSG:27700 coverages are "E" and "N" (not "X"/"Y").
  return (
    base +
    '?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage' +
    `&COVERAGEID=${coverageId}` +
    '&FORMAT=image/tiff' +
    `&SUBSET=E(${minE},${maxE})` +
    `&SUBSET=N(${minN},${maxN})`
  )
}

export async function POST(req: NextRequest) {
  try {
    const { lat, lng } = await req.json()

    const [centreE, centreN] = wgs84ToBng27700(lng, lat)
    const minE = centreE - HALF_M
    const maxE = centreE + HALF_M
    const minN = centreN - HALF_M
    const maxN = centreN + HALF_M

    const dsmUrl = buildWcsUrl(DSM_WCS, DSM_COVERAGE, minE, minN, maxE, maxN)
    const dtmUrl = buildWcsUrl(DTM_WCS, DTM_COVERAGE, minE, minN, maxE, maxN)

    const [dsmRes, dtmRes] = await Promise.all([
      fetch(dsmUrl, { headers: { Accept: 'image/tiff' } }),
      fetch(dtmUrl, { headers: { Accept: 'image/tiff' } }),
    ])

    if (!dsmRes.ok) {
      console.warn(`EA DSM WCS returned ${dsmRes.status} for BNG (${minE},${minN},${maxE},${maxN})`)
      return NextResponse.json({ available: false })
    }

    // Check response is actually a GeoTIFF (not an XML error document)
    const contentType = dsmRes.headers.get('content-type') ?? ''
    if (contentType.includes('xml') || contentType.includes('text')) {
      return NextResponse.json({ available: false })
    }

    const { fromArrayBuffer } = await import('geotiff')

    async function decodeTiff(res: Response): Promise<{ values: number[]; width: number; height: number; bbox: [number, number, number, number] } | null> {
      try {
        const buf = await res.arrayBuffer()
        const tiff = await fromArrayBuffer(buf)
        const image = await tiff.getImage()
        const width = image.getWidth()
        const height = image.getHeight()
        const bbox = image.getBoundingBox() as [number, number, number, number]
        const rasters = await image.readRasters({ interleave: false }) as unknown as [Float32Array]
        return { values: Array.from(rasters[0]), width, height, bbox }
      } catch {
        return null
      }
    }

    const dsm = await decodeTiff(dsmRes)
    if (!dsm) return NextResponse.json({ available: false })

    const dtm = dtmRes.ok ? await decodeTiff(dtmRes) : null

    return NextResponse.json({
      available: true,
      dsmValues: dsm.values,
      dtmValues: dtm?.values ?? null,
      width: dsm.width,
      height: dsm.height,
      // bbox from GeoTIFF is [minX, minY, maxX, maxY] = [minE, minN, maxE, maxN] in BNG
      bboxBng: dsm.bbox,
      cellSizeM: 1.0,
    })
  } catch (err) {
    console.error('LiDAR route error', err)
    return NextResponse.json({ available: false })
  }
}
