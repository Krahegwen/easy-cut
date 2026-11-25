import { describe, expect, it } from 'vitest'
import {
  buildPlaybackPlan,
  findSpanForSource,
  firstSpanOfClip,
  hasReachedSpanEnd,
  locatePlayback,
  playbackTimeAt,
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
