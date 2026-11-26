import { describe, expect, it } from 'vitest'
import {
  addClip,
  anchorAt,
  applyKeepSegments,
  createClip,
  createProject,
  itemsAnchoredTo,
  moveClip,
  parseProject,
  removeClip,
  serializeProject,
  setInOut,
  splitClip,
  trimClip,
  type Project,
  type TrackItem,
  syncMediaPool,
} from './project'
import { fakeAudio, fakeMedia } from './test-helpers'
import {
  addTrack,
  attachedCounts,
  createItem,
  createTrack,
  defaultTrackName,
  describeReanchored,
  duplicateItem,
  findFreeStart,
  findItem,
  insertItem,
  isSoloSound,
  itemFadeAt,
  itemSourceTimeAt,
  itemsAround,
  moveItem,
  projectTiming,
  removeTrack,
  renameTrack,
  resolveTracks,
  setItemFade,
  setItemRepeat,
  setItemVolume,
  setMainMuted,
  setTrackHidden,
  setTrackMuted,
  snapMove,
  snapPoints,
  snapTime,
  splitItem,
  trimItemEnd,
  trimItemStart,
  toggleSoloSound,
  type NewItem,
} from './tracks'

// Tres trozos de 10 s: 0–10, 10–20, 20–30.
function base(): Project {
  let p = createProject()
  for (const id of ['a', 'b', 'c']) p = addClip(p, createClip(fakeMedia({ path: `${id}.mp4`, durationMs: 10_000 }), id))
  return p
}

function sound(id: string, durationMs = 2000, extra: Partial<NewItem> = {}): TrackItem {
  return createItem({ id, kind: 'sound', source: { type: 'file', path: `${id}.m4a` }, name: id, sourceDurationMs: durationMs, hasAudio: true, ...extra })
}

function effect(id: string, durationMs = 3000, extra: Partial<NewItem> = {}): TrackItem {
  return createItem({ id, kind: 'effect', source: { type: 'library', assetId: id }, name: id, sourceDurationMs: durationMs, hasAudio: false, ...extra })
}

/** Inserta y devuelve el proyecto (falla si no cabe). */
function put(p: Project, item: TrackItem, kind: 'sound' | 'effect', at: number, trackId = `${kind}-1`): Project {
  const r = insertItem(p, item, kind, at, { id: trackId })
  if (!r.ok) throw new Error(`no cabe ${item.id}`)
  return r.project
}

const times = (p: Project) => Object.fromEntries(resolveTracks(p).map((r) => [r.item.id, [r.startMs, r.endMs]]))

