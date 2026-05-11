import { NextRequest, NextResponse } from 'next/server'
import { parseBill, BillOcrUnavailableError } from '@/lib/billParser'

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

    let result
    try {
      result = await parseBill(buffer, file.type)
    } catch (err) {
      if (err instanceof BillOcrUnavailableError) {
        return NextResponse.json(
          {
            success: false,
            requiresManualEntry: true,
            error: 'Bill OCR is not configured on this environment. Please enter your bill values manually.',
          },
          { status: 503 },
        )
      }
      throw err
    }

    if (!result) {
      return NextResponse.json({
        success: false,
        requiresManualEntry: true,
        error: 'We couldn\'t extract the unit rate and annual kWh from this file. Please enter them manually.',
      })
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
