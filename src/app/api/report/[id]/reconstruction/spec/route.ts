import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { generateBuildingSpec, FALLBACK_SPEC } from '@/lib/ai/buildingSpecAgent'

export const maxDuration = 60
export const runtime = 'nodejs'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024  // 8 MB per photo

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

/**
 * Generate a BuildingSpec from 3 cardinal photos + footprint + Solar segments
 * via Claude Sonnet 4.6. Caches by SHA-256 of the inputs in Supabase Storage
 * under sunscan-reports/specs/{cacheKey}.json — same address → free cache hit.
 *
 * Multipart body:
 *   • front, right, back  — PNG blobs
 *   • footprint           — JSON [[lng, lat], ...]
 *   • roofSegments        — JSON [{ pitchDeg, azimuthDeg, areaM2, centerLng, centerLat }, ...] or []
 *   • eaveHeightM         — number
 *   • dimensionsM         — JSON { x, y, z }
 *
 * Returns: { spec: BuildingSpec, cached: boolean, source: 'agent'|'fallback' }
 */
export async function POST(
  req: NextRequest,
  { params: _params }: { params: Promise<{ id: string }> },
) {
  // `id` is reserved for cache scoping per-report if we later want to allow
  // user-supplied corrections to invalidate; today the cache key is purely
  // input-content-hashed.
  await _params

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Missing multipart body' }, { status: 400 })
  }

  const front = formData.get('front')
  const right = formData.get('right')
  const back = formData.get('back')
  if (!(front instanceof Blob) || !(right instanceof Blob) || !(back instanceof Blob)) {
    return NextResponse.json({ error: 'Need front, right and back PNG blobs' }, { status: 400 })
  }
  for (const f of [front, right, back]) {
    if (f.size === 0) return NextResponse.json({ error: 'Empty image blob' }, { status: 400 })
    if (f.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'Image too large' }, { status: 413 })
  }

  let footprint: Array<[number, number]>
  let roofSegments: Array<{ pitchDeg: number; azimuthDeg: number; areaM2: number; centerLng: number; centerLat: number }>
  let dimensionsM: { x: number; y: number; z: number }
  let eaveHeightM: number
  try {
    footprint = JSON.parse(formData.get('footprint') as string)
    roofSegments = JSON.parse(formData.get('roofSegments') as string)
    dimensionsM = JSON.parse(formData.get('dimensionsM') as string)
    eaveHeightM = parseFloat(formData.get('eaveHeightM') as string)
    if (!Array.isArray(footprint) || footprint.length < 3) throw new Error('footprint must be a ring of ≥3 points')
    if (!Array.isArray(roofSegments)) throw new Error('roofSegments must be an array')
    if (!Number.isFinite(eaveHeightM) || eaveHeightM <= 0) throw new Error('eaveHeightM must be positive')
  } catch (e) {
    return NextResponse.json({ error: `Bad input: ${(e as Error).message}` }, { status: 400 })
  }

  // Read photo bytes
  const [frontBuf, rightBuf, backBuf] = await Promise.all([
    front.arrayBuffer(), right.arrayBuffer(), back.arrayBuffer(),
  ])

  // Cache key
  const hash = createHash('sha256')
  hash.update(JSON.stringify(footprint))
  hash.update(JSON.stringify(roofSegments))
  hash.update(String(eaveHeightM))
  hash.update(JSON.stringify(dimensionsM))
  hash.update(Buffer.from(frontBuf))
  hash.update(Buffer.from(rightBuf))
  hash.update(Buffer.from(backBuf))
  const cacheKey = hash.digest('hex')
  const cachePath = `specs/${cacheKey}.json`

  const supabase = getSupabaseAdmin()

  // Try cache
  if (supabase) {
    try {
      const { data } = await supabase.storage.from('sunscan-reports').download(cachePath)
      if (data) {
        const text = await data.text()
        const spec = JSON.parse(text)
        return NextResponse.json({ spec, cached: true, source: 'agent' })
      }
    } catch {
      // miss — fall through
    }
  }

  // Run agent
  const result = await generateBuildingSpec({
    photos: {
      front: Buffer.from(frontBuf).toString('base64'),
      right: Buffer.from(rightBuf).toString('base64'),
      back: Buffer.from(backBuf).toString('base64'),
    },
    footprint,
    roofSegments,
    eaveHeightM,
    dimensionsM,
  })

  if (!result.ok) {
    if (result.reason === 'no-api-key') {
      const fallback = { ...FALLBACK_SPEC, eaveHeightM, notes: 'ANTHROPIC_API_KEY not configured — fallback spec.' }
      return NextResponse.json({ spec: fallback, cached: false, source: 'fallback' })
    }
    if (result.reason === 'schema-invalid') {
      console.error('[spec] schema-invalid after retry', result.details)
      const fallback = { ...FALLBACK_SPEC, eaveHeightM, notes: `Agent output failed validation: ${result.details}` }
      return NextResponse.json({ spec: fallback, cached: false, source: 'fallback' })
    }
    // Hard fail (api-error)
    console.error('[spec] agent failed', result.details)
    return NextResponse.json({ error: 'Agent failed', details: result.details }, { status: 502 })
  }

  // Persist to cache (fire-and-forget)
  if (supabase) {
    supabase.storage.from('sunscan-reports').upload(
      cachePath,
      Buffer.from(JSON.stringify(result.spec)),
      { contentType: 'application/json', upsert: true },
    ).catch((e) => console.warn('[spec] cache write failed', e))
  }

  return NextResponse.json({ spec: result.spec, cached: false, source: 'agent' })
}