describe('anclajes', () => {
  it('se pegan al trozo que hay debajo y se resuelven con la fila de trozos', () => {
    const p = base()
    expect(anchorAt(p, 0)).toEqual({ clipId: 'a', offsetMs: 0 })
    expect(anchorAt(p, 10_000)).toEqual({ clipId: 'b', offsetMs: 0 })
    expect(anchorAt(p, 25_500)).toEqual({ clipId: 'c', offsetMs: 5500 })
    expect(anchorAt(p, 99_000)).toEqual({ clipId: 'c', offsetMs: 79_000 })
    expect(anchorAt(createProject(), 1200)).toEqual({ clipId: null, offsetMs: 1200 })
    const q = put(base(), sound('ding'), 'sound', 12_000)
    expect(findItem(q, 'ding')!.item.anchor).toEqual({ clipId: 'b', offsetMs: 2000 })
    expect(times(q).ding).toEqual([12_000, 14_000])
  })

  it('al reordenar un trozo, lo que lleva pegado va con él', () => {
    let p = put(base(), sound('ding'), 'sound', 12_000)
    p = moveClip(p, 'b', 2)
    // b ahora va de 20 a 30.
    expect(times(p).ding).toEqual([22_000, 24_000])
  })

  it('quitar pausas en un trozo anterior no desincroniza lo de después', () => {
    let p = put(base(), sound('ding'), 'sound', 25_000)
    p = applyKeepSegments(p, 'a', [
      { startMs: 0, endMs: 3000 },
      { startMs: 6000, endMs: 10_000 },
    ])
    // a dura 7 s: c empieza en el 17 y el sonido sigue a 5 s de su principio.
    expect(times(p).ding).toEqual([22_000, 24_000])
  })

  it('si el trozo ancla se acorta, el elemento se sujeta a su final', () => {
    let p = put(base(), sound('ding'), 'sound', 18_000)
    p = setInOut(p, 'b', { outMs: 5000 })
    expect(times(p).ding).toEqual([15_000, 17_000])
    // Al alargarlo otra vez, vuelve a su sitio (el offset se guarda tal cual).
    p = setInOut(p, 'b', { outMs: 10_000 })
    expect(times(p).ding).toEqual([18_000, 20_000])
  })

  it('al recortar el principio del trozo ancla, lo pegado sigue a su imagen (y vuelve al alargarlo)', () => {
    // ding a 4 s de b (14 s del vídeo); late a 8 s de b (18 s); lo de c va con c.
    let p = put(base(), sound('ding'), 'sound', 14_000)
    p = put(p, sound('late', 1000), 'sound', 18_000)
    p = put(p, sound('onc'), 'sound', 25_000, 'sound-2')
    p = trimClip(p, 'b', 'start', 3000)
    // b dura 7 s (10–17): ding sigue sobre el mismo momento de b (1 s de su nuevo principio).
    expect(findItem(p, 'ding')!.item.anchor).toEqual({ clipId: 'b', offsetMs: 1000 })
    expect(times(p)).toMatchObject({ ding: [11_000, 13_000], late: [15_000, 16_000], onc: [22_000, 24_000] })
    // Si se recorta más allá de su momento, se sujeta al principio del trozo, con el offset guardado.
    p = trimClip(p, 'b', 'start', 2000)
    expect(findItem(p, 'ding')!.item.anchor.offsetMs).toBe(-1000)
    expect(times(p).ding).toEqual([10_000, 12_000])
    // Al alargarlo otra vez por delante, todo vuelve a su sitio.
    p = trimClip(p, 'b', 'start', -5000)
    expect(times(p)).toMatchObject({ ding: [14_000, 16_000], late: [18_000, 19_000], onc: [25_000, 27_000] })
    expect(findItem(p, 'ding')!.item.anchor).toEqual({ clipId: 'b', offsetMs: 4000 })
    // Se guarda y se lee con el offset negativo.
    const q = trimClip(p, 'b', 'start', 6000)
    expect(findItem(parseProject(serializeProject(q)), 'ding')!.item.anchor.offsetMs).toBe(-2000)
  })

  it('al partir el trozo, el elemento se queda con la parte donde cae su inicio', () => {
    let p = put(base(), sound('early'), 'sound', 11_000)
    p = put(p, sound('late'), 'sound', 17_000)
    p = splitClip(p, 'b', 4000, 'b2')
    expect(findItem(p, 'early')!.item.anchor).toEqual({ clipId: 'b', offsetMs: 1000 })
    expect(findItem(p, 'late')!.item.anchor).toEqual({ clipId: 'b2', offsetMs: 3000 })
    expect(times(p)).toMatchObject({ early: [11_000, 13_000], late: [17_000, 19_000] })
    // Mover la segunda parte se lleva solo lo suyo.
    p = moveClip(p, 'b2', 0)
    expect(times(p)).toMatchObject({ late: [3000, 5000] })
  })

  it('al quitar el trozo ancla, lo pegado se queda en el mismo sitio del vídeo', () => {
    let p = put(base(), sound('s1'), 'sound', 12_000)
    p = put(p, sound('s2'), 'sound', 16_000)
    p = put(p, effect('fx'), 'effect', 25_000)
    expect(itemsAnchoredTo(p, 'b')).toEqual({ sounds: 2, effects: 0 })
    expect(describeReanchored(itemsAnchoredTo(p, 'b'))).toBe('2 sonidos estaban pegados a este trozo: se quedan en el mismo sitio del vídeo.')
    const q = removeClip(p, 'b')
    // Ahora c va de 10 a 20: s1 y s2 pasan a pegarse a c en el mismo instante del vídeo.
    expect(findItem(q, 's1')!.item.anchor).toEqual({ clipId: 'c', offsetMs: 2000 })
    expect(times(q)).toMatchObject({ s1: [12_000, 14_000], s2: [16_000, 18_000], fx: [15_000, 18_000] })
    // Quitar el último: lo de más allá del final se pega al último trozo (y se sujeta a su final).
    const r = removeClip(put(base(), sound('end'), 'sound', 28_000), 'c')
    expect(findItem(r, 'end')!.item.anchor).toEqual({ clipId: 'b', offsetMs: 18_000 })
    expect(times(r).end).toEqual([20_000, 22_000])
    expect(describeReanchored({ sounds: 0, effects: 1 })).toBe('1 efecto estaba pegado a este trozo: se queda en el mismo sitio del vídeo.')
    expect(describeReanchored({ sounds: 0, effects: 0 })).toBeNull()
  })

  it('un trozo que ya no existe cuenta desde el principio del vídeo', () => {
    const p = put(base(), sound('x'), 'sound', 12_000)
    const broken: Project = { ...p, clips: p.clips.filter((c) => c.id !== 'b') }
    expect(times(broken).x).toEqual([2000, 4000])
  })

  it('la música de fondo (repite hasta el final, desde el 0) se pega al principio del vídeo', () => {
    const music = sound('music', 4000, { defaults: { repeat: true, durationMs: null } })
    let p = put(base(), music, 'sound', 0)
    expect(findItem(p, 'music')!.item.anchor).toEqual({ clipId: null, offsetMs: 0 })
    expect(times(p).music).toEqual([0, 30_000])
    p = moveClip(p, 'a', 2)
    expect(times(p).music).toEqual([0, 30_000])
    // Sin «hasta el final», en el 0 se pega al primer trozo.
    const q = put(base(), sound('ding'), 'sound', 0)
    expect(findItem(q, 'ding')!.item.anchor.clipId).toBe('a')
  })

  it('cuántos lleva pegados cada trozo', () => {
    let p = put(base(), sound('s1'), 'sound', 1000)
    p = put(p, sound('s2'), 'sound', 4000)
    p = put(p, effect('e1'), 'effect', 12_000)
    const counts = attachedCounts(p)
    expect(counts.get('a')).toEqual({ sounds: 2, effects: 0 })
    expect(counts.get('b')).toEqual({ sounds: 0, effects: 1 })
    expect(counts.get('c')).toBeUndefined()
  })
})

