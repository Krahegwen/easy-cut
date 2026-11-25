import { describe, expect, it } from 'vitest'
import {
  addClip,
  applyKeepSegments,
  clipDisplaySize,
  clipInOut,
  clipOutputMs,
  clipStartTimes,
  createClip,
  createProject,
  locateInProject,
  MIN_PIECE_MS,
  moveClip,
  normalizeSegments,
  outputToSource,
  parseProject,
  ProjectFormatError,
  removeClip,
  resetKeepSegments,
  rotateClip,
  serializeProject,
  setAspect,
  setFraming,
  setInOut,
  setMuted,
  setSpeed,
  setTargetDuration,
  sourceToOutput,
  splitClip,
  type Clip,
  type Project,
} from './project'
import { fakeMedia } from './test-helpers'

const media = fakeMedia({ path: 'C:\\Vídeos\\a.mp4', durationMs: 10_000 })

function withClip(id = 'a'): Project {
  return addClip(createProject(), createClip(media, id))
}

function clip(p: Project, i = 0): Clip {
  return p.clips[i]!
}

describe('creación', () => {
  it('un trozo nuevo tiene un único rango con el original entero', () => {
    const c = createClip(media, 'x')
    expect(c.segments).toEqual([{ startMs: 0, endMs: 10_000 }])
    expect(c.speed).toBe(1)
    expect(c.framing.mode).toBe('fit-blur')
    expect(clipOutputMs(c)).toBe(10_000)
  })

  it('genera ids distintos si no se da uno', () => {
    expect(createClip(media).id).not.toBe(createClip(media).id)
  })
})

