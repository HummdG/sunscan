import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

export interface MlMeshTarget {
  /** Real-world bounding-box dimensions in metres (from the tile-derived
   * cropped mesh) to which the ML mesh should be uniformly scaled. */
  x: number
  y: number
  z: number
}

/**
 * Parse a fal-returned GLB, uniformly scale it so its dominant horizontal
 * extent matches the real building, drop it to y_min = 0, recentre x/z at
 * the origin, and re-export.
 *
 * Hunyuan3D-2 outputs a mesh roughly centred at the origin with unit-ish
 * scale and no guaranteed orientation match to our world frame. We don't
 * attempt orientation correction here — the viewer auto-frames, and
 * forcing a rotation without knowing the model's true canonical pose
 * would just as likely make things worse. The user can spin the model in
 * the viewer if it lands the "wrong way".
 */
export async function normaliseMlMesh(glb: ArrayBuffer | Blob, target: MlMeshTarget): Promise<Blob> {
  const buffer = glb instanceof Blob ? await glb.arrayBuffer() : glb
  const loader = new GLTFLoader()
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    loader.parse(buffer, '', (g) => resolve(g as { scene: THREE.Group }), (e) => reject(e))
  })

  const root = gltf.scene

  // 1. Bbox in model-local units
  root.updateMatrixWorld(true)
  const bb = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  bb.getSize(size)

  // 2. Uniform scale to fit the dominant horizontal extent. We deliberately
  // don't anisotropic-scale (would shear the mesh) and we don't try to
  // squeeze the height — Hunyuan's vertical proportions are usually fine.
  const horizDom = Math.max(size.x, size.z)
  const targetHorizDom = Math.max(target.x, target.z)
  const scale = horizDom > 0 ? targetHorizDom / horizDom : 1
  root.scale.setScalar(scale)

  // 3. Translate so y_min = 0 and x,z centred at origin
  root.updateMatrixWorld(true)
  const bb2 = new THREE.Box3().setFromObject(root)
  const centre = new THREE.Vector3()
  bb2.getCenter(centre)
  root.position.x -= centre.x
  root.position.z -= centre.z
  root.position.y -= bb2.min.y
  root.updateMatrixWorld(true)

  // 4. Re-export as GLB
  const exporter = new GLTFExporter()
  const result = await new Promise<ArrayBuffer | object>((resolve, reject) => {
    exporter.parse(
      root,
      (r) => resolve(r as ArrayBuffer | object),
      (e) => reject(e),
      { binary: true, embedImages: true },
    )
  })

  if (result instanceof ArrayBuffer) {
    return new Blob([result], { type: 'model/gltf-binary' })
  }
  return new Blob([JSON.stringify(result)], { type: 'model/gltf+json' })
}
