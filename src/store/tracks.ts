// Pistas de sonidos y efectos en la interfaz: qué está elegido, la vista (tarjetas o pistas), la biblioteca
// abierta, y todas las acciones sobre los elementos. Cada acción es un paso de deshacer; los arrastres se ven
// al momento (preview) y entran en el historial al soltar (commitPreview), como el resto de la app.

import { computed, ref, shallowRef, watch } from 'vue'
import {
  assetDefaults,
  baseName,
  createItem,
  defaultIdFactory,
  displayName,
  duplicateItem,
  findItem,
  formatClock,
  insertItem,
  isImagePath,
  isTrackMediaPath,
  moveItem,
  removeItem,
  removeTrack as removeTrackFromProject,
  renameTrack as renameTrackInProject,
  resolveTracks,
  setEffectLook,
  setItemFade,
  setItemRepeat,
  setItemVolume,
  setMainMuted as setMainMutedInProject,
  setTrackHidden as setTrackHiddenInProject,
  setTrackMuted as setTrackMutedInProject,
  splitItem,
  tracksOfKind,
  trimItemEnd,
  trimItemStart,
  type EffectLook,
  type LibraryAsset,
  type MediaInfo,
  type Project,
  type TrackItem,
  type TrackKind,
} from '../domain'
import { askConfirm } from '../lib/confirm'
import type { EditorStore } from './editor'
import type { LibraryStore } from './library'

export type BottomView = 'cards' | 'tracks'
export type LibraryTab = 'sound' | 'effect' | 'computer'

