import type {
  GoogleSolarBuildingInsights,
  GoogleSolarDataLayers,
  GoogleSolarPanelConfig,
} from './types'

const SOLAR_API_BASE = 'https://solar.googleapis.com/v1'
const API_KEY = process.env.GOOGLE_SOLAR_API_KEY

if (!API_KEY && process.env.NODE_ENV === 'production') {
  console.error('GOOGLE_SOLAR_API_KEY is not set — Solar API calls will use mock data')
}

// ─── buildingInsights ─────────────────────────────────────────────────────────

export async function fetchBuildingInsights(
  lat: number,
  lng: number,
): Promise<GoogleSolarBuildingInsights | null> {
  if (!API_KEY) return mockBuildingInsights(lat, lng)

  const url = new URL(`${SOLAR_API_BASE}/buildingInsights:findClosest`)
  url.searchParams.set('location.latitude', String(lat))
  url.searchParams.set('location.longitude', String(lng))
  url.searchParams.set('requiredQuality', 'LOW')
  url.searchParams.set('key', API_KEY)

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 86400 } })
    if (!res.ok) {
      const body = await res.text()
      console.error('Solar API buildingInsights error', res.status, body)
      return null
    }
    return (await res.json()) as GoogleSolarBuildingInsights
  } catch (err) {
    console.error('Solar API buildingInsights fetch failed', err)
    return null
  }
}

// ─── dataLayers ───────────────────────────────────────────────────────────────

export async function fetchDataLayers(
  lat: number,
  lng: number,
  radiusMeters = 50,
): Promise<GoogleSolarDataLayers | null> {
  if (!API_KEY) return mockDataLayers()

  const url = new URL(`${SOLAR_API_BASE}/dataLayers:get`)
  url.searchParams.set('location.latitude', String(lat))
  url.searchParams.set('location.longitude', String(lng))
  url.searchParams.set('radiusMeters', String(radiusMeters))
  url.searchParams.set('view', 'FULL_LAYERS')
  url.searchParams.set('key', API_KEY)

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 86400 } })
    if (!res.ok) {
      const body = await res.text()
      console.error('Solar API dataLayers error', res.status, body)
      return null
    }
    const data = (await res.json()) as GoogleSolarDataLayers
    // Extract GCS ids from GeoTIFF URLs for client-side proxy use
    if (data.rgbUrl) {
      const match = data.rgbUrl.match(/[?&]id=([^&]+)/)
      if (match) data.rgbId = match[1]
    }
    if (data.dsmUrl) {
      const match = data.dsmUrl.match(/[?&]id=([^&]+)/)
      if (match) data.dsmId = match[1]
    }
    return data
  } catch (err) {
    console.error('Solar API dataLayers fetch failed', err)
    return null
  }
}

// ─── GeoTIFF fetch (server-side, adds API key) ────────────────────────────────

export async function fetchGeoTiffBuffer(id: string): Promise<ArrayBuffer | null> {
  if (!API_KEY) return null

  const url = new URL(`${SOLAR_API_BASE}/geoTiff:get`)
  url.searchParams.set('id', id)
  url.searchParams.set('key', API_KEY)

  try {
    const res = await fetch(url.toString())
    if (!res.ok) {
      console.error('Solar API geoTiff error', res.status)
      return null
    }
    return await res.arrayBuffer()
  } catch (err) {
    console.error('Solar API geoTiff fetch failed', err)
    return null
  }
}

// ─── Panel config selection ───────────────────────────────────────────────────

export function selectOptimalPanelConfig(
  configs: GoogleSolarPanelConfig[],
  annualConsumptionKwh: number,
  inverterLoss: number,
  systemLoss: number,
): GoogleSolarPanelConfig | null {
  if (!configs.length) return null
  const pr = (1 - inverterLoss) * (1 - systemLoss)
  return (
    configs.find(c => c.yearlyEnergyDcKwh * pr >= annualConsumptionKwh) ??
    configs[configs.length - 1]
  )
}

// ─── Mock fallbacks ───────────────────────────────────────────────────────────

