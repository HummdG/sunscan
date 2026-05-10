import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateReportPdf } from '@/lib/reportGenerator'
import { hydrateReportData } from '@/lib/reportData'

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const report = await prisma.report.findUnique({
    where: { id },
    include: { configuration: true },
  })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data = hydrateReportData(report)
  data.pdfUrl = null

  try {
    const pdfBuffer = await generateReportPdf(
      data,
      report.model3dImageUrl ?? undefined,
    )

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="SunScan-${report.quoteNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error(`PDF generation error for report ${id}:`, err)
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 })
  }
}
