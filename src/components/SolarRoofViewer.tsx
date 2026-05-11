'use client'

import React, { useRef, useState, useEffect, Suspense, useCallback, useMemo } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Camera, AlertTriangle } from 'lucide-react'
import { wgs84ToLocalMetres } from '@/lib/geometry'
import { TilesRenderer, WGS84_ELLIPSOID } from '3d-tiles-renderer'
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins'
import type {
  GoogleSolarBuildingInsights,
  GoogleSolarDataLayers,
  GoogleSolarRoofSegment,
  OsBuilding,
} from '@/lib/types'
import { SolarModelViewer } from '@/components/solar/SolarModelViewer'
import { HouseBaseExtruded } from '@/components/solar/HouseBase'
import { RoofFromFootprintMesh } from '@/components/solar/RoofFromFootprintMesh'
import { buildSolar3DModel, DEFAULT_WALL_HEIGHT_M } from '@/lib/solar/solarApiMapper'
import { computePanelLayouts, computePanelLayoutsForHouseModel } from '@/lib/solar/panelPlacementService'
import { clipRoofPlanesToFootprint, matchAndEnrich, clipRoofPlanes } from '@/lib/solar/solarApiMatcher'
import { buildRoofFromFootprint } from '@/lib/solar/roofMeshBuilder'
import { buildPanelAnchoredRoof } from '@/lib/solar/panelAnchoredRoofBuilder'
import type { PanelLayout, HouseModel, EnrichedRoofPlane, Solar3DModel, LocalRoofSegment } from '@/types/solar'
import { processLidar } from '@/lib/solar/lidarProcessor'
import { segmentRoofPlanes } from '@/lib/solar/roofSegmentation'

// ─── Geometry helpers ─────────────────────────────────────────────────────────

interface SegmentGeo {
  corners: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
  center: [number, number, number]
  eaveHeight: number
  ridgeHeight: number
  ridgeLength: number
  groundDepth: number
  segment: GoogleSolarRoofSegment
}

function computeSegmentGeo(
  seg: GoogleSolarRoofSegment,
  buildingCenter: { latitude: number; longitude: number },
): SegmentGeo {
  const [[cx, cz]] = wgs84ToLocalMetres(
    [[seg.center.longitude, seg.center.latitude]],
    [buildingCenter.longitude, buildingCenter.latitude],
  )
  const cy = seg.planeHeightAtCenterMeters

  const azRad = (seg.azimuthDegrees * Math.PI) / 180
  const pitchRad = (seg.pitchDegrees * Math.PI) / 180

  // Facing direction in XZ (downhill direction of the slope)
  const dx = Math.sin(azRad)
  const dz = -Math.cos(azRad)  // +z = south in Three.js

  // Ridge direction (perpendicular to facing in XZ)
  const rx = Math.cos(azRad)
  const rz = Math.sin(azRad)

  const groundArea = Math.max(seg.stats.groundAreaMeters2, 4)
  // 2:1 aspect ratio: ridgeLength = 2 × groundDepth
  const groundDepth = Math.sqrt(groundArea / 2)
  const ridgeLength = Math.sqrt(groundArea * 2)
  const halfRise = (groundDepth / 2) * Math.tan(pitchRad)

  const eaveHeight = cy - halfRise
  const ridgeHeight = cy + halfRise

  const ex = cx + dx * groundDepth / 2
  const ez = cz + dz * groundDepth / 2
  const rx2 = cx - dx * groundDepth / 2
  const rz2 = cz - dz * groundDepth / 2
  const hl = ridgeLength / 2

  return {
    corners: [
      [ex  - rx * hl, eaveHeight,  ez  - rz * hl],
      [ex  + rx * hl, eaveHeight,  ez  + rz * hl],
      [rx2 + rx * hl, ridgeHeight, rz2 + rz * hl],
      [rx2 - rx * hl, ridgeHeight, rz2 - rz * hl],
    ],
    center: [cx, cy, cz],
    eaveHeight,
    ridgeHeight,
    ridgeLength,
    groundDepth,
    segment: seg,
  }
}

function makeQuadGeo(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): THREE.BufferGeometry {
  const verts = new Float32Array([...a, ...b, ...c, ...a, ...c, ...d])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  return geo
}

function makeEdgesFromQuad(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): THREE.BufferGeometry {
  const verts = new Float32Array([
    ...a, ...b,
    ...b, ...c,
    ...c, ...d,
    ...d, ...a,
    ...a, ...c,  // diagonal ridge line
  ])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  return geo
}

function azimuthLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45)]
}

function sunshineP50(seg: GoogleSolarRoofSegment): number {
  const q = seg.stats.sunshineQuantiles
  if (!q?.length) return 0
  return q[Math.floor(q.length / 2)]
}

function heatmapColor(value: number, min: number, max: number): string {
  const t = max > min ? (value - min) / (max - min) : 0
  const lo = new THREE.Color('#64748B')  // slate — low sun
  const hi = new THREE.Color('#F59E0B')  // amber — high sun
  const c = lo.clone().lerp(hi, t)
  return `#${c.getHexString()}`
}

function azimuthToMcsOrientation(az: number): number {
  return Math.abs(az - 180)
}

// ─── LiDAR → LocalRoofSegment adapter ────────────────────────────────────────

function lidarPlanesToLocalSegments(planes: EnrichedRoofPlane[]): LocalRoofSegment[] {
  return planes.map((plane, i) => {
    const ring: [number, number][] = plane.polygon.length > 1 &&
      plane.polygon[0][0] === plane.polygon[plane.polygon.length - 1][0] &&
      plane.polygon[0][1] === plane.polygon[plane.polygon.length - 1][1]
      ? plane.polygon.slice(0, -1) as [number, number][]
      : plane.polygon as [number, number][]

    const cx = plane.refX
    const cz = plane.refZ

    const azRad = (plane.azimuthDegrees * Math.PI) / 180
    const ridgeX = Math.cos(azRad), ridgeZ = Math.sin(azRad)
    const faceX  = Math.sin(azRad), faceZ  = -Math.cos(azRad)

    let minR = Infinity, maxR = -Infinity
    let minF = Infinity, maxF = -Infinity
    for (const [x, z] of ring) {
      const r = (x - cx) * ridgeX + (z - cz) * ridgeZ
      const f = (x - cx) * faceX  + (z - cz) * faceZ
      if (r < minR) minR = r; if (r > maxR) maxR = r
      if (f < minF) minF = f; if (f > maxF) maxF = f
    }

    return {
      segmentIndex:     plane.solarSegmentIndex ?? i,
      azimuthDeg:       plane.azimuthDegrees,
      pitchDeg:         plane.pitchDegrees,
      heightAtCenterM:  plane.heightM,
      center:           { x: cx, z: cz },
      ridgeLenM:        Math.max(maxR - minR, 1),
      groundDepthM:     Math.max(maxF - minF, 1),
      areaM2:           plane.areaM2,
      sunshineQuantiles: plane.sunshineQuantiles ?? [],
    }
  })
}

