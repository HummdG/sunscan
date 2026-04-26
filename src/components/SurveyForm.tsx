'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { AddressSearch } from './AddressSearch'
import { BillUpload } from './BillUpload'
import { AssumptionsPanel } from './AssumptionsPanel'
import { EstimatedBadge } from './EstimatedBadge'
import { RoofIsometricViewer } from './RoofIsometricViewer'
import { Sun, MapPin, FileText, Loader2, CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react'
import type { OsAddress, OsBuilding, SolarAssumptions, PanelPosition } from '@/lib/types'
import { DEFAULT_ASSUMPTIONS, DEFAULT_PANEL } from '@/lib/solarCalculations'
import { wgs84ToLocalMetres, polygonCentroid, estimateRoofPlanes, getBestRoofPlane } from '@/lib/geometry'
import { calculatePanelLayout } from '@/lib/panelLayout'

interface BillData {
  annualKwh: number
  tariffPencePerKwh: number
  standingChargePencePerDay: number
  exportTariffPencePerKwh: number
  source: 'ocr' | 'manual' | 'default'
  ocrConfidence?: 'high' | 'medium' | 'low'
}

const DEFAULT_BILL: BillData = {
  annualKwh: 3500,
  tariffPencePerKwh: 24.5,
  standingChargePencePerDay: 53,
  exportTariffPencePerKwh: 15,
  source: 'default',
}

const STEPS = [
  { label: 'Address', icon: MapPin },
  { label: 'Energy Bill', icon: FileText },
  { label: 'Your Report', icon: Sun },
]

export function SurveyForm() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Address & building
  const [selectedAddress, setSelectedAddress] = useState<OsAddress | null>(null)
  const [buildingData, setBuildingData] = useState<OsBuilding | null>(null)

  // Bill
  const [billData, setBillData] = useState<BillData>(DEFAULT_BILL)

  // Assumptions
  const [assumptions, setAssumptions] = useState<SolarAssumptions>(DEFAULT_ASSUMPTIONS)

  // 3D state
  const [panelPositions, setPanelPositions] = useState<PanelPosition[]>([])
  const [buildingPolygonLocal, setBuildingPolygonLocal] = useState<[number, number][]>([
    [-5, -4], [5, -4], [5, 4], [-5, 4], [-5, -4],
  ])

  // Captured images
  const capturedModel3dRef = useRef<string | null>(null)

  // Compute panel layout when building or assumptions change
  const computePanelLayout = useCallback(
    (building: OsBuilding, ass: SolarAssumptions) => {
      const ring = building.footprintPolygon
      const centre = polygonCentroid(ring)
      const localPoly = wgs84ToLocalMetres(ring, centre)
      setBuildingPolygonLocal(localPoly)

      const planes = estimateRoofPlanes(localPoly, ass.roofPitchDeg)
      const bestPlane = getBestRoofPlane(planes)
      const { positions } = calculatePanelLayout(bestPlane, DEFAULT_PANEL)
      setPanelPositions(positions)
    },
    [],
  )

  const handleAddressSelected = useCallback(
    (address: OsAddress, building: OsBuilding) => {
      setSelectedAddress(address)
      setBuildingData(building)

      // Apply OS-derived roof geometry to assumptions so the calculation uses this specific house
      const overrides: Partial<SolarAssumptions> = {}
      if (building.roofAzimuthDeg !== undefined) {
        // True compass bearing → MCS orientation (0=S, 90=E/W, 180=N)
        overrides.roofOrientationDeg = Math.abs(building.roofAzimuthDeg - 180)
      }
      if (building.roofPitchDeg !== undefined) {
        overrides.roofPitchDeg = Math.min(70, Math.max(5, building.roofPitchDeg))
      }

      const updatedAssumptions = Object.keys(overrides).length > 0
        ? { ...assumptions, ...overrides }
        : assumptions
      if (Object.keys(overrides).length > 0) setAssumptions(updatedAssumptions)
      computePanelLayout(building, updatedAssumptions)
    },
    [assumptions, computePanelLayout],
  )

  const handleAssumptionsChange = useCallback(
    (newAssumptions: SolarAssumptions) => {
      setAssumptions(newAssumptions)
      if (buildingData) computePanelLayout(buildingData, newAssumptions)
    },
    [buildingData, computePanelLayout],
  )

  const handleGenerate = async () => {
    if (!selectedAddress || !buildingData) return
    setGenerating(true)
    setError(null)
    setStep(2)

    try {
      const payload = {
        addressRaw: selectedAddress.address,
        addressUprn: selectedAddress.uprn,
        lat: selectedAddress.lat,
        lng: selectedAddress.lng,
        postcode: selectedAddress.postcode,
        footprintGeojson: buildingData.footprintPolygon
          ? JSON.stringify({
              type: 'Polygon',
              coordinates: [buildingData.footprintPolygon],
            })
          : null,
        footprintSource: buildingData.source,
        annualKwh: billData.annualKwh,
        tariffPencePerKwh: billData.tariffPencePerKwh,
        standingChargePencePerDay: billData.standingChargePencePerDay,
        exportTariffPencePerKwh: billData.exportTariffPencePerKwh,
        billSource: billData.source,
        assumptions,
        model3dImageBase64: capturedModel3dRef.current ?? undefined,
        chartImagesBase64: [],
      }

      const res = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await res.json()

      if (!res.ok) {
        throw new Error(result.error ?? 'Report generation failed')
      }

      router.push(`/report/${result.reportId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setGenerating(false)
      setStep(1)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      {/* Progress */}
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          {STEPS.map((s, i) => (
            <div
              key={s.label}
              className={`flex items-center gap-1.5 ${i <= step ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              <s.icon className="h-4 w-4" />
              {s.label}
            </div>
          ))}
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} className="h-2" />
      </div>

      {/* ── Step 0: Address ──────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Find your property</h1>
            <p className="text-muted-foreground mt-1">
              Start typing your UK address to find your property.
            </p>
          </div>

          <AddressSearch onAddressSelected={handleAddressSelected} />

          {selectedAddress && buildingData && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  <strong>{selectedAddress.address}</strong> — {buildingData.source === 'estimated' ? (
                    <span className="inline-flex items-center gap-1">
                      Estimated building footprint
                      <EstimatedBadge reason="OS building footprint data was not available for this address. A simplified footprint has been generated from the address coordinates." />
                    </span>
                  ) : 'OS building data loaded'}
                </span>
              </div>

              <RoofIsometricViewer
                polygonLocalM={buildingPolygonLocal}
                wallHeightM={buildingData.eaveHeightM ?? 5.5}
                ridgeHeightM={buildingData.ridgeHeightM}
                roofPitchDeg={assumptions.roofPitchDeg}
                roofAspect={buildingData.roofAspect}
                source={buildingData.source}
                onCapture={(dataUrl) => { capturedModel3dRef.current = dataUrl }}
              />
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => setStep(1)}
              disabled={!selectedAddress || !buildingData}
              className="gap-2"
            >
              Next: Energy Bill <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 1: Bill & assumptions ───────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Your energy usage</h1>
            <p className="text-muted-foreground mt-1">
              Upload your electricity bill for a personalised estimate, or use the UK average.
            </p>
          </div>

          <BillUpload value={billData} onChange={setBillData} />

          <AssumptionsPanel value={assumptions} onChange={handleAssumptionsChange} />

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)} className="gap-2">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={handleGenerate} className="gap-2 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90">
              <Sun className="h-4 w-4" /> Generate My Report
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Generating ───────────────────────────────────────────── */}
      {step === 2 && (
        <div className="text-center space-y-6 py-12">
          <div className="h-16 w-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Generating your solar report...</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Running MCS calculations, designing your system, and creating your PDF proposal.
            </p>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground max-w-xs mx-auto">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /> Looking up MCS zone for {selectedAddress?.postcode}</div>
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /> Calculating solar irradiance</div>
            <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Generating PDF report...</div>
          </div>
        </div>
      )}
    </div>
  )
}
