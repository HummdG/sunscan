/**
 * @deprecated The Claude-Sonnet-based BuildingSpec pipeline has been replaced
 * by the Meshy + roof-correction flow in
 * `/api/report/[id]/reconstruction/generate`. The route file at
 * `src/app/api/report/[id]/reconstruction/spec/route.ts` is no longer reached
 * from the 3D viewer. Slated for removal after the new pipeline is validated.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  BuildingSpecSchema,
  buildingSpecJsonSchema,
  FALLBACK_SPEC,
  type BuildingSpec,
} from '@/lib/3d/buildingSpec'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

export interface BuildingSpecAgentInput {
  /** Base64-encoded PNG bytes for the 3 cardinal photos (S/E/N) */
  photos: { front: string; right: string; back: string }
  footprint: Array<[number, number]>
  roofSegments: Array<{
    pitchDeg: number; azimuthDeg: number; areaM2: number
    centerLng: number; centerLat: number
  }>
  eaveHeightM: number
  dimensionsM: { x: number; y: number; z: number }
  signal?: AbortSignal
}

export type AgentResult =
  | { ok: true; spec: BuildingSpec; rawTokens: { input: number; output: number } }
  | { ok: false; reason: 'no-api-key' | 'api-error' | 'schema-invalid'; details: string }

export async function generateBuildingSpec(
  input: BuildingSpecAgentInput,
): Promise<AgentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { ok: false, reason: 'no-api-key', details: 'ANTHROPIC_API_KEY not set' }
  }

  const client = new Anthropic({ apiKey })
  const context = buildContextBlock(input)

  const tool: Anthropic.Tool = {
    name: 'emit_building_spec',
    description: 'Emit a structured BuildingSpec describing this UK residential property.',
    input_schema: buildingSpecJsonSchema as Anthropic.Tool['input_schema'],
  }

  const userContent: Anthropic.MessageParam['content'] = [
    { type: 'text', text: context },
    { type: 'text', text: 'Photo 1 — camera at SOUTH, looking NORTH (shows south face):' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: input.photos.front } },
    { type: 'text', text: 'Photo 2 — camera at EAST, looking WEST (shows east face):' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: input.photos.right } },
    { type: 'text', text: 'Photo 3 — camera at NORTH, looking SOUTH (shows north face):' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: input.photos.back } },
  ]

  const baseRequest = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    tools: [tool],
    tool_choice: { type: 'tool' as const, name: 'emit_building_spec' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: userContent }],
  }

  try {
    const response = await client.messages.create(baseRequest, { signal: input.signal })
    const result = extractAndValidate(response)
    if (result.ok) {
      return {
        ok: true,
        spec: result.spec,
        rawTokens: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      }
    }

    // Retry once with the validation error appended to the system prompt
    const retryRequest = {
      ...baseRequest,
      system: SYSTEM_PROMPT + '\n\nYour previous response had these schema errors. Fix them:\n' + result.errors.join('\n'),
    }
    const retry = await client.messages.create(retryRequest, { signal: input.signal })
    const retryResult = extractAndValidate(retry)
    if (retryResult.ok) {
      return {
        ok: true,
        spec: retryResult.spec,
        rawTokens: { input: retry.usage.input_tokens, output: retry.usage.output_tokens },
      }
    }
    return { ok: false, reason: 'schema-invalid', details: retryResult.errors.join('; ') }
  } catch (e) {
    return { ok: false, reason: 'api-error', details: (e as Error).message }
  }
}

function extractAndValidate(
  response: Anthropic.Message,
): { ok: true; spec: BuildingSpec } | { ok: false; errors: string[] } {
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) {
    return { ok: false, errors: ['Response contained no tool_use block'] }
  }
  return parseAndValidateSpec(toolUse.input)
}

export function parseAndValidateSpec(
  input: unknown,
): { ok: true; spec: BuildingSpec } | { ok: false; errors: string[] } {
  const result = BuildingSpecSchema.safeParse(input)
  if (result.success) return { ok: true, spec: result.data }
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  }
}

