'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Camera } from 'lucide-react'

interface LoadedScene {
  scene: THREE.Object3D
  /** approximate longest horizontal dimension in metres */
  span: number
  /** vertical centre */
  centreY: number
}

export type ModelSourceVariant = 'corrected' | 'raw'

export type ModelSourceProp =
  | Blob
  | string
  | { corrected: string; raw: string }
  | null

const TOGGLE_STORAGE_KEY = 'sunscan.reconstruction.modelSource'

function isDualSource(s: ModelSourceProp): s is { corrected: string; raw: string } {
  return !!s && typeof s === 'object' && 'corrected' in s && 'raw' in s
}

function readStoredVariant(): ModelSourceVariant {
  if (typeof window === 'undefined') return 'corrected'
  try {
    const v = window.localStorage.getItem(TOGGLE_STORAGE_KEY)
    return v === 'raw' ? 'raw' : 'corrected'
  } catch {
    return 'corrected'
  }
}

function persistStoredVariant(v: ModelSourceVariant): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(TOGGLE_STORAGE_KEY, v) } catch { /* ignore */ }
}

async function loadGlb(source: Blob | string): Promise<LoadedScene> {
  const loader = new GLTFLoader()
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const gltf = await loader.loadAsync(url)
    const root = gltf.scene
    const box = new THREE.Box3().setFromObject(root)
    const size = new THREE.Vector3()
    box.getSize(size)
    const span = Math.max(size.x, size.z, 6)
    const centreY = (box.min.y + box.max.y) * 0.5
    return { scene: root, span, centreY }
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url)
  }
}

function useGltfBlob(source: Blob | string | null): { scene: LoadedScene | null; error: string | null } {
  const [scene, setScene] = useState<LoadedScene | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await Promise.resolve()
      if (cancelled) return
      setScene(null)
      setError(null)
      if (!source) return
      try {
        const loaded = await loadGlb(source)
        if (!cancelled) setScene(loaded)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load model')
      }
    })()
    return () => { cancelled = true }
  }, [source])

  return { scene, error }
}

function useDualGltf(source: { corrected: string; raw: string } | null): {
  scenes: Map<ModelSourceVariant, LoadedScene>
  ready: boolean
  error: string | null
} {
  const [scenes, setScenes] = useState<Map<ModelSourceVariant, LoadedScene>>(new Map())
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await Promise.resolve()
      if (cancelled) return
      setScenes(new Map())
      setReady(false)
      setError(null)
      if (!source) return
      try {
        const [corrected, raw] = await Promise.all([
          loadGlb(source.corrected),
          loadGlb(source.raw),
        ])
        if (cancelled) return
        const map = new Map<ModelSourceVariant, LoadedScene>()
        map.set('corrected', corrected)
        map.set('raw', raw)
        setScenes(map)
        setReady(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load model')
      }
    })()
    return () => { cancelled = true }
  }, [source])

  return { scenes, ready, error }
}

function SceneContent({ scene }: { scene: LoadedScene }) {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[12, 18, 8]} intensity={1.1} />
      <directionalLight position={[-8, 10, -10]} intensity={0.3} />
      <primitive object={scene.scene} />
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        target={[0, scene.centreY, 0]}
        minDistance={Math.max(4, scene.span * 0.35)}
        maxDistance={scene.span * 4}
      />
    </>
  )
}

function CaptureBridge({ onCaptureRef }: { onCaptureRef: React.MutableRefObject<(() => string) | null> }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    onCaptureRef.current = () => {
      gl.render(scene, camera)
      return gl.domElement.toDataURL('image/png')
    }
    return () => { onCaptureRef.current = null }
  }, [gl, scene, camera, onCaptureRef])
  return null
}

export interface ReconstructedModelViewProps {
  /** GLB source — a remote URL, an in-memory Blob, or { corrected, raw } pair for the toggle. */
  source: ModelSourceProp
  /** Optional capture callback for the PDF; receives a PNG dataURL */
  onCapture?: (dataUrl: string) => void
  height?: number
}

export function ReconstructedModelView({ source, onCapture, height = 380 }: ReconstructedModelViewProps) {
  const dual = isDualSource(source) ? source : null
  const single = dual ? null : (source as Blob | string | null)

  const singleResult = useGltfBlob(single)
  const dualResult = useDualGltf(dual)
  const [variant, setVariantState] = useState<ModelSourceVariant>(() => readStoredVariant())

  const setVariant = (v: ModelSourceVariant) => {
    setVariantState(v)
    persistStoredVariant(v)
  }

  const activeScene: LoadedScene | null = dual
    ? (dualResult.scenes.get(variant) ?? null)
    : singleResult.scene

  const error = dual ? dualResult.error : singleResult.error
  const captureRef = useRef<(() => string) | null>(null)

  const camPos = useMemo<[number, number, number]>(() => {
    if (!activeScene) return [12, 9, 12]
    const r = activeScene.span * 1.4
    return [r * 0.55, activeScene.span * 0.9, r]
  }, [activeScene])

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center text-sm text-red-600 bg-red-50 rounded-xl">
        Failed to load reconstructed model: {error}
      </div>
    )
  }

  return (
    <div className="relative w-full h-full" style={{ height }}>
      {!activeScene ? (
        <Skeleton className="w-full h-full" />
      ) : (
        <>
          <Canvas
            camera={{ position: camPos, fov: 40 }}
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            shadows
          >
            <Suspense fallback={null}>
              <SceneContent scene={activeScene} />
              <CaptureBridge onCaptureRef={captureRef} />
            </Suspense>
          </Canvas>

          <div className="absolute top-3 left-3 text-xs text-white/85 bg-black/30 rounded px-2 py-0.5">
            Drag to rotate · Scroll to zoom
          </div>

          {dual && (
            <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
              <div
                className="inline-flex rounded-md shadow border border-white/40 bg-black/40 backdrop-blur text-[11px] overflow-hidden"
                role="tablist"
                aria-label="Reconstructed model source"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant === 'corrected'}
                  onClick={() => setVariant('corrected')}
                  className={`px-2.5 py-1 transition-colors ${
                    variant === 'corrected'
                      ? 'bg-white text-slate-900'
                      : 'text-white/85 hover:bg-white/10'
                  }`}
                >
                  Roof-corrected
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant === 'raw'}
                  onClick={() => setVariant('raw')}
                  className={`px-2.5 py-1 transition-colors ${
                    variant === 'raw'
                      ? 'bg-white text-slate-900'
                      : 'text-white/85 hover:bg-white/10'
                  }`}
                >
                  Meshy raw
                </button>
              </div>
              <div className="text-[10px] text-white/80 bg-black/30 rounded px-1.5 py-0.5 max-w-[15rem] text-right leading-tight">
                Corrected: roof rebuilt from Google Solar data. Raw: Meshy AI output.
              </div>
            </div>
          )}

          {onCapture && !dual && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-3 right-3 gap-1.5 shadow"
              onClick={() => { if (captureRef.current) onCapture(captureRef.current()) }}
            >
              <Camera className="h-3.5 w-3.5" />
              Capture
            </Button>
          )}

          {onCapture && dual && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute bottom-3 right-3 gap-1.5 shadow"
              onClick={() => { if (captureRef.current) onCapture(captureRef.current()) }}
            >
              <Camera className="h-3.5 w-3.5" />
              Capture
            </Button>
          )}
        </>
      )}
    </div>
  )
}
