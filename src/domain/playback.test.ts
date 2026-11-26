import { describe, expect, it } from 'vitest'
import {
  buildPlaybackPlan,
  COVER_DRIFT_TOLERANCE_MS,
  coverNeedsResync,
  findSpanForSource,
  firstSpanOfClip,
  formatReviewRate,
  hasReachedSpanEnd,
  isReviewRate,
  locatePlayback,
  MAX_MEDIA_RATE,
  mediaRate,
  MIN_MEDIA_RATE,
  normalizeReviewRate,
  playbackTimeAt,
  REVIEW_RATES,
  reviewAdvanceMs,
  reviewNotice,
  reviewWallMs,
  spanEndToleranceMs,
} from './playback'
import { addClip, applyKeepSegments, createClip, createProject, setInOut, setSpeed } from './project'
import { projectDurationMs } from './durations'
import { fakeMedia } from './test-helpers'

function sample() {
  let p = createProject()
  p = addClip(p, createClip(fakeMedia({ path: 'a.mp4', durationMs: 10_000 }), 'a'))
  p = addClip(p, createClip(fakeMedia({ path: 'b.mp4', durationMs: 8_000 }), 'b'))
  // a: 1–3 s y 5–9 s → 6 s; b: 2–6 s a ×2 → 2 s
  p = applyKeepSegments(p, 'a', [
    { startMs: 1000, endMs: 3000 },
    { startMs: 5000, endMs: 9000 },
  ])
  p = setInOut(p, 'b', { inMs: 2000, outMs: 6000 })
  p = setSpeed(p, 'b', 2)
  return p
}

describe('plan de reproducción', () => {
  it('un tramo por rango conservado, en orden, con la duración del proyecto', () => {
    const p = sample()
    const plan = buildPlaybackPlan(p)
    expect(plan.durationMs).toBe(projectDurationMs(p))
    expect(plan.durationMs).toBe(8000)
    expect(plan.spans.map((s) => [s.clipId, s.sourceStartMs, s.sourceEndMs, s.projectStartMs, s.projectEndMs])).toEqual([
      ['a', 1000, 3000, 0, 2000],
      ['a', 5000, 9000, 2000, 6000],
      ['b', 2000, 6000, 6000, 8000],
    ])
  })

  it('proyecto vacío', () => {
    const plan = buildPlaybackPlan(createProject())
    expect(plan).toEqual({ spans: [], durationMs: 0 })
    expect(locatePlayback(plan, 100)).toBeNull()
  })

  it('tiempo del vídeo → tramo e instante del original (con velocidad)', () => {
    const plan = buildPlaybackPlan(sample())
    expect(locatePlayback(plan, 0)).toEqual({ spanIndex: 0, sourceMs: 1000 })
    expect(locatePlayback(plan, 1500)).toEqual({ spanIndex: 0, sourceMs: 2500 })
    // En la frontera, el siguiente tramo.
    expect(locatePlayback(plan, 2000)).toEqual({ spanIndex: 1, sourceMs: 5000 })
    expect(locatePlayback(plan, 6000)).toEqual({ spanIndex: 2, sourceMs: 2000 })
    expect(locatePlayback(plan, 7000)).toEqual({ spanIndex: 2, sourceMs: 4000 })
    // Al final y fuera de rango, se queda en el borde.
    expect(locatePlayback(plan, 8000)).toEqual({ spanIndex: 2, sourceMs: 6000 })
    expect(locatePlayback(plan, 99_000)).toEqual({ spanIndex: 2, sourceMs: 6000 })
    expect(locatePlayback(plan, -50)).toEqual({ spanIndex: 0, sourceMs: 1000 })
  })

  it('ida y vuelta: original → tiempo del vídeo', () => {
    const plan = buildPlaybackPlan(sample())
    for (const t of [0, 700, 1999, 2000, 3456, 5999, 6000, 7321, 8000]) {
      const pos = locatePlayback(plan, t)!
      expect(Math.abs(playbackTimeAt(plan, pos.spanIndex, pos.sourceMs) - t)).toBeLessThan(1)
    }
    // Fuera del tramo se recorta a sus bordes.
    expect(playbackTimeAt(plan, 1, 100)).toBe(2000)
    expect(playbackTimeAt(plan, 1, 99_999)).toBe(6000)
    expect(playbackTimeAt(plan, 9, 0)).toBe(0)
  })

  it('busca el tramo de un instante del original y el primero de cada trozo', () => {
    const plan = buildPlaybackPlan(sample())
    expect(findSpanForSource(plan, 0, 1500)).toBe(0)
    expect(findSpanForSource(plan, 0, 4000)).toBe(-1) // está en la pausa quitada
    expect(findSpanForSource(plan, 0, 8999)).toBe(1)
    expect(findSpanForSource(plan, 1, 2500)).toBe(2)
    expect(findSpanForSource(plan, 1, 1000)).toBe(-1)
    expect(firstSpanOfClip(plan, 1)).toBe(2)
  })

  it('fin de tramo con margen', () => {
    const span = buildPlaybackPlan(sample()).spans[0]!
    expect(hasReachedSpanEnd(span, 2900)).toBe(false)
    expect(hasReachedSpanEnd(span, 2970)).toBe(true)
    expect(hasReachedSpanEnd(span, 3100)).toBe(true)
  })

  it('fin de tramo: el margen crece con lo rápido que suena el original (un fotograma de pantalla)', () => {
    const span = buildPlaybackPlan(sample()).spans[0]! // acaba en el 3000 del original
    expect(spanEndToleranceMs()).toBe(40)
    expect(spanEndToleranceMs(2)).toBe(40)
    expect(spanEndToleranceMs(4)).toBe(68)
    expect(spanEndToleranceMs(8)).toBe(136)
    // A 8× (un trozo a 4× repasado a 2×), en el siguiente fotograma ya se habría pasado: se salta antes.
    expect(hasReachedSpanEnd(span, 2900, 8)).toBe(true)
    expect(hasReachedSpanEnd(span, 2900, 1)).toBe(false)
    expect(hasReachedSpanEnd(span, 2800, 8)).toBe(false)
  })

  it('redondeo con velocidad: el último tramo acaba donde dice clipOutputMs', () => {
    let p = createProject()
    p = addClip(p, createClip(fakeMedia({ path: 'a.mp4', durationMs: 10_000 }), 'a'))
    p = applyKeepSegments(p, 'a', [
      { startMs: 0, endMs: 1001 },
      { startMs: 2000, endMs: 3000 },
    ])
    p = setSpeed(p, 'a', 4)
    const plan = buildPlaybackPlan(p)
    expect(plan.spans[1]!.projectEndMs).toBe(500)
    expect(plan.spans[1]!.projectStartMs).toBe(250)
  })
})