describe('pistas', () => {
  it('nombres, sin límite de pistas y orden de apilado', () => {
    let p = base()
    expect(defaultTrackName(p, 'sound')).toBe('Sonidos')
    p = addTrack(p, createTrack('sound', 's1', defaultTrackName(p, 'sound')))
    expect(defaultTrackName(p, 'sound')).toBe('Sonidos 2')
    for (let i = 2; i <= 12; i++) p = addTrack(p, createTrack('sound', `s${i}`, defaultTrackName(p, 'sound')))
    expect(p.tracks.filter((t) => t.kind === 'sound')).toHaveLength(12)
    expect(p.tracks.at(-1)!.name).toBe('Sonidos 12')
    // El mismo id dos veces no crea otra pista.
    expect(addTrack(p, createTrack('sound', 's3', 'Otra'))).toBe(p)
    p = addTrack(p, createTrack('effect', 'e1', 'Efectos'))
    p = addTrack(p, createTrack('effect', 'e2', 'Efectos 2'))
    // La nueva de efectos va encima de las que había.
    expect(p.tracks.filter((t) => t.kind === 'effect').map((t) => t.id)).toEqual(['e2', 'e1'])
    p = renameTrack(p, 's1', '  Música   de fondo ')
    expect(p.tracks.find((t) => t.id === 's1')!.name).toBe('Música de fondo')
    expect(renameTrack(p, 's1', '   ')).toBe(p)
    p = setTrackMuted(setTrackHidden(p, 'e1', true), 's2', true)
    expect(p.tracks.find((t) => t.id === 'e1')!.hidden).toBe(true)
    expect(p.tracks.find((t) => t.id === 's2')!.muted).toBe(true)
    // Silenciar una de efectos u ocultar una de sonido no hace nada.
    expect(setTrackMuted(p, 'e1', true)).toBe(p)
    expect(setTrackHidden(p, 's1', true)).toBe(p)
    expect(removeTrack(p, 's2').tracks.some((t) => t.id === 's2')).toBe(false)
    expect(setMainMuted(p, true).mainMuted).toBe(true)
    expect(setMainMuted(p, false)).toBe(p)
  })

  it('«Poner aquí»: la primera pista con sitio; si no, una nueva (sin límite); en una pista dada, a continuación', () => {
    let p = put(base(), sound('a1'), 'sound', 5000, 't1')
    // Pisa a a1: va a una pista nueva.
    const r = insertItem(p, sound('a2'), 'sound', 6000, { id: 't2' })
    expect(r.ok && r.newTrack && r.trackId).toBe('t2')
    p = r.ok ? r.project : p
    // En un sitio libre, a la primera pista.
    const r2 = insertItem(p, sound('a3'), 'sound', 20_000, { id: 't3' })
    expect(r2.ok && r2.trackId).toBe('t1')
    // Con diez pistas llenas en el 5 s, el siguiente va a una pista nueva (ya no hay tope).
    for (let i = 3; i <= 10; i++) p = put(p, sound(`a${i + 1}`), 'sound', 5000, `t${i}`)
    expect(p.tracks).toHaveLength(10)
    const r3 = insertItem(p, sound('a99'), 'sound', 5500, { id: 't11' })
    expect(r3.ok && [r3.trackId, r3.startMs, r3.newTrack, r3.project.tracks.length]).toEqual(['t11', 5500, true, 11])
    // Pidiendo una pista concreta, si no cabe, a continuación en ella.
    const r4 = insertItem(p, sound('a98'), 'sound', 5500, { id: 'no' }, { trackId: 't1' })
    expect(r4.ok && [r4.trackId, r4.startMs, r4.shifted]).toEqual(['t1', 7000, true])
    // Sin trozos no se puede poner nada.
    expect(insertItem(createProject(), sound('z'), 'sound', 0, { id: 'x' })).toEqual({ ok: false, reason: 'empty-video' })
  })
})

