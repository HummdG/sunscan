import * as THREE from 'three'

export interface CapturedView {
  /** RGBA texture holding the captured render (size = captureSize x captureSize) */
  texture: THREE.Texture
  /** Camera position in world space */
  position: THREE.Vector3
  /** view matrix (world → camera) */
  viewMatrix: THREE.Matrix4
  /** projection matrix (camera → clip) */
  projectionMatrix: THREE.Matrix4
}

export interface OrbitCaptureOpts {
  /** Centre of orbit in world coords (typically the building centroid) */
  target: THREE.Vector3
  /** Radii in metres to position the camera at */
  radii: number[]
  /** Altitudes above target in metres */
  altitudes: number[]
  /** Azimuth angles in radians (0 = +z direction in Three.js conv = south) */
  azimuths: number[]
  /** Square texture size for each capture (default 1024) */
  captureSize?: number
  /** Perspective camera FOV in degrees (default 40). Drone-eye / wall-capture
   * shots want ~55° so the full vertical extent of the building stays in frame
   * from close range. */
  fov?: number
  /** Called per capture so callers can re-trigger tile updates between renders */
  beforeCapture?: (capture: { altitude: number; radius: number; azimuth: number }) => Promise<void> | void
}

/**
 * Orbit a camera around the target, render the scene at each pose, and return
 * the captured RGBA textures alongside the camera matrices.
 *
 * The renderer's drawing buffer is sampled into a separate render target so
 * subsequent renders into the on-screen canvas don't clobber the captures.
 */
export async function captureOrbit(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  opts: OrbitCaptureOpts,
): Promise<CapturedView[]> {
  const size = opts.captureSize ?? 1024
  const captures: CapturedView[] = []

  const cam = new THREE.PerspectiveCamera(opts.fov ?? 40, 1, 0.5, 2000)

  // Snapshot the renderer's current size so we can restore it.
  const prevSize = new THREE.Vector2()
  renderer.getSize(prevSize)
  const prevTarget = renderer.getRenderTarget()

  renderer.setSize(size, size, false)

  for (const altitude of opts.altitudes) {
    for (const radius of opts.radii) {
      for (const azimuth of opts.azimuths) {
        if (opts.beforeCapture) {
          await opts.beforeCapture({ altitude, radius, azimuth })
        }

        const x = opts.target.x + Math.sin(azimuth) * radius
        const z = opts.target.z + Math.cos(azimuth) * radius
        const y = opts.target.y + altitude
        cam.position.set(x, y, z)
        cam.lookAt(opts.target)
        cam.updateMatrixWorld(true)
        cam.updateProjectionMatrix()

        const rt = new THREE.WebGLRenderTarget(size, size, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          generateMipmaps: false,
        })

        renderer.setRenderTarget(rt)
        renderer.clear(true, true, true)
        renderer.render(scene, cam)
        renderer.setRenderTarget(null)

        captures.push({
          texture: rt.texture,
          position: cam.position.clone(),
          viewMatrix: cam.matrixWorldInverse.clone(),
          projectionMatrix: cam.projectionMatrix.clone(),
        })
      }
    }
  }

  renderer.setSize(prevSize.x, prevSize.y, false)
  renderer.setRenderTarget(prevTarget)

  return captures
}
