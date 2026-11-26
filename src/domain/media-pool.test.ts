import { describe, expect, it } from 'vitest'
import {
  compareMedia,
  describeMediaEntry,
  describeUsage,
  durationToleranceMs,
  folderOf,
  mediaUsage,
  poolActions,
  poolForDisplay,
  relinkMedia,
  relinkProblem,
  siblingCandidates,
  usageTotal,
} from './media-pool'
import {
  addClip,
  createClip,
  createProject,
  mediaEntryFromInfo,
  mergeMediaPool,
  parseProject,
  removeClip,
  serializeProject,
  setCover,
  syncMediaPool,
  upsertMediaEntry,
  usedMediaPaths,
  type MediaEntry,
  type Project,
} from './project'
import { fakeAudio, fakeMedia } from './test-helpers'
import { addTrack, createItem, createTrack, insertItem } from './tracks'

const V = 'C:\\Vídeos\\boda.mp4'
const V2 = 'C:\\Vídeos\\banquete.mp4'
const S = 'C:\\Música\\vals.m4a'
const IMG = 'C:\\Imágenes\\logo.png'

const video = fakeMedia({ path: V, durationMs: 20_000 })
const video2 = fakeMedia({ path: V2, durationMs: 8_000, width: 1280, height: 720 })
const sound = fakeAudio({ path: S, durationMs: 30_000 })
const image = fakeMedia({ path: IMG, durationMs: 0, isStill: true, hasAudio: false, hasAlpha: true, width: 400, height: 200 })

function withItem(p: Project, path: string, kind: 'sound' | 'effect', id: string, info: { durationMs: number; still?: boolean; hasAudio?: boolean }): Project {
  const item = createItem({ id, kind, source: { type: 'file', path }, name: id, sourceDurationMs: info.durationMs, still: info.still ?? false, hasAudio: info.hasAudio ?? true })
  const res = insertItem(p, item, kind, 0, { id: `t-${id}` })
  if (!res.ok) throw new Error('no cabe')
  return res.project
}

/** Un proyecto con un vídeo dos veces (una con otro vídeo encima), un sonido en una pista y una imagen. */
function sample(): Project {
  // Como en la app: la lista se pone al día en cada cambio (así queda en el orden en que se trajo).
  const known = { [V]: video, [V2]: video2, [S]: sound, [IMG]: image }
  let p = createProject()
  p = syncMediaPool(addClip(p, createClip(video, 'a')), known)
  p = syncMediaPool(addClip(p, createClip(video, 'b')), known)
  p = syncMediaPool(setCover(p, 'b', video2), known)
  p = syncMediaPool(withItem(p, S, 'sound', 's1', { durationMs: 30_000 }), known)
  return syncMediaPool(withItem(p, IMG, 'effect', 'logo', { durationMs: 0, still: true, hasAudio: false }), known)
}

