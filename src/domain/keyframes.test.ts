import { describe, expect, it } from 'vitest'
import {
  addMark,
  boxAt,
  clearMotion,
  hasMotion,
  markIndexAt,
  moveMark,
  neighbourMark,
  removeMark,
  segmentMarkIndex,
  setBoxAt,
  setSegmentEasing,
  splitKeyframes,
  visibleMarks,
} from './keyframes'
import { ease } from './motion'
import { addClip, createClip, createProject, normalizeLook, parseProject, serializeProject, type EffectLook, type Project } from './project'
import { fakeMedia } from './test-helpers'
import { createItem, duplicateItem, findItem, insertItem, itemLocalMs, moveItem, resolveTracks, setItemRepeat, splitItem, trimItemEnd, trimItemStart, updateEffectLook } from './tracks'

const still = (): EffectLook => normalizeLook({ mix: 'normal', fit: 'contain', box: { x: 0.8, y: 0.2, scale: 0.25 } })

/** Una pegatina que viaja de arriba a la izquierda (a los 1000 ms) a abajo a la derecha (a los 3000 ms). */
function moving(): EffectLook {
  let l = still()
  l = setBoxAt(l, 1000, { x: 0.2, y: 0.2, scale: 0.25 }) // sin marcas: cambia el de todo el rato
  l = addMark(l, 1000)
  l = setBoxAt(l, 3000, { x: 0.8, y: 0.7, scale: 0.5 }) // con marcas: crea la de los 3000
  return l
}

