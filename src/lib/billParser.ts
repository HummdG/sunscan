import OpenAI from 'openai'
import type { ParsedBill } from './types'

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

const BILL_PARSE_PROMPT = `You are an expert at reading UK residential electricity bills.
Extract the following fields from the provided bill image or document.
Return ONLY valid JSON with exactly these keys (use null for missing values):

{
  "annualKwh": number or null,        // annual electricity usage in kWh
  "tariffPencePerKwh": number or null, // unit rate in pence per kWh
  "standingChargePencePerDay": number or null, // daily standing charge in pence
  "exportTariffPencePerKwh": number or null    // export/SEG rate in pence per kWh (often absent)
}

If you see a period usage (e.g. quarterly), extrapolate to annual.
All values should be numbers only, no units in the JSON.`

/**
 * Parse an electricity bill (PDF or image) using OpenAI GPT-4o vision.
 * Returns null if extraction fails or confidence is too low.
 */
export async function parseBillWithOpenAI(
  buffer: Buffer,
  mimeType: string,
): Promise<ParsedBill | null> {
  if (!client) {
    console.warn('OPENAI_API_KEY not set — returning mock bill data')
    return mockParseBill()
  }

  try {
    // OpenAI vision accepts base64-encoded images
    // For PDFs, we pass as-is if the model supports it, else return null
    if (mimeType === 'application/pdf') {
      // GPT-4o does not natively parse PDFs — return null to trigger manual entry
      // TODO: Convert PDF page 1 to PNG using pdf2pic or similar, then retry
      console.warn('PDF bill upload — OCR not yet implemented for PDF, requesting manual entry')
      return null
    }

    const base64 = buffer.toString('base64')
    const imageUrl = `data:${mimeType};base64,${base64}`

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: BILL_PARSE_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0,
    })

    const text = response.choices[0]?.message?.content?.trim() ?? ''
    // Strip markdown code fences if present
    const json = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(json)

    const annualKwh = parsed.annualKwh != null ? Number(parsed.annualKwh) : null
    const tariff = parsed.tariffPencePerKwh != null ? Number(parsed.tariffPencePerKwh) : null

    if (!annualKwh || !tariff) return null

    const allPresent = annualKwh > 0 && tariff > 0
    return {
      annualKwh,
      tariffPencePerKwh: tariff,
      standingChargePencePerDay: parsed.standingChargePencePerDay != null
        ? Number(parsed.standingChargePencePerDay)
        : 53,
      exportTariffPencePerKwh: parsed.exportTariffPencePerKwh != null
        ? Number(parsed.exportTariffPencePerKwh)
        : 15,
      confidence: allPresent ? 'high' : 'medium',
    }
  } catch (err) {
    console.error('Bill parse error:', err)
    return null
  }
}

function mockParseBill(): ParsedBill {
  return {
    annualKwh: 3850,
    tariffPencePerKwh: 24.5,
    standingChargePencePerDay: 53,
    exportTariffPencePerKwh: 15,
    confidence: 'medium',
  }
}