function mockBuildingInsights(lat: number, lng: number): GoogleSolarBuildingInsights {
  return {
    name: 'buildings/mock-building',
    center: { latitude: lat, longitude: lng },
    boundingBox: {
      sw: { latitude: lat - 0.00005, longitude: lng - 0.00008 },
      ne: { latitude: lat + 0.00005, longitude: lng + 0.00008 },
    },
    imageryDate: { year: 2024, month: 6, day: 1 },
    imageryQuality: 'MEDIUM',
    solarPotential: {
      maxArrayPanelsCount: 20,
      maxArrayAreaMeters2: 38,
      maxSunshineHoursPerYear: 1100,
      carbonOffsetFactorKgPerMwh: 195,
      wholeRoofStats: {
        areaMeters2: 80,
        sunshineQuantiles: [600, 750, 900, 1000, 1050, 1100, 1150, 1200, 1250, 1300, 1400],
        groundAreaMeters2: 70,
      },
      roofSegmentStats: [
        {
          pitchDegrees: 32,
          azimuthDegrees: 180,
          stats: {
            areaMeters2: 63,
            sunshineQuantiles: [900, 1000, 1050, 1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450],
            groundAreaMeters2: 53,
          },
          // Centre of the south-facing slope sits in the south half of the building (+z = south)
          center: { latitude: lat - 0.0000250, longitude: lng },
          boundingBox: {
            sw: { latitude: lat - 0.0000500, longitude: lng - 0.00007 },
            ne: { latitude: lat,             longitude: lng + 0.00007 },
          },
          planeHeightAtCenterMeters: 6.5,
        },
        {
          pitchDegrees: 32,
          azimuthDegrees: 0,
          stats: {
            areaMeters2: 63,
            sunshineQuantiles: [400, 500, 600, 700, 750, 800, 850, 900, 950, 1000, 1050],
            groundAreaMeters2: 53,
          },
          // Centre of the north-facing slope sits in the north half of the building (-z = north)
          center: { latitude: lat + 0.0000250, longitude: lng },
          boundingBox: {
            sw: { latitude: lat,             longitude: lng - 0.00007 },
            ne: { latitude: lat + 0.0000500, longitude: lng + 0.00007 },
          },
          planeHeightAtCenterMeters: 6.5,
        },
      ],
      solarPanels: [
        // South-facing slope (segmentIndex 0) — 4 panels in a 2×2 grid
        { segmentIndex: 0, center: { latitude: lat - 0.0000350, longitude: lng - 0.00003 }, orientation: 'LANDSCAPE', yearlyEnergyDcKwh: 320 },
        { segmentIndex: 0, center: { latitude: lat - 0.0000350, longitude: lng + 0.00003 }, orientation: 'LANDSCAPE', yearlyEnergyDcKwh: 320 },
        { segmentIndex: 0, center: { latitude: lat - 0.0000200, longitude: lng - 0.00003 }, orientation: 'LANDSCAPE', yearlyEnergyDcKwh: 305 },
        { segmentIndex: 0, center: { latitude: lat - 0.0000200, longitude: lng + 0.00003 }, orientation: 'LANDSCAPE', yearlyEnergyDcKwh: 305 },
        // North-facing slope (segmentIndex 1) — 3 panels
        { segmentIndex: 1, center: { latitude: lat + 0.0000200, longitude: lng - 0.00003 }, orientation: 'LANDSCAPE', yearlyEnergyDcKwh: 180 },
        { segmentIndex: 1, center: { latitude: lat + 0.0000200, longitude: lng + 0.00000 }, orientation: 'LANDSCAPE', yearlyEnergyDcKwh: 180 },
        { segmentIndex: 1, center: { latitude: lat + 0.0000200, longitude: lng + 0.00003 }, orientation: 'LANDSCAPE', yearlyEnergyDcKwh: 180 },
      ],
      solarPanelConfigs: [
        {
          panelsCount: 6,
          yearlyEnergyDcKwh: 1800,
          roofSegmentSummaries: [
            { pitchDegrees: 32, azimuthDegrees: 180, panelsCount: 6, yearlyEnergyDcKwh: 1800, segmentIndex: 0 },
          ],
        },
        {
          panelsCount: 10,
          yearlyEnergyDcKwh: 3000,
          roofSegmentSummaries: [
            { pitchDegrees: 32, azimuthDegrees: 180, panelsCount: 10, yearlyEnergyDcKwh: 3000, segmentIndex: 0 },
          ],
        },
        {
          panelsCount: 14,
          yearlyEnergyDcKwh: 4200,
          roofSegmentSummaries: [
            { pitchDegrees: 32, azimuthDegrees: 180, panelsCount: 12, yearlyEnergyDcKwh: 3600, segmentIndex: 0 },
            { pitchDegrees: 32, azimuthDegrees: 0, panelsCount: 2, yearlyEnergyDcKwh: 600, segmentIndex: 1 },
          ],
        },
        {
          panelsCount: 20,
          yearlyEnergyDcKwh: 6000,
          roofSegmentSummaries: [
            { pitchDegrees: 32, azimuthDegrees: 180, panelsCount: 14, yearlyEnergyDcKwh: 4200, segmentIndex: 0 },
            { pitchDegrees: 32, azimuthDegrees: 0, panelsCount: 6, yearlyEnergyDcKwh: 1800, segmentIndex: 1 },
          ],
        },
      ],
      panelCapacityWatts: 400,
      panelHeightMeters: 1.65,
      panelWidthMeters: 0.992,
      panelLifetimeYears: 25,
    },
  }
}

function mockDataLayers(): GoogleSolarDataLayers {
  return {
    imageryDate: { year: 2024, month: 6, day: 1 },
    imageryProcessedDate: { year: 2024, month: 7, day: 1 },
    pixelSizeMeters: 0.1,
    rgbUrl: '',
    dsmUrl: '',
    maskUrl: '',
    annualFluxUrl: '',
  }
}
