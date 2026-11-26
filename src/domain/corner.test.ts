// «El vídeo de este trozo» en las pistas: la esquina de antes convertida, «Llevar a una esquina aquí» y cómo se
// porta con las operaciones de los trozos y de las pistas.
import { describe, expect, it } from 'vitest'
import { CORNER_TRAVEL_MS, cornerBox, cornerMoveAt, cornerRadius, isFullFrame, moveToCornerAt, putClipVideo } from './corner'
import { boxAt } from './keyframes'
import {
  addClip,
  createClip,
  createProject,
  findClipVideoItem,
  legacyInsetBox,
  MIGRATED_CORNER_TRACK_ID,
  moveClip,
  parseProject,
  removeClip,
  serializeProject,
  setCover,
  setInOut,
  splitClip,
  type Project,
} from './project'
import { fakeMedia } from './test-helpers'
import { createItem, duplicateItem, insertItem, moveItem, resolveTracks, setItemRepeat, splitItem, trimItemEnd, trimItemStart } from './tracks'

const hd = fakeMedia({ path: 'C:\\yo.mp4', durationMs: 10_000 })
const back = fakeMedia({ path: 'C:\\fondo.mp4', durationMs: 30_000 })

/** Dos trozos: «a» (con otro vídeo de fondo) y «b», de 10 s. */
function base(): Project {
  let p = createProject('16:9')
  p = addClip(p, createClip(hd, 'a'))
  p = addClip(p, createClip(hd, 'b'))
  return setCover(p, 'a', back)
}

function v4WithInset(): string {
  return JSON.stringify({
    app: 'easy-cut',
    version: 4,
    project: {
      aspect: '16:9',
      clips: [
        { id: 'a', sourcePath: 'C:\\yo.mp4', sourceDurationMs: 10_000, sourceHasVideo: true, segments: [{ startMs: 0, endMs: 10_000 }], picture: { kind: 'cover', sourcePath: 'C:\\fondo.mp4', sourceDurationMs: 30_000, startMs: 0, inset: { corner: 'bottom-right', size: 'small' } } },
        { id: 'b', sourcePath: 'C:\\yo.mp4', sourceDurationMs: 10_000, sourceHasVideo: true, segments: [{ startMs: 0, endMs: 10_000 }], picture: { kind: 'cover', sourcePath: 'C:\\fondo.mp4', sourceDurationMs: 30_000, startMs: 0, inset: { corner: 'top-left', size: 'medium' } } },
        { id: 'c', sourcePath: 'C:\\yo.mp4', sourceDurationMs: 10_000, sourceHasVideo: true, segments: [{ startMs: 0, endMs: 10_000 }], picture: { kind: 'own' } },
      ],
      tracks: [{ id: 'fx', kind: 'effect', name: 'Efectos', items: [{ id: 'chispas', source: { type: 'library', assetId: 'chispas' }, sourceDurationMs: 3000, anchor: { clipId: 'a', offsetMs: 0 } }] }],
      media: [],
    },
  })
}

