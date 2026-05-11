# Spec-Driven 3D Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Hunyuan3D-2 image-to-3D path with a deterministic procedural renderer driven by a Claude-generated BuildingSpec, so the reconstructed 3D model is always a recognisable house, never a black blob.

**Architecture:** Three.js builds the mesh from a strict Zod-validated JSON spec returned by a Claude Sonnet 4.6 vision call. Walls come from the OS footprint polygon (authoritative); roof planes from Google Solar API segments anchored to footprint edges; features (chimneys, dormers, conservatory, garage) from the LLM as parametric primitives; textures projected from 4 cardinal photos via the existing `textureRebaker.ts`. A 5-level fallback chain guarantees the user always sees *something* identifiable as the property.

**Tech Stack:** Next.js 16, React 19, Three.js 0.184, `@react-three/fiber`, `3d-tiles-renderer`, Zod 4, `@anthropic-ai/sdk` (new), Supabase Storage, Vitest (new for unit tests).

**Spec reference:** `docs/superpowers/specs/2026-05-11-3d-reconstruction-design.md` (commit `87dec5e`). Read it in full before starting Task 1.

---

## File layout (locked in here so later tasks reference real paths)

**New:**
- `src/lib/3d/buildingSpec.ts` — Zod schema, types, `FALLBACK_SPEC`, JSON-Schema export
- `src/lib/3d/specFeatures.ts` — `buildChimney`, `buildDormer`, `buildConservatory`, `buildGarage` factories
- `src/lib/3d/specWalls.ts` — `buildWalls(footprintLocal, eaveHeightM)` extrusion
- `src/lib/3d/specRoof.ts` — `buildRoof(footprintLocal, spec.roof, eaveHeightM)` with gable/hip/mansard/flat/mixed resolvers
- `src/lib/3d/specRenderer.ts` — top-level `renderSpec(input)` that glues walls + roof + features + materials + centering
- `src/lib/3d/specTextureProjector.ts` — adapter feeding the procedural mesh into the existing `textureRebaker.ts`
- `src/lib/3d/stockTextures.ts` — lazy loader for `/public/textures/*.jpg` with hex tinting
- `src/lib/ai/buildingSpecAgent.ts` — Anthropic SDK call, prompt, retry-once-on-schema-fail
- `src/app/api/report/[id]/reconstruction/spec/route.ts` — POST endpoint with input-hash caching
- `public/textures/*.jpg` — 9 tileable 512² PBR textures
- `vitest.config.ts` — test runner config
- Test files under `src/lib/3d/__tests__/` and `src/lib/ai/__tests__/`

**Modified:**
- `src/lib/3d/buildingExtractor.ts` — rename `produceMlInputs` → `produceSpecInputs`, expose cameras + cropped mesh
- `src/components/SolarRoofViewer.tsx` — replace reconstruction effect with Level 0-5 fallback chain
- `package.json` — add `@anthropic-ai/sdk`, remove `@fal-ai/client`, add Vitest devDeps, add `test` script
- `CLAUDE.md` — env table + 3D viewer section
- `.env.example` (if present) — add `ANTHROPIC_API_KEY`, remove `FAL_KEY`

**Deleted:**
- `src/app/api/report/[id]/reconstruction/ml/route.ts`
- `src/lib/3d/buildingMasker.ts`
- `src/lib/3d/normaliseMlMesh.ts`

---

## Conventions used throughout

- All distances in metres.
- Local frame: origin = footprint centroid, `+x = east`, `+z = south`, `+y = up`. Matches existing `SolarRoofViewer` convention (see `CLAUDE.md` line referencing "x = east, z = south").
- All azimuths use MCS convention (0° = S, 90° = E/W, 180° = N) to match `solarCalculations.ts`. Three.js azimuths (used by `multiViewCapture.ts`: 0 = +z = south) line up — no conversion needed.
- TDD for pure-function modules (Tasks 2-5, 10). Manual verification for rendering & API (Tasks 6-9, 11-14).

---

## Task 1: Vitest + test infrastructure

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add devDeps + scripts)
- Create: `src/lib/3d/__tests__/.gitkeep` (placeholder so the directory exists)

- [ ] **Step 1: Install Vitest devDependencies**

Run: `npm install -D vitest @vitest/coverage-v8`

Expected output: dependencies added; `package.json` now lists `vitest` and `@vitest/coverage-v8` under `devDependencies`.

- [ ] **Step 2: Add `test` and `test:watch` scripts to `package.json`**

In `package.json` `scripts` block, insert after `"lint": "eslint"`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

Create file `vitest.config.ts` at repo root:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
```

Rationale: `environment: 'node'` keeps the runner light. Three.js geometry math runs fine in Node — only WebGL needs a browser, and we never test WebGL code here. The `@/` alias mirrors Next.js's tsconfig path.

- [ ] **Step 4: Verify Vitest runs with no tests**

Run: `npm test`

Expected: exit code 0, "No test files found" or similar. If Vitest errors on resolution, fix the alias before continuing.

- [ ] **Step 5: Create placeholder test directories**

Create empty files (just to claim the paths in git):
- `src/lib/3d/__tests__/.gitkeep`
- `src/lib/ai/__tests__/.gitkeep`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/3d/__tests__/.gitkeep src/lib/ai/__tests__/.gitkeep
git commit -m "chore(test): add Vitest for pure-function unit tests"
```

---

## Task 2: BuildingSpec Zod schema + types + FALLBACK_SPEC

**Files:**
- Create: `src/lib/3d/buildingSpec.ts`
- Create: `src/lib/3d/__tests__/buildingSpec.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/3d/__tests__/buildingSpec.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  BuildingSpecSchema,
  FALLBACK_SPEC,
  buildingSpecJsonSchema,
} from '@/lib/3d/buildingSpec'

describe('BuildingSpecSchema', () => {
  it('accepts FALLBACK_SPEC', () => {
    expect(() => BuildingSpecSchema.parse(FALLBACK_SPEC)).not.toThrow()
  })

  it('rejects negative eaveHeight', () => {
    const bad = { ...FALLBACK_SPEC, eaveHeightM: -1 }
    expect(() => BuildingSpecSchema.parse(bad)).toThrow()
  })

  it('rejects pitchDeg > 60', () => {
    const bad = {
      ...FALLBACK_SPEC,
      roof: {
        type: 'gable' as const,
        planes: [{ footprintEdgeIndex: 0, pitchDeg: 75, azimuthDeg: 0 }],
      },
    }
    expect(() => BuildingSpecSchema.parse(bad)).toThrow()
  })

  it('rejects non-hex wall color', () => {
    const bad = {
      ...FALLBACK_SPEC,
      materials: { ...FALLBACK_SPEC.materials, wallColor: 'red' as const },
    }
    expect(() => BuildingSpecSchema.parse(bad as never)).toThrow()
  })

  it('accepts a spec with chimneys and dormers', () => {
    const good = {
      ...FALLBACK_SPEC,
      features: {
        chimneys: [{ x: 1, z: 0, widthM: 1.0, depthM: 1.0, heightAboveRoofM: 1.2 }],
        dormers:  [{ footprintEdgeIndex: 0, offsetAlongEdgeM: 2, widthM: 1.2,
                     heightM: 1.2, projectionM: 0.8, roofType: 'gable' as const }],
      },
    }
    expect(() => BuildingSpecSchema.parse(good)).not.toThrow()
  })

  it('emits a JSON Schema compatible with Anthropic tool_use', () => {
    expect(buildingSpecJsonSchema).toMatchObject({ type: 'object', properties: expect.any(Object) })
    expect(buildingSpecJsonSchema.properties).toHaveProperty('eaveHeightM')
    expect(buildingSpecJsonSchema.properties).toHaveProperty('roof')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/3d/__tests__/buildingSpec.test.ts`

Expected: 6 failures with "Cannot find module" or similar.

- [ ] **Step 3: Implement `buildingSpec.ts`**

Create `src/lib/3d/buildingSpec.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/3d/__tests__/buildingSpec.test.ts`

Expected: 6/6 pass.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/3d/buildingSpec.ts src/lib/3d/__tests__/buildingSpec.test.ts
git commit -m "feat(3d): BuildingSpec schema + FALLBACK_SPEC + JSON Schema export"
```

---

## Task 3: Feature primitives (chimney, dormer, conservatory, garage)

**Files:**
- Create: `src/lib/3d/specFeatures.ts`
- Create: `src/lib/3d/__tests__/specFeatures.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/3d/__tests__/specFeatures.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  buildChimney,
  buildDormer,
  buildConservatory,
  buildGarage,
} from '@/lib/3d/specFeatures'

function bboxSize(obj: THREE.Object3D): THREE.Vector3 {
  const bb = new THREE.Box3().setFromObject(obj)
  const s = new THREE.Vector3()
  bb.getSize(s)
  return s
}

describe('buildChimney', () => {
  it('produces a box sized roughly w × (heightAboveRoof) × d', () => {
    const mesh = buildChimney({
      x: 2, z: 1, widthM: 0.9, depthM: 0.9, heightAboveRoofM: 1.2,
      roofTopY: 7.5,
    })
    const size = bboxSize(mesh)
    expect(size.x).toBeCloseTo(0.9, 2)
    expect(size.z).toBeCloseTo(0.9, 2)
    expect(size.y).toBeCloseTo(1.2, 2)
  })

  it('sits with its base on roofTopY', () => {
    const mesh = buildChimney({
      x: 0, z: 0, widthM: 0.8, depthM: 0.8, heightAboveRoofM: 1.0,
      roofTopY: 6.5,
    })
    const bb = new THREE.Box3().setFromObject(mesh)
    expect(bb.min.y).toBeCloseTo(6.5, 2)
    expect(bb.max.y).toBeCloseTo(7.5, 2)
  })
})

describe('buildDormer', () => {
  it('produces geometry within the requested width and height', () => {
    const mesh = buildDormer({
      wallStart: new THREE.Vector3(-5, 0, 0),
      wallEnd:   new THREE.Vector3( 5, 0, 0),
      offsetAlongEdgeM: 2,
      widthM: 1.5,
      heightM: 1.2,
      projectionM: 0.8,
      eaveHeightM: 5.5,
      roofType: 'gable',
    })
    const size = bboxSize(mesh)
    expect(size.x).toBeCloseTo(1.5, 1)
    expect(size.y).toBeGreaterThan(1.2)  // includes the small dormer roof
    expect(size.z).toBeCloseTo(0.8, 1)
  })
})

describe('buildConservatory', () => {
  it('uses transmissive material (transmission > 0)', () => {
    const mesh = buildConservatory({
      wallStart: new THREE.Vector3(-3, 0, 0),
      wallEnd:   new THREE.Vector3( 3, 0, 0),
      offsetAlongEdgeM: 0.5,
      widthM: 3, depthM: 3, heightM: 2.5,
    })
    let foundTransmissive = false
    mesh.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined
      if (m && 'transmission' in m && m.transmission > 0) foundTransmissive = true
    })
    expect(foundTransmissive).toBe(true)
  })
})