describe('lista de ficheros del proyecto', () => {
  it('guarda lo que da ffprobe de cada fichero que se usa, en el orden en que se trajo', () => {
    const p = sample()
    expect(p.media.map((m) => m.path)).toEqual([V, V2, S, IMG])
    expect(p.media.map((m) => m.kind)).toEqual(['video', 'video', 'sound', 'image'])
    expect(p.media[1]).toMatchObject({ durationMs: 8000, width: 1280, height: 720, hasAudio: true, fps: 30, probed: true })
    expect(p.media[3]).toMatchObject({ durationMs: 0, hasAudio: false, hasAlpha: true, probed: true })
    expect(p.media[2]).toMatchObject({ hasVideo: false, width: 0, height: 0, fps: 0 })
  })

  it('un fichero se queda en la lista aunque se quite el trozo que lo usaba', () => {
    let p = sample()
    p = removeClip(removeClip(p, 'a'), 'b')
    // Las pistas de efectos van encima de las de sonido.
    expect(usedMediaPaths(p)).toEqual([IMG, S])
    expect(syncMediaPool(p).media.map((m) => m.path)).toEqual([V, V2, S, IMG])
  })

  it('syncMediaPool no cambia nada si ya está todo (mismo objeto)', () => {
    const p = sample()
    expect(syncMediaPool(p)).toBe(p)
    expect(syncMediaPool(p, { [V]: video })).toBe(p)
  })

  it('sin medir, lo que dice el proyecto; al medirlo se completa', () => {
    const p = syncMediaPool(addClip(createProject(), createClip(fakeAudio({ path: S, durationMs: 9000 }), 'a')))
    expect(p.media[0]).toMatchObject({ path: S, kind: 'sound', durationMs: 9000, probed: false })
    const q = syncMediaPool(p, { [S]: sound })
    expect(q.media[0]).toMatchObject({ durationMs: 30_000, probed: true })
  })

  it('upsertMediaEntry pone o actualiza (mismo objeto si ya estaba igual)', () => {
    const p = sample()
    expect(upsertMediaEntry(p, video)).toBe(p)
    const q = upsertMediaEntry(p, { ...video, durationMs: 21_000 })
    expect(q.media[0]!.durationMs).toBe(21_000)
    expect(upsertMediaEntry(createProject(), sound).media).toHaveLength(1)
  })

  it('mergeMediaPool une con la lista más nueva (lo traído no se deshace)', () => {
    const before = addClip(createProject(), createClip(video, 'a'))
    const old = syncMediaPool(before, { [V]: video })
    const newer = syncMediaPool(addClip(old, createClip(sound, 'b')), { [S]: sound })
    const merged = mergeMediaPool(old, newer.media)
    expect(merged.clips.map((c) => c.id)).toEqual(['a'])
    expect(merged.media.map((m) => m.path)).toEqual([V, S])
    expect(mergeMediaPool(merged, newer.media)).toBe(merged)
    // Para un mismo fichero, gana la lista nueva.
    const probedAgain = mergeMediaPool(old, [{ ...old.media[0]!, durationMs: 1 }])
    expect(probedAgain.media[0]!.durationMs).toBe(1)
  })

  it('se guarda y se lee con el proyecto', () => {
    const p = sample()
    const back = parseProject(serializeProject(p))
    expect(back.media).toEqual(p.media)
  })

  it('una entrada dañada se descarta y lo que usa el proyecto se vuelve a poner', () => {
    const json = JSON.parse(serializeProject(sample()))
    json.project.media = [{ path: V, kind: 'raro' }, 'nada', { path: '', kind: 'video' }, { ...json.project.media[2], durationMs: 'mucho', sizeBytes: -1 }]
    const back = parseProject(JSON.stringify(json))
    expect(back.media.map((m) => m.path)).toEqual([S, V, V2, IMG])
    expect(back.media[0]).toMatchObject({ durationMs: 0, sizeBytes: null })
    expect(back.media[1]).toMatchObject({ probed: false, durationMs: 20_000 })
  })
})

describe('migración de los proyectos de antes a la versión 4', () => {
  const clipV1 = { id: 'a', sourcePath: V, sourceDurationMs: 20_000, segments: [{ startMs: 0, endMs: 20_000 }] }

  it('versión 1: la lista sale de los trozos (vídeos), sin medir', () => {
    const p = parseProject(JSON.stringify({ app: 'easy-cut', version: 1, project: { aspect: '16:9', clips: [clipV1] } }))
    expect(p.version).toBe(6)
    expect(p.media).toEqual([{ path: V, kind: 'video', durationMs: 20_000, hasVideo: true, hasAudio: true, width: 0, height: 0, fps: 0, sizeBytes: null, hasAlpha: false, probed: false }])
  })

  it('versión 2: sonidos y vídeos de encima', () => {
    const p = parseProject(
      JSON.stringify({
        app: 'easy-cut',
        version: 2,
        project: {
          aspect: '16:9',
          clips: [
            { ...clipV1, id: 'a', sourcePath: S, sourceDurationMs: 30_000, segments: [{ startMs: 0, endMs: 30_000 }], sourceHasVideo: false, picture: { kind: 'cover', sourcePath: V2, sourceDurationMs: 8000, startMs: 0 } },
          ],
        },
      }),
    )
    expect(p.media.map((m) => [m.path, m.kind, m.durationMs])).toEqual([
      [S, 'sound', 30_000],
      [V2, 'video', 8000],
    ])
  })

  it('versión 3: también lo de las pistas (una imagen, un sonido y un vídeo como efecto), no lo de la biblioteca', () => {
    const v3 = JSON.parse(serializeProject(sample()))
    v3.version = 3
    delete v3.project.media
    v3.project.tracks[0].items.push({ ...v3.project.tracks[0].items[0], id: 'lib', source: { type: 'library', assetId: 'aplausos' }, anchor: { clipId: null, offsetMs: 25_000 } })
    const p = parseProject(JSON.stringify(v3))
    expect(p.media.map((m) => [m.path, m.kind, m.probed])).toEqual([
      [V, 'video', false],
      [V2, 'video', false],
      [IMG, 'image', false],
      [S, 'sound', false],
    ])
    expect(p.media[2]).toMatchObject({ durationMs: 0, hasAudio: false })
    expect(p.tracks[0]!.items).toHaveLength(2)
  })

  it('una versión más nueva que la de la app no se lee', () => {
    expect(() => parseProject(JSON.stringify({ app: 'easy-cut', version: 7, project: { clips: [] } }))).toThrow(/más nueva/)
  })
})

