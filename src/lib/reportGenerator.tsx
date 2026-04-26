import { renderToBuffer } from '@react-pdf/renderer'
import type { ReportData } from './types'
import { ReportDocument } from '@/components/pdf/ReportDocument'

/**
 * Generate a PDF Buffer from a ReportData object.
 * model3dImageBase64 and chartImages are pre-captured from the browser canvas.
 */
export async function generateReportPdf(
  data: ReportData,
  model3dImageBase64?: string,
  chartImages?: string[],
): Promise<Buffer> {
  const element = (
    <ReportDocument
      data={data}
      model3dImage={model3dImageBase64}
      chartImages={chartImages}
    />
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any)
  return Buffer.from(buffer)
}

/**
 * Generate a sequential quote number: SS-YYYY-NNNN
 */
export function generateQuoteNumber(count: number): string {
  const year = new Date().getFullYear()
  const seq = String(count).padStart(4, '0')
  return `SS-${year}-${seq}`
}
