import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

/**
 * Serialise a Three.js Object3D to a binary GLB Blob.
 *
 * Embeds textures and buffers inline so the resulting file is self-contained
 * and can be uploaded to Supabase Storage as a single asset.
 */
export function exportGLB(object: THREE.Object3D): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter()
    exporter.parse(
      object,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: 'model/gltf-binary' }))
        } else {
          // JSON result — wrap as a Blob anyway
          const json = JSON.stringify(result)
          resolve(new Blob([json], { type: 'model/gltf+json' }))
        }
      },
      (err) => reject(err),
      { binary: true, embedImages: true, includeCustomExtensions: false },
    )
  })
}
