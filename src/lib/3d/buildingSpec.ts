import { z } from 'zod'

/**
 * Local coordinate system used throughout the spec:
 *   • Origin at footprint centroid (lat,lng).
 *   • +x = east, +z = south (Three.js convention used by SolarRoofViewer).
 *   • +y = up, in metres above ground (ground = y=0).
 *   • All distances in metres.
 *   • All azimuths in MCS convention (0° = S, 90° = E, 180° = N, 270° = W).
 */

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color like #aabbcc')

const RoofPlane = z.object({
  footprintEdgeIndex: z.number().int().min(0),
  pitchDeg: z.number().min(0).max(60),
  azimuthDeg: z.number().min(0).max(360),
  ridgeSharedWithPlaneIndex: z.number().int().min(0).optional(),
})

const Roof = z.object({
  type: z.enum(['gable', 'hip', 'mansard', 'flat', 'mixed']),
  planes: z.array(RoofPlane).min(1),
})

const Chimney = z.object({
  x: z.number(),
  z: z.number(),
  widthM: z.number().min(0.3).max(3),
  depthM: z.number().min(0.3).max(3),
  heightAboveRoofM: z.number().min(0.2).max(3.5),
})

const Dormer = z.object({
  footprintEdgeIndex: z.number().int().min(0),
  offsetAlongEdgeM: z.number().min(0),
  widthM: z.number().min(0.5).max(6),
  heightM: z.number().min(0.5).max(3),
  projectionM: z.number().min(0.2).max(2.5),
  roofType: z.enum(['gable', 'hip', 'flat']),
})

const Conservatory = z.object({
  footprintEdgeIndex: z.number().int().min(0),
  offsetAlongEdgeM: z.number().min(0),
  widthM: z.number().min(1.5).max(8),
  depthM: z.number().min(1.5).max(8),
  heightM: z.number().min(1.5).max(5),
})

const Garage = z.object({
  footprintEdgeIndex: z.number().int().min(0),
  offsetAlongEdgeM: z.number().min(0),
  widthM: z.number().min(2).max(8),
  depthM: z.number().min(2.5).max(9),
  heightM: z.number().min(2).max(5),
  attachment: z.enum(['attached', 'detached']),
})

const Features = z.object({
  chimneys: z.array(Chimney).default([]),
  dormers: z.array(Dormer).default([]),
  conservatory: Conservatory.optional(),
  garage: Garage.optional(),
})

const Materials = z.object({
  wallColor: HexColor,
  roofColor: HexColor,
  wallTexture: z.enum(['brick', 'render', 'stone', 'timber', 'pebble-dash', 'mixed']),
  roofTexture: z.enum(['tile', 'slate', 'thatch', 'metal', 'flat-felt']),
})

export const BuildingSpecSchema = z.object({
  eaveHeightM: z.number().min(2).max(20),
  roof: Roof,
  features: Features,
  materials: Materials,
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().max(2000).optional(),
})

export type BuildingSpec = z.infer<typeof BuildingSpecSchema>

/**
 * Deterministic default. Returned by the API route when the LLM call fails or
 * is unavailable. The renderer produces a usable building from this alone.
 */
export const FALLBACK_SPEC: BuildingSpec = {
  eaveHeightM: 5.8,
  roof: {
    type: 'gable',
    planes: [
      { footprintEdgeIndex: 0, pitchDeg: 35, azimuthDeg: 0 },
      { footprintEdgeIndex: 2, pitchDeg: 35, azimuthDeg: 180 },
    ],
  },
  features: { chimneys: [], dormers: [] },
  materials: {
    wallColor: '#cccccc',
    roofColor: '#7a5a3a',
    wallTexture: 'render',
    roofTexture: 'tile',
  },
  confidence: 'low',
  notes: 'Fallback spec — LLM unavailable or invalid response.',
}

/**
 * JSON Schema used as the `input_schema` for Anthropic tool_use. Zod 4's
 * `z.toJSONSchema()` produces a Draft 2020-12 schema by default; Anthropic
 * accepts both Draft 7 and 2020-12.
 */
export const buildingSpecJsonSchema = z.toJSONSchema(BuildingSpecSchema)
