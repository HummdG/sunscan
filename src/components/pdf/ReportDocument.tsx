import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
  Svg,
  Polygon,
  Circle,
  Line,
} from '@react-pdf/renderer'
import type { ReportData } from '@/lib/types'
import {
  PdfMonthlyGenChart,
  PdfSelfConsumptionDonut,
  PdfCumulativeSavingsChart,
  PdfBillSavingsChart,
} from './PdfCharts'
import { lineItemsToRows, formatGbp } from './quotationTable'

// ─── Styles ───────────────────────────────────────────────────────────────────
// Sun-bleached cream palette — matches the web design system (--ss-* tokens).
// Existing constant names kept (NAVY/GOLD/GREEN/LIGHT/MUTED/WHITE) to minimise
// the diff against the rest of this file; their values now point at the
// terracotta brand palette.

const NAVY   = '#B04020' // primary brand (was navy)        — ss-blue (terracotta)
const GOLD   = '#D97706' // deep amber accent (was gold)     — ss-amber
const GREEN  = '#5A7842' // olive (was emerald)              — ss-green
const LIGHT  = '#F4ECD6' // cream surface (was cool light)   — ss-s1
const MUTED  = '#8A6440' // warm tertiary text (was slate)   — ss-t3
const WHITE  = '#FFFFFF' // kept — text on terracotta cover
const INK    = '#FAF6EC' // page parchment background        — ss-ink
const T1     = '#2A1810' // primary near-black w/ warmth     — ss-t1
const T2     = '#5C3A24' // coffee body                      — ss-t2
const T4     = '#B19068' // sun-faded ochre                  — ss-t4
const BORDER = '#DECB99' // warm divider                     — ss-s3

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    backgroundColor: WHITE,
    padding: 0,
  },
  coverPage: {
    backgroundColor: WHITE,
    flexDirection: 'column',
    paddingTop: 44,
    paddingBottom: 44,
    paddingHorizontal: 56,
    height: '100%',
    position: 'relative',
  },
  coverWordmark: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: T1,
    letterSpacing: 2.4,
  },
  coverWordmarkAccent: {
    color: NAVY,
  },
  coverEyebrow: {
    fontSize: 8,
    color: MUTED,
    letterSpacing: 2,
    fontFamily: 'Helvetica-Bold',
  },
  coverSerifLine: {
    fontFamily: 'Times-Roman',
    color: T1,
    fontSize: 64,
    lineHeight: 0.98,
    letterSpacing: -1,
  },
  coverSerifAccent: {
    fontFamily: 'Times-Italic',
    color: NAVY,
    fontSize: 64,
    lineHeight: 0.98,
    letterSpacing: -1,
  },
  coverAmberRule: {
    width: 84,
    height: 3,
    backgroundColor: GOLD,
  },
  coverPreparedFor: {
    fontSize: 8,
    color: MUTED,
    letterSpacing: 2,
    fontFamily: 'Helvetica-Bold',
  },
  coverAddress: {
    fontSize: 19,
    fontFamily: 'Helvetica-Bold',
    color: T1,
    lineHeight: 1.25,
  },
  coverMetaLabel: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1.8,
    fontFamily: 'Helvetica-Bold',
    width: 64,
  },
  coverMetaValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: T1,
  },
  coverFooter: {
    fontSize: 7,
    color: T4,
    letterSpacing: 2.2,
    textAlign: 'center',
  },
  coverHairline: {
    height: 1,
    backgroundColor: BORDER,
  },
  coverSideStripe: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 6,
    backgroundColor: NAVY,
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
    color: T2,
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
    color: T1,
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
    borderBottomColor: BORDER,
  },
  tableRowAlt: {
    flexDirection: 'row',
    padding: 6,
    backgroundColor: LIGHT,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tableCell: {
    fontSize: 9,
    color: T2,
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

// ─── Brand mark — SunScan hexagon with sun glyph (PDF SVG) ───────────────────

function SunscanMark({ size = 34 }: { size?: number }) {
  // Hexagon (flat-top) inscribed in a 36×36 viewBox. Sun body + 8 rays in cream.
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      <Polygon points="18,1 35,10 35,26 18,35 1,26 1,10" fill={NAVY} />
      <Circle cx="18" cy="18" r="5.4" fill={INK} />
      {/* Cardinal rays */}
      <Line x1="18" y1="9.6" x2="18" y2="6.2" stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
      <Line x1="18" y1="26.4" x2="18" y2="29.8" stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
      <Line x1="9.6" y1="18" x2="6.2" y2="18" stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
      <Line x1="26.4" y1="18" x2="29.8" y2="18" stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
      {/* Ordinal rays */}
      <Line x1="12" y1="12" x2="9.4" y2="9.4" stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
      <Line x1="24" y1="12" x2="26.6" y2="9.4" stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
      <Line x1="12" y1="24" x2="9.4" y2="26.6" stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
      <Line x1="24" y1="24" x2="26.6" y2="26.6" stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  )
}

// ─── Engineering corner brackets — absolute-positioned around a Page ─────────

function CornerBrackets({
  size = 14,
  thickness = 1.6,
  color = NAVY,
  inset = 20,
}: { size?: number; thickness?: number; color?: string; inset?: number }) {
  const common = { width: size, height: size, position: 'absolute' as const }
  return (
    <>
      <View style={{ ...common, top: inset, left: inset, borderTopWidth: thickness, borderLeftWidth: thickness, borderTopColor: color, borderLeftColor: color }} />
      <View style={{ ...common, top: inset, right: inset, borderTopWidth: thickness, borderRightWidth: thickness, borderTopColor: color, borderRightColor: color }} />
      <View style={{ ...common, bottom: inset, left: inset, borderBottomWidth: thickness, borderLeftWidth: thickness, borderBottomColor: color, borderLeftColor: color }} />
      <View style={{ ...common, bottom: inset, right: inset, borderBottomWidth: thickness, borderRightWidth: thickness, borderBottomColor: color, borderRightColor: color }} />
    </>
  )
}

// ─── Cover metadata row (engineering title-block style) ──────────────────────

function CoverMetaRow({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
      <Text style={styles.coverMetaLabel}>{k}</Text>
      <Text style={accent ? [styles.coverMetaValue, { color: accent }] : styles.coverMetaValue}>{v}</Text>
    </View>
  )
}

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

// ─── Per-field provenance footnote ───────────────────────────────────────────
// Renders a tiny grey caption under the headline stats explaining where each
// number came from. Replaces the old blanket "estimate only" disclaimer.

function provenanceLine(data: ReportData): string {
  const dc = data.dataConfidence
  const roofSource = dc?.roof === 'os-confirmed'
    ? (data.footprintSource === 'google_solar' ? 'Google Solar imagery' : 'Ordnance Survey NGD')
    : dc?.roof === 'user-confirmed'
      ? 'Confirmed by you'
      : (data.footprintSource === 'google_solar' ? 'Google Solar imagery' :
         data.footprintSource === 'os_ngd' ? 'Ordnance Survey NGD' :
         'Not recorded')
  const consumptionSource = dc?.consumption === 'ocr-confirmed'
    ? 'Extracted from your bill'
    : dc?.consumption === 'manual-confirmed'
      ? 'Entered by you'
      : (data.billSource === 'ocr' ? 'Extracted from your bill' :
         data.billSource === 'manual' ? 'Entered by you' :
         'Not recorded')
  return `Roof: ${roofSource}. Consumption: ${consumptionSource}.`
}

function ProvenanceFootnote({ data }: { data: ReportData }) {
  return (
    <Text style={{ fontSize: 7, color: MUTED, marginTop: 6, fontStyle: 'italic' }}>
      {provenanceLine(data)}
    </Text>
  )
}

// ─── Main document ─────────────────────────────────────────────────────────────

interface ReportDocumentProps {
  data: ReportData
  model3dImage?: string
}

export function ReportDocument({ data, model3dImage }: ReportDocumentProps) {
  // Legacy reports may carry billSource: 'default' — hydrateReportData normalises
  // to 'manual', so the only remaining "estimated" surface is the footprint source.
  const isEstimatedBill = false
  const isEstimatedFootprint = data.footprintSource === 'estimated'
  const annualBillBefore = (data.annualKwh * data.tariffPencePerKwh) / 100 + (data.standingChargePencePerDay * 365) / 100
  const annualBillAfter = annualBillBefore - data.results.annualSavingsPounds

  return (
    <Document
      title={`SunScan Solar Proposal · ${data.addressRaw}`}
      author="SunScan"
      subject="Solar PV Proposal"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.coverPage}>
          {/* Left edge brand register stripe */}
          <View style={styles.coverSideStripe} />

          {/* Engineering corner brackets */}
          <CornerBrackets size={16} thickness={1.6} color={NAVY} inset={28} />

          {/* ─── Top band: hex logo + wordmark · doc reference ─────────────── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <SunscanMark size={36} />
              <View style={{ marginLeft: 10 }}>
                <Text style={styles.coverWordmark}>
                  SUN<Text style={styles.coverWordmarkAccent}>SCAN</Text>
                </Text>
                <Text style={[styles.coverEyebrow, { marginTop: 3 }]}>
                  SOLAR · ENGINEERING-GRADE
                </Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.coverEyebrow}>DOC · {data.quoteNumber}</Text>
              <Text style={[styles.coverEyebrow, { marginTop: 3, color: T4 }]}>
                REV · 01 / MCS-2024
              </Text>
            </View>
          </View>

          {/* Top divider */}
          <View style={[styles.coverHairline, { marginTop: 16 }]} />

          {/* ─── Main editorial title block ─────────────────────────────────── */}
          <View style={{ flex: 1, justifyContent: 'center', paddingTop: 28, paddingBottom: 16 }}>
            <Text style={styles.coverSerifLine}>Solar Survey</Text>
            <Text style={styles.coverSerifAccent}>& Proposal.</Text>

            <View style={[styles.coverAmberRule, { marginTop: 30, marginBottom: 26 }]} />

            <Text style={[styles.coverPreparedFor, { marginBottom: 10 }]}>PREPARED FOR</Text>
            <Text style={styles.coverAddress}>{data.addressRaw}</Text>
          </View>

          {/* Bottom hairline */}
          <View style={styles.coverHairline} />

          {/* ─── Bottom title block: metadata grid ──────────────────────────── */}
          <View style={{ paddingTop: 18, paddingBottom: 8 }}>
            <CoverMetaRow k="QUOTE" v={data.quoteNumber} />
            <CoverMetaRow
              k="DATE"
              v={new Date(data.createdAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            />
            <CoverMetaRow k="VALID" v="30 days from issue" />
          </View>

          {/* Bottom footer */}
          <View style={{ paddingTop: 10 }}>
            <Text style={styles.coverFooter}>
              SUNSCAN  ·  WWW.SUNSCAN.CO.UK  ·  MCS-ALIGNED SOLAR ENGINEERING
            </Text>
          </View>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="Recommended Solar System" />
          <View style={styles.statsRow}>
            <StatCard value={`${data.systemSizeKw.toFixed(2)} kWp`} label="System Size" />
            <StatCard value={String(data.panelCount)} label="Solar Panels" />
            <StatCard value={`${data.results.annualGenerationKwh.toLocaleString()} kWh`} label="Annual Generation" />
          </View>
          <View style={styles.statsRow}>
            <StatCard value={`£${data.results.annualSavingsPounds.toLocaleString()}`} label="Annual Savings" color={GREEN} />
            <StatCard value={`${data.results.paybackYears} yrs`} label="Payback Period" />
            <StatCard value={`${data.results.co2SavedTonnesPerYear} t`} label="CO₂ Saved/Year" color={GREEN} />
          </View>
          <ProvenanceFootnote data={data} />

          {model3dImage && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.subHeader}>3D Visualisation</Text>
              <Image src={model3dImage} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 6 }} />
              {isEstimatedFootprint && (
                <Text style={{ fontSize: 7, color: MUTED, marginTop: 6, fontStyle: 'italic' }}>
                  Building outline reconstructed from address coordinates. Exact panel placement confirmed at site survey.
                </Text>
              )}
            </View>
          )}
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="System Components" />

          <Text style={styles.subHeader}>Solar Panels · {data.panelCount}×</Text>
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
            {data.results.co2SavedTonnesPerYear} tonnes of CO₂ per year, equivalent to planting around{' '}
            {Math.round(data.results.co2SavedTonnesPerYear * 45)} trees.
          </Text>
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

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
          {data.quote ? (
            <>
              {lineItemsToRows(data.quote).map((row, i) => {
                if (row.kind === 'category-header') {
                  return (
                    <View key={i} style={[styles.tableRow, { backgroundColor: LIGHT }]}>
                      <Text
                        style={[
                          styles.tableCell,
                          { flex: 3, textAlign: 'left', color: T1, fontFamily: 'Helvetica-Bold' },
                        ]}
                      >
                        {row.label}
                      </Text>
                      <Text style={styles.tableCell} />
                      <Text style={styles.tableCell} />
                      <Text style={styles.tableCell} />
                    </View>
                  )
                }
                return (
                  <View key={i} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                    <Text style={[styles.tableCell, { flex: 3, textAlign: 'left' }]}>
                      {row.label}
                    </Text>
                    <Text style={styles.tableCell}>{row.qty}</Text>
                    <Text style={styles.tableCell}>{row.unit}</Text>
                    <Text style={styles.tableCell}>{row.total}</Text>
                  </View>
                )
              })}
              <View style={[styles.tableRow, { backgroundColor: NAVY }]}>
                <Text
                  style={[
                    styles.tableCell,
                    { flex: 3, textAlign: 'left', color: WHITE, fontFamily: 'Helvetica-Bold' },
                  ]}
                >
                  TOTAL (VAT {data.quote.vatRatePercent}% · domestic solar)
                </Text>
                <Text style={styles.tableCell} />
                <Text style={styles.tableCell} />
                <Text style={[styles.tableCell, { color: WHITE, fontFamily: 'Helvetica-Bold' }]}>
                  {formatGbp(data.quote.totalPounds)}
                </Text>
              </View>
            </>
          ) : (
            <>
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
                <Text style={[styles.tableCell, { flex: 3, textAlign: 'left', color: WHITE, fontFamily: 'Helvetica-Bold' }]}>TOTAL (VAT 0% · domestic solar)</Text>
                <Text style={styles.tableCell} />
                <Text style={styles.tableCell} />
                <Text style={[styles.tableCell, { color: WHITE, fontFamily: 'Helvetica-Bold' }]}>£{data.assumptions.systemCostPounds.toLocaleString()}</Text>
              </View>
            </>
          )}

          <Text style={[styles.disclaimer, { marginTop: 16 }]}>
            Zero-rate VAT applies to the supply and installation of solar panels on residential properties (HMRC Notice 708/6).
            Final specification, mounting, and cabling are confirmed at site survey before installation.
          </Text>
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>

      <Page size="A4" style={styles.page}>
        <View style={styles.sectionPage}>
          <PageHeader title="Assumptions" />

          <Text style={styles.subHeader}>Site &amp; Roof Inputs</Text>
          <DataRow label="MCS Zone" value={data.mcsZone} />
          <DataRow label="In-Plane Irradiance" value={`${Math.round(data.irradianceKwhPerM2)} kWh/m²/year`} />
          <DataRow label="Roof Pitch" value={`${Math.round(data.assumptions.roofPitchDeg)}°`} />
          <DataRow label="Roof Orientation" value={`${Math.round(data.assumptions.roofOrientationDeg)}° from South`} />
          <DataRow label="Roof Source" value={
            data.dataConfidence?.roof === 'os-confirmed'
              ? (data.footprintSource === 'google_solar' ? 'Google Solar imagery' : 'Ordnance Survey NGD')
              : data.dataConfidence?.roof === 'user-confirmed'
                ? 'Confirmed by you'
                : (data.footprintSource === 'google_solar' ? 'Google Solar imagery' :
                   data.footprintSource === 'os_ngd' ? 'Ordnance Survey NGD' :
                   'Not recorded')
          } />

          <Text style={styles.subHeader}>Energy Inputs</Text>
          <DataRow label="Annual Consumption" value={`${data.annualKwh.toLocaleString()} kWh`} />
          <DataRow label="Unit Rate" value={`${data.tariffPencePerKwh.toFixed(1)}p / kWh`} />
          <DataRow label="SEG Export Rate" value={`${data.exportTariffPencePerKwh.toFixed(1)}p / kWh`} />
          <DataRow label="Consumption Source" value={
            data.dataConfidence?.consumption === 'ocr-confirmed' ? 'Extracted from your bill, confirmed by you' :
            data.dataConfidence?.consumption === 'manual-confirmed' ? 'Entered and confirmed by you' :
            data.billSource === 'ocr' ? 'Extracted from your bill' :
            'Entered manually'
          } />

          <Text style={styles.subHeader}>Modelling Assumptions</Text>
          <DataRow label="Shading Loss" value={`${(data.assumptions.shadingLoss * 100).toFixed(0)}%`} />
          <DataRow label="Inverter Loss" value={`${(data.assumptions.inverterLoss * 100).toFixed(0)}%`} />
          <DataRow label="System Loss" value={`${(data.assumptions.systemLoss * 100).toFixed(0)}%`} />
          <DataRow label="Performance Ratio" value={`${(((1 - data.assumptions.shadingLoss) * (1 - data.assumptions.inverterLoss) * (1 - data.assumptions.systemLoss)) * 100).toFixed(1)}% (MCS)`} />
          <DataRow label="Panel Degradation" value={`${((data.assumptions.panelDegradationPerYear ?? 0.005) * 100).toFixed(1)}% / year`} />
          <DataRow label="Energy Price Inflation" value={`${((data.assumptions.energyInflationRate ?? 0.03) * 100).toFixed(1)}% / year`} />
          <DataRow label="UK Grid Carbon Factor" value="0.233 kgCO₂/kWh (DESNZ 2024)" />

          <Text style={[styles.disclaimer, { marginTop: 12 }]}>
            Generation figures are calculated using the MCS Performance Estimate methodology. Final
            specification, mounting and cabling are confirmed at site survey. Savings depend on
            future energy prices, household occupancy patterns and panel performance over time.
          </Text>
        </View>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  )
}