describe('repasar más rápido (solo la vista previa)', () => {
  it('ofrece 1×, 1,5× y 2×; lo demás cuenta como 1×', () => {
    expect(REVIEW_RATES).toEqual([1, 1.5, 2])
    for (const r of REVIEW_RATES) expect(isReviewRate(r)).toBe(true)
    for (const bad of [0, 0.5, 3, 4, -1, Number.NaN, '2', null, undefined]) {
      expect(isReviewRate(bad)).toBe(false)
      expect(normalizeReviewRate(bad)).toBe(1)
    }
    expect(normalizeReviewRate(1.5)).toBe(1.5)
  })

  it('la velocidad del trozo se multiplica por la de repaso', () => {
    // Trozo normal, lento, rápido y muy rápido, a 1×, 1,5× y 2×.
    expect(mediaRate(1, 1)).toBe(1)
    expect(mediaRate(1, 1.5)).toBe(1.5)
    expect(mediaRate(1, 2)).toBe(2)
    expect(mediaRate(0.5, 1)).toBe(0.5)
    expect(mediaRate(0.5, 1.5)).toBe(0.75)
    expect(mediaRate(0.5, 2)).toBe(1)
    expect(mediaRate(2, 1.5)).toBe(3)
    expect(mediaRate(2, 2)).toBe(4)
    expect(mediaRate(4, 2)).toBe(8)
    // Sin factor, como siempre.
    expect(mediaRate(2)).toBe(2)
  })

  it('no se sale de lo que admite Chromium (0,0625–16) ni acepta valores raros', () => {
    expect(MIN_MEDIA_RATE).toBe(0.0625)
    expect(MAX_MEDIA_RATE).toBe(16)
    expect(mediaRate(12, 2)).toBe(16)
    expect(mediaRate(0.01, 1)).toBe(0.0625)
    expect(mediaRate(0, 2)).toBe(1)
    expect(mediaRate(Number.NaN, 2)).toBe(1)
    expect(mediaRate(Number.POSITIVE_INFINITY, 2)).toBe(1)
    // Un factor de repaso que no se ofrece no cambia nada.
    expect(mediaRate(2, 7)).toBe(2)
  })

  it('el reloj del montaje avanza al ritmo del repaso', () => {
    expect(reviewAdvanceMs(1000, 1)).toBe(1000)
    expect(reviewAdvanceMs(1000, 1.5)).toBe(1500)
    expect(reviewAdvanceMs(1000, 2)).toBe(2000)
    expect(reviewAdvanceMs(-50, 2)).toBe(0)
    // Un vídeo de 60 s se repasa en 40 s a 1,5× y en 30 s a 2×.
    expect(reviewWallMs(60_000, 1.5)).toBe(40_000)
    expect(reviewWallMs(60_000, 2)).toBe(30_000)
    expect(reviewWallMs(60_000, 1)).toBe(60_000)
    for (const r of REVIEW_RATES) expect(reviewWallMs(reviewAdvanceMs(1234, r), r)).toBeCloseTo(1234, 6)
  })

  it('lo de encima y las pistas (a velocidad normal en el montaje) siguen al reloj: su deriva se mide igual', () => {
    // Un sonido que empieza en el 0 del montaje: tras 1 s de pared a 2×, el montaje va por el 2000 y el sonido,
    // que suena a mediaRate(1, 2) = 2, también ha avanzado 2000 ms de su original.
    const wall = 1000
    for (const r of REVIEW_RATES) {
      const montage = reviewAdvanceMs(wall, r)
      const soundSource = wall * mediaRate(1, r)
      expect(soundSource).toBe(montage)
      expect(coverNeedsResync(soundSource, montage)).toBe(false)
    }
    expect(COVER_DRIFT_TOLERANCE_MS).toBe(150)
  })

  it('texto del factor y aviso visible mientras se repasa', () => {
    expect(formatReviewRate(1)).toBe('1×')
    expect(formatReviewRate(1.5)).toBe('1,5×')
    expect(formatReviewRate(2)).toBe('2×')
    expect(reviewNotice(1)).toBeNull()
    expect(reviewNotice(1.5)).toBe('Repasando a 1,5× · el vídeo guardado no cambia')
    expect(reviewNotice(2)).toBe('Repasando a 2× · el vídeo guardado no cambia')
    expect(reviewNotice(3)).toBeNull()
  })
})