describe('escuchar una sola fila', () => {
  it('silencia las demás de un toque y, otra vez, vuelve a sonar todo', () => {
    let p = addTrack(addTrack(base(), createTrack('sound', 's1', 'Música')), createTrack('sound', 's2', 'Voces'))
    p = addTrack(p, createTrack('effect', 'e1', 'Efectos'))
    expect(isSoloSound(p, 's1')).toBe(false)
    const solo = toggleSoloSound(p, 's1')
    expect(isSoloSound(solo, 's1')).toBe(true)
    // Orden de las pistas: e1 (los efectos, encima), s1, s2.
    expect([solo.mainMuted, ...solo.tracks.map((t) => t.muted)]).toEqual([true, false, false, true])
    // Otra vez: todo suena (también lo que estaba silenciado antes).
    const back = toggleSoloSound(setTrackMuted(solo, 's2', true), 's1')
    expect([back.mainMuted, ...back.tracks.map((t) => t.muted)]).toEqual([false, false, false, false])
    // La fila «Vídeo» también vale; una de efectos no.
    const main = toggleSoloSound(p, 'main')
    expect([main.mainMuted, ...main.tracks.filter((t) => t.kind === 'sound').map((t) => t.muted)]).toEqual([false, true, true])
    expect(isSoloSound(main, 'main')).toBe(true)
    expect(toggleSoloSound(p, 'e1')).toBe(p)
    // Si estaba silenciada, «solo esta» la hace sonar.
    expect(isSoloSound(toggleSoloSound(setTrackMuted(p, 's1', true), 's1'), 's1')).toBe(true)
    // Sin más filas de sonido no hay «solo».
    expect(isSoloSound(base(), 'main')).toBe(false)
  })
})

