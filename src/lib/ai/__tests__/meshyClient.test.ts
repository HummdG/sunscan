import { describe, it, expect } from 'vitest'
import { buildTexturePrompt } from '@/lib/ai/meshyClient'

const dims = { widthM: 9.2, depthM: 6.8, eaveHeightM: 5.8, ridgeHeightM: 8.4 }

describe('buildTexturePrompt', () => {
  it('produces a deterministic prompt for the same segments', () => {
    const segments = [
      { pitchDeg: 35, azimuthDeg: 180, areaM2: 28 },
      { pitchDeg: 35, azimuthDeg: 0, areaM2: 28 },
    ]
    const a = buildTexturePrompt(segments, dims)
    const b = buildTexturePrompt(segments, dims)
    expect(a).toBe(b)
  })

  it('mentions every passed segment when there are 4 or fewer', () => {
    const segments = [
      { pitchDeg: 30, azimuthDeg: 90, areaM2: 14 },
      { pitchDeg: 40, azimuthDeg: 270, areaM2: 12 },
    ]
    const prompt = buildTexturePrompt(segments, dims)
    expect(prompt).toContain('seg1')
    expect(prompt).toContain('seg2')
    expect(prompt).toContain('30 deg')
    expect(prompt).toContain('40 deg')
  })

  it('caps segment enumeration at 8', () => {
    const segments = Array.from({ length: 12 }, (_, i) => ({
      pitchDeg: 30,
      azimuthDeg: i * 30,
      areaM2: 10,
    }))
    const prompt = buildTexturePrompt(segments, dims)
    expect(prompt).toContain('seg8')
    expect(prompt).not.toContain('seg9')
  })

  it('still produces a valid prompt with no segments', () => {
    const prompt = buildTexturePrompt([], dims)
    expect(prompt).toContain('UK single-family house')
    expect(prompt).toContain('Footprint')
    expect(prompt).not.toContain('seg1')
  })

  it('includes footprint dimensions and eave/ridge heights', () => {
    const prompt = buildTexturePrompt([], dims)
    expect(prompt).toContain('9.2m by 6.8m')
    expect(prompt).toContain('eaves 5.8m')
    expect(prompt).toContain('ridge 8.4m')
  })
})
