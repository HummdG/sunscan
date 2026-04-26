import { NextRequest, NextResponse } from 'next/server'
import { fetchBuilding } from '@/lib/osApi'

export async function GET(request: NextRequest) {
  const uprn = request.nextUrl.searchParams.get('uprn') ?? ''
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') ?? '')
  const lng = parseFloat(request.nextUrl.searchParams.get('lng') ?? '')

  if (!uprn) {
    return NextResponse.json({ error: 'uprn is required' }, { status: 400 })
  }

  try {
    const building = await fetchBuilding(
      uprn,
      isFinite(lat) ? lat : undefined,
      isFinite(lng) ? lng : undefined,
    )
    return NextResponse.json({ building })
  } catch (err) {
    console.error('/api/os/building error:', err)
    return NextResponse.json({ error: 'Building lookup failed' }, { status: 500 })
  }
}
