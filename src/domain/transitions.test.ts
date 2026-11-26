import { describe, expect, it } from 'vitest'
import { projectDurationMs } from './durations'
import {
  addClip,
  anchorAt,
  applyKeepSegments,
  clipStartTimes,
  clipTimeline,
  createClip,
  createProject,
  duplicateClip,
  inSharedJoin,
  insertClipAfter,
  locateInProject,
  moveClip,
  parseProject,
  removeClip,
  serializeProject,
  setInOut,
  setTransition,
  splitClip,
  trimClip,
  type Project,
} from './project'
import { fakeMedia } from './test-helpers'
import { createItem, createTrack, addTrack, insertItem, resolveTracks } from './tracks'
import {
  describeEntry,
  edgeFades,
  joinStyleAt,
  kindsFor,
  makeEntry,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  overlapStyleAt,
  parseEntry,
  resolveJoins,
  ZOOM_MAX_SCALE,
} from './transitions'

// Tres trozos de 10 s.
function base(): Project {
  let p = createProject()
  for (const id of ['a', 'b', 'c']) p = addClip(p, createClip(fakeMedia({ path: `${id}.mp4`, durationMs: 10_000 }), id))
  return p
}

const fade1s = makeEntry('dissolve', 1000)

describe('entradas', () => {
  it('sin solape solo valen a negro y a blanco', () => {
    expect(kindsFor(false)).toEqual(['dip-black', 'dip-white'])
    expect(kindsFor(true)).toHaveLength(6)
    expect(makeEntry('push', 1000, false).overlap).toBe(true)
    expect(makeEntry('dip-black', 1000).overlap).toBe(false)
    expect(makeEntry('dip-white', 1000, true).overlap).toBe(true)
  })

  it('la duración se queda entre los límites', () => {
    expect(makeEntry('dissolve', 50).durationMs).toBe(MIN_TRANSITION_MS)
    expect(makeEntry('dissolve', 9000).durationMs).toBe(MAX_TRANSITION_MS)
  })

  it('lo que no se entiende es un corte seco', () => {
    expect(parseEntry(null)).toBeNull()
    expect(parseEntry({ kind: 'wipe', durationMs: 1000 })).toBeNull()
    expect(parseEntry({ kind: 'dissolve' })).toBeNull()
    expect(parseEntry({ kind: 'cover', durationMs: 700, overlap: false })).toEqual({ kind: 'cover', durationMs: 700, overlap: true })
  })

  it('se describe en llano', () => {
    expect(describeEntry(null)).toBe('Corte seco')
    expect(describeEntry(makeEntry('dissolve', 1000))).toBe('Fundido de 1 s')
    expect(describeEntry(makeEntry('dip-black', 500))).toBe('A negro de 0,5 s, sin acortar el vídeo')
  })
})

describe('resolver las juntas', () => {
  const j = (entry: ReturnType<typeof makeEntry> | null, length: number, firstRange = length) => ({ entry, length, firstRange })

  it('el primer trozo no tiene junta', () => {
    expect(resolveJoins([j(fade1s, 5000)])).toEqual([null])
  })

  it('con solape: lo pedido si cabe', () => {
    const r = resolveJoins([j(null, 5000), j(fade1s, 5000)])
    expect(r[1]).toMatchObject({ overlap: true, overlapUnits: 1000, duration: 1000, shrunk: false })
  })

  it('no más que el primer rango del que entra', () => {
    const r = resolveJoins([j(null, 5000), j(makeEntry('dissolve', 2000), 5000, 700)])
    expect(r[1]).toMatchObject({ overlapUnits: 700, shrunk: true })
  })

  it('nunca tres trozos a la vez: ov[i] + ov[i+1] ≤ len[i]', () => {
    const big = makeEntry('dissolve', 3000)
    const r = resolveJoins([j(null, 5000), j(big, 4000), j(big, 5000)])
    expect(r[1]!.overlapUnits).toBe(3000)
    expect(r[2]!.overlapUnits).toBe(1000)
    expect(r[1]!.overlapUnits + r[2]!.overlapUnits).toBeLessThanOrEqual(4000)
  })

  it('si no cabe ni el mínimo, corte seco', () => {
    const big = makeEntry('dissolve', 3000)
    const r = resolveJoins([j(null, 5000), j(big, 3100), j(big, 5000)])
    expect(r[2]).toBeNull()
  })

  it('sin solape: mitad y mitad', () => {
    const r = resolveJoins([j(null, 5000), j(makeEntry('dip-black', 1000), 5000)])
    expect(r[1]).toMatchObject({ overlap: false, tail: 500, head: 500, duration: 1000, overlapUnits: 0 })
  })

  it('en fotogramas: unidades enteras', () => {
    const r = resolveJoins([j(null, 150), j(makeEntry('dissolve', 1000), 150)], 30 / 1000)
    expect(r[1]!.overlapUnits).toBe(30)
  })
})

