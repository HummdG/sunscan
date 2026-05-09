'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { AddressSearch } from './AddressSearch'
import { BillUpload } from './BillUpload'
import { AssumptionsPanel } from './AssumptionsPanel'
import { SolarRoofViewer } from './SolarRoofViewer'
import { Sun, MapPin, FileText, Loader2, CheckCircle2, ChevronRight, ChevronLeft, AlertTriangle } from 'lucide-react'
import type {
  OsAddress,
  OsBuilding,
  SolarAssumptions,
  GoogleSolarBuildingInsights,
  GoogleSolarDataLayers,
} from '@/lib/types'
import { DEFAULT_ASSUMPTIONS } from '@/lib/solarCalculations'

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

  // Address
  const [selectedAddress, setSelectedAddress] = useState<OsAddress | null>(null)

  // OS building footprint
  const [osBuilding, setOsBuilding] = useState<OsBuilding | null>(null)

  // Solar API data
  const [solarInsights, setSolarInsights] = useState<GoogleSolarBuildingInsights | null>(null)
  const [dataLayers, setDataLayers] = useState<GoogleSolarDataLayers | null>(null)
  const [loadingSolar, setLoadingSolar] = useState(false)
  const [solarError, setSolarError] = useState<string | null>(null)

  // Bill
  const [billData, setBillData] = useState<BillData>(DEFAULT_BILL)

  // Assumptions (updated from Solar API best segment)
  const [assumptions, setAssumptions] = useState<SolarAssumptions>(DEFAULT_ASSUMPTIONS)

  // Captured 3D image for PDF
  const capturedModel3dRef = useRef<string | null>(null)

  const handleAddressSelected = useCallback(async (address: OsAddress) => {
    setSelectedAddress(address)
    setSolarInsights(null)
    setDataLayers(null)
    setSolarError(null)
    setOsBuilding(null)
    setLoadingSolar(true)

    try {
      const [insightsRes, layersRes, buildingRes] = await Promise.all([
        fetch(`/api/solar/building?lat=${address.lat}&lng=${address.lng}`),
        fetch(`/api/solar/datalayers?lat=${address.lat}&lng=${address.lng}`),
        fetch(`/api/os/building?uprn=${encodeURIComponent(address.uprn)}&lat=${address.lat}&lng=${address.lng}`),
      ])

      let insights: GoogleSolarBuildingInsights | null = null
      let layers: GoogleSolarDataLayers | null = null

      if (insightsRes.ok) {
        const d = await insightsRes.json()
        insights = d.data ?? null
      }
      if (layersRes.ok) {
        const d = await layersRes.json()
        layers = d.data ?? null
      }
      if (buildingRes.ok) {
        const d = await buildingRes.json()
        if (d.building) setOsBuilding(d.building)
      }

      if (insights) {
        setSolarInsights(insights)
        setDataLayers(layers)

        // Apply best-sunshine segment to assumptions
        const segs = insights.solarPotential.roofSegmentStats ?? []
        if (segs.length > 0) {
          const p50 = (q: number[] | undefined) => q?.[Math.floor((q.length ?? 0) / 2)] ?? 0
          const best = segs.reduce((prev, cur) =>
            p50(cur.stats.sunshineQuantiles) > p50(prev.stats.sunshineQuantiles) ? cur : prev,
          )
          const mcsOri = Math.abs(((best.azimuthDegrees - 180 + 360) % 360) - 180)
          setAssumptions(prev => ({
            ...prev,
            roofPitchDeg: Math.min(70, Math.max(5, best.pitchDegrees)),
            roofOrientationDeg: mcsOri,
          }))
        }
      } else {
        setSolarError('Google Solar data is not available for this address. Calculations will use estimated defaults.')
      }
    } catch (err) {
      console.error('Solar API fetch failed', err)
      setSolarError('Could not load solar data. Calculations will use estimated defaults.')
    } finally {
      setLoadingSolar(false)
    }
  }, [])

  const handleGenerate = async () => {
    if (!selectedAddress) return
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
        footprintGeojson: osBuilding
          ? JSON.stringify({ type: 'Polygon', coordinates: [osBuilding.footprintPolygon] })
          : null,
        footprintSource: osBuilding ? 'os_ngd' : solarInsights ? 'google_solar' : 'estimated',
        annualKwh: billData.annualKwh,
        tariffPencePerKwh: billData.tariffPencePerKwh,
        standingChargePencePerDay: billData.standingChargePencePerDay,
        exportTariffPencePerKwh: billData.exportTariffPencePerKwh,
        billSource: billData.source,
        assumptions,
        solarApiJson: solarInsights ? JSON.stringify(solarInsights) : undefined,
        model3dImageBase64: capturedModel3dRef.current ?? undefined,
        chartImagesBase64: [],
      }

      const res = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Report generation failed')

      router.push(`/report/${result.reportId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setGenerating(false)
      setStep(1)
    }
  }

  void generating

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

      {/* Step 0: Address */}
      {step === 0 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Find your property</h1>
            <p className="text-muted-foreground mt-1">
              Start typing your UK address to find your property.
            </p>
          </div>

          <AddressSearch onAddressSelected={handleAddressSelected} />

          {loadingSolar && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700 animate-pulse">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span>Fetching Google Solar analysis for this property…</span>
            </div>
          )}

          {solarError && !loadingSolar && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{solarError}</span>
            </div>
          )}

          {selectedAddress && !loadingSolar && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="flex-1 font-medium">{selectedAddress.address}</span>
                {solarInsights ? (
                  <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs shrink-0">
                    Google Solar loaded
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs shrink-0">
                    Estimated defaults
                  </Badge>
                )}
              </div>

              {solarInsights && (
                <SolarRoofViewer
                  insights={solarInsights}
                  dataLayers={dataLayers}
                  lat={selectedAddress.lat}
                  lng={selectedAddress.lng}
                  osBuilding={osBuilding}
                  onCapture={(dataUrl) => { capturedModel3dRef.current = dataUrl }}
                />
              )}

              <AssumptionsPanel value={assumptions} onChange={setAssumptions} />
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => setStep(1)}
              disabled={!selectedAddress || loadingSolar}
              className="gap-2"
            >
              Next: Energy Bill <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: Bill */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Your energy usage</h1>
            <p className="text-muted-foreground mt-1">
              Upload your electricity bill for a personalised estimate, or use the UK average.
            </p>
          </div>

          <BillUpload value={billData} onChange={setBillData} />

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

      {/* Step 2: Generating */}
      {step === 2 && (
        <div className="text-center space-y-6 py-12">
          <div className="h-16 w-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Generating your solar report…</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Running solar calculations, designing your system, and creating your PDF proposal.
            </p>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground max-w-xs mx-auto">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Google Solar analysis loaded
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              MCS irradiance zone: {selectedAddress?.postcode}
            </div>
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating PDF report…
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