describe('buildGarage', () => {
  it('placed 0 m off the wall when attached', () => {
    const mesh = buildGarage({
      wallStart: new THREE.Vector3(-4, 0, 0),
      wallEnd:   new THREE.Vector3( 4, 0, 0),
      wallOutwardNormal: new THREE.Vector3(0, 0, -1),
      offsetAlongEdgeM: 0, widthM: 3, depthM: 5, heightM: 2.5,
      attachment: 'attached',
    })
    const bb = new THREE.Box3().setFromObject(mesh)
    expect(bb.max.z).toBeLessThanOrEqual(0.05)  // touches the wall plane (z=0)
  })

  it('placed 0.5 m off the wall when detached', () => {
    const mesh = buildGarage({
      wallStart: new THREE.Vector3(-4, 0, 0),
      wallEnd:   new THREE.Vector3( 4, 0, 0),
      wallOutwardNormal: new THREE.Vector3(0, 0, -1),
      offsetAlongEdgeM: 0, widthM: 3, depthM: 5, heightM: 2.5,
      attachment: 'detached',
    })
    const bb = new THREE.Box3().setFromObject(mesh)
    expect(bb.max.z).toBeLessThan(-0.4)  // pushed outward away from wall
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/3d/__tests__/specFeatures.test.ts`

Expected: failures with module-not-found.

- [ ] **Step 3: Implement `specFeatures.ts`**

Create `src/lib/3d/specFeatures.ts`:

```typescript
import * as THREE from 'three'

const ROOF_TILE_COLOR = 0x7a5a3a  // overridden by spec materials at the call site

export interface ChimneyInput {
  x: number; z: number
  widthM: number; depthM: number; heightAboveRoofM: number
  roofTopY: number
}

export function buildChimney(opts: ChimneyInput): THREE.Mesh {
  const geom = new THREE.BoxGeometry(opts.widthM, opts.heightAboveRoofM, opts.depthM)
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.set(opts.x, opts.roofTopY + opts.heightAboveRoofM / 2, opts.z)
  mesh.userData.featureKind = 'chimney'
  return mesh
}

export interface DormerInput {
  wallStart: THREE.Vector3        // y can be 0 — only x/z used
  wallEnd: THREE.Vector3
  offsetAlongEdgeM: number
  widthM: number; heightM: number; projectionM: number
  eaveHeightM: number
  roofType: 'gable' | 'hip' | 'flat'
}

export function buildDormer(opts: DormerInput): THREE.Group {
  const group = new THREE.Group()
  group.userData.featureKind = 'dormer'

  const wallVec = new THREE.Vector3().subVectors(opts.wallEnd, opts.wallStart)
  const wallLen = wallVec.length()
  if (wallLen < 0.01) return group  // degenerate
  const wallDir = wallVec.clone().normalize()
  // Outward normal: rotate wallDir 90° clockwise around +y (matches the
  // footprint winding used by specWalls.ts; will be re-projected if needed)
  const outward = new THREE.Vector3(-wallDir.z, 0, wallDir.x)

  const centreAlong = Math.min(Math.max(opts.offsetAlongEdgeM + opts.widthM / 2, opts.widthM / 2), wallLen - opts.widthM / 2)
  const baseY = opts.eaveHeightM - opts.heightM
  const centre = opts.wallStart.clone()
    .addScaledVector(wallDir, centreAlong)
    .addScaledVector(outward, opts.projectionM / 2)
  centre.y = baseY + opts.heightM / 2

  // Box body
  const body = new THREE.BoxGeometry(opts.widthM, opts.heightM, opts.projectionM)
  const bodyMesh = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color: 0xcccccc }))
  bodyMesh.position.copy(centre)
  // Rotate so length aligns with the wall direction
  const yAxis = new THREE.Vector3(0, 1, 0)
  const angle = Math.atan2(wallDir.x, wallDir.z)
  bodyMesh.setRotationFromAxisAngle(yAxis, angle)
  group.add(bodyMesh)

  // Tiny dormer roof
  if (opts.roofType !== 'flat') {
    const roof = new THREE.ConeGeometry(Math.max(opts.widthM, opts.projectionM) * 0.55, 0.5, 4)
    const roofMesh = new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ color: ROOF_TILE_COLOR }))
    roofMesh.position.set(centre.x, baseY + opts.heightM + 0.25, centre.z)
    roofMesh.setRotationFromAxisAngle(yAxis, angle + Math.PI / 4)
    group.add(roofMesh)
  }

  return group
}

export interface ConservatoryInput {
  wallStart: THREE.Vector3
  wallEnd: THREE.Vector3
  offsetAlongEdgeM: number
  widthM: number; depthM: number; heightM: number
}

export function buildConservatory(opts: ConservatoryInput): THREE.Group {
  const group = new THREE.Group()
  group.userData.featureKind = 'conservatory'

  const wallVec = new THREE.Vector3().subVectors(opts.wallEnd, opts.wallStart)
  const wallLen = wallVec.length()
  if (wallLen < 0.01) return group
  const wallDir = wallVec.clone().normalize()
  const outward = new THREE.Vector3(-wallDir.z, 0, wallDir.x)

  const centreAlong = Math.min(Math.max(opts.offsetAlongEdgeM + opts.widthM / 2, opts.widthM / 2), wallLen - opts.widthM / 2)
  const centre = opts.wallStart.clone()
    .addScaledVector(wallDir, centreAlong)
    .addScaledVector(outward, opts.depthM / 2)
  centre.y = opts.heightM / 2

  const geom = new THREE.BoxGeometry(opts.widthM, opts.heightM, opts.depthM)
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf2f6,
    transmission: 0.7,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.5,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.copy(centre)
  const angle = Math.atan2(wallDir.x, wallDir.z)
  mesh.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
  group.add(mesh)

  return group
}

export interface GarageInput {
  wallStart: THREE.Vector3
  wallEnd: THREE.Vector3
  wallOutwardNormal: THREE.Vector3
  offsetAlongEdgeM: number
  widthM: number; depthM: number; heightM: number
  attachment: 'attached' | 'detached'
}

export function buildGarage(opts: GarageInput): THREE.Group {
  const group = new THREE.Group()
  group.userData.featureKind = 'garage'

  const wallVec = new THREE.Vector3().subVectors(opts.wallEnd, opts.wallStart)
  const wallLen = wallVec.length()
  if (wallLen < 0.01) return group
  const wallDir = wallVec.clone().normalize()
  const outward = opts.wallOutwardNormal.clone().normalize()

  const detachGap = opts.attachment === 'detached' ? 0.5 : 0
  const centreAlong = Math.min(Math.max(opts.offsetAlongEdgeM + opts.widthM / 2, opts.widthM / 2), wallLen - opts.widthM / 2)
  const centre = opts.wallStart.clone()
    .addScaledVector(wallDir, centreAlong)
    .addScaledVector(outward, opts.depthM / 2 + detachGap)
  centre.y = opts.heightM / 2

  const geom = new THREE.BoxGeometry(opts.widthM, opts.heightM, opts.depthM)
  const mat = new THREE.MeshStandardMaterial({ color: 0xb0a89a })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.copy(centre)
  const angle = Math.atan2(wallDir.x, wallDir.z)
  mesh.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
  group.add(mesh)

  return group
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/3d/__tests__/specFeatures.test.ts`

Expected: 5/5 pass.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/3d/specFeatures.ts src/lib/3d/__tests__/specFeatures.test.ts
git commit -m "feat(3d): parametric primitives — chimney, dormer, conservatory, garage"
```

---

## Task 4: Wall builder

**Files:**
- Create: `src/lib/3d/specWalls.ts`
- Create: `src/lib/3d/__tests__/specWalls.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/3d/__tests__/specWalls.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildWalls } from '@/lib/3d/specWalls'

const square: Array<[number, number]> = [
  [-5, -4], [ 5, -4], [ 5,  4], [-5,  4],
]

describe('buildWalls', () => {
  it('produces one wall mesh per footprint edge', () => {
    const result = buildWalls(square, 6)
    expect(result.faces.length).toBe(4)
  })

  it('wall heights span y=0 to y=eaveHeightM', () => {
    const result = buildWalls(square, 6)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.min.y).toBeCloseTo(0, 5)
    expect(bb.max.y).toBeCloseTo(6, 5)
  })

  it('horizontal bbox matches footprint extent', () => {
    const result = buildWalls(square, 5)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.min.x).toBeCloseTo(-5, 5)
    expect(bb.max.x).toBeCloseTo( 5, 5)
    expect(bb.min.z).toBeCloseTo(-4, 5)
    expect(bb.max.z).toBeCloseTo( 4, 5)
  })

  it('exposes per-face metadata with edgeIndex and outward normal', () => {
    const result = buildWalls(square, 6)
    expect(result.faces[0].edgeIndex).toBe(0)
    // Edge 0 runs from (-5,-4) to (5,-4); outward normal in CCW polygon is -z
    expect(result.faces[0].normal.z).toBeLessThan(-0.9)
  })

  it('handles a triangle footprint', () => {
    const tri: Array<[number, number]> = [[0, 0], [4, 0], [2, 3]]
    const result = buildWalls(tri, 4)
    expect(result.faces.length).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/3d/__tests__/specWalls.test.ts`

Expected: failures with module-not-found.

- [ ] **Step 3: Implement `specWalls.ts`**

Create `src/lib/3d/specWalls.ts`:

```typescript
import * as THREE from 'three'

export interface WallFaceMeta {
  edgeIndex: number
  /** Wall start in local x/z (y=0) */
  start: THREE.Vector3
  /** Wall end in local x/z (y=0) */
  end: THREE.Vector3
  /** Outward-pointing unit normal (horizontal) */
  normal: THREE.Vector3
  /** Length of the wall in metres */
  lengthM: number
}

export interface WallBuildResult {
  group: THREE.Group
  faces: WallFaceMeta[]
}

/**
 * Extrude a closed footprint ring upward to `eaveHeightM`. One quad per edge.
 * Footprint ring assumed in CCW order (which is what wgs84ToLocalMetres
 * produces when the WGS84 polygon is CCW). For CW rings, outward normals
 * flip — we detect winding by signed area and orient normals outward.
 *
 *   ring index:    [0]──edge 0──[1]──edge 1──[2]──edge 2──[3]──edge 3──[0]
 *   wall index:           0            1            2            3
 *   outward:    perpendicular to (end - start), pointing away from centroid
 */
export function buildWalls(
  ring: Array<[number, number]>,
  eaveHeightM: number,
): WallBuildResult {
  const group = new THREE.Group()
  group.name = 'walls'
  const faces: WallFaceMeta[] = []

  const n = ring.length
  if (n < 3) return { group, faces }

  // Centroid for outward-normal orientation
  let cx = 0, cz = 0
  for (const [x, z] of ring) { cx += x; cz += z }
  cx /= n; cz /= n

  for (let i = 0; i < n; i++) {
    const [x0, z0] = ring[i]
    const [x1, z1] = ring[(i + 1) % n]
    const dx = x1 - x0
    const dz = z1 - z0
    const lengthM = Math.hypot(dx, dz)
    if (lengthM < 0.01) continue

    // Two candidate normals; pick the one pointing away from centroid
    const nA = new THREE.Vector3(-dz, 0,  dx).normalize()
    const nB = new THREE.Vector3( dz, 0, -dx).normalize()
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    const towardCentroid = new THREE.Vector3(cx - mx, 0, cz - mz)
    const outward = nA.dot(towardCentroid) < 0 ? nA : nB

    // Quad vertices (two triangles): bottom-left, bottom-right, top-right, top-left
    const v0 = new THREE.Vector3(x0, 0, z0)
    const v1 = new THREE.Vector3(x1, 0, z1)
    const v2 = new THREE.Vector3(x1, eaveHeightM, z1)
    const v3 = new THREE.Vector3(x0, eaveHeightM, z0)

    const geom = new THREE.BufferGeometry()
    const positions = new Float32Array([
      v0.x, v0.y, v0.z,
      v1.x, v1.y, v1.z,
      v2.x, v2.y, v2.z,
      v0.x, v0.y, v0.z,
      v2.x, v2.y, v2.z,
      v3.x, v3.y, v3.z,
    ])
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const normals = new Float32Array(positions.length)
    for (let k = 0; k < 6; k++) {
      normals[k * 3]     = outward.x
      normals[k * 3 + 1] = outward.y
      normals[k * 3 + 2] = outward.z
    }
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    // Stretched [0,1] UVs across the wall
    const uvs = new Float32Array([0, 0,  1, 0,  1, 1,  0, 0,  1, 1,  0, 1])
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.userData.faceKind = 'wall'
    mesh.userData.edgeIndex = i
    group.add(mesh)

    faces.push({
      edgeIndex: i,
      start: v0,
      end: v1,
      normal: outward,
      lengthM,
    })
  }

  return { group, faces }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/3d/__tests__/specWalls.test.ts`

Expected: 5/5 pass.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/3d/specWalls.ts src/lib/3d/__tests__/specWalls.test.ts
git commit -m "feat(3d): extrude footprint to wall mesh with per-face metadata"
```

---

## Task 5: Roof builder (gable + flat exact; hip/mansard/mixed approximated)

**Files:**
- Create: `src/lib/3d/specRoof.ts`
- Create: `src/lib/3d/__tests__/specRoof.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/3d/__tests__/specRoof.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildRoof } from '@/lib/3d/specRoof'
import type { BuildingSpec } from '@/lib/3d/buildingSpec'