describe('tiempos con transiciones', () => {
  it('sin transiciones, todo igual que antes', () => {
    const p = base()
    expect(clipStartTimes(p)).toEqual([0, 10_000, 20_000])
    expect(projectDurationMs(p)).toBe(30_000)
  })

  it('el solape adelanta al que entra y a los siguientes; el total lo descuenta', () => {
    const p = setTransition(base(), 'b', fade1s)
    expect(clipStartTimes(p)).toEqual([0, 9000, 19_000])
    expect(projectDurationMs(p)).toBe(29_000)
    const tl = clipTimeline(p)
    expect(tl.overlaps).toEqual([0, 1000, 0])
    expect(tl.totalMs).toBe(29_000)
  })

  it('sin solape la duración no cambia', () => {
    const p = setTransition(base(), 'b', makeEntry('dip-white', 1000))
    expect(clipStartTimes(p)).toEqual([0, 10_000, 20_000])
    expect(clipTimeline(p).joins[1]).toMatchObject({ tail: 500, head: 500 })
  })

  it('el primer trozo ignora su entrada sin borrarla', () => {
    const p = setTransition(base(), 'a', fade1s)
    expect(projectDurationMs(p)).toBe(30_000)
    expect(p.clips[0]!.entry).toEqual(fade1s)
  })

  it('un instante del paso es del que entra', () => {
    const p = setTransition(base(), 'b', fade1s)
    expect(locateInProject(p, 9500)).toEqual({ clipIndex: 1, clipOutputMs: 500 })
    expect(anchorAt(p, 9500)).toEqual({ clipId: 'b', offsetMs: 500 })
    expect(locateInProject(p, 8999)).toEqual({ clipIndex: 0, clipOutputMs: 8999 })
    expect(locateInProject(p, 29_000)).toEqual({ clipIndex: 2, clipOutputMs: 10_000 })
  })

  it('lo de pistas: lo pegado al que entra y a los siguientes se adelanta; lo del anterior y lo del principio, no', () => {
    let p = addTrack(base(), createTrack('sound', 's', 'Sonidos'))
    const mk = (id: string) => createItem({ id, kind: 'sound', source: { type: 'file', path: `${id}.m4a` }, name: id, sourceDurationMs: 500, hasAudio: true })
    for (const [id, at] of [['onA', 5000], ['onB', 12_000], ['onC', 25_000]] as const) p = insertItem(p, mk(id), 'sound', at, { id: 's' }, { trackId: 's' }).project
    p = { ...p, tracks: p.tracks.map((t) => ({ ...t, items: [...t.items, { ...mk('zero'), anchor: { clipId: null, offsetMs: 3000 } }] })) }
    const before = Object.fromEntries(resolveTracks(p).map((r) => [r.item.id, r.startMs]))
    p = setTransition(p, 'b', fade1s)
    const after = Object.fromEntries(resolveTracks(p).map((r) => [r.item.id, r.startMs]))
    expect(after.onA).toBe(before.onA)
    expect(after.onB).toBe(before.onB! - 1000)
    expect(after.onC).toBe(before.onC! - 1000)
    expect(after.zero).toBe(before.zero)
  })

  it('al alargar el anterior, la transición vuelve a lo pedido', () => {
    let p = base()
    p = setTransition(p, 'b', makeEntry('dissolve', 3000))
    p = trimClip(p, 'a', 'end', -8000) // a dura 2 s
    expect(clipTimeline(p).overlaps[1]).toBe(2000)
    p = trimClip(p, 'a', 'end', 8000)
    expect(clipTimeline(p).overlaps[1]).toBe(3000)
  })

  it('con pausas quitadas en el que entra, no más que su primer rango', () => {
    let p = setTransition(base(), 'b', makeEntry('dissolve', 2000))
    p = applyKeepSegments(p, 'b', [{ startMs: 0, endMs: 600 }, { startMs: 1000, endMs: 10_000 }])
    expect(clipTimeline(p).overlaps[1]).toBe(600)
  })
})

