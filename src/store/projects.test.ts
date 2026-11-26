// Los vídeos en marcha (la lista de Inicio), la lista de ficheros de cada proyecto y volver a enlazar
// originales movidos, con el bridge falso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { addClip, createClip, createProject, parseProjectFile, serializeProject, setSpeed, type MediaInfo } from '../domain'
import { fakeAudio, fakeMedia } from '../domain/test-helpers'
import { createEditorStore } from './editor'
import { createFakeBridge, mediaSet } from './test-helpers'

const H = 'C:\\v\\horizontal.mp4'
const V = 'C:\\v\\vertical.mp4'
const V2 = 'C:\\v\\vertical2.mp4'
const NOW = new Date(2026, 10, 26, 10, 30).getTime()

function setup(initial: Parameters<typeof createFakeBridge>[0] = {}) {
  const { bridge, state } = createFakeBridge({ media: mediaSet(), ...initial })
  const store = createEditorStore(bridge, { autosaveDelayMs: 500, now: () => NOW })
  return { bridge, state, store }
}

async function settle() {
  await nextTick()
  await vi.advanceTimersByTimeAsync(600)
}

describe('vídeos en marcha', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uno nuevo y vacío no se guarda; con algo, se guarda solo con el nombre de hoy', async () => {
    const { state, store } = setup()
    await store.loadProjects()
    store.startNewProject()
    await settle()
    expect(state.writes).toEqual([])
    await store.addClipsFromPaths([H, V])
    await settle()
    const id = store.projectId.value!
    expect(Object.keys(state.projects)).toEqual([id])
    const saved = parseProjectFile(state.projects[id]!.json)
    expect(saved.name).toBe('Vídeo del 26 de noviembre')
    expect(saved.project.clips).toHaveLength(2)
    expect(store.projects.value).toMatchObject([{ id, name: 'Vídeo del 26 de noviembre', clipCount: 2, durationMs: 18_000 }])
    // Cada cambio se vuelve a guardar; sin cambios, no.
    store.apply((p) => setSpeed(p, p.clips[0]!.id, 2))
    await settle()
    expect(state.writes).toEqual([id, id])
    await store.flushAutosave()
    expect(state.writes).toEqual([id, id])
  })

  it('empezar otro no pierde el anterior: los dos quedan en la lista, con nombres distintos', async () => {
    const { state, store } = setup()
    await store.loadProjects()
    await store.addClipsFromPaths([H])
    store.go('home')
    store.startNewProject()
    await store.addClipsFromPaths([V, V2])
    store.go('home')
    await store.flushAutosave()
    expect(Object.keys(state.projects)).toHaveLength(2)
    expect(store.projects.value.map((p) => p.name).sort()).toEqual(['Vídeo del 26 de noviembre', 'Vídeo del 26 de noviembre (2)'])
    // Abrir el primero trae sus trozos.
    const first = store.projects.value.find((p) => p.clipCount === 1)!
    expect(await store.openProject(first.id)).toBe(true)
    expect(store.screen.value).toBe('editor')
    expect(store.project.value.clips.map((c) => c.sourcePath)).toEqual([H])
    expect(store.projectName.value).toBe(first.name)
  })

  it('volver a Inicio y abrir el mismo sigue con su deshacer', async () => {
    const { store } = setup()
    await store.addClipsFromPaths([H, V])
    store.go('editor')
    store.apply((p) => setSpeed(p, p.clips[0]!.id, 2))
    store.go('home')
    await store.flushAutosave()
    await store.openProject(store.projectId.value!)
    expect(store.screen.value).toBe('editor')
    expect(store.undoable.value).toBe(true)
  })

  it('deshacer sobrevive a cerrar la app (el historial se guarda aparte)', async () => {
    const { bridge, state, store } = setup()
    await store.addClipsFromPaths([H, V])
    store.apply((p) => setSpeed(p, p.clips[0]!.id, 2))
    await settle()
    const id = store.projectId.value!
    expect(state.histories[id]).toBeTruthy()
    // Otra vez la app, con lo mismo en el disco.
    const again = createEditorStore(bridge, { now: () => NOW })
    await again.loadProjects()
    await again.openProject(id)
    expect(again.project.value.clips[0]!.speed).toBe(2)
    expect(again.undoable.value).toBe(true)
    again.undo()
    expect(again.project.value.clips[0]!.speed).toBe(1)
    again.undo()
    expect(again.project.value.clips).toHaveLength(0)
    expect(again.undoable.value).toBe(false)
    again.redo()
    expect(again.project.value.clips).toHaveLength(2)
  })

  it('un historial que no es del vídeo de ahora se descarta (sin deshacer, pero se abre)', async () => {
    const { state, store } = setup()
    let p = addClip(createProject(), createClip(mediaSet()[H]!, 'a'))
    state.projects.x = { json: serializeProject(p, { name: 'Boda' }), modifiedMs: 1 }
    p = addClip(p, createClip(mediaSet()[V]!, 'b'))
    state.histories.x = '{"kind":"easy-cut-history","present":"otro","past":[],"future":[]}'
    await store.loadProjects()
    await store.openProject('x')
    expect(store.project.value.clips.map((c) => c.id)).toEqual(['a'])
    expect(store.undoable.value).toBe(false)
  })

  it('cambiar el nombre, duplicar y borrar (borrar nunca toca los originales, y se puede deshacer)', async () => {
    const { state, store } = setup()
    await store.addClipsFromPaths([H])
    await store.flushAutosave()
    const id = store.projectId.value!
    expect(await store.renameProject(id, '  Cumple   de Ana ')).toBe(true)
    expect(parseProjectFile(state.projects[id]!.json).name).toBe('Cumple de Ana')
    expect(await store.renameProject(id, '   ')).toBe(false)
    const copy = (await store.duplicateProject(id))!
    expect(parseProjectFile(state.projects[copy]!.json)).toMatchObject({ name: 'Cumple de Ana (copia)' })
    expect(store.projects.value.map((p) => p.name).sort()).toEqual(['Cumple de Ana', 'Cumple de Ana (copia)'])
    // Cambiar el nombre de otro que no está abierto.
    expect(await store.renameProject(copy, 'Para la abuela')).toBe(true)
    expect(parseProjectFile(state.projects[copy]!.json).name).toBe('Para la abuela')
    expect(store.projectName.value).toBe('Cumple de Ana')
    // Borrar el abierto: la app se queda con uno vacío, y nada del disco del usuario se borra.
    expect(await store.deleteProject(id)).toBe(true)
    expect(state.projects[id]).toBeUndefined()
    expect(state.deleted).toEqual([])
    expect(state.existing.has(H)).toBe(true)
    expect(store.projectId.value).toBeNull()
    expect(store.project.value.clips).toHaveLength(0)
    expect(store.toast.value?.message).toContain('Tus vídeos originales no se han tocado')
    await store.undoDeleteProject()
    expect(parseProjectFile(state.projects[id]!.json).name).toBe('Cumple de Ana')
    expect(store.projects.value).toHaveLength(2)
  })

  it('pasa el autoguardado de antes a la lista sin perderlo (y solo entonces lo borra)', async () => {
    const media = mediaSet()
    let old = createProject('9:16')
    old = addClip(old, createClip(media[V]!, 'a'))
    old = addClip(old, createClip(media[H]!, 'b'))
    const legacy = serializeProject(old).replace('"version": 4', '"version": 3').replace(/,\s*"media": \[[\s\S]*?\]\n {2}\}/, '\n  }')
    const { state, store } = setup({ autosave: legacy })
    state.existing.delete(H) // el original se ha movido
    await store.loadProjects()
    expect(state.autosave).toBeNull()
    const [entry] = store.projects.value
    expect(entry).toMatchObject({ name: 'Vídeo del 26 de noviembre', clipCount: 2, durationMs: 18_000 })
    const saved = parseProjectFile(state.projects[entry!.id]!.json)
    expect(saved.project.clips.map((c) => c.id)).toEqual(['a', 'b'])
    expect(saved.project.media.map((m) => [m.path, m.probed])).toEqual([
      [V, false],
      [H, false],
    ])
    // Se abre, se miden los ficheros y el que falta se avisa.
    await store.openProject(entry!.id)
    expect(store.missing.value[H]).toBe(true)
    expect(store.project.value.media.find((m) => m.path === V)!.probed).toBe(true)
    expect(store.playableProject.value.clips.map((c) => c.id)).toEqual(['a'])
  })

  it('si no se puede guardar en la lista, el autoguardado de antes se queda como está', async () => {
    const legacy = serializeProject(addClip(createProject(), createClip(mediaSet()[H]!, 'a')))
    const { state, store } = setup({ autosave: legacy, writeFails: true })
    await store.loadProjects()
    expect(state.autosave).toBe(legacy)
    expect(store.projects.value).toEqual([])
  })

  it('un autoguardado dañado no se ofrece ni se borra; uno vacío se borra', async () => {
    const broken = setup({ autosave: '{roto' })
    await broken.store.loadProjects()
    expect(broken.store.projects.value).toEqual([])
    expect(broken.state.autosave).toBe('{roto')
    const empty = setup({ autosave: serializeProject(createProject()) })
    await empty.store.loadProjects()
    expect(empty.state.autosave).toBeNull()
    expect(empty.store.projects.value).toEqual([])
  })

  it('un vídeo dañado en la lista no se enseña (ni se borra)', async () => {
    const { state, store } = setup()
    state.projects.malo = { json: '{', modifiedMs: 5 }
    state.projects.bueno = { json: serializeProject(addClip(createProject(), createClip(mediaSet()[H]!, 'a')), { name: 'Bueno' }), modifiedMs: 6 }
    await store.loadProjects()
    expect(store.projects.value.map((p) => p.name)).toEqual(['Bueno'])
    expect(state.projects.malo).toBeDefined()
  })

  it('volver a la copia anterior', async () => {
    const { state, store } = setup()
    await store.addClipsFromPaths([H])
    await store.flushAutosave()
    const id = store.projectId.value!
    await store.addClipsFromPaths([V])
    await store.flushAutosave()
    expect(state.projects[id]!.backup).toBeTruthy()
    expect(await store.restoreProjectBackup(id)).toBe(true)
    expect(store.project.value.clips).toHaveLength(1)
    expect(store.undoable.value).toBe(false)
  })

  it('guardar en un fichero .easycut y abrir uno', async () => {
    const { state, store } = setup()
    await store.addClipsFromPaths([H])
    await store.renameProject((await store.flushAutosave(), store.projectId.value!), 'Boda')
    await store.exportProject(store.projectId.value!)
    expect(state.exported[0]!.suggestedName).toBe('Boda')
    expect(parseProjectFile(state.exported[0]!.json).name).toBe('Boda')
    state.projectFile = { path: 'D:\\Pen\\Boda.easycut', json: state.exported[0]!.json }
    expect(await store.importProjectFile()).toBe(true)
    expect(store.projectName.value).toBe('Boda (2)')
    expect(store.projects.value).toHaveLength(2)
    state.projectFile = { path: 'D:\\x.easycut', json: 'no' }
    expect(await store.importProjectFile()).toBe(false)
    expect(store.error.value?.message).toMatch(/no es un vídeo de Easy Cut/)
  })
})

