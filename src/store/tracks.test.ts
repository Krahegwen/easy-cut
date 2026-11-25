// Pistas y biblioteca en el store, con el bridge falso: poner desde la biblioteca (descarga y su información),
// desde el ordenador, quitar el trozo ancla con aviso, la vista, quitar una pista con pregunta y guardar.
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { findItem, resolveTracks } from '../domain'
import { fakeAudio, fakeMedia } from '../domain/test-helpers'
import { confirmRequest } from '../lib/confirm'
import { createEditorStore } from './editor'
import { createLibraryStore, mediaFromAsset } from './library'
import { createSaveFlow } from './save-flow'
import { createTracksStore } from './tracks'
import { createFakeBridge, mediaSet } from './test-helpers'

const H = 'C:\\v\\horizontal.mp4'
const MUSIC = 'C:\\m\\Música.mp3'
const LOGO = 'C:\\m\\logo.png'

function setup() {
  const media = {
    ...mediaSet(),
    [MUSIC]: fakeAudio({ path: MUSIC, durationMs: 4000 }),
    [LOGO]: fakeMedia({ path: LOGO, durationMs: 0, hasAudio: false, width: 400, height: 200, isStill: true, hasAlpha: true }),
  }
  const { bridge, state } = createFakeBridge({ media })
  const editor = createEditorStore(bridge, { autosaveDelayMs: 10_000 })
  const library = createLibraryStore(bridge, editor.setMedia)
  const tracks = createTracksStore(editor, library)
  return { editor, library, tracks, state }
}

async function withClips(s: ReturnType<typeof setup>) {
  await s.editor.addClipsFromPaths([H, H])
  return s.editor.project.value.clips.map((c) => c.id)
}

describe('pistas en el store', () => {
  it('«Poner aquí» desde la biblioteca: descarga, información del catálogo y pista nueva; la vista pasa a pistas', async () => {
    const s = setup()
    await withClips(s)
    expect(s.tracks.view.value).toBe('cards')
    const ding = s.library.asset('ding')!
    const id = await s.tracks.addAsset(ding, 12_000)
    await nextTick()
    expect(id).not.toBeNull()
    expect(s.state.libraryFetches).toEqual(['ding.m4a'])
    const path = 'C:\\cache\\library\\ding.m4a'
    expect(s.editor.media.value[path]).toEqual(mediaFromAsset(ding, path))
    expect(s.library.itemPath(findItem(s.editor.project.value, id!)!.item)).toBe(path)
    expect(s.tracks.view.value).toBe('tracks')
    expect(s.tracks.selectedItemId.value).toBe(id)
    expect(s.editor.toast.value?.message).toBe('Puesto en «Sonidos», a los 0:12.')
    // Otra vez el mismo: ya está descargado.
    await s.tracks.addAsset(ding, 1000)
    expect(s.state.libraryFetches).toEqual(['ding.m4a'])
  })

  it('«De mi ordenador»: sonidos a pistas de sonido, imágenes a efectos, uno detrás de otro y en un paso', async () => {
    const s = setup()
    await withClips(s)
    const before = s.editor.history.value.past.length
    expect(await s.tracks.addFiles([MUSIC, LOGO, 'C:\\notas.txt'], 2000)).toBe(2)
    const r = resolveTracks(s.editor.project.value)
    const music = r.find((x) => x.item.name === 'Música')!
    const logo = r.find((x) => x.item.name === 'logo')!
    expect([music.track.kind, music.startMs, music.endMs]).toEqual(['sound', 2000, 6000])
    expect([logo.track.kind, logo.startMs, logo.item.still, logo.item.look?.fit]).toEqual(['effect', 6000, true, 'contain'])
    expect(s.editor.history.value.past.length).toBe(before + 1)
    s.editor.undo()
    expect(s.editor.project.value.tracks).toEqual([])
  })

  it('quitar el trozo ancla avisa de lo que se queda en su sitio', async () => {
    const s = setup()
    const [, second] = await withClips(s)
    await s.tracks.addFiles([MUSIC], 12_000)
    s.editor.removeClip(second!)
    expect(s.editor.toast.value?.message).toBe('Trozo quitado. 1 sonido estaba pegado a este trozo: se queda en el mismo sitio del vídeo.')
    // Se queda en el 10 s: el final del vídeo (ahora solo hay un trozo de 10 s).
    expect(resolveTracks(s.editor.project.value)[0]!.startMs).toBe(10_000)
  })

  it('quitar una pista con cosas pregunta; sin pistas, vuelve a las tarjetas', async () => {
    const s = setup()
    await withClips(s)
    await s.tracks.addFiles([MUSIC], 0)
    await nextTick()
    const track = s.editor.project.value.tracks[0]!
    const pending = s.tracks.removeTrack(track.id)
    expect(confirmRequest.value?.title).toBe('¿Quitar la pista «Sonidos»?')
    expect(confirmRequest.value?.message).toBe('Tiene un sonido. Se puede deshacer.')
    confirmRequest.value!.resolve(true)
    expect(await pending).toBe(true)
    await nextTick()
    expect(s.editor.project.value.tracks).toEqual([])
    expect(s.tracks.view.value).toBe('cards')
    s.editor.undo()
    await nextTick()
    expect(s.editor.project.value.tracks).toHaveLength(1)
    expect(s.tracks.view.value).toBe('tracks')
  })

  it('arrastrar se ve al momento y entra en el historial en un solo paso', async () => {
    const s = setup()
    await withClips(s)
    await s.tracks.addFiles([MUSIC], 1000)
    const id = s.tracks.selectedItemId.value!
    const before = s.editor.history.value.past.length
    expect(s.tracks.previewMove(id, 3000)).toBe(true)
    expect(s.tracks.previewMove(id, 5000)).toBe(true)
    expect(resolveTracks(s.editor.project.value)[0]!.startMs).toBe(5000)
    expect(s.editor.history.value.past.length).toBe(before)
    s.editor.commitPreview()
    expect(s.editor.history.value.past.length).toBe(before + 1)
  })
})

describe('guardar con pistas', () => {
  it('trae lo de la biblioteca antes de guardar y le pasa su fichero a ffmpeg', async () => {
    const s = setup()
    await withClips(s)
    await s.tracks.addAsset(s.library.asset('ding')!, 3000)
    // Como si se hubiera abierto en otro PC: no está en la caché.
    s.library.paths.value = {}
    s.state.library = {}
    const flow = createSaveFlow(s.editor, s.library)
    await flow.start('whatsapp')
    expect(s.editor.screen.value, s.editor.error.value?.details).toBe('done')
    expect(s.state.libraryFetches).toEqual(['ding.m4a', 'ding.m4a'])
    const args = s.state.ffmpegRuns[0]!.args
    expect(args).toContain('C:\\cache\\library\\ding.m4a')
    const script = args[args.indexOf('-/filter_complex') + 1]!
    expect(s.state.tempFiles[script]).toContain('amix=inputs=2:normalize=0')
  })
})
