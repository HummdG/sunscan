'use client'

import { useRef, Suspense } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { PanelPosition, PanelSpec, RoofAspect } from '@/lib/types'
import { polygonPrincipalAxis } from '@/lib/geometry'

// ─── Building walls ───────────────────────────────────────────────────────────

function Building({
  polygonLocal,
  wallHeightM,
}: {
  polygonLocal: [number, number][]
  wallHeightM: number
}) {
  const shape = new THREE.Shape()
  const [firstX, firstZ] = polygonLocal[0]
  shape.moveTo(firstX, firstZ)
  for (let i = 1; i < polygonLocal.length; i++) {
    shape.lineTo(polygonLocal[i][0], polygonLocal[i][1])
  }
  shape.closePath()
  const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: wallHeightM, bevelEnabled: false })
  wallGeo.rotateX(-Math.PI / 2)
  return (
    <mesh geometry={wallGeo} castShadow receiveShadow>
      <meshLambertMaterial color="#E8E4DC" />
    </mesh>
  )
}

// ─── Roof geometry helpers ────────────────────────────────────────────────────

function makeQuadGeo(a: number[], b: number[], c: number[], d: number[]): THREE.BufferGeometry {
  // Quad [a,b,c,d] → triangles [a,b,c] + [a,c,d]
  const verts = new Float32Array([...a, ...b, ...c, ...a, ...c, ...d])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  return geo
}

function makeTriGeo(a: number[], b: number[], c: number[]): THREE.BufferGeometry {
  const verts = new Float32Array([...a, ...b, ...c])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  return geo
}

// ─── Roof ─────────────────────────────────────────────────────────────────────

