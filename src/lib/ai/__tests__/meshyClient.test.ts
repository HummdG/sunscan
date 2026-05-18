import { describe, it, expect } from 'vitest'
import { buildTexturePrompt } from '@/lib/ai/meshyClient'

const dims = { widthM: 9.2, depthM: 6.8, eaveHeightM: 5.8, ridgeHeightM: 8.4 }

describe('buildTexturePrompt', () => {
  it('is deterministic regardless of segments or dims', () => {
    const a = buildTexturePrompt(
      [{ pitchDeg: 35, azimuthDeg: 180, areaM2: 28 }],
      dims,
    )
    const b = buildTexturePrompt(
      [{ pitchDeg: 12, azimuthDeg: 0, areaM2: 99 }],
      { widthM: 1, depthM: 1, eaveHeightM: 1, ridgeHeightM: 1 },
    )
    const c = buildTexturePrompt([], { widthM: 0, depthM: 0, eaveHeightM: 0, ridgeHeightM: 0 })
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it('asks Meshy to reproduce the input photo faithfully', () => {
    const prompt = buildTexturePrompt([], dims)
    expect(prompt.toLowerCase()).toContain('reproduce')
    expect(prompt.toLowerCase()).toContain('input photo')
  })

  it('does not leak CAD-style metadata (segments, footprint, eaves, ridge)', () => {
    const segments = [
      { pitchDeg: 35, azimuthDeg: 180, areaM2: 28 },
      { pitchDeg: 40, azimuthDeg: 90, areaM2: 14 },
    ]
    const prompt = buildTexturePrompt(segments, dims)
    expect(prompt).not.toMatch(/seg\d/)
    expect(prompt).not.toMatch(/pitch\s*\d/i)
    expect(prompt).not.toMatch(/azimuth/i)
    expect(prompt).not.toMatch(/footprint/i)
    expect(prompt).not.toMatch(/eaves?\s*\d/i)
    expect(prompt).not.toMatch(/ridge\s*\d/i)
    expect(prompt).not.toMatch(/sqm|m2/i)
  })

  it('is ASCII only (no characters that trip Meshy text pipeline)', () => {
    const prompt = buildTexturePrompt([], dims)
    // eslint-disable-next-line no-control-regex
    expect(prompt).toMatch(/^[\x00-\x7F]*$/)
  })
})
