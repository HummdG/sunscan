import * as THREE from 'three'
import { buildFootprintPrism } from './footprintPrism'
import { cropMeshToPrism } from './meshCropper'
import { createOffscreenTileScene } from './offscreenTileScene'
import { captureOrbit, type CapturedView } from './multiViewCapture'
import { rebakeTextures } from './textureRebaker'
import { exportGLB } from './glbExporter'
import { isolateBuilding } from './buildingMasker'

export type ReconstructionPhase =
  | 'init'
  | 'loading-tiles'
  | 'capturing-views'
  | 'extracting-geometry'
  | 'isolating-views'
  | 'rebaking-textures'
  | 'exporting'
  | 'ml-reconstruction'
  | 'normalising'
  | 'done'

export interface ReconstructionProgress {
  phase: ReconstructionPhase
  /** 0-1 progress within the current phase, or 0-1 overall when phase = 'done' */
  progress: number
  message: string
}

export interface ReconstructionInput {
  lat: number
  lng: number
  /** WGS84 footprint polygon ring [[lng, lat], ...] from OS NGD */
  footprintPolygon: [number, number][]
  /** Approximate eave height in metres (used to size the prism); defaults to 6m */
  eaveHeightM?: number
  /**
   * Ground altitude above the WGS84 ellipsoid at the building, in metres.
   * For the UK this is approximately `terrainElevationAMSL + 47` (the EGM2008
   * geoid offset). Pass the same value SolarRoofViewer uses to anchor its
   * live tile view. Defaults to 50m (UK low-lying baseline) if unset, but
   * accuracy matters — a wrong value puts the tiles outside the camera
   * frustum and no geometry will load.
   */
  groundAltMetres?: number
  /** Google Maps API key (browser-safe public key with Map Tiles API enabled) */
  apiKey: string
  /** Whether to run the texture re-bake step (Approach 2); default true */
  rebakeTextures?: boolean
  /**
   * Whether to also produce isolated single-building PNG views suitable for
   * feeding into a cloud image-to-3D model (Hunyuan3D-2 multi-view). Adds
   * an `isolating-views` phase that picks 4 cardinal captures and masks
   * everything except the target building. Default: false.
   */
  produceSpecInputs?: boolean
  onProgress?: (p: ReconstructionProgress) => void
  signal?: AbortSignal
}

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

export interface ReconstructionResult {
  glb: Blob
  triangleCount: number
  /** Approximate world-space bounding box dimensions in metres */
  dimensionsM: { x: number; y: number; z: number }
  rebaked: boolean
  /** Present when produceSpecInputs=true. */
  specInputs?: ReconstructionSpecInputs
  /** Cropped tile mesh geometry, in world space. Used by the texture projector
   * for neighbour-house visibility masking, and as the Level 3 fallback when
   * the spec renderer fails. */
  croppedGeometry: THREE.BufferGeometry
}

const PHASE_WEIGHTS: Record<ReconstructionPhase, number> = {
  init: 0,
  'loading-tiles': 0.30,
  'capturing-views': 0.20,
  'extracting-geometry': 0.05,
  'isolating-views': 0.10,
  'rebaking-textures': 0.20,
  exporting: 0.05,
  // Caller-emitted phases (not used inside reconstructBuilding's cumulative
  // calculation, but kept in the union for type-safe progress reporting).
  'ml-reconstruction': 0,
  normalising: 0,
  done: 0,
}

/**
 * End-to-end reconstruction pipeline. Stands up an offscreen tile scene,
 * forces high-LOD tile loading, captures multi-view renders, crops the loaded
 * tile mesh to the building footprint, optionally re-bakes textures into a
 * unified atlas, and returns a self-contained GLB.
 */
