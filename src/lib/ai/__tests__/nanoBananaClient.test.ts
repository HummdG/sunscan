import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { enhanceMany } from '@/lib/ai/nanoBananaClient'

describe('nanoBananaClient.enhanceMany — fallback paths', () => {
  let originalKey: string | undefined
  let originalFlag: string | undefined

  beforeEach(() => {
    originalKey = process.env.GEMINI_API_KEY
    originalFlag = process.env.SUNSCAN_USE_NANO_BANANA
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalKey
    if (originalFlag === undefined) delete process.env.SUNSCAN_USE_NANO_BANANA
    else process.env.SUNSCAN_USE_NANO_BANANA = originalFlag
  })

  it('returns originals with usedFallback=true when GEMINI_API_KEY is missing', async () => {
    delete process.env.GEMINI_API_KEY
    delete process.env.SUNSCAN_USE_NANO_BANANA
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const out = await enhanceMany([
      { png, label: 'front' },
      { png, label: 'satellite' },
    ])
    expect(out).toHaveLength(2)
    for (const r of out) {
      expect(r.usedFallback).toBe(true)
      expect(r.png).toBe(png)
      expect(r.reason).toContain('GEMINI_API_KEY')
    }
  })

  it('returns originals with usedFallback=true when SUNSCAN_USE_NANO_BANANA=false', async () => {
    process.env.GEMINI_API_KEY = 'fake-key-not-used'
    process.env.SUNSCAN_USE_NANO_BANANA = 'false'
    const png = Buffer.from([0xff])
    const out = await enhanceMany([{ png, label: 'topDown' }])
    expect(out[0].usedFallback).toBe(true)
    expect(out[0].png).toBe(png)
    expect(out[0].reason).toContain('SUNSCAN_USE_NANO_BANANA')
  })

  it('handles an empty input array', async () => {
    delete process.env.GEMINI_API_KEY
    const out = await enhanceMany([])
    expect(out).toEqual([])
  })
})
