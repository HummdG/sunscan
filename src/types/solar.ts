export interface LocalRoofSegment {
  segmentIndex: number
  azimuthDeg: number
  pitchDeg: number
  heightAtCenterM: number
  areaM2: number
  sunshineQuantiles: number[]
  center: { x: number; z: number }
  ridgeLenM: number
  groundDepthM: number
}

export interface Solar3DModel {
  segments: LocalRoofSegment[]
  buildingBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  wallHeightM: number
}

export interface PlacedPanel {
  segmentIndex: number
  position: [number, number, number]
  rotationY: number
  pitchRad: number
}

export interface PanelLayout {
  segmentIndex: number
  panels: PlacedPanel[]
  requestedCount: number
  placedCount: number
}

// ─── LiDAR / HouseModel types ─────────────────────────────────────────────────

export interface LidarRoofPlane {
  id: string
  pitchDegrees: number
  azimuthDegrees: number
  /** nDSM height at the pixel centroid (metres above ground) */
  heightM: number
  /** Oriented bounding rectangle [x, z][] in local metres — closed ring (5 pts) */
  polygon: [number, number][]
  areaM2: number
  source: 'lidar' | 'estimated'
  /** Pixel centroid — the point where heightM applies. Set by roofSegmentation. */
  refX?: number
  refZ?: number
}

export interface EnrichedRoofPlane extends LidarRoofPlane {
  sunshineQuantiles?: number[]
  solarSegmentIndex?: number
  usable: boolean
  /** Original segment centre — stable height reference that survives polygon clipping */
  refX: number
  refZ: number
}

export interface HouseModel {
  /** Building footprint [x, z][] in local metres relative to building centroid */
  footprintLocal: [number, number][]
  wallHeightM: number
  roofPlanes: EnrichedRoofPlane[]
  source: 'lidar+os+solar' | 'lidar+solar' | 'os+solar' | 'solar_only'
}