export function createTracksStore(editor: EditorStore, library: LibraryStore) {
  const view = ref<BottomView>('cards')
  const selectedItemId = ref<string | null>(null)
  const libraryOpen = ref(false)
  const libraryTab = ref<LibraryTab>('sound')
  /** Efecto que se está probando sobre el vídeo (sin ponerlo): se ve en la vista previa. */
  const trying = shallowRef<{ asset: LibraryAsset; path: string } | null>(null)
  /** «Tamaño y sitio»: el efecto elegido se mueve y redimensiona sobre la vista previa. */
  const boxEditing = ref(false)
  /** Mientras se añade algo (descarga o lectura de ficheros). */
  const adding = ref<string | null>(null)
  /** Dónde está la línea (el cabezal de la vista previa): «Poner aquí», partir, soltar ficheros… */
  const playheadMs = ref(0)

  const project = editor.project
  const hasTracks = computed(() => project.value.tracks.length > 0)
  const selectedItem = computed(() => (selectedItemId.value ? findItem(project.value, selectedItemId.value) : null))

  // Al añadir la primera pista, la parte de abajo pasa a la vista de pistas; sin pistas, la de siempre.
  watch(
    () => project.value.tracks.length,
    (n, old) => {
      if (n > 0 && (old ?? 0) === 0) view.value = 'tracks'
      if (n === 0) view.value = 'cards'
    },
  )
  // Lo elegido que deja de existir (deshacer, quitar la pista…) deja de estar elegido.
  watch(project, (p) => {
    if (selectedItemId.value && !findItem(p, selectedItemId.value)) {
      selectedItemId.value = null
      boxEditing.value = false
    }
  })

  function newId(prefix: string): string {
    return `${prefix}-${defaultIdFactory()}`
  }

  function select(itemId: string | null) {
    selectedItemId.value = itemId
    if (!itemId) boxEditing.value = false
  }

  function setView(v: BottomView) {
    view.value = v
  }

  /** Lo que se hace con un proyecto nuevo que no cabe o no hay vídeo. */
  function reportInsertFailure(reason: 'no-room' | 'empty-video') {
    editor.showToast(reason === 'empty-video' ? 'Primero añade algún vídeo o sonido al montaje.' : 'No queda sitio: ya hay cuatro pistas llenas en ese momento. Mueve o quita algo antes.')
  }

  /** «2 · Sonidos 2, a los 0:12». */
  function describePlace(trackId: string, startMs: number, p: Project): string {
    const t = p.tracks.find((x) => x.id === trackId)
    return `«${t?.name ?? ''}», a los ${formatClock(startMs)}`
  }

  // ---------------------------------------------------------------- añadir

  /** «Poner aquí» desde la biblioteca: lo descarga (si hace falta) y lo pone en `atMs`. */
  async function addAsset(asset: LibraryAsset, atMs: number): Promise<string | null> {
    adding.value = asset.name
    try {
      await library.ensureAsset(asset)
    } catch (e) {
      adding.value = null
      editor.showError(`No se ha podido traer «${asset.name}» de la biblioteca. Mira si hay conexión a internet y vuelve a probar.`, e)
      return null
    }
    adding.value = null
    const item = createItem({
      id: newId('item'),
      kind: asset.kind,
      source: { type: 'library', assetId: asset.id },
      name: asset.name,
      sourceDurationMs: asset.durationMs,
      still: asset.still,
      hasAudio: asset.hasAudio,
      defaults: assetDefaults(asset),
    })
    return place(item, asset.kind, atMs)
  }

  function place(item: TrackItem, kind: TrackKind, atMs: number): string | null {
    const p = editor.history.value.present
    const res = insertItem(p, item, kind, atMs, { id: newId('track') })
    if (!res.ok) {
      reportInsertFailure(res.reason)
      return null
    }
    editor.commit(res.project)
    selectedItemId.value = item.id
    view.value = 'tracks'
    const where = describePlace(res.trackId, res.startMs, res.project)
    editor.showToast(res.shifted ? `Puesto en ${where} (justo después de lo que había).` : `Puesto en ${where}.`, { label: 'Deshacer', run: editor.undo })
    return item.id
  }

  /** Qué es un fichero para las pistas: los sonidos van a una pista de sonido; vídeos e imágenes, a una de efectos. */
  async function probeForTracks(path: string): Promise<{ kind: TrackKind; info: MediaInfo }> {
    const still = isImagePath(path)
    const info = editor.media.value[path] ?? (await editor.bridge.probe(path, { still }))
    if (!still && !(info.durationMs > 0)) throw new Error('El fichero no dura nada.')
    const kind: TrackKind = still || info.hasVideo ? 'effect' : 'sound'
    return { kind, info }
  }

  /**
   * «De mi ordenador» (o soltar/pegar ficheros en la vista de pistas): sonidos, vídeos e imágenes en
   * `atMs`, uno detrás de otro. Un solo paso de deshacer. Devuelve cuántos se han puesto.
   */
  async function addFiles(paths: readonly string[], atMs: number): Promise<number> {
    const usable = paths.filter(isTrackMediaPath)
    if (usable.length === 0) {
      if (paths.length > 0) editor.showToast('Eso no es un sonido, un vídeo ni una imagen.')
      return 0
    }
    adding.value = usable.length === 1 ? baseName(usable[0]!) : `${usable.length} ficheros`
    let p = editor.history.value.present
    let at = atMs
    let added = 0
    let lastId: string | null = null
    const failed: string[] = []
    for (const path of usable) {
      try {
        const { kind, info } = await probeForTracks(path)
        editor.setMedia(info)
        editor.setMissing(path, false)
        const item = createItem({
          id: newId('item'),
          kind,
          source: { type: 'file', path },
          name: displayName(path),
          sourceDurationMs: info.durationMs,
          still: info.isStill,
          hasAudio: info.hasAudio,
          // Un vídeo puesto como efecto trae su sonido, pero callado (se sube en «Volumen»); un sonido, a su volumen.
          defaults: kind === 'effect' ? { volume: 0, look: { mix: 'normal', fit: info.isStill ? 'contain' : 'cover' } } : { volume: 1 },
        })
        const res = insertItem(p, item, kind, at, { id: newId('track') })
        if (!res.ok) {
          failed.push(baseName(path))
          continue
        }
        p = res.project
        const r = resolveTracks(p).find((x) => x.item.id === item.id)
        at = r ? r.shownEndMs : at
        added++
        lastId = item.id
      } catch (e) {
        console.warn('[easy-cut] no se ha podido poner en las pistas', path, e)
        failed.push(baseName(path))
      }
    }
    adding.value = null
    if (added > 0) {
      editor.commit(p)
      selectedItemId.value = lastId
      view.value = 'tracks'
      const msg = added === 1 ? 'Puesto en las pistas.' : `${added} puestos en las pistas.`
      editor.showToast(failed.length ? `${msg} No he podido leer: ${failed.join(', ')}.` : msg, { label: 'Deshacer', run: editor.undo })
    } else if (failed.length) {
      editor.showToast(`No he podido leer: ${failed.join(', ')}.`)
    }
    return added
  }

  /** «De mi ordenador»: el diálogo de siempre, con sonidos, vídeos e imágenes. */
  async function pickFiles(atMs: number): Promise<number> {
    let paths: string[]
    try {
      paths = await editor.bridge.pickVideos({ multiple: true, sounds: true, forTracks: true })
    } catch (e) {
      editor.showError('No se ha podido abrir la ventana para elegir ficheros.', e)
      return 0
    }
    return paths.length ? addFiles(paths, atMs) : 0
  }

  // ---------------------------------------------------------------- mover, recortar, partir…

  /** Mientras se arrastra: se ve al momento, sin entrada de deshacer. Devuelve si cabe. */
  function previewMove(itemId: string, startMs: number, trackId?: string): boolean {
    const next = moveItem(editor.history.value.present, itemId, startMs, trackId)
    if (next) editor.preview(() => next)
    return next !== null
  }

  function previewTrim(itemId: string, edge: 'start' | 'end', ms: number) {
    editor.preview((p) => (edge === 'start' ? trimItemStart(p, itemId, ms) : trimItemEnd(p, itemId, ms)))
  }

  function previewLook(itemId: string, change: Partial<Omit<EffectLook, 'box'>> & { box?: Partial<EffectLook['box']> }) {
    editor.preview((p) => setEffectLook(p, itemId, change))
  }

  function previewVolume(itemId: string, volume: number) {
    editor.preview((p) => setItemVolume(p, itemId, volume))
  }

  /** Mueve con botón o tecla («Poner donde está la línea»). */
  function moveTo(itemId: string, startMs: number, trackId?: string): boolean {
    const next = moveItem(editor.history.value.present, itemId, startMs, trackId)
    if (!next) {
      editor.showToast('Ahí no cabe: hay otra cosa en esa pista hasta el final.')
      return false
    }
    editor.commit(next)
    return true
  }

  /** Sube o baja a la pista de al lado del mismo tipo (↑ / ↓). */
  function moveToNeighbourTrack(itemId: string, direction: -1 | 1): boolean {
    const p = editor.history.value.present
    const found = findItem(p, itemId)
    if (!found) return false
    const same = tracksOfKind(p, found.track.kind)
    const i = same.findIndex((t) => t.id === found.track.id)
    const target = same[i + direction]
    if (!target) return false
    const r = resolveTracks(p).find((x) => x.item.id === itemId)
    return moveTo(itemId, r?.startMs ?? 0, target.id)
  }

  function trimAt(itemId: string, edge: 'start' | 'end', atMs: number) {
    editor.apply((p) => (edge === 'start' ? trimItemStart(p, itemId, atMs) : trimItemEnd(p, itemId, atMs)))
  }

  function split(itemId: string, atMs: number): boolean {
    const p = editor.history.value.present
    const next = splitItem(p, itemId, atMs, newId('item'))
    if (next === p) {
      editor.showToast('Pon la línea dentro del elemento (no en su principio ni en su final) para partirlo.')
      return false
    }
    editor.commit(next)
    return true
  }

  function duplicate(itemId: string): boolean {
    const id = newId('item')
    const res = duplicateItem(editor.history.value.present, itemId, id, { id: newId('track') })
    if (!res.ok) {
      editor.showToast('No queda sitio para la copia detrás de este.')
      return false
    }
    editor.commit(res.project)
    selectedItemId.value = id
    return true
  }

  function remove(itemId: string) {
    const found = findItem(editor.history.value.present, itemId)
    if (!found) return
    editor.apply((p) => removeItem(p, itemId))
    selectedItemId.value = null
    editor.showToast(found.track.kind === 'sound' ? 'Sonido quitado.' : 'Efecto quitado.', { label: 'Deshacer', run: editor.undo })
  }

  function setVolume(itemId: string, volume: number) {
    editor.apply((p) => setItemVolume(p, itemId, volume))
  }

  function setFade(itemId: string, which: 'in' | 'out', on: boolean) {
    editor.apply((p) => setItemFade(p, itemId, which, on))
  }

  function setRepeat(itemId: string, on: boolean) {
    editor.apply((p) => setItemRepeat(p, itemId, on))
  }

  function setLook(itemId: string, change: Partial<Omit<EffectLook, 'box'>> & { box?: Partial<EffectLook['box']> }) {
    editor.apply((p) => setEffectLook(p, itemId, change))
  }

  // ---------------------------------------------------------------- pistas

  function setTrackMuted(trackId: string, muted: boolean) {
    editor.apply((p) => setTrackMutedInProject(p, trackId, muted))
  }

  function setTrackHidden(trackId: string, hidden: boolean) {
    editor.apply((p) => setTrackHiddenInProject(p, trackId, hidden))
  }

  function setMainMuted(muted: boolean) {
    editor.apply((p) => setMainMutedInProject(p, muted))
  }

  function renameTrack(trackId: string, name: string) {
    editor.apply((p) => renameTrackInProject(p, trackId, name))
  }

  /** «Quitar pista»: si tiene cosas, pregunta antes. Deshacer la recupera entera. */
  async function removeTrack(trackId: string): Promise<boolean> {
    const t = editor.history.value.present.tracks.find((x) => x.id === trackId)
    if (!t) return false
    if (t.items.length > 0) {
      const what = t.kind === 'sound' ? (t.items.length === 1 ? 'un sonido' : `${t.items.length} sonidos`) : t.items.length === 1 ? 'un efecto' : `${t.items.length} efectos`
      const ok = await askConfirm({
        title: `¿Quitar la pista «${t.name}»?`,
        message: `Tiene ${what}. Se puede deshacer.`,
        confirmLabel: 'Quitar la pista',
        cancelLabel: 'No, volver',
        danger: true,
      })
      if (!ok) return false
    }
    editor.apply((p) => removeTrackFromProject(p, trackId))
    editor.showToast(`Pista «${t.name}» quitada.`, { label: 'Deshacer', run: editor.undo })
    return true
  }

  // ---------------------------------------------------------------- biblioteca

  function openLibrary(tab?: LibraryTab) {
    if (tab) libraryTab.value = tab
    libraryOpen.value = true
    void library.refreshStatus()
    void library.refreshCatalog()
  }

  function closeLibrary() {
    libraryOpen.value = false
    trying.value = null
  }

  /** «Probar sobre mi vídeo»: el efecto se ve en la vista previa (sin ponerlo); otra vez lo quita. */
  async function tryEffect(asset: LibraryAsset | null) {
    if (!asset || trying.value?.asset.id === asset.id) {
      trying.value = null
      return
    }
    try {
      const path = await library.ensureAsset(asset)
      trying.value = { asset, path }
    } catch (e) {
      editor.showError(`No se ha podido traer «${asset.name}» de la biblioteca.`, e)
    }
  }

  return {
    view,
    selectedItemId,
    selectedItem,
    hasTracks,
    libraryOpen,
    libraryTab,
    trying,
    boxEditing,
    adding,
    playheadMs,
    select,
    setView,
    addAsset,
    addFiles,
    pickFiles,
    previewMove,
    previewTrim,
    previewLook,
    previewVolume,
    moveTo,
    moveToNeighbourTrack,
    trimAt,
    split,
    duplicate,
    remove,
    setVolume,
    setFade,
    setRepeat,
    setLook,
    setTrackMuted,
    setTrackHidden,
    setMainMuted,
    renameTrack,
    removeTrack,
    openLibrary,
    closeLibrary,
    tryEffect,
  }
}

export type TracksStore = ReturnType<typeof createTracksStore>
