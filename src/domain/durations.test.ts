import { describe, expect, it } from 'vitest'
import {
  clipDurationMs,
  describeChange,
  describeTarget,
  formatDurationLong,
  formatDurationShort,
  projectDurationMs,
  summarizeEdit,
  targetStatus,
} from './durations'
import { addClip, applyKeepSegments, createClip, createProject, setSpeed, setTargetDuration } from './project'
import { fakeMedia } from './test-helpers'

describe('duración de trozos y proyecto', () => {
  it('suma rangos, aplica velocidad y redondea', () => {
    let p = addClip(createProject(), createClip(fakeMedia({ path: 'a', durationMs: 10_000 }), 'a'))
    p = applyKeepSegments(p, 'a', [
      { startMs: 0, endMs: 1001 },
      { startMs: 2000, endMs: 3000 },
    ])
    p = setSpeed(p, 'a', 4)
    expect(clipDurationMs(p.clips[0]!)).toBe(500) // 2001 / 4 = 500.25
    p = addClip(p, createClip(fakeMedia({ path: 'b', durationMs: 3000 }), 'b'))
    p = setSpeed(p, 'b', 0.5)
    expect(projectDurationMs(p)).toBe(6500)
    expect(targetStatus(p)).toBeNull()
    p = setTargetDuration(p, 6000)
    expect(targetStatus(p)).toEqual({ targetMs: 6000, totalMs: 6500, diffMs: 500, over: true })
  })
})

describe('formato', () => {
  it('corto', () => {
    expect(formatDurationShort(0)).toBe('0 seg')
    expect(formatDurationShort(300)).toBe('menos de 1 seg')
    expect(formatDurationShort(14_000)).toBe('14 seg')
    expect(formatDurationShort(14_499)).toBe('14 seg')
    expect(formatDurationShort(59_600)).toBe('1 min')
    expect(formatDurationShort(130_000)).toBe('2 min 10 s')
    expect(formatDurationShort(120_000)).toBe('2 min')
    expect(formatDurationShort(3_900_000)).toBe('1 h 5 min')
    expect(formatDurationShort(7_200_000)).toBe('2 h')
  })

  it('largo', () => {
    expect(formatDurationLong(0)).toBe('0 segundos')
    expect(formatDurationLong(200)).toBe('menos de un segundo')
    expect(formatDurationLong(1000)).toBe('1 segundo')
    expect(formatDurationLong(60_000)).toBe('1 minuto')
    expect(formatDurationLong(130_000)).toBe('2 minutos y 10 segundos')
    expect(formatDurationLong(61_000)).toBe('1 minuto y 1 segundo')
    expect(formatDurationLong(3_903_000)).toBe('1 hora, 5 minutos y 3 segundos')
    expect(formatDurationLong(7_200_000)).toBe('2 horas')
  })

  it('frases de cambio', () => {
    expect(describeChange(130_000, 110_000)).toBe('Ahora dura 1 min 50 s (antes 2 min 10 s)')
    expect(describeChange(14_000, 14_200)).toBe('Dura 14 seg')
  })

  it('frases del objetivo', () => {
    expect(describeTarget(320_000, 300_000)).toBe('Te sobran 20 segundos')
    expect(describeTarget(265_000, 300_000)).toBe('Te quedan 35 segundos')
    expect(describeTarget(301_000, 300_000)).toBe('Te sobra 1 segundo')
    expect(describeTarget(240_000, 300_000)).toBe('Te queda 1 minuto')
    expect(describeTarget(430_000, 300_000)).toBe('Te sobran 2 minutos y 10 segundos')
    expect(describeTarget(300_200, 300_000)).toBe('Justo en el tiempo que querías')
  })

  it('resumen de una edición', () => {
    expect(
      summarizeEdit({ clipBeforeMs: 30_000, clipAfterMs: 15_000, projectBeforeMs: 320_000, projectAfterMs: 305_000, targetMs: 300_000 }),
    ).toEqual({
      clip: 'Este trozo: ahora dura 15 seg (antes 30 seg)',
      project: 'El vídeo completo: ahora dura 5 min 5 s (antes 5 min 20 s)',
      target: 'Te sobran 5 segundos',
    })
    expect(summarizeEdit({ clipBeforeMs: 1, clipAfterMs: 1, projectBeforeMs: 1, projectAfterMs: 1, targetMs: null }).target).toBeNull()
  })
})
