import { describe, expect, it } from 'vitest'
import {
  describeTargetOption,
  formatClock,
  formatDuration,
  formatDurationChange,
  targetFraction,
  TARGET_DURATION_OPTIONS,
} from './durations'
import { describeExportTime, estimateExportTimeMs, normalizedExportFactor } from './output'
import { removedRanges } from './silence'

describe('formatos de la interfaz', () => {
  it('duración compacta', () => {
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(300)).toBe('menos de 1 s')
    expect(formatDuration(32_000)).toBe('32 s')
    expect(formatDuration(275_000)).toBe('4 min 35 s')
    expect(formatDuration(240_400)).toBe('4 min')
    expect(formatDuration(3_900_000)).toBe('1 h 5 min')
  })

  it('cambio de duración', () => {
    expect(formatDurationChange(32_000, 14_000)).toBe('32 s → 14 s')
    expect(formatDurationChange(293_000, 275_000)).toBe('4 min 53 s → 4 min 35 s')
    expect(formatDurationChange(32_000, 32_200)).toBe('32 s')
  })

  it('reloj', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(7_900)).toBe('0:07')
    expect(formatClock(275_000)).toBe('4:35')
    expect(formatClock(3_723_000)).toBe('1:02:03')
    expect(formatClock(-5)).toBe('0:00')
  })

  it('fracción del máximo y opciones', () => {
    expect(targetFraction(150_000, 300_000)).toBe(0.5)
    expect(targetFraction(330_000, 300_000)).toBeCloseTo(1.1)
    expect(targetFraction(1, 0)).toBe(0)
    expect(TARGET_DURATION_OPTIONS.map(describeTargetOption)).toEqual([
      'Sin límite',
      '1 minuto',
      '2 minutos',
      '3 minutos',
      '5 minutos',
      '10 minutos',
    ])
    expect(describeTargetOption(150_000)).toBe('2 minutos y 30 segundos')
  })
})

describe('tiempo estimado de guardado', () => {
  const spec = { width: 1280, height: 720, fps: 30 as const, preset: 'whatsapp' as const }
  it('hardware más rápido que procesador y crece con la duración', () => {
    const hw = estimateExportTimeMs(spec, 300_000, true)
    const sw = estimateExportTimeMs(spec, 300_000, false)
    expect(hw).toBeLessThan(sw)
    expect(estimateExportTimeMs(spec, 600_000, true)).toBeGreaterThan(hw)
  })
  it('el factor medido manda y se reescala por píxeles', () => {
    const factor = normalizedExportFactor(spec, 60_000, 30_000)
    expect(estimateExportTimeMs(spec, 60_000, true, factor)).toBe(32_000)
    const big = { width: 1920, height: 1080, fps: 30 as const, preset: 'high' as const }
    expect(estimateExportTimeMs(big, 60_000, true, factor)).toBeGreaterThan(32_000)
    expect(normalizedExportFactor(spec, 0, 100)).toBe(0)
  })
  it('frases', () => {
    expect(describeExportTime(20_000)).toBe('tardará menos de un minuto')
    expect(describeExportTime(70_000)).toBe('tardará alrededor de un minuto')
    expect(describeExportTime(180_000)).toBe('tardará unos 3 minutos')
    expect(describeExportTime(2 * 3_600_000)).toBe('tardará unas 2 horas')
  })
})

describe('pausas quitadas', () => {
  it('huecos entre los rangos conservados, también en los bordes', () => {
    const range = { startMs: 1000, endMs: 10_000 }
    expect(
      removedRanges(
        [
          { startMs: 1500, endMs: 3000 },
          { startMs: 4000, endMs: 9000 },
        ],
        range,
      ),
    ).toEqual([
      { startMs: 1000, endMs: 1500 },
      { startMs: 3000, endMs: 4000 },
      { startMs: 9000, endMs: 10_000 },
    ])
    expect(removedRanges([{ ...range }], range)).toEqual([])
    expect(removedRanges([], range)).toEqual([range])
  })
})
