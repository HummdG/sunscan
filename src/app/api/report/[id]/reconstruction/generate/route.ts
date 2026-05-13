import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { wgs84ToLocalMetres } from '@/lib/geometry'
import { enhanceMany, type EnhanceLabel } from '@/lib/ai/nanoBananaClient'
import { generateGlb, buildTexturePrompt, type MeshyRoofSegment } from '@/lib/ai/meshyClient'
import { replaceRoofInGlb, type RoofSegmentLocal } from '@/lib/3d/glbRoofCorrector'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30
const SUPABASE_BUCKET = 'sunscan-reports'

/** Order matters: the 4 selected indices are picked from this array. */
const ALL_LABELS: EnhanceLabel[] = ['front', 'back', 'left', 'right', 'topDown', 'satellite']

/**
 * Indices into ALL_LABELS to send to Meshy.
 *
 * The 4 cardinal high-oblique drone-eye captures are the best diet for an
 * image-to-3D model: each view shows roof + walls in perspective, the same
 * distribution Meshy was trained on. We deliberately do NOT send the
 * top-down or the Google Maps Static satellite blob, because both are
 * orthographic/flat — Meshy interprets them as ground planes and produces
 * a giant flat sheet with a tiny crumpled blob on top.
 */
const MESHY_VIEW_SELECTION: readonly EnhanceLabel[] = ['front', 'right', 'back', 'left']

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

  // ─── 6. Pick 4 views for Meshy ──────────────────────────────────────────────
  const meshyImages: Buffer[] = MESHY_VIEW_SELECTION.map((label) => {
    const idx = ALL_LABELS.indexOf(label)
    return enhanceResults[idx].png
  })

  // ─── 6b. Upload front image to Supabase for a stable public URL ───────────
  // Meshy's direct API misbehaves with large data URIs (>1MB), failing
  // with a generic "temporarily unavailable" after running for ~50s.
  // Hosting the PNG on Supabase and passing the signed URL bypasses the
  // data URI path entirely.
  const meshyImageUploadPath = `meshy/tmp/${cacheKey}.front.png`
  const { error: tmpUploadError } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .upload(meshyImageUploadPath, meshyImages[0], {
      contentType: 'image/png',
      upsert: true,
    })
  if (tmpUploadError) {
    console.error('[generate] tmp image upload failed', tmpUploadError)
    return NextResponse.json({ error: 'Failed to stage Meshy input image' }, { status: 502 })
  }
  const { data: signedInput } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(meshyImageUploadPath, 60 * 60)
  if (!signedInput?.signedUrl) {
    console.error('[generate] failed to sign tmp image url')
    return NextResponse.json({ error: 'Failed to sign Meshy input image url' }, { status: 502 })
  }
  console.log('[generate] meshy input image signed url:', signedInput.signedUrl.slice(0, 100))

  // ─── 7. Meshy ──────────────────────────────────────────────────────────────
  let meshyGlb: Buffer
  try {
    // dimensionsM.y is the vertical extent of the cropped tile mesh and can
    // pick up trees / antennas / surrounding geometry; clamp it to a sane UK
    // residential range so the texture_prompt doesn't claim "ridge 33.5m".
    const clampedRidgeM = Math.min(Math.max(dimensionsM.y, eaveHeightM + 0.5), eaveHeightM + 6)
    const meshyDims = {
      widthM: dimensionsM.x,
      depthM: dimensionsM.z,
      eaveHeightM,
      ridgeHeightM: clampedRidgeM,
    }
    const meshyRoofSegments: MeshyRoofSegment[] = roofSegments.map((s) => ({
      pitchDeg: s.pitchDeg,
      azimuthDeg: s.azimuthDeg,
      areaM2: s.areaM2,
    }))
    const texturePrompt = buildTexturePrompt(meshyRoofSegments, meshyDims)
    const meshyResult = await generateGlb({
      imageUrl: signedInput.signedUrl,
      images: meshyImages,
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
  })
}