describe('marcas de tamaño y sitio', () => {
  it('sin marcas, todo como siempre: un solo valor', () => {
    const l = setBoxAt(still(), 2000, { x: 0.3 })
    expect(l.keyframes).toEqual([])
    expect(l.box).toEqual({ x: 0.3, y: 0.2, scale: 0.25 })
    expect(boxAt(l, 99_999)).toEqual(l.box)
    expect(hasMotion(l)).toBe(false)
  })

  it('marcar en un momento y cambiar en otro: viaja de uno a otro con su curva', () => {
    const l = moving()
    expect(l.keyframes.map((k) => k.atMs)).toEqual([1000, 3000])
    expect(hasMotion(l)).toBe(true)
    expect(boxAt(l, 0)).toEqual({ x: 0.2, y: 0.2, scale: 0.25 })
    expect(boxAt(l, 5000)).toEqual({ x: 0.8, y: 0.7, scale: 0.5 })
    const mid = boxAt(l, 2000)
    // «Suave» a la mitad del camino: la mitad.
    expect(mid.x).toBeCloseTo(0.5)
    expect(mid.scale).toBeCloseTo(0.375)
    const quarter = boxAt(l, 1500)
    expect(quarter.x).toBeCloseTo(0.2 + 0.6 * ease('smooth', 0.25))
  })

  it('«Marcar aquí» no cambia lo que se ve; una marca ya puesta no se duplica', () => {
    const l = moving()
    const more = addMark(l, 2000)
    expect(more.keyframes).toHaveLength(3)
    expect(boxAt(more, 2000).x).toBeCloseTo(boxAt(l, 2000).x)
    expect(addMark(more, 2050)).toBe(more)
  })

  it('cambiar el tamaño y sitio en una marca la actualiza (no crea otra)', () => {
    const l = setBoxAt(moving(), 3050, { scale: 0.9 })
    expect(l.keyframes).toHaveLength(2)
    expect(l.keyframes[1]).toMatchObject({ atMs: 3000, box: { x: 0.8, y: 0.7, scale: 0.9 } })
  })

  it('quitar una marca y quitar el movimiento: nada salta', () => {
    const l = moving()
    const one = removeMark(l, 3000)
    expect(one.keyframes).toHaveLength(1)
    expect(boxAt(one, 4000)).toEqual({ x: 0.2, y: 0.2, scale: 0.25 })
    const none = removeMark(one, 1000)
    expect(none.keyframes).toEqual([])
    expect(none.box).toEqual({ x: 0.2, y: 0.2, scale: 0.25 })
    expect(removeMark(l, 2000)).toBe(l)
    const cleared = clearMotion(l, 2000)
    expect(cleared.keyframes).toEqual([])
    expect(cleared.box.x).toBeCloseTo(0.5)
  })

  it('mover una marca en el tiempo (sin pasar encima de otra)', () => {
    const l = moving()
    const moved = moveMark(l, 3000, 4000)
    expect(moved.keyframes.map((k) => k.atMs)).toEqual([1000, 4000])
    expect(moveMark(l, 3000, 1050)).toBe(l)
    // Puede cruzar a la otra: se reordenan.
    expect(moveMark(l, 3000, 500).keyframes.map((k) => k.atMs)).toEqual([500, 1000])
  })

  it('la marca en la línea, la anterior y la siguiente; las que se ven', () => {
    const l = moving()
    expect(markIndexAt(l, 1080)).toBe(0)
    expect(markIndexAt(l, 2000)).toBe(-1)
    expect(neighbourMark(l, 2000, 1, 10_000)?.atMs).toBe(3000)
    expect(neighbourMark(l, 2000, -1, 10_000)?.atMs).toBe(1000)
    expect(neighbourMark(l, 1000, -1, 10_000)).toBeNull()
    expect(neighbourMark(l, 3000, 1, 10_000)).toBeNull()
    expect(visibleMarks(l, 2500).map((k) => k.atMs)).toEqual([1000])
  })

  it('cómo viaja: la curva del tramo de la línea', () => {
    const l = moving()
    expect(segmentMarkIndex(l, 2000)).toBe(1)
    const step = setSegmentEasing(l, 2000, 'step')
    expect(step.keyframes[1]!.easing).toBe('step')
    expect(boxAt(step, 2999).x).toBeCloseTo(0.2)
    expect(boxAt(step, 3000).x).toBeCloseTo(0.8)
    // Con la línea antes de la primera marca o después de la última, el tramo más cercano.
    expect(segmentMarkIndex(l, 0)).toBe(1)
    expect(segmentMarkIndex(l, 9000)).toBe(1)
  })

  it('al partir, cada mitad sigue exactamente el mismo camino', () => {
    const l = { ...moving(), keyframes: [...moving().keyframes, { atMs: 5000, box: { x: 0.5, y: 0.5, scale: 1 }, easing: 'ease-in' as const }] }
    const { first, second } = splitKeyframes(l.keyframes, 2000)
    for (const t of [0, 500, 1000, 1500, 1999]) expect(boxAt({ ...l, keyframes: first }, t)).toEqual(boxAt(l, t))
    for (const t of [2000, 2500, 3000, 4000, 6000]) {
      const a = boxAt({ ...l, keyframes: second }, t - 2000)
      const b = boxAt(l, t)
      expect(a.x).toBeCloseTo(b.x, 9)
      expect(a.scale).toBeCloseTo(b.scale, 9)
    }
    // La primera mitad se queda con lo suyo y con la primera marca de después del corte (fuera de su tramo).
    expect(first.map((k) => k.atMs)).toEqual([1000, 3000])
    expect(second.map((k) => k.atMs)).toEqual([-1000, 1000, 3000])
  })

  it('se guardan y se leen; las dañadas se arreglan o se descartan', () => {
    const l = normalizeLook({ ...moving(), keyframes: [...moving().keyframes, { atMs: 'x' }, { atMs: 3000.4, box: { x: 9, scale: 0 }, easing: 'rebote' }] })
    expect(l.keyframes).toHaveLength(2)
    expect(l.keyframes[1]).toEqual({ atMs: 3000, box: { x: 1, y: 0.5, scale: 0.05 }, easing: 'smooth' })
  })
})