describe('solapes', () => {
  it('al soltar encima de otro, se coloca a continuación; si no hay sitio, no se mueve', () => {
    let p = put(base(), sound('a', 4000), 'sound', 2000, 't')
    p = put(p, sound('b', 4000), 'sound', 10_000, 't')
    p = put(p, sound('c', 4000), 'sound', 20_000, 't')
    const moved = moveItem(p, 'c', 3000)!
    // 3–7 pisa a «a» (2–6): va a las 6; 6–10 cabe justo antes de «b».
    expect(times(moved).c).toEqual([6000, 10_000])
    // En el 11 pisa a «b» (10–14): a las 14.
    expect(times(moveItem(p, 'c', 11_000)!).c).toEqual([14_000, 18_000])
    // Una música «hasta el final» no deja sitio después.
    let q = put(base(), sound('m', 4000, { defaults: { repeat: true, durationMs: null } }), 'sound', 10_000, 't')
    q = put(q, sound('x', 2000), 'sound', 2000, 't')
    expect(moveItem(q, 'x', 12_000)).toBeNull()
    expect(findFreeStart(q, 't', 9000, () => 2000, 'x')).toBeNull()
  })

  it('se puede mover a otra pista del mismo tipo, no a una de otro tipo', () => {
    let p = put(base(), sound('a'), 'sound', 2000, 't1')
    p = addTrack(p, createTrack('sound', 't2', 'Música'))
    p = put(p, effect('fx'), 'effect', 2000, 'e1')
    const q = moveItem(p, 'a', 4000, 't2')!
    expect(findItem(q, 'a')!.track.id).toBe('t2')
    expect(times(q).a).toEqual([4000, 6000])
    expect(moveItem(p, 'a', 4000, 'e1')).toBeNull()
  })

  it('al recortar o alargar no se pisa al vecino', () => {
    let p = put(base(), sound('a', 5000), 'sound', 2000, 't')
    p = put(p, sound('b', 5000), 'sound', 9000, 't')
    // El final de «a» no pasa del principio de «b» (ni del final de su original: 5 s).
    expect(times(trimItemEnd(p, 'a', 12_000)).a).toEqual([2000, 7000])
    expect(times(trimItemStart(p, 'b', 5000)).b).toEqual([9000, 14_000])
    const longer = put(base(), sound('a', 8000), 'sound', 2000, 't')
    const withB = put(longer, sound('b', 5000), 'sound', 12_000, 't')
    expect(times(trimItemEnd(trimItemEnd(withB, 'a', 6000), 'a', 15_000)).a).toEqual([2000, 10_000])
  })
})

