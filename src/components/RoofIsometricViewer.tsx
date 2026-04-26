'use client'

import { useRef, useCallback, useEffect } from 'react'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RoofAspect } from '@/lib/types'
import { polygonPrincipalAxis, polygonSignedArea } from '@/lib/geometry'

const SVG_W = 600
const SVG_H = 380
const PAD = 44
const COS30 = Math.cos(Math.PI / 6)   // 0.866
const SIN30 = 0.5

// ── Projection ───────────────────────────────────────────────────────────────
//
// Works in ridge-aligned coordinates so the building always fills the canvas
// regardless of real-world orientation:
//   r  = along the ridge (building's longest axis)
//   p  = perpendicular to ridge, toward the "solar face"
//   y  = height above ground
//
// SE isometric view (camera from +r, +p, +y direction looking NW):
//   svgX = (p − r) · cos30
//   svgY = (r + p) · sin30 − y        (y up → negative svgY)
//
// Because every building is first decomposed into (r, p) space via
// polygonPrincipalAxis, a 45° world-space building no longer collapses
// to a vertical line.

function isoRP(r: number, y: number, p: number): [number, number] {
  return [(p - r) * COS30, (r + p) * SIN30 - y]
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  polygonLocalM: [number, number][]
  wallHeightM: number
  ridgeHeightM?: number
  roofPitchDeg: number
  roofAspect?: RoofAspect
  source: 'os_ngd' | 'estimated'
  onCapture?: (dataUrl: string) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RoofIsometricViewer({
  polygonLocalM,
  wallHeightM,
  ridgeHeightM,
  roofPitchDeg,
  source,
  onCapture,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const wH = wallHeightM

  // ── Decompose polygon into ridge-aligned (r, p) space ─────────────────────

  const principalAngle = polygonPrincipalAxis(polygonLocalM)
  const rdX = Math.cos(principalAngle)
  const rdZ = Math.sin(principalAngle)
  let pdX = -Math.sin(principalAngle)
  let pdZ = Math.cos(principalAngle)
  // Flip p-axis if south face would be behind the camera — ensures south is always front-facing
  if (pdZ < 0) { pdX = -pdX; pdZ = -pdZ }

  // Convert world (x, z) → ridge-aligned (r, p)
  function toRP(x: number, z: number): [number, number] {
    return [x * rdX + z * rdZ, x * pdX + z * pdZ]
  }

  // Entire polygon in (r, p) space
  const rpPoly: [number, number][] = polygonLocalM.map(([x, z]) => toRP(x, z))

  // Find bounding extents in (r, p) space
  let rMin = Infinity, rMax = -Infinity, pMin = Infinity, pMax = -Infinity
  for (const [r, p] of rpPoly) {
    if (r < rMin) rMin = r
    if (r > rMax) rMax = r
    if (p < pMin) pMin = p
    if (p > pMax) pMax = p
  }

  // Guard: degenerate polygon (< 1m extent) means polygon is in degrees or a point.
  // Fall back to a 10×8m default so wall height doesn't collapse the SVG to a vertical line.
  if (rMax - rMin < 1 || pMax - pMin < 1) {
    rMin = -5; rMax = 5; pMin = -4; pMax = 4
  }

  const rSpan = rMax - rMin
  const pSpan = pMax - pMin
  const margin = rSpan * 0.12
  const pCenter = (pMin + pMax) / 2

  const pitchRad = (roofPitchDeg * Math.PI) / 180
  const ridgeRise = ridgeHeightM != null
    ? Math.max(0.5, ridgeHeightM - wH)
    : (pSpan / 2) * Math.tan(pitchRad)
  const rY = wH + ridgeRise

  // 6 key roof points in (r, y, p) space — no world-coordinate conversion needed
  type P3 = [number, number, number]   // [r, y, p]
  const c0: P3 = [rMin,          wH, pMin]     // eave: r_min, p_min
  const c1: P3 = [rMax,          wH, pMin]     // eave: r_max, p_min
  const c2: P3 = [rMax,          wH, pMax]     // eave: r_max, p_max
  const c3: P3 = [rMin,          wH, pMax]     // eave: r_min, p_max
  const re0: P3 = [rMin + margin, rY, pCenter]  // ridge near-end
  const re1: P3 = [rMax - margin, rY, pCenter]  // ridge far-end

  // ── Colors ────────────────────────────────────────────────────────────────

  // pdZ > 0 → p_max side has more positive z → faces south in world space
  const southColor = '#F59E0B'  // amber
  const northColor = '#94A3B8'  // slate
  const ewColor    = '#C9B090'  // tan (east/west facing)
  const hipColor   = '#C5A882'  // neutral hip
  const wallColor  = '#D4CFC3'  // cream wall

  let pMaxColor: string, pMinColor: string, pMaxLabel: string, pMinLabel: string
  if (pdZ > 0.25) {
    pMaxColor = southColor; pMinColor = northColor; pMaxLabel = 'S'; pMinLabel = 'N'
  } else if (pdZ < -0.25) {
    pMaxColor = northColor; pMinColor = southColor; pMaxLabel = 'N'; pMinLabel = 'S'
  } else {
    // Ridge runs roughly N-S → main slopes face E and W
    const pdX_dominant = Math.abs(pdX) > 0.5
    if (pdX_dominant && pdX > 0) {
      pMaxColor = '#86EFAC'; pMinColor = '#C4B5FD'    // p_max faces east → green, west → purple
      pMaxLabel = 'E'; pMinLabel = 'W'
    } else {
      pMaxColor = '#C4B5FD'; pMinColor = '#86EFAC'
      pMaxLabel = 'W'; pMinLabel = 'E'
    }
  }

  // ── Visible walls (SE view in ridge-aligned space) ────────────────────────
  // SE camera = +r and +p direction. For CCW polygon, edge visible if dp − dr > 0.

  const isCCW = polygonSignedArea(rpPoly) > 0
  const n = rpPoly.length

  interface WallEdge { r1: number; p1: number; r2: number; p2: number; depth: number }
  const visibleWalls: WallEdge[] = []

  for (let i = 0; i < n - 1; i++) {
    const [r1, p1] = rpPoly[i]
    const [r2, p2] = rpPoly[i + 1]
    const dr = r2 - r1
    const dp = p2 - p1
    const visible = isCCW ? (dp - dr > 0) : (dr - dp > 0)
    if (visible) {
      visibleWalls.push({ r1, p1, r2, p2, depth: (r1 + p1 + r2 + p2) / 2 })
    }
  }
  // Ascending depth → farthest-from-camera first (painter's back-to-front)
  visibleWalls.sort((a, b) => a.depth - b.depth)

  // ── Scale projected points to fit SVG canvas ──────────────────────────────

  // Collect all (r, y, p) points we will draw
  const allPoints3D: P3[] = [
    ...rpPoly.map(([r, p]): P3 => [r, 0,  p]),   // footprint at y=0
    ...rpPoly.map(([r, p]): P3 => [r, wH, p]),   // footprint at y=wallH
    c0, c1, c2, c3, re0, re1,
  ]

  const allProj = allPoints3D.map(([r, y, p]) => isoRP(r, y, p))
  const pxMin = Math.min(...allProj.map(([px]) => px))
  const pxMax = Math.max(...allProj.map(([px]) => px))
  const pyMin = Math.min(...allProj.map(([, py]) => py))
  const pyMax = Math.max(...allProj.map(([, py]) => py))

  const availW = SVG_W - PAD * 2
  const availH = SVG_H - PAD * 2 - 60   // leave room for legend
  const scale  = Math.min(availW / (pxMax - pxMin || 1), availH / (pyMax - pyMin || 1))

  console.log('[RoofIso]', {
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

  // Project and transform a (r, y, p) point to SVG string "x,y"
  function sv(r: number, y: number, p: number): string {
    const [px, py] = isoRP(r, y, p)
    return `${(px * scale + tx).toFixed(1)},${(py * scale + ty).toFixed(1)}`
  }

  function svXY(r: number, y: number, p: number): [number, number] {
    const [px, py] = isoRP(r, y, p)
    return [px * scale + tx, py * scale + ty]
  }

  function polyStr(...pts: P3[]): string {
    return pts.map(([r, y, p]) => sv(r, y, p)).join(' ')
  }

  function centroid(...pts: P3[]): [number, number] {
    let sx = 0, sy = 0
    for (const pt of pts) { const [x, y] = svXY(...pt); sx += x; sy += y }
    return [sx / pts.length, sy / pts.length]
  }

  // Eave polygon (all footprint vertices at wallH)
  const eavePolyStr = rpPoly.slice(0, -1).map(([r, p]) => sv(r, wH, p)).join(' ')

  // Ridge line endpoints
  const [rx0, ry0] = svXY(...re0)
  const [rx1, ry1] = svXY(...re1)

  // Label positions
  const [lMaxX, lMaxY] = centroid(c3, c2, re1, re0)  // p_max (south) slope
  const [lMinX, lMinY] = centroid(c0, c1, re1, re0)  // p_min (north) slope

  // ── Compass rotation ─────────────────────────────────────────────────────
  // Project the world "north" direction (-z) through (r,p) → isoRP to find
  // the SVG angle at which north appears, then rotate the compass rose to match.
  const rNorth = -rdZ
  const pNorth = -pdZ
  const [cxNorth, cyNorth] = isoRP(rNorth, 0, pNorth)
  const compassRotDeg = Math.atan2(cxNorth, -cyNorth) * (180 / Math.PI)

  // ── Solar panels on south slope ──────────────────────────────────────────
  function roofYatP(p: number): number {
    return wH + ((pMax - p) / (pMax - pCenter)) * ridgeRise
  }

  const showPanels = pMaxLabel === 'S'
  const panelW = 1.0      // metres along ridge
  const panelH = 1.6      // metres along p (toward ridge)
  const panelGapR = 0.06
  const panelGapP = 0.06
  const solarRMin = rMin + margin + 0.5
  const solarRMax = rMax - margin - 0.5
  const solarPMin = pCenter + 0.4
  const solarPMax = pMax - 0.4

  const nPanelCols = Math.max(0, Math.floor((solarRMax - solarRMin + panelGapR) / (panelW + panelGapR)))
  const nPanelRows = Math.max(0, Math.floor((solarPMax - solarPMin + panelGapP) / (panelH + panelGapP)))
  const totalSolarW = nPanelCols * (panelW + panelGapR) - panelGapR
  const solarRStart = (solarRMin + solarRMax) / 2 - totalSolarW / 2

  interface PanelQuad { tl: P3; tr: P3; br: P3; bl: P3 }
  const solarPanels: PanelQuad[] = []

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

  // ── Capture ────────────────────────────────────────────────────────────────

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

  // Auto-capture once on mount so the image is always available for the PDF
  // even if the user never clicks the manual "Capture View" button.
  useEffect(() => {
    if (!onCapture) return
    const id = setTimeout(handleCapture, 300)
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally omit deps — fires once on mount only

  // ── Render ─────────────────────────────────────────────────────────────────

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
        {/* Sky gradient background */}
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dbeafe" />
            <stop offset="100%" stopColor="#f0f6ff" />
          </linearGradient>
        </defs>
        <rect width={SVG_W} height={SVG_H} fill="url(#skyGrad)" />

        {/* ── Painter's order: back (NW) → front (SE) ── */}

        {/* 1. p_min slope (north-facing) — farthest from SE camera */}
        <polygon
          points={polyStr(c0, c1, re1, re0)}
          fill={pMinColor}
          stroke="#00000020"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />

        {/* 2. West hip end */}
        <polygon
          points={polyStr(c0, c3, re0)}
          fill={hipColor}
          stroke="#00000020"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />

        {/* 3. Eave top (flat face at wall-plate level) */}
        <polygon
          points={eavePolyStr}
          fill="#E8E4DC"
          stroke="#00000015"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />

        {/* 4. East hip end */}
        <polygon
          points={polyStr(c1, c2, re1)}
          fill={hipColor}
          stroke="#00000020"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />

        {/* 5. Visible wall quads — sorted farthest → nearest */}
        {visibleWalls.map(({ r1, p1, r2, p2 }, i) => (
          <polygon
            key={i}
            points={[
              sv(r1, 0,  p1),
              sv(r2, 0,  p2),
              sv(r2, wH, p2),
              sv(r1, wH, p1),
            ].join(' ')}
            fill={wallColor}
            stroke="#00000020"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
        ))}

        {/* 6. p_max slope (south-facing) — front face, drawn last */}
        <polygon
          points={polyStr(c3, c2, re1, re0)}
          fill={pMaxColor}
          stroke="#00000020"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />

        {/* 7. Solar panels on south slope */}
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

        {/* Ridge line */}
        <line
          x1={rx0} y1={ry0} x2={rx1} y2={ry1}
          stroke="#7a6a5a"
          strokeWidth="1.8"
          strokeLinecap="round"
        />

        {/* Direction labels on roof slopes */}
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

        {/* Compass rose — top right, needle rotated to show true north */}
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

        {/* Legend — bottom left */}
        <g transform={`translate(10, ${SVG_H - 66})`}>
          <rect width="142" height="58" rx="8" fill="white" fillOpacity="0.93" stroke="#e2e8f0" strokeWidth="1" />
          <rect x="10" y="11" width="13" height="13" rx="3" fill={southColor} />
          <text x="28" y="22" fontSize="11.5" fill="#374151" fontFamily="system-ui">South-facing</text>
          <rect x="10" y="31" width="13" height="13" rx="3" fill={northColor} />
          <text x="28" y="42" fontSize="11.5" fill="#374151" fontFamily="system-ui">North-facing</text>
        </g>

        {/* Source badge — top left */}
        <g transform="translate(10, 10)">
          <rect
            width={source === 'os_ngd' ? 88 : 76}
            height="24"
            rx="12"
            fill={source === 'os_ngd' ? '#dcfce7' : '#fef9c3'}
            stroke={source === 'os_ngd' ? '#86efac' : '#fde047'}
            strokeWidth="1"
          />
          <text
            x={source === 'os_ngd' ? 44 : 38}
            y="16"
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill={source === 'os_ngd' ? '#166534' : '#854d0e'}
            fontFamily="system-ui"
          >
            {source === 'os_ngd' ? 'OS NGD Data' : 'Estimated'}
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