export async function reconstructBuilding(input: ReconstructionInput): Promise<ReconstructionResult> {
  const { lat, lng, footprintPolygon, apiKey, signal } = input
  const eaveH = input.eaveHeightM ?? 6
  const groundAlt = input.groundAltMetres ?? 50
  const onProgress = input.onProgress ?? (() => {})
  const wantRebake = input.rebakeTextures ?? true
  const wantSpecInputs = input.produceSpecInputs ?? false

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Reconstruction aborted', 'AbortError')
  }

  const emit = (phase: ReconstructionPhase, progress: number, message: string) => {
    let cumulative = 0
    for (const p of Object.keys(PHASE_WEIGHTS) as ReconstructionPhase[]) {
      if (p === phase) { cumulative += PHASE_WEIGHTS[p] * progress; break }
      cumulative += PHASE_WEIGHTS[p]
    }
    onProgress({ phase, progress: cumulative, message })
  }

  emit('init', 0, 'Setting up...')

  // ─── 1. Offscreen tile scene ───────────────────────────────────────────────
  emit('loading-tiles', 0.05, 'Loading high-detail map tiles...')

  // Anchor the tile scene's local origin at (lat, lng, groundAlt). When the
  // caller passes the same groundAlt used by the live SolarRoofViewer, our
  // local frame matches theirs and a prism in metres-from-building-centre
  // can be tested against the loaded tile geometry directly.
  const tileScene = createOffscreenTileScene(lat, lng, groundAlt, apiKey, 1024, 1024)

  try {
    // Position camera so the building is centred in frame, forcing high-LOD load.
    // Start with a 60m orbit at ~40m altitude — typical building bounding box.
    const cam = tileScene.camera
    cam.position.set(40, 50, 40)
    cam.lookAt(0, 5, 0)
    cam.updateProjectionMatrix()

    // Warm the tile cache by ticking updates with the camera in position.
    for (let i = 0; i < 30; i++) {
      tileScene.updateTiles()
      await new Promise(requestAnimationFrame)
      throwIfAborted()
    }

    emit('loading-tiles', 0.5, 'Waiting for tile network to settle...')
    // Require at least 8 meshes — a continent-level ancestor tile is one mesh
    // by itself, so 1 isn't a meaningful signal that we have building detail.
    // 48-capture orbit triggers more LOD downloads, so timeout is wider.
    const settleStats = await tileScene.waitForSettle({ timeoutMs: 90_000, quietMs: 2_000, minMeshes: 8 })
    throwIfAborted()
    console.debug('[reconstruct] tiles settled', settleStats)

    // Diagnostic: log the group's transform and the first mesh's transform
    // so we can verify matrix propagation actually happened.
    {
      const g = tileScene.tiles.group
      let firstMesh: THREE.Mesh | null = null
      g.traverse((o) => { if (!firstMesh && (o as THREE.Mesh).isMesh) firstMesh = o as THREE.Mesh })
      console.debug('[reconstruct] tiles.group matrix elements', Array.from(g.matrix.elements))
      console.debug('[reconstruct] tiles.group matrixWorld elements', Array.from(g.matrixWorld.elements))
      if (firstMesh) {
        const fm = firstMesh as THREE.Mesh
        console.debug('[reconstruct] sample mesh matrix elements', Array.from(fm.matrix.elements))
        console.debug('[reconstruct] sample mesh matrixWorld elements', Array.from(fm.matrixWorld.elements))
        console.debug('[reconstruct] sample mesh matrixAutoUpdate', fm.matrixAutoUpdate)
        const pos = fm.geometry.getAttribute('position')
        if (pos && pos.count > 0) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, 0)
          const vw = v.clone().applyMatrix4(fm.matrixWorld)
          console.debug('[reconstruct] sample vertex local', v.toArray(), '→ world', vw.toArray())
        }
      }
    }

    // ─── 2. Multi-view capture ──────────────────────────────────────────────
    emit('capturing-views', 0, 'Capturing aerial views...')

    const target = new THREE.Vector3(0, eaveH * 0.6, 0)
    // v2: 48-view dense orbit — 12 azimuths × 4 altitudes × 1 radius.
    // Each capture also triggers tile-streaming for that viewpoint, so
    // denser sampling means more LOD chunks land and fewer texture gaps.
    // NB: tile-API quota burn scales linearly — ~3× v1's load.
    const azimuths = Array.from({ length: 12 }, (_, i) => (i * Math.PI * 2) / 12)
    const altitudes = [eaveH + 2, eaveH + 8, eaveH + 16, eaveH + 28]
    const radii = [22]

    let captureIdx = 0
    const totalCaptures = azimuths.length * altitudes.length * radii.length
    const captures: CapturedView[] = await captureOrbit(tileScene.renderer, tileScene.scene, {
      target,
      radii,
      altitudes,
      azimuths,
      captureSize: 1024,
      beforeCapture: async () => {
        // Re-tick tile updates so the renderer streams in any new chunks visible
        // from the upcoming pose.
        for (let i = 0; i < 4; i++) {
          tileScene.updateTiles()
          await new Promise(requestAnimationFrame)
        }
        captureIdx++
        emit('capturing-views', captureIdx / totalCaptures, `Captured ${captureIdx}/${totalCaptures} views`)
        throwIfAborted()
      },
    })

    // ─── 3. Geometry extraction ─────────────────────────────────────────────
    emit('extracting-geometry', 0.2, 'Extracting building geometry...')

    // Tight prism: centroid must land inside this. Snug to the building so
    // we don't accidentally include parts of a neighbouring property.
    const prism = buildFootprintPrism(
      footprintPolygon,
      [lng, lat],
      -5,
      eaveH + 20,
      0.6,
    )
    // Loose prism: no triangle vertex may extend beyond this. Catches the
    // wispy spike triangles whose centroid was barely inside the polygon
    // but whose far vertex shoots metres outward.
    const vertexPrism = buildFootprintPrism(
      footprintPolygon,
      [lng, lat],
      -8,           // a bit lower so ground triangles aren't clipped
      eaveH + 25,
      3.0,          // 3 m outward — keeps boundary triangles, rejects 5m+ spikes
    )

    // Diagnostic: world-space bbox of loaded tile geometry, before cropping.
    // (No manual updateMatrixWorld — see note in meshCropper.ts.)
    const tilesBbox = new THREE.Box3().makeEmpty()
    let tileMeshCount = 0
    let tileTriCount = 0
    tileScene.tiles.group.traverse((obj) => {
      const m = obj as THREE.Mesh
      if (!m.isMesh) return
      tileMeshCount++
      const g = m.geometry as THREE.BufferGeometry
      if (g.boundingBox) {
        const bb = g.boundingBox.clone().applyMatrix4(m.matrixWorld)
        tilesBbox.union(bb)
      } else {
        g.computeBoundingBox()
        if (g.boundingBox) {
          const bb = (g.boundingBox as THREE.Box3).clone().applyMatrix4(m.matrixWorld)
          tilesBbox.union(bb)
        }
      }
      const pos = g.getAttribute('position')
      if (pos) tileTriCount += (g.getIndex()?.count ?? pos.count) / 3
    })
    console.debug('[reconstruct] tile geometry diagnostics', {
      meshCount: tileMeshCount,
      triangleCount: tileTriCount,
      worldBbox: tilesBbox.isEmpty() ? null : {
        min: tilesBbox.min.toArray(),
        max: tilesBbox.max.toArray(),
      },
      prismBbox: {
        min: prism.bbox.min.toArray(),
        max: prism.bbox.max.toArray(),
      },
    })

    const cropped = cropMeshToPrism(tileScene.tiles.group, prism, vertexPrism)
    throwIfAborted()

    if (cropped.triangleCount === 0) {
      const tb = tilesBbox.isEmpty() ? null : { min: tilesBbox.min.toArray(), max: tilesBbox.max.toArray() }
      const pb = { min: prism.bbox.min.toArray(), max: prism.bbox.max.toArray() }
      throw new Error(
        `No tile geometry inside the building footprint. ` +
        `Tile meshes: ${tileMeshCount}, tile tris: ${tileTriCount}. ` +
        `Tile world bbox: ${JSON.stringify(tb)}. Prism bbox: ${JSON.stringify(pb)}.`,
      )
    }

    emit('extracting-geometry', 1, `Kept ${cropped.triangleCount.toLocaleString()} triangles`)

    // NOTE: mergeVertices + fillSmallHoles were attempted in v2 but they
    // collapse the per-source-material geometry groups that the multi-
    // material output mesh relies on. Without groups, only materials[0] is
    // used for all triangles, breaking the textures. They remain in the
    // codebase for future use once the rebake pipeline supports per-group
    // re-baking with proper UV unwrap.

    // ─── 3b. Dedicated spec capture pass + isolation (v3) ───────────────────
    // The 48-view orbit above is tuned for texture re-bake (broad viewpoint
    // diversity, all from aerial altitudes). Hunyuan3D-2 multi-view instead
    // wants near-horizontal "drone-eye" framing where the building's walls
    // fill the centre of the frame. Re-using the rebake captures fed it
    // roof-from-above shots and Hunyuan dutifully returned a roof-shaped
    // slab. Solution: a second 4-shot orbit at building mid-height with a
    // wider FOV and closer radius.
    let specInputs: ReconstructionSpecInputs | undefined
    if (wantSpecInputs) {
      emit('isolating-views', 0, 'Capturing drone-eye views...')

      // Cropped geometry is in world space; compute its real-world bbox to
      // size the orbit. Use horizontal extent to pick a radius that frames
      // the building tightly.
      cropped.geometry.computeBoundingBox()
      const cbb = cropped.geometry.boundingBox!
      const cdim = new THREE.Vector3()
      cbb.getSize(cdim)
      const ccentre = new THREE.Vector3()
      cbb.getCenter(ccentre)
      const horizExtent = Math.max(cdim.x, cdim.z)
      // Pull camera back ~1.8× the half-width so the building fills ~70% of
      // the frame at 55° FOV; clamp so we don't end up inside the geometry.
      const mlRadius = Math.max(horizExtent * 0.9 + 6, 10)
      // Camera at half-building-height — looks horizontal at building centre.
      const mlAltitude = ccentre.y
      // Orbit target = cropped building centre (in world space). The orbit
      // helper uses target.y to set camera y as `target.y + altitude`, so
      // wrap that into a single absolute target.
      const mlTarget = ccentre.clone()
      const azimuths = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]

      const mlCaptures: CapturedView[] = await captureOrbit(tileScene.renderer, tileScene.scene, {
        target: mlTarget,
        radii: [mlRadius],
        altitudes: [mlAltitude - mlTarget.y],  // helper adds target.y; net y = mlAltitude
        azimuths,
        captureSize: 1024,
        fov: 55,
        beforeCapture: async () => {
          for (let i = 0; i < 3; i++) {
            tileScene.updateTiles()
            await new Promise(requestAnimationFrame)
          }
          throwIfAborted()
        },
      })

      console.debug('[reconstruct] ml capture orbit', {
        target: mlTarget.toArray(),
        radius: mlRadius,
        altitude: mlAltitude,
        bboxSize: cdim.toArray(),
      })

      // azimuth convention: cap[0]=south (front), [1]=east (right), [2]=north (back), [3]=west (left)
      emit('isolating-views', 0.4, 'Masking front view...')
      const frontBlob = await isolateBuilding(mlCaptures[0], cropped.geometry, tileScene.renderer)
      throwIfAborted()
      emit('isolating-views', 0.55, 'Masking right view...')
      const rightBlob = await isolateBuilding(mlCaptures[1], cropped.geometry, tileScene.renderer)
      throwIfAborted()
      emit('isolating-views', 0.7, 'Masking back view...')
      const backBlob = await isolateBuilding(mlCaptures[2], cropped.geometry, tileScene.renderer)
      throwIfAborted()
      emit('isolating-views', 0.85, 'Masking left view...')
      const leftBlob = await isolateBuilding(mlCaptures[3], cropped.geometry, tileScene.renderer)
      throwIfAborted()

      specInputs = {
        front: { blob: frontBlob, capture: mlCaptures[0] },
        right: { blob: rightBlob, capture: mlCaptures[1] },
        back:  { blob: backBlob,  capture: mlCaptures[2] },
        left:  { blob: leftBlob,  capture: mlCaptures[3] },
        dimensionsM: { x: cdim.x, y: cdim.y, z: cdim.z },
      }
      emit('isolating-views', 1, 'Isolated 4 drone-eye views')
    }

    // ─── 4. Texture re-bake (optional) ──────────────────────────────────────
    let outputMesh: THREE.Object3D
    let rebaked = false

    if (wantRebake && captures.length > 0) {
      emit('rebaking-textures', 0, 'Re-projecting textures from each view...')
      const baked = rebakeTextures(tileScene.renderer, cropped.geometry, captures, 2048)
      const mesh = new THREE.Mesh(baked.geometry, baked.material)
      outputMesh = mesh
      rebaked = true
      emit('rebaking-textures', 1, 'Texture atlas ready')
    } else {
      // Preserve original tile materials via multi-material group structure.
      // GLTFExporter handles materials[] when the geometry has groups.
      outputMesh = new THREE.Mesh(cropped.geometry, cropped.materials.length === 1 ? cropped.materials[0] : cropped.materials)
    }

    // Centre the mesh at origin so consumers don't need to know world coords.
    cropped.geometry.computeBoundingBox()
    const bb = cropped.geometry.boundingBox!
    const centre = new THREE.Vector3()
    bb.getCenter(centre)
    centre.y = bb.min.y  // keep ground at y=0
    outputMesh.position.sub(centre)

    // ─── 5. GLB export ──────────────────────────────────────────────────────
    emit('exporting', 0.2, 'Packaging GLB...')

    const exportRoot = new THREE.Group()
    exportRoot.add(outputMesh)
    const glb = await exportGLB(exportRoot)
    throwIfAborted()

    emit('done', 1, 'Reconstruction complete')

    const dim = new THREE.Vector3()
    bb.getSize(dim)
    return {
      glb,
      triangleCount: cropped.triangleCount,
      dimensionsM: { x: dim.x, y: dim.y, z: dim.z },
      rebaked,
      specInputs,
      croppedGeometry: cropped.geometry,
    }
  } finally {
    tileScene.dispose()
  }
}