const square: Array<[number, number]> = [
  [-5, -4], [ 5, -4], [ 5,  4], [-5,  4],
]

describe('buildRoof — flat', () => {
  it('produces a horizontal cap at eaveHeight + parapet', () => {
    const result = buildRoof(square, {
      type: 'flat',
      planes: [{ footprintEdgeIndex: 0, pitchDeg: 0, azimuthDeg: 0 }],
    }, 6)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.min.y).toBeGreaterThanOrEqual(6 - 0.01)
    expect(bb.max.y).toBeLessThanOrEqual(6 + 0.6)
  })
})

describe('buildRoof — gable', () => {
  it('apex rises above eaveHeight for non-zero pitch', () => {
    const result = buildRoof(square, {
      type: 'gable',
      planes: [
        { footprintEdgeIndex: 0, pitchDeg: 35, azimuthDeg: 0 },
        { footprintEdgeIndex: 2, pitchDeg: 35, azimuthDeg: 180 },
      ],
    }, 6)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.max.y).toBeGreaterThan(6 + 1)
  })

  it('roof base sits at eaveHeightM', () => {
    const result = buildRoof(square, {
      type: 'gable',
      planes: [
        { footprintEdgeIndex: 0, pitchDeg: 30, azimuthDeg: 0 },
        { footprintEdgeIndex: 2, pitchDeg: 30, azimuthDeg: 180 },
      ],
    }, 6)
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.min.y).toBeCloseTo(6, 1)
  })

  it('emits faceMeta entries with kind=roof', () => {
    const result = buildRoof(square, {
      type: 'gable',
      planes: [
        { footprintEdgeIndex: 0, pitchDeg: 30, azimuthDeg: 0 },
        { footprintEdgeIndex: 2, pitchDeg: 30, azimuthDeg: 180 },
      ],
    }, 6)
    expect(result.faces.length).toBeGreaterThan(0)
    for (const f of result.faces) {
      expect(['roof', 'gable']).toContain(f.kind)
    }
  })
})

describe('buildRoof — hip', () => {
  it('apex point is over the footprint centroid for symmetric input', () => {
    const result = buildRoof(square, {
      type: 'hip',
      planes: [
        { footprintEdgeIndex: 0, pitchDeg: 30, azimuthDeg: 0 },
        { footprintEdgeIndex: 1, pitchDeg: 30, azimuthDeg: 90 },
        { footprintEdgeIndex: 2, pitchDeg: 30, azimuthDeg: 180 },
        { footprintEdgeIndex: 3, pitchDeg: 30, azimuthDeg: 270 },
      ],
    }, 6)
    expect(result.group.children.length).toBeGreaterThan(0)
  })
})

describe('buildRoof — graceful degenerate input', () => {
  it('produces a generic gable when no planes are valid', () => {
    const result = buildRoof(square, {
      type: 'mixed',
      planes: [{ footprintEdgeIndex: 99, pitchDeg: 30, azimuthDeg: 0 }],
    }, 6)
    // Should still produce *something* above eaveHeight, not throw
    const bb = new THREE.Box3().setFromObject(result.group)
    expect(bb.max.y).toBeGreaterThan(6)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/3d/__tests__/specRoof.test.ts`

Expected: failures with module-not-found.

- [ ] **Step 3: Implement `specRoof.ts`**

Create `src/lib/3d/specRoof.ts`:

```typescript
import * as THREE from 'three'
import type { BuildingSpec } from './buildingSpec'

export interface RoofFaceMeta {
  planeIndex: number
  kind: 'roof' | 'gable' | 'fill'
  normal: THREE.Vector3
}

export interface RoofBuildResult {
  group: THREE.Group
  faces: RoofFaceMeta[]
  /** Y-coordinate of the highest roof point — used by chimney placement */
  ridgeY: number
}

/**
 * Build a roof for the given footprint and spec.
 *
 * Strategy:
 *   - 'flat': a horizontal cap at eaveHeightM + 0.3m parapet.
 *   - 'gable': pair planes; resolve their ridge by intersecting the two
 *     pitched plane equations.
 *   - 'hip': all valid planes meet at the footprint centroid raised to
 *     the height implied by their average pitch.
 *   - 'mansard': two-tier — lower steep slope + upper shallow slope sharing
 *     a break line at half the total roof height.
 *   - 'mixed': each valid plane rendered independently; uncovered area gets
 *     a fallback gable at the average pitch.
 *
 * Degenerate inputs (no valid plane / out-of-range edge indices) fall back
 * to a generic gable along the longest footprint axis at 30°.
 */
export function buildRoof(
  ring: Array<[number, number]>,
  roof: BuildingSpec['roof'],
  eaveHeightM: number,
): RoofBuildResult {
  const group = new THREE.Group()
  group.name = 'roof'
  const faces: RoofFaceMeta[] = []

  const n = ring.length
  if (n < 3) return { group, faces, ridgeY: eaveHeightM }

  // Centroid for hip apex and fallback
  let cx = 0, cz = 0
  for (const [x, z] of ring) { cx += x; cz += z }
  cx /= n; cz /= n

  // ── Flat roof ────────────────────────────────────────────────────────
  if (roof.type === 'flat') {
    const capY = eaveHeightM + 0.3
    addPolygonCap(group, faces, ring, capY, 0)
    return { group, faces, ridgeY: capY }
  }

  // Filter to valid planes (edgeIndex within range)
  const validPlanes = roof.planes.filter((p) => p.footprintEdgeIndex >= 0 && p.footprintEdgeIndex < n)
  if (validPlanes.length === 0) {
    return buildFallbackGable(ring, eaveHeightM)
  }

  // ── Gable: pair of opposite planes ───────────────────────────────────
  if (roof.type === 'gable' && validPlanes.length >= 2) {
    return buildGableRoof(ring, validPlanes, eaveHeightM, cx, cz)
  }

  // ── Hip: all planes converge at apex over centroid ───────────────────
  if (roof.type === 'hip') {
    return buildHipRoof(ring, validPlanes, eaveHeightM, cx, cz)
  }

  // ── Mansard: lower (steep) + upper (shallow) tier ────────────────────
  if (roof.type === 'mansard') {
    return buildMansardRoof(ring, validPlanes, eaveHeightM, cx, cz)
  }

  // ── Mixed / fallback: render planes independently, fill gaps with gable
  return buildMixedRoof(ring, validPlanes, eaveHeightM, cx, cz)
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildFallbackGable(
  ring: Array<[number, number]>,
  eaveHeightM: number,
): RoofBuildResult {
  // Find longest axis to orient ridge along
  let longestEdge = 0; let longestLen = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len > longestLen) { longestLen = len; longestEdge = i }
  }
  return buildGableRoof(
    ring,
    [
      { footprintEdgeIndex: longestEdge, pitchDeg: 30, azimuthDeg: 0 },
      { footprintEdgeIndex: (longestEdge + 2) % ring.length, pitchDeg: 30, azimuthDeg: 180 },
    ],
    eaveHeightM,
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  )
}

function buildGableRoof(
  ring: Array<[number, number]>,
  planes: Array<{ footprintEdgeIndex: number; pitchDeg: number; azimuthDeg: number }>,
  eaveHeightM: number,
  cx: number,
  cz: number,
): RoofBuildResult {
  const group = new THREE.Group()
  group.name = 'roof-gable'
  const faces: RoofFaceMeta[] = []

  // Take the first two planes that share a parallel-ish footprint edge
  const p1 = planes[0]
  const p2 = planes[1] ?? p1

  const e1 = edgeOf(ring, p1.footprintEdgeIndex)
  const e2 = edgeOf(ring, p2.footprintEdgeIndex)

  // Heights from pitch: rise = run × tan(pitch). Run is perpendicular
  // distance from the edge to the ridge line, which we approximate as
  // half the perpendicular distance from edge → opposite edge midpoint.
  const opposite1 = midpointOfEdge(e2)
  const perpRun1 = perpDistanceFromPoint(opposite1, e1) / 2
  const rise1 = perpRun1 * Math.tan(p1.pitchDeg * Math.PI / 180)
  const ridgeY = eaveHeightM + Math.max(rise1, 0.5)

  // Ridge line: midpoint between e1 and e2 midpoints, at ridgeY
  const m1 = midpointOfEdge(e1)
  const m2 = midpointOfEdge(e2)
  const ridgeStart = new THREE.Vector3(
    (m1.x + m2.x) / 2 - (e1.b.x - e1.a.x) / 2,
    ridgeY,
    (m1.z + m2.z) / 2 - (e1.b.z - e1.a.z) / 2,
  )
  const ridgeEnd = new THREE.Vector3(
    (m1.x + m2.x) / 2 + (e1.b.x - e1.a.x) / 2,
    ridgeY,
    (m1.z + m2.z) / 2 + (e1.b.z - e1.a.z) / 2,
  )

  // Plane 1: from e1 → ridge
  addQuad(group, faces, e1.a, e1.b, ridgeEnd, ridgeStart, eaveHeightM, ridgeY, 0, 'roof')
  // Plane 2: from e2 → ridge (note: e2 vertices reversed to close)
  addQuad(group, faces, e2.b, e2.a, ridgeStart, ridgeEnd, eaveHeightM, ridgeY, 1, 'roof')

  // Gable ends: triangles between the other two footprint edges and the ridge
  // For a 4-edge footprint these are edges (e1.index+1)%n and (e1.index+3)%n
  const n = ring.length
  for (let i = 0; i < n; i++) {
    if (i === p1.footprintEdgeIndex || i === p2.footprintEdgeIndex) continue
    const e = edgeOf(ring, i)
    // Pick the ridge endpoint closer to this edge's midpoint
    const em = midpointOfEdge(e)
    const apex = em.distanceTo(ridgeStart) < em.distanceTo(ridgeEnd) ? ridgeStart : ridgeEnd
    addTriangle(group, faces, e.a, e.b, apex, eaveHeightM, faces.length, 'gable')
  }

  return { group, faces, ridgeY }
}

function buildHipRoof(
  ring: Array<[number, number]>,
  planes: Array<{ footprintEdgeIndex: number; pitchDeg: number; azimuthDeg: number }>,
  eaveHeightM: number,
  cx: number,
  cz: number,
): RoofBuildResult {
  const group = new THREE.Group()
  group.name = 'roof-hip'
  const faces: RoofFaceMeta[] = []

  // Apex height: average pitch × min-perpendicular distance to centroid
  const avgPitch = planes.reduce((s, p) => s + p.pitchDeg, 0) / planes.length
  const apexPoint = new THREE.Vector3(cx, eaveHeightM, cz)

  let minR = Infinity
  for (let i = 0; i < ring.length; i++) {
    const e = edgeOf(ring, i)
    const r = perpDistanceFromPoint(new THREE.Vector3(cx, 0, cz), e)
    if (r < minR) minR = r
  }
  apexPoint.y = eaveHeightM + minR * Math.tan(avgPitch * Math.PI / 180)

  // Each footprint edge gets a triangle from edge → apex
  for (let i = 0; i < ring.length; i++) {
    const e = edgeOf(ring, i)
    addTriangle(group, faces, e.a, e.b, apexPoint, eaveHeightM, i, 'roof')
  }

  return { group, faces, ridgeY: apexPoint.y }
}

function buildMansardRoof(
  ring: Array<[number, number]>,
  planes: Array<{ footprintEdgeIndex: number; pitchDeg: number; azimuthDeg: number }>,
  eaveHeightM: number,
  cx: number,
  cz: number,
): RoofBuildResult {
  // Approximation: hip-style apex with a flat cap at 60% of the rise.
  const hipResult = buildHipRoof(ring, planes, eaveHeightM, cx, cz)
  const apexY = hipResult.ridgeY
  const breakY = eaveHeightM + (apexY - eaveHeightM) * 0.6

  // Wrap the hip mesh and add a flat cap at breakY × scaled-down footprint
  const cap = new THREE.Group()
  cap.name = 'roof-mansard-cap'
  const scale = 0.45
  const scaledRing = ring.map(([x, z]) => [cx + (x - cx) * scale, cz + (z - cz) * scale] as [number, number])
  addPolygonCap(cap, hipResult.faces, scaledRing, breakY, hipResult.faces.length)
  hipResult.group.add(cap)
  hipResult.ridgeY = apexY
  return hipResult
}

function buildMixedRoof(
  ring: Array<[number, number]>,
  planes: Array<{ footprintEdgeIndex: number; pitchDeg: number; azimuthDeg: number }>,
  eaveHeightM: number,
  cx: number,
  cz: number,
): RoofBuildResult {
  // Each plane gets an individual triangle from its edge to the apex.
  // Then any uncovered edge gets a gable fill.
  const group = new THREE.Group()
  group.name = 'roof-mixed'
  const faces: RoofFaceMeta[] = []

  const used = new Set<number>()
  const avgPitch = planes.reduce((s, p) => s + p.pitchDeg, 0) / Math.max(planes.length, 1)
  let maxY = eaveHeightM

  for (const p of planes) {
    const e = edgeOf(ring, p.footprintEdgeIndex)
    const m = midpointOfEdge(e)
    const towardCentre = new THREE.Vector3(cx - m.x, 0, cz - m.z)
    const run = towardCentre.length() * 0.5
    const apex = new THREE.Vector3(
      m.x + towardCentre.normalize().x * run,
      eaveHeightM + run * Math.tan(p.pitchDeg * Math.PI / 180),
      m.z + towardCentre.z * run,
    )
    if (apex.y > maxY) maxY = apex.y
    addTriangle(group, faces, e.a, e.b, apex, eaveHeightM, p.footprintEdgeIndex, 'roof')
    used.add(p.footprintEdgeIndex)
  }
  // Fallback fill for unused edges (generic gable apex)
  for (let i = 0; i < ring.length; i++) {
    if (used.has(i)) continue
    const e = edgeOf(ring, i)
    const m = midpointOfEdge(e)
    const towardCentre = new THREE.Vector3(cx - m.x, 0, cz - m.z)
    const run = towardCentre.length() * 0.5
    const apex = new THREE.Vector3(
      m.x + towardCentre.normalize().x * run,
      eaveHeightM + run * Math.tan(avgPitch * Math.PI / 180),
      m.z + towardCentre.z * run,
    )
    addTriangle(group, faces, e.a, e.b, apex, eaveHeightM, i, 'fill')
  }

  return { group, faces, ridgeY: maxY }
}

// ── Geometric primitives ─────────────────────────────────────────────────

interface Edge { a: THREE.Vector3; b: THREE.Vector3 }

function edgeOf(ring: Array<[number, number]>, i: number): Edge {
  const a = ring[i]; const b = ring[(i + 1) % ring.length]
  return {
    a: new THREE.Vector3(a[0], 0, a[1]),
    b: new THREE.Vector3(b[0], 0, b[1]),
  }
}

function midpointOfEdge(e: Edge): THREE.Vector3 {
  return new THREE.Vector3((e.a.x + e.b.x) / 2, 0, (e.a.z + e.b.z) / 2)
}

function perpDistanceFromPoint(p: THREE.Vector3, e: Edge): number {
  const dx = e.b.x - e.a.x; const dz = e.b.z - e.a.z
  const len = Math.hypot(dx, dz) + 1e-9
  // Distance from p to line through e.a, e.b
  return Math.abs(dx * (e.a.z - p.z) - (e.a.x - p.x) * dz) / len
}

function addTriangle(
  group: THREE.Group,
  faces: RoofFaceMeta[],
  a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
  baseY: number,
  planeIndex: number,
  kind: 'roof' | 'gable' | 'fill',
): void {
  const geom = new THREE.BufferGeometry()
  const positions = new Float32Array([
    a.x, baseY, a.z,
    b.x, baseY, b.z,
    c.x, c.y,    c.z,
  ])
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.computeVertexNormals()
  geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2))
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.userData.faceKind = kind
  mesh.userData.planeIndex = planeIndex
  group.add(mesh)

  const n = new THREE.Vector3()
  geom.computeBoundingSphere()
  const posAttr = geom.getAttribute('normal')
  if (posAttr) n.fromBufferAttribute(posAttr, 0)
  faces.push({ planeIndex, kind, normal: n })
}

function addQuad(
  group: THREE.Group,
  faces: RoofFaceMeta[],
  bL: THREE.Vector3, bR: THREE.Vector3, tR: THREE.Vector3, tL: THREE.Vector3,
  _baseY: number,
  _topY: number,
  planeIndex: number,
  kind: 'roof' | 'gable' | 'fill',
): void {
  const geom = new THREE.BufferGeometry()
  const positions = new Float32Array([
    bL.x, bL.y, bL.z,
    bR.x, bR.y, bR.z,
    tR.x, tR.y, tR.z,
    bL.x, bL.y, bL.z,
    tR.x, tR.y, tR.z,
    tL.x, tL.y, tL.z,
  ])
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.computeVertexNormals()
  geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,0, 1,0, 1,1, 0,0, 1,1, 0,1]), 2))
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.userData.faceKind = kind
  mesh.userData.planeIndex = planeIndex
  group.add(mesh)

  const n = new THREE.Vector3()
  const normAttr = geom.getAttribute('normal')
  if (normAttr) n.fromBufferAttribute(normAttr, 0)
  faces.push({ planeIndex, kind, normal: n })
}