describe('operaciones', () => {
  it('no se parte dentro del paso', () => {
    const p = setTransition(base(), 'b', fade1s)
    expect(inSharedJoin(p, 'b', 500)).toBe(true)
    expect(inSharedJoin(p, 'a', 9500)).toBe(true)
    expect(inSharedJoin(p, 'a', 8000)).toBe(false)
    expect(splitClip(p, 'b', 500, 'n')).toBe(p)
    expect(splitClip(p, 'a', 9500, 'n')).toBe(p)
  })

  it('al partir, la segunda parte entra con corte seco y la primera conserva la entrada', () => {
    const p = splitClip(setTransition(base(), 'b', fade1s), 'b', 5000, 'n')
    expect(p.clips.map((c) => c.id)).toEqual(['a', 'b', 'n', 'c'])
    expect(p.clips[1]!.entry).toEqual(fade1s)
    expect(p.clips[2]!.entry).toBeNull()
  })

  it('al quitar un trozo se va su entrada; el siguiente conserva la suya, limitada', () => {
    let p = setTransition(base(), 'b', fade1s)
    p = setTransition(p, 'c', makeEntry('dissolve', 3000))
    p = trimClip(p, 'b', 'end', -6000) // b dura 4 s: la de c cabe entera (4 − 1 = 3)
    expect(clipTimeline(p).overlaps).toEqual([0, 1000, 3000])
    const q = removeClip(p, 'b')
    expect(q.clips.map((c) => c.id)).toEqual(['a', 'c'])
    expect(clipTimeline(q).overlaps).toEqual([0, 3000])
  })

  it('al mover un trozo se lleva su entrada', () => {
    const p = moveClip(setTransition(base(), 'b', fade1s), 'b', 2)
    expect(p.clips.map((c) => c.id)).toEqual(['a', 'c', 'b'])
    expect(p.clips[2]!.entry).toEqual(fade1s)
    expect(clipTimeline(p).overlaps).toEqual([0, 0, 1000])
  })

  it('copiar y pegar: la copia entra con corte seco', () => {
    const p = setTransition(base(), 'b', fade1s)
    expect(duplicateClip(p.clips[1]!, 'x').entry).toBeNull()
    const q = insertClipAfter(p, 'b', duplicateClip(p.clips[1]!, 'x'))
    expect(q.clips[2]!.entry).toBeNull()
  })

  it('recortar el principio del que entra no rompe nada (el límite se recalcula)', () => {
    let p = setTransition(base(), 'b', makeEntry('dissolve', 2000))
    p = setInOut(p, 'b', { inMs: 9000 }) // b dura 1 s
    expect(clipTimeline(p).overlaps[1]).toBe(1000)
  })

  it('poner y quitar: el mismo objeto si no cambia', () => {
    const p = setTransition(base(), 'b', fade1s)
    expect(setTransition(p, 'b', makeEntry('dissolve', 1000))).toBe(p)
    expect(setTransition(p, 'b', null).clips[1]!.entry).toBeNull()
  })
})