// ─── DSM elevation data ───────────────────────────────────────────────────────

interface DsmData {
  values: Float32Array
  width: number
  height: number
  bbox: [number, number, number, number]  // [minLng, minLat, maxLng, maxLat]
  minElev: number
  maxElev: number
}

function useDsm(dsmId: string | undefined): { dsm: DsmData | null; loading: boolean } {
  const [state, setState] = useState<{ dsm: DsmData | null; loading: boolean }>({ dsm: null, loading: false })

  useEffect(() => {
    if (!dsmId) return
    setState({ dsm: null, loading: true })
    ;(async () => {
      try {
        const res = await fetch(`/api/solar/geotiff?id=${encodeURIComponent(dsmId)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buffer = await res.arrayBuffer()
        const { fromArrayBuffer } = await import('geotiff')
        const tiff = await fromArrayBuffer(buffer)
        const image = await tiff.getImage()
        const width = image.getWidth()
        const height = image.getHeight()
        const bbox = image.getBoundingBox() as [number, number, number, number]
        const rasters = await image.readRasters({ interleave: false }) as unknown as [Float32Array]
        const values = rasters[0]
        let minElev = Infinity, maxElev = -Infinity
        for (let i = 0; i < values.length; i++) {
          const v = values[i]
          if (v > 0) { if (v < minElev) minElev = v; if (v > maxElev) maxElev = v }
        }
        setState({ dsm: { values, width, height, bbox, minElev, maxElev }, loading: false })
      } catch (e) {
        console.error('DSM decode error', e)
        setState({ dsm: null, loading: false })
      }
    })()
  }, [dsmId])

  return state
}

// ─── LiDAR hook ───────────────────────────────────────────────────────────────

interface LidarResult {
  planes: EnrichedRoofPlane[]
  loading: boolean
  source: 'lidar+os+solar' | 'lidar+solar' | null
  reason?: 'no_coverage' | 'no_planes' | 'error'
}

function useLidar(
  lat: number,
  lng: number,
  solar3DModel: Solar3DModel,
  osBuilding: OsBuilding | null,
): LidarResult {
  const [state, setState] = useState<LidarResult>({ planes: [], loading: false, source: null })

  useEffect(() => {
    setState(s => ({ ...s, loading: true }))
    ;(async () => {
      try {
        const res = await fetch('/api/lidar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lng }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!data.available) { setState({ planes: [], loading: false, source: null, reason: 'no_coverage' }); return }

        const footprint = osBuilding?.footprintPolygon ?? null
        const grid = processLidar(data.dsmValues, data.dtmValues, data.width, data.height, data.bboxBng, data.cellSizeM, footprint)
        const rawPlanes = segmentRoofPlanes(grid, [lng, lat])

        if (rawPlanes.length < 1) { setState({ planes: [], loading: false, source: null, reason: 'no_planes' }); return }

        const enriched = matchAndEnrich(rawPlanes, solar3DModel.segments)

        const source: LidarResult['source'] = footprint ? 'lidar+os+solar' : 'lidar+solar'
        setState({ planes: enriched, loading: false, source, reason: undefined })
      } catch (e) {
        console.error('useLidar:', e)
        setState({ planes: [], loading: false, source: null, reason: 'error' })
      }
    })()
  }, [lat, lng, solar3DModel, osBuilding])

  return state
}

// ─── 3D roof segment ──────────────────────────────────────────────────────────

function RoofSegmentMesh({
  geo: g,
  color,
  showLabel,
}: {
  geo: SegmentGeo
  color: string
  showLabel: boolean
}) {
  const mesh = makeQuadGeo(...g.corners)
  const edges = makeEdgesFromQuad(...g.corners)

  return (
    <group>
      <mesh geometry={mesh} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#1e293b" linewidth={1} opacity={0.5} transparent />
      </lineSegments>
      {showLabel && (
        <Html
          position={g.center}
          center
          distanceFactor={12}
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-white/90 border border-slate-200 rounded px-1.5 py-1 text-[10px] leading-tight shadow-md whitespace-nowrap">
            <div className="font-semibold text-slate-800">{azimuthLabel(g.segment.azimuthDegrees)} · {Math.round(g.segment.pitchDegrees)}°</div>
            <div className="text-slate-500">{Math.round(g.segment.stats.areaMeters2)} m²</div>
            <div className="text-amber-600">{Math.round(sunshineP50(g.segment)).toLocaleString()} hrs/yr</div>
          </div>
        </Html>
      )}
    </group>
  )
}

// ─── Building walls ───────────────────────────────────────────────────────────

function BuildingWalls({
  insights,
  minEaveHeight,
}: {
  insights: GoogleSolarBuildingInsights
  minEaveHeight: number
}) {
  const center = insights.center
  const [[swX, swZ]] = wgs84ToLocalMetres(
    [[insights.boundingBox.sw.longitude, insights.boundingBox.sw.latitude]],
    [center.longitude, center.latitude],
  )
  const [[neX, neZ]] = wgs84ToLocalMetres(
    [[insights.boundingBox.ne.longitude, insights.boundingBox.ne.latitude]],
    [center.longitude, center.latitude],
  )

  const wallW = Math.abs(neX - swX)
  const wallD = Math.abs(swZ - neZ)
  const wallH = Math.max(minEaveHeight, 2.5)
  const cx = (swX + neX) / 2
  const cz = (swZ + neZ) / 2

  return (
    <mesh position={[cx, wallH / 2, cz]} castShadow receiveShadow>
      <boxGeometry args={[wallW, wallH, wallD]} />
      <meshStandardMaterial color="#E8E4DC" roughness={0.8} />
    </mesh>
  )
}

// ─── Solar panels ─────────────────────────────────────────────────────────────

function PanelGrid({
  geos,
  panelW,
  panelH,
  configSummaries,
}: {
  geos: SegmentGeo[]
  panelW: number
  panelH: number
  configSummaries: Array<{ segmentIndex: number; panelsCount: number }>
}) {
  const GAP = 0.02
  const MARGIN = 0.3
  const panels: React.ReactElement[] = []

  for (const summary of configSummaries) {
    const geo = geos[summary.segmentIndex]
    if (!geo) continue

    const ridgeDir: [number, number] = [
      Math.cos((geo.segment.azimuthDegrees * Math.PI) / 180),
      Math.sin((geo.segment.azimuthDegrees * Math.PI) / 180),
    ]
    const faceDir: [number, number] = [
      Math.sin((geo.segment.azimuthDegrees * Math.PI) / 180),
      -Math.cos((geo.segment.azimuthDegrees * Math.PI) / 180),
    ]
    const pitchRad = (geo.segment.pitchDegrees * Math.PI) / 180

    const usableRidge = Math.max(0, geo.ridgeLength - 2 * MARGIN)
    const usableSlope = Math.max(0, (geo.groundDepth / Math.cos(pitchRad)) - 2 * MARGIN)

    const cols = Math.max(0, Math.floor((usableRidge + GAP) / (panelW + GAP)))
    const rows = Math.max(0, Math.floor((usableSlope + GAP) / (panelH + GAP)))

    const startRidge = -(cols * (panelW + GAP) - GAP) / 2 + panelW / 2

    for (let row = 0; row < rows && panels.length < summary.panelsCount; row++) {
      for (let col = 0; col < cols && panels.length < summary.panelsCount; col++) {
        const along = startRidge + col * (panelW + GAP)
        const slopeD = MARGIN + row * (panelH + GAP) + panelH / 2
        const groundD = slopeD * Math.cos(pitchRad)
        const riseD   = slopeD * Math.sin(pitchRad)

        // Position from eave edge
        const baseX = geo.corners[0][0] + geo.corners[1][0]
        const baseZ = geo.corners[0][2] + geo.corners[1][2]
        const px = (baseX / 2)
          + along * ridgeDir[0]
          - faceDir[0] * groundD
        const py = geo.eaveHeight + riseD + 0.05
        const pz = (baseZ / 2)
          + along * ridgeDir[1]
          - faceDir[1] * groundD

        panels.push(
          <mesh key={`${summary.segmentIndex}-${row}-${col}`} position={[px, py, pz]} castShadow>
            <boxGeometry args={[panelW, 0.03, panelH]} />
            <meshStandardMaterial color="#1a1a3e" roughness={0.4} metalness={0.2} />
          </mesh>,
        )
      }
    }
  }

  return <group>{panels}</group>
}

// ─── Ground plane ─────────────────────────────────────────────────────────────

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#6B8F4E" roughness={1} />
    </mesh>
  )
}

// ─── Google Photorealistic 3D Tiles ──────────────────────────────────────────

const TILES_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json'
const DEG2RAD = Math.PI / 180

function GoogleTilesScene({
  lat,
  lng,
  groundAlt,
  apiKey,
  onUnavailable,
}: {
  lat: number
  lng: number
  groundAlt: number
  apiKey: string
  onUnavailable?: () => void
}) {
  const { camera, gl, scene } = useThree()
  const tilesRef = useRef<TilesRenderer | null>(null)

  useEffect(() => {
    const tiles = new TilesRenderer(TILES_ROOT)
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, useRecommendedSettings: true }))
    tiles.errorTarget = 8

    const frame = new THREE.Matrix4()
    WGS84_ELLIPSOID.getOrientedEastNorthUpFrame(
      lat * DEG2RAD,
      lng * DEG2RAD,
      groundAlt,
      0, 0, 0,
      frame,
    )
    tiles.group.matrix.copy(frame).invert()
    tiles.group.matrixAutoUpdate = false
    tiles.group.matrixWorldNeedsUpdate = true

    let failedFetches = 0
    tiles.addEventListener('tile-load-error', () => {
      failedFetches += 1
      if (failedFetches >= 3) onUnavailable?.()
    })

    scene.add(tiles.group)
    tilesRef.current = tiles

    return () => {
      scene.remove(tiles.group)
      tiles.dispose()
      tilesRef.current = null
    }
  }, [lat, lng, groundAlt, apiKey, scene, onUnavailable])

  useFrame(() => {
    const tiles = tilesRef.current
    if (!tiles) return
    tiles.setCamera(camera)
    tiles.setResolutionFromRenderer(camera, gl)
    tiles.update()
  })

  return null
}

// ─── DSM terrain mesh ────────────────────────────────────────────────────────

function DsmMesh({
  dsm,
  buildingCenter,
}: {
  dsm: DsmData
  buildingCenter: { latitude: number; longitude: number }
}) {
  const geo = useMemo(() => {
    const { values, width, height, bbox, minElev, maxElev } = dsm
    const [minLng, , maxLng, maxLat] = bbox
    const metersPerLat = 111320
    const metersPerLng = 111320 * Math.cos((buildingCenter.latitude * Math.PI) / 180)
    const stride = Math.max(1, Math.ceil(Math.max(width, height) / 150))
    const cols = Math.ceil(width / stride)
    const rows = Math.ceil(height / stride)

    const positions = new Float32Array(rows * cols * 3)
    const colors = new Float32Array(rows * cols * 3)
    const indices: number[] = []
    const lo = new THREE.Color('#94A3B8')  // ground — slate
    const hi = new THREE.Color('#D97706')  // roof — amber

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sr = Math.min(r * stride, height - 1)
        const sc = Math.min(c * stride, width - 1)
        const elev = values[sr * width + sc]
        const lng = minLng + (sc / Math.max(width - 1, 1)) * (maxLng - minLng)
        const lat = maxLat - (sr / Math.max(height - 1, 1)) * (bbox[3] - bbox[1])
        const x = (lng - buildingCenter.longitude) * metersPerLng
        const z = -(lat - buildingCenter.latitude) * metersPerLat
        const y = elev > 0 && maxElev > minElev ? elev - minElev : 0
        const vi = (r * cols + c) * 3
        positions[vi] = x; positions[vi + 1] = y; positions[vi + 2] = z
        const t = maxElev > minElev ? Math.min(1, y / (maxElev - minElev)) : 0
        const col = lo.clone().lerp(hi, t)
        colors[vi] = col.r; colors[vi + 1] = col.g; colors[vi + 2] = col.b
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c
        const b = r * cols + c + 1
        const d = (r + 1) * cols + c
        const e = (r + 1) * cols + c + 1
        indices.push(a, d, b, b, d, e)
      }
    }

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.setIndex(indices)
    g.computeVertexNormals()
    return g
  }, [dsm, buildingCenter])

  return (
    <mesh geometry={geo} receiveShadow castShadow>
      <meshStandardMaterial vertexColors roughness={0.85} />
    </mesh>
  )
}

// ─── Roof segment label (label-only, no mesh) ────────────────────────────────

function SegmentLabel({ geo: g }: { geo: SegmentGeo }) {
  return (
    <Html position={g.center} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
      <div className="bg-white/90 border border-slate-200 rounded px-1.5 py-1 text-[10px] leading-tight shadow-md whitespace-nowrap">
        <div className="font-semibold text-slate-800">{azimuthLabel(g.segment.azimuthDegrees)} · {Math.round(g.segment.pitchDegrees)}°</div>
        <div className="text-slate-500">{Math.round(g.segment.stats.areaMeters2)} m²</div>
        <div className="text-amber-600">{Math.round(sunshineP50(g.segment)).toLocaleString()} hrs/yr</div>
      </div>
    </Html>
  )
}

// ─── Scene ────────────────────────────────────────────────────────────────────

type ViewSource = 'lidar' | 'solar' | 'os_ngd'

interface SceneProps {
  insights: GoogleSolarBuildingInsights
  mode: 'model' | 'heatmap' | 'panels'
  captureRef: React.MutableRefObject<(() => string) | null>
  showLabels: boolean
  dsm: DsmData | null
  lat: number
  lng: number
  mapsKey: string | undefined
  osBuilding: OsBuilding | null
  solar3DModel: Solar3DModel
  lidarPlanes: EnrichedRoofPlane[]
  lidarSource: 'lidar+os+solar' | 'lidar+solar' | null
  viewSource: ViewSource
  pitchDeg: number
}

function Scene({ insights, mode, captureRef, showLabels, dsm, lat, lng, mapsKey, osBuilding, solar3DModel, lidarPlanes, lidarSource, viewSource, pitchDeg }: SceneProps) {
  const { gl, scene, camera } = useThree()

  useEffect(() => {
    captureRef.current = () => {
      gl.render(scene, camera)
      return gl.domElement.toDataURL('image/png')
    }
  })

  const sp = insights.solarPotential
  const segs = sp.roofSegmentStats ?? []
  const geos = segs.map(s => computeSegmentGeo(s, insights.center))
  const minEave = geos.length
    ? Math.min(...geos.map(g => g.eaveHeight))
    : 3

  const sunshineValues = segs.map(s => sunshineP50(s))
  const sunMin = Math.min(...sunshineValues)
  const sunMax = Math.max(...sunshineValues)

  // Select last config for panels view (max recommended)
  const configs = sp.solarPanelConfigs ?? []
  const panelConfig = configs[configs.length - 1]

  // Shared geometry inputs
  const wallH = osBuilding?.eaveHeightM ?? DEFAULT_WALL_HEIGHT_M
  const footprintLocal = useMemo<[number, number][]>(() =>
    osBuilding
      ? wgs84ToLocalMetres(osBuilding.footprintPolygon, [insights.center.longitude, insights.center.latitude])
      : [],
    [osBuilding, insights.center.longitude, insights.center.latitude],
  )

  // Dominant pitch from Google Solar: largest-area segment wins
  const solarPitchDeg = solar3DModel.segments.length > 0
    ? solar3DModel.segments.reduce((best, s) => s.areaM2 > best.areaM2 ? s : best).pitchDeg
    : pitchDeg

  const lidarHouseModel = useMemo<HouseModel | null>(() => {
    if (lidarPlanes.length < 1 || footprintLocal.length < 3) return null

    // Height anchoring: find lowest eave vertex across all OBR polygons.
    // getY(v) = heightM - faceProj * tan(pitch); eave = vertex with max faceProj.
    const eaveHeights = lidarPlanes.map(p => {
      const azRad = (p.azimuthDegrees * Math.PI) / 180
      const faceX = Math.sin(azRad), faceZ = -Math.cos(azRad)
      const pitchRad = (p.pitchDegrees * Math.PI) / 180
      const ring: [number, number][] = (
        p.polygon.length > 1 &&
        p.polygon[0][0] === p.polygon[p.polygon.length - 1][0] &&
        p.polygon[0][1] === p.polygon[p.polygon.length - 1][1]
      ) ? p.polygon.slice(0, -1) as [number, number][]
        : p.polygon as [number, number][]
      const maxFaceProj = Math.max(...ring.map(([vx, vz]) =>
        (vx - p.refX) * faceX + (vz - p.refZ) * faceZ
      ))
      return p.heightM - maxFaceProj * Math.tan(pitchRad)
    })
    const minEave = Math.min(...eaveHeights)
    const hOff = Number.isFinite(minEave) ? wallH - minEave : 0
    const anchored = hOff !== 0
      ? lidarPlanes.map(p => ({ ...p, heightM: p.heightM + hOff }))
      : lidarPlanes

    // Clip inter-plane ridge overlaps, then clip to building footprint
    const ridgeClipped = clipRoofPlanes(anchored)
    const roofPlanes = clipRoofPlanesToFootprint(ridgeClipped, footprintLocal)
    if (roofPlanes.length === 0) return null
    return { footprintLocal, wallHeightM: wallH, roofPlanes, source: lidarSource ?? 'lidar+solar' }
  }, [lidarPlanes, lidarSource, footprintLocal, wallH])

  // Tier 1: panel-anchored OBRs (true roof geometry from detected panel positions),
  // with bbox/Voronoi fallbacks per segment inside the builder. Tier 2: pure Voronoi.
  // Aligns the OS footprint to the Google Solar building centroid so the walls
  // sit directly under the satellite-detected roof (the two data sources can be
  // off by a few metres for the same building due to mapping registration).
  const solarHouseModel = useMemo<HouseModel | null>(() => {
    if (!osBuilding || solar3DModel.segments.length === 0 || footprintLocal.length < 3) return null

    // Google Solar building centroid = mean of segment centres in local metres.
    const segs = solar3DModel.segments
    const segCx = segs.reduce((s, g) => s + g.center.x, 0) / segs.length
    const segCz = segs.reduce((s, g) => s + g.center.z, 0) / segs.length

    // OS footprint centroid (drop the closing duplicate vertex if present).
    const ring: [number, number][] = (
      footprintLocal.length > 1 &&
      footprintLocal[0][0] === footprintLocal[footprintLocal.length - 1][0] &&
      footprintLocal[0][1] === footprintLocal[footprintLocal.length - 1][1]
    ) ? footprintLocal.slice(0, -1) as [number, number][]
      : footprintLocal
    const fpCx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const fpCz = ring.reduce((s, p) => s + p[1], 0) / ring.length

    const dx = segCx - fpCx
    const dz = segCz - fpCz
    const alignedFootprint: [number, number][] = (Math.hypot(dx, dz) > 0.5)
      ? footprintLocal.map(([x, z]) => [x + dx, z + dz] as [number, number])
      : footprintLocal

    let roofPlanes = buildPanelAnchoredRoof(insights, alignedFootprint, wallH)
    if (roofPlanes.length === 0) {
      roofPlanes = buildRoofFromFootprint(solar3DModel.segments, alignedFootprint, wallH)
    }
    if (roofPlanes.length === 0) return null
    return { footprintLocal: alignedFootprint, wallHeightM: wallH, roofPlanes, source: 'os+solar' }
  }, [insights, osBuilding, solar3DModel, footprintLocal, wallH])

  const activeHouseModel = viewSource === 'lidar' ? lidarHouseModel : null

  const panelLayouts: PanelLayout[] = useMemo(() => {
    if (mode !== 'panels' || viewSource === 'os_ngd') return []
    if (viewSource === 'lidar' && activeHouseModel) {
      const totalCount = panelConfig?.roofSegmentSummaries.reduce((s, r) => s + r.panelsCount, 0) ?? 0
      return totalCount > 0
        ? computePanelLayoutsForHouseModel(activeHouseModel, totalCount, sp.panelWidthMeters, sp.panelHeightMeters)
        : []
    }
    if (viewSource === 'solar' && solarHouseModel) {
      const totalCount = panelConfig?.roofSegmentSummaries.reduce((s, r) => s + r.panelsCount, 0) ?? 0
      return totalCount > 0
        ? computePanelLayoutsForHouseModel(solarHouseModel, totalCount, sp.panelWidthMeters, sp.panelHeightMeters)
        : []
    }
    if (!panelConfig) return []
    return computePanelLayouts(solar3DModel, panelConfig, sp.panelWidthMeters, sp.panelHeightMeters)
  }, [activeHouseModel, solarHouseModel, solar3DModel, panelConfig, mode, viewSource, sp.panelWidthMeters, sp.panelHeightMeters])

  // Primary 3D source = Google Photorealistic 3D Tiles. We only fall back to the
  // Google Solar DSM heightmap when the tiles API key is missing or DSM is the
  // only thing available for the address.
  const [tilesAvailable, setTilesAvailable] = useState(true)
  const useGoogleTiles = !!mapsKey && tilesAvailable
  const useDsmMesh = (!useGoogleTiles && !!dsm) || (!tilesAvailable && !!dsm)

  const GEOID_UK = 47  // UK geoid offset (EGM2008 → WGS84 ellipsoid)
  // Anchor on Google Solar's reported eave heights when DSM isn't loaded
  // yet, so the tiles ground plane and segment overlays sit in the same
  // frame from the first mount.
  const minSegEave = geos.length ? Math.min(...geos.map(g => g.eaveHeight)) : 0
  const groundAlt = (dsm?.minElev ?? Math.max(0, minSegEave - 3)) + GEOID_UK

  void sunMin; void sunMax; void minEave

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[8, 20, 12]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[-5, 10, -8]} intensity={0.3} />

      {!useGoogleTiles && <Ground />}

      {useGoogleTiles ? (
        <>
          <GoogleTilesScene
            lat={lat}
            lng={lng}
            groundAlt={groundAlt}
            apiKey={mapsKey!}
            onUnavailable={() => setTilesAvailable(false)}
          />
          {showLabels && geos.map((g, i) => <SegmentLabel key={i} geo={g} />)}
          {mode === 'panels' && panelConfig && (
            <PanelGrid
              geos={geos}
              panelW={sp.panelWidthMeters}
              panelH={sp.panelHeightMeters}
              configSummaries={panelConfig.roofSegmentSummaries}
            />
          )}
        </>
      ) : useDsmMesh ? (
        <>
          <DsmMesh dsm={dsm!} buildingCenter={insights.center} />
          {showLabels && geos.map((g, i) => <SegmentLabel key={i} geo={g} />)}
        </>
      ) : viewSource === 'os_ngd' && osBuilding && footprintLocal.length >= 3 ? (
        <>
          <HouseBaseExtruded footprintLocal={footprintLocal} wallHeightM={wallH} />
          <RoofFromFootprintMesh
            footprintLocal={footprintLocal}
            wallHeightM={wallH}
            ridgeHeightM={osBuilding.ridgeHeightM}
            pitchDeg={pitchDeg}
          />
        </>
      ) : viewSource === 'solar' ? (
        solarHouseModel ? (
          <SolarModelViewer
            houseModel={solarHouseModel}
            mode={mode}
            panelLayouts={panelLayouts}
            panelWidthM={sp.panelWidthMeters}
            panelHeightM={sp.panelHeightMeters}
            showLabels={showLabels}
          />
        ) : (
          <SolarModelViewer
            model={solar3DModel}
            footprintLocal={footprintLocal.length >= 3 ? footprintLocal : undefined}
            wallHeightM={wallH}
            mode={mode}
            panelLayouts={panelLayouts}
            panelWidthM={sp.panelWidthMeters}
            panelHeightM={sp.panelHeightMeters}
            showLabels={showLabels}
          />
        )
      ) : activeHouseModel ? (
        <SolarModelViewer
          houseModel={activeHouseModel}
          mode={mode}
          panelLayouts={panelLayouts}
          panelWidthM={sp.panelWidthMeters}
          panelHeightM={sp.panelHeightMeters}
          showLabels={showLabels}
        />
      ) : (
        <SolarModelViewer
          model={solar3DModel}
          footprintLocal={footprintLocal.length >= 3 ? footprintLocal : undefined}
          wallHeightM={wallH}
          mode={mode}
          panelLayouts={panelLayouts}
          panelWidthM={sp.panelWidthMeters}
          panelHeightM={sp.panelHeightMeters}
          showLabels={showLabels}
        />
      )}

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        enablePan={useGoogleTiles}
        minDistance={4}
        maxDistance={useGoogleTiles ? 500 : 150}
        target={[0, DEFAULT_WALL_HEIGHT_M * 0.5, 0]}
      />
    </>
  )
}

// ─── Satellite view ───────────────────────────────────────────────────────────

function SatelliteView({
  insights,
  mapsKey,
}: {
  insights: GoogleSolarBuildingInsights
  mapsKey: string | undefined
}) {
  const lat = insights.center.latitude
  const lng = insights.center.longitude
  const SIZE = 640
  const ZOOM = 20

  // Mercator projection helper
  function latLngToPixel(pLat: number, pLng: number): [number, number] {
    const scale = 256 * Math.pow(2, ZOOM)
    const toMercX = (ln: number) => ((ln + 180) / 360) * scale
    const toMercY = (la: number) => {
      const sinLat = Math.sin((la * Math.PI) / 180)
      return ((0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI))) * scale
    }
    const cx = toMercX(lng)
    const cy = toMercY(lat)
    const px = (toMercX(pLng) - cx) + SIZE / 2
    const py = (toMercY(pLat) - cy) + SIZE / 2
    return [px, py]
  }

  if (!mapsKey) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-100 rounded-xl">
        <div className="text-center text-sm text-muted-foreground space-y-1 px-4">
          <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" />
          <p className="font-medium">Satellite view unavailable</p>
          <p>Set <code className="text-xs bg-slate-200 px-1 rounded">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to enable.</p>
        </div>
      </div>
    )
  }

  const imgSrc = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${ZOOM}&size=${SIZE}x${SIZE}&maptype=satellite&key=${mapsKey}`

  return (
    <div className="relative w-full h-full overflow-hidden rounded-xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgSrc}
        alt="Satellite view"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ imageRendering: 'pixelated' }}
      />
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {(insights.solarPotential.roofSegmentStats ?? []).map((seg, i) => {
          const [swX, swY] = latLngToPixel(seg.boundingBox.sw.latitude, seg.boundingBox.sw.longitude)
          const [neX, neY] = latLngToPixel(seg.boundingBox.ne.latitude, seg.boundingBox.ne.longitude)
          const x = Math.min(swX, neX)
          const y = Math.min(swY, neY)
          const w = Math.abs(neX - swX)
          const h = Math.abs(neY - swY)
          const mcsOri = azimuthToMcsOrientation(seg.azimuthDegrees)
          const stroke = mcsOri < 45 ? '#F59E0B' : mcsOri > 135 ? '#64748B' : '#C8AE8A'
          const [cx, cy] = latLngToPixel(seg.center.latitude, seg.center.longitude)
          return (
            <g key={i}>
              <rect
                x={x} y={y} width={w} height={h}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeDasharray="4 2"
                opacity="0.85"
              />
              <text
                x={cx} y={cy}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="11"
                fontFamily="system-ui"
                fontWeight="600"
                stroke="black"
                strokeWidth="0.4"
              >
                {azimuthLabel(seg.azimuthDegrees)} {Math.round(seg.pitchDegrees)}°
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── GeoTIFF view (DSM elevation colormap) ────────────────────────────────────

/** Viridis colormap: t ∈ [0,1] → [r,g,b] ∈ [0,255] */
function viridisColor(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [68,   1, 84],   // t=0   — dark purple
    [59,  82, 139],  // t=0.25 — blue
    [33, 145, 140],  // t=0.5  — teal
    [94, 201,  98],  // t=0.75 — green
    [253, 231,  37], // t=1    — yellow
  ]
  const scaled = Math.max(0, Math.min(0.9999, t)) * 4
  const i = Math.floor(scaled)
  const f = scaled - i
  const [r1, g1, b1] = stops[i]
  const [r2, g2, b2] = stops[i + 1]
  return [
    Math.round(r1 + (r2 - r1) * f),
    Math.round(g1 + (g2 - g1) * f),
    Math.round(b1 + (b2 - b1) * f),
  ]
}

function GeoTiffView({
  insights,
  dataLayers,
}: {
  insights: GoogleSolarBuildingInsights
  dataLayers: GoogleSolarDataLayers | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null)
  const [elevRange, setElevRange] = useState<{ min: number; max: number } | null>(null)

  const decodeGeoTiff = useCallback(async () => {
    const dsmId = dataLayers?.dsmId
    if (!dsmId) {
      setError('No elevation data available for this location.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/solar/geotiff?id=${encodeURIComponent(dsmId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const buffer = await res.arrayBuffer()
      const { fromArrayBuffer } = await import('geotiff')
      const tiff = await fromArrayBuffer(buffer)
      const image = await tiff.getImage()

      const width = image.getWidth()
      const height = image.getHeight()
      const tiffBbox = image.getBoundingBox() as [number, number, number, number]
      setBbox(tiffBbox)

      // DSM is a single-band float32 raster
      const rasters = await image.readRasters({ interleave: false }) as unknown as [Float32Array]
      const elevData = rasters[0]

      // Find valid elevation range (skip nodata ≤ 0)
      let minElev = Infinity, maxElev = -Infinity
      for (let i = 0; i < elevData.length; i++) {
        const v = elevData[i]
        if (v > 0) { if (v < minElev) minElev = v; if (v > maxElev) maxElev = v }
      }
      const elevSpan = maxElev - minElev
      setElevRange({ min: Math.round(minElev), max: Math.round(maxElev) })

      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      const imgData = ctx.createImageData(width, height)
      for (let i = 0; i < width * height; i++) {
        const v = elevData[i]
        if (v <= 0) {
          // nodata — semi-transparent black
          imgData.data[i * 4]     = 0
          imgData.data[i * 4 + 1] = 0
          imgData.data[i * 4 + 2] = 0
          imgData.data[i * 4 + 3] = 120
        } else {
          const t = elevSpan > 0 ? (v - minElev) / elevSpan : 0
          const [r, g, b] = viridisColor(t)
          imgData.data[i * 4]     = r
          imgData.data[i * 4 + 1] = g
          imgData.data[i * 4 + 2] = b
          imgData.data[i * 4 + 3] = 255
        }
      }
      ctx.putImageData(imgData, 0, 0)
    } catch (e) {
      console.error('GeoTIFF decode error', e)
      setError('Failed to load elevation data.')
    } finally {
      setLoading(false)
    }
  }, [dataLayers])

  useEffect(() => {
    decodeGeoTiff()
  }, [decodeGeoTiff])

  // Project lat/lng to canvas pixel coordinates using GeoTIFF bounding box
  function tiffLatLngToPixel(pLat: number, pLng: number): [number, number] | null {
    if (!bbox || !canvasRef.current) return null
    const [minLng, minLat, maxLng, maxLat] = bbox
    const cx = ((pLng - minLng) / (maxLng - minLng)) * canvasRef.current.width
    const cy = ((maxLat - pLat) / (maxLat - minLat)) * canvasRef.current.height
    return [cx, cy]
  }

  const canvasW = canvasRef.current?.width ?? 640
  const canvasH = canvasRef.current?.height ?? 640

  return (
    <div className="relative w-full h-full overflow-hidden rounded-xl bg-slate-900">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Skeleton className="w-full h-full" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="text-center text-sm space-y-1 px-4">
            <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" />
            <p className="text-white font-medium">{error}</p>
          </div>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain"
        style={{ display: loading || error ? 'none' : 'block', imageRendering: 'auto' }}
      />
      {bbox && !loading && !error && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox={`0 0 ${canvasW} ${canvasH}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {(insights.solarPotential.roofSegmentStats ?? []).map((seg, i) => {
            const sw = tiffLatLngToPixel(seg.boundingBox.sw.latitude, seg.boundingBox.sw.longitude)
            const ne = tiffLatLngToPixel(seg.boundingBox.ne.latitude, seg.boundingBox.ne.longitude)
            if (!sw || !ne) return null
            const x = Math.min(sw[0], ne[0])
            const y = Math.min(sw[1], ne[1])
            const w = Math.abs(ne[0] - sw[0])
            const h = Math.abs(ne[1] - sw[1])
            const center = tiffLatLngToPixel(seg.center.latitude, seg.center.longitude)
            const mcsOri = azimuthToMcsOrientation(seg.azimuthDegrees)
            const stroke = mcsOri < 45 ? '#F59E0B' : mcsOri > 135 ? '#60A5FA' : '#A78BFA'
            return (
              <g key={i}>
                <rect x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth="2" opacity="0.9" />
                {center && (
                  <text
                    x={center[0]} y={center[1]}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="white"
                    fontSize="12"
                    fontWeight="700"
                    stroke="black"
                    strokeWidth="0.5"
                    fontFamily="system-ui"
                  >
                    {azimuthLabel(seg.azimuthDegrees)} {Math.round(seg.pitchDegrees)}°
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {/* Elevation legend */}
      {elevRange && !loading && !error && (
        <div className="absolute bottom-3 left-3 bg-black/60 rounded-lg px-3 py-2 text-[10px] text-white">
          <div className="font-semibold mb-1">Elevation (m)</div>
          <div className="flex items-center gap-2">
            <span>{elevRange.min}</span>
            <div
              className="w-20 h-3 rounded"
              style={{ background: 'linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #fde725)' }}
            />
            <span>{elevRange.max}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Quality badge ────────────────────────────────────────────────────────────

function QualityBadge({ quality }: { quality: string | undefined }) {
  if (!quality) return null
  const variants: Record<string, string> = {
    HIGH: 'bg-green-100 text-green-800 border-green-200',
    MEDIUM: 'bg-amber-100 text-amber-800 border-amber-200',
    LOW: 'bg-red-100 text-red-800 border-red-200',
  }
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${variants[quality] ?? variants.MEDIUM}`}>
      {quality}
    </span>
  )
}

// ─── Compass rose ─────────────────────────────────────────────────────────────

function CompassRose() {
  return (
    <div className="absolute bottom-3 left-3 bg-white/80 rounded-lg px-2.5 py-2 shadow-sm border border-white/60 flex items-center gap-2">
      <svg width="32" height="32" viewBox="-16 -16 32 32">
        <line x1="0" y1="-11" x2="0" y2="11" stroke="#94a3b8" strokeWidth="1" />
        <line x1="-11" y1="0" x2="11" y2="0" stroke="#94a3b8" strokeWidth="1" />
        <polygon points="0,-11 3,-4 -3,-4" fill="#1e3a5f" />
        <text y="-13" textAnchor="middle" fontSize="6" fontWeight="700" fill="#1e3a5f" fontFamily="system-ui">N</text>
        <text y="18" textAnchor="middle" fontSize="6" fill="#64748b" fontFamily="system-ui">S</text>
        <text x="-16" y="2" textAnchor="middle" fontSize="6" fill="#64748b" fontFamily="system-ui">W</text>
        <text x="16" y="2" textAnchor="middle" fontSize="6" fill="#64748b" fontFamily="system-ui">E</text>
      </svg>
      <div className="text-[10px] space-y-0.5">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#D97706' }} />
          <span className="text-slate-600">South-facing</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#94A3B8' }} />
          <span className="text-slate-600">North-facing</span>
        </div>
      </div>
    </div>
  )
}

// ─── Heatmap legend ───────────────────────────────────────────────────────────

function HeatmapLegend({ min, max }: { min: number; max: number }) {
  return (
    <div className="absolute bottom-3 left-3 bg-white/85 rounded-lg px-3 py-2 shadow-sm border border-white/60 text-[10px]">
      <div className="font-semibold text-slate-700 mb-1">Sunshine hrs/yr</div>
      <div className="flex items-center gap-2">
        <span className="text-slate-500">{Math.round(min).toLocaleString()}</span>
        <div
          className="w-20 h-3 rounded"
          style={{ background: 'linear-gradient(to right, #64748B, #F59E0B)' }}
        />
        <span className="text-amber-700">{Math.round(max).toLocaleString()}</span>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface SolarRoofViewerProps {
  insights: GoogleSolarBuildingInsights
  dataLayers: GoogleSolarDataLayers | null
  lat: number
  lng: number
  osBuilding?: OsBuilding | null
  onCapture?: (dataUrl: string) => void
}

type ViewTab = '3d' | 'heatmap' | 'panels' | 'satellite' | 'geotiff'

export function SolarRoofViewer({ insights, dataLayers, lat, lng, osBuilding, onCapture }: SolarRoofViewerProps) {
  const [tab, setTab] = useState<ViewTab>('3d')
  const [viewSource, setViewSource] = useState<ViewSource>('solar')
  const [showLabels, setShowLabels] = useState(true)
  const captureRef = useRef<(() => string) | null>(null)
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  const { dsm } = useDsm(dataLayers?.dsmId)
  // Bug 2 fix: anchor roof heights to OS eave height rather than hardcoded 3.5m
  const wallH = osBuilding?.eaveHeightM ?? DEFAULT_WALL_HEIGHT_M
  const solar3DModel = useMemo(() => buildSolar3DModel(insights, wallH), [insights, wallH])
  // Bug 1 fix: use Google Solar building centre (matches footprintLocal origin), not address lat/lng
  const lidar = useLidar(insights.center.latitude, insights.center.longitude, solar3DModel, osBuilding ?? null)
  const osNgdPitchDeg = osBuilding?.roofPitchDeg ?? 30

  const segs = insights.solarPotential.roofSegmentStats ?? []
  const geos = segs.map(s => computeSegmentGeo(s, insights.center))
  const sunVals = segs.map(s => sunshineP50(s))
  const sunMin = sunVals.length ? Math.min(...sunVals) : 0
  const sunMax = sunVals.length ? Math.max(...sunVals) : 1000

  const allX = geos.flatMap(g => g.corners.map(c => c[0]))
  const allZ = geos.flatMap(g => g.corners.map(c => c[2]))
  // Building diagonal in metres; minimum 8 m so very small detached structures
  // still get a reasonable frame.
  const span = allX.length
    ? Math.max(
        Math.max(...allX) - Math.min(...allX),
        Math.max(...allZ) - Math.min(...allZ),
        8,
      )
    : 12

  // Photorealistic tiles look best from a 35° elevation with the building
  // filling ~60% of the viewport. Tighter than the legacy reconstruction
  // because the tiles include surrounding ground/neighbours we don't want to
  // dominate the frame.
  const camDist = span * (!!mapsKey ? 1.3 : 1.8)
  const camH = span * (!!mapsKey ? 0.7 : 0.9)

  const camPos: [number, number, number] = [camDist * 0.3, camH, camDist]

  const is3d = tab === '3d' || tab === 'heatmap' || tab === 'panels'

  const handleCapture = () => {
    if (captureRef.current) onCapture?.(captureRef.current())
  }

  const hasLowQuality = insights.imageryQuality === 'LOW'

  return (
    <div className="space-y-2">
      {hasLowQuality && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Limited imagery quality for this address. Results may be less accurate.
        </div>
      )}

      <Tabs value={tab} onValueChange={v => setTab(v as ViewTab)}>
        <TabsList className="grid grid-cols-5 w-full h-8 text-xs">
          <TabsTrigger value="3d" className="text-xs">3D Model</TabsTrigger>
          <TabsTrigger value="heatmap" className="text-xs">Heatmap</TabsTrigger>
          <TabsTrigger value="panels" className="text-xs">Panels</TabsTrigger>
          <TabsTrigger value="satellite" className="text-xs">Satellite</TabsTrigger>
          <TabsTrigger value="geotiff" className="text-xs">GeoTIFF</TabsTrigger>
        </TabsList>
      </Tabs>

      <div
        className="relative rounded-xl overflow-hidden"
        style={{ height: 380, background: '#243A2E' }}
      >

        {/* 3D Canvas — always mounted to preserve orbit state */}
        <div
          className="absolute inset-0"
          style={{ display: is3d ? 'block' : 'none' }}
        >
          <Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center">
                <Skeleton className="w-full h-full" />
              </div>
            }
          >
            <Canvas
              shadows
              camera={{ position: camPos, fov: 45 }}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
            >
              <Scene
                insights={insights}
                mode={tab === 'panels' ? 'panels' : tab === 'heatmap' ? 'heatmap' : 'model'}
                captureRef={captureRef}
                showLabels={showLabels && (tab === '3d' || tab === 'panels')}
                dsm={dsm}
                lat={lat}
                lng={lng}
                mapsKey={mapsKey}
                osBuilding={osBuilding ?? null}
                solar3DModel={solar3DModel}
                lidarPlanes={lidar.planes}
                lidarSource={lidar.source}
                viewSource={viewSource}
                pitchDeg={osNgdPitchDeg}
              />
            </Canvas>
          </Suspense>

          {/* 3D overlays */}
          {tab === 'heatmap' ? (
            <HeatmapLegend min={sunMin} max={sunMax} />
          ) : (
            <CompassRose />
          )}

          <div className="absolute top-3 left-3 text-xs text-white/80 bg-black/25 rounded px-2 py-0.5">
            Drag to rotate · Scroll to zoom
          </div>

          {/* Data source selector — legacy fallback only when Photorealistic
              Tiles isn't available. With tiles active, the tiles themselves
              are the source, so the user has nothing to switch between. */}
          {!mapsKey && (
            <div className="absolute top-10 left-3 flex gap-1">
              {(['lidar', 'solar', 'os_ngd'] as ViewSource[]).map(src => {
                const label = src === 'lidar' ? 'LiDAR' : src === 'solar' ? 'Solar' : 'OS NGD'
                const available = src === 'lidar' ? lidar.planes.length >= 1
                  : src === 'solar' ? solar3DModel.segments.length > 0
                  : !!osBuilding
                return (
                  <button
                    key={src}
                    onClick={() => { if (available) setViewSource(src) }}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                      viewSource === src
                        ? 'bg-white text-slate-800 border-white font-semibold shadow'
                        : !available
                        ? 'bg-black/10 text-white/30 border-white/15 cursor-not-allowed'
                        : 'bg-black/25 text-white/75 border-white/30 hover:bg-black/35'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          <button
            onClick={() => setShowLabels(p => !p)}
            className="absolute top-3 right-20 text-xs bg-white/80 rounded px-2 py-0.5 border border-white/60 hover:bg-white transition-colors"
          >
            {showLabels ? 'Hide' : 'Show'} labels
          </button>

          {onCapture && (
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-3 right-3 gap-1.5 shadow"
              onClick={handleCapture}
            >
              <Camera className="h-3.5 w-3.5" />
              Capture
            </Button>
          )}

          <div className="absolute bottom-3 right-3 text-[10px] bg-black/40 text-white/85 rounded px-2 py-0.5">
            {mapsKey ? 'Google 3D Tiles' : dataLayers?.dsmId ? 'Google Solar DSM' : 'Estimated geometry'}
          </div>
        </div>

        {/* Satellite view */}
        {tab === 'satellite' && (
          <div className="absolute inset-0">
            <SatelliteView insights={insights} mapsKey={mapsKey} />
          </div>
        )}

        {/* GeoTIFF view */}
        {tab === 'geotiff' && (
          <div className="absolute inset-0">
            <GeoTiffView insights={insights} dataLayers={dataLayers} />
          </div>
        )}

        {/* Source badge — always shown */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-white/85 rounded-lg px-2 py-1 shadow-sm border border-white/60 text-xs text-slate-600">
          {viewSource === 'lidar' ? (
            lidar.loading
              ? <span className="font-medium text-slate-400">LiDAR loading…</span>
              : <span className="font-medium text-green-700">EA LiDAR 1m</span>
          ) : viewSource === 'os_ngd' ? (
            <span className="font-medium text-blue-700">OS NGD</span>
          ) : (
            <>
              <span className="font-medium">Google Solar</span>
              <QualityBadge quality={insights.imageryQuality} />
            </>
          )}
        </div>
      </div>

      {/* Segment summary row */}
      <div className="flex flex-wrap gap-2">
        {segs.map((seg, i) => (
          <div key={i} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
            <span className="w-2 h-2 rounded-full" style={{
              background: azimuthToMcsOrientation(seg.azimuthDegrees) < 45 ? '#D97706'
                : azimuthToMcsOrientation(seg.azimuthDegrees) > 135 ? '#94A3B8'
                : '#C8AE8A',
            }} />
            <span className="font-medium text-slate-700">
              {azimuthLabel(seg.azimuthDegrees)} {Math.round(seg.pitchDegrees)}°
            </span>
            <span className="text-slate-500">{Math.round(seg.stats.areaMeters2)} m²</span>
            {sunshineP50(seg) > 0 && (
              <span className="text-amber-600">{Math.round(sunshineP50(seg)).toLocaleString()} hrs/yr</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
