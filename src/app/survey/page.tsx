import { SurveyForm } from '@/components/SurveyForm'

export const metadata = {
  title: 'Solar Survey — SunScan',
  description: 'Get your free solar panel estimate in minutes.',
}

export default function SurveyPage() {
  return (
    <main className="min-h-screen" style={{ background: 'linear-gradient(180deg, #FAF6EC 0%, #F4ECD6 100%)' }}>
      <div className="border-b backdrop-blur sticky top-0 z-10" style={{ background: 'rgba(250,246,236,0.85)', borderColor: 'rgba(176,64,32,0.12)' }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <span style={{ color: '#D97706' }} className="text-lg">☀</span>
          <span className="font-bold ss-heading" style={{ color: '#B04020' }}>SunScan</span>
          <span className="text-sm ml-2" style={{ color: '#8A6440' }}>Solar Survey</span>
        </div>
      </div>
      <SurveyForm />
    </main>
  )
}
