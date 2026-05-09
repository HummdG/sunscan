import { NextRequest, NextResponse } from 'next/server'
import { fetchDataLayers } from '@/lib/googleSolarApi'

export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') ?? '')
  const lng = parseFloat(request.nextUrl.searchParams.get('lng') ?? '')
  const radius = parseFloat(request.nextUrl.searchParams.get('radius') ?? '50')

  if (!isFinite(lat) || !isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  try {
    const data = await fetchDataLayers(lat, lng, isFinite(radius) ? radius : 50)
    if (!data) {
      return NextResponse.json({ data: null })
    }
    return NextResponse.json({ data })
  } catch (err) {
    console.error('/api/solar/datalayers error:', err)
    return NextResponse.json({ error: 'Data layers lookup failed' }, { status: 500 })
  }
}