describe('guardar y leer (versión 6)', () => {
  it('la entrada se guarda y se lee', () => {
    const p = setTransition(base(), 'b', makeEntry('dip-black', 500))
    const q = parseProject(serializeProject(p))
    expect(q.version).toBe(6)
    expect(q.clips[1]!.entry).toEqual({ kind: 'dip-black', durationMs: 500, overlap: false })
  })

  it('una versión 5 se lee sin transiciones', () => {
    const p = setTransition(base(), 'b', fade1s)
    const json = JSON.parse(serializeProject(p))
    json.version = 5
    expect(parseProject(JSON.stringify(json)).clips.every((c) => c.entry === null)).toBe(true)
  })

  it('una entrada que no se entiende es un corte seco y el proyecto se lee igual', () => {
    const json = JSON.parse(serializeProject(base()))
    json.project.clips[1].entry = { kind: 'espiral', durationMs: 1000 }
    json.project.clips[2].entry = 'raro'
    const q = parseProject(JSON.stringify(json))
    expect(q.clips.map((c) => c.entry)).toEqual([null, null, null])
  })
})

describe('cómo se ve cada instante', () => {
  it('fundido: el que entra va de 0 a 1 encima', () => {
    expect(overlapStyleAt('dissolve', 0.25).in.opacity).toBeCloseTo(0.25)
    expect(overlapStyleAt('dissolve', 0.25).out.volume).toBeCloseTo(0.75)
  })

  it('empujar y deslizar: desplazamientos en anchos del marco', () => {
    expect(overlapStyleAt('push', 0.5).out.shiftX).toBeCloseTo(-0.5)
    expect(overlapStyleAt('push', 0.5).in.shiftX).toBeCloseTo(0.5)
    expect(overlapStyleAt('cover', 0.5).out.shiftX).toBe(0)
    expect(overlapStyleAt('cover', 0.25).in.shiftX).toBeCloseTo(0.75)
  })

  it('zoom: el que sale se acerca hasta 1,3 y el que entra se funde', () => {
    expect(overlapStyleAt('zoom', 1).out.scale).toBeCloseTo(ZOOM_MAX_SCALE)
    expect(overlapStyleAt('zoom', 0.5).in.opacity).toBeCloseTo(0.5)
  })

  it('a negro montado: simétrico, negro en el centro', () => {
    const a = overlapStyleAt('dip-black', 0.25)
    expect(a.colorOpacity).toBeCloseTo(0.5)
    expect(a.in.visible).toBe(false)
    const m = overlapStyleAt('dip-black', 0.5)
    expect(m.colorOpacity).toBeCloseTo(1)
    expect(m.out.visible).toBe(false)
    expect(overlapStyleAt('dip-white', 0.75).color).toBe('white')
    expect(overlapStyleAt('dip-white', 0.75).colorOpacity).toBeCloseTo(0.5)
  })

  it('sin solape: al color al final del anterior y desde él al principio del siguiente', () => {
    const join = resolveJoins([{ entry: null, length: 5000, firstRange: 5000 }, { entry: makeEntry('dip-black', 1000), length: 5000, firstRange: 5000 }])[1]!
    expect(joinStyleAt(join, 5000, 4000)).toBeNull()
    expect(joinStyleAt(join, 5000, 4750)!.colorOpacity).toBeCloseTo(0.5)
    expect(joinStyleAt(join, 5000, 4750)!.out.volume).toBeCloseTo(0.5)
    expect(joinStyleAt(join, 5000, 5250)!.colorOpacity).toBeCloseTo(0.5)
    expect(joinStyleAt(join, 5000, 5250)!.in.volume).toBeCloseTo(0.5)
    expect(joinStyleAt(join, 5000, 5600)).toBeNull()
  })

  it('manda la transición sobre el aparecer y desaparecer del trozo', () => {
    const fades = { fadeInMs: 1000, fadeOutMs: 1000, fadeInEasing: 'smooth' as const, fadeOutEasing: 'linear' as const }
    const join = resolveJoins([{ entry: null, length: 5000, firstRange: 5000 }, { entry: fade1s, length: 5000, firstRange: 5000 }])[1]!
    expect(edgeFades(fades, join, null)).toMatchObject({ fadeInMs: 0, fadeOutMs: 1000 })
    expect(edgeFades(fades, null, join)).toMatchObject({ fadeInMs: 1000, fadeOutMs: 0 })
  })
})