export interface ContextBlockInput {
  footprint: Array<[number, number]>
  roofSegments: BuildingSpecAgentInput['roofSegments']
  eaveHeightM: number
  dimensionsM: { x: number; y: number; z: number }
}

export function buildContextBlock(input: ContextBlockInput): string {
  const edges = input.footprint.map((p, i) => {
    const next = input.footprint[(i + 1) % input.footprint.length]
    const len = Math.hypot(next[0] - p[0], next[1] - p[1])
    const bearing = Math.atan2(next[0] - p[0], -(next[1] - p[1])) * 180 / Math.PI
    const bearingDeg = ((bearing + 360) % 360).toFixed(0)
    return `EDGE ${i}: length ${len.toFixed(2)} m, bearing ${bearingDeg}°`
  }).join('\n  ')

  const segments = input.roofSegments.length === 0
    ? 'no Solar API segments available — infer roof topology from photos and footprint shape.'
    : input.roofSegments.map((s, i) =>
        `Segment ${i}: pitch ${s.pitchDeg.toFixed(0)}°, azimuth ${s.azimuthDeg.toFixed(0)}° (MCS), area ${s.areaM2.toFixed(0)} m²`
      ).join('\n  ')

  return [
    'You are reconstructing a 3D model of a UK residential property from 3 aerial photos and known geometric data.',
    '',
    'FOOTPRINT (Ordnance Survey, authoritative):',
    `  ${edges}`,
    `  (ring closes back to edge 0; coordinates are in metres in local frame, +x=east, +z=south, origin at footprint centroid)`,
    '',
    'GOOGLE SOLAR API ROOF SEGMENTS (primary source for roof planes when present):',
    `  ${segments}`,
    '',
    `EAVE HEIGHT ESTIMATE: ${input.eaveHeightM.toFixed(1)} m`,
    `BUILDING BBOX: ${input.dimensionsM.x.toFixed(1)} × ${input.dimensionsM.y.toFixed(1)} × ${input.dimensionsM.z.toFixed(1)} m  (x × y × z)`,
    '',
    'YOUR JOB:',
    '1. From footprint + Solar segments, decide roof topology and which footprint edge each plane sits on.',
    '2. From photos, identify chimneys, dormers, conservatory, garage. Use realistic UK domestic scales.',
    '3. From photos, sample dominant wall and roof colour (hex) and classify material family.',
    '4. Emit ONE call to emit_building_spec with the result.',
    '',
    'Rules:',
    '- Never invent geometry not supported by footprint or visible features.',
    '- If Solar segments conflict with photos, trust the photos.',
    '- If a feature is ambiguous, omit it. Empty arrays are correct outputs.',
    '- Origin = footprint centroid. +x east, +z south. Metres.',
    '- Confidence: "high" if all signals agree; "medium" on conflict; "low" on obstructions or imprecise locations.',
  ].join('\n')
}

const SYSTEM_PROMPT = `You are a careful 3D-model reconstruction assistant. You receive an authoritative footprint polygon, optional Google Solar API roof-segment data, and 3 aerial photos. You emit a strict, schema-validated BuildingSpec by calling the emit_building_spec tool. You never reply in prose.

Coordinate frame: origin = footprint centroid, +x = east, +z = south, +y = up, metres throughout. Azimuths use MCS convention: 0° = south, 90° = east, 180° = north, 270° = west.

Realistic UK domestic scales:
- Eave height: 2.5-8 m (typical 5-6 m for a 2-storey house).
- Roof pitch: 15-45° typical.
- Chimney: 0.8-1.5 m wide, 0.8-2.0 m above roof.
- Dormer: 0.8-2.5 m wide, 0.8-1.8 m tall, 0.5-1.5 m projection.
- Conservatory: 3-5 m wide, 3-5 m deep.
- Garage: 2.7-3.5 m wide for single, 5-6 m for double; 5-6 m deep.

When ambiguous, prefer the simpler answer (omit the feature). The renderer can handle empty feature arrays. Set confidence to "low" if photos are obstructed or features can't be located precisely.`

export { FALLBACK_SPEC }
