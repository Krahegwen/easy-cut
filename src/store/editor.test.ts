import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createProject, parseProject, serializeProject, setInOut, setSpeed, addClip, createClip } from '../domain'
import { createEditorStore } from './editor'
import { createFakeBridge, mediaSet } from './test-helpers'

const H = 'C:\\v\\horizontal.mp4'
const V = 'C:\\v\\vertical.mp4'
const V2 = 'C:\\v\\vertical2.mp4'

describe('store del editor', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('añade vídeos en el orden elegido, con la forma de la mayoría, y lista los que fallan', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    const res = await store.addClipsFromPaths([V, 'C:\\v\\roto.mp4', H, V2])
    expect(res.added).toBe(3)
    expect(res.failed.map((f) => f.name)).toEqual(['roto.mp4'])
    expect(res.failed[0]!.details).toContain('roto.mp4')
    expect(store.project.value.clips.map((c) => c.sourcePath)).toEqual([V, H, V2])
    expect(store.project.value.aspect).toBe('9:16')
    expect(store.selectedClipId.value).toBe(store.project.value.clips[0]!.id)
    expect(store.durationMs.value).toBe(23_000)
    // Un solo paso de deshacer para todo lo añadido.
    store.undo()
    expect(store.project.value.clips).toHaveLength(0)
    expect(store.selectedClipId.value).toBeNull()
  })

  it('añadir más vídeos no cambia la forma elegida', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H])
    await store.addClipsFromPaths([V, V2])
    expect(store.project.value.aspect).toBe('16:9')
    expect(store.project.value.clips).toHaveLength(3)
  })

  it('quitar un trozo avisa con Deshacer y selecciona el vecino', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H, V, V2])
    const [a, b, c] = store.project.value.clips
    store.select(b!.id)
    store.removeClip(b!.id)
    expect(store.project.value.clips.map((x) => x.id)).toEqual([a!.id, c!.id])
    expect(store.selectedClipId.value).toBe(c!.id)
    expect(store.toast.value?.message).toBe('Trozo quitado. El original sigue en tu ordenador.')
    store.toast.value!.action!()
    expect(store.project.value.clips.map((x) => x.id)).toEqual([a!.id, b!.id, c!.id])
    vi.advanceTimersByTime(10_000)
    expect(store.toast.value).toBeNull()
  })

  it('al cambiar de pantalla se va el aviso de la anterior', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H, V])
    store.go('editor')
    store.removeClip(store.project.value.clips[0]!.id)
    expect(store.toast.value).not.toBeNull()
    store.openClipEditor(store.project.value.clips[0]!.id)
    expect(store.toast.value).toBeNull()
    store.showToast('Trozo partido en dos')
    store.closeClipEditor()
    expect(store.toast.value).toBeNull()
    // El aviso que se da justo después de cambiar sí se queda.
    store.go('save')
    store.showToast('No se ha guardado.')
    expect(store.toast.value?.message).toBe('No se ha guardado.')
  })

  it('mover antes / después y deshacer / rehacer', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H, V, V2])
    const ids = store.project.value.clips.map((c) => c.id)
    store.moveBy(ids[0]!, 1)
    expect(store.project.value.clips.map((c) => c.id)).toEqual([ids[1], ids[0], ids[2]])
    store.moveBy(ids[0]!, 5) // se queda al final
    expect(store.project.value.clips.map((c) => c.id)).toEqual([ids[1], ids[2], ids[0]])
    store.moveTo(ids[0]!, 0)
    expect(store.project.value.clips.map((c) => c.id)).toEqual(ids)
    store.undo()
    store.undo()
    expect(store.project.value.clips.map((c) => c.id)).toEqual([ids[1], ids[0], ids[2]])
    expect(store.redoable.value).toBe(true)
    store.redo()
    expect(store.project.value.clips.map((c) => c.id)).toEqual([ids[1], ids[2], ids[0]])
  })

  it('lo provisional (arrastrar) se ve al momento y entra en el historial como un solo paso', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H])
    const id = store.project.value.clips[0]!.id
    const pastBefore = store.history.value.past.length
    for (const inMs of [500, 1000, 1500]) store.preview((p) => setInOut(p, id, { inMs }))
    expect(store.durationMs.value).toBe(8500)
    expect(store.history.value.past.length).toBe(pastBefore)
    store.commitPreview()
    expect(store.history.value.past.length).toBe(pastBefore + 1)
    store.undo()
    expect(store.durationMs.value).toBe(10_000)
    // Cancelar lo provisional vuelve a lo guardado.
    store.preview((p) => setInOut(p, id, { inMs: 3000 }))
    store.cancelPreview()
    expect(store.durationMs.value).toBe(10_000)
  })

  it('«Deshacer los cambios de este trozo» vuelve a como estaba al entrar, también tras partir', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H, V])
    const id = store.project.value.clips[0]!.id
    store.openClipEditor(id)
    expect(store.screen.value).toBe('clip')
    store.apply((p) => setSpeed(p, id, 2))
    store.apply((p) => setInOut(p, id, { outMs: 6000 }))
    store.revertClipChanges()
    expect(store.project.value).toEqual(store.editingEntry.value)
    expect(store.durationMs.value).toBe(18_000)
    store.closeClipEditor()
    expect(store.screen.value).toBe('editor')
    expect(store.editingClipId.value).toBeNull()
  })

  it('si se deshace hasta que el trozo en edición no existe, vuelve a la pantalla principal', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H])
    store.openClipEditor(store.project.value.clips[0]!.id)
    store.undo()
    expect(store.screen.value).toBe('editor')
    expect(store.editingClipId.value).toBeNull()
  })

  it('autoguarda con espera tras cada cambio y borra el autoguardado si no quedan trozos', async () => {
    const { bridge, state } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge, { autosaveDelayMs: 500 })
    await store.addClipsFromPaths([H, V])
    await nextTick()
    expect(state.autosave).toBeNull()
    await vi.advanceTimersByTimeAsync(600)
    expect(parseProject(state.autosave!).clips).toHaveLength(2)
    store.removeClip(store.project.value.clips[0]!.id)
    store.removeClip(store.project.value.clips[0]!.id)
    await nextTick()
    await vi.advanceTimersByTimeAsync(600)
    expect(state.autosave).toBeNull()
  })

  it('ofrece seguir con un autoguardado y vuelve a comprobar los originales', async () => {
    const media = mediaSet()
    let saved = createProject('9:16')
    saved = addClip(saved, createClip(media[V]!, 'a'))
    saved = addClip(saved, createClip(media[H]!, 'b'))
    const { bridge, state } = createFakeBridge({ media, autosave: serializeProject(saved) })
    state.existing.delete(H) // el original se ha movido
    const store = createEditorStore(bridge)
    await store.loadAutosaveSummary()
    expect(store.autosave.value).toMatchObject({ clipCount: 2, durationMs: 18_000 })
    await store.resumeAutosave()
    expect(store.screen.value).toBe('editor')
    expect(store.project.value.clips.map((c) => c.id)).toEqual(['a', 'b'])
    expect(store.missing.value[H]).toBe(true)
    expect(store.missing.value[V]).toBeUndefined()
    expect(store.hasMissing.value).toBe(true)
    // La vista previa no incluye el que falta; no se puede arreglar.
    expect(store.playableProject.value.clips.map((c) => c.id)).toEqual(['a'])
    store.openClipEditor('b')
    expect(store.screen.value).toBe('editor')
    expect(store.undoable.value).toBe(false)
  })

  it('un autoguardado dañado o vacío no se ofrece', async () => {
    const { bridge } = createFakeBridge({ autosave: '{roto' })
    const store = createEditorStore(bridge)
    await store.loadAutosaveSummary()
    expect(store.autosave.value).toBeNull()
  })

  it('empezar uno nuevo borra el autoguardado y el proyecto', async () => {
    const { bridge, state } = createFakeBridge({ media: mediaSet(), autosave: 'x' })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H])
    store.startNewProject()
    await Promise.resolve()
    expect(store.project.value.clips).toHaveLength(0)
    expect(state.autosave).toBeNull()
    expect(store.undoable.value).toBe(false)
  })

  it('proxy de vista previa: se pide una vez y cambia la URL', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const spy = vi.spyOn(bridge, 'makePreviewProxy')
    const store = createEditorStore(bridge)
    expect(store.mediaSrc(H)).toBe(`asset://${H}`)
    await Promise.all([store.ensureProxy(H), store.ensureProxy(H)])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.mediaSrc(H)).toBe(`asset://${H}.proxy.mp4`)
  })

  it('miniaturas cacheadas por instante redondeado', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const spy = vi.spyOn(bridge, 'thumbnails')
    const store = createEditorStore(bridge)
    const [a, b] = await store.thumbnails(H, [1000, 1020], 90)
    expect(a?.url).toBe(b?.url)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
