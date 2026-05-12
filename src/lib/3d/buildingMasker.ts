import * as THREE from 'three'
import type { CapturedView } from './multiViewCapture'

/**
 * Given a captured render of the live tile scene AND a cropped building-only
 * geometry (positions already in world space), produce a PNG with the
 * building's pixels kept and the rest set transparent.
 *
 * Why: image-to-3D models like Hunyuan3D-2 multi-view expect an *isolated*
 * object. Feed them an unmasked tile render and they will dutifully model
 * "whatever was in the frame" — for a UK terraced street that's a 3-house
 * blob, not the one we want.
 *
 * Approach:
 *   1. Render the cropped geometry from the same camera that produced the
 *      capture, with a flat white silhouette material. Pixels covered by
 *      the building become non-black.
 *   2. Render the capture texture to an RT via a screen-quad pass so we
 *      can read its pixels back (CapturedView.texture is bound to its own
 *      WebGLRenderTarget which we don't have a handle to).
 *   3. Composite: rgba = covered ? captureRGB : (0,0,0,0).
 *   4. Encode as PNG via canvas.toBlob.
 */
export async function isolateBuilding(
  capture: CapturedView,
  croppedGeometry: THREE.BufferGeometry,
  renderer: THREE.WebGLRenderer,
): Promise<Blob> {
  const image = capture.texture.image as { width: number; height: number } | undefined
  const w = image?.width ?? 1024
  const h = image?.height ?? 1024

  const prevSize = new THREE.Vector2()
  renderer.getSize(prevSize)
  const prevTarget = renderer.getRenderTarget()
  const prevAutoClear = renderer.autoClear
  const prevClearColor = new THREE.Color()
  renderer.getClearColor(prevClearColor)
  const prevClearAlpha = renderer.getClearAlpha()

  // 1. Silhouette pass
  const silhouetteMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  })
  const silhouetteMesh = new THREE.Mesh(croppedGeometry, silhouetteMat)
  silhouetteMesh.matrixAutoUpdate = false
  silhouetteMesh.matrix.identity()
  silhouetteMesh.matrixWorld.identity()

  const silScene = new THREE.Scene()
  silScene.background = null
  silScene.add(silhouetteMesh)

  // Reconstruct camera from capture matrices
  const cam = new THREE.PerspectiveCamera()
  cam.matrixAutoUpdate = false
  cam.matrixWorldInverse.copy(capture.viewMatrix)
  cam.matrixWorld.copy(capture.viewMatrix).invert()
  cam.matrix.copy(cam.matrixWorld)
  cam.projectionMatrix.copy(capture.projectionMatrix)
  cam.projectionMatrixInverse.copy(capture.projectionMatrix).invert()

  const silRT = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
  })

  renderer.setSize(w, h, false)
  renderer.setRenderTarget(silRT)
  renderer.setClearColor(0x000000, 0)
  renderer.autoClear = true
  renderer.clear(true, true, true)
  renderer.render(silScene, cam)
  const silhouette = new Uint8Array(w * h * 4)
  renderer.readRenderTargetPixels(silRT, 0, 0, w, h, silhouette)

  // 2. Re-render the capture texture into a readable RT
  const captureRgba = await readTextureRgba(renderer, capture.texture, w, h)

  // 3. Composite (GL framebuffer: origin bottom-left)
  const composite = new Uint8ClampedArray(w * h * 4)
  let coveredPx = 0
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4
    const covered = silhouette[idx] + silhouette[idx + 1] + silhouette[idx + 2] > 8
    if (covered) {
      coveredPx++
      composite[idx]     = captureRgba[idx]
      composite[idx + 1] = captureRgba[idx + 1]
      composite[idx + 2] = captureRgba[idx + 2]
      composite[idx + 3] = 255
    }
  }
  const coverage = coveredPx / (w * h)
  // Healthy mask: 0.2–0.6 of frame. <0.05 = building barely visible (camera
  // too far / framing wrong); >0.85 = mask filled the screen (probably wrong
  // matrices). Either extreme is why Hunyuan would emit a degenerate mesh.
  console.debug(`[buildingMasker] coverage ${(coverage * 100).toFixed(1)}% (${coveredPx}/${w * h} px)`)

  // 4. Flip Y for canvas (origin top-left) and encode PNG
  const flipped = new Uint8ClampedArray(w * h * 4)
  const stride = w * 4
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * stride
    const dstRow = y * stride
    flipped.set(composite.subarray(srcRow, srcRow + stride), dstRow)
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.putImageData(new ImageData(flipped, w, h), 0, 0)
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/png')
  })

  // Cleanup
  silRT.dispose()
  silhouetteMat.dispose()

  // Restore renderer state
  renderer.setSize(prevSize.x, prevSize.y, false)
  renderer.setRenderTarget(prevTarget)
  renderer.autoClear = prevAutoClear
  renderer.setClearColor(prevClearColor, prevClearAlpha)

  return blob
}

/**
 * Read a Three.js texture back to a CPU pixel array by drawing it to a temp
 * RT with a screen-quad pass. CapturedView textures are bound to their own
 * WebGLRenderTargets which we don't have a direct handle to — this is the
 * portable workaround.
 *
 * Output is in GL framebuffer orientation (origin bottom-left), matching
 * the silhouette pass so they composite without an alignment fix-up.
 */
async function readTextureRgba(
  renderer: THREE.WebGLRenderer,
  texture: THREE.Texture,
  w: number,
  h: number,
): Promise<Uint8Array> {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
  })

  const scene = new THREE.Scene()
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false }),
  )
  scene.add(quad)
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const prevTarget = renderer.getRenderTarget()
  renderer.setRenderTarget(rt)
  renderer.clear(true, true, true)
  renderer.render(scene, cam)
  renderer.setRenderTarget(prevTarget)

  const out = new Uint8Array(w * h * 4)
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, out)

  rt.dispose()
  quad.geometry.dispose()
  ;(quad.material as THREE.Material).dispose()

  return out
}