describe('recortar, partir, duplicar', () => {
  it('recortar el principio se come el original por delante y deja el final quieto', () => {
    let p = put(base(), sound('a', 6000), 'sound', 2000, 't')
    p = trimItemStart(p, 'a', 3500)
    const it = findItem(p, 'a')!.item
    expect([it.inMs, it.outMs]).toEqual([1500, 6000])
    expect(times(p).a).toEqual([3500, 8000])
    // Alargar por delante solo hasta el principio del original.
    expect(times(trimItemStart(p, 'a', 0)).a).toEqual([2000, 8000])
    // Nunca más corto que el mínimo.
    expect(times(trimItemStart(p, 'a', 7999)).a).toEqual([7700, 8000])
  })

  it('si repite, el final se alarga todo lo que se quiera y el principio sigue la vuelta', () => {
    let p = put(base(), sound('loop', 2000, { defaults: { repeat: true, durationMs: 2000 } }), 'sound', 4000, 't')
    p = trimItemEnd(p, 'loop', 11_000)
    expect(times(p).loop).toEqual([4000, 11_000])
    expect(findItem(p, 'loop')!.item.durationMs).toBe(7000)
    // Llegar al final del vídeo lo deja «hasta el final».
    p = trimItemEnd(p, 'loop', 40_000)
    expect(findItem(p, 'loop')!.item.durationMs).toBeNull()
    expect(times(p).loop).toEqual([4000, 30_000])
    p = trimItemStart(p, 'loop', 4500)
    const it = findItem(p, 'loop')!.item
    expect(it.phaseMs).toBe(500)
    expect(itemSourceTimeAt(it, 0)).toBe(500)
    expect(itemSourceTimeAt(it, 1700)).toBe(200)
  })

  it('partir: la segunda parte sigue por donde iba', () => {
    let p = put(base(), sound('a', 6000), 'sound', 2000, 't')
    p = setItemFade(setItemFade(p, 'a', 'in', true), 'a', 'out', true)
    p = splitItem(p, 'a', 12_000 - 7000 + 0, 'a2')
    const a = findItem(p, 'a')!.item
    const a2 = findItem(p, 'a2')!.item
    expect([a.inMs, a.outMs, a.fadeInMs, a.fadeOutMs]).toEqual([0, 3000, 1000, 0])
    expect([a2.inMs, a2.outMs, a2.fadeInMs, a2.fadeOutMs]).toEqual([3000, 6000, 0, 1000])
    expect(times(p)).toMatchObject({ a: [2000, 5000], a2: [5000, 8000] })
    // Muy cerca del borde no parte.
    expect(splitItem(p, 'a', 2100, 'zz')).toBe(p)
    // Si repite, la segunda parte sigue la vuelta.
    let q = put(base(), sound('m', 3000, { defaults: { repeat: true, durationMs: null } }), 'sound', 0, 't')
    q = splitItem(q, 'm', 4000, 'm2')
    const m2 = findItem(q, 'm2')!.item
    expect([m2.phaseMs, m2.durationMs]).toEqual([1000, null])
    expect(findItem(q, 'm')!.item.durationMs).toBe(4000)
    expect(times(q)).toMatchObject({ m: [0, 4000], m2: [4000, 30_000] })
  })

  it('partir un elemento pegado a un trozo pega cada parte al trozo que tiene debajo', () => {
    let p = put(base(), sound('a', 6000), 'sound', 7000, 't')
    p = splitItem(p, 'a', 11_000, 'a2')
    expect(findItem(p, 'a')!.item.anchor.clipId).toBe('a')
    expect(findItem(p, 'a2')!.item.anchor).toEqual({ clipId: 'b', offsetMs: 1000 })
  })

  it('duplicar: justo detrás en su pista; si no cabe, en otra o en una nueva', () => {
    let p = put(base(), sound('a', 3000), 'sound', 2000, 't1')
    let r = duplicateItem(p, 'a', 'a-copia', { id: 't2' })
    expect(r.ok && [r.trackId, r.startMs]).toEqual(['t1', 5000])
    p = put(p, sound('b', 3000), 'sound', 5000, 't1')
    r = duplicateItem(p, 'a', 'a-copia', { id: 't2' })
    expect(r.ok && [r.trackId, r.startMs]).toEqual(['t2', 5000])
    // Lo que dura «hasta el final» se duplica con lo que dura ahora… y al final del vídeo no cabe.
    const q = put(base(), sound('m', 2000, { defaults: { repeat: true, durationMs: null } }), 'sound', 0, 't1')
    expect(duplicateItem(q, 'm', 'm2', { id: 't2' }).ok).toBe(false)
  })
})

