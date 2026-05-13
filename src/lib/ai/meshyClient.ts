export interface MeshyRoofSegment {
  pitchDeg: number
  azimuthDeg: number
  areaM2: number
}

export interface MeshyDims {
  widthM: number
  depthM: number
  eaveHeightM: number
  ridgeHeightM: number
}

export interface MeshyInput {
  /**
   * 1-4 image buffers. The Meshy direct image-to-3d endpoint accepts a
   * single image; only `images[0]` is sent. The rest are ignored (kept in
   * the interface so the route can keep batching 4 captures for cache
   * stability and future endpoints).
   */
  images: Buffer[]
  /**
   * Optional public HTTPS URL for the front image. When provided, sent to
   * Meshy instead of an embedded data URI. Strongly preferred — Meshy's
   * API misbehaves with large data URIs (>1MB), failing with a misleading
   * "temporarily unavailable" error after running for ~50s.
   */
  imageUrl?: string
  texturePrompt: string
  targetPolycount?: number
  enablePbr?: boolean
  signal?: AbortSignal
  onProgress?: (phase: 'queued' | 'in_progress' | 'completed', pct?: number) => void
}

export interface MeshyOutput {
  glb: Buffer
  rawGlbUrl: string
}

const MESHY_BASE = 'https://api.meshy.ai/openapi'
const POLL_INTERVAL_MS = 5_000
const MAX_POLL_DURATION_MS = 8 * 60 * 1000 // 8 minutes
const DEFAULT_AI_MODEL = 'meshy-5'

function defaultPolycount(): number {
  const raw = process.env.SUNSCAN_MESHY_POLYCOUNT
  const n = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : 30_000
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '?'
}

/**
 * Build the texture_prompt sent to Meshy. ASCII only — `°`, `²`, `×` and
 * other multibyte glyphs sometimes trip Meshy's text pipeline and cause
 * the whole task to fail with a misleading "temporarily unavailable"
 * error.
 */
export function buildTexturePrompt(
  roofSegments: MeshyRoofSegment[],
  dims: MeshyDims,
): string {
  const segDescs = roofSegments
    .slice(0, 8)
    .map(
      (s, i) =>
        `seg${i + 1} pitch ${fmt(s.pitchDeg, 0)} deg/azimuth ${fmt(s.azimuthDeg, 0)} deg (MCS)/area ${fmt(s.areaM2)} sqm`,
    )
  const segPart = segDescs.length ? `Roof segments: ${segDescs.join('. ')}.` : ''
  return [
    'UK single-family house.',
    segPart,
    `Footprint ${fmt(dims.widthM)}m by ${fmt(dims.depthM)}m, eaves ${fmt(dims.eaveHeightM)}m, ridge ${fmt(dims.ridgeHeightM)}m.`,
    'Materials: clay roof tiles, brick walls, painted timber windows.',
  ]
    .filter(Boolean)
    .join(' ')
}

interface MeshyTaskResponse {
  id: string
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELED'
  progress?: number
  model_urls?: {
    glb?: string
    fbx?: string
    usdz?: string
    obj?: string
  }
  task_error?: { message?: string }
}

async function createImageToTask(
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<string> {
  const res = await fetch(`${MESHY_BASE}/v1/image-to-3d`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Meshy create task failed: HTTP ${res.status} ${text}`)
  }
  let json: { result?: string }
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Meshy create task returned non-JSON: ${text.slice(0, 500)}`)
  }
  if (!json.result) throw new Error(`Meshy create task missing result id: ${text.slice(0, 200)}`)
  return json.result
}

