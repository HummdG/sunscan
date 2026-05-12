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

function useGltfBlob(source: Blob | string | null): { scene: LoadedScene | null; error: string | null } {
  const [scene, setScene] = useState<LoadedScene | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Defer state clearing into a microtask so React doesn't see synchronous
      // setState within the effect body.
      await Promise.resolve()
      if (cancelled) return
      setScene(null)
      setError(null)
      if (!source) return

      try {
        const loader = new GLTFLoader()
        const url = typeof source === 'string' ? source : URL.createObjectURL(source)
        const gltf = await loader.loadAsync(url)
        if (cancelled) {
          if (typeof source !== 'string') URL.revokeObjectURL(url)
          return
        }
        if (typeof source !== 'string') URL.revokeObjectURL(url)

        const root = gltf.scene
        const box = new THREE.Box3().setFromObject(root)
        const size = new THREE.Vector3()
        box.getSize(size)
        const span = Math.max(size.x, size.z, 6)
        const centreY = (box.min.y + box.max.y) * 0.5

        setScene({ scene: root, span, centreY })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load model')
      }
    })()
    return () => { cancelled = true }
  }, [source])

  return { scene, error }
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
  /** GLB source — either a remote URL or an in-memory Blob */
  source: Blob | string | null
  /** Optional capture callback for the PDF; receives a PNG dataURL */
  onCapture?: (dataUrl: string) => void
  height?: number
}

export function ReconstructedModelView({ source, onCapture, height = 380 }: ReconstructedModelViewProps) {
  const { scene, error } = useGltfBlob(source)
  const captureRef = useRef<(() => string) | null>(null)

  const camPos = useMemo<[number, number, number]>(() => {
    if (!scene) return [12, 9, 12]
    const r = scene.span * 1.4
    return [r * 0.55, scene.span * 0.9, r]
  }, [scene])

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center text-sm text-red-600 bg-red-50 rounded-xl">
        Failed to load reconstructed model: {error}
      </div>
    )
  }

  return (
    <div className="relative w-full h-full" style={{ height }}>
      {!scene ? (
        <Skeleton className="w-full h-full" />
      ) : (
        <>
          <Canvas
            camera={{ position: camPos, fov: 40 }}
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            shadows
          >
            <Suspense fallback={null}>
              <SceneContent scene={scene} />
              <CaptureBridge onCaptureRef={captureRef} />
            </Suspense>
          </Canvas>

          <div className="absolute top-3 left-3 text-xs text-white/85 bg-black/30 rounded px-2 py-0.5">
            Drag to rotate · Scroll to zoom
          </div>

          {onCapture && (
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
        </>
      )}
    </div>
  )
}