describe('usos de cada fichero', () => {
  it('cuenta trozos, vídeos de encima, sonidos y efectos', () => {
    const u = mediaUsage(sample())
    expect(u.get(V)).toEqual({ clips: 2, covers: 0, sounds: 0, effects: 0 })
    expect(u.get(V2)).toEqual({ clips: 0, covers: 1, sounds: 0, effects: 0 })
    expect(u.get(S)).toEqual({ clips: 0, covers: 0, sounds: 1, effects: 0 })
    expect(usageTotal(u.get(IMG)!)).toBe(1)
    expect(u.has('C:\\otro.mp4')).toBe(false)
  })

  it('en llano', () => {
    expect(describeUsage({ clips: 2, covers: 1, sounds: 0, effects: 0 })).toBe('Se usa 3 veces')
    expect(describeUsage({ clips: 0, covers: 0, sounds: 1, effects: 0 })).toBe('Se usa 1 vez')
    expect(describeUsage({ clips: 0, covers: 0, sounds: 0, effects: 0 })).toBe('Ahora no se usa')
    const p = sample()
    expect(p.media.map(describeMediaEntry)).toEqual(['Vídeo · 20 s', 'Vídeo · 8 s', 'Sonido · 30 s', 'Imagen'])
  })

  it('qué se puede hacer con cada tipo (una imagen no puede ser trozo)', () => {
    const [v, , s, img] = sample().media as [MediaEntry, MediaEntry, MediaEntry, MediaEntry]
    expect(poolActions(v)).toEqual({ clip: true, effect: true, sound: true })
    expect(poolActions({ ...v, hasAudio: false })).toEqual({ clip: true, effect: true, sound: false })
    expect(poolActions(s)).toEqual({ clip: true, effect: false, sound: true })
    expect(poolActions(img)).toEqual({ clip: false, effect: true, sound: false })
  })

  it('«De mi ordenador» enseña primero lo último que se trajo', () => {
    expect(poolForDisplay(sample()).map((m) => m.path)).toEqual([IMG, S, V2, V])
  })
})

