// Estado de la aplicación: el proyecto (con deshacer/rehacer), la información de los originales,
// la pantalla en la que se está y los avisos. Todas las mutaciones del proyecto pasan por las
// funciones inmutables del dominio. Sin Pinia: un composable con refs basta para una sola ventana.

import { computed, shallowRef, ref, watch, type Ref } from 'vue'
import {
  addClip,
  baseName,
  canPaste,
  choosePasteSource,
  canRedo,
  canUndo,
  clipPaths,
  createClip,
  createHistory,
  createProject,
  defaultPicture,
  describeReanchored,
  dominantAspect,
  duplicateClip,
  findClip,
  insertClipAfter,
  isImagePath,
  isMediaPath,
  itemsAnchoredTo,
  trackFilePaths,
  moveClip,
  parseProject,
  projectDurationMs,
  pushState,
  redo as historyRedo,
  removeClip as removeClipFromProject,
  serializeProject,
  setCover,
  setTargetDuration,
  undo as historyUndo,
  type Clip,
  type History,
  type MediaInfo,
  type PasteSource,
  type Project,
  type SaveTarget,
  type SystemClipboardFiles,
} from '../domain'
import type { NativeBridge, Thumbnail } from '../native/bridge'

export type Screen = 'home' | 'pick' | 'editor' | 'clip' | 'save' | 'saving' | 'done' | 'teleprompter'

export interface Toast {
  id: number
  message: string
  actionLabel?: string
  action?: () => void
}

export interface AppError {
  /** Lo que ve la persona, en lenguaje llano. */
  message: string
  /** Lo técnico, para «Copiar detalles». */
  details: string
}

export interface PreparingItem {
  path: string
  name: string
  status: 'pending' | 'ok' | 'error'
  details?: string
}

export interface AutosaveSummary {
  project: Project
  clipCount: number
  durationMs: number
}

export type ProxyStatus = 'working' | 'ready' | 'error'

export interface ClipEditorStart {
  tab: 'pauses' | 'picture'
  /** Lanzar ya la búsqueda de pausas. */
  findPauses: boolean
}

export interface EditorStoreOptions {
  /** Espera del autoguardado tras el último cambio (ms). */
  autosaveDelayMs?: number
  toastMs?: number
  now?: () => number
}

/** Convierte cualquier error en texto técnico para «Copiar detalles». */
export function errorDetails(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
  return typeof error === 'string' ? error : JSON.stringify(error)
}

