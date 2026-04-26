import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
} from '@react-pdf/renderer'
import type { ReportData } from '@/lib/types'
import {
  PdfMonthlyGenChart,
  PdfSelfConsumptionDonut,
  PdfCumulativeSavingsChart,
  PdfBillSavingsChart,
} from './PdfCharts'

// ─── Styles ───────────────────────────────────────────────────────────────────

const NAVY = '#1E3A5F'
const GOLD = '#F59E0B'
const GREEN = '#10B981'
const LIGHT = '#F8FAFC'
const MUTED = '#64748B'
const WHITE = '#FFFFFF'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    backgroundColor: WHITE,
    padding: 0,
  },
  coverPage: {
    backgroundColor: NAVY,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 60,
    height: '100%',
  },
  coverTitle: {
    fontSize: 36,
    fontFamily: 'Helvetica-Bold',
    color: GOLD,
    marginBottom: 8,
    textAlign: 'center',
  },
  coverSubtitle: {
    fontSize: 16,
    color: WHITE,
    marginBottom: 40,
    textAlign: 'center',
  },
  coverAddress: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: WHITE,
    textAlign: 'center',
    marginBottom: 8,
  },
  coverDetail: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 4,
  },
  coverDivider: {
    width: 60,
    height: 3,
    backgroundColor: GOLD,
    marginVertical: 24,
  },
  sectionPage: {
    padding: 40,
  },
  sectionHeader: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    marginBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: GOLD,
    paddingBottom: 8,
  },
  subHeader: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    marginBottom: 8,
    marginTop: 16,
  },
  body: {
    fontSize: 11,
    color: '#334155',
    lineHeight: 1.6,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  label: {
    fontSize: 10,
    color: MUTED,
    width: 200,
  },
  value: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#1E293B',
    flex: 1,
  },
  statCard: {
    backgroundColor: LIGHT,
    borderRadius: 8,
    padding: 16,
    flex: 1,
    margin: 4,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 9,
    color: MUTED,
    textAlign: 'center',
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    marginVertical: 12,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: NAVY,
    padding: 8,
    borderRadius: 4,
    marginBottom: 2,
  },
  tableHeaderCell: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: WHITE,
    flex: 1,
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tableRowAlt: {
    flexDirection: 'row',
    padding: 6,
    backgroundColor: LIGHT,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tableCell: {
    fontSize: 9,
    color: '#334155',
    flex: 1,
    textAlign: 'center',
  },
  estimatedTag: {
    fontSize: 8,
    color: GOLD,
    fontFamily: 'Helvetica-Bold',
  },
  greenStat: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    color: GREEN,
    textAlign: 'center',
  },
  disclaimer: {
    fontSize: 8,
    color: MUTED,
    lineHeight: 1.5,
    marginTop: 8,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 20,
    right: 40,
    fontSize: 9,
    color: MUTED,
  },
  headerBar: {
    backgroundColor: NAVY,
    height: 6,
    marginBottom: 32,
  },
})

// ─── Helper components ────────────────────────────────────────────────────────

function PageHeader({ title }: { title: string }) {
  return (
    <View>
      <View style={styles.headerBar} />
      <Text style={styles.sectionHeader}>{title}</Text>
    </View>
  )
}

