// Estado de la aplicación: el proyecto (con deshacer/rehacer), la información de los originales,
// la pantalla en la que se está y los avisos. Todas las mutaciones del proyecto pasan por las
// funciones inmutables del dominio. Sin Pinia: un composable con refs basta para una sola ventana.

import { computed, shallowRef, ref, watch, type Ref } from 'vue'
import {
  addClip,
  baseName,
  canRedo,
  canUndo,
  createClip,
  createHistory,
  createProject,
  dominantAspect,
  findClip,
  moveClip,
  parseProject,
  projectDurationMs,
  pushState,
  redo as historyRedo,
  removeClip as removeClipFromProject,
  serializeProject,
  undo as historyUndo,
  type History,
  type MediaInfo,
  type Project,
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
  /** Fichero guardado en la última exportación. */
  const lastExport = shallowRef<{ path: string; folder: string; durationMs: number } | null>(null)

  const project = computed<Project>(() => transient.value ?? history.value.present)
  const durationMs = computed(() => projectDurationMs(project.value))
  const undoable = computed(() => canUndo(history.value))
  const redoable = computed(() => canRedo(history.value))
  const selectedClip = computed(() => (selectedClipId.value ? findClip(project.value, selectedClipId.value) ?? null : null))
  const selectedIndex = computed(() => project.value.clips.findIndex((c) => c.id === selectedClipId.value))
  /** Proyecto sin los trozos cuyo original no se encuentra (lo que se puede reproducir). */
  const playableProject = computed<Project>(() => {
    const p = project.value
    const clips = p.clips.filter((c) => !missing.value[c.sourcePath] && media.value[c.sourcePath])
    return clips.length === p.clips.length ? p : { ...p, clips }
  })
  const hasMissing = computed(() => project.value.clips.some((c) => missing.value[c.sourcePath] || !media.value[c.sourcePath]))

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
  function showToast(message: string, action?: { label: string; run: () => void }) {
    toastCounter += 1
    toast.value = { id: toastCounter, message, actionLabel: action?.label, action: action?.run }
    if (toastTimer) clearTimeout(toastTimer)
    const id = toastCounter
    toastTimer = setTimeout(() => {
      if (toast.value?.id === id) toast.value = null
    }, toastMs)
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
   * Añade los vídeos como trozos nuevos al final, en el orden dado. Hace probe de cada uno;
   * los que no se pueden leer se quedan en `preparing` con su error y no bloquean al resto.
   * Si el vídeo estaba vacío, la forma pasa a ser la de la mayoría. Un solo paso de deshacer.
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
          if (!(info.durationMs > 0) || info.width <= 0 || info.height <= 0) {
            throw new Error('El fichero no tiene imagen de vídeo o no dura nada.')
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

  /** Vuelve a comprobar que existen los originales y lee los que falten (al seguir con un autoguardado). */
  async function refreshOriginals() {
    const paths = [...new Set(history.value.present.clips.map((c) => c.sourcePath))]
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
          setMedia(await bridge.probe(path))
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
    apply((p) => removeClipFromProject(p, clipId))
    const clips = history.value.present.clips
    selectedClipId.value = clips[Math.min(index, clips.length - 1)]?.id ?? null
    showToast('Trozo quitado. El original sigue en tu ordenador.', { label: 'Deshacer', run: undo })
  }

  function openClipEditor(clipId: string) {
    const clip = findClip(history.value.present, clipId)
    if (!clip || missing.value[clip.sourcePath] || !media.value[clip.sourcePath]) return
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

  /** Cambia de pantalla. Los avisos de la anterior (p. ej. «Deshacer») ya no vienen a cuento. */
  function go(next: Screen) {
    commitPreview()
    if (screen.value !== next) hideToast()
    screen.value = next
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
    undoable,
    redoable,
    playableProject,
    hasMissing,
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
    go,
  }
}

export type EditorStore = ReturnType<typeof createEditorStore>
