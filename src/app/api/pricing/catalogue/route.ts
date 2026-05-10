import { NextResponse } from 'next/server'
import { loadCatalogue } from '@/lib/pricing/catalogueLoader'

export const revalidate = 300 // 5 minutes — matches in-memory cache TTL

export async function GET() {
  const catalogue = await loadCatalogue()
  return NextResponse.json({ catalogue })
}
