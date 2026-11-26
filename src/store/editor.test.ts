import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { setInOut, setSpeed } from '../domain'
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

  it('proxy de vista previa: se pide una vez y cambia la URL', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const spy = vi.spyOn(bridge, 'makePreviewProxy')
    const store = createEditorStore(bridge)
    expect(store.mediaSrc(H)).toBe(`asset://${H}`)
    await Promise.all([store.ensureProxy(H), store.ensureProxy(H)])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(store.mediaSrc(H)).toBe(`asset://${H}.proxy.mp4`)
  })

  it('una grabación entra al final, elegida, con la duración máxima y la oferta de quitar pausas', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H, V])
    store.select(store.project.value.clips[0]!.id)
    expect(await store.addRecording(V2, { targetMs: 300_000 })).toBe(true)
    const clips = store.project.value.clips
    expect(clips.map((c) => c.sourcePath)).toEqual([H, V, V2])
    expect(store.selectedClipId.value).toBe(clips[2]!.id)
    expect(store.recordingOffer.value).toBe(clips[2]!.id)
    expect(store.project.value.targetDurationMs).toBe(300_000)
    // Abrir «Arreglar este trozo» en Quitar pausas consume la oferta.
    store.openClipEditor(clips[2]!.id, { tab: 'pauses', findPauses: true })
    expect(store.screen.value).toBe('clip')
    expect(store.clipEditorStart.value).toEqual({ tab: 'pauses', findPauses: true })
    expect(store.recordingOffer.value).toBeNull()
  })

  it('una grabación en un vídeo nuevo descarta el anterior; un fichero ilegible no añade nada', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H])
    expect(await store.addRecording(V, { fresh: true })).toBe(true)
    expect(store.project.value.clips.map((c) => c.sourcePath)).toEqual([V])
    expect(store.project.value.targetDurationMs).toBeNull()
    expect(await store.addRecording('C:\\v\\roto.mp4')).toBe(false)
    expect(store.project.value.clips).toHaveLength(1)
  })

  it('recuerda de qué pantalla se vino', () => {
    const { bridge } = createFakeBridge()
    const store = createEditorStore(bridge)
    store.go('editor')
    store.go('teleprompter')
    expect(store.previousScreen.value).toBe('editor')
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

describe('copiar y pegar trozos', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pega el trozo copiado detrás del elegido, con sus ajustes, id nuevo y un solo paso de deshacer', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H, V])
    const [a, b] = store.project.value.clips
    store.apply((p) => setSpeed(setInOut(p, a!.id, { inMs: 1000, outMs: 7000 }), a!.id, 2))
    const before = store.durationMs.value
    const copied = store.project.value.clips[0]!
    store.select(a!.id)
    await store.copyClip(a!.id)
    expect(store.toast.value?.message).toBe('Trozo copiado')
    expect(store.pasteAvailable.value).toBe(true)
    const steps = store.history.value.past.length
    const id = store.pasteCopiedClip()
    const clips = store.project.value.clips
    expect(clips.map((c) => c.id)).toEqual([a!.id, id, b!.id])
    expect(id).not.toBe(a!.id)
    expect(store.selectedClipId.value).toBe(id)
    const { id: _x, ...pasted } = clips[1]!
    const { id: _y, ...original } = copied
    expect(pasted).toEqual(original)
    expect(store.durationMs.value).toBe(before + 3000)
    expect(store.history.value.past.length).toBe(steps + 1)
    expect(store.toast.value?.message).toBe('Trozo pegado: es el trozo 2.')
    store.undo()
    expect(store.project.value.clips.map((c) => c.id)).toEqual([a!.id, b!.id])
    expect(store.durationMs.value).toBe(before)
  })

  it('se pega el trozo como estaba al copiarlo, aunque luego se cambie o se quite', async () => {
    const { bridge } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H])
    const a = store.project.value.clips[0]!
    await store.copyClip(a.id)
    store.apply((p) => setSpeed(p, a.id, 4))
    store.removeClip(a.id)
    store.pasteCopiedClip()
    expect(store.project.value.clips).toHaveLength(1)
    expect(store.project.value.clips[0]!.speed).toBe(1)
  })

  it('ficheros copiados después en el Explorador ganan; los que ya estaban, no', async () => {
    const { bridge, state } = createFakeBridge({ media: mediaSet(), clipboard: { sequence: 10, paths: ['C:\\v\\viejo.mp4'] } })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H])
    expect((await store.pasteSource()).kind).toBe('files')
    await store.copyClip(store.project.value.clips[0]!.id)
    // El portapapeles no ha cambiado desde que se copió el trozo: los ficheros viejos no ganan.
    expect((await store.pasteSource()).kind).toBe('clip')
    state.clipboard = { sequence: 11, paths: ['C:\\v\\nuevo.mp4', 'C:\\v\\nota.txt'] }
    expect(await store.pasteSource()).toEqual({ kind: 'files', paths: ['C:\\v\\nuevo.mp4'] })
  })

  it('sin nada copiado no ofrece pegar; refrescar el portapapeles lo activa', async () => {
    const { bridge, state } = createFakeBridge({ media: mediaSet() })
    const store = createEditorStore(bridge)
    await store.refreshSystemClipboard()
    expect(store.pasteAvailable.value).toBe(false)
    state.clipboard = { sequence: 2, paths: ['C:\\v\\h.mp4'] }
    await store.refreshSystemClipboard()
    expect(store.pasteAvailable.value).toBe(true)
  })

})
