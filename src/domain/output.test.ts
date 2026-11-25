import { describe, expect, it } from 'vitest'
import {
  computeOutputSpec,
  describeFileSize,
  estimateFileSizeBytes,
  estimateProjectSizeBytes,
  formatBytes,
  outputFps,
  outputShortSide,
} from './output'
import { addClip, createClip, createProject, setAspect, type MediaInfo, type Project } from './project'
import { fakeMedia } from './test-helpers'

function projectWith(mediaList: MediaInfo[], aspect: Project['aspect'] = '16:9') {
  let p = setAspect(createProject(), aspect)
  mediaList.forEach((m, i) => (p = addClip(p, createClip(m, `c${i}`))))
  const map = new Map(mediaList.map((m) => [m.path, m]))
  return { p, map }
}

const hd30 = fakeMedia({ path: 'hd30' })
const vertical60 = fakeMedia({ path: 'v60', width: 1080, height: 1920, fps: 60 })
const uhd = fakeMedia({ path: 'uhd', width: 3840, height: 2160 })
const uhd60 = fakeMedia({ path: 'uhd60', width: 3840, height: 2160, fps: 59.94 })
const small = fakeMedia({ path: 'small', width: 640, height: 360 })

describe('tamaño de salida', () => {
  it('whatsapp: 720 de lado corto en las tres formas', () => {
    for (const [aspect, size] of [
      ['16:9', [1280, 720]],
      ['9:16', [720, 1280]],
      ['1:1', [720, 720]],
    ] as const) {
      const { p, map } = projectWith([hd30], aspect)
      const s = computeOutputSpec(p, map, 'whatsapp')
      expect([s.width, s.height]).toEqual(size)
      expect(s.fps).toBe(30)
      expect(s.audioBitrateKbps).toBe(128)
      expect(s.videoBitrateKbps).toBe(2500)
    }
  })

  it('youtube: 1080 salvo que TODOS sean 4K', () => {
    expect(outputShortSide('youtube', [uhd, hd30])).toBe(1080)
    expect(outputShortSide('youtube', [uhd, uhd60])).toBe(2160)
    const { p, map } = projectWith([uhd, uhd60])
    const s = computeOutputSpec(p, map, 'youtube')
    expect([s.width, s.height]).toEqual([3840, 2160])
  })

  it('high: hasta el mejor original, tope 2160', () => {
    expect(outputShortSide('high', [hd30, uhd])).toBe(2160)
    expect(outputShortSide('high', [hd30, small])).toBe(1080)
  })

  it('nunca amplía por encima del original más grande y da dimensiones pares', () => {
    const odd = fakeMedia({ path: 'odd', width: 853, height: 479 })
    const { p, map } = projectWith([odd])
    for (const preset of ['whatsapp', 'youtube', 'high'] as const) {
      const s = computeOutputSpec(p, map, preset)
      expect(s.height).toBeLessThanOrEqual(480)
      expect(s.width % 2).toBe(0)
      expect(s.height % 2).toBe(0)
    }
    const { p: p2, map: m2 } = projectWith([small])
    expect(computeOutputSpec(p2, m2, 'youtube')).toMatchObject({ width: 640, height: 360 })
  })

  it('vertical dentro de horizontal: cuenta el lado corto', () => {
    const { p, map } = projectWith([vertical60], '16:9')
    expect(computeOutputSpec(p, map, 'youtube')).toMatchObject({ width: 1920, height: 1080 })
  })

  it('fps: 60 solo si la mayoría es ≥ 50; whatsapp siempre 30', () => {
    expect(outputFps('youtube', [vertical60, uhd60, hd30])).toBe(60)
    expect(outputFps('youtube', [vertical60, hd30])).toBe(30)
    expect(outputFps('whatsapp', [vertical60, uhd60])).toBe(30)
    expect(outputFps('high', [])).toBe(30)
  })

  it('bitrates recomendados por YouTube', () => {
    const at = (m: MediaInfo[]) => {
      const { p, map } = projectWith(m)
      return computeOutputSpec(p, map, 'youtube').videoBitrateKbps
    }
    expect(at([hd30])).toBe(8000)
    expect(at([vertical60, vertical60])).toBe(12_000)
    expect(at([uhd])).toBe(40_000)
    expect(at([uhd60])).toBe(60_000)
    const { p, map } = projectWith([hd30])
    expect(computeOutputSpec(p, map, 'youtube').audioBitrateKbps).toBe(384)
  })

  it('falla con un original sin información', () => {
    const { p } = projectWith([hd30])
    expect(() => computeOutputSpec(p, new Map(), 'youtube')).toThrow(/Falta la información/)
  })
})

describe('peso del fichero', () => {
  it('bitrate × duración', () => {
    const { p, map } = projectWith([hd30])
    const spec = computeOutputSpec(p, map, 'whatsapp')
    // (2500 + 128) kbps × 60 s = 19,71 MB (+1 %)
    expect(estimateFileSizeBytes(spec, 60_000)).toBe(Math.round(((2628 * 1000) / 8) * 60 * 1.01))
    expect(estimateProjectSizeBytes(p, map, 'whatsapp')).toBe(estimateFileSizeBytes(spec, 10_000))
  })

  it('texto llano', () => {
    expect(formatBytes(500_000)).toBe('menos de 1 MB')
    expect(formatBytes(12_400_000)).toBe('12 MB')
    expect(formatBytes(1_340_000_000)).toBe('1,3 GB')
    expect(describeFileSize(12_000_000)).toMatchObject({ category: 'small', text: 'Pequeño (unos 12 MB)' })
    expect(describeFileSize(120_000_000).text).toBe('Mediano (unos 120 MB)')
    expect(describeFileSize(2_000_000_000).text).toBe('Grande (unos 2,0 GB)')
  })
})
