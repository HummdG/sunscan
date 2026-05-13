/**
 * @deprecated Superseded by the Meshy + roof-correction pipeline. Slated for
 * removal after the new pipeline is validated.
 */
import * as THREE from 'three'
import { applySlotAtlas } from './slotAtlas'
import type { CapturedView } from './multiViewCapture'

export interface RebakedMesh {
  geometry: THREE.BufferGeometry
  texture: THREE.Texture
  /** Single material referencing the baked atlas */
  material: THREE.MeshBasicMaterial
}

/**
 * Re-bake textures onto a cropped mesh by projecting multiple captures into a
 * unified UV atlas.
 *
 * v2 uses a per-triangle slot atlas (see `slotAtlas.ts`) which guarantees
 * non-overlapping UVs. The v1 planar XZ projection collapsed multiple
 * triangles to the same atlas slot and produced visual garbage.
 *
 * Algorithm per capture:
 *   - vertex shader places the triangle at (uv*2-1, 0, 1) in clip space —
 *     i.e. draws the triangle at its atlas location.
 *   - fragment shader projects the world position into the capture's view,
 *     samples the capture texture, weights by dot(normal, viewDir), and
 *     outputs color * weight + weight (additive blending).
 *   - all captures accumulate into one atlas RT.
 *
 * After the dehydrate pass, atlas pixels that received no contribution
 * (alpha=0) get filled by iterative dilation from neighbours — bleeds
 * adjacent texture across small coverage gaps without inventing detail.
 */
export function rebakeTextures(
  renderer: THREE.WebGLRenderer,
  inputGeometry: THREE.BufferGeometry,
  captures: CapturedView[],
  atlasSize = 2048,
): RebakedMesh {
  // 1. Apply per-triangle slot atlas UVs.
  const geometry = applySlotAtlas(inputGeometry, atlasSize)

  if (captures.length === 0) {
    const data = new Uint8Array(atlasSize * atlasSize * 4)
    data.fill(160)
    for (let i = 3; i < data.length; i += 4) data[i] = 255
    const tex = new THREE.DataTexture(data, atlasSize, atlasSize, THREE.RGBAFormat)
    tex.needsUpdate = true
    return {
      geometry,
      texture: tex,
      material: new THREE.MeshBasicMaterial({ map: tex }),
    }
  }

  // 2. Allocate atlas render target.
  const atlasRT = new THREE.WebGLRenderTarget(atlasSize, atlasSize, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
  })

  // 3. Shader for projective bake.
  const bakeMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uCaptureTex: { value: null },
      uCaptureView: { value: new THREE.Matrix4() },
      uCaptureProj: { value: new THREE.Matrix4() },
      uCaptureWorldPos: { value: new THREE.Vector3() },
    },
    vertexShader: `
      in vec3 position;
      in vec3 normal;
      in vec2 uv;
      out vec3 vWorldPos;
      out vec3 vNormal;
      void main() {
        vWorldPos = position;
        vNormal = normal;
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uCaptureTex;
      uniform mat4 uCaptureView;
      uniform mat4 uCaptureProj;
      uniform vec3 uCaptureWorldPos;
      in vec3 vWorldPos;
      in vec3 vNormal;
      out vec4 outColor;
      void main() {
        vec4 cam = uCaptureView * vec4(vWorldPos, 1.0);
        vec4 clip = uCaptureProj * cam;
        if (clip.w <= 0.0) discard;
        vec3 ndc = clip.xyz / clip.w;
        if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z < -1.0 || ndc.z > 1.0) discard;
        vec2 texUV = ndc.xy * 0.5 + 0.5;
        vec3 viewDir = normalize(uCaptureWorldPos - vWorldPos);
        float w = max(0.0, dot(normalize(vNormal), viewDir));
        // Penalise grazing angles harder
        w = pow(w, 2.0);
        if (w < 0.02) discard;
        vec3 col = texture(uCaptureTex, texUV).rgb;
        outColor = vec4(col * w, w);
      }
    `,
  })

  const bakeScene = new THREE.Scene()
  const bakeMesh = new THREE.Mesh(geometry, bakeMaterial)
  bakeScene.add(bakeMesh)

  const bakeCamera = new THREE.Camera()

  const prevTarget = renderer.getRenderTarget()
  renderer.setRenderTarget(atlasRT)
  renderer.setClearColor(0x000000, 0)
  renderer.clear(true, true, true)

  for (const cap of captures) {
    bakeMaterial.uniforms.uCaptureTex.value = cap.texture
    bakeMaterial.uniforms.uCaptureView.value.copy(cap.viewMatrix)
    bakeMaterial.uniforms.uCaptureProj.value.copy(cap.projectionMatrix)
    bakeMaterial.uniforms.uCaptureWorldPos.value.copy(cap.position)
    bakeMaterial.uniformsNeedUpdate = true
    renderer.render(bakeScene, bakeCamera)
  }

  // 4. Read back pixels.
  const accum = new Uint8Array(atlasSize * atlasSize * 4)
  renderer.readRenderTargetPixels(atlasRT, 0, 0, atlasSize, atlasSize, accum)

  renderer.setRenderTarget(prevTarget)

  // 5. Dehydrate weighted average and mark coverage in alpha channel.
  //    alpha=255 means "this texel has a baked colour", alpha=0 means "gap".
  const finalData = new Uint8Array(atlasSize * atlasSize * 4)
  for (let i = 0; i < accum.length; i += 4) {
    const a = accum[i + 3]
    if (a === 0) {
      finalData[i] = 0; finalData[i + 1] = 0; finalData[i + 2] = 0; finalData[i + 3] = 0
    } else {
      finalData[i]     = Math.min(255, Math.round((accum[i]     * 255) / a))
      finalData[i + 1] = Math.min(255, Math.round((accum[i + 1] * 255) / a))
      finalData[i + 2] = Math.min(255, Math.round((accum[i + 2] * 255) / a))
      finalData[i + 3] = 255
    }
  }

  // 6. Iterative dilation: fill gap pixels (alpha==0) from any non-gap
  //    neighbour. Run several passes — each pass expands coverage by one
  //    pixel in all directions, so K passes fills gaps up to K pixels wide.
  dilateGaps(finalData, atlasSize, atlasSize, 24)

  // 7. Flip Y so DataTexture orientation matches GL framebuffer.
  const flipped = new Uint8Array(finalData.length)
  const stride = atlasSize * 4
  for (let y = 0; y < atlasSize; y++) {
    const srcRow = (atlasSize - 1 - y) * stride
    const dstRow = y * stride
    flipped.set(finalData.subarray(srcRow, srcRow + stride), dstRow)
  }

  const texture = new THREE.DataTexture(flipped, atlasSize, atlasSize, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  atlasRT.dispose()
  bakeMaterial.dispose()

  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })

  return { geometry, texture, material }
}

