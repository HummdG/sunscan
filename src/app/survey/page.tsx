import { SurveyForm } from '@/components/SurveyForm'

export const metadata = {
  title: 'Solar Survey — SunScan',
  description: 'Get your free solar panel estimate in minutes.',
}

export default function SurveyPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <span className="text-amber-500 text-lg">☀</span>
          <span className="font-bold text-[#1E3A5F]">SunScan</span>
          <span className="text-muted-foreground text-sm ml-2">Solar Survey</span>
        </div>
      </div>
      <SurveyForm />
    </main>
  )
}
