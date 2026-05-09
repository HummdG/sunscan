'use client'

import { useRef, useCallback, useEffect, useMemo } from 'react'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RoofAspect } from '@/lib/types'
import { polygonPrincipalAxis, polygonSignedArea } from '@/lib/geometry'
import { buildSolar3DModel } from '@/lib/solar/solarApiMapper'
import { buildRoofFromFootprint } from '@/lib/solar/roofMeshBuilder'
import type { GoogleSolarBuildingInsights, GoogleSolarPanelConfig } from '@/lib/types'
import type { EnrichedRoofPlane } from '@/types/solar'

const SVG_W = 600
const SVG_H = 380
const PAD = 44
const COS30 = Math.cos(Math.PI / 6)
const SIN30 = 0.5

function isoRP(r: number, y: number, p: number): [number, number] {
  return [(p - r) * COS30, (r + p) * SIN30 - y]
}

type P3 = [number, number, number]  // [r, y, p]

interface DrawCall {
  pts: P3[]
  fill: string
  stroke: string
  strokeWidth: number
  depth: number
}

interface ExtraPart {
  polygonLocalM: [number, number][]
  eaveHeightM?: number
  ridgeHeightM?: number
  roofPitchDeg?: number
}

interface Props {
  polygonLocalM: [number, number][]
  wallHeightM: number
  ridgeHeightM?: number
  roofPitchDeg: number
  roofAspect?: RoofAspect
  source: 'os_ngd' | 'estimated' | 'google_solar'
  extraParts?: ExtraPart[]
  onCapture?: (dataUrl: string) => void
  solarInsights?: GoogleSolarBuildingInsights
  selectedPanelConfig?: GoogleSolarPanelConfig
}

