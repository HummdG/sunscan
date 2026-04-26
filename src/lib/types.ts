// Central TypeScript types shared between server and client

// ─── OS API ──────────────────────────────────────────────────────────────────

export interface OsAddress {
  uprn: string
  address: string // formatted single-line address
  lat: number
  lng: number
  postcode: string
}

export interface RoofAspect {
  n: number; ne: number; e: number; se: number;
  s: number; sw: number; w: number; nw: number;
}

export interface OsBuilding {
  /** WGS84 polygon ring(s): [[lng, lat], ...] */
  footprintPolygon: [number, number][]
  source: 'os_ngd' | 'estimated'
  areaM2: number
  /** Height from ground to eave/wall top (m) */
  eaveHeightM?: number
  /** Height from ground to roof ridge (m) */
  ridgeHeightM?: number
  /** Roof area facing each of 8 compass directions (m²) — only present for os_ngd source */
  roofAspect?: RoofAspect
  /** True compass bearing (0=N, 180=S) of the best solar-facing slope, derived from roofAspect */
  roofAzimuthDeg?: number
  /** Roof pitch angle (degrees) derived from OS eave/ridge heights */
  roofPitchDeg?: number
}

// ─── Bill parsing ─────────────────────────────────────────────────────────────

export interface ParsedBill {
  annualKwh: number
  tariffPencePerKwh: number
  standingChargePencePerDay: number
  exportTariffPencePerKwh: number
  confidence: 'high' | 'medium' | 'low'
}

// ─── System specs ─────────────────────────────────────────────────────────────

export interface PanelSpec {
  widthMm: number
  heightMm: number
  depthMm: number
  wattPeak: number
  modelName: string
}

export interface InverterSpec {
  modelName: string
  ratedKw: number
  efficiency: number // 0–1
}

export interface BatterySpec {
  modelName: string
  capacityKwh: number
  roundTripEfficiency: number // 0–1
}

// ─── Solar assumptions ───────────────────────────────────────────────────────

export interface SolarAssumptions {
  roofPitchDeg: number
  roofOrientationDeg: number // 0=South (MCS convention), 90=East/West, 180=North
  shadingLoss: number // 0–1, e.g. 0.05 for 5%
  inverterLoss: number // 0–1
  systemLoss: number // 0–1
  systemCostPounds: number
  hasBattery: boolean
  batteryKwh: number
  exportTariffPencePerKwh: number
}

// ─── Roof geometry ───────────────────────────────────────────────────────────

export interface RoofPlane {
  /** corners in local metres [x, z] relative to building centroid */
  cornersLocal: [number, number][]
  facingDeg: number // compass bearing, 0=N
  orientationDeg: number // MCS convention, 0=S
  tiltDeg: number
  areaM2: number
  normal: [number, number, number] // unit normal in 3D local space
}

// ─── Panel layout ─────────────────────────────────────────────────────────────

export interface PanelPosition {
  col: number
  row: number
  /** centre position in 3D local space (metres) */
  x: number
  y: number
  z: number
  /** rotation in radians around the roof plane Y axis */
  rotationY: number
}

// ─── Solar calculation results ───────────────────────────────────────────────

export interface SolarResults {
  annualGenerationKwh: number
  selfConsumptionKwh: number
  exportKwh: number
  selfConsumptionRate: number // 0–1
  annualSavingsPounds: number
  paybackYears: number
  co2SavedTonnesPerYear: number
  /** kWh per month, index 0=Jan */
  monthlyGenKwh: number[]
  /** year 1–25 savings */
  twentyFiveYearSavings: { year: number; saving: number; cumulative: number }[]
}

// ─── Report data ─────────────────────────────────────────────────────────────

export interface ReportData {
  id: string
  quoteNumber: string
  createdAt: string // ISO string

  // Address
  addressRaw: string
  lat: number
  lng: number
  postcode: string

  // Building
  footprintGeojson: string | null
  footprintSource: 'os_ngd' | 'estimated'

  // Bill
  annualKwh: number
  tariffPencePerKwh: number
  standingChargePencePerDay: number
  exportTariffPencePerKwh: number
  billSource: 'ocr' | 'manual' | 'default'

  // System
  panelCount: number
  systemSizeKw: number
  panelSpec: PanelSpec
  inverterSpec: InverterSpec
  batterySpec: BatterySpec | null

  // Calculations
  mcsZone: string
  irradianceKwhPerM2: number
  results: SolarResults

  // Assumptions
  assumptions: SolarAssumptions

  // Images
  model3dImageUrl: string | null
  pdfUrl: string | null
}

// ─── API route payloads ───────────────────────────────────────────────────────

export interface GenerateReportPayload {
  addressRaw: string
  addressUprn?: string
  lat: number
  lng: number
  postcode: string
  footprintGeojson: string | null
  footprintSource: 'os_ngd' | 'estimated'
  annualKwh: number
  tariffPencePerKwh: number
  standingChargePencePerDay: number
  exportTariffPencePerKwh: number
  billSource: 'ocr' | 'manual' | 'default'
  assumptions: SolarAssumptions
  model3dImageBase64?: string
  chartImagesBase64?: string[]
}