describe('lista de ficheros del proyecto en el store', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('lo traído se queda aunque se quite o se deshaga el trozo que lo usaba', async () => {
    const { store } = setup()
    await store.addClipsFromPaths([H])
    await store.addClipsFromPaths([V])
    expect(store.project.value.media.map((m) => m.path)).toEqual([H, V])
    expect(store.project.value.media[1]).toMatchObject({ probed: true, width: 1080, height: 1920 })
    store.undo()
    expect(store.project.value.clips).toHaveLength(1)
    expect(store.project.value.media.map((m) => m.path)).toEqual([H, V])
    store.removeClip(store.project.value.clips[0]!.id)
    expect(store.project.value.media.map((m) => m.path)).toEqual([H, V])
    store.redo()
  })
})

describe('volver a enlazar un original', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const moved = (path: string, from: MediaInfo, over: Partial<MediaInfo> = {}) => fakeMedia({ ...from, path, ...over })

  async function withMissing(paths: string[]) {
    const ctx = setup()
    await ctx.store.addClipsFromPaths([H, V, H])
    for (const p of paths) ctx.state.existing.delete(p)
    await ctx.store.refreshOriginals()
    return ctx
  }

  it('si cuadra, se cambia ya en todos los sitios (un paso de deshacer)', async () => {
    const { bridge, state, store } = await withMissing([H])
    const to = 'D:\\Nuevo\\horizontal.mp4'
    state.media[to] = moved(to, state.media[H]!)
    state.existing.add(to)
    vi.spyOn(bridge, 'pickVideos').mockResolvedValueOnce([to])
    expect(await store.relink(H)).toBe(true)
    expect(store.relinkOffer.value).toBeNull()
    expect(store.project.value.clips.map((c) => c.sourcePath)).toEqual([to, V, to])
    expect(store.hasMissing.value).toBe(false)
    expect(store.toast.value?.message).toBe('Encontrado: arreglado en los 2 sitios donde se usa.')
    store.undo()
    expect(store.project.value.clips.map((c) => c.sourcePath)).toEqual([H, V, H])
  })

  it('si no cuadra, pregunta antes y explica qué no coincide; se puede aceptar igualmente', async () => {
    const { bridge, state, store } = await withMissing([H])
    const to = 'D:\\otro.mp4'
    state.media[to] = fakeMedia({ path: to, durationMs: 4000, width: 640, height: 360 })
    state.existing.add(to)
    const pick = vi.spyOn(bridge, 'pickVideos').mockResolvedValueOnce([to])
    await store.relink(H)
    expect(pick.mock.calls[0]![0]).toMatchObject({ title: '¿Dónde está ahora «horizontal.mp4»?', defaultFolder: 'C:\\v' })
    expect(store.relinkOffer.value?.main.mismatches).toEqual(['Dura 4 s y el de antes duraba 10 s.', 'La imagen es de 640 × 360 y la de antes era de 1920 × 1080.'])
    expect(store.project.value.clips[0]!.sourcePath).toBe(H)
    store.answerRelink(false)
    expect(store.project.value.clips[0]!.sourcePath).toBe(H)
    pick.mockResolvedValueOnce([to])
    await store.relink(H)
    store.answerRelink(true)
    expect(store.project.value.clips[0]).toMatchObject({ sourcePath: to, sourceDurationMs: 4000, segments: [{ startMs: 0, endMs: 4000 }] })
  })

  it('no deja poner algo que no vale (una imagen en lugar de un trozo)', async () => {
    const { bridge, state, store } = await withMissing([H])
    const img = 'D:\\foto.png'
    state.media[img] = fakeMedia({ path: img, isStill: true, durationMs: 0 })
    state.existing.add(img)
    vi.spyOn(bridge, 'pickVideos').mockResolvedValueOnce([img])
    expect(await store.relink(H)).toBe(false)
    expect(store.toast.value?.message).toMatch(/imagen no puede ser un trozo/)
  })

  it('los que faltaban en la misma carpeta se buscan en la nueva y se ofrecen todos a la vez', async () => {
    const { bridge, state, store } = await withMissing([H, V])
    const toH = 'E:\\Movidos\\horizontal.mp4'
    const toV = 'E:\\Movidos\\vertical.mp4'
    state.media[toH] = moved(toH, state.media[H]!)
    state.media[toV] = moved(toV, state.media[V]!, { durationMs: 2000 })
    state.existing.add(toH)
    state.existing.add(toV)
    vi.spyOn(bridge, 'pickVideos').mockResolvedValueOnce([toH])
    await store.relink(H)
    const offer = store.relinkOffer.value!
    expect(offer.main.mismatches).toEqual([])
    expect(offer.siblings.map((s) => [s.oldPath, s.newPath, s.mismatches.length])).toEqual([[V, toV, 1]])
    store.answerRelink(true, [V])
    expect(store.project.value.clips.map((c) => c.sourcePath)).toEqual([toH, toV, toH])
    expect(store.toast.value?.message).toBe('Encontrados 2 ficheros: ya está todo en su sitio.')
    expect(store.hasMissing.value).toBe(false)
  })

  it('también un trozo de solo sonido', async () => {
    const { bridge, state, store } = setup()
    const s = 'C:\\m\\vals.m4a'
    state.media[s] = fakeAudio({ path: s, durationMs: 30_000 })
    state.existing.add(s)
    await store.addClipsFromPaths([s])
    expect(store.project.value.clips).toHaveLength(1)
    state.existing.delete(s)
    await store.refreshOriginals()
    expect(store.missingPaths()).toEqual([s])
    const to = 'D:\\vals.m4a'
    state.media[to] = fakeAudio({ path: to, durationMs: 30_000 })
    state.existing.add(to)
    vi.spyOn(bridge, 'pickVideos').mockResolvedValueOnce([to])
    await store.relink(s)
    expect(store.missingPaths()).toEqual([])
  })
})