export function RoofIsometricViewer({
  polygonLocalM,
  wallHeightM,
  ridgeHeightM,
  roofPitchDeg,
  source,
  extraParts = [],
  onCapture,
  solarInsights,
  selectedPanelConfig,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const wH = wallHeightM

  // ── Principal axis transform (shared by both branches) ───────────────────────
  const principalAngle = polygonPrincipalAxis(polygonLocalM)
  const rdX = Math.cos(principalAngle)
  const rdZ = Math.sin(principalAngle)
  let pdX = -Math.sin(principalAngle)
  let pdZ = Math.cos(principalAngle)
  if (pdZ < 0) { pdX = -pdX; pdZ = -pdZ }

  function toRP(x: number, z: number): [number, number] {
    return [x * rdX + z * rdZ, x * pdX + z * pdZ]
  }

  const rpPoly: [number, number][] = polygonLocalM.map(([x, z]) => toRP(x, z))
  const extraRpPolys: [number, number][][] = extraParts.map(part =>
    part.polygonLocalM.map(([x, z]) => toRP(x, z))
  )

  // ── Global footprint bounding box (used by both branches for canvas sizing) ──
  let rMin = Infinity, rMax = -Infinity, pMin = Infinity, pMax = -Infinity
  for (const pt of [...rpPoly, ...extraRpPolys.flat()]) {
    const [r, p] = pt
    if (r < rMin) rMin = r; if (r > rMax) rMax = r
    if (p < pMin) pMin = p; if (p > pMax) pMax = p
  }
  if (rMax - rMin < 1 || pMax - pMin < 1) {
    rMin = -5; rMax = 5; pMin = -4; pMax = 4
  }

  const rSpan = rMax - rMin
  const pSpan = pMax - pMin
  const margin = rSpan * 0.12
  const pCenter = (pMin + pMax) / 2

  // ── Generic branch ridge parameters ──────────────────────────────────────────
  const pitchRad = (roofPitchDeg * Math.PI) / 180
  const pitchBasedRise = (pSpan / 2) * Math.tan(pitchRad)
  const ridgeRise = (ridgeHeightM != null && (ridgeHeightM - wH) >= 1.5)
    ? ridgeHeightM - wH
    : Math.max(pitchBasedRise, 0.5)
  const rY = wH + ridgeRise

  // ── Colors ────────────────────────────────────────────────────────────────────
  const southColor = '#F59E0B'
  const northColor = '#94A3B8'
  const ewColor    = '#C9B090'
  const hipColor   = '#C5A882'
  const wallColor  = '#D4CFC3'

  let pMaxColor: string, pMinColor: string, pMaxLabel: string, pMinLabel: string
  if (pdZ > 0.25) {
    pMaxColor = southColor; pMinColor = northColor; pMaxLabel = 'S'; pMinLabel = 'N'
  } else if (pdZ < -0.25) {
    pMaxColor = northColor; pMinColor = southColor; pMaxLabel = 'N'; pMinLabel = 'S'
  } else {
    const pdX_dominant = Math.abs(pdX) > 0.5
    if (pdX_dominant && pdX > 0) {
      pMaxColor = '#86EFAC'; pMinColor = '#C4B5FD'; pMaxLabel = 'E'; pMinLabel = 'W'
    } else {
      pMaxColor = '#C4B5FD'; pMinColor = '#86EFAC'; pMaxLabel = 'W'; pMinLabel = 'E'
    }
  }

  function azimuthFill(az: number): string {
    const ori = Math.abs(az - 180)
    if (ori < 45) return southColor
    if (ori > 135) return northColor
    return ewColor
  }

  // ── Solar branch: Voronoi-clipped roof planes from Google Solar + OS footprint
  const solarPlanes = useMemo<EnrichedRoofPlane[] | null>(() => {
    if (!solarInsights || polygonLocalM.length < 3) return null
    const model = buildSolar3DModel(solarInsights, wH)
    if (model.segments.length === 0) return null
    const planes = buildRoofFromFootprint(model.segments, polygonLocalM, wH)
    return planes.length > 0 ? planes : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solarInsights, polygonLocalM, wH])

  const useSolarBranch = solarPlanes !== null && solarPlanes.length > 0

  // ── Helper: height at (vx, vz) on a given solar plane ────────────────────────
  function solarVertexHeight(plane: EnrichedRoofPlane, vx: number, vz: number): number {
    const az = plane.azimuthDegrees * Math.PI / 180
    const faceX = Math.sin(az)
    const faceZ = -Math.cos(az)
    const tanP = Math.tan(plane.pitchDegrees * Math.PI / 180)
    const faceDist = (vx - plane.refX) * faceX + (vz - plane.refZ) * faceZ
    return Math.max(wH, plane.heightM - faceDist * tanP)
  }

  // ── Generic branch helpers ────────────────────────────────────────────────────
  function buildRoofFaces(
    rpVerts: [number, number][],
    partWallH: number,
    partRidgeH: number,
  ): DrawCall[] {
    const faces: DrawCall[] = []
    const n = rpVerts.length
    const vertCount =
      rpVerts[n - 1][0] === rpVerts[0][0] && rpVerts[n - 1][1] === rpVerts[0][1]
        ? n - 1 : n

    let polyRMin = Infinity, polyRMax = -Infinity, polyPMin = Infinity, polyPMax = -Infinity
    for (let k = 0; k < vertCount; k++) {
      const [r, p] = rpVerts[k]
      if (r < polyRMin) polyRMin = r; if (r > polyRMax) polyRMax = r
      if (p < polyPMin) polyPMin = p; if (p > polyPMax) polyPMax = p
    }
    const polyMargin = (polyRMax - polyRMin) * 0.12
    const polyPCenter = (polyPMin + polyPMax) / 2
    const polyPSpan = polyPMax - polyPMin

    for (let i = 0; i < vertCount; i++) {
      const [r1, p1] = rpVerts[i]
      const [r2, p2] = rpVerts[(i + 1) % vertCount]
      const eave1: P3 = [r1, partWallH, p1]
      const eave2: P3 = [r2, partWallH, p2]
      const ridgeR1 = Math.max(polyRMin + polyMargin, Math.min(polyRMax - polyMargin, r1))
      const ridgeR2 = Math.max(polyRMin + polyMargin, Math.min(polyRMax - polyMargin, r2))
      const ridge1: P3 = [ridgeR1, partRidgeH, polyPCenter]
      const ridge2: P3 = [ridgeR2, partRidgeH, polyPCenter]
      const avgP = (p1 + p2) / 2
      const pDelta = avgP - polyPCenter
      let fill: string
      if (Math.abs(pDelta) < polyPSpan * 0.15) {
        fill = hipColor
      } else if (pDelta > 0) {
        fill = pMaxColor
      } else {
        fill = pMinColor
      }
      const depth = (r1 + p1 + r2 + p2 + ridgeR1 + polyPCenter + ridgeR2 + polyPCenter) / 8
      const pts: P3[] = Math.abs(ridgeR1 - ridgeR2) < 0.01
        ? [eave1, eave2, ridge1]
        : [eave1, eave2, ridge2, ridge1]
      faces.push({ pts, fill, stroke: '#00000020', strokeWidth: 0.8, depth })
    }
    return faces
  }

  function collectWalls(rpVerts: [number, number][], partWallH: number): DrawCall[] {
    const walls: DrawCall[] = []
    const isCCW = polygonSignedArea(rpVerts) > 0
    const n = rpVerts.length
    for (let i = 0; i < n - 1; i++) {
      const [r1, p1] = rpVerts[i]
      const [r2, p2] = rpVerts[i + 1]
      const dr = r2 - r1
      const dp = p2 - p1
      const visible = isCCW ? (dp - dr > 0) : (dr - dp > 0)
      if (!visible) continue
      const depth = (r1 + p1 + r2 + p2) / 4
      walls.push({
        pts: [
          [r1, 0, p1] as P3,
          [r2, 0, p2] as P3,
          [r2, partWallH, p2] as P3,
          [r1, partWallH, p1] as P3,
        ],
        fill: wallColor,
        stroke: '#00000020',
        strokeWidth: 0.8,
        depth,
      })
    }
    return walls
  }

  function eavePolyPts(rpVerts: [number, number][], partWallH: number): string {
    return rpVerts.slice(0, -1).map(([r, p]) => sv(r, partWallH, p)).join(' ')
  }

  function allPointsForPart(rpVerts: [number, number][], partWallH: number, partRidgeH: number): P3[] {
    return [
      ...rpVerts.map(([r, p]): P3 => [r, 0, p]),
      ...rpVerts.map(([r, p]): P3 => [r, partWallH, p]),
      ...rpVerts.map(([r, p]): P3 => [
        Math.max(rMin + margin, Math.min(rMax - margin, r)),
        partRidgeH,
        pCenter,
      ]),
    ]
  }

  const extraRidgeHeights = extraParts.map((part, pi) => {
    const partWallH = part.eaveHeightM ?? wH
    const partPitch = (part.roofPitchDeg ?? roofPitchDeg) * Math.PI / 180
    const partPitchRise = (pSpan / 2) * Math.tan(partPitch)
    const partRidgeRise = (part.ridgeHeightM != null && (part.ridgeHeightM - partWallH) >= 1.5)
      ? part.ridgeHeightM - partWallH
      : Math.max(partPitchRise, 0.5)
    return { partWallH, partRidgeH: partWallH + partRidgeRise, rpVerts: extraRpPolys[pi] }
  })

  // ── All 3D points for scale computation ──────────────────────────────────────

  const allPoints3D: P3[] = useSolarBranch
    ? solarPlanes!.flatMap(plane => {
        const n = plane.polygon.length
        const vertCount = (n > 1 &&
          plane.polygon[0][0] === plane.polygon[n - 1][0] &&
          plane.polygon[0][1] === plane.polygon[n - 1][1]) ? n - 1 : n
        return Array.from({ length: vertCount }, (_, i) => {
          const [vx, vz] = plane.polygon[i]
          const [r, p] = toRP(vx, vz)
          const h = solarVertexHeight(plane, vx, vz)
          return [[r, 0, p], [r, wH, p], [r, h, p]] as P3[]
        }).flat()
      })
    : [
        ...allPointsForPart(rpPoly, wH, rY),
        ...extraRidgeHeights.flatMap(({ rpVerts, partWallH, partRidgeH }) =>
          allPointsForPart(rpVerts, partWallH, partRidgeH)
        ),
      ]

  const allProj = allPoints3D.map(([r, y, p]) => isoRP(r, y, p))
  const pxMin = Math.min(...allProj.map(([px]) => px))
  const pxMax = Math.max(...allProj.map(([px]) => px))
  const pyMin = Math.min(...allProj.map(([, py]) => py))
  const pyMax = Math.max(...allProj.map(([, py]) => py))

  const availW = SVG_W - PAD * 2
  const availH = SVG_H - PAD * 2 - 60
  const scale  = Math.min(availW / (pxMax - pxMin || 1), availH / (pyMax - pyMin || 1))

  console.log('[RoofIso]', {
    branch: useSolarBranch ? 'solar' : 'generic',
    parts: 1 + extraParts.length,
    n: polygonLocalM.length,
    pt0: polygonLocalM[0],
    rSpan: (rMax - rMin).toFixed(4),
    pSpan: (pMax - pMin).toFixed(4),
    pxRange: (pxMax - pxMin).toFixed(4),
    pyRange: (pyMax - pyMin).toFixed(4),
    scale: scale.toFixed(2),
  })

  const tx = PAD + (availW - (pxMax - pxMin) * scale) / 2 - pxMin * scale
  const ty = PAD + (availH - (pyMax - pyMin) * scale) / 2 - pyMin * scale + 16

  function sv(r: number, y: number, p: number): string {
    const [px, py] = isoRP(r, y, p)
    return `${(px * scale + tx).toFixed(1)},${(py * scale + ty).toFixed(1)}`
  }

  function svXY(r: number, y: number, p: number): [number, number] {
    const [px, py] = isoRP(r, y, p)
    return [px * scale + tx, py * scale + ty]
  }

  // ── Build draw calls ──────────────────────────────────────────────────────────

  let allDrawCalls: DrawCall[]

  if (useSolarBranch) {
    // Solar branch: per-plane Voronoi polygons with real heights
    const roofCalls: DrawCall[] = solarPlanes!.map(plane => {
      const n = plane.polygon.length
      const vertCount = (n > 1 &&
        plane.polygon[0][0] === plane.polygon[n - 1][0] &&
        plane.polygon[0][1] === plane.polygon[n - 1][1]) ? n - 1 : n

      const pts: P3[] = []
      let depthSum = 0
      for (let i = 0; i < vertCount; i++) {
        const [vx, vz] = plane.polygon[i]
        const [r, p] = toRP(vx, vz)
        const h = solarVertexHeight(plane, vx, vz)
        pts.push([r, h, p])
        depthSum += r + p
      }

      return {
        pts,
        fill: azimuthFill(plane.azimuthDegrees),
        stroke: '#00000025',
        strokeWidth: 0.8,
        depth: depthSum / vertCount,
      }
    })

    allDrawCalls = [
      ...roofCalls,
      ...collectWalls(rpPoly, wH),
    ]
  } else {
    // Generic branch: ridge-based algorithm
    allDrawCalls = [
      ...buildRoofFaces(rpPoly, wH, rY),
      ...collectWalls(rpPoly, wH),
      ...extraRidgeHeights.flatMap(({ rpVerts, partWallH, partRidgeH }) => [
        ...buildRoofFaces(rpVerts, partWallH, partRidgeH),
        ...collectWalls(rpVerts, partWallH),
      ]),
    ]
  }

  allDrawCalls.sort((a, b) => a.depth - b.depth)

  // ── Eave caps ─────────────────────────────────────────────────────────────────
  const eaveCaps: { pts: string; wallH: number }[] = useSolarBranch
    ? [{ pts: eavePolyPts(rpPoly, wH), wallH: wH }]
    : [
        { pts: eavePolyPts(rpPoly, wH), wallH: wH },
        ...extraRidgeHeights.map(({ rpVerts, partWallH }) => ({
          pts: eavePolyPts(rpVerts, partWallH),
          wallH: partWallH,
        })),
      ]

  // ── Ridge line (generic branch only) ─────────────────────────────────────────
  const [rx0, ry0] = svXY(rMin + margin, rY, pCenter)
  const [rx1, ry1] = svXY(rMax - margin, rY, pCenter)

  // ── Direction labels on main roof slopes ──────────────────────────────────────
  const [lMaxX, lMaxY] = svXY((rMin + rMax) / 2, wH + ridgeRise * 0.5, pMax - (pMax - pCenter) * 0.5)
  const [lMinX, lMinY] = svXY((rMin + rMax) / 2, wH + ridgeRise * 0.5, pMin + (pCenter - pMin) * 0.5)

  // ── Compass rotation ──────────────────────────────────────────────────────────
  const rNorth = -rdZ
  const pNorth = -pdZ
  const [cxNorth, cyNorth] = isoRP(rNorth, 0, pNorth)
  const compassRotDeg = Math.atan2(cxNorth, -cyNorth) * (180 / Math.PI)

  // ── Solar panels ─────────────────────────────────────────────────────────────
  interface PanelQuad { tl: P3; tr: P3; br: P3; bl: P3 }
  const solarPanels: PanelQuad[] = []

  if (useSolarBranch && selectedPanelConfig) {
    const PANEL_W = 1.0   // along ridge (landscape orientation)
    const PANEL_H = 1.6   // along slope
    const GAP = 0.06
    const MARGIN = 0.4

    for (const summary of selectedPanelConfig.roofSegmentSummaries) {
      if (summary.panelsCount === 0) continue
      const plane = solarPlanes!.find(p => p.solarSegmentIndex === summary.segmentIndex)
      if (!plane) continue

      const az = plane.azimuthDegrees * Math.PI / 180
      const ridgeX = Math.cos(az), ridgeZ = Math.sin(az)
      const faceX = Math.sin(az), faceZ = -Math.cos(az)
      const tanP = Math.tan(plane.pitchDegrees * Math.PI / 180)
      const cosP = Math.cos(plane.pitchDegrees * Math.PI / 180)
      const panelGroundH = PANEL_H * cosP  // horizontal extent per panel row

      // Polygon bounding box in (ridge, face) coords relative to centroid
      const n = plane.polygon.length
      const vertCount = (n > 1 &&
        plane.polygon[0][0] === plane.polygon[n - 1][0] &&
        plane.polygon[0][1] === plane.polygon[n - 1][1]) ? n - 1 : n
      let minR = Infinity, maxR = -Infinity, minF = Infinity, maxF = -Infinity
      for (let i = 0; i < vertCount; i++) {
        const [vx, vz] = plane.polygon[i]
        const r = (vx - plane.refX) * ridgeX + (vz - plane.refZ) * ridgeZ
        const f = (vx - plane.refX) * faceX  + (vz - plane.refZ) * faceZ
        if (r < minR) minR = r; if (r > maxR) maxR = r
        if (f < minF) minF = f; if (f > maxF) maxF = f
      }

      const usableR = maxR - minR - 2 * MARGIN
      const usableF = maxF - minF - 2 * MARGIN
      const cols = Math.max(0, Math.floor((usableR + GAP) / (PANEL_W + GAP)))
      const rows = Math.max(0, Math.floor((usableF + GAP) / (panelGroundH + GAP)))
      if (cols === 0 || rows === 0) continue

      const totalW = cols * (PANEL_W + GAP) - GAP
      const startR = (minR + maxR) / 2 - totalW / 2

      let placed = 0
      outer: for (let row = 0; row < rows; row++) {
        const fBottom = minF + MARGIN + row * (panelGroundH + GAP)
        const fTop = fBottom + panelGroundH
        const fCenter = (fBottom + fTop) / 2
        for (let col = 0; col < cols; col++) {
          if (placed >= summary.panelsCount) break outer
          const rCenter = startR + col * (PANEL_W + GAP) + PANEL_W / 2
          const hr = PANEL_W / 2
          const hf = panelGroundH / 2

          // Four corners in local (x, z)
          const corners: [number, number][] = [
            [plane.refX + (rCenter - hr) * ridgeX + (fCenter - hf) * faceX,
             plane.refZ + (rCenter - hr) * ridgeZ + (fCenter - hf) * faceZ],
            [plane.refX + (rCenter + hr) * ridgeX + (fCenter - hf) * faceX,
             plane.refZ + (rCenter + hr) * ridgeZ + (fCenter - hf) * faceZ],
            [plane.refX + (rCenter + hr) * ridgeX + (fCenter + hf) * faceX,
             plane.refZ + (rCenter + hr) * ridgeZ + (fCenter + hf) * faceZ],
            [plane.refX + (rCenter - hr) * ridgeX + (fCenter + hf) * faceX,
             plane.refZ + (rCenter - hr) * ridgeZ + (fCenter + hf) * faceZ],
          ]

          const to3D = ([vx, vz]: [number, number]): P3 => {
            const [r, p] = toRP(vx, vz)
            const f = (vx - plane.refX) * faceX + (vz - plane.refZ) * faceZ
            const h = Math.max(wH, plane.heightM - f * tanP) + 0.05
            return [r, h, p]
          }

          solarPanels.push({
            tl: to3D(corners[0]),
            tr: to3D(corners[1]),
            br: to3D(corners[2]),
            bl: to3D(corners[3]),
          })
          placed++
        }
      }
    }
  } else if (!useSolarBranch) {
    // Generic branch: panels on south-facing slope
    const showPanels = pMaxLabel === 'S'
    const panelW = 1.0, panelH = 1.6, panelGapR = 0.06, panelGapP = 0.06
    const solarRMin = rMin + margin + 0.5
    const solarRMax = rMax - margin - 0.5
    const solarPMin = pCenter + 0.4
    const solarPMax = pMax - 0.4
    const nPanelCols = Math.max(0, Math.floor((solarRMax - solarRMin + panelGapR) / (panelW + panelGapR)))
    const nPanelRows = Math.max(0, Math.floor((solarPMax - solarPMin + panelGapP) / (panelH + panelGapP)))
    const totalSolarW = nPanelCols * (panelW + panelGapR) - panelGapR
    const solarRStart = (solarRMin + solarRMax) / 2 - totalSolarW / 2

    function roofYatP(p: number): number {
      return wH + ((pMax - p) / (pMax - pCenter)) * ridgeRise
    }

    if (showPanels) {
      for (let row = 0; row < nPanelRows; row++) {
        const pBottom = solarPMax - row * (panelH + panelGapP)
        const pTop = pBottom - panelH
        if (pTop < solarPMin) break
        for (let col = 0; col < nPanelCols; col++) {
          const r1 = solarRStart + col * (panelW + panelGapR)
          const r2 = r1 + panelW
          solarPanels.push({
            bl: [r1, roofYatP(pBottom), pBottom],
            br: [r2, roofYatP(pBottom), pBottom],
            tr: [r2, roofYatP(pTop),    pTop],
            tl: [r1, roofYatP(pTop),    pTop],
          })
        }
      }
    }
  }

  function polyStr(...pts: P3[]): string {
    return pts.map(([r, y, p]) => sv(r, y, p)).join(' ')
  }

  // ── Capture ───────────────────────────────────────────────────────────────────
  const handleCapture = useCallback(() => {
    if (!svgRef.current || !onCapture) return
    const svgStr = new XMLSerializer().serializeToString(svgRef.current)
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)))
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = SVG_W; canvas.height = SVG_H
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#f0f6ff'
      ctx.fillRect(0, 0, SVG_W, SVG_H)
      ctx.drawImage(img, 0, 0)
      onCapture(canvas.toDataURL('image/png'))
    }
    img.src = url
  }, [onCapture])

  useEffect(() => {
    if (!onCapture) return
    const id = setTimeout(handleCapture, 300)
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-full rounded-xl overflow-hidden border border-slate-200"
      style={{ height: SVG_H }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dbeafe" />
            <stop offset="100%" stopColor="#f0f6ff" />
          </linearGradient>
        </defs>
        <rect width={SVG_W} height={SVG_H} fill="url(#skyGrad)" />

        {allDrawCalls.map((dc, i) => (
          <polygon
            key={i}
            points={dc.pts.map(([r, y, p]) => sv(r, y, p)).join(' ')}
            fill={dc.fill}
            stroke={dc.stroke}
            strokeWidth={dc.strokeWidth}
            strokeLinejoin="round"
          />
        ))}

        {eaveCaps.map(({ pts }, i) => (
          <polygon
            key={`eave-${i}`}
            points={pts}
            fill="#E8E4DC"
            stroke="#00000015"
            strokeWidth="0.5"
            strokeLinejoin="round"
          />
        ))}

        {solarPanels.map(({ bl, br, tr, tl }, i) => (
          <polygon
            key={`panel-${i}`}
            points={polyStr(bl, br, tr, tl)}
            fill="#1e3a5f"
            stroke="#94c4ff"
            strokeWidth="0.5"
            strokeLinejoin="round"
          />
        ))}

        {!useSolarBranch && (
          <line
            x1={rx0} y1={ry0} x2={rx1} y2={ry1}
            stroke="#7a6a5a"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        )}

        {!useSolarBranch && (
          <>
            {[
              { x: lMaxX, y: lMaxY, label: pMaxLabel },
              { x: lMinX, y: lMinY, label: pMinLabel },
            ].map(({ x, y, label }) => (
              <text
                key={label}
                x={x} y={y + 5}
                textAnchor="middle"
                fontSize="14"
                fontWeight="700"
                fill="white"
                stroke="#00000055"
                strokeWidth="3"
                paintOrder="stroke"
                fontFamily="system-ui, sans-serif"
              >
                {label}
              </text>
            ))}
          </>
        )}

        {useSolarBranch && solarPlanes!.map((plane, i) => {
          const n = plane.polygon.length
          const vertCount = (n > 1 &&
            plane.polygon[0][0] === plane.polygon[n - 1][0] &&
            plane.polygon[0][1] === plane.polygon[n - 1][1]) ? n - 1 : n
          const cx = plane.polygon.slice(0, vertCount).reduce((s, [x]) => s + x, 0) / vertCount
          const cz = plane.polygon.slice(0, vertCount).reduce((s, [, z]) => s + z, 0) / vertCount
          const [cr, cp] = toRP(cx, cz)
          const ch = solarVertexHeight(plane, cx, cz)
          const [sx, sy] = svXY(cr, ch - 0.3, cp)
          const az = plane.azimuthDegrees
          const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
          const dir = dirs[Math.round(((az % 360) + 360) % 360 / 45)]
          const pitch = Math.round(plane.pitchDegrees)
          return (
            <text
              key={`seg-label-${i}`}
              x={sx} y={sy}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="white"
              stroke="#00000066"
              strokeWidth="2.5"
              paintOrder="stroke"
              fontFamily="system-ui, sans-serif"
            >
              {dir} {pitch}°
            </text>
          )
        })}

        {/* Compass rose */}
        <g transform={`translate(${SVG_W - 52}, 52)`}>
          <circle r="38" fill="white" fillOpacity="0.93" stroke="#cbd5e1" strokeWidth="1.2" />
          <g transform={`rotate(${compassRotDeg.toFixed(1)})`}>
            <line x1="0" y1="-20" x2="0" y2="20" stroke="#e2e8f0" strokeWidth="1" />
            <line x1="-20" y1="0" x2="20" y2="0" stroke="#e2e8f0" strokeWidth="1" />
            <polygon points="0,-26 4,-12 -4,-12" fill="#1e3a5f" />
            <text textAnchor="middle" y="-16" fontSize="10" fontWeight="700" fill="#1e3a5f" fontFamily="system-ui">N</text>
            <polygon points="0,26 4,12 -4,12" fill="#94a3b8" />
            <text textAnchor="middle" y="34" fontSize="10" fill="#64748b" fontFamily="system-ui">S</text>
            <text x="-30" y="4" textAnchor="middle" fontSize="10" fill="#64748b" fontFamily="system-ui">W</text>
            <text x="30" y="4" textAnchor="middle" fontSize="10" fill="#64748b" fontFamily="system-ui">E</text>
          </g>
        </g>

        {/* Legend */}
        <g transform={`translate(10, ${SVG_H - 66})`}>
          <rect width="142" height="58" rx="8" fill="white" fillOpacity="0.93" stroke="#e2e8f0" strokeWidth="1" />
          <rect x="10" y="11" width="13" height="13" rx="3" fill={southColor} />
          <text x="28" y="22" fontSize="11.5" fill="#374151" fontFamily="system-ui">South-facing</text>
          <rect x="10" y="31" width="13" height="13" rx="3" fill={northColor} />
          <text x="28" y="42" fontSize="11.5" fill="#374151" fontFamily="system-ui">North-facing</text>
        </g>

        {/* Source badge */}
        <g transform="translate(10, 10)">
          <rect
            width={source === 'os_ngd' ? 88 : source === 'google_solar' ? 104 : 76}
            height="24"
            rx="12"
            fill={source === 'os_ngd' ? '#dcfce7' : source === 'google_solar' ? '#dbeafe' : '#fef9c3'}
            stroke={source === 'os_ngd' ? '#86efac' : source === 'google_solar' ? '#93c5fd' : '#fde047'}
            strokeWidth="1"
          />
          <text
            x={source === 'os_ngd' ? 44 : source === 'google_solar' ? 52 : 38}
            y="16"
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill={source === 'os_ngd' ? '#166534' : source === 'google_solar' ? '#1e40af' : '#854d0e'}
            fontFamily="system-ui"
          >
            {source === 'os_ngd' ? 'OS NGD Data' : source === 'google_solar' ? 'Google Solar' : 'Estimated'}
          </text>
        </g>
      </svg>

      {onCapture && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 right-3 gap-1.5 shadow-sm"
          onClick={handleCapture}
        >
          <Camera className="h-4 w-4" />
          Capture View
        </Button>
      )}
    </div>
  )
}
