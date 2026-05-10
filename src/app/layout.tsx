import type { Metadata } from 'next'
import { Fraunces, Outfit, Space_Mono } from 'next/font/google'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

// Fraunces: warm humanist serif with optical sizing — pairs naturally with cream/parchment.
// Axes require the variable font; weight is read from font-variation-settings instead.
const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  weight: 'variable',
  axes: ['SOFT', 'opsz'],
  display: 'swap',
})

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
})

const spaceMono = Space_Mono({
  variable: '--font-space-mono',
  subsets: ['latin'],
  weight: ['400', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'SunScan · From postcode to MCS-aligned spec in 60 seconds',
  description: 'Engineering-grade solar surveys for UK installers. UPRN-locked roof detection, MCS-aligned generation forecasts, export-ready reports.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${outfit.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground" style={{ fontFamily: 'var(--font-outfit, ui-sans-serif), sans-serif' }}>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  )
}
