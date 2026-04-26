import { NextRequest, NextResponse } from 'next/server'
import { searchAddresses } from '@/lib/osApi'

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q') ?? ''

  if (q.length < 3) {
    return NextResponse.json({ results: [] })
  }

  try {
    const results = await searchAddresses(q)
    return NextResponse.json({ results })
  } catch (err) {
    console.error('/api/os/address error:', err)
    return NextResponse.json({ results: [], error: 'Address lookup failed' }, { status: 500 })
  }
}
