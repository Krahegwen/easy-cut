import { describe, expect, it } from 'vitest'
import {
  buildSilenceDetectArgs,
  buildVolumeDetectArgs,
  computeKeepSegments,
  MIN_KEPT_MS,
  parseMeanVolumeDb,
  parseSilenceDetectOutput,
  relativeNoiseDb,
  removedMs,
} from './silence'

const STDERR = `
[silencedetect @ 000001] silence_start: 3.9824
[silencedetect @ 000001] silence_end: 7.0113 | silence_duration: 3.0289
size=N/A time=00:00:12.00 bitrate=N/A speed= 500x
[silencedetect @ 000001] silence_start: 10.5
`

describe('args', () => {
  it('silencedetect con umbral y duración mínima, opcionalmente en un rango', () => {
    const a = buildSilenceDetectArgs('C:\\v\\a.mp4', { noiseDb: -30, minSilenceMs: 1000, range: { startMs: 2000, endMs: 9500 } })
    expect(a).toContain('silencedetect=noise=-30dB:d=1')
    expect(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4)).toEqual(['-ss', '2.000', '-t', '7.500'])
    expect(a.slice(-3)).toEqual(['-f', 'null', '-'])
    expect(buildSilenceDetectArgs('x')).toContain('silencedetect=noise=-35dB:d=0.5')
  })

  it('umbral relativo al volumen medio', () => {
    expect(buildVolumeDetectArgs('x')).toContain('volumedetect')
    expect(parseMeanVolumeDb('[Parsed_volumedetect_0 @ 0] mean_volume: -22.4 dB')).toBe(-22.4)
    expect(parseMeanVolumeDb('mean_volume: -inf dB')).toBeNull()
    expect(relativeNoiseDb(-20)).toBe(-38)
    expect(relativeNoiseDb(-5)).toBe(-25)
    expect(relativeNoiseDb(-60)).toBe(-50)
    expect(relativeNoiseDb(null)).toBe(-35)
  })
})

describe('parser', () => {
  it('lee pares inicio/fin y cierra el último con el final', () => {
    expect(parseSilenceDetectOutput(STDERR, 0, 12_000)).toEqual([
      { startMs: 3982, endMs: 7011 },
      { startMs: 10_500, endMs: 12_000 },
    ])
  })

  it('desplaza con el offset del rango y descarta el abierto sin final', () => {
    expect(parseSilenceDetectOutput(STDERR, 1000)).toEqual([{ startMs: 4982, endMs: 8011 }])
  })

  it('tiempos negativos al principio cuentan como 0', () => {
    expect(parseSilenceDetectOutput('silence_start: -0.01\nsilence_end: 1.2 | silence_duration: 1.21', 0)).toEqual([
      { startMs: 0, endMs: 1200 },
    ])
  })
})

describe('computeKeepSegments', () => {
  const range = { startMs: 0, endMs: 20_000 }

  it('quita la pausa dejando margen a la voz', () => {
    expect(computeKeepSegments([{ startMs: 5000, endMs: 8000 }], range, 'normal')).toEqual([
      { startMs: 0, endMs: 5150 },
      { startMs: 7850, endMs: 20_000 },
    ])
  })

  it('los niveles cambian qué pausas se quitan', () => {
    const silences = [
      { startMs: 2000, endMs: 2700 }, // 0,7 s
      { startMs: 6000, endMs: 7500 }, // 1,5 s
      { startMs: 10_000, endMs: 13_000 }, // 3 s
    ]
    expect(computeKeepSegments(silences, range, 'few')).toHaveLength(2)
    expect(computeKeepSegments(silences, range, 'normal')).toHaveLength(3)
    expect(computeKeepSegments(silences, range, 'many')).toHaveLength(4)
  })

  it('silencio al principio y al final del trozo: se quita entero sin margen hacia fuera', () => {
    expect(
      computeKeepSegments(
        [
          { startMs: 0, endMs: 3000 },
          { startMs: 17_000, endMs: 25_000 },
        ],
        range,
        'normal',
      ),
    ).toEqual([{ startMs: 2850, endMs: 17_150 }])
  })

  it('respeta el in/out del trozo', () => {
    const keep = computeKeepSegments([{ startMs: 1000, endMs: 9000 }], { startMs: 4000, endMs: 12_000 }, 'normal')
    expect(keep).toEqual([{ startMs: 8850, endMs: 12_000 }])
  })

  it('no quita huecos minúsculos (silencio justo por encima del mínimo menos el margen)', () => {
    // 0,52 s de silencio en «many» → 0,22 s quitables < 250 ms → se deja.
    expect(computeKeepSegments([{ startMs: 5000, endMs: 5520 }], range, 'many')).toEqual([range])
  })

  it('fusiona un rango conservado minúsculo (un ruido entre dos pausas) con el vecino más cercano', () => {
    const keep = computeKeepSegments(
      [
        { startMs: 4000, endMs: 8000 },
        { startMs: 8100, endMs: 9500 },
      ],
      range,
      'normal',
    )
    // Entre ambas pausas quedarían 7850→8250 (400 ms → ok) — se prueba con uno menor:
    expect(keep.every((r) => r.endMs - r.startMs >= MIN_KEPT_MS)).toBe(true)
    const tiny = computeKeepSegments(
      [
        { startMs: 4000, endMs: 8000 },
        { startMs: 8050, endMs: 12_000 },
      ],
      range,
      'normal',
    )
    expect(tiny.every((r) => r.endMs - r.startMs >= MIN_KEPT_MS)).toBe(true)
    expect(tiny[0]!.startMs).toBe(0)
    expect(tiny[tiny.length - 1]!.endMs).toBe(20_000)
  })

  it('si todo es silencio no borra el trozo', () => {
    expect(computeKeepSegments([{ startMs: 0, endMs: 20_000 }], range, 'few')).toEqual([range])
  })

  it('cuánto se quita', () => {
    const keep = computeKeepSegments([{ startMs: 5000, endMs: 8000 }], range, 'normal')
    expect(removedMs(keep, range)).toBe(2700)
  })
})