describe('ajustes', () => {
  it('volumen, suaves y repetir', () => {
    let p = put(base(), sound('a', 4000), 'sound', 2000, 't')
    p = put(p, sound('b', 2000), 'sound', 15_000, 't')
    expect(findItem(setItemVolume(p, 'a', 3), 'a')!.item.volume).toBe(1.5)
    expect(findItem(setItemVolume(p, 'a', -1), 'a')!.item.volume).toBe(0)
    p = setItemRepeat(p, 'a', true)
    // Repite hasta el siguiente de su pista.
    expect(times(p).a).toEqual([2000, 15_000])
    p = setItemRepeat(p, 'a', false)
    expect(times(p).a).toEqual([2000, 6000])
    const fx = put(base(), effect('fx', 3000), 'effect', 1000, 'e')
    expect(findItem(setItemFade(fx, 'fx', 'in', true), 'fx')!.item.fadeInMs).toBe(500)
  })

  it('suaves en vivo: suben y bajan, y se reparten si no caben', () => {
    const item: TrackItem = { ...sound('a', 4000), fadeInMs: 1000, fadeOutMs: 1000 }
    expect(itemFadeAt(item, 0, 4000)).toBe(0)
    expect(itemFadeAt(item, 500, 4000)).toBeCloseTo(0.5)
    expect(itemFadeAt(item, 2000, 4000)).toBe(1)
    expect(itemFadeAt(item, 3500, 4000)).toBeCloseTo(0.5)
    expect(itemFadeAt(item, 4000, 4000)).toBe(0)
    // En 1 s, medio segundo cada una.
    expect(itemFadeAt(item, 250, 1000)).toBeCloseTo(0.5)
  })

  it('qué suena en cada momento (para cargar antes lo que viene)', () => {
    let p = put(base(), sound('a', 2000), 'sound', 2000, 't')
    p = put(p, sound('b', 2000), 'sound', 9000, 't')
    const r = resolveTracks(p)
    expect(itemsAround(r, 3000).map((x) => x.item.id)).toEqual(['a'])
    expect(itemsAround(r, 3000, 7000).map((x) => x.item.id)).toEqual(['a', 'b'])
    expect(itemsAround(r, 4000).map((x) => x.item.id)).toEqual([])
  })
})

describe('imanes', () => {
  it('puntos: trozos, cabezal y los demás elementos', () => {
    let p = put(base(), sound('a', 2000), 'sound', 3000, 't')
    p = put(p, sound('b', 2000), 'sound', 14_000, 't')
    expect(snapPoints(p, 7777, 'b')).toEqual([0, 3000, 5000, 7777, 10_000, 20_000, 30_000])
  })

  it('pega el principio o el final, lo que quede más cerca', () => {
    const points = [0, 10_000, 20_000]
    expect(snapTime(points, 10_150, 200)).toEqual({ timeMs: 10_000, guideMs: 10_000 })
    expect(snapTime(points, 10_300, 200)).toEqual({ timeMs: 10_300, guideMs: null })
    // El final (11 900 + 2000 = 13 900) no está cerca; el principio sí.
    expect(snapMove(points, 9900, 4000, 200)).toEqual({ timeMs: 10_000, guideMs: 10_000 })
    // El final (8100 + 2000) se pega al 10 000.
    expect(snapMove(points, 8100, 2000, 200)).toEqual({ timeMs: 8000, guideMs: 10_000 })
  })
})