describe('la esquina de antes (versión 4) se convierte al abrirla', () => {
  it('en «el vídeo de este trozo», en una pista debajo de los efectos, en el mismo sitio y tamaño', () => {
    const p = parseProject(v4WithInset())
    expect(p.clips.map((c) => c.picture.kind)).toEqual(['cover', 'cover', 'own'])
    expect(p.clips.every((c) => !('inset' in c.picture))).toBe(true)
    // La pista nueva va debajo de las de efectos que había (la esquina de antes iba debajo de los efectos).
    expect(p.tracks.map((t) => t.id)).toEqual(['fx', MIGRATED_CORNER_TRACK_ID])
    const a = findClipVideoItem(p, 'a')!
    const b = findClipVideoItem(p, 'b')!
    expect(findClipVideoItem(p, 'c')).toBeNull()
    expect(a.item.look).toMatchObject({ mix: 'normal', opacity: 1, fit: 'cover', keyframes: [], rounded: true, box: legacyInsetBox({ corner: 'bottom-right', size: 'small' }, '16:9') })
    expect(b.item.look!.box).toEqual(legacyInsetBox({ corner: 'top-left', size: 'medium' }, '16:9'))
    // Sin sonido propio (el sonido sale del trozo) y pegado al principio de su trozo, todo lo que dura.
    const r = resolveTracks(p).filter((x) => x.item.source.type === 'clip')
    expect(r.map((x) => [x.startMs, x.endMs])).toEqual([[0, 10_000], [10_000, 20_000]])
    expect(a.item).toMatchObject({ volume: 0, hasAudio: false, anchor: { clipId: 'a', offsetMs: 0 } })
    // Y se guarda y se vuelve a leer igual (ya en la versión 5, sin convertir otra vez).
    expect(parseProject(serializeProject(p))).toEqual(p)
  })

  it('el radio de las esquinas es el de antes (16 px a 1280×720 en pequeño)', () => {
    const p = parseProject(v4WithInset())
    expect(Math.round(cornerRadius(findClipVideoItem(p, 'a')!.item.look!, 1280, 720))).toBe(16)
    // A pantalla completa no hay esquinas.
    expect(cornerRadius({ rounded: true, box: { x: 0.5, y: 0.5, scale: 1 }, keyframes: [] }, 1280, 720)).toBe(0)
  })

  it('«el vídeo de este trozo» que no vale se descarta (sin trozo, repetido, en una pista de sonido)', () => {
    const json = JSON.parse(v4WithInset())
    json.version = 5
    json.project.clips[0].picture.inset = undefined
    json.project.tracks = [
      { id: 'e', kind: 'effect', items: [{ id: 'x1', source: { type: 'clip', clipId: 'a' }, look: { box: { scale: 0.3 } } }, { id: 'x2', source: { type: 'clip', clipId: 'a' } }, { id: 'x3', source: { type: 'clip', clipId: 'nada' } }] },
      { id: 's', kind: 'sound', items: [{ id: 'x4', source: { type: 'clip', clipId: 'b' }, sourceDurationMs: 1000 }] },
    ]
    const p = parseProject(JSON.stringify(json))
    expect(p.tracks.find((t) => t.id === 'e')!.items.map((i) => i.id)).toEqual(['x1'])
    expect(p.tracks.find((t) => t.id === 's')!.items).toEqual([])
  })
})

describe('«Llevar a una esquina aquí» / «Volver a pantalla completa aquí»', () => {
  it('crea el vídeo del trozo y las dos marcas del viaje', () => {
    const res = moveToCornerAt(base(), 'a', 3000, { itemId: 'v', trackId: 't' })!
    expect(res.move).toBe('to-corner')
    const look = findClipVideoItem(res.project, 'a')!.item.look!
    expect(look.keyframes.map((k) => k.atMs)).toEqual([3000, 3000 + CORNER_TRAVEL_MS])
    expect(isFullFrame(boxAt(look, 2000))).toBe(true)
    expect(boxAt(look, 5000)).toEqual(cornerBox('16:9'))
    // A mitad del viaje, entre los dos.
    const mid = boxAt(look, 3000 + CORNER_TRAVEL_MS / 2)
    expect(mid.scale).toBeGreaterThan(0.3)
    expect(mid.scale).toBeLessThan(0.98)
    // Ya en la esquina, el botón vuelve a pantalla completa.
    expect(cornerMoveAt(res.project, 'a', 6000)).toBe('to-full')
    const back = moveToCornerAt(res.project, 'a', 7000, { itemId: 'otro', trackId: 'otra' })!
    expect(back.move).toBe('to-full')
    const look2 = findClipVideoItem(back.project, 'a')!.item.look!
    expect(look2.keyframes.map((k) => k.atMs)).toEqual([3000, 3800, 7000, 7800])
    expect(isFullFrame(boxAt(look2, 9000))).toBe(true)
    expect(boxAt(look2, 6000)).toEqual(cornerBox('16:9'))
    // No se crea otro: el mismo elemento.
    expect(back.project.tracks.flatMap((t) => t.items).filter((i) => i.source.type === 'clip')).toHaveLength(1)
  })

  it('al final del trozo, el viaje acaba con él; sin vídeo de fondo o sin imagen, no se puede', () => {
    const res = moveToCornerAt(base(), 'a', 9900, { itemId: 'v', trackId: 't' })!
    expect(findClipVideoItem(res.project, 'a')!.item.look!.keyframes.map((k) => k.atMs)).toEqual([10_000 - CORNER_TRAVEL_MS, 10_000])
    expect(moveToCornerAt(base(), 'b', 1000, { itemId: 'v', trackId: 't' })).toBeNull()
    let p = addClip(createProject(), createClip(fakeMedia({ path: 'C:\\voz.m4a', durationMs: 5000, hasVideo: false, width: 0, height: 0 }), 's'))
    p = setCover(p, 's', back)
    expect(moveToCornerAt(p, 's', 1000, { itemId: 'v', trackId: 't' })).toBeNull()
  })
})