/**
 * Iterative dilation: for each gap pixel (alpha=0), if any 4-neighbour has
 * coverage (alpha=255), copy that neighbour's RGB and mark coverage. Repeat
 * up to `maxPasses` times. Each pass uses a snapshot so the result is
 * deterministic regardless of scan order.
 */
function dilateGaps(data: Uint8Array, w: number, h: number, maxPasses: number) {
  const stride = w * 4
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false
    const snapshot = new Uint8Array(data)  // read from this, write to `data`
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * stride + x * 4
        if (snapshot[idx + 3] !== 0) continue  // already covered

        // Sample the four cardinal neighbours; pick the first covered one.
        const candidates: number[] = []
        if (x > 0     && snapshot[idx - 4 + 3] === 255) candidates.push(idx - 4)
        if (x < w - 1 && snapshot[idx + 4 + 3] === 255) candidates.push(idx + 4)
        if (y > 0     && snapshot[idx - stride + 3] === 255) candidates.push(idx - stride)
        if (y < h - 1 && snapshot[idx + stride + 3] === 255) candidates.push(idx + stride)
        if (candidates.length === 0) continue

        // Average covered neighbours' RGB to avoid directional bias.
        let r = 0, g = 0, b = 0
        for (const c of candidates) {
          r += snapshot[c]; g += snapshot[c + 1]; b += snapshot[c + 2]
        }
        data[idx]     = Math.round(r / candidates.length)
        data[idx + 1] = Math.round(g / candidates.length)
        data[idx + 2] = Math.round(b / candidates.length)
        data[idx + 3] = 255
        changed = true
      }
    }
    if (!changed) break
  }

  // Any remaining gaps (large isolated regions) get neutral grey.
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      data[i] = 140; data[i + 1] = 140; data[i + 2] = 140; data[i + 3] = 255
    }
  }
}