describe('guardar y leer (versión 3)', () => {
  it('ida y vuelta con pistas, anclajes y aspecto de los efectos', () => {
    let p = put(base(), sound('music', 4000, { defaults: { repeat: true, durationMs: null, volume: 0.6 } }), 'sound', 0, 'mus')
    p = put(p, effect('fx', 3000, { defaults: { look: { mix: 'light', opacity: 0.8, box: { x: 0.3, scale: 0.5 } } } }), 'effect', 12_000, 'e')
    p = put(p, createItem({ id: 'logo', kind: 'effect', source: { type: 'file', path: 'C:\\logo.png' }, name: 'logo', sourceDurationMs: 0, still: true, hasAudio: false }), 'effect', 1000, 'e')
    p = setTrackMuted(setMainMuted(p, true), 'mus', true)
    const back = parseProject(serializeProject(p))
    expect(back).toEqual(syncMediaPool(p))
    const logo = findItem(back, 'logo')!.item
    expect([logo.still, logo.durationMs, logo.look!.fit]).toEqual([true, 4000, 'contain'])
  })

  it('una versión 2 se lee sin pistas y con el sonido puesto', () => {
    const v2 = JSON.stringify({
      app: 'easy-cut',
      version: 2,
      project: { aspect: '16:9', clips: [{ id: 'a', sourcePath: 'a.mp4', sourceDurationMs: 5000, sourceHasVideo: true, segments: [{ startMs: 0, endMs: 5000 }], picture: { kind: 'own' } }], mainMuted: true, tracks: [{ id: 'x', kind: 'sound', items: [] }] },
    })
    const p = parseProject(v2)
    expect(p.version).toBe(4)
    expect(p.tracks).toEqual([])
    expect(p.mainMuted).toBe(false)
  })

  it('pistas y elementos dañados se descartan sin perder el proyecto', () => {
    const json = JSON.stringify({
      app: 'easy-cut',
      version: 3,
      project: {
        aspect: '16:9',
        clips: [{ id: 'a', sourcePath: 'a.mp4', sourceDurationMs: 5000, sourceHasVideo: true, segments: [{ startMs: 0, endMs: 5000 }], picture: { kind: 'own' } }],
        tracks: [
          { id: 't1', kind: 'sound', name: '', muted: true, hidden: true, items: [
            { id: 'ok', source: { type: 'file', path: 'a.m4a' }, sourceDurationMs: 3000, anchor: { clipId: 'a', offsetMs: 500 }, inMs: -5, outMs: 9000, volume: 7, fadeInMs: 1000 },
            { id: 'sin-fuente', source: { type: 'otra' }, sourceDurationMs: 3000 },
            { id: 'sin-duracion', source: { type: 'file', path: 'b.m4a' } },
          ] },
          { id: 't2', kind: 'raro', items: [] },
          { id: 't3', kind: 'effect', items: [{ id: 'img', source: { type: 'library', assetId: 'marco' }, still: true, durationMs: null, look: { mix: 'otro', opacity: 4, box: { x: 9, scale: 0 } } }] },
        ],
      },
    })
    const p = parseProject(json)
    expect(p.tracks.map((t) => t.id)).toEqual(['t1', 't3'])
    expect(p.tracks[0]).toMatchObject({ name: 'Sonidos', muted: true, hidden: false })
    expect(p.tracks[0]!.items.map((i) => i.id)).toEqual(['ok'])
    expect(p.tracks[0]!.items[0]).toMatchObject({ inMs: 0, outMs: 3000, volume: 1.5, fadeInMs: 1000, look: null, repeat: false, durationMs: null })
    expect(p.tracks[1]!.items[0]).toMatchObject({ still: true, durationMs: null, look: { mix: 'normal', opacity: 1, box: { x: 1, y: 0.5, scale: 0.05 }, fit: 'cover' } })
  })

  it('se leen todas las pistas, sin tope (antes, 4 de sonido y 3 de efectos)', () => {
    let p = base()
    for (let i = 0; i < 9; i++) p = addTrack(p, createTrack('sound', `s${i}`, defaultTrackName(p, 'sound')))
    for (let i = 0; i < 6; i++) p = addTrack(p, createTrack('effect', `e${i}`, defaultTrackName(p, 'effect')))
    const back = parseProject(serializeProject(p))
    expect(back.tracks.map((t) => t.id)).toEqual(p.tracks.map((t) => t.id))
    expect(back.tracks).toHaveLength(15)
  })

  it('los tiempos de guardado (fotogramas enteros) mueven lo pegado con su trozo', () => {
    let p = put(base(), sound('d'), 'sound', 21_000)
    p = setInOut(p, 'a', { outMs: 9990 })
    // A 30 fps el trozo a dura 300 fotogramas = 10 000 ms en el fichero (no 9990).
    const exported = projectTiming(p, [10_000, 10_000, 10_000])
    expect(resolveTracks(p, exported)[0]!.startMs).toBe(21_000)
    expect(resolveTracks(p)[0]!.startMs).toBe(20_990)
  })
})
