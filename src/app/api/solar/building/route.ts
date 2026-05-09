import { NextRequest, NextResponse } from 'next/server'
import { fetchBuildingInsights } from '@/lib/googleSolarApi'

export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') ?? '')
  const lng = parseFloat(request.nextUrl.searchParams.get('lng') ?? '')

  if (!isFinite(lat) || !isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  try {
    const data = await fetchBuildingInsights(lat, lng)
    if (!data) {
      return NextResponse.json({ error: 'No Solar API data available for this location' }, { status: 404 })
    }
    return NextResponse.json({ data })
  } catch (err) {
    console.error('/api/solar/building error:', err)
    return NextResponse.json({ error: 'Solar building lookup failed' }, { status: 500 })
  }
}