describe('va con su trozo', () => {
  const withCorner = () => moveToCornerAt(base(), 'a', 3000, { itemId: 'v', trackId: 't' })!.project

  it('no se mueve, recorta, parte, duplica ni repite por su cuenta', () => {
    const p = withCorner()
    expect(moveItem(p, 'v', 5000)).toBeNull()
    expect(trimItemStart(p, 'v', 2000)).toBe(p)
    expect(trimItemEnd(p, 'v', 4000)).toBe(p)
    expect(splitItem(p, 'v', 5000, 'z')).toBe(p)
    expect(duplicateItem(p, 'v', 'z', { id: 'n' }).ok).toBe(false)
    expect(setItemRepeat(p, 'v', true)).toBe(p)
  })

  it('reordenar el trozo se lo lleva; quitarlo lo quita', () => {
    const p = moveClip(withCorner(), 'a', 1)
    expect(resolveTracks(p).find((r) => r.item.id === 'v')!.startMs).toBe(10_000)
    const q = removeClip(withCorner(), 'a')
    expect(q.tracks.flatMap((t) => t.items)).toEqual([])
  })

  it('recortar el principio del trozo: sigue empezando con él y sus marcas siguen a su imagen', () => {
    const p = setInOut(withCorner(), 'a', { inMs: 1000 })
    const r = resolveTracks(p).find((x) => x.item.id === 'v')!
    expect([r.startMs, r.endMs]).toEqual([0, 9000])
    expect(r.item.look!.keyframes.map((k) => k.atMs)).toEqual([2000, 2800])
  })

  it('partir el trozo: cada parte con el suyo y el mismo camino', () => {
    const before = withCorner()
    const p = splitClip(before, 'a', 3400, 'a2')
    const first = findClipVideoItem(p, 'a')!.item
    const second = findClipVideoItem(p, 'a2')!.item
    expect(second.id).toBe('v~a2')
    const lookBefore = findClipVideoItem(before, 'a')!.item.look!
    for (const t of [0, 3000, 3200, 3399]) expect(boxAt(first.look!, t)).toEqual(boxAt(lookBefore, t))
    for (const t of [3400, 3600, 3800, 6000]) expect(boxAt(second.look!, t - 3400).scale).toBeCloseTo(boxAt(lookBefore, t).scale, 9)
  })

  it('ponerlo quieto en un sitio (lo que hacía la esquina de antes)', () => {
    const p = putClipVideo(base(), 'a', legacyInsetBox({ corner: 'top-right', size: 'small' }, '16:9'), { itemId: 'v', trackId: 't' })
    expect(findClipVideoItem(p, 'a')!.item.look).toMatchObject({ keyframes: [], rounded: true })
    // Los demás efectos de la pista siguen pudiendo ponerse en otro sitio de esa pista.
    const fx = createItem({ id: 'fx', kind: 'effect', source: { type: 'library', assetId: 'chispas' }, name: 'Chispas', sourceDurationMs: 2000, hasAudio: false })
    const r = insertItem(p, fx, 'effect', 12_000, { id: 'n' }, { trackId: 't' })
    expect(r.ok && r.trackId).toBe('t')
    const busy = insertItem(p, fx, 'effect', 2000, { id: 'n' }, { trackId: 't' })
    expect(busy.ok && busy.startMs).toBe(10_000)
  })
})