describe('volver a enlazar', () => {
  const before = mediaEntryFromInfo(video)

  it('un fichero igual cuadra (la duración, con un margen)', () => {
    expect(compareMedia(before, { ...video, path: 'D:\\boda.mp4' })).toEqual([])
    expect(compareMedia(before, { ...video, path: 'D:\\boda.mp4', durationMs: 20_250 })).toEqual([])
    expect(durationToleranceMs(60_000)).toBe(1200)
  })

  it('explica en llano qué no cuadra: duración, tamaño, sonido y tipo', () => {
    const other = fakeMedia({ path: 'D:\\otro.mp4', durationMs: 83_000, width: 1280, height: 720, hasAudio: false })
    expect(compareMedia(before, other)).toEqual([
      'Dura 1 min 23 s y el de antes duraba 20 s.',
      'La imagen es de 1280 × 720 y la de antes era de 1920 × 1080.',
      'No tiene sonido y el de antes sí.',
    ])
    expect(compareMedia(before, fakeAudio({ path: 'D:\\voz.m4a', durationMs: 20_000 }))).toEqual(['Es un sonido y el de antes era un vídeo.'])
    expect(compareMedia(before, { ...video, durationMs: 20_450 })).toEqual(['Dura un poco más que el de antes.'])
  })

  it('de lo que no se llegó a medir (proyecto antiguo) solo se compara la duración y el tipo', () => {
    const old = parseProject(JSON.stringify({ app: 'easy-cut', version: 1, project: { clips: [{ id: 'a', sourcePath: V, sourceDurationMs: 20_000, segments: [{ startMs: 0, endMs: 20_000 }] }] } })).media[0]!
    expect(compareMedia(old, fakeMedia({ path: 'D:\\x.mp4', durationMs: 20_000, width: 640, height: 480, hasAudio: false }))).toEqual([])
  })

  it('cambia el fichero en todos los sitios a la vez, conservándolo todo', () => {
    let p = sample()
    p = withItem(p, V, 'effect', 'fx', { durationMs: 20_000 })
    const moved = { ...video, path: 'D:\\Nuevo\\boda.mp4' }
    const q = relinkMedia(p, V, moved)
    expect(q.clips.map((c) => c.sourcePath)).toEqual([moved.path, moved.path])
    expect(q.clips.map((c) => c.segments)).toEqual(p.clips.map((c) => c.segments))
    expect(q.clips[1]!.picture).toEqual(p.clips[1]!.picture)
    expect(q.tracks.flatMap((t) => t.items).find((i) => i.id === 'fx')!.source).toEqual({ type: 'file', path: moved.path })
    expect(usedMediaPaths(q)).not.toContain(V)
    // La entrada de la lista pasa a ser la del nuevo, en el mismo sitio.
    expect(q.media.map((m) => m.path)).toEqual([moved.path, V2, S, IMG])
  })

  it('el vídeo de encima y la imagen de una pista también', () => {
    const p = sample()
    const q = relinkMedia(p, V2, { ...video2, path: 'E:\\banquete.mp4' })
    expect(q.clips[1]!.picture).toMatchObject({ kind: 'cover', sourcePath: 'E:\\banquete.mp4' })
    const r = relinkMedia(p, IMG, { ...image, path: 'E:\\logo.png' })
    expect(r.tracks.flatMap((t) => t.items).find((i) => i.id === 'logo')).toMatchObject({ source: { path: 'E:\\logo.png' }, still: true })
  })

  it('si el nuevo dura menos, lo usado se recorta a lo que hay (o se usa entero)', () => {
    let p = createProject()
    p = addClip(p, { ...createClip(video, 'a'), segments: [{ startMs: 2000, endMs: 6000 }, { startMs: 12_000, endMs: 18_000 }] })
    p = addClip(p, { ...createClip(video, 'b'), segments: [{ startMs: 15_000, endMs: 19_000 }] })
    const q = relinkMedia(p, V, { ...video, path: 'D:\\corto.mp4', durationMs: 10_000 })
    expect(q.clips[0]!.segments).toEqual([{ startMs: 2000, endMs: 6000 }])
    expect(q.clips[0]!.sourceDurationMs).toBe(10_000)
    expect(q.clips[1]!.segments).toEqual([{ startMs: 0, endMs: 10_000 }])
  })

  it('un sonido en lugar de un vídeo: el trozo pasa a «Solo se oye»', () => {
    const p = addClip(createProject(), createClip(video, 'a'))
    const q = relinkMedia(p, V, fakeAudio({ path: 'D:\\voz.m4a', durationMs: 20_000 }))
    expect(q.clips[0]).toMatchObject({ sourceHasVideo: false, picture: { kind: 'none' } })
  })

  it('si el fichero nuevo ya estaba en la lista, no se repite', () => {
    let p = sample()
    p = relinkMedia(p, V2, { ...video, path: V })
    expect(p.media.map((m) => m.path)).toEqual([V, S, IMG])
  })

  it('no hace nada si el fichero no se usa ni está en la lista', () => {
    const p = sample()
    expect(relinkMedia(p, 'C:\\nada.mp4', video)).toBe(p)
  })

  it('dice si el nuevo no vale para alguno de los sitios donde se usa', () => {
    const u = mediaUsage(sample())
    expect(relinkProblem(u.get(V)!, image)).toMatch(/imagen no puede ser un trozo/)
    expect(relinkProblem(u.get(V2)!, sound)).toMatch(/hace falta un vídeo/)
    expect(relinkProblem(u.get(S)!, fakeMedia({ path: 'x.mp4', hasAudio: false }))).toMatch(/no tiene sonido/)
    expect(relinkProblem(u.get(IMG)!, sound)).toMatch(/no se puede ver/)
    expect(relinkProblem(u.get(V)!, sound)).toBeNull()
    expect(relinkProblem(u.get(IMG)!, video)).toBeNull()
  })

  it('los que faltaban en la misma carpeta se buscan en la nueva por su nombre', () => {
    const missing = ['C:\\Viejo\\a.mp4', 'C:\\Viejo\\b.m4a', 'C:\\viejo\\c.png', 'C:\\Otro\\d.mp4', 'C:\\Viejo\\Sub\\e.mp4']
    expect(siblingCandidates(missing, 'C:\\Viejo\\a.mp4', 'D:\\Nuevo\\a (1).mp4')).toEqual([
      { oldPath: 'C:\\Viejo\\b.m4a', newPath: 'D:\\Nuevo\\b.m4a' },
      { oldPath: 'C:\\viejo\\c.png', newPath: 'D:\\Nuevo\\c.png' },
    ])
    // Si se ha elegido otro fichero de la misma carpeta, no hay nada que buscar.
    expect(siblingCandidates(missing, 'C:\\Viejo\\a.mp4', 'C:\\Viejo\\otro.mp4')).toEqual([])
    expect(folderOf('C:\\a\\b.mp4')).toBe('C:\\a')
    expect(folderOf('b.mp4')).toBe('')
  })

  it('sigue valiendo tras quitar pistas y trozos (lista monótona)', () => {
    let p = sample()
    p = addTrack(p, createTrack('sound', 'vacía', 'Vacía'))
    expect(syncMediaPool(p)).toBe(p)
  })
})