describe('añadir, quitar y mover', () => {
  it('añade en una posición y mueve sin mutar', () => {
    let p = withClip('a')
    p = addClip(p, createClip(media, 'b'))
    p = addClip(p, createClip(media, 'c'), 0)
    expect(p.clips.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    const before = p
    const moved = moveClip(p, 'c', 2)
    expect(moved.clips.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(before.clips.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(moveClip(p, 'c', 99).clips.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(moveClip(p, 'c', 0)).toBe(p)
    expect(moveClip(p, 'nope', 1)).toBe(p)
  })

  it('quita y devuelve el mismo objeto si el id no existe', () => {
    const p = withClip('a')
    expect(removeClip(p, 'a').clips).toHaveLength(0)
    expect(removeClip(p, 'zzz')).toBe(p)
  })
})

describe('entrada y salida', () => {
  it('recorta y limita al original', () => {
    const p = setInOut(withClip(), 'a', { inMs: -500, outMs: 4000 })
    expect(clip(p).segments).toEqual([{ startMs: 0, endMs: 4000 }])
    const q = setInOut(p, 'a', { outMs: 99_999 })
    expect(clip(q).segments).toEqual([{ startMs: 0, endMs: 10_000 }])
  })

  it('no deja un trozo más corto que el mínimo ni con la salida antes de la entrada', () => {
    const p = withClip()
    expect(setInOut(p, 'a', { inMs: 5000, outMs: 5000 + MIN_PIECE_MS - 1 })).toBe(p)
    expect(setInOut(p, 'a', { inMs: 6000, outMs: 5000 })).toBe(p)
  })

  it('con varios rangos mueve el primero y el último y descarta los que quedan fuera', () => {
    let p = applyKeepSegments(withClip(), 'a', [
      { startMs: 0, endMs: 2000 },
      { startMs: 3000, endMs: 5000 },
      { startMs: 6000, endMs: 9000 },
    ])
    p = setInOut(p, 'a', { inMs: 3500 })
    expect(clip(p).segments).toEqual([
      { startMs: 3500, endMs: 5000 },
      { startMs: 6000, endMs: 9000 },
    ])
    p = setInOut(p, 'a', { inMs: 1000, outMs: 9500 })
    expect(clip(p).segments).toEqual([
      { startMs: 1000, endMs: 5000 },
      { startMs: 6000, endMs: 9500 },
    ])
    expect(clipInOut(clip(p))).toEqual({ startMs: 1000, endMs: 9500 })
  })
})

describe('conversión de tiempos', () => {
  const multi: Clip = {
    ...createClip(media, 'm'),
    segments: [
      { startMs: 1000, endMs: 3000 },
      { startMs: 5000, endMs: 6000 },
    ],
    speed: 2,
  }

  it('salida → original con varios rangos y velocidad', () => {
    expect(clipOutputMs(multi)).toBe(1500)
    expect(outputToSource(multi, 0)).toEqual({ sourceMs: 1000, segmentIndex: 0 })
    expect(outputToSource(multi, 500)).toEqual({ sourceMs: 2000, segmentIndex: 0 })
    // Frontera exacta: inicio del siguiente rango.
    expect(outputToSource(multi, 1000)).toEqual({ sourceMs: 5000, segmentIndex: 1 })
    expect(outputToSource(multi, 1500)).toEqual({ sourceMs: 6000, segmentIndex: 1 })
    expect(outputToSource(multi, 99_999)).toEqual({ sourceMs: 6000, segmentIndex: 1 })
    expect(outputToSource(multi, -10)).toEqual({ sourceMs: 1000, segmentIndex: 0 })
  })

  it('original → salida y vuelta', () => {
    expect(sourceToOutput(multi, 2000)).toBe(500)
    expect(sourceToOutput(multi, 5500)).toBe(1250)
    expect(sourceToOutput(multi, 4000)).toBeNull()
    expect(sourceToOutput(multi, 0)).toBeNull()
    for (const t of [0, 250, 999, 1001, 1400]) {
      const s = outputToSource(multi, t)
      expect(sourceToOutput(multi, s.sourceMs)).toBe(t)
    }
  })

  it('a ×0.5 la salida dura el doble', () => {
    const slow: Clip = { ...multi, speed: 0.5 }
    expect(clipOutputMs(slow)).toBe(6000)
    expect(outputToSource(slow, 4000)).toEqual({ sourceMs: 5000, segmentIndex: 1 })
  })

  it('inicio de cada trozo y localización en el proyecto', () => {
    let p = withClip('a')
    p = addClip(p, createClip(fakeMedia({ path: 'b', durationMs: 4000 }), 'b'))
    p = setSpeed(p, 'b', 2)
    expect(clipStartTimes(p)).toEqual([0, 10_000])
    expect(locateInProject(p, 10_500)).toEqual({ clipIndex: 1, clipOutputMs: 500 })
    expect(locateInProject(p, 12_000)).toEqual({ clipIndex: 1, clipOutputMs: 2000 })
    expect(locateInProject(p, 12_001)).toBeNull()
  })
})

describe('partir', () => {
  it('parte un trozo simple en dos que apuntan al mismo original', () => {
    const p = splitClip(withClip(), 'a', 4000, 'b')
    expect(p.clips.map((c) => c.id)).toEqual(['a', 'b'])
    expect(clip(p, 0).segments).toEqual([{ startMs: 0, endMs: 4000 }])
    expect(clip(p, 1).segments).toEqual([{ startMs: 4000, endMs: 10_000 }])
    expect(clip(p, 1).sourcePath).toBe(media.path)
  })

  it('en los bordes (o casi) no hace nada', () => {
    const p = withClip()
    expect(splitClip(p, 'a', 0, 'b')).toBe(p)
    expect(splitClip(p, 'a', MIN_PIECE_MS - 1, 'b')).toBe(p)
    expect(splitClip(p, 'a', 10_000, 'b')).toBe(p)
    expect(splitClip(p, 'a', 10_000 - MIN_PIECE_MS + 1, 'b')).toBe(p)
    expect(splitClip(p, 'nope', 5000, 'b')).toBe(p)
    expect(splitClip(p, 'a', MIN_PIECE_MS, 'b').clips).toHaveLength(2)
  })

  it('con varios rangos y velocidad, en mitad de un rango y en la frontera', () => {
    let p = applyKeepSegments(withClip(), 'a', [
      { startMs: 0, endMs: 2000 },
      { startMs: 3000, endMs: 5000 },
      { startMs: 6000, endMs: 9000 },
    ])
    p = setSpeed(p, 'a', 2)
    p = setMuted(p, 'a', true)
    expect(clipOutputMs(clip(p))).toBe(3500)
    // 1500 ms de salida ×2 = 3000 ms conservados → 1000 ms dentro del segundo rango.
    const mid = splitClip(p, 'a', 1500, 'b')
    expect(clip(mid, 0).segments).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 3000, endMs: 4000 },
    ])
    expect(clip(mid, 1).segments).toEqual([
      { startMs: 4000, endMs: 5000 },
      { startMs: 6000, endMs: 9000 },
    ])
    expect(clip(mid, 1).speed).toBe(2)
    expect(clip(mid, 1).muted).toBe(true)
    expect(clipOutputMs(clip(mid, 0)) + clipOutputMs(clip(mid, 1))).toBe(3500)

    // Frontera exacta entre el primer y el segundo rango (2000 conservados = 1000 de salida).
    const edge = splitClip(p, 'a', 1000, 'b')
    expect(clip(edge, 0).segments).toEqual([{ startMs: 0, endMs: 2000 }])
    expect(clip(edge, 1).segments).toEqual([
      { startMs: 3000, endMs: 5000 },
      { startMs: 6000, endMs: 9000 },
    ])
  })

  it('se puede partir tantas veces como se quiera', () => {
    let p = withClip('a')
    p = splitClip(p, 'a', 3000, 'b')
    p = splitClip(p, 'b', 3000, 'c')
    p = splitClip(p, 'c', 2000, 'd')
    expect(p.clips.map((c) => c.segments[0])).toEqual([
      { startMs: 0, endMs: 3000 },
      { startMs: 3000, endMs: 6000 },
      { startMs: 6000, endMs: 8000 },
      { startMs: 8000, endMs: 10_000 },
    ])
  })

  it('a ×0.5 con tiempos impares redondea a ms enteros', () => {
    let p = setSpeed(withClip(), 'a', 0.5)
    p = splitClip(p, 'a', 3333, 'b')
    expect(clip(p, 0).segments[0]!.endMs).toBe(1667)
    expect(Number.isInteger(clip(p, 1).segments[0]!.startMs)).toBe(true)
  })
})

describe('velocidad, sonido, giro y encuadre', () => {
  it('velocidad válida e inválida', () => {
    const p = withClip()
    expect(clip(setSpeed(p, 'a', 4)).speed).toBe(4)
    expect(setSpeed(p, 'a', 3 as never)).toBe(p)
    expect(setSpeed(p, 'a', 1)).toBe(p)
  })

  it('gira en los dos sentidos dando la vuelta', () => {
    let p = withClip()
    p = rotateClip(p, 'a', -1)
    expect(clip(p).quarterTurns).toBe(3)
    p = rotateClip(rotateClip(p, 'a'), 'a')
    expect(clip(p).quarterTurns).toBe(1)
    expect(clipDisplaySize(clip(p), media)).toEqual({ width: 1080, height: 1920 })
  })

  it('el encuadre se limita a valores válidos', () => {
    const p = setFraming(withClip(), 'a', { mode: 'fill', zoom: 9, offsetX: -3, offsetY: Number.NaN })
    expect(clip(p).framing).toEqual({ mode: 'fill', zoom: 4, offsetX: -1, offsetY: 0 })
    expect(setFraming(p, 'a', { zoom: 4 })).toBe(p)
    expect(clip(setFraming(p, 'a', { zoom: 0.2 })).framing.zoom).toBe(1)
  })

  it('forma y objetivo del proyecto', () => {
    const p = createProject()
    expect(setAspect(p, '16:9')).toBe(p)
    expect(setAspect(p, '9:16').aspect).toBe('9:16')
    expect(setTargetDuration(p, 300_000.4).targetDurationMs).toBe(300_000)
    expect(setTargetDuration(p, null)).toBe(p)
  })
})

describe('rangos conservados', () => {
  it('normaliza: ordena, fusiona solapes, recorta y quita minúsculos', () => {
    expect(
      normalizeSegments(
        [
          { startMs: 5000, endMs: 7000 },
          { startMs: -100, endMs: 1000 },
          { startMs: 900, endMs: 2000 },
          { startMs: 8000, endMs: 8010 },
          { startMs: 9500, endMs: 20_000 },
        ],
        10_000,
      ),
    ).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 5000, endMs: 7000 },
      { startMs: 9500, endMs: 10_000 },
    ])
  })

  it('aplica y deshace las pausas', () => {
    let p = applyKeepSegments(withClip(), 'a', [
      { startMs: 0, endMs: 3000 },
      { startMs: 5000, endMs: 10_000 },
    ])
    expect(clipOutputMs(clip(p))).toBe(8000)
    p = resetKeepSegments(p, 'a')
    expect(clip(p).segments).toEqual([{ startMs: 0, endMs: 10_000 }])
  })

  it('una lista vacía no deja el trozo sin nada', () => {
    const p = withClip()
    expect(applyKeepSegments(p, 'a', [])).toBe(p)
    expect(applyKeepSegments(p, 'a', [{ startMs: 1, endMs: 5 }])).toBe(p)
  })
})