export function createEditorStore(bridge: NativeBridge, options: EditorStoreOptions = {}) {
  const autosaveDelayMs = options.autosaveDelayMs ?? 600
  const toastMs = options.toastMs ?? 7000

  const screen = ref<Screen>('home')
  const history = shallowRef<History<Project>>(createHistory(createProject()))
  /** Proyecto provisional mientras se arrastra un control: se ve al momento y entra en el historial al soltar. */
  const transient = shallowRef<Project | null>(null)
  const media = shallowRef<Record<string, MediaInfo>>({})
  const missing = shallowRef<Record<string, boolean>>({})
  const proxies = shallowRef<Record<string, string>>({})
  const proxyStatus = shallowRef<Record<string, ProxyStatus>>({})
  const selectedClipId = ref<string | null>(null)
  const editingClipId = ref<string | null>(null)
  /** Proyecto tal como estaba al entrar en «Arreglar este trozo». */
  const editingEntry = shallowRef<Project | null>(null)
  const preparing = ref<PreparingItem[]>([])
  const isPreparing = ref(false)
  const toast = shallowRef<Toast | null>(null)
  const error = shallowRef<AppError | null>(null)
  const autosave = shallowRef<AutosaveSummary | null>(null)
  /** Fichero guardado en la última exportación (un vídeo o, con 'sound', solo el sonido). */
  const lastExport = shallowRef<{ path: string; folder: string; durationMs: number; target?: SaveTarget } | null>(null)
  /** Pantalla de la que se vino (para que «Volver» del teleprompter regrese a Inicio o a «Tu vídeo»). */
  const previousScreen = ref<Screen>('home')
  /** Con qué abrir «Arreglar este trozo» (lo lee la pantalla al montarse y lo borra). */
  const clipEditorStart = shallowRef<ClipEditorStart | null>(null)
  /** Trozo recién grabado al que se le ofrece «Quitar las pausas de esta grabación». */
  const recordingOffer = ref<string | null>(null)

  const project = computed<Project>(() => transient.value ?? history.value.present)
  const durationMs = computed(() => projectDurationMs(project.value))
  const undoable = computed(() => canUndo(history.value))
  const redoable = computed(() => canRedo(history.value))
  const selectedClip = computed(() => (selectedClipId.value ? findClip(project.value, selectedClipId.value) ?? null : null))
  const selectedIndex = computed(() => project.value.clips.findIndex((c) => c.id === selectedClipId.value))
  /** ¿El vídeo de encima de este trozo ha desaparecido (o no se ha podido leer)? */
  function coverMissing(clip: Clip): boolean {
    const p = clip.picture
    return p.kind === 'cover' && (!!missing.value[p.sourcePath] || !media.value[p.sourcePath])
  }

  /** El trozo tal como se puede enseñar: sin vídeo de encima si este no está (se ve lo de serie). */
  function visibleClip(clip: Clip): Clip {
    return coverMissing(clip) ? { ...clip, picture: defaultPicture(clip.sourceHasVideo) } : clip
  }

  /** Proyecto sin los trozos cuyo original no se encuentra (lo que se puede reproducir). */
  const playableProject = computed<Project>(() => {
    const p = project.value
    let changed = false
    const clips = p.clips
      .filter((c) => !missing.value[c.sourcePath] && media.value[c.sourcePath])
      .map((c) => {
        const v = visibleClip(c)
        if (v !== c) changed = true
        return v
      })
    return clips.length === p.clips.length && !changed ? p : { ...p, clips }
  })
  /** Sonidos y efectos de fichero cuyo original no se encuentra (o no se ha podido leer). */
  const missingItems = computed(() =>
    project.value.tracks.flatMap((t) => t.items).filter((i) => i.source.type === 'file' && (!!missing.value[i.source.path] || !media.value[i.source.path])),
  )
  const hasMissing = computed(
    () =>
      project.value.clips.some((c) => missing.value[c.sourcePath] || !media.value[c.sourcePath] || coverMissing(c)) ||
      missingItems.value.length > 0,
  )

  // ------------------------------------------------------------------ historial

  function keepSelectionValid() {
    const clips = history.value.present.clips
    if (!selectedClipId.value || !clips.some((c) => c.id === selectedClipId.value)) {
      selectedClipId.value = clips[0]?.id ?? null
    }
    if (editingClipId.value && !clips.some((c) => c.id === editingClipId.value)) {
      editingClipId.value = null
      editingEntry.value = null
      if (screen.value === 'clip') screen.value = 'editor'
    }
  }

  /** Registra un cambio del proyecto (una entrada de deshacer). */
  function commit(next: Project) {
    transient.value = null
    history.value = pushState(history.value, next)
    keepSelectionValid()
  }

  /** Aplica una operación del dominio sobre el proyecto actual. */
  function apply(fn: (p: Project) => Project) {
    commit(fn(history.value.present))
  }

  /** Mientras se arrastra: cambia lo que se ve sin crear entradas de deshacer. */
  function preview(fn: (base: Project) => Project) {
    transient.value = fn(history.value.present)
  }

  /** Al soltar: lo provisional entra en el historial como un solo cambio. */
  function commitPreview() {
    const t = transient.value
    transient.value = null
    if (t) commit(t)
  }

  function cancelPreview() {
    transient.value = null
  }

  function undo() {
    transient.value = null
    history.value = historyUndo(history.value)
    keepSelectionValid()
  }

  function redo() {
    transient.value = null
    history.value = historyRedo(history.value)
    keepSelectionValid()
  }

  // ------------------------------------------------------------------ avisos

  let toastCounter = 0
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  function showToast(message: string, action?: { label: string; run: () => void }, durationMs = toastMs) {
    toastCounter += 1
    toast.value = { id: toastCounter, message, actionLabel: action?.label, action: action?.run }
    if (toastTimer) clearTimeout(toastTimer)
    const id = toastCounter
    toastTimer = setTimeout(() => {
      if (toast.value?.id === id) toast.value = null
    }, durationMs)
  }
  function hideToast() {
    toast.value = null
  }

  function showError(message: string, cause: unknown) {
    error.value = { message, details: errorDetails(cause) }
    console.error(`[easy-cut] ${message}`, cause)
  }
  function clearError() {
    error.value = null
  }

  // ------------------------------------------------------------------ originales

  function setMedia(info: MediaInfo) {
    media.value = { ...media.value, [info.path]: info }
  }
  function setMissing(path: string, value: boolean) {
    if (!!missing.value[path] === value) return
    const next = { ...missing.value }
    if (value) next[path] = true
    else delete next[path]
    missing.value = next
  }

  /**
   * Añade los vídeos (o sonidos) como trozos nuevos al final, en el orden dado. Hace probe de cada uno;
   * los que no se pueden leer se quedan en `preparing` con su error y no bloquean al resto.
   * Si el vídeo estaba vacío, la forma pasa a ser la de la mayoría de los que tienen imagen.
   * Un solo paso de deshacer.
   */
  async function addClipsFromPaths(paths: readonly string[]): Promise<{ added: number; failed: PreparingItem[] }> {
    const items: PreparingItem[] = paths.map((path) => ({ path, name: baseName(path), status: 'pending' }))
    preparing.value = items
    isPreparing.value = true
    const infos: (MediaInfo | null)[] = new Array(paths.length).fill(null)
    // Pocos a la vez: ffprobe es rápido, pero cien vídeos de golpe saturarían el PC.
    const queue = paths.map((p, i) => [p, i] as const)
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [path, i] = next
        try {
          const info = media.value[path] ?? (await bridge.probe(path))
          if (!(info.durationMs > 0) || (info.hasVideo && (info.width <= 0 || info.height <= 0)) || (!info.hasVideo && !info.hasAudio)) {
            throw new Error('El fichero no tiene ni imagen ni sonido, o no dura nada.')
          }
          setMedia(info)
          setMissing(path, false)
          infos[i] = info
          items[i] = { ...items[i]!, status: 'ok' }
        } catch (e) {
          items[i] = { ...items[i]!, status: 'error', details: errorDetails(e) }
        }
        preparing.value = items.slice()
      }
    }
    await Promise.all([worker(), worker(), worker()])
    isPreparing.value = false

    const ok = infos.filter((m): m is MediaInfo => m !== null)
    if (ok.length > 0) {
      let p = history.value.present
      const wasEmpty = p.clips.length === 0
      if (wasEmpty) p = { ...p, aspect: dominantAspect(ok) }
      const firstNewId: string[] = []
      for (const info of ok) {
        const clip = createClip(info)
        firstNewId.push(clip.id)
        p = addClip(p, clip)
      }
      commit(p)
      if (wasEmpty || !selectedClipId.value) selectedClipId.value = firstNewId[0] ?? null
    }
    return { added: ok.length, failed: items.filter((i) => i.status === 'error') }
  }

  /**
   * Vuelve a comprobar que existen los originales (y los vídeos de encima) y lee los que falten
   * (al seguir con un autoguardado).
   */
  async function refreshOriginals() {
    const present = history.value.present
    const paths = [...new Set([...present.clips.flatMap(clipPaths), ...trackFilePaths(present)])]
    await Promise.all(
      paths.map(async (path) => {
        let exists = false
        try {
          exists = await bridge.exists(path)
        } catch {
          exists = false
        }
        if (!exists) {
          setMissing(path, true)
          return
        }
        try {
          setMedia(await bridge.probe(path, { still: isImagePath(path) }))
          setMissing(path, false)
        } catch {
          setMissing(path, true)
        }
      }),
    )
  }

  // ------------------------------------------------------------------ inicio y autoguardado

  async function loadAutosaveSummary() {
    try {
      const json = await bridge.loadAutosave()
      if (!json) {
        autosave.value = null
        return
      }
      const p = parseProject(json)
      autosave.value = p.clips.length > 0 ? { project: p, clipCount: p.clips.length, durationMs: projectDurationMs(p) } : null
    } catch (e) {
      // Un autoguardado dañado no debe impedir empezar: se ignora.
      console.warn('[easy-cut] autoguardado ilegible, se ignora', e)
      autosave.value = null
    }
  }

  async function resumeAutosave() {
    const saved = autosave.value
    if (!saved) return
    // Se vino a Inicio desde «Tu vídeo» y el vídeo sigue abierto: se vuelve a él tal cual (con su deshacer).
    if (saved.project === history.value.present) {
      screen.value = 'editor'
      return
    }
    history.value = createHistory(saved.project)
    transient.value = null
    selectedClipId.value = saved.project.clips[0]?.id ?? null
    screen.value = 'editor'
    await refreshOriginals()
  }

  /** Empieza un vídeo vacío (el anterior se pierde; los originales no se tocan). */
  function startNewProject() {
    history.value = createHistory(createProject())
    transient.value = null
    selectedClipId.value = null
    editingClipId.value = null
    editingEntry.value = null
    lastExport.value = null
    recordingOffer.value = null
    autosave.value = null
    void bridge.clearAutosave().catch((e) => console.warn('[easy-cut] no se pudo borrar el autoguardado', e))
  }

  let autosaveTimer: ReturnType<typeof setTimeout> | null = null
  let lastSavedJson: string | null = null
  async function writeAutosave() {
    autosaveTimer = null
    const p = history.value.present
    try {
      if (p.clips.length === 0) {
        if (lastSavedJson !== '') await bridge.clearAutosave()
        lastSavedJson = ''
        return
      }
      const json = serializeProject(p)
      if (json === lastSavedJson) return
      await bridge.saveAutosave(json)
      lastSavedJson = json
    } catch (e) {
      console.warn('[easy-cut] no se pudo autoguardar', e)
    }
  }
  /** Guarda ya lo pendiente (al cerrar la ventana, por ejemplo). */
  async function flushAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    await writeAutosave()
  }
  watch(
    () => history.value.present,
    (p, old) => {
      if (p === old) return
      if (autosaveTimer) clearTimeout(autosaveTimer)
      autosaveTimer = setTimeout(() => void writeAutosave(), autosaveDelayMs)
    },
  )

  // ------------------------------------------------------------------ trozos

  function select(clipId: string | null) {
    selectedClipId.value = clipId
  }

  function moveBy(clipId: string, delta: number) {
    const index = history.value.present.clips.findIndex((c) => c.id === clipId)
    if (index < 0) return
    apply((p) => moveClip(p, clipId, index + delta))
  }

  function moveTo(clipId: string, toIndex: number) {
    apply((p) => moveClip(p, clipId, toIndex))
  }

  /** Quita un trozo sin preguntar, con aviso y «Deshacer». */
  function removeClip(clipId: string) {
    const index = history.value.present.clips.findIndex((c) => c.id === clipId)
    if (index < 0) return
    // Lo pegado a este trozo se queda en el mismo sitio del vídeo (removeClip lo vuelve a pegar): se avisa.
    const moved = describeReanchored(itemsAnchoredTo(history.value.present, clipId))
    apply((p) => removeClipFromProject(p, clipId))
    const clips = history.value.present.clips
    selectedClipId.value = clips[Math.min(index, clips.length - 1)]?.id ?? null
    showToast(moved ? `Trozo quitado. ${moved}` : 'Trozo quitado. El original sigue en tu ordenador.', { label: 'Deshacer', run: undo })
  }

  function openClipEditor(clipId: string, start: ClipEditorStart | null = null) {
    const clip = findClip(history.value.present, clipId)
    if (!clip || missing.value[clip.sourcePath] || !media.value[clip.sourcePath]) return
    clipEditorStart.value = start
    if (recordingOffer.value === clipId) recordingOffer.value = null
    selectedClipId.value = clipId
    editingClipId.value = clipId
    editingEntry.value = history.value.present
    hideToast()
    screen.value = 'clip'
  }

  function closeClipEditor() {
    commitPreview()
    editingClipId.value = null
    editingEntry.value = null
    hideToast()
    screen.value = 'editor'
  }

  /** «Deshacer los cambios de este trozo»: vuelve al proyecto de cuando se entró (un paso de deshacer). */
  function revertClipChanges() {
    const entry = editingEntry.value
    if (!entry) return
    commit(entry)
    if (editingClipId.value && !findClip(entry, editingClipId.value)) {
      editingClipId.value = entry.clips[0]?.id ?? null
    }
  }

  // ------------------------------------------------------------------ vista previa

  /** Pide el proxy de vista previa de un original que el <video> no sabe reproducir. */
  async function ensureProxy(path: string) {
    if (proxyStatus.value[path]) return
    proxyStatus.value = { ...proxyStatus.value, [path]: 'working' }
    try {
      const proxy = await bridge.makePreviewProxy(path).result
      proxies.value = { ...proxies.value, [path]: proxy }
      proxyStatus.value = { ...proxyStatus.value, [path]: 'ready' }
    } catch (e) {
      proxyStatus.value = { ...proxyStatus.value, [path]: 'error' }
      showError('No he podido preparar la vista previa de este vídeo. Se guardará bien igualmente.', e)
    }
  }

  function mediaSrc(path: string): string {
    return bridge.mediaUrl(proxies.value[path] ?? path)
  }

  const thumbCache = new Map<string, Promise<Thumbnail | null>>()
  /** Miniatura de un instante del original (cacheada en memoria; el bridge la cachea en disco). */
  function thumbnail(path: string, timeMs: number, height: number): Promise<Thumbnail | null> {
    const t = Math.max(0, Math.round(timeMs / 100) * 100)
    const key = `${path}|${height}|${t}`
    let p = thumbCache.get(key)
    if (!p) {
      p = bridge
        .thumbnails({ path, timesMs: [t], height })
        .result.then((list) => list[0] ?? null)
        .catch(() => null)
      thumbCache.set(key, p)
      void p.then((v) => {
        if (v === null) thumbCache.delete(key)
      })
    }
    return p
  }

  /** Varias miniaturas a la vez (filmstrip); cada instante se cachea por separado. */
  async function thumbnails(path: string, timesMs: number[], height: number): Promise<(Thumbnail | null)[]> {
    return Promise.all(timesMs.map((t) => thumbnail(path, t, height)))
  }

  const waveCache = new Map<string, Promise<Thumbnail | null>>()
  /** Forma de onda de un original sin imagen (cacheada en memoria; el bridge la cachea en disco). */
  function waveform(path: string, width: number, height: number): Promise<Thumbnail | null> {
    // El ancho se redondea a tramos de 200 px: así no se rehace al cambiar un poco el tamaño de la ventana.
    const w = Math.max(200, Math.ceil(width / 200) * 200)
    const key = `${path}|${w}|${height}`
    let p = waveCache.get(key)
    if (!p) {
      p = bridge
        .waveform({ path, width: w, height })
        .result.catch(() => null)
      waveCache.set(key, p)
      void p.then((v) => {
        if (v === null) waveCache.delete(key)
      })
    }
    return p
  }

  // ------------------------------------------------------------------ imagen: vídeo de encima

  /**
   * «Elegir el vídeo» de encima: diálogo de un solo fichero, solo vídeos. Lo lee y lo pone encima del trozo
   * (un paso de deshacer). Devuelve false si se cancela o no vale (con el aviso ya enseñado).
   */
  async function pickCover(clipId: string): Promise<boolean> {
    let paths: string[]
    try {
      paths = await bridge.pickVideos({ multiple: false })
    } catch (e) {
      showError('No se ha podido abrir la ventana para elegir el vídeo.', e)
      return false
    }
    const path = paths[0]
    if (!path) return false
    let info: MediaInfo
    try {
      info = await bridge.probe(path)
    } catch (e) {
      showError('No he podido leer ese vídeo.', e)
      return false
    }
    if (!info.hasVideo) {
      showToast('Ese fichero no tiene imagen: elige un vídeo para ponerlo encima.')
      return false
    }
    setMedia(info)
    setMissing(path, false)
    apply((p) => setCover(p, clipId, info))
    return true
  }

  /** Cambia de pantalla. Los avisos de la anterior (p. ej. «Deshacer») ya no vienen a cuento. */
  function go(next: Screen) {
    commitPreview()
    if (screen.value !== next) {
      hideToast()
      previousScreen.value = screen.value
    }
    // Volver a Inicio con un vídeo a medias: Inicio lo ofrece («Seguir con este vídeo») y «Hacer un vídeo
    // nuevo» pregunta antes de perderlo (antes no lo sabía y lo descartaba sin preguntar).
    const present = history.value.present
    if (next === 'home' && present.clips.length > 0) {
      autosave.value = { project: present, clipCount: present.clips.length, durationMs: projectDurationMs(present) }
      void flushAutosave()
    }
    screen.value = next
  }

  // ------------------------------------------------------------------ copiar y pegar trozos

  /** Trozo copiado en la app y la secuencia del portapapeles del sistema al copiarlo (ver domain/paste.ts). */
  const copiedClip = shallowRef<{ clip: Clip; sequence: number | null } | null>(null)
  /** Lo último que se sabe del portapapeles del sistema (para activar «Pegar»). */
  const systemClipboard = shallowRef<SystemClipboardFiles | null>(null)
  const pasteAvailable = computed(() => canPaste(copiedClip.value, systemClipboard.value, isMediaPath))

  /** Lee los ficheros del portapapeles del sistema (null si no se puede). */
  async function readSystemClipboard(): Promise<SystemClipboardFiles | null> {
    try {
      const r = await bridge.clipboardFiles()
      systemClipboard.value = r
      return r
    } catch (e) {
      console.warn('[easy-cut] no se ha podido leer el portapapeles', e)
      return null
    }
  }

  /** Mira si el portapapeles ha cambiado (barato) y, si ha cambiado, qué ficheros tiene. */
  async function refreshSystemClipboard() {
    try {
      const sequence = await bridge.clipboardSequence()
      if (systemClipboard.value && sequence === systemClipboard.value.sequence) return
    } catch {
      return
    }
    await readSystemClipboard()
  }

  /** «Copiar este trozo» (Ctrl+C): copia en la app, con todos sus ajustes. No toca el portapapeles del sistema. */
  async function copyClip(clipId: string): Promise<boolean> {
    const clip = findClip(history.value.present, clipId)
    if (!clip) return false
    const mark = { clip: duplicateClip(clip, clip.id), sequence: systemClipboard.value?.sequence ?? null }
    copiedClip.value = mark
    showToast('Trozo copiado', undefined, 3000)
    try {
      const sequence = await bridge.clipboardSequence()
      if (copiedClip.value === mark) copiedClip.value = { ...mark, sequence }
    } catch {
      // Sin secuencia: unos ficheros del Explorador se tendrían por más nuevos (ver domain/paste.ts).
    }
    return true
  }

  /**
   * Pega el trozo copiado justo después del elegido (o al final), con id nuevo y todos sus ajustes. Un solo
   * paso de deshacer; el pegado queda elegido. Devuelve su id (null si no había nada copiado).
   */
  function pasteCopiedClip(): string | null {
    const c = copiedClip.value
    if (!c) return null
    const fresh = duplicateClip(c.clip)
    const after = selectedClipId.value
    apply((p) => insertClipAfter(p, after, fresh))
    selectedClipId.value = fresh.id
    const n = history.value.present.clips.findIndex((x) => x.id === fresh.id) + 1
    showToast(`Trozo pegado: es el trozo ${n}.`, { label: 'Deshacer', run: undo })
    return fresh.id
  }

  /** Qué se pegaría ahora con Ctrl+V (lee el portapapeles del sistema). */
  async function pasteSource(): Promise<PasteSource> {
    const system = await readSystemClipboard()
    return choosePasteSource(copiedClip.value, system, isMediaPath)
  }

  // ------------------------------------------------------------------ grabaciones (teleprompter)

  /**
   * Añade una grabación como trozo nuevo al final, lo deja elegido, ofrece quitarle las pausas y pasa
   * la duración máxima elegida al vídeo (si se ha elegido una). Con `fresh`, empieza antes un vídeo nuevo.
   * Devuelve false si el fichero no se ha podido leer (el aviso queda en `preparing`).
   */
  async function addRecording(path: string, options: { targetMs?: number | null; fresh?: boolean } = {}): Promise<boolean> {
    if (options.fresh) startNewProject()
    const before = new Set(history.value.present.clips.map((c) => c.id))
    const res = await addClipsFromPaths([path])
    const added = history.value.present.clips.find((c) => !before.has(c.id))
    if (res.added === 0 || !added) return false
    if (options.targetMs !== undefined) apply((p) => setTargetDuration(p, options.targetMs ?? null))
    selectedClipId.value = added.id
    recordingOffer.value = media.value[path]?.hasAudio ? added.id : null
    return true
  }

  function dismissRecordingOffer() {
    recordingOffer.value = null
  }

  return {
    // estado
    screen,
    history: history as Readonly<Ref<History<Project>>>,
    project,
    durationMs,
    media,
    missing,
    proxies,
    proxyStatus,
    selectedClipId,
    selectedClip,
    selectedIndex,
    editingClipId,
    editingEntry,
    preparing,
    isPreparing,
    toast,
    error,
    autosave,
    lastExport,
    previousScreen,
    clipEditorStart,
    recordingOffer,
    undoable,
    redoable,
    playableProject,
    hasMissing,
    missingItems,
    coverMissing,
    setMedia,
    setMissing,
    visibleClip,
    bridge,
    // acciones
    commit,
    apply,
    preview,
    commitPreview,
    cancelPreview,
    undo,
    redo,
    showToast,
    hideToast,
    showError,
    clearError,
    addClipsFromPaths,
    refreshOriginals,
    loadAutosaveSummary,
    resumeAutosave,
    startNewProject,
    flushAutosave,
    select,
    moveBy,
    moveTo,
    removeClip,
    openClipEditor,
    closeClipEditor,
    revertClipChanges,
    ensureProxy,
    mediaSrc,
    thumbnail,
    thumbnails,
    waveform,
    pickCover,
    go,
    addRecording,
    dismissRecordingOffer,
    copiedClip,
    systemClipboard,
    pasteAvailable,
    readSystemClipboard,
    refreshSystemClipboard,
    copyClip,
    pasteCopiedClip,
    pasteSource,
  }
}

export type EditorStore = ReturnType<typeof createEditorStore>
