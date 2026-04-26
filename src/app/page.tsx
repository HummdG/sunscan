import Link from 'next/link'
import { Sun, MapPin, FileText, BarChart3, Shield, Zap, Leaf } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const metadata = {
  title: 'SunScan — Free Solar Survey & Proposal',
  description: 'Enter your UK address, upload your electricity bill, and get a professional solar survey report in minutes.',
}

const HOW_IT_WORKS = [
  {
    step: 1,
    icon: MapPin,
    title: 'Enter your address',
    desc: 'We use Ordnance Survey building data to map your roof and calculate the optimal panel layout.',
  },
  {
    step: 2,
    icon: FileText,
    title: 'Upload your bill',
    desc: 'Upload an electricity bill or use the UK average. We extract your usage automatically using AI.',
  },
  {
    step: 3,
    icon: BarChart3,
    title: 'Get your report',
    desc: 'Receive a full solar proposal with generation estimates, savings, payback, and a PDF to download.',
  },
]

const TRUST_SIGNALS = [
  { icon: Shield, text: 'MCS-aligned calculations' },
  { icon: MapPin, text: 'Ordnance Survey building data' },
  { icon: Zap, text: 'AI-powered bill reading' },
  { icon: Leaf, text: 'CO₂ impact analysis' },
]

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <header className="border-b bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sun className="h-6 w-6 text-amber-500" />
            <span className="font-bold text-xl text-[#1E3A5F]">SunScan</span>
          </div>
          <Link href="/survey">
            <Button variant="outline" size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-[#1E3A5F] to-[#0f2340] text-white py-24 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <Badge className="bg-amber-400/20 text-amber-300 border-amber-400/30 text-sm px-4 py-1">
            Free solar survey · No commitment
          </Badge>
          <h1 className="text-5xl font-bold leading-tight">
            Get a professional solar proposal{' '}
            <span className="text-amber-400">in minutes</span>
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mx-auto">
            Enter your UK address, upload your electricity bill, and we'll generate a complete solar survey
            using MCS-aligned calculations and Ordnance Survey building data.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/survey">
              <Button size="lg" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-8 py-6 text-base gap-2">
                <Sun className="h-5 w-5" />
                Start your free survey
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Trust signals ────────────────────────────────────────────────── */}
      <section className="border-b bg-slate-50 py-6 px-6">
        <div className="max-w-4xl mx-auto flex flex-wrap justify-center gap-6">
          {TRUST_SIGNALS.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-2 text-sm text-slate-600">
              <Icon className="h-4 w-4 text-[#1E3A5F]" />
              <span>{text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-[#1E3A5F]">How it works</h2>
            <p className="text-muted-foreground mt-2">Three steps to your personalised solar proposal</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(({ step, icon: Icon, title, desc }) => (
              <Card key={step} className="relative overflow-hidden border-0 shadow-md">
                <div className="absolute top-0 left-0 w-full h-1 bg-amber-400" />
                <CardContent className="pt-8 pb-6 px-6 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center">
                      <Icon className="h-5 w-5 text-[#1E3A5F]" />
                    </div>
                    <span className="text-4xl font-bold text-slate-100">{step}</span>
                  </div>
                  <h3 className="font-semibold text-lg">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── What's in your report ────────────────────────────────────────── */}
      <section className="bg-slate-50 py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-[#1E3A5F]">What's in your report</h2>
            <p className="text-muted-foreground mt-2">A complete solar proposal — the same quality as a professional site survey</p>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {[
              '3D building model with panel layout',
              'MCS-aligned generation estimate',
              'Monthly generation profile',
              'Annual savings breakdown',
              '25-year ROI projection',
              'Payback period calculation',
              'CO₂ impact analysis',
              'Full system specifications',
              'Itemised quotation',
              'Smart Export Guarantee earnings',
              'Self-consumption analysis',
              'Downloadable PDF proposal',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 bg-white rounded-lg px-4 py-3 shadow-sm border">
                <Sun className="h-4 w-4 text-amber-500 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section className="bg-[#1E3A5F] text-white py-20 px-6 text-center">
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="text-3xl font-bold">Ready to see your solar potential?</h2>
          <p className="text-slate-300">
            Takes less than 2 minutes. No commitment. No personal details required.
          </p>
          <Link href="/survey">
            <Button size="lg" className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-8 py-6 text-base gap-2">
              <Sun className="h-5 w-5" />
              Get my free solar survey
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t bg-white py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-amber-500" />
            <span className="font-semibold text-foreground">SunScan</span>
          </div>
          <p>Solar estimates are indicative only. A site survey is required for a firm quotation.</p>
        </div>
      </footer>
    </div>
  )
}
