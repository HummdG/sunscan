'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, AlertCircle, CheckCircle2, Pencil } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EstimatedBadge } from './EstimatedBadge'
import type { ParsedBill } from '@/lib/types'

interface BillData {
  annualKwh: number
  tariffPencePerKwh: number
  standingChargePencePerDay: number
  exportTariffPencePerKwh: number
  source: 'ocr' | 'manual' | 'default'
  ocrConfidence?: 'high' | 'medium' | 'low'
}

interface BillUploadProps {
  value: BillData
  onChange: (data: BillData) => void
}

export function BillUpload({ value, onChange }: BillUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('bill', file)

    try {
      const res = await fetch('/api/bill/parse', { method: 'POST', body: formData })
      const data = await res.json()

      if (data.success && data.data) {
        const bill = data.data as ParsedBill
        onChange({
          annualKwh: bill.annualKwh,
          tariffPencePerKwh: bill.tariffPencePerKwh,
          standingChargePencePerDay: bill.standingChargePencePerDay,
          exportTariffPencePerKwh: bill.exportTariffPencePerKwh,
          source: 'ocr',
          ocrConfidence: bill.confidence,
        })
      } else {
        setUploadError(data.error ?? 'Could not extract data from this bill. Please enter values manually.')
        onChange({ ...value, source: 'manual' })
      }
    } catch {
      setUploadError('Upload failed. Please enter values manually.')
      onChange({ ...value, source: 'manual' })
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const setField = (key: keyof Omit<BillData, 'source' | 'ocrConfidence'>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value) || 0
      onChange({ ...value, [key]: v, source: value.source === 'default' ? 'manual' : value.source })
    }

  const isEstimated = value.source === 'default'

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          uploading ? 'border-blue-400 bg-blue-50' : 'border-muted hover:border-primary/50 hover:bg-muted/30'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {uploading ? (
          <div className="space-y-2">
            <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-sm text-muted-foreground">Reading your bill...</p>
          </div>
        ) : fileName ? (
          <div className="space-y-2">
            <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
            <p className="text-sm font-medium">{fileName}</p>
            <p className="text-xs text-muted-foreground">Click to upload a different bill</p>
          </div>
        ) : (
          <div className="space-y-2">
            <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">Upload your electricity bill</p>
            <p className="text-xs text-muted-foreground">PDF, JPEG, or PNG · Max 10MB</p>
            <p className="text-xs text-muted-foreground">Or skip to use the UK average (3,500 kWh/yr)</p>
          </div>
        )}
      </div>

      {/* OCR status */}
      {value.source === 'ocr' && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
          <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-800">
            <span className="font-medium">Values extracted by OCR. Please verify.</span>
            <span className="ml-1">Confidence: {value.ocrConfidence}. Edit any field below if incorrect.</span>
          </div>
        </div>
      )}

      {uploadError && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
          <p className="text-sm text-red-800">{uploadError}</p>
        </div>
      )}

      {/* Bill fields */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label className="flex items-center gap-1 mb-1.5">
            Annual Usage (kWh)
            {isEstimated && <EstimatedBadge reason="No electricity bill was uploaded. Using UK average of 3,500 kWh/year. Upload a bill or edit this value for a personalised estimate." />}
            {value.source === 'ocr' && <Pencil className="h-3 w-3 text-muted-foreground ml-1" />}
          </Label>
          <Input
            type="number"
            value={value.annualKwh}
            onChange={setField('annualKwh')}
            min={100}
            max={100000}
            step={50}
            className="h-10"
          />
        </div>
        <div>
          <Label className="flex items-center gap-1 mb-1.5">
            Unit Rate (p/kWh)
            {isEstimated && <EstimatedBadge reason="Using typical UK unit rate. Check your bill for your actual tariff." />}
          </Label>
          <Input
            type="number"
            value={value.tariffPencePerKwh}
            onChange={setField('tariffPencePerKwh')}
            min={0}
            max={100}
            step={0.1}
            className="h-10"
          />
        </div>
        <div>
          <Label className="flex items-center gap-1 mb-1.5">
            Standing Charge (p/day)
            {isEstimated && <EstimatedBadge reason="Using typical UK standing charge. Check your bill for the exact figure." />}
          </Label>
          <Input
            type="number"
            value={value.standingChargePencePerDay}
            onChange={setField('standingChargePencePerDay')}
            min={0}
            max={200}
            step={0.5}
            className="h-10"
          />
        </div>
      </div>

      {isEstimated && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <FileText className="h-3.5 w-3.5" />
          Defaults: 3,500 kWh/yr · 24.5p/kWh · 53p/day standing charge
        </p>
      )}
    </div>
  )
}
