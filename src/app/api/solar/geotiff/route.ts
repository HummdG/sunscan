import { NextRequest, NextResponse } from 'next/server'
import { fetchGeoTiffBuffer } from '@/lib/googleSolarApi'

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  try {
    const buffer = await fetchGeoTiffBuffer(id)
    if (!buffer) {
      return NextResponse.json({ error: 'GeoTIFF not available' }, { status: 404 })
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/tiff',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    console.error('/api/solar/geotiff error:', err)
    return NextResponse.json({ error: 'GeoTIFF fetch failed' }, { status: 500 })
  }
}