function Roof({
  polygonLocal,
  wallHeightM,
  ridgeHeightM,
  roofPitchDeg,
}: {
  polygonLocal: [number, number][]
  wallHeightM: number
  ridgeHeightM: number | undefined
  roofPitchDeg: number
  roofAspect?: RoofAspect
}) {
  // Determine ridge direction from the principal axis of the polygon
  const principalAngle = polygonPrincipalAxis(polygonLocal)
  const rdX = Math.cos(principalAngle)  // ridge direction x
  const rdZ = Math.sin(principalAngle)  // ridge direction z
  const pdX = -Math.sin(principalAngle) // perpendicular to ridge, x
  const pdZ = Math.cos(principalAngle)  // perpendicular to ridge, z

  // Project all polygon vertices onto ridge and perp axes
  let rMin = Infinity, rMax = -Infinity, pMin = Infinity, pMax = -Infinity
  for (const [x, z] of polygonLocal) {
    const r = x * rdX + z * rdZ
    const p = x * pdX + z * pdZ
    if (r < rMin) rMin = r
    if (r > rMax) rMax = r
    if (p < pMin) pMin = p
    if (p > pMax) pMax = p
  }

  const rSpan = rMax - rMin
  const pSpan = pMax - pMin
  const margin = rSpan * 0.12
  const pCenter = (pMin + pMax) / 2

  const pitchRad = (roofPitchDeg * Math.PI) / 180
  const ridgeRise = ridgeHeightM != null
    ? Math.max(0.5, ridgeHeightM - wallHeightM)
    : (pSpan / 2) * Math.tan(pitchRad)
  const ridgeY = wallHeightM + ridgeRise

  // Convert projected (r, p) back to 3D vertex [x, y, z]
  function v(r: number, p: number, y: number): number[] {
    return [r * rdX + p * pdX, y, r * rdZ + p * pdZ]
  }

  const eY = wallHeightM
  // Four eave corners
  const c0 = v(rMin, pMin, eY)  // r_min, p_min
  const c1 = v(rMax, pMin, eY)  // r_max, p_min
  const c2 = v(rMax, pMax, eY)  // r_max, p_max
  const c3 = v(rMin, pMax, eY)  // r_min, p_max
  // Two ridge endpoints
  const r0 = v(rMin + margin, pCenter, ridgeY)  // ridge near-start
  const r1 = v(rMax - margin, pCenter, ridgeY)  // ridge far-end

  // pdZ > 0 means the +pd (p_max) side faces toward +z = south in Three.js convention
  const southColor = '#F59E0B'  // amber — south-facing
  const northColor = '#94A3B8'  // slate — north-facing
  const ewColor    = '#C9B090'  // warm tan — east/west facing
  const hipColor   = '#C5A882'  // neutral tan — hip ends

  let pMaxColor: string, pMinColor: string
  if (pdZ > 0.25) {
    pMaxColor = southColor; pMinColor = northColor
  } else if (pdZ < -0.25) {
    pMaxColor = northColor; pMinColor = southColor
  } else {
    pMaxColor = ewColor; pMinColor = ewColor
  }

  // p_min slope (north-ish facing) — winding CCW from north = [c0,r0,r1,c1]
  const pMinGeo = makeQuadGeo(c0, r0, r1, c1)
  // p_max slope (south-ish facing) — winding CCW from south = [c2,r1,r0,c3]
  const pMaxGeo = makeQuadGeo(c2, r1, r0, c3)
  // r_min hip (west-ish end) — [c0,c3,r0]
  const rMinGeo = makeTriGeo(c0, c3, r0)
  // r_max hip (east-ish end) — [c1,r1,c2]
  const rMaxGeo = makeTriGeo(c1, r1, c2)

  return (
    <group>
      <mesh geometry={pMinGeo} castShadow>
        <meshLambertMaterial color={pMinColor} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={pMaxGeo} castShadow>
        <meshLambertMaterial color={pMaxColor} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={rMinGeo} castShadow>
        <meshLambertMaterial color={hipColor} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={rMaxGeo} castShadow>
        <meshLambertMaterial color={hipColor} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

// ─── Solar panels ─────────────────────────────────────────────────────────────

function SolarPanels({
  positions,
  panelSpec,
  roofPitchDeg,
}: {
  positions: PanelPosition[]
  panelSpec: PanelSpec
  roofPitchDeg: number
}) {
  if (positions.length === 0) return null
  const pitchRad = (roofPitchDeg * Math.PI) / 180
  const wM = panelSpec.widthMm / 1000
  const hM = panelSpec.heightMm / 1000
  const dM = panelSpec.depthMm / 1000
  return (
    <group rotation={[pitchRad, 0, 0]}>
      {positions.map((pos, i) => (
        <mesh key={i} position={[pos.x, 0, pos.z]} castShadow>
          <boxGeometry args={[wM, dM, hM]} />
          <meshLambertMaterial color="#1a1a3e" />
        </mesh>
      ))}
    </group>
  )
}

// ─── Ground ───────────────────────────────────────────────────────────────────

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
      <planeGeometry args={[50, 50]} />
      <meshLambertMaterial color="#7db358" />
    </mesh>
  )
}

// ─── Scene ────────────────────────────────────────────────────────────────────

interface SceneProps {
  buildingPolygonLocalM: [number, number][]
  wallHeightM: number
  ridgeHeightM: number | undefined
  roofPitchDeg: number
  panelPositions: PanelPosition[]
  panelSpec: PanelSpec
  roofAspect?: RoofAspect
  onCaptureRef: React.MutableRefObject<(() => string) | null>
}

function Scene({
  buildingPolygonLocalM,
  wallHeightM,
  ridgeHeightM,
  roofPitchDeg,
  panelPositions,
  panelSpec,
  roofAspect,
  onCaptureRef,
}: SceneProps) {
  const { gl, scene, camera } = useThree()

  onCaptureRef.current = () => {
    gl.render(scene, camera)
    return gl.domElement.toDataURL('image/png')
  }

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 15, 10]} intensity={1.3} castShadow />
      <Building polygonLocal={buildingPolygonLocalM} wallHeightM={wallHeightM} />
      <Roof
        polygonLocal={buildingPolygonLocalM}
        wallHeightM={wallHeightM}
        ridgeHeightM={ridgeHeightM}
        roofPitchDeg={roofPitchDeg}
        roofAspect={roofAspect}
      />
      <SolarPanels positions={panelPositions} panelSpec={panelSpec} roofPitchDeg={roofPitchDeg} />
      <Ground />
      <OrbitControls
        enablePan={false}
        minDistance={3}
        maxDistance={120}
        target={[0, wallHeightM * 0.4, 0] as [number, number, number]}
      />
    </>
  )
}