async function pollTaskUntilDone(
  apiKey: string,
  taskId: string,
  signal: AbortSignal | undefined,
  onProgress?: MeshyInput['onProgress'],
): Promise<MeshyTaskResponse> {
  const start = Date.now()
  let firstPoll = true
  while (Date.now() - start < MAX_POLL_DURATION_MS) {
    if (signal?.aborted) throw new DOMException('Meshy polling aborted', 'AbortError')
    if (!firstPoll) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    firstPoll = false

    const res = await fetch(`${MESHY_BASE}/v1/image-to-3d/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Meshy poll failed: HTTP ${res.status} ${text}`)
    }
    const task = (await res.json()) as MeshyTaskResponse
    const pct = typeof task.progress === 'number' ? task.progress / 100 : undefined

    if (task.status === 'PENDING') onProgress?.('queued', pct)
    else if (task.status === 'IN_PROGRESS') onProgress?.('in_progress', pct)
    else if (task.status === 'SUCCEEDED') {
      onProgress?.('completed', 1)
      return task
    } else if (task.status === 'FAILED' || task.status === 'EXPIRED' || task.status === 'CANCELED') {
      throw new Error(
        `Meshy task ${task.status}: ${task.task_error?.message ?? 'no detail'}`,
      )
    }
  }
  throw new Error(`Meshy poll timed out after ${MAX_POLL_DURATION_MS / 1000}s`)
}

async function downloadGlb(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Meshy GLB download failed: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Messages from Meshy that indicate the task is worth retrying. */
const TRANSIENT_RETRY_PATTERNS = [
  /temporarily unavailable/i,
  /please retry/i,
  /timeout/i,
  /service unavailable/i,
  /internal error/i,
]

function isTransientMeshyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return TRANSIENT_RETRY_PATTERNS.some((p) => p.test(msg))
}

async function runOneAttempt(
  apiKey: string,
  body: Record<string, unknown>,
  input: MeshyInput,
): Promise<MeshyOutput> {
  const taskId = await createImageToTask(apiKey, body, input.signal)
  console.log('[meshy] task created:', taskId)

  const task = await pollTaskUntilDone(apiKey, taskId, input.signal, input.onProgress)
  const glbUrl = task.model_urls?.glb
  if (!glbUrl) throw new Error('Meshy task succeeded but no model_urls.glb present')

  const glb = await downloadGlb(glbUrl, input.signal)
  console.log('[meshy] glb downloaded, bytes=', glb.length)
  return { glb, rawGlbUrl: glbUrl }
}

export async function generateGlb(input: MeshyInput): Promise<MeshyOutput> {
  const apiKey = process.env.MESHY_API_KEY
  if (!apiKey) throw new Error('MESHY_API_KEY is not set')

  if (input.images.length === 0) throw new Error('generateGlb requires at least 1 image')
  const png = input.images[0]
  if (!png || png.length === 0) throw new Error('Meshy image is empty')
  if (png.length > 8 * 1024 * 1024) {
    throw new Error(`Meshy image is ${png.length} bytes (>8MB cap)`)
  }

  const imageUrl = input.imageUrl ?? `data:image/png;base64,${png.toString('base64')}`
  console.log('[meshy] direct API:', {
    imageBytes: png.length,
    polycount: input.targetPolycount ?? defaultPolycount(),
    imageMode: input.imageUrl ? 'https-url' : 'data-uri',
    urlPreview: imageUrl.slice(0, 80),
  })

  const body: Record<string, unknown> = {
    image_url: imageUrl,
    ai_model: process.env.MESHY_AI_MODEL || DEFAULT_AI_MODEL,
    topology: 'triangle',
    target_polycount: input.targetPolycount ?? defaultPolycount(),
    should_remesh: true,
    should_texture: true,
    enable_pbr: input.enablePbr ?? true,
    texture_prompt: input.texturePrompt,
  }

  // Meshy's generation service occasionally fails with "temporarily
  // unavailable, please retry" on transient infra issues. One retry with
  // a short backoff is cheap (~$0.10) and saves the user from manually
  // re-triggering the wizard (which would re-run tile capture and Nano
  // Banana too).
  const MAX_ATTEMPTS = 2
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) console.warn(`[meshy] retry attempt ${attempt}/${MAX_ATTEMPTS}`)
      return await runOneAttempt(apiKey, body, input)
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS && isTransientMeshyError(err)) {
        const backoffMs = 5_000
        console.warn(`[meshy] transient error, retrying in ${backoffMs}ms:`, (err as Error).message)
        await new Promise((r) => setTimeout(r, backoffMs))
        continue
      }
      console.error('[meshy] task failed (no more retries)', {
        message: (err as Error).message,
        attempt,
        texturePromptPreview: input.texturePrompt.slice(0, 200),
      })
      throw err
    }
  }
  throw lastErr
}
