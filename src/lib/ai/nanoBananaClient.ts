import { createHash } from 'node:crypto'
import { GoogleGenAI } from '@google/genai'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type EnhanceLabel = 'front' | 'back' | 'left' | 'right' | 'topDown' | 'satellite'

export interface EnhanceInput {
  png: Buffer
  label: EnhanceLabel
}

export interface EnhanceResult {
  png: Buffer
  usedFallback: boolean
  reason?: string
}

export interface EnhanceManyOpts {
  signal?: AbortSignal
}

const MODEL = 'gemini-2.5-flash-image'
const CONCURRENCY = 2
const JITTER_MS = 250
const PER_CALL_TIMEOUT_MS = 30_000

const BASE_PROMPT =
  'Enhance the clarity of this photo of a UK house. Sharpen edges of roof, walls, ' +
  'windows, and doors. Do NOT add, remove, move, or invent any architectural features. ' +
  'Keep the camera angle, lighting, building shape and roof outline identical. ' +
  'Output the enhanced photo only.'

const LABEL_SUFFIX: Record<EnhanceLabel, string> = {
  front: 'This is a ground-level front-elevation view (south-facing facade).',
  back: 'This is a ground-level rear-elevation view (north-facing facade).',
  left: 'This is a ground-level side-elevation view.',
  right: 'This is a ground-level side-elevation view.',
  topDown: 'This is a near-vertical top-down view showing the roof from above.',
  satellite: 'This is a top-down satellite-style aerial view.',
}

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

function isDisabled(): boolean {
  return process.env.SUNSCAN_USE_NANO_BANANA === 'false'
}

function pngHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function readCache(supabase: SupabaseClient, key: string): Promise<Buffer | null> {
  try {
    const { data } = await supabase.storage.from('sunscan-reports').download(`nano-banana/${key}.png`)
    if (!data) return null
    return Buffer.from(await data.arrayBuffer())
  } catch {
    return null
  }
}

async function writeCache(supabase: SupabaseClient, key: string, png: Buffer): Promise<void> {
  try {
    await supabase.storage
      .from('sunscan-reports')
      .upload(`nano-banana/${key}.png`, png, { contentType: 'image/png', upsert: true })
  } catch (err) {
    console.warn('[nano-banana] cache write failed', err)
  }
}

async function callGemini(
  ai: GoogleGenAI,
  png: Buffer,
  label: EnhanceLabel,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const base64 = png.toString('base64')
  const prompt = `${BASE_PROMPT} ${LABEL_SUFFIX[label]}`

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64 } },
          { text: prompt },
        ],
      },
    ],
    config: { responseModalities: ['IMAGE'] },
    ...(signal ? { abortSignal: signal } : {}),
  } as Parameters<typeof ai.models.generateContent>[0])

  const parts = response.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    const data = part.inlineData?.data
    if (typeof data === 'string' && data.length > 0) {
      return Buffer.from(data, 'base64')
    }
  }
  throw new Error('No inlineData in Gemini response')
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export async function enhanceImage(
  input: EnhanceInput,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<EnhanceResult> {
  if (isDisabled()) {
    return { png: input.png, usedFallback: true, reason: 'SUNSCAN_USE_NANO_BANANA=false' }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return { png: input.png, usedFallback: true, reason: 'GEMINI_API_KEY not set' }
  }

  const supabase = getSupabaseAdmin()
  const key = pngHash(input.png)

  if (supabase) {
    const cached = await readCache(supabase, key)
    if (cached) return { png: cached, usedFallback: false }
  }

  try {
    const ai = new GoogleGenAI({ apiKey })
    const out = await withTimeout(
      callGemini(ai, input.png, input.label, opts.signal),
      opts.timeoutMs ?? PER_CALL_TIMEOUT_MS,
    )
    if (supabase) await writeCache(supabase, key, out)
    return { png: out, usedFallback: false }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { png: input.png, usedFallback: true, reason }
  }
}

export async function enhanceMany(
  images: EnhanceInput[],
  opts: EnhanceManyOpts = {},
): Promise<EnhanceResult[]> {
  if (isDisabled() || !process.env.GEMINI_API_KEY) {
    const reason = isDisabled() ? 'SUNSCAN_USE_NANO_BANANA=false' : 'GEMINI_API_KEY not set'
    return images.map((i) => ({ png: i.png, usedFallback: true, reason }))
  }

  const results: EnhanceResult[] = new Array(images.length)
  let nextIndex = 0
  let inFlightSeed = 0

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIndex++
      if (idx >= images.length) return
      const offset = inFlightSeed++ * JITTER_MS
      if (offset > 0) await new Promise((r) => setTimeout(r, offset))
      results[idx] = await enhanceImage(images[idx], { signal: opts.signal })
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, images.length) }, () => worker()))
  return results
}
