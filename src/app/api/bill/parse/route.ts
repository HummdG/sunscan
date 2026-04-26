import { NextRequest, NextResponse } from 'next/server'
import { parseBillWithOpenAI } from '@/lib/billParser'

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('bill') as File | null

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ success: false, error: 'File too large (max 10MB)' }, { status: 413 })
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type. Upload PDF, JPEG, PNG, or WebP.' },
        { status: 415 },
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await parseBillWithOpenAI(buffer, file.type)

    if (!result) {
      return NextResponse.json({ success: false, requiresManualEntry: true })
    }

    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    console.error('/api/bill/parse error:', err)
    return NextResponse.json(
      { success: false, error: 'Bill parsing failed. Please enter values manually.' },
      { status: 500 },
    )
  }
}