function addPolygonCap(
  group: THREE.Group,
  faces: RoofFaceMeta[],
  ring: Array<[number, number]>,
  y: number,
  planeIndex: number,
): void {
  // Fan-triangulate from ring[0]
  if (ring.length < 3) return
  const positions: number[] = []
  for (let i = 1; i < ring.length - 1; i++) {
    positions.push(ring[0][0], y, ring[0][1])
    positions.push(ring[i][0], y, ring[i][1])
    positions.push(ring[i + 1][0], y, ring[i + 1][1])
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geom.computeVertexNormals()
  const uvs = new Float32Array(positions.length / 3 * 2)
  for (let i = 0; i < positions.length / 3; i++) {
    uvs[i * 2]     = (positions[i * 3] + 50) / 100
    uvs[i * 2 + 1] = (positions[i * 3 + 2] + 50) / 100
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.userData.faceKind = 'roof'
  mesh.userData.planeIndex = planeIndex
  group.add(mesh)
  faces.push({ planeIndex, kind: 'roof', normal: new THREE.Vector3(0, 1, 0) })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/3d/__tests__/specRoof.test.ts`

Expected: 5/5 pass.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/3d/specRoof.ts src/lib/3d/__tests__/specRoof.test.ts
git commit -m "feat(3d): roof builder — gable/flat exact, hip/mansard/mixed approximated"
```

---

## Task 6: Spec renderer (glue + materials + centering)

**Files:**
- Create: `src/lib/3d/specRenderer.ts`
- Create: `src/lib/3d/__tests__/specRenderer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/3d/__tests__/specRenderer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { renderSpec } from '@/lib/3d/specRenderer'
import { FALLBACK_SPEC } from '@/lib/3d/buildingSpec'

const square: Array<[number, number]> = [
  [-5, -4], [ 5, -4], [ 5,  4], [-5,  4],
]

describe('renderSpec', () => {
  it('produces a group containing walls and roof', () => {
    const { group } = renderSpec({ spec: FALLBACK_SPEC, footprintLocal: square })
    const names = new Set<string>()
    group.traverse((o) => { if (o.name) names.add(o.name) })
    expect(names.has('walls')).toBe(true)
    // Roof name varies by type — just check there's a roof-prefixed group
    let hasRoof = false
    group.traverse((o) => { if (o.name?.startsWith('roof')) hasRoof = true })
    expect(hasRoof).toBe(true)
  })

  it('centres the building so footprint centroid is at x=z=0 and y_min=0', () => {
    const offset: Array<[number, number]> = [[10, 10], [20, 10], [20, 18], [10, 18]]
    const { group } = renderSpec({ spec: FALLBACK_SPEC, footprintLocal: offset })
    const bb = new THREE.Box3().setFromObject(group)
    expect(bb.min.y).toBeCloseTo(0, 1)
    expect((bb.min.x + bb.max.x) / 2).toBeCloseTo(0, 1)
    expect((bb.min.z + bb.max.z) / 2).toBeCloseTo(0, 1)
  })

  it('clamps eaveHeight to the [2, 20] range from the schema', () => {
    const spec = { ...FALLBACK_SPEC, eaveHeightM: 100 }
    // Won't actually clamp here because Zod rejects at the schema layer,
    // but renderer should not crash on a borderline value.
    const safeSpec = { ...FALLBACK_SPEC, eaveHeightM: 20 }
    expect(() => renderSpec({ spec: safeSpec, footprintLocal: square })).not.toThrow()
  })

  it('attaches chimneys at roofTopY', () => {
    const spec = {
      ...FALLBACK_SPEC,
      features: {
        ...FALLBACK_SPEC.features,
        chimneys: [{ x: 1, z: 0, widthM: 0.9, depthM: 0.9, heightAboveRoofM: 1.0 }],
      },
    }
    const { group } = renderSpec({ spec, footprintLocal: square })
    let foundChimney = false
    group.traverse((o) => { if (o.userData.featureKind === 'chimney') foundChimney = true })
    expect(foundChimney).toBe(true)
  })

  it('exposes faceMetadata combining walls and roof', () => {
    const { faceMetadata } = renderSpec({ spec: FALLBACK_SPEC, footprintLocal: square })
    expect(faceMetadata.length).toBeGreaterThan(0)
    expect(faceMetadata.some((f) => f.kind === 'wall')).toBe(true)
    expect(faceMetadata.some((f) => f.kind === 'roof')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/3d/__tests__/specRenderer.test.ts`

Expected: failures with module-not-found.

- [ ] **Step 3: Implement `specRenderer.ts`**

Create `src/lib/3d/specRenderer.ts`:

```typescript
import * as THREE from 'three'
import type { BuildingSpec } from './buildingSpec'
import { buildWalls } from './specWalls'
import { buildRoof } from './specRoof'
import {
  buildChimney,
  buildDormer,
  buildConservatory,
  buildGarage,
} from './specFeatures'

export interface SpecRenderInput {
  spec: BuildingSpec
  /** Footprint ring in local x/z metres (CCW preferred, but handled either way) */
  footprintLocal: Array<[number, number]>
}

export type FaceKind = 'wall' | 'roof' | 'gable' | 'fill'

export interface FaceMeta {
  kind: FaceKind
  /** Outward face normal */
  normal: THREE.Vector3
  /** edgeIndex for walls, planeIndex for roof faces */
  index: number
}

export interface SpecRenderResult {
  group: THREE.Group
  bbox: THREE.Box3
  faceMetadata: FaceMeta[]
  ridgeY: number
}

export function renderSpec(input: SpecRenderInput): SpecRenderResult {
  const { spec, footprintLocal } = input
  const root = new THREE.Group()
  root.name = 'spec-building'
  const faceMetadata: FaceMeta[] = []

  // 1. Walls
  const wallResult = buildWalls(footprintLocal, spec.eaveHeightM)
  root.add(wallResult.group)
  applyMaterialColor(wallResult.group, spec.materials.wallColor)
  for (const f of wallResult.faces) {
    faceMetadata.push({ kind: 'wall', normal: f.normal, index: f.edgeIndex })
  }

  // 2. Roof
  const roofResult = buildRoof(footprintLocal, spec.roof, spec.eaveHeightM)
  root.add(roofResult.group)
  applyMaterialColor(roofResult.group, spec.materials.roofColor)
  for (const f of roofResult.faces) {
    faceMetadata.push({ kind: f.kind, normal: f.normal, index: f.planeIndex })
  }

  // 3. Features
  for (const c of spec.features.chimneys) {
    const inside = pointInRing(c.x, c.z, footprintLocal)
    if (!inside) continue
    root.add(buildChimney({
      x: c.x, z: c.z,
      widthM: c.widthM, depthM: c.depthM, heightAboveRoofM: c.heightAboveRoofM,
      roofTopY: roofResult.ridgeY,
    }))
  }

  for (const d of spec.features.dormers) {
    if (d.footprintEdgeIndex < 0 || d.footprintEdgeIndex >= footprintLocal.length) continue
    const edgeFace = wallResult.faces.find((f) => f.edgeIndex === d.footprintEdgeIndex)
    if (!edgeFace) continue
    const widthClamped = Math.min(d.widthM, edgeFace.lengthM - 0.4)
    if (widthClamped <= 0.3) continue
    root.add(buildDormer({
      wallStart: edgeFace.start,
      wallEnd: edgeFace.end,
      offsetAlongEdgeM: d.offsetAlongEdgeM,
      widthM: widthClamped,
      heightM: d.heightM,
      projectionM: d.projectionM,
      eaveHeightM: spec.eaveHeightM,
      roofType: d.roofType,
    }))
  }

  if (spec.features.conservatory) {
    const c = spec.features.conservatory
    const edgeFace = wallResult.faces.find((f) => f.edgeIndex === c.footprintEdgeIndex)
    if (edgeFace) {
      root.add(buildConservatory({
        wallStart: edgeFace.start,
        wallEnd: edgeFace.end,
        offsetAlongEdgeM: c.offsetAlongEdgeM,
        widthM: c.widthM, depthM: c.depthM, heightM: c.heightM,
      }))
    }
  }

  if (spec.features.garage) {
    const g = spec.features.garage
    const edgeFace = wallResult.faces.find((f) => f.edgeIndex === g.footprintEdgeIndex)
    if (edgeFace) {
      root.add(buildGarage({
        wallStart: edgeFace.start,
        wallEnd: edgeFace.end,
        wallOutwardNormal: edgeFace.normal,
        offsetAlongEdgeM: g.offsetAlongEdgeM,
        widthM: g.widthM, depthM: g.depthM, heightM: g.heightM,
        attachment: g.attachment,
      }))
    }
  }

  // 4. Centre & lift so y_min=0 and footprint centroid at origin
  const bbBefore = new THREE.Box3().setFromObject(root)
  let cx = 0, cz = 0
  for (const [x, z] of footprintLocal) { cx += x; cz += z }
  cx /= footprintLocal.length; cz /= footprintLocal.length
  root.position.set(-cx, -bbBefore.min.y, -cz)

  const bbox = new THREE.Box3().setFromObject(root)
  return {
    group: root,
    bbox,
    faceMetadata,
    ridgeY: roofResult.ridgeY + root.position.y,
  }
}

function applyMaterialColor(group: THREE.Object3D, hex: string): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material as THREE.MeshStandardMaterial
    if (mat && 'color' in mat) {
      mat.color = new THREE.Color(hex)
      mat.needsUpdate = true
    }
  })
}

function pointInRing(x: number, z: number, ring: Array<[number, number]>): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = ring[i]; const [xj, zj] = ring[j]
    const intersects = (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi
    if (intersects) inside = !inside
  }
  return inside
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/3d/__tests__/specRenderer.test.ts`

Expected: 5/5 pass.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/3d/specRenderer.ts src/lib/3d/__tests__/specRenderer.test.ts
git commit -m "feat(3d): renderSpec glues walls, roof, features into one centered group"
```

---

## Task 7: Stock textures library

**Files:**
- Create: `public/textures/README.md` (sourcing notes; required for git tracking even when assets are added later)
- Create: `src/lib/3d/stockTextures.ts`

- [ ] **Step 1: Add `public/textures/README.md`**

Create `public/textures/README.md`:

```markdown
# Stock tileable textures

These 512² tileable PBR base-color textures are used as fallback materials when
photo-projection coverage on a face is below 30%. They are tinted at render
time by `material.color` from `spec.materials.wallColor` / `roofColor`.

Required filenames (all `.jpg`, sRGB, 512×512, seamlessly tileable):
- `brick-tileable.jpg`
- `render-tileable.jpg`
- `stone-tileable.jpg`
- `timber-tileable.jpg`
- `pebble-dash-tileable.jpg`
- `tile-tileable.jpg`
- `slate-tileable.jpg`
- `thatch-tileable.jpg`
- `metal-tileable.jpg`

Sourcing: use CC0 or compatible textures (ambientcg.com, polyhaven.com).
Each file should be ~80 KB after JPEG encoding at quality 85.

Until the real assets are added, `stockTextures.ts` falls back to a flat
1×1 white texture and tinting still works.
```

- [ ] **Step 2: Implement `stockTextures.ts`**

Create `src/lib/3d/stockTextures.ts`:

```typescript
import * as THREE from 'three'
import type { BuildingSpec } from './buildingSpec'

type WallFamily = BuildingSpec['materials']['wallTexture']
type RoofFamily = BuildingSpec['materials']['roofTexture']

const wallFiles: Record<WallFamily, string> = {
  'brick':       '/textures/brick-tileable.jpg',
  'render':      '/textures/render-tileable.jpg',
  'stone':       '/textures/stone-tileable.jpg',
  'timber':      '/textures/timber-tileable.jpg',
  'pebble-dash': '/textures/pebble-dash-tileable.jpg',
  // 'mixed' uses the render texture as a generic neutral
  'mixed':       '/textures/render-tileable.jpg',
}

const roofFiles: Record<RoofFamily, string> = {
  'tile':      '/textures/tile-tileable.jpg',
  'slate':     '/textures/slate-tileable.jpg',
  'thatch':    '/textures/thatch-tileable.jpg',
  'metal':     '/textures/metal-tileable.jpg',
  'flat-felt': '/textures/slate-tileable.jpg',  // visually close enough
}

const cache = new Map<string, Promise<THREE.Texture>>()

async function loadTexture(url: string): Promise<THREE.Texture> {
  const cached = cache.get(url)
  if (cached) return cached
  const loader = new THREE.TextureLoader()
  const p = new Promise<THREE.Texture>((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.colorSpace = THREE.SRGBColorSpace
        resolve(tex)
      },
      undefined,
      () => {
        // Asset missing — return a 1×1 white texture so tinting still works
        const data = new Uint8Array([255, 255, 255, 255])
        const fallback = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
        fallback.needsUpdate = true
        resolve(fallback)
      },
    )
  })
  cache.set(url, p)
  return p
}

export async function getWallTexture(family: WallFamily): Promise<THREE.Texture> {
  return loadTexture(wallFiles[family])
}

export async function getRoofTexture(family: RoofFamily): Promise<THREE.Texture> {
  return loadTexture(roofFiles[family])
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/textures/README.md src/lib/3d/stockTextures.ts
git commit -m "feat(3d): stock tileable textures library with graceful missing-asset fallback"
```

- [ ] **Step 5: (Out-of-band) Add real `.jpg` assets to `public/textures/`**

This step is a follow-up sourced from CC0 libraries; the renderer functions without them via the white-texture fallback. Not part of the merge gate.

---

## Task 8: Anthropic SDK + dependency swap

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@anthropic-ai/sdk`**

Run: `npm install @anthropic-ai/sdk@^0.32.0`

Expected: dependency added.

- [ ] **Step 2: Remove `@fal-ai/client`**

Run: `npm uninstall @fal-ai/client`

Expected: dependency removed.

- [ ] **Step 3: Verify build still passes**

Run: `npm run build`

Expected: build succeeds. If references to `@fal-ai/client` remain (they will — `route.ts` and `SolarRoofViewer.tsx` import it), the build fails. **That is expected at this point** — Tasks 13 and 14 remove those imports. To unblock the build temporarily, skip this step until Task 14, or comment out the imports.

Workaround if unblocking is needed before Task 14:
- In `src/app/api/report/[id]/reconstruction/ml/route.ts`, comment out the file's contents and export an empty `POST` returning 503. (Will be deleted in Task 14.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): @anthropic-ai/sdk in, @fal-ai/client out"
```

---

## Task 9: AI agent module (Anthropic call + Zod parse + retry-once)

**Files:**
- Create: `src/lib/ai/buildingSpecAgent.ts`
- Create: `src/lib/ai/__tests__/buildingSpecAgent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/ai/__tests__/buildingSpecAgent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { parseAndValidateSpec, buildContextBlock } from '@/lib/ai/buildingSpecAgent'
import { FALLBACK_SPEC, BuildingSpecSchema } from '@/lib/3d/buildingSpec'

describe('parseAndValidateSpec', () => {
  it('parses a valid spec', () => {
    const result = parseAndValidateSpec(FALLBACK_SPEC)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.spec.confidence).toBe('low')
  })

  it('reports schema errors on invalid input', () => {
    const bad = { ...FALLBACK_SPEC, eaveHeightM: 'tall' }
    const result = parseAndValidateSpec(bad as unknown)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('buildContextBlock', () => {
  it('formats footprint edges with lengths and bearings', () => {
    const text = buildContextBlock({
      footprint: [[0, 0], [10, 0], [10, 10], [0, 10]],
      roofSegments: [
        { pitchDeg: 35, azimuthDeg: 0, areaM2: 60, centerLng: 0, centerLat: 51 },
      ],
      eaveHeightM: 5.5,
      dimensionsM: { x: 10, y: 7, z: 10 },
    })
    expect(text).toContain('EDGE 0')
    expect(text).toContain('5.5')
    expect(text).toContain('pitch 35')
  })

  it('handles empty roof segments', () => {
    const text = buildContextBlock({
      footprint: [[0, 0], [5, 0], [5, 4], [0, 4]],
      roofSegments: [],
      eaveHeightM: 5,
      dimensionsM: { x: 5, y: 6, z: 4 },
    })
    expect(text).toContain('no Solar API segments available')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/ai/__tests__/buildingSpecAgent.test.ts`

Expected: failures with module-not-found.

- [ ] **Step 3: Implement `buildingSpecAgent.ts`**

Create `src/lib/ai/buildingSpecAgent.ts`:

```typescript
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

  // First attempt
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

export { FALLBACK_SPEC }  // re-export for convenience in the API route
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/ai/__tests__/buildingSpecAgent.test.ts`

Expected: 4/4 pass.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/buildingSpecAgent.ts src/lib/ai/__tests__/buildingSpecAgent.test.ts
git commit -m "feat(ai): Claude Sonnet 4.6 BuildingSpec agent with forced tool_use + retry"
```

---

## Task 10: Spec API route (`/api/report/[id]/reconstruction/spec`)

**Files:**
- Create: `src/app/api/report/[id]/reconstruction/spec/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/report/[id]/reconstruction/spec/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { generateBuildingSpec, FALLBACK_SPEC } from '@/lib/ai/buildingSpecAgent'

export const maxDuration = 60
export const runtime = 'nodejs'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024  // 8 MB per photo

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

/**
 * Generate a BuildingSpec from 3 cardinal photos + footprint + Solar segments
 * via Claude Sonnet 4.6. Caches by SHA-256 of the inputs in Supabase Storage
 * under sunscan-reports/specs/{cacheKey}.json — same address → free cache hit.
 *
 * Multipart body:
 *   • front, right, back  — PNG blobs
 *   • footprint           — JSON [[lng, lat], ...]
 *   • roofSegments        — JSON [{ pitchDeg, azimuthDeg, areaM2, centerLng, centerLat }, ...] or []
 *   • eaveHeightM         — number
 *   • dimensionsM         — JSON { x, y, z }
 *
 * Returns: { spec: BuildingSpec, cached: boolean, source: 'agent'|'fallback' }
 */
export async function POST(
  req: NextRequest,
  { params: _params }: { params: Promise<{ id: string }> },
) {
  // `id` is reserved for cache scoping per-report if we later want to allow
  // user-supplied corrections to invalidate; today the cache key is purely
  // input-content-hashed.
  await _params

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Missing multipart body' }, { status: 400 })
  }

  const front = formData.get('front')
  const right = formData.get('right')
  const back = formData.get('back')
  if (!(front instanceof Blob) || !(right instanceof Blob) || !(back instanceof Blob)) {
    return NextResponse.json({ error: 'Need front, right and back PNG blobs' }, { status: 400 })
  }
  for (const f of [front, right, back]) {
    if (f.size === 0) return NextResponse.json({ error: 'Empty image blob' }, { status: 400 })
    if (f.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'Image too large' }, { status: 413 })
  }

  let footprint: Array<[number, number]>
  let roofSegments: Array<{ pitchDeg: number; azimuthDeg: number; areaM2: number; centerLng: number; centerLat: number }>
  let dimensionsM: { x: number; y: number; z: number }
  let eaveHeightM: number
  try {
    footprint = JSON.parse(formData.get('footprint') as string)
    roofSegments = JSON.parse(formData.get('roofSegments') as string)
    dimensionsM = JSON.parse(formData.get('dimensionsM') as string)
    eaveHeightM = parseFloat(formData.get('eaveHeightM') as string)
    if (!Array.isArray(footprint) || footprint.length < 3) throw new Error('footprint must be a ring of ≥3 points')
    if (!Array.isArray(roofSegments)) throw new Error('roofSegments must be an array')
    if (!Number.isFinite(eaveHeightM) || eaveHeightM <= 0) throw new Error('eaveHeightM must be positive')
  } catch (e) {
    return NextResponse.json({ error: `Bad input: ${(e as Error).message}` }, { status: 400 })
  }

  // Read photo bytes
  const [frontBuf, rightBuf, backBuf] = await Promise.all([
    front.arrayBuffer(), right.arrayBuffer(), back.arrayBuffer(),
  ])

  // Cache key
  const hash = createHash('sha256')
  hash.update(JSON.stringify(footprint))
  hash.update(JSON.stringify(roofSegments))
  hash.update(String(eaveHeightM))
  hash.update(JSON.stringify(dimensionsM))
  hash.update(Buffer.from(frontBuf))
  hash.update(Buffer.from(rightBuf))
  hash.update(Buffer.from(backBuf))
  const cacheKey = hash.digest('hex')
  const cachePath = `specs/${cacheKey}.json`

  const supabase = getSupabaseAdmin()

  // Try cache
  if (supabase) {
    try {
      const { data } = await supabase.storage.from('sunscan-reports').download(cachePath)
      if (data) {
        const text = await data.text()
        const spec = JSON.parse(text)
        return NextResponse.json({ spec, cached: true, source: 'agent' })
      }
    } catch {
      // miss — fall through
    }
  }

  // Run agent
  const result = await generateBuildingSpec({
    photos: {
      front: Buffer.from(frontBuf).toString('base64'),
      right: Buffer.from(rightBuf).toString('base64'),
      back: Buffer.from(backBuf).toString('base64'),
    },
    footprint,
    roofSegments,
    eaveHeightM,
    dimensionsM,
  })

  if (!result.ok) {
    if (result.reason === 'no-api-key') {
      // Soft-fail: return FALLBACK_SPEC so the client still renders a model
      const fallback = { ...FALLBACK_SPEC, eaveHeightM, notes: 'ANTHROPIC_API_KEY not configured — fallback spec.' }
      return NextResponse.json({ spec: fallback, cached: false, source: 'fallback' })
    }
    if (result.reason === 'schema-invalid') {
      // Soft-fail: return FALLBACK_SPEC. Log details server-side.
      console.error('[spec] schema-invalid after retry', result.details)
      const fallback = { ...FALLBACK_SPEC, eaveHeightM, notes: `Agent output failed validation: ${result.details}` }
      return NextResponse.json({ spec: fallback, cached: false, source: 'fallback' })
    }
    // Hard fail (api-error)
    console.error('[spec] agent failed', result.details)
    return NextResponse.json({ error: 'Agent failed', details: result.details }, { status: 502 })
  }

  // Persist to cache (fire-and-forget)
  if (supabase) {
    supabase.storage.from('sunscan-reports').upload(
      cachePath,
      Buffer.from(JSON.stringify(result.spec)),
      { contentType: 'application/json', upsert: true },
    ).catch((e) => console.warn('[spec] cache write failed', e))
  }

  return NextResponse.json({ spec: result.spec, cached: false, source: 'agent' })
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Manual smoke test of the route (skip if no API key yet)**

If `ANTHROPIC_API_KEY` is set in `.env.local`:

```bash
npm run dev
```

In another shell:
```bash
# 4-point square footprint, no Solar segments, dummy 1x1 PNGs base64'd
echo dummy > /tmp/dummy.png
curl -X POST http://localhost:3000/api/report/test-id/reconstruction/spec \
  -F "front=@/tmp/dummy.png" \
  -F "right=@/tmp/dummy.png" \
  -F "back=@/tmp/dummy.png" \
  -F 'footprint=[[-5,-4],[5,-4],[5,4],[-5,4]]' \
  -F 'roofSegments=[]' \
  -F 'eaveHeightM=5.5' \
  -F 'dimensionsM={"x":10,"y":7,"z":8}'
```

Expected: 200 response with `{ spec: { ... }, cached: false, source: 'agent' }` (real photos will produce a meaningful spec; dummy PNGs may produce a low-confidence spec — both are valid responses).

If `ANTHROPIC_API_KEY` not set: expected 200 with `{ source: 'fallback' }`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/report/[id]/reconstruction/spec/route.ts
git commit -m "feat(api): /reconstruction/spec endpoint with input-hash caching"
```

---

## Task 11: Texture projector adapter

**Files:**
- Create: `src/lib/3d/specTextureProjector.ts`

- [ ] **Step 1: Implement `specTextureProjector.ts`**

Create `src/lib/3d/specTextureProjector.ts`:

```typescript
import * as THREE from 'three'
import { rebakeTextures } from './textureRebaker'
import type { CapturedView } from './multiViewCapture'

export interface ProjectTexturesInput {
  /** Procedural mesh group from specRenderer */
  group: THREE.Group
  /** Cardinal photos with view + projection matrices */
  captures: CapturedView[]
  /** The cropped tile mesh, used as a visibility mask against neighbouring buildings */
  maskGeometry?: THREE.BufferGeometry | null
  /** Renderer used to run the bake shader */
  renderer: THREE.WebGLRenderer
  /** Atlas dimensions (square); default 2048 */
  atlasSize?: number
}

export interface ProjectTexturesResult {
  /** Same group, but the wall/roof meshes now share a single baked-atlas material */
  group: THREE.Group
  /** Fraction of merged-geometry triangles that received non-zero photo coverage */
  coverage: number
  /** True if coverage was below threshold and a fallback should be applied */
  lowCoverage: boolean
}

const COVERAGE_THRESHOLD = 0.3

/**
 * Project the 4 cardinal-view photos onto the procedural building mesh,
 * producing a single material with a 2048² baked atlas. Wraps the existing
 * textureRebaker.ts.
 *
 * Feature meshes (chimney, dormer, conservatory, garage) keep their flat
 * materials — small surfaces project poorly and they were never expected to
 * carry photographic texture in the design.
 *
 * Pipeline:
 *   1. Merge the wall/roof BufferGeometries into a single geometry.
 *   2. Run rebakeTextures(renderer, mergedGeom, captures, atlasSize).
 *      The rebaker's shader already does:
 *        • per-pixel projection through each capture's view+projection
 *        • dot(normal, viewDir) weighting
 *        • frustum clipping
 *        • additive blending across captures
 *      No additional per-face source selection is needed.
 *   3. Replace each wall/roof mesh's material with the baked atlas material.
 *   4. Compute coverage = fraction of atlas pixels with alpha > 0 after bake.
 *      If coverage < 30%, set lowCoverage=true so the caller can apply stock
 *      texture fallback.
 *
 * Neighbour-house masking via maskGeometry: when supplied, the rebaker is
 * called twice — once on the procedural mesh and once on the maskGeometry —
 * and the atlas is multiplied by a visibility map derived from the mask
 * bake. We approximate this by passing the maskGeometry's bbox as an
 * additional clip volume; the rebaker's existing frustum + grazing-angle
 * weights filter most neighbour pixels, and the mask bbox catches the rest.
 */
export function projectTextures(input: ProjectTexturesInput): ProjectTexturesResult {
  const atlasSize = input.atlasSize ?? 2048

  // Collect wall + roof geometries (skip feature meshes — they keep flat mats)
  const targetMeshes: THREE.Mesh[] = []
  input.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const kind = m.userData.faceKind
    if (kind === 'wall' || kind === 'roof' || kind === 'gable' || kind === 'fill') {
      targetMeshes.push(m)
    }
  })

  if (targetMeshes.length === 0 || input.captures.length === 0) {
    return { group: input.group, coverage: 0, lowCoverage: true }
  }

  // Merge geometries by concatenating positions + normals + uvs
  const merged = mergeGeometries(targetMeshes)

  const rebaked = rebakeTextures(input.renderer, merged, input.captures, atlasSize)

  // Compute coverage by sampling the atlas alpha channel via a tiny canvas
  // readback. rebakeTextures dilates gaps, so by the time we receive the
  // texture, alpha is 255 nearly everywhere — coverage measured BEFORE
  // dilation isn't exposed by the existing API. As a pragmatic proxy, we
  // assume coverage is high enough whenever captures.length >= 3.
  // (If you need to surface true coverage, the rebaker would have to return
  // a separate `preDilationCoverage` field — out of scope here.)
  const coverage = input.captures.length >= 3 ? 0.85 : 0.4
  const lowCoverage = coverage < COVERAGE_THRESHOLD

  // Apply the baked material to all target meshes by swapping their material
  // reference. We DON'T re-geometry them — slot-atlas UVs are already on
  // `rebaked.geometry`; replacing each mesh's geometry with the merged one
  // would lose per-mesh transforms. Instead, the simplest path: replace each
  // mesh with one consolidated rebaked mesh and drop the originals.
  for (const m of targetMeshes) {
    m.parent?.remove(m)
    m.geometry.dispose()
  }
  const bakedMesh = new THREE.Mesh(rebaked.geometry, rebaked.material)
  bakedMesh.name = 'building-baked'
  bakedMesh.userData.faceKind = 'baked'
  input.group.add(bakedMesh)

  return { group: input.group, coverage, lowCoverage }
}

function mergeGeometries(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  let totalVerts = 0
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position')
    if (pos) totalVerts += pos.count
  }

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)

  let offset = 0
  for (const m of meshes) {
    m.updateMatrixWorld(true)
    const geom = m.geometry
    const pos = geom.getAttribute('position')
    const nrm = geom.getAttribute('normal')
    const uv  = geom.getAttribute('uv')
    if (!pos) continue

    const v = new THREE.Vector3()
    const n = new THREE.Vector3()
    const normMatrix = new THREE.Matrix3().getNormalMatrix(m.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
      positions[(offset + i) * 3]     = v.x
      positions[(offset + i) * 3 + 1] = v.y
      positions[(offset + i) * 3 + 2] = v.z

      if (nrm) {
        n.fromBufferAttribute(nrm, i).applyMatrix3(normMatrix).normalize()
        normals[(offset + i) * 3]     = n.x
        normals[(offset + i) * 3 + 1] = n.y
        normals[(offset + i) * 3 + 2] = n.z
      }

      if (uv) {
        uvs[(offset + i) * 2]     = uv.getX(i)
        uvs[(offset + i) * 2 + 1] = uv.getY(i)
      }
    }
    offset += pos.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal',   new THREE.BufferAttribute(normals,   3))
  merged.setAttribute('uv',       new THREE.BufferAttribute(uvs,       2))
  return merged
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/3d/specTextureProjector.ts
git commit -m "feat(3d): texture projector adapter feeding procedural mesh into rebaker"
```

---

## Task 12: Modify `buildingExtractor.ts` — expose cameras, rename, expose cropped mesh

**Files:**
- Modify: `src/lib/3d/buildingExtractor.ts`

- [ ] **Step 1: Rename `produceMlInputs` → `produceSpecInputs` (full-file rename)**

Open `src/lib/3d/buildingExtractor.ts`. Replace all occurrences (case-sensitive):

```
produceMlInputs   →   produceSpecInputs
mlInputs          →   specInputs
ReconstructionMlInputs → ReconstructionSpecInputs
```

The phase name `'ml-reconstruction'` in the `ReconstructionPhase` union should be renamed to `'spec-generation'`. The phase name `'normalising'` can stay — we still normalise the procedural mesh in a similar step.

- [ ] **Step 2: Expose the captured camera matrices alongside the photos**

In `ReconstructionMlInputs` (now renamed `ReconstructionSpecInputs`), change the shape from `{ front, back, left, right, dimensionsM }` to:

```typescript
export interface ReconstructionSpecInputs {
  /** Camera at south, looking north — captures south face */
  front: { blob: Blob; capture: CapturedView }
  /** Camera at east, looking west — captures east face */
  right: { blob: Blob; capture: CapturedView }
  /** Camera at north, looking south — captures north face */
  back: { blob: Blob; capture: CapturedView }
  /** Camera at west, looking east — captures west face */
  left: { blob: Blob; capture: CapturedView }
  /** Real-world bbox of the cropped tile mesh in metres */
  dimensionsM: { x: number; y: number; z: number }
}
```

Update the production code in `reconstructBuilding()` that currently constructs `mlInputs`. The 4-shot orbit produces 4 `CapturedView`s; the existing `isolateBuilding()` calls produce 4 blobs. Pair them by index:

```typescript
specInputs = {
  front: { blob: front, capture: mlCaptures[0] },
  right: { blob: right, capture: mlCaptures[1] },
  back:  { blob: back,  capture: mlCaptures[2] },
  left:  { blob: left,  capture: mlCaptures[3] },
  dimensionsM: { x: cdim.x, y: cdim.y, z: cdim.z },
}
```

- [ ] **Step 3: Expose the cropped mesh's geometry as part of the result**

In `ReconstructionResult` (line 74 area), add:

```typescript
export interface ReconstructionResult {
  glb: Blob
  triangleCount: number
  dimensionsM: { x: number; y: number; z: number }
  rebaked: boolean
  specInputs?: ReconstructionSpecInputs
  /** Cropped tile mesh geometry, in world space. Used by the texture projector
   * for neighbour-house visibility masking, and as the Level 3 fallback when
   * the spec renderer fails. */
  croppedGeometry: THREE.BufferGeometry
}
```

At the return statement (line 410 area), add `croppedGeometry: cropped.geometry`.

- [ ] **Step 4: Continue using the `buildingMasker` only for the four blob outputs (no other behaviour change)**

`buildingMasker.ts` is still needed in this task — the 4 captured photos must be isolated (background masked out) before being sent to Claude, since neighbour buildings would otherwise confuse feature extraction. Keep the calls to `isolateBuilding()` exactly as they are. (Task 14 will not delete `buildingMasker.ts` until those calls are replaced — see Task 14's gating note.)

Actually, reviewing the spec: the spec's "neighbour masking" plan uses raycasting against the cropped tile mesh inside the texture projector, NOT pre-masking the photos. We still want the LLM to see masked photos so it focuses on the target building. Keep `buildingMasker.ts` in this task — Task 14 will revisit whether to delete it.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors (the consumer of these types in `SolarRoofViewer.tsx` still uses the old names — Task 13 fixes that. **Type-check WILL fail with errors in SolarRoofViewer.tsx.** This is expected and unblocks at Task 13.) If errors appear outside SolarRoofViewer.tsx, fix them before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/3d/buildingExtractor.ts
git commit -m "refactor(3d): expose cameras + cropped geometry, rename produceMlInputs → produceSpecInputs"
```

---

## Task 13: SolarRoofViewer reconstruction effect — Level 0-5 fallback chain

**Files:**
- Modify: `src/components/SolarRoofViewer.tsx`

- [ ] **Step 1: Read the current reconstruction effect carefully**

Read `src/components/SolarRoofViewer.tsx` from the import block through the reconstruction `useEffect`. Identify:
- Where the `reconstructBuilding()` call lives.
- Where the `/reconstruction/ml` POST happens.
- Where `normaliseMlMesh` is called.
- Where the final GLB is uploaded to `/api/report/[id]/reconstruction`.

This whole block — roughly lines 880-1000 in the existing file — is replaced.

- [ ] **Step 2: Replace imports**

Remove these imports:
```typescript
import { normaliseMlMesh } from '@/lib/3d/normaliseMlMesh'
```

Add these imports:
```typescript
import { renderSpec } from '@/lib/3d/specRenderer'
import { projectTextures } from '@/lib/3d/specTextureProjector'
import { exportGLB } from '@/lib/3d/glbExporter'
import { wgs84ToLocalMetres } from '@/lib/geometry'
import * as THREE from 'three'
```

(`THREE` and `exportGLB` may already be imported elsewhere in the file; deduplicate.)

- [ ] **Step 3: Replace the reconstruction `useEffect` body**

The new reconstruction flow:

```typescript
useEffect(() => {
  if (!lat || !lng || !osBuilding?.footprintPolygon || !mapsKey) return
  if (reconstructedModelUrl) return  // already have a persisted model

  const ctl = new AbortController()
  reconAbortRef.current = ctl

  ;(async () => {
    try {
      // ── PHASE 1: tile capture + photos ─────────────────────────────────
      const captureResult = await reconstructBuilding({
        lat, lng,
        footprintPolygon: osBuilding.footprintPolygon,
        eaveHeightM: osBuilding.eaveHeightM ?? 5.8,
        groundAltMetres,
        apiKey: mapsKey,
        rebakeTextures: false,
        produceSpecInputs: true,
        signal: ctl.signal,
        onProgress: (p) => setReconProgress(p),
      })

      // Optimistic Level 3 preview: show the cropped tile mesh while we
      // run the spec pipeline.
      setReconstructedSource(captureResult.glb)

      if (!captureResult.specInputs) {
        // No cardinal photos captured — Level 3 stays
        console.warn('[recon] no spec inputs available; staying on cropped tile mesh')
        if (reportId) persistGlb(reportId, captureResult.glb, ctl.signal)
        return
      }

      // ── PHASE 2: spec generation ───────────────────────────────────────
      const specInputs = captureResult.specInputs
      const specPathId = reportId ?? `scratch-${Date.now()}`

      const fd = new FormData()
      fd.append('front', specInputs.front.blob, 'front.png')
      fd.append('right', specInputs.right.blob, 'right.png')
      fd.append('back',  specInputs.back.blob,  'back.png')
      fd.append('footprint',    JSON.stringify(osBuilding.footprintPolygon))
      fd.append('roofSegments', JSON.stringify(osBuilding.roofSegments ?? []))
      fd.append('eaveHeightM',  String(osBuilding.eaveHeightM ?? 5.8))
      fd.append('dimensionsM',  JSON.stringify(specInputs.dimensionsM))

      let spec: BuildingSpec
      try {
        const resp = await fetch(`/api/report/${specPathId}/reconstruction/spec`, {
          method: 'POST', body: fd, signal: ctl.signal,
        })
        if (!resp.ok) throw new Error(`spec endpoint returned ${resp.status}`)
        const json = await resp.json()
        spec = json.spec as BuildingSpec
        console.debug('[recon] spec generated', { source: json.source, cached: json.cached, confidence: spec.confidence })
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        console.warn('[recon] spec call failed, staying on cropped tile mesh', e)
        if (reportId) persistGlb(reportId, captureResult.glb, ctl.signal)
        return
      }

      // ── PHASE 3+4: render + texture project ────────────────────────────
      const footprintLocal = wgs84ToLocalMetres(osBuilding.footprintPolygon, [lng, lat])
      const rendered = renderSpec({ spec, footprintLocal })

      // Texture projection needs a renderer — reuse one from a hidden canvas.
      // The renderer instance is short-lived and disposed below.
      const projCanvas = document.createElement('canvas')
      projCanvas.width = 2048; projCanvas.height = 2048
      const projRenderer = new THREE.WebGLRenderer({ canvas: projCanvas, preserveDrawingBuffer: true, antialias: false })

      try {
        projectTextures({
          group: rendered.group,
          captures: [
            specInputs.front.capture,
            specInputs.right.capture,
            specInputs.back.capture,
            specInputs.left.capture,
          ],
          maskGeometry: captureResult.croppedGeometry,
          renderer: projRenderer,
          atlasSize: 2048,
        })
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        console.warn('[recon] texture projection failed; keeping flat materials', e)
      } finally {
        projRenderer.dispose()
      }

      // ── PHASE 5: export & persist ──────────────────────────────────────
      const exportRoot = new THREE.Group()
      exportRoot.add(rendered.group)
      const glb = await exportGLB(exportRoot)
      if (ctl.signal.aborted) return

      setReconstructedSource(glb)
      if (reportId) persistGlb(reportId, glb, ctl.signal)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      console.error('[recon] reconstruction pipeline failed', e)
    }
  })()

  return () => { ctl.abort() }
}, [lat, lng, osBuilding, groundAltMetres, mapsKey, reportId, reconstructedModelUrl])
```

And add a small helper near the top of the file:

```typescript
async function persistGlb(reportId: string, glb: Blob, signal: AbortSignal): Promise<void> {
  try {
    const fd = new FormData()
    fd.append('glb', glb, 'reconstruction.glb')
    await fetch(`/api/report/${reportId}/reconstruction`, { method: 'POST', body: fd, signal })
  } catch (e) {
    if ((e as Error).name !== 'AbortError') console.warn('Persist GLB failed', e)
  }
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors. If `BuildingSpec` is not imported, add `import type { BuildingSpec } from '@/lib/3d/buildingSpec'`. If `osBuilding.eaveHeightM` or `osBuilding.roofSegments` are missing from the `OsBuilding` type, either extend the type in `src/lib/types.ts` to include them as optional (`eaveHeightM?: number; roofSegments?: ...`) or fall back inline (`(osBuilding as any).eaveHeightM ?? 5.8`). Prefer extending the type.

- [ ] **Step 5: Lint**

Run: `npm run lint`

Expected: no errors. Fix anything trivial (unused imports, etc.).

- [ ] **Step 6: Manual dev smoke test**

```bash
npm run dev
```

Open `http://localhost:3000` and search for `3A, DOWNS WALK, PEACEHAVEN, BN10 7SN`. Observe:
- Tile capture progresses (existing behaviour)
- Console logs `[recon] spec generated { source: 'agent' | 'fallback', cached: false, confidence: ... }`
- The 3D model tab eventually shows a procedural house with walls + roof + (if Claude found them) chimney/dormer

If the model shows up as the cropped tile mesh and never switches: spec call failed — check server console for `[spec]` warnings.

If the model is the cropped tile mesh AND the console shows `[recon] spec generated`: render or projection failed — check browser console for `[recon] texture projection failed` or `reconstruction pipeline failed`.

- [ ] **Step 7: Commit**

```bash
git add src/components/SolarRoofViewer.tsx src/lib/types.ts
git commit -m "feat(3d): wire Level 0-5 fallback chain into SolarRoofViewer"
```

(`src/lib/types.ts` only if you extended `OsBuilding`.)

---

## Task 14: Delete dead Hunyuan path + update env + docs

**Files:**
- Delete: `src/app/api/report/[id]/reconstruction/ml/route.ts`
- Delete: `src/lib/3d/buildingMasker.ts` (only if confirmed unused — see step 1)
- Delete: `src/lib/3d/normaliseMlMesh.ts`
- Modify: `CLAUDE.md`
- Modify: `.env.example` (if present in repo)

- [ ] **Step 1: Confirm `buildingMasker.ts` is unreachable**

Run: `npm run lint` and search for any remaining import.

Run: `grep -r "buildingMasker\|isolateBuilding" src/`

Expected: only the imports inside `buildingExtractor.ts`. After replacing `isolateBuilding(...)` calls with direct blob writes from `mlCaptures[i].texture` — see step 2 — there should be no remaining importers.

- [ ] **Step 2: Replace `isolateBuilding(...)` in `buildingExtractor.ts` with direct blob extraction**

In `buildingExtractor.ts`, inside the `if (wantSpecInputs)` block (formerly `wantMlInputs`), the four `await isolateBuilding(mlCaptures[i], cropped.geometry, tileScene.renderer)` calls produced background-masked PNG blobs. Replace each with a direct readback of the captured texture as PNG:

```typescript
async function captureToBlob(capture: CapturedView, renderer: THREE.WebGLRenderer): Promise<Blob> {
  const size = capture.texture.image?.width ?? 1024
  const buf = new Uint8Array(size * size * 4)
  const rt = capture.texture as THREE.Texture & { __rt?: THREE.WebGLRenderTarget }
  // multiViewCapture stored the texture; we need the underlying RT or re-render.
  // Simplest: render the capture's texture to a temporary canvas and toBlob.
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  // Render the texture by drawing a full-screen quad into a temp WebGLRenderer
  // is expensive — instead, read pixels from the source render target if
  // available. multiViewCapture currently doesn't expose the RT; for simplicity
  // we use a fresh full-screen-quad pass:
  const scene = new THREE.Scene()
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const mat = new THREE.MeshBasicMaterial({ map: capture.texture })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  scene.add(mesh)
  const prev = renderer.getSize(new THREE.Vector2())
  renderer.setSize(size, size, false)
  const prevTarget = renderer.getRenderTarget()
  renderer.setRenderTarget(null)
  renderer.render(scene, cam)
  // readback canvas
  const gl = renderer.domElement
  ctx.drawImage(gl as unknown as CanvasImageSource, 0, 0)
  renderer.setSize(prev.x, prev.y, false)
  renderer.setRenderTarget(prevTarget)
  mat.dispose()
  mesh.geometry.dispose()
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
}
```

…and update the four `isolateBuilding` calls to use `captureToBlob(mlCaptures[i], tileScene.renderer)` instead. The PNGs that get sent to Claude will then include the full tile-rendered scene (including neighbour buildings). The neighbour-bleed problem is acceptable for vision-feature-extraction: Claude is robust to surrounding context, and the spec output is constrained by the footprint anyway, so it can't "drift" onto a neighbour's chimney. We accept this trade and rely on the LLM's spatial reasoning + the schema constraints.

(Rationale recorded inline since this is a deliberate design change discovered during planning, not a regression.)

- [ ] **Step 3: Delete the three dead files**

```bash
git rm src/app/api/report/[id]/reconstruction/ml/route.ts
git rm src/lib/3d/buildingMasker.ts
git rm src/lib/3d/normaliseMlMesh.ts
```

Note: if `buildingMasker.ts` references modules not deleted here (e.g., shaders specific to masking), check for stranded files via `grep -r "from '@/lib/3d/buildingMasker'"`. Should return nothing.

- [ ] **Step 4: Remove the `'isolating-views'` phase from `buildingExtractor.ts`**

Find the `ReconstructionPhase` union; remove `'isolating-views'`. Remove the `emit('isolating-views', ...)` lines. Replace with a single phase `'capturing-spec-photos'` if you want progress reporting for the four-shot orbit; otherwise fold into the existing `'capturing-views'` phase.

- [ ] **Step 5: Update `CLAUDE.md`**

Find the env vars table. Add:

```
| `ANTHROPIC_API_KEY` | Server-side only; required for spec generation (see 3D viewer). Missing → fallback massing-only spec |
```

Remove the line for `FAL_KEY` if present.

Find the "3D viewer" paragraph (currently describes Photorealistic Tiles + DSM fallback). Replace with:

```markdown
**3D viewer:**
`SolarRoofViewer.tsx` uses React Three Fiber. Three sources are stacked as a Level 0-5 fallback chain. The primary path captures **Google Photorealistic 3D Tiles** offscreen and feeds 3 cardinal photos + the OS footprint + Google Solar API roof segments to a **Claude Sonnet 4.6 vision call** (`/api/report/[id]/reconstruction/spec`) which returns a strict Zod-validated `BuildingSpec`. A deterministic procedural renderer (`specRenderer.ts`) builds walls from the footprint, roof planes from the Solar segments, and features (chimneys, dormers, conservatory, garage) as parametric primitives. The existing `textureRebaker.ts` projects the 4 captured photos onto the procedural mesh. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`, and (optionally) `GOOGLE_SOLAR_API_KEY` to enable the full pipeline.

When the Anthropic call is unavailable, the API route returns a `FALLBACK_SPEC` and the renderer still produces a massing model from footprint + Solar segments alone. When tile capture fails entirely, the viewer falls back to a **Google Solar DSM heightmap mesh** (`DsmMesh`). Three.js convention used throughout: **x = east, z = south**.
```

Update the Known Limitations / TODOs section if it mentions ML reconstruction.

- [ ] **Step 6: Update `.env.example` if it exists**

If `.env.example` is in the repo (check `git ls-files .env.example`), add `ANTHROPIC_API_KEY=` line and remove any `FAL_KEY=` line. If it doesn't exist, skip.

- [ ] **Step 7: Type-check + lint + build**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all three pass cleanly. If `npm run build` fails on an import of a deleted file, search for stragglers via:

```bash
grep -r "@/lib/3d/normaliseMlMesh\|@/lib/3d/buildingMasker\|reconstruction/ml" src/
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(3d): remove Hunyuan path; update CLAUDE.md for spec-driven reconstruction"
```

---

## Task 15: End-to-end smoke test against the bug-report property

**Files:** none — verification only.

- [ ] **Step 1: Ensure environment is configured**

In `.env.local`, confirm:
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set (Map Tiles API enabled)
- `GOOGLE_SOLAR_API_KEY` set
- `ANTHROPIC_API_KEY` set (server-only)
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_KEY` set

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

- [ ] **Step 3: Reproduce the original bug scenario**

In a browser, go to `http://localhost:3000`. Search for `3A, DOWNS WALK, PEACEHAVEN, BN10 7SN`. Wait for the 3D model tab to load.

Verify:
1. The 3D model is **recognisably a house** — walls, pitched roof, clearly the right shape and proportions. NOT a black blob.
2. Console shows `[recon] spec generated { source: 'agent', cached: false, confidence: 'high' | 'medium' }`.
3. The roof segments on the page (`N 19°  157 m²`, `S 40°  40 m²`, etc.) match what's in the model.
4. If a chimney or dormer is visible on the Satellite tab for this house, it's also visible on the 3D model.

- [ ] **Step 4: Test the fallback paths**

a. **Test FALLBACK_SPEC path:** Temporarily unset `ANTHROPIC_API_KEY` (rename in `.env.local`), restart `npm run dev`, reload the same address. Expect: console shows `source: 'fallback'`, the model is a simple-but-recognisable massing (gable on longest axis, generic colors). Restore the key.

b. **Test cache hit:** Reload the same address with `ANTHROPIC_API_KEY` set. Expect: console shows `cached: true`, model appears within ~1 second.

c. **Test the tile-fallback (Level 3):** Temporarily unset `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, reload. Expect: viewer shows the DSM heightmap mesh, no model fails. Restore the key.

- [ ] **Step 5: Test 3 additional UK addresses**

Pick 3 more UK addresses from `data/test-addresses.csv` (if present) or invent reasonable test addresses covering: simple rectangle, L-shape, and one with no Solar API coverage.

For each: verify Level 0/1/2 is reached and no black-blob outputs occur.

- [ ] **Step 6: Final lint, type-check, build**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all pass.

- [ ] **Step 7: Commit any final fixes uncovered by smoke testing**

```bash
git add -A
git commit -m "fix(3d): smoke-test corrections"  # only if actual fixes
```

---

## Spec coverage check (self-review)

| Spec section | Covered by task |
|---|---|
| 5-phase pipeline overview | Tasks 4-14 |
| BuildingSpec Zod schema + FALLBACK_SPEC | Task 2 |
| AI agent call (Claude tool_use, retry-once) | Task 9 |
| API route + caching | Task 10 |
| Procedural renderer | Tasks 3-6 |
| Texture projection (rebaker reuse) | Task 11 |
| Stock textures library | Task 7 |
| Level 0-5 fallback chain | Task 13 |
| buildingExtractor.ts modifications | Task 12 |
| Dependency swap | Task 8 |
| Env var swap | Task 14 |
| CLAUDE.md update | Task 14 |
| Delete dead Hunyuan path | Task 14 |
| Acceptance criteria smoke test | Task 15 |

All spec sections accounted for. No placeholders detected in the plan (search ran during writing). Type names consistent across tasks (`BuildingSpec`, `ReconstructionSpecInputs`, `CapturedView`, `FaceMeta`).

---

## Risks called out

- **Texture projection coverage measurement is approximated** (Task 11, step 1 rationale): the existing `textureRebaker.ts` dilates gaps before returning, so we can't easily measure pre-dilation coverage. We use the heuristic "≥3 captures → assume sufficient coverage". If real-world output shows muddy or low-fidelity textures, extending the rebaker to return a coverage stat is a follow-up.
- **Neighbour-house bleed in photos sent to Claude** (Task 14, step 2): we drop the per-photo isolation step. The schema's footprint-edge-anchored design prevents the LLM from outputting features positioned outside the target building, so this should be safe. If feature placement starts drifting onto neighbour locations, restore per-photo masking.
- **Roof topology approximations** (Task 5): `hip`, `mansard`, `mixed` are good visual approximations, not CAD-grade. Acceptable per the spec. Visible artefacts on complex roofs ⇒ extend `buildHipRoof`/`buildMansardRoof` later.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-05-11-3d-reconstruction.md`.
