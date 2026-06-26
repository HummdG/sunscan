import { NextResponse } from 'next/server'
import { loadCatalogue } from '@/lib/pricing/catalogueLoader'

// DB-backed: must not be prerendered at build (no DB reachable then). Rendered
// on demand; `loadCatalogue` keeps its own 5-minute in-memory cache per tenant.
export const dynamic = 'force-dynamic'

export async function GET() {
  const catalogue = await loadCatalogue()
  return NextResponse.json({ catalogue })
}
