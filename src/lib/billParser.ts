import { Mistral } from '@mistralai/mistralai'
import type { ParsedBill } from './types'

const apiKey = process.env.MISTRAL_API_KEY
const client = apiKey ? new Mistral({ apiKey }) : null

export class BillOcrUnavailableError extends Error {
  constructor() {
    super('Bill OCR is not configured (MISTRAL_API_KEY missing)')
    this.name = 'BillOcrUnavailableError'
  }
}

const EXTRACTION_PROMPT = `You are extracting key fields from a UK residential electricity bill whose page contents have already been OCR-transcribed to markdown below.

Return ONLY a JSON object with these four keys (use null when a value is not clearly visible):
{
  "annualKwh": number | null,                   // annual electricity usage in kWh. If a quarterly figure is given, multiply by 4. If a monthly figure, multiply by 12.
  "tariffPencePerKwh": number | null,           // unit rate in pence per kWh
  "standingChargePencePerDay": number | null,   // daily standing charge in pence
  "exportTariffPencePerKwh": number | null      // SEG / export rate in pence per kWh (often absent)
}

Be conservative: if a number could be the wrong field, return null. Do not invent values.

OCR text:
---
{TEXT}
---`

/**
 * Parse an electricity bill (PDF or image) using Mistral OCR + Mistral chat for extraction.
 * Throws BillOcrUnavailableError if MISTRAL_API_KEY is not configured.
 * Returns null if OCR or extraction fails or the required fields can't be found.
 */
export async function parseBill(buffer: Buffer, mimeType: string): Promise<ParsedBill | null> {
  if (!client) throw new BillOcrUnavailableError()

  const base64 = buffer.toString('base64')
  const dataUri = `data:${mimeType};base64,${base64}`
  const isImage = mimeType.startsWith('image/')

  let ocrText = ''
  try {
    const ocrResponse = await client.ocr.process({
      model: 'mistral-ocr-latest',
      document: isImage
        ? { type: 'image_url', imageUrl: dataUri }
        : { type: 'document_url', documentUrl: dataUri },
    })
    ocrText = (ocrResponse.pages ?? []).map((p) => p.markdown ?? '').join('\n\n').trim()
  } catch (err) {
    console.error('Mistral OCR failed:', err)
    return null
  }

  if (!ocrText) {
    console.warn('Mistral OCR returned empty text')
    return null
  }

  // Mistral OCR has a per-page page limit; we cap the prompt to a safe length.
  const truncated = ocrText.slice(0, 12000)

  let extracted: {
    annualKwh: unknown
    tariffPencePerKwh: unknown
    standingChargePencePerDay: unknown
    exportTariffPencePerKwh: unknown
  }
  try {
    const completion = await client.chat.complete({
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: EXTRACTION_PROMPT.replace('{TEXT}', truncated) }],
      responseFormat: { type: 'json_object' },
      temperature: 0,
    })
    const raw = completion.choices?.[0]?.message?.content ?? ''
    const text = typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.map((c) => ('text' in c ? c.text : '')).join('')
        : ''
    extracted = JSON.parse(text)
  } catch (err) {
    console.error('Mistral extraction failed:', err)
    return null
  }

  const annualKwh = toFiniteNumber(extracted.annualKwh)
  const tariff = toFiniteNumber(extracted.tariffPencePerKwh)
  const standingCharge = toFiniteNumber(extracted.standingChargePencePerDay)
  const exportTariff = toFiniteNumber(extracted.exportTariffPencePerKwh)

  // The two fields that drive the proposal: kWh and unit rate. Without both, we don't trust it.
  if (annualKwh === null || annualKwh <= 0) return null
  if (tariff === null || tariff <= 0) return null

  const supportingFieldsPresent = [standingCharge !== null, exportTariff !== null].filter(Boolean).length
  const confidence: 'high' | 'medium' | 'low' =
    supportingFieldsPresent === 2 ? 'high' : supportingFieldsPresent === 1 ? 'medium' : 'low'

  return {
    annualKwh,
    tariffPencePerKwh: tariff,
    standingChargePencePerDay: standingCharge ?? 53,
    exportTariffPencePerKwh: exportTariff ?? 15,
    confidence,
  }
}

function toFiniteNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}