describe('marcas en las pistas', () => {
  // Un trozo de 20 s y una pegatina de 4 s a los 2 s, con un viaje de 1 s a 3 s de su tiempo.
  function project(): Project {
    let p = createProject()
    p = addClip(p, createClip(fakeMedia({ path: 'a.mp4', durationMs: 20_000 }), 'a'))
    const item = createItem({ id: 'st', kind: 'effect', source: { type: 'library', assetId: 'estrella' }, name: 'Estrella', sourceDurationMs: 0, still: true, hasAudio: false, defaults: { durationMs: 4000, look: { fit: 'contain', box: { scale: 0.25 } } } })
    const r = insertItem(p, item, 'effect', 2000, { id: 'fx' })
    if (!r.ok) throw new Error('no cabe')
    return updateEffectLook(r.project, 'st', () => moving())
  }
  const look = (p: Project, id = 'st') => findItem(p, id)!.item.look!
  /** Dónde está a `t` del vídeo. */
  const at = (p: Project, t: number, id = 'st') => {
    const r = resolveTracks(p).find((x) => x.item.id === id)!
    return boxAt(r.item.look!, t - r.startMs)
  }

  it('la línea del vídeo en tiempo del elemento, sujeta a su tramo', () => {
    const p = project()
    expect(itemLocalMs(p, 'st', 3500)).toBe(1500)
    expect(itemLocalMs(p, 'st', 0)).toBe(0)
    expect(itemLocalMs(p, 'st', 99_000)).toBe(4000)
  })

  it('mover el elemento se lleva su movimiento', () => {
    const p = moveItem(project(), 'st', 10_000)!
    expect(at(p, 11_000)).toEqual(at(project(), 3000))
    expect(at(p, 12_000).x).toBeCloseTo(0.5)
  })

  it('recortar por delante: las marcas se quedan en su sitio del vídeo', () => {
    const p = trimItemStart(project(), 'st', 3500)
    expect(look(p).keyframes.map((k) => k.atMs)).toEqual([-500, 1500])
    for (const t of [3500, 4000, 4500, 5000]) expect(at(p, t).x).toBeCloseTo(at(project(), t).x, 9)
    // Y al alargarlo otra vez, vuelven.
    const back = trimItemStart(p, 'st', 2000)
    expect(look(back).keyframes.map((k) => k.atMs)).toEqual([1000, 3000])
  })

  it('recortar por detrás no toca las marcas', () => {
    const p = trimItemEnd(project(), 'st', 4500)
    expect(look(p).keyframes).toEqual(look(project()).keyframes)
  })

  it('partir: cada mitad con las suyas y sin saltos en el corte', () => {
    const p = splitItem(project(), 'st', 4000, 'st2')
    for (const t of [2000, 3000, 3999]) expect(at(p, t)).toEqual(at(project(), t))
    for (const t of [4000, 4500, 5000, 5900]) expect(at(p, t, 'st2').x).toBeCloseTo(at(project(), t).x, 9)
  })

  it('duplicar copia el movimiento (sin compartir nada)', () => {
    const res = duplicateItem(project(), 'st', 'copia', { id: 'nueva' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(look(res.project, 'copia').keyframes).toEqual(look(res.project).keyframes)
    expect(look(res.project, 'copia').keyframes).not.toBe(look(res.project).keyframes)
  })

  it('repetir no cambia el movimiento', () => {
    let p = project()
    const item = createItem({ id: 'v', kind: 'effect', source: { type: 'library', assetId: 'chispas' }, name: 'Chispas', sourceDurationMs: 3000, hasAudio: false })
    const r = insertItem(p, item, 'effect', 10_000, { id: 'fx2' })
    if (!r.ok) throw new Error('no cabe')
    p = updateEffectLook(r.project, 'v', () => moving())
    const rep = setItemRepeat(p, 'v', true)
    expect(look(rep, 'v').keyframes).toEqual(look(p, 'v').keyframes)
  })

  it('ida y vuelta por el fichero del proyecto', () => {
    const p = project()
    const back = parseProject(serializeProject(p))
    expect(look(back)).toEqual(look(p))
  })
})
