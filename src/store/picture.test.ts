// Store y guardado con sonidos, vídeo de encima y «Solo el sonido» (sin Tauri ni ffmpeg).
import { describe, expect, it } from 'vitest'
import { findClip, setPicture } from '../domain'
import { fakeAudio, fakeMedia } from '../domain/test-helpers'
import { createEditorStore } from './editor'
import { startExport } from './exporter'
import { createFakeBridge, mediaSet } from './test-helpers'

const H = 'C:\\v\\horizontal.mp4'
const V = 'C:\\v\\vertical.mp4'
const VOICE = 'C:\\v\\voz.m4a'
const date = new Date(2026, 10, 25)

function media() {
  return { ...mediaSet(), [VOICE]: fakeAudio({ path: VOICE, durationMs: 6_000 }) }
}

describe('sonidos y vídeo de encima en el store', () => {
  it('un fichero de sonido entra como trozo «Solo se oye» y no decide la forma', async () => {
    const { bridge } = createFakeBridge({ media: media() })
    const store = createEditorStore(bridge, { autosaveDelayMs: 0 })
    const res = await store.addClipsFromPaths([VOICE, V])
    expect(res.added).toBe(2)
    const [s, v] = store.project.value.clips
    expect(s!.picture).toEqual({ kind: 'none' })
    expect(s!.sourceHasVideo).toBe(false)
    expect(v!.picture).toEqual({ kind: 'own' })
    expect(store.project.value.aspect).toBe('9:16')
    expect(store.durationMs.value).toBe(14_000)
  })

  it('«Elegir el vídeo» de encima: un solo fichero, solo con imagen, y se deshace en un paso', async () => {
    const m = media()
    const { bridge } = createFakeBridge({ media: m })
    let asked: unknown = null
    bridge.pickVideos = async (o) => {
      asked = o
      return [H]
    }
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([VOICE])
    const id = store.project.value.clips[0]!.id
    expect(await store.pickCover(id)).toBe(true)
    expect(asked).toEqual({ multiple: false })
    expect(findClip(store.project.value, id)!.picture).toMatchObject({ kind: 'cover', sourcePath: H, startMs: 0 })
    store.undo()
    expect(findClip(store.project.value, id)!.picture).toEqual({ kind: 'none' })
    // Un sonido no vale como vídeo de encima.
    bridge.pickVideos = async () => [VOICE]
    expect(await store.pickCover(id)).toBe(false)
    expect(store.toast.value?.message).toContain('no tiene imagen')
  })

  it('si el vídeo de encima desaparece: aviso de que falta, vista previa con lo de serie y no se guarda', async () => {
    const m = media()
    const { bridge, state } = createFakeBridge({ media: m })
    bridge.pickVideos = async () => [V]
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H])
    const id = store.project.value.clips[0]!.id
    await store.pickCover(id)
    expect(store.hasMissing.value).toBe(false)
    state.existing.delete(V)
    await store.refreshOriginals()
    const clip = findClip(store.project.value, id)!
    expect(store.coverMissing(clip)).toBe(true)
    expect(store.hasMissing.value).toBe(true)
    expect(store.playableProject.value.clips[0]!.picture).toEqual({ kind: 'own' })
    // El trozo sigue ahí; quitar el vídeo de encima lo arregla.
    store.apply((p) => setPicture(p, id, { kind: 'own' }))
    expect(store.hasMissing.value).toBe(false)
  })
})

describe('guardar «Solo el sonido»', () => {
  it('M4A con nombre propio, sin encoder de vídeo y con el filtro en un fichero', async () => {
    const m = media()
    const { bridge, state } = createFakeBridge({ media: m })
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([H, VOICE])
    state.files.add('C:\\Users\\Ana\\Videos\\Mis montajes\\Sonido del 25 de noviembre de 2026.m4a')
    const res = await startExport(bridge, { project: store.project.value, media: m, preset: 'sound', now: () => date }).result
    expect(res.path).toBe('C:\\Users\\Ana\\Videos\\Mis montajes\\Sonido del 25 de noviembre de 2026 2.m4a')
    expect(res.encoder).toBeNull()
    expect(res.expectedDurationMs).toBe(16_000)
    const args = state.ffmpegRuns[0]!.args
    expect(args).not.toContain('-c:v')
    expect(args[args.indexOf('-b:a') + 1]).toBe('192k')
    const script = args[args.indexOf('-/filter_complex') + 1]!
    expect(state.tempFiles[script]).toContain('concat=n=2:v=0:a=1[aout]')
  })

  it('no hace falta el vídeo de encima para guardar solo el sonido', async () => {
    const cover = fakeMedia({ path: 'C:\\v\\encima.mp4' })
    const m = { ...media(), [cover.path]: cover }
    const { bridge, state } = createFakeBridge({ media: m })
    bridge.pickVideos = async () => [cover.path]
    const store = createEditorStore(bridge)
    await store.addClipsFromPaths([VOICE])
    await store.pickCover(store.project.value.clips[0]!.id)
    state.existing.delete(cover.path)
    const video = await startExport(bridge, { project: store.project.value, media: m, preset: 'whatsapp', now: () => date }).result.catch((e) => e)
    expect(video.message).toContain('No encuentro')
    const sound = await startExport(bridge, { project: store.project.value, media: m, preset: 'sound', now: () => date }).result
    expect(sound.path.endsWith('.m4a')).toBe(true)
  })
})
