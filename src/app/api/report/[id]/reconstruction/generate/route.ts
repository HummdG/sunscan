import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { wgs84ToLocalMetres } from '@/lib/geometry'
import { enhanceMany, type EnhanceLabel } from '@/lib/ai/nanoBananaClient'
import { generateGlb, buildTexturePrompt } from '@/lib/ai/meshyClient'
import { replaceRoofInGlb, type RoofSegmentLocal } from '@/lib/3d/glbRoofCorrector'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30
const SUPABASE_BUCKET = 'sunscan-reports'

/** Order matters: corresponds to the FormData keys the client sends and
 *  to the image_urls order sent to Meshy. Both views are enhanced by
 *  Gemini (Nano Banana) and both are sent to Meshy's
 *  /openapi/v1/multi-image-to-3d endpoint for opposing-view 3D
 *  reconstruction. */
const ALL_LABELS: EnhanceLabel[] = ['front', 'back']

interface InputRoofSegment {
  pitchDeg: number
  azimuthDeg: number
  areaM2: number
  centerLng: number
  centerLat: number
}

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

async function readImage(formData: FormData, name: EnhanceLabel): Promise<Buffer> {
  const file = formData.get(name)
  if (!(file instanceof Blob)) {
    throw new Error(`Missing or invalid ${name} blob`)
  }
  if (file.size === 0) throw new Error(`Empty ${name} blob`)
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${name} blob too large`)
  return Buffer.from(await file.arrayBuffer())
}

async function uploadGlb(
  supabase: SupabaseClient,
  path: string,
  glb: Buffer,
): Promise<string | null> {
  const { error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(path, glb, { contentType: 'model/gltf-binary', upsert: true })
  if (error) {
    console.error('[generate] GLB upload failed', { path, error })
    return null
  }
  const { data: signed } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  return signed?.signedUrl ?? null
}

async function downloadFromCache(
  supabase: SupabaseClient,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await supabase.storage.from(SUPABASE_BUCKET).download(path)
    if (!data) return null
    const { data: signed } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    return signed?.signedUrl ?? null
  } catch {
    return null
  }
}

function isRealReportId(id: string): boolean {
  return !!id && !id.startsWith('scratch-')
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  console.log('[generate] POST received for report id:', id, {
    hasMeshyKey: !!process.env.MESHY_API_KEY,
    hasFalKey: !!process.env.FAL_KEY,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
  })

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    console.warn('[generate] no multipart body')
    return NextResponse.json({ error: 'Missing multipart body' }, { status: 400 })
  }

  // ─── 1. Validate images ─────────────────────────────────────────────────────
  let imageBuffers: Buffer[]
  try {
    imageBuffers = await Promise.all(ALL_LABELS.map((label) => readImage(formData, label)))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  // ─── 2. Validate JSON params ────────────────────────────────────────────────
  let footprint: Array<[number, number]>
  let roofSegments: InputRoofSegment[]
  let dimensionsM: { x: number; y: number; z: number }
  let eaveHeightM: number
  try {
    footprint = JSON.parse(formData.get('footprint') as string)
    roofSegments = JSON.parse(formData.get('roofSegments') as string)
    dimensionsM = JSON.parse(formData.get('dimensionsM') as string)
    eaveHeightM = parseFloat(formData.get('eaveHeightM') as string)
    if (!Array.isArray(footprint) || footprint.length < 3) {
      throw new Error('footprint must be a ring of ≥3 [lng,lat] pairs')
    }
    if (!Array.isArray(roofSegments)) throw new Error('roofSegments must be an array')
    if (!Number.isFinite(eaveHeightM) || eaveHeightM <= 0) {
      throw new Error('eaveHeightM must be a positive number')
    }
  } catch (e) {
    return NextResponse.json({ error: `Bad input: ${(e as Error).message}` }, { status: 400 })
  }

  // ─── 3. Cache key ───────────────────────────────────────────────────────────
  const hash = createHash('sha256')
  hash.update(JSON.stringify(footprint))
  hash.update(JSON.stringify(roofSegments))
  hash.update(String(eaveHeightM))
  hash.update(JSON.stringify(dimensionsM))
  for (const buf of imageBuffers) hash.update(buf)
  const cacheKey = hash.digest('hex')
  const correctedPath = `meshy/${cacheKey}.corrected.glb`
  const rawPath = `meshy/${cacheKey}.raw.glb`

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    console.error('[generate] Supabase admin client null — NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY missing')
    return NextResponse.json(
      { error: 'Supabase not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY)' },
      { status: 503 },
    )
  }

  // ─── 4. Cache hit? ──────────────────────────────────────────────────────────
  const cachedCorrected = await downloadFromCache(supabase, correctedPath)
  if (cachedCorrected) {
    console.log('[generate] cache hit, returning early:', correctedPath)
    const cachedRaw = (await downloadFromCache(supabase, rawPath)) ?? cachedCorrected
    return NextResponse.json({
      reconstructedModelUrl: cachedCorrected,
      reconstructedModelRawUrl: cachedRaw,
      cached: true,
      source: 'cache',
      enhancementsUsedFallback: 0,
      roofReplaced: true,
    })
  }
  console.log('[generate] cache miss, cacheKey:', cacheKey)

  if (!process.env.MESHY_API_KEY) {
    console.error('[generate] MESHY_API_KEY is not set — returning 502. Check .env.local and RESTART the dev server.')
    return NextResponse.json(
      { error: 'MESHY_API_KEY not configured', retryable: true },
      { status: 502 },
    )
  }
  console.log('[generate] MESHY_API_KEY present, length:', process.env.MESHY_API_KEY.length)

  // ─── 5. Nano Banana enhancement ─────────────────────────────────────────────
  const enhanceResults = await enhanceMany(
    imageBuffers.map((png, i) => ({ png, label: ALL_LABELS[i] })),
  )
  const enhancementsUsedFallback = enhanceResults.filter((r) => r.usedFallback).length

  // ─── 6. Stage Gemini-enhanced PNGs on Supabase ──────────────────────────────
  // Meshy needs stable HTTPS URLs (its API misbehaves with >1MB data URIs).
  // We upload each enhanced PNG once, then (a) pass the signed URLs to
  // Meshy's multi-image endpoint and (b) return them to the client so the
  // UI can display the cleaned images alongside the raw captures.
  const enhancedSignedUrls: string[] = []
  for (let i = 0; i < ALL_LABELS.length; i++) {
    const label = ALL_LABELS[i]
    const enhancedPng = enhanceResults[i].png
    const path = `meshy/tmp/${cacheKey}.${label}.png`
    const { error: upErr } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(path, enhancedPng, { contentType: 'image/png', upsert: true })
    if (upErr) {
      console.error(`[generate] tmp ${label} upload failed`, upErr)
      return NextResponse.json({ error: `Failed to stage Meshy input image (${label})` }, { status: 502 })
    }
    const { data: signed } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(path, 60 * 60)
    if (!signed?.signedUrl) {
      console.error(`[generate] failed to sign ${label} tmp url`)
      return NextResponse.json({ error: `Failed to sign Meshy input url (${label})` }, { status: 502 })
    }
    enhancedSignedUrls.push(signed.signedUrl)
  }
  console.log('[generate] meshy input image urls:', enhancedSignedUrls.length, 'staged')

  // ─── 7. Meshy multi-image-to-3d ─────────────────────────────────────────────
  let meshyGlb: Buffer
  try {
    const texturePrompt = buildTexturePrompt([], {
      widthM: 0,
      depthM: 0,
      eaveHeightM: 0,
      ridgeHeightM: 0,
    })
    const meshyResult = await generateGlb({
      imageUrls: enhancedSignedUrls,
      images: ALL_LABELS.map((_, i) => enhanceResults[i].png),
      texturePrompt,
      enablePbr: true,
    })
    meshyGlb = meshyResult.glb
  } catch (err) {
    console.error('[generate] Meshy failed', err)
    return NextResponse.json(
      { error: 'Meshy generation failed', retryable: true, details: (err as Error).message },
      { status: 502 },
    )
  }

  // ─── 8. Roof correction ────────────────────────────────────────────────────
  const centreLng = footprint[0][0]
  const centreLat = footprint[0][1]
  const footprintLocal = wgs84ToLocalMetres(footprint, [centreLng, centreLat])
  const segmentCentersLocal = wgs84ToLocalMetres(
    roofSegments.map((s) => [s.centerLng, s.centerLat] as [number, number]),
    [centreLng, centreLat],
  )
  const localSegments: RoofSegmentLocal[] = roofSegments.map((s, i) => ({
    pitchDeg: s.pitchDeg,
    azimuthDeg: s.azimuthDeg,
    areaM2: s.areaM2,
    centerX: segmentCentersLocal[i][0],
    centerZ: segmentCentersLocal[i][1],
  }))

  const correctedResult = await replaceRoofInGlb(
    meshyGlb,
    localSegments,
    footprintLocal,
    eaveHeightM,
  )
  const correctedGlb = correctedResult.glb
  const roofReplaced = correctedResult.replaced

  // ─── 9. Upload both ─────────────────────────────────────────────────────────
  const [correctedUrl, rawUrl] = await Promise.all([
    uploadGlb(supabase, correctedPath, correctedGlb),
    uploadGlb(supabase, rawPath, meshyGlb),
  ])

  if (!correctedUrl || !rawUrl) {
    return NextResponse.json({ error: 'Storage upload failed' }, { status: 502 })
  }

  // Legacy single-URL path consumed elsewhere (PDF render, etc).
  let legacyUrl: string | null = null
  if (isRealReportId(id)) {
    legacyUrl = await uploadGlb(supabase, `${id}-reconstruction.glb`, correctedGlb)
    try {
      const exists = await prisma.report.findUnique({ where: { id }, select: { id: true } })
      if (exists) {
        await prisma.report.update({
          where: { id },
          data: {
            reconstructedModelUrl: legacyUrl ?? correctedUrl,
            reconstructedModelRawUrl: rawUrl,
          },
        })
      }
    } catch (e) {
      console.warn('[generate] prisma update skipped', e)
    }
  }

  return NextResponse.json({
    reconstructedModelUrl: legacyUrl ?? correctedUrl,
    reconstructedModelRawUrl: rawUrl,
    cached: false,
    source: 'meshy',
    enhancementsUsedFallback,
    roofReplaced,
    /** Signed URLs to the Gemini-enhanced PNGs we shipped to Meshy.
     *  Order matches ALL_LABELS (currently ['front', 'back']). The UI
     *  uses these to render an "enhanced" thumbnail next to each raw
     *  capture in the Gemini-inputs strip. */
    enhancedImageUrls: ALL_LABELS.map((label, i) => ({
      label,
      url: enhancedSignedUrls[i],
    })),
  })
}
