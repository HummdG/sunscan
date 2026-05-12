import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fal } from '@fal-ai/client'

/**
 * Hunyuan3D-2 multi-view typically runs in 60-120 s. Vercel's default
 * serverless timeout is 60 s on Hobby and 300 s on Pro. Setting maxDuration
 * to 300 lets the Pro plan ride out the full inference; Hobby will still
 * truncate at 60 s and the client will see a 504 and fall back to the local
 * v2 GLB it has cached.
 */
export const maxDuration = 300

const MAX_IMAGE_BYTES = 8 * 1024 * 1024  // 8 MB per isolated view PNG
const MAX_GLB_BYTES = 30 * 1024 * 1024   // 30 MB cap on returned mesh

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

/**
 * Drone-replacement reconstruction via fal.ai's Hunyuan3D-2 multi-view.
 *
 * Body: multipart with `front`, `back`, `left` PNG blobs (isolated single-
 * building views produced client-side by buildingMasker).
 *
 * Flow:
 *   1. Upload the 3 isolated views to fal storage.
 *   2. Run fal-ai/hunyuan3d/v2/multi-view (textured) and wait.
 *   3. Download the returned GLB.
 *   4. Persist it under {id}-reconstruction-ml-raw.glb in Supabase Storage,
 *      generate a signed URL.
 *   5. Return that URL so the client can fetch, normalise (scale/centre to
 *      match real footprint), and upload the final version through the
 *      existing /reconstruction route.
 *
 * We deliberately don't update Report.reconstructedModelUrl here — the
 * un-normalised mesh is not the canonical artifact. Normalisation happens
 * client-side, then the normalised GLB goes through the existing route
 * which writes the URL.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  if (!process.env.FAL_KEY) {
    return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 503 })
  }
  fal.config({ credentials: process.env.FAL_KEY })

  // We deliberately don't look up `id` in the Report table — this route is
  // also called from the /survey wizard before a Report row exists. The id
  // is only used as a storage filename prefix. Canonical persistence lives
  // in the sibling /reconstruction route (POST), which is only called by the
  // client once a real reportId is available.

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Missing multipart body' }, { status: 400 })
  }
  const front = formData.get('front')
  const back = formData.get('back')
  const left = formData.get('left')
  if (!(front instanceof Blob) || !(back instanceof Blob) || !(left instanceof Blob)) {
    return NextResponse.json({ error: 'Need front, back and left PNG blobs' }, { status: 400 })
  }
  for (const f of [front, back, left]) {
    if (f.size === 0) return NextResponse.json({ error: 'Empty image blob' }, { status: 400 })
    if (f.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'Image too large' }, { status: 413 })
  }

  let frontUrl: string
  let backUrl: string
  let leftUrl: string
  try {
    [frontUrl, backUrl, leftUrl] = await Promise.all([
      fal.storage.upload(toFile(front, 'front.png')),
      fal.storage.upload(toFile(back, 'back.png')),
      fal.storage.upload(toFile(left, 'left.png')),
    ])
  } catch (e) {
    console.error('fal.storage upload failed', e)
    return NextResponse.json({ error: 'fal storage upload failed' }, { status: 502 })
  }

  let glbUrl: string
  try {
    const result = await fal.subscribe('fal-ai/hunyuan3d/v2/multi-view', {
      input: {
        front_image_url: frontUrl,
        back_image_url: backUrl,
        left_image_url: leftUrl,
        textured_mesh: true,
      },
      logs: false,
    })
    const data = (result as { data?: { model_mesh?: { url?: string } } }).data
    const url = data?.model_mesh?.url
    if (!url) {
      console.error('fal response missing model_mesh.url', result)
      return NextResponse.json({ error: 'fal returned no GLB URL' }, { status: 502 })
    }
    glbUrl = url
  } catch (e) {
    console.error('fal.subscribe failed', e)
    return NextResponse.json({ error: 'ML reconstruction failed' }, { status: 502 })
  }

  // Try to mirror the GLB into Supabase for a long-lived URL. If the bucket
  // isn't configured (404) or any other upload error happens, fall back to
  // returning fal's own URL — valid for ~24h, plenty for the immediate
  // session. The browser will fetch + display either way.
  const supabase = getSupabaseAdmin()
  if (supabase) {
    try {
      const r = await fetch(glbUrl)
      if (!r.ok) throw new Error(`GET ${glbUrl} → ${r.status}`)
      const glbBuf = await r.arrayBuffer()
      if (glbBuf.byteLength > MAX_GLB_BYTES) {
        throw new Error('GLB exceeds size cap')
      }

      const fileName = `${id}-reconstruction-ml-raw.glb`
      const { error: uploadError } = await supabase.storage
        .from('sunscan-reports')
        .upload(fileName, Buffer.from(glbBuf), { contentType: 'model/gltf-binary', upsert: true })
      if (uploadError) throw uploadError

      const { data: signed } = await supabase.storage
        .from('sunscan-reports')
        .createSignedUrl(fileName, 60 * 60 * 24 * 30)  // 30 days
      if (signed?.signedUrl) {
        return NextResponse.json({ rawGlbUrl: signed.signedUrl, source: 'supabase' })
      }
      throw new Error('Failed to generate signed URL')
    } catch (e) {
      console.warn('Supabase mirror failed, returning fal URL directly', e)
    }
  }

  // Fallback: hand the fal URL straight to the client.
  return NextResponse.json({ rawGlbUrl: glbUrl, source: 'fal' })
}

/**
 * The fal client's `storage.upload` signature is `(File | Blob)` but in
 * Node 18+ the form-data Blob doesn't have a name, which the SDK uses for
 * the multipart filename. Wrap it as a File so the upload is well-formed.
 */
function toFile(blob: Blob, name: string): File {
  if (typeof File !== 'undefined' && blob instanceof File) return blob
  return new File([blob], name, { type: blob.type || 'image/png' })
}