// ─── Main viewer ─────────────────────────────────────────────────────────────

export interface Solar3DViewerProps {
  buildingPolygonLocalM: [number, number][]
  wallHeightM?: number
  ridgeHeightM?: number
  roofPitchDeg: number
  panelPositions: PanelPosition[]
  panelSpec: PanelSpec
  roofAspect?: RoofAspect
  onCapture?: (dataUrl: string) => void
}

export function Solar3DViewer(props: Solar3DViewerProps) {
  const captureRef = useRef<(() => string) | null>(null)
  const wallH = props.wallHeightM ?? 5.5

  const xs = props.buildingPolygonLocalM.map(([x]) => x)
  const zs = props.buildingPolygonLocalM.map(([, z]) => z)
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...zs) - Math.min(...zs),
    10,
  )
  const camDist = span * 1.8
  const camHeight = span * 0.9

  const handleCapture = () => {
    if (captureRef.current) props.onCapture?.(captureRef.current())
  }

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-sky-100" style={{ height: 360 }}>
      <Suspense
        fallback={
          <div className="w-full h-full flex items-center justify-center">
            <Skeleton className="w-full h-full" />
          </div>
        }
      >
        <Canvas
          shadows
          // Camera slightly east of south so the south-facing slope is prominently visible
          camera={{ position: [camDist * 0.25, camHeight, camDist], fov: 45 }}
          gl={{ preserveDrawingBuffer: true }}
        >
          <Scene
            buildingPolygonLocalM={props.buildingPolygonLocalM}
            wallHeightM={wallH}
            ridgeHeightM={props.ridgeHeightM}
            roofPitchDeg={props.roofPitchDeg}
            panelPositions={props.panelPositions}
            panelSpec={props.panelSpec}
            roofAspect={props.roofAspect}
            onCaptureRef={captureRef}
          />
        </Canvas>
      </Suspense>

      {/* Compass + legend overlay */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 text-xs bg-white/80 rounded-lg px-2.5 py-1.5 shadow-sm border border-white/60">
        <svg width="28" height="28" viewBox="-14 -14 28 28">
          <line x1="0" y1="-10" x2="0" y2="10" stroke="#94a3b8" strokeWidth="1" />
          <line x1="-10" y1="0" x2="10" y2="0" stroke="#94a3b8" strokeWidth="1" />
          <polygon points="0,-10 2.5,-4 -2.5,-4" fill="#1e3a5f" />
          <text y="-12" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#1e3a5f" fontFamily="system-ui">N</text>
          <text y="16" textAnchor="middle" fontSize="5.5" fill="#64748b" fontFamily="system-ui">S</text>
          <text x="-14" y="2" textAnchor="middle" fontSize="5.5" fill="#64748b" fontFamily="system-ui">W</text>
          <text x="14" y="2" textAnchor="middle" fontSize="5.5" fill="#64748b" fontFamily="system-ui">E</text>
        </svg>
        <div className="space-y-0.5">
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#F59E0B' }} />
            <span className="text-slate-600">South-facing</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#94A3B8' }} />
            <span className="text-slate-600">North-facing</span>
          </div>
        </div>
      </div>

      {props.onCapture && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 right-3 gap-1.5 shadow"
          onClick={handleCapture}
        >
          <Camera className="h-4 w-4" />
          Capture View
        </Button>
      )}

      <div className="absolute top-3 left-3 text-xs text-white/80 bg-black/25 rounded px-2 py-0.5">
        Drag to rotate · Scroll to zoom
      </div>
    </div>
  )
}
