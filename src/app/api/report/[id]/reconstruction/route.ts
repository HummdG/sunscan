import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createClient } from '@supabase/supabase-js'

const MAX_GLB_BYTES = 25 * 1024 * 1024  // 25 MB hard cap

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

/**
 * Upload a reconstructed GLB for the given report and cache the signed URL.
 * Multipart form upload with a single field "glb".
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const report = await prisma.report.findUnique({ where: { id } })
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  const formData = await req.formData().catch(() => null)
  const file = formData?.get('glb')
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing glb file in multipart body' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty glb file' }, { status: 400 })
  }
  if (file.size > MAX_GLB_BYTES) {
    return NextResponse.json({ error: `GLB exceeds ${MAX_GLB_BYTES} bytes` }, { status: 413 })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileName = `${id}-reconstruction.glb`

  const { error: uploadError } = await supabase.storage
    .from('sunscan-reports')
    .upload(fileName, buffer, { contentType: 'model/gltf-binary', upsert: true })

  if (uploadError) {
    console.error('GLB upload failed', uploadError)
    return NextResponse.json({ error: 'Upload failed' }, { status: 502 })
  }

  const { data: signed } = await supabase.storage
    .from('sunscan-reports')
    .createSignedUrl(fileName, 60 * 60 * 24 * 30)  // 30 days
  const reconstructedModelUrl = signed?.signedUrl ?? null

  if (reconstructedModelUrl) {
    await prisma.report.update({
      where: { id },
      data: { reconstructedModelUrl },
    })
  }

  return NextResponse.json({ reconstructedModelUrl })
}
