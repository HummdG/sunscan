import * as THREE from 'three'
import { TilesRenderer, WGS84_ELLIPSOID } from '3d-tiles-renderer'
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins'

const TILES_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json'
const DEG2RAD = Math.PI / 180

export interface OffscreenTileScene {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  tiles: TilesRenderer
  /** Update tiles for the current camera; call before render */
  updateTiles(): void
  /** Resolves once tile loads quiesce or the timeout elapses */
  waitForSettle(opts?: { timeoutMs?: number; quietMs?: number; minMeshes?: number }): Promise<{ meshCount: number; loadEvents: number }>
  dispose(): void
}

/**
 * Stand up a hidden Three.js scene with a TilesRenderer anchored at the given
 * lat/lng. errorTarget=1 forces high-detail tile streaming when the camera is
 * close to the building.
 *
 * The renderer uses an offscreen canvas that is never attached to the DOM.
 */
export function createOffscreenTileScene(
  lat: number,
  lng: number,
  groundAlt: number,
  apiKey: string,
  width = 1024,
  height = 1024,
): OffscreenTileScene {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height })

  const renderer = new THREE.WebGLRenderer({
    canvas: canvas as HTMLCanvasElement,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true,
  })
  renderer.setSize(width, height, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 1.0))
  const sun = new THREE.DirectionalLight(0xffffff, 0.6)
  sun.position.set(8, 20, 12)
  scene.add(sun)

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 4000)

  const tiles = new TilesRenderer(TILES_ROOT)
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, useRecommendedSettings: true }))
  // errorTarget=8 matches the existing on-screen viewer — high enough that
  // the LOD hierarchy descends to building detail within a few seconds.
  // We descended to lower values previously but tile meshes never reached
  // the building level inside the offscreen tick budget.
  tiles.errorTarget = 8

  // Place the tiles group so that (lat, lng, groundAlt) maps to local origin.
  // applyMatrix4 updates both `matrix` AND `position/quaternion/scale`,
  // unlike `matrix.copy()` which leaves TRS stale. With auto-update on the
  // default `true`, each frame `updateMatrix()` recomposes from TRS — which
  // is consistent and idempotent, so `matrixWorld` propagation through the
  // tile children works correctly.
  const frame = new THREE.Matrix4()
  WGS84_ELLIPSOID.getOrientedEastNorthUpFrame(
    lat * DEG2RAD,
    lng * DEG2RAD,
    groundAlt,
    0, 0, 0,
    frame,
  )
  const invFrame = frame.clone().invert()
  tiles.group.applyMatrix4(invFrame)

  scene.add(tiles.group)

  function updateTiles() {
    tiles.setCamera(camera)
    tiles.setResolutionFromRenderer(camera, renderer)
    tiles.update()
    // Rendering the scene is what triggers Three's matrixWorld propagation
    // (via scene.updateMatrixWorld inside renderer.render). Without it, tile
    // meshes never inherit the group's east-north-up frame and stay in ECEF.
    renderer.render(scene, camera)
  }

  function countMeshes(): number {
    let n = 0
    tiles.group.traverse((obj) => { if ((obj as THREE.Mesh).isMesh) n++ })
    return n
  }

  function waitForSettle({
    timeoutMs = 25_000,
    quietMs = 1_500,
    minMeshes = 1,
  }: { timeoutMs?: number; quietMs?: number; minMeshes?: number } = {}): Promise<{ meshCount: number; loadEvents: number }> {
    return new Promise((resolve) => {
      const start = performance.now()
      let lastActivity = start
      let loadEvents = 0

      const onLoad = () => { lastActivity = performance.now(); loadEvents++ }
      const onError = () => { lastActivity = performance.now() }
      tiles.addEventListener('tile-load-end', onLoad)
      tiles.addEventListener('tile-load-error', onError)

      const tick = () => {
        updateTiles()
        const now = performance.now()
        const quiet = now - lastActivity
        const elapsed = now - start
        const meshes = countMeshes()

        // Settle only once we have at least one mesh AND the network has been
        // quiet for `quietMs`. Otherwise wait until timeout.
        const haveMeshes = meshes >= minMeshes
        const quietEnough = quiet >= quietMs
        if ((haveMeshes && quietEnough) || elapsed >= timeoutMs) {
          tiles.removeEventListener('tile-load-end', onLoad)
          tiles.removeEventListener('tile-load-error', onError)
          resolve({ meshCount: meshes, loadEvents })
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  function dispose() {
    scene.remove(tiles.group)
    tiles.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }

  return { scene, camera, renderer, tiles, updateTiles, waitForSettle, dispose }
}
