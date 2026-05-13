import { fal } from '@fal-ai/client'

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
  images: Buffer[]
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

const DEFAULT_ENDPOINT = 'fal-ai/meshy/v5/multi-image-to-3d'

function endpoint(): string {
  return process.env.MESHY_FAL_ENDPOINT || DEFAULT_ENDPOINT
}

function defaultPolycount(): number {
  const raw = process.env.SUNSCAN_MESHY_POLYCOUNT
  const n = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : 30_000
}

let configured = false
function ensureConfigured(): void {
  if (configured) return
  const apiKey = process.env.FAL_KEY
  if (!apiKey) throw new Error('FAL_KEY is not set')
  fal.config({ credentials: apiKey })
  configured = true
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '?'
}

export function buildTexturePrompt(
  roofSegments: MeshyRoofSegment[],
  dims: MeshyDims,
): string {
  const segDescs = roofSegments
    .slice(0, 8)
    .map(
      (s, i) =>
        `seg${i + 1} pitch ${fmt(s.pitchDeg, 0)}°/azimuth ${fmt(s.azimuthDeg, 0)}° (MCS)/area ${fmt(s.areaM2)}m²`,
    )
  const segPart = segDescs.length ? `Roof segments: ${segDescs.join('. ')}.` : ''
  return [
    'UK single-family house.',
    segPart,
    `Footprint ${fmt(dims.widthM)}m × ${fmt(dims.depthM)}m, eaves ${fmt(dims.eaveHeightM)}m, ridge ${fmt(dims.ridgeHeightM)}m.`,
    'Materials: clay roof tiles, brick walls, painted timber windows.',
  ]
    .filter(Boolean)
    .join(' ')
}

async function uploadImage(buf: Buffer): Promise<string> {
  const file = new File([new Uint8Array(buf)], 'view.png', { type: 'image/png' })
  return fal.storage.upload(file)
}

async function downloadGlb(url: string, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Meshy GLB download failed: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

interface FalQueueUpdate {
  status: string
  logs?: Array<{ message: string }>
  progress?: { progress?: number; percent?: number }
}

interface FalMeshyResult {
  data: {
    model_glb?: { url: string }
    model_mesh?: { url: string }
  }
}

export async function generateGlb(input: MeshyInput): Promise<MeshyOutput> {
  ensureConfigured()

  if (input.images.length === 0) throw new Error('generateGlb requires at least 1 image')
  if (input.images.length > 4) throw new Error('generateGlb accepts at most 4 images')

  // Sanity-check inputs before paying for an upload + queue run. fal returns
  // a generic 500 if anything in image_urls is unreachable or oversized, and
  // its error body just says "Internal Server Error" — easier to fail fast.
  for (let i = 0; i < input.images.length; i++) {
    const buf = input.images[i]
    if (!buf || buf.length === 0) throw new Error(`Meshy image #${i} is empty`)
    if (buf.length > 8 * 1024 * 1024) {
      throw new Error(`Meshy image #${i} is ${buf.length} bytes (>8MB cap)`)
    }
  }
  console.log('[meshy] uploading', input.images.length, 'images, sizes:',
    input.images.map((b) => b.length))

  const imageUrls = await Promise.all(input.images.map((b) => uploadImage(b)))
  console.log('[meshy] image urls:', imageUrls)

  let result: FalMeshyResult
  try {
    result = (await fal.subscribe(endpoint(), {
      input: {
        image_urls: imageUrls,
        texture_prompt: input.texturePrompt,
        target_polycount: input.targetPolycount ?? defaultPolycount(),
        enable_pbr: input.enablePbr ?? true,
        should_remesh: true,
      },
      logs: true,
      onQueueUpdate: (update: FalQueueUpdate) => {
        const status = (update.status || '').toUpperCase()
        const pct = update.progress?.percent ?? update.progress?.progress
        if (status === 'IN_QUEUE' || status === 'QUEUED') {
          input.onProgress?.('queued', pct)
        } else if (status === 'IN_PROGRESS') {
          input.onProgress?.('in_progress', pct)
        } else if (status === 'COMPLETED') {
          input.onProgress?.('completed', 1)
        }
      },
    })) as FalMeshyResult
  } catch (err) {
    // The fal-ai/client ApiError stores the JSON response body on `.body`.
    // Surface it so we can see the actual validation / generation failure.
    const body = (err as { body?: unknown }).body
    const status = (err as { status?: number }).status
    console.error('[meshy] fal.subscribe failed', {
      status,
      endpoint: endpoint(),
      texturePromptPreview: input.texturePrompt.slice(0, 200),
      body: body ? JSON.stringify(body, null, 2) : undefined,
    })
    throw err
  }

  const glbUrl = result.data.model_glb?.url ?? result.data.model_mesh?.url
  if (!glbUrl) throw new Error('Meshy response did not contain a GLB url')

  const glb = await downloadGlb(glbUrl, input.signal)
  return { glb, rawGlbUrl: glbUrl }
}
