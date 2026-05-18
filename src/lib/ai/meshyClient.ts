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
   * The raw image buffers. Used only for size/empty validation now;
   * the actual bytes Meshy fetches come from `imageUrls`.
   */
  images: Buffer[]
  /**
   * Public HTTPS URLs Meshy will fetch. Provide 1 to hit
   * `/openapi/v1/image-to-3d`, 2+ to hit `/openapi/v1/multi-image-to-3d`.
   * Required — Meshy's API misbehaves with large data URIs (>1MB), so
   * we always stage the PNGs on Supabase and pass signed URLs.
   */
  imageUrls: string[]
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
const DEFAULT_API_VERSION = 'v1' // override with MESHY_API_VERSION=v2

function apiVersion(): string {
  return process.env.MESHY_API_VERSION || DEFAULT_API_VERSION
}

function defaultPolycount(): number {
  const raw = process.env.SUNSCAN_MESHY_POLYCOUNT
  const n = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : 30_000
}

/**
 * Build the texture_prompt sent to Meshy. We deliberately do NOT inject
 * derived metadata (pitches, azimuths, areas, footprint, eave/ridge
 * heights, assumed materials). That metadata corrupts Meshy's texturing
 * pass by biasing it away from the actual image — the model starts
 * inventing roof geometry to match the spec sheet instead of faithfully
 * reproducing what's in the photo. ASCII only.
 *
 * Args are accepted for backwards compatibility with callers and are
 * intentionally ignored.
 */
export function buildTexturePrompt(
  _roofSegments: MeshyRoofSegment[],
  _dims: MeshyDims,
): string {
  return 'Reproduce the house in the input photo as accurately as possible. Preserve the actual roof shape, wall materials, windows, doors, and colors visible in the image. Do not invent details that are not in the photo.'
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
  task_error?: { message?: string; code?: string | number }
  // Surface any other fields Meshy returns
  [k: string]: unknown
}

/** Meshy endpoint slug: 'image-to-3d' (single image) or 'multi-image-to-3d'. */
type MeshyEndpoint = 'image-to-3d' | 'multi-image-to-3d'

async function createImageToTask(
  apiKey: string,
  endpoint: MeshyEndpoint,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<string> {
  const res = await fetch(`${MESHY_BASE}/${apiVersion()}/${endpoint}`, {
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
  endpoint: MeshyEndpoint,
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

    const res = await fetch(`${MESHY_BASE}/${apiVersion()}/${endpoint}/${taskId}`, {
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
      // Dump the full task response so we can see every field Meshy returned
      // (task_error.code, debug fields, etc.) instead of just the message.
      console.error('[meshy] task ended in failure — full task body:',
        JSON.stringify(task, null, 2))
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
  endpoint: MeshyEndpoint,
  body: Record<string, unknown>,
  input: MeshyInput,
): Promise<MeshyOutput> {
  const taskId = await createImageToTask(apiKey, endpoint, body, input.signal)
  console.log(`[meshy] ${endpoint} task created:`, taskId)

  const task = await pollTaskUntilDone(apiKey, endpoint, taskId, input.signal, input.onProgress)
  const glbUrl = task.model_urls?.glb
  if (!glbUrl) throw new Error('Meshy task succeeded but no model_urls.glb present')

  const glb = await downloadGlb(glbUrl, input.signal)
  console.log('[meshy] glb downloaded, bytes=', glb.length)
  return { glb, rawGlbUrl: glbUrl }
}

export async function generateGlb(input: MeshyInput): Promise<MeshyOutput> {
  const apiKey = process.env.MESHY_API_KEY
  if (!apiKey) throw new Error('MESHY_API_KEY is not set')

  if (input.imageUrls.length === 0) throw new Error('generateGlb requires at least 1 image URL')
  for (const png of input.images) {
    if (!png || png.length === 0) throw new Error('Meshy image is empty')
    if (png.length > 8 * 1024 * 1024) {
      throw new Error(`Meshy image is ${png.length} bytes (>8MB cap)`)
    }
  }

  const endpoint: MeshyEndpoint =
    input.imageUrls.length > 1 ? 'multi-image-to-3d' : 'image-to-3d'
  console.log(`[meshy] ${endpoint}:`, {
    imageCount: input.imageUrls.length,
    imageBytes: input.images.map((p) => p.length),
    polycount: input.targetPolycount ?? defaultPolycount(),
    urlPreviews: input.imageUrls.map((u) => u.slice(0, 80)),
  })

  const baseBody: Record<string, unknown> = {
    ai_model: process.env.MESHY_AI_MODEL || DEFAULT_AI_MODEL,
    topology: 'triangle',
    target_polycount: input.targetPolycount ?? defaultPolycount(),
    should_remesh: true,
    should_texture: true,
    enable_pbr: input.enablePbr ?? true,
    texture_prompt: input.texturePrompt,
  }
  const body: Record<string, unknown> =
    endpoint === 'multi-image-to-3d'
      ? { ...baseBody, image_urls: input.imageUrls }
      : { ...baseBody, image_url: input.imageUrls[0] }

  // Meshy's generation service occasionally fails with "temporarily
  // unavailable, please retry" on transient infra issues. Direct-curl
  // tests on 2026-05-13 confirmed the same input bytes succeed minutes
  // after a production failure, so 30s gives Meshy room to route to a
  // healthy generation node. A failing attempt is ~70s, success ~150s,
  // so worst case (70 + 30 + 150 = 250s) fits inside the route's 300s
  // maxDuration.
  const MAX_ATTEMPTS = 2
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) console.warn(`[meshy] retry attempt ${attempt}/${MAX_ATTEMPTS}`)
      return await runOneAttempt(apiKey, endpoint, body, input)
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS && isTransientMeshyError(err)) {
        const backoffMs = 30_000
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