describe('serialización', () => {
  it('ida y vuelta', () => {
    let p = applyKeepSegments(withClip(), 'a', [
      { startMs: 0, endMs: 3000 },
      { startMs: 5000, endMs: 10_000 },
    ])
    p = setSpeed(rotateClip(p, 'a'), 'a', 0.5)
    p = setTargetDuration(setAspect(p, '1:1'), 60_000)
    const json = serializeProject(p)
    expect(JSON.parse(json).app).toBe('easy-cut')
    expect(JSON.parse(json).version).toBe(2)
    expect(parseProject(json)).toEqual(p)
  })

  it('rechaza ficheros que no son proyectos o son de una versión futura', () => {
    expect(() => parseProject('no es json')).toThrow(ProjectFormatError)
    expect(() => parseProject('{"app":"otra"}')).toThrow(/no es un proyecto/)
    expect(() => parseProject('{"app":"easy-cut","version":99,"project":{}}')).toThrow(/más nueva/)
    expect(() => parseProject('{"app":"easy-cut","version":1,"project":{"clips":[{"id":"x"}]}}')).toThrow(/trozo 1/)
  })

  it('sanea valores raros al leer', () => {
    const json = JSON.stringify({
      app: 'easy-cut',
      version: 1,
      project: {
        aspect: '4:3',
        targetDurationMs: -5,
        clips: [
          {
            id: 'x',
            sourcePath: 'a.mp4',
            sourceDurationMs: 5000,
            segments: [{ startMs: 0, endMs: 9000 }],
            speed: 3,
            quarterTurns: 5,
            framing: { mode: 'raro', zoom: 10 },
          },
        ],
      },
    })
    const p = parseProject(json)
    expect(p.aspect).toBe('16:9')
    expect(p.targetDurationMs).toBeNull()
    expect(p.clips[0]).toMatchObject({
      segments: [{ startMs: 0, endMs: 5000 }],
      speed: 1,
      quarterTurns: 1,
      framing: { mode: 'fit-blur', zoom: 4, offsetX: 0, offsetY: 0 },
      muted: false,
    })
  })
})