function StatCard({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

function DataRow({ label, value, estimated }: { label: string; value: string; estimated?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>
        {value}{estimated ? ' ' : ''}
        {estimated && <Text style={styles.estimatedTag}>[Est.]</Text>}
      </Text>
    </View>
  )
}

// ─── Main document ─────────────────────────────────────────────────────────────

interface ReportDocumentProps {
  data: ReportData
  model3dImage?: string
}

export function ReportDocument({ data, model3dImage }: ReportDocumentProps) {
  const isEstimatedBill = data.billSource === 'default'
  const isEstimatedFootprint = data.footprintSource === 'estimated'
  const annualBillBefore = (data.annualKwh * data.tariffPencePerKwh) / 100 + (data.standingChargePencePerDay * 365) / 100
  const annualBillAfter = annualBillBefore - data.results.annualSavingsPounds

  return (
    <Document
      title={`SunScan Solar Proposal — ${data.addressRaw}`}
      author="SunScan"
      subject="Solar PV Proposal"
    >
      {/* ── Cover Page ──────────────────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.coverPage}>
          <Text style={styles.coverTitle}>☀ SunScan</Text>
          <Text style={styles.coverSubtitle}>Solar Survey & Proposal</Text>
          <View style={styles.coverDivider} />
          <Text style={styles.coverAddress}>{data.addressRaw}</Text>
          <Text style={styles.coverDetail}>Quote Reference: {data.quoteNumber}</Text>
          <Text style={styles.coverDetail}>
            Date: {new Date(data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
          <View style={styles.coverDivider} />
          <Text style={styles.coverDetail}>Prepared by SunScan · www.sunscan.co.uk</Text>
          <Text style={styles.coverDetail}>This proposal is valid for 30 days from the date above.</Text>
        </View>
      </Page>

      {/* ── System Summary ───────────────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="Recommended Solar System" />
          <View style={styles.statsRow}>
            <StatCard value={`${data.systemSizeKw.toFixed(2)} kWp`} label="System Size" />
            <StatCard value={String(data.panelCount)} label="Solar Panels" />
            <StatCard value={`${data.results.annualGenerationKwh.toLocaleString()} kWh`} label="Est. Annual Generation" />
          </View>
          <View style={styles.statsRow}>
            <StatCard value={`£${data.results.annualSavingsPounds.toLocaleString()}`} label="Est. Annual Savings" color={GREEN} />
            <StatCard value={`${data.results.paybackYears} yrs`} label="Payback Period" />
            <StatCard value={`${data.results.co2SavedTonnesPerYear} t`} label="CO₂ Saved/Year" color={GREEN} />
          </View>

          {model3dImage && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.subHeader}>3D Visualisation</Text>
              <Image src={model3dImage} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 6 }} />
              {isEstimatedFootprint && (
                <Text style={styles.estimatedTag}>⚠ Building footprint is estimated — exact panel placement may vary</Text>
              )}
            </View>
          )}
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

      {/* ── System Components ────────────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="System Components" />

          <Text style={styles.subHeader}>Solar Panels — {data.panelCount}×</Text>
          <DataRow label="Model" value={data.panelSpec.modelName} />
          <DataRow label="Watt Peak" value={`${data.panelSpec.wattPeak}W`} />
          <DataRow label="Dimensions" value={`${data.panelSpec.heightMm}mm × ${data.panelSpec.widthMm}mm × ${data.panelSpec.depthMm}mm`} />
          <DataRow label="Total System Size" value={`${data.systemSizeKw.toFixed(2)} kWp`} />

          <Text style={styles.subHeader}>Inverter</Text>
          <DataRow label="Model" value={data.inverterSpec.modelName} />
          <DataRow label="Rated Output" value={`${data.inverterSpec.ratedKw} kW`} />
          <DataRow label="Efficiency" value={`${(data.inverterSpec.efficiency * 100).toFixed(1)}%`} />

          {data.batterySpec && (
            <>
              <Text style={styles.subHeader}>Battery Storage</Text>
              <DataRow label="Model" value={data.batterySpec.modelName} />
              <DataRow label="Capacity" value={`${data.batterySpec.capacityKwh} kWh`} />
              <DataRow label="Round-Trip Efficiency" value={`${(data.batterySpec.roundTripEfficiency * 100).toFixed(0)}%`} />
            </>
          )}
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

      {/* ── System Performance ───────────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="System Performance" />

          <Text style={styles.subHeader}>Annual Energy Breakdown</Text>
          <DataRow label="MCS Zone" value={data.mcsZone} />
          <DataRow label="In-Plane Irradiance" value={`${Math.round(data.irradianceKwhPerM2)} kWh/m²/year`} />
          <DataRow label="Annual Generation" value={`${data.results.annualGenerationKwh.toLocaleString()} kWh`} />
          <DataRow
            label="Annual Consumption"
            value={`${data.annualKwh.toLocaleString()} kWh`}
            estimated={isEstimatedBill}
          />
          <DataRow label="Self-Consumed" value={`${data.results.selfConsumptionKwh.toLocaleString()} kWh (${(data.results.selfConsumptionRate * 100).toFixed(0)}%)`} />
          <DataRow label="Exported to Grid" value={`${data.results.exportKwh.toLocaleString()} kWh`} />

          <Text style={styles.subHeader}>Monthly Generation (kWh)</Text>
          <PdfMonthlyGenChart monthlyKwh={data.results.monthlyGenKwh} />

          <Text style={styles.subHeader}>Energy Use Breakdown</Text>
          <View style={{ alignItems: 'center' }}>
            <PdfSelfConsumptionDonut
              selfKwh={data.results.selfConsumptionKwh}
              exportKwh={data.results.exportKwh}
            />
          </View>
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

      {/* ── Financial Analysis ───────────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="Financial Analysis" />

          <Text style={styles.subHeader}>Electricity Bill Savings</Text>
          <DataRow label="Current Annual Bill" value={`£${Math.round(annualBillBefore).toLocaleString()}`} estimated={isEstimatedBill} />
          <DataRow label="Projected Annual Bill" value={`£${Math.round(annualBillAfter).toLocaleString()}`} />
          <DataRow label="Annual Saving" value={`£${data.results.annualSavingsPounds.toLocaleString()}`} />
          <DataRow label="Unit Rate" value={`${data.tariffPencePerKwh}p/kWh`} estimated={isEstimatedBill} />
          <DataRow label="Export Tariff (SEG)" value={`${data.exportTariffPencePerKwh}p/kWh`} />
          <View style={{ alignItems: 'center', marginTop: 4, marginBottom: 4 }}>
            <PdfBillSavingsChart before={annualBillBefore} after={annualBillAfter} />
          </View>

          <Text style={styles.subHeader}>Investment & Payback</Text>
          <DataRow label="System Cost (inc. installation)" value={`£${data.assumptions.systemCostPounds.toLocaleString()}`} />
          <DataRow label="Simple Payback Period" value={`${data.results.paybackYears} years`} />
          <DataRow label="25-Year Net Saving" value={`£${(data.results.twentyFiveYearSavings[24]?.cumulative ?? 0).toLocaleString()}`} />

          <Text style={styles.subHeader}>Cumulative Savings Over 25 Years</Text>
          <PdfCumulativeSavingsChart savings={data.results.twentyFiveYearSavings} />
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

      {/* ── Environmental Benefits ───────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="Environmental Benefits" />
          <View style={styles.statsRow}>
            <StatCard value={`${data.results.co2SavedTonnesPerYear} t`} label="CO₂ Avoided per Year" color={GREEN} />
            <StatCard value={`${Math.round(data.results.co2SavedTonnesPerYear * 25)} t`} label="CO₂ Avoided over 25 Years" color={GREEN} />
            <StatCard value={`${Math.round(data.results.co2SavedTonnesPerYear * 45)}`} label="Equivalent Trees Planted" color={GREEN} />
          </View>
          <Text style={styles.body}>
            Your solar system will generate clean electricity from sunlight, displacing electricity that would otherwise be generated by the UK grid.
            Based on the current UK grid carbon intensity of 0.233 kgCO₂/kWh (DESNZ 2024), your system will avoid approximately{' '}
            {data.results.co2SavedTonnesPerYear} tonnes of CO₂ per year — equivalent to planting around{' '}
            {Math.round(data.results.co2SavedTonnesPerYear * 45)} trees.
          </Text>
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

      {/* ── Quotation ────────────────────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="Quotation" />
          <Text style={styles.body}>Quote Reference: {data.quoteNumber}</Text>
          <Text style={styles.body}>Address: {data.addressRaw}</Text>

          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { flex: 3, textAlign: 'left' }]}>Item</Text>
            <Text style={styles.tableHeaderCell}>Qty</Text>
            <Text style={styles.tableHeaderCell}>Unit Price</Text>
            <Text style={styles.tableHeaderCell}>Total</Text>
          </View>
          {[
            { item: `${data.panelSpec.modelName} Solar Panel`, qty: data.panelCount, unit: Math.round((data.assumptions.systemCostPounds * 0.5) / data.panelCount) },
            { item: `${data.inverterSpec.modelName} Inverter`, qty: 1, unit: Math.round(data.assumptions.systemCostPounds * 0.2) },
            { item: 'Mounting System & Fixings', qty: 1, unit: Math.round(data.assumptions.systemCostPounds * 0.1) },
            { item: 'Installation Labour', qty: 1, unit: Math.round(data.assumptions.systemCostPounds * 0.15) },
            { item: 'DNO Application & Commissioning', qty: 1, unit: Math.round(data.assumptions.systemCostPounds * 0.05) },
          ].map((row, i) => (
            <View key={i} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <Text style={[styles.tableCell, { flex: 3, textAlign: 'left' }]}>{row.item}</Text>
              <Text style={styles.tableCell}>{row.qty}</Text>
              <Text style={styles.tableCell}>£{row.unit.toLocaleString()}</Text>
              <Text style={styles.tableCell}>£{(row.unit * row.qty).toLocaleString()}</Text>
            </View>
          ))}
          <View style={[styles.tableRow, { backgroundColor: NAVY }]}>
            <Text style={[styles.tableCell, { flex: 3, textAlign: 'left', color: WHITE, fontFamily: 'Helvetica-Bold' }]}>TOTAL (VAT 0% — domestic solar)</Text>
            <Text style={styles.tableCell} />
            <Text style={styles.tableCell} />
            <Text style={[styles.tableCell, { color: GOLD, fontFamily: 'Helvetica-Bold' }]}>£{data.assumptions.systemCostPounds.toLocaleString()}</Text>
          </View>

          <Text style={[styles.disclaimer, { marginTop: 16 }]}>
            Zero-rate VAT applies to the supply and installation of solar panels on residential properties (HMRC Notice 708/6).
            This quotation is based on estimated building data and consumption figures. A site survey may adjust the final specification and price.
          </Text>
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

      {/* ── Assumptions & Disclaimer ─────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="Assumptions & Disclaimer" />

          <Text style={styles.subHeader}>Calculation Assumptions</Text>
          <DataRow label="MCS Zone" value={data.mcsZone} />
          <DataRow label="In-Plane Irradiance" value={`${Math.round(data.irradianceKwhPerM2)} kWh/m²/year`} />
          <DataRow label="Roof Pitch" value={`${data.assumptions.roofPitchDeg}°`} estimated={isEstimatedFootprint} />
          <DataRow label="Roof Orientation" value={`${data.assumptions.roofOrientationDeg}° from South`} estimated={isEstimatedFootprint} />
          <DataRow label="Shading Loss" value={`${(data.assumptions.shadingLoss * 100).toFixed(0)}%`} />
          <DataRow label="Inverter Loss" value={`${(data.assumptions.inverterLoss * 100).toFixed(0)}%`} />
          <DataRow label="System Loss" value={`${(data.assumptions.systemLoss * 100).toFixed(0)}%`} />
          <DataRow label="Annual Consumption" value={`${data.annualKwh.toLocaleString()} kWh`} estimated={isEstimatedBill} />
          <DataRow label="Consumption Source" value={
            data.billSource === 'default' ? 'UK average (no bill provided)' :
            data.billSource === 'ocr' ? 'Extracted from uploaded bill (OCR)' :
            'Entered manually'
          } />
          <DataRow label="UK Grid Carbon Factor" value="0.233 kgCO₂/kWh (DESNZ 2024)" />
          <DataRow label="Inflation Rate (savings projection)" value="4% per annum" />

          {isEstimatedBill && (
            <Text style={[styles.estimatedTag, { marginTop: 8 }]}>
              ⚠ Annual consumption defaulted to UK average (3,500 kWh) — no electricity bill was provided.
              Actual savings may differ. Upload a bill for a personalised estimate.
            </Text>
          )}

          <Text style={styles.subHeader}>Important Disclaimer</Text>
          <Text style={styles.disclaimer}>
            This proposal is based on estimated data and is intended as a guide only. Actual solar generation, savings, and payback may vary
            depending on precise roof orientation, shading, system degradation, occupant behaviour, and future energy prices.
            A physical site survey is required before a final system specification and firm quotation can be provided.
            All generation figures are calculated using the MCS Performance Estimate methodology.
            SunScan accepts no liability for any loss or damage arising from reliance on this estimate.
            This document does not constitute a contract or legally binding offer.
          </Text>
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  )
}
