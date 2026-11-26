// Estado de la aplicación: el proyecto (con deshacer/rehacer), la información de los originales,
// la pantalla en la que se está y los avisos. Todas las mutaciones del proyecto pasan por las
// funciones inmutables del dominio. Sin Pinia: un composable con refs basta para una sola ventana.

import { computed, shallowRef, ref, watch, type Ref } from 'vue'
import {
  addClip,
  copyLook,
  findClipVideoItem,
  putClipVideo,
  updateEffectLook,
  type EffectLook,
  baseName,
  canPaste,
  choosePasteSource,
  canRedo,
  canUndo,
  cleanProjectName,
  compareMedia,
  createClip,
  createHistory,
  createProject,
  defaultIdFactory,
  defaultPicture,
  defaultProjectName,
  describeReanchored,
  displayName,
  dominantAspect,
  duplicateClip,
  duplicateProjectName,
  findClip,
  folderOf,
  insertClipAfter,
  isImagePath,
  isMediaPath,
  itemsAnchoredTo,
  mediaUsage,
  mergeMediaPool,
  moveClip,
  NO_USAGE,
  parseHistoryFile,
  parseProject,
  parseProjectFile,
  projectDurationMs,
  projectHasContent,
  pushState,
  redo as historyRedo,
  relinkMedia,
  relinkProblem,
  removeClip as removeClipFromProject,
  replaceState,
  serializeHistoryFile,
  serializeProject,
  setCover,
  shrunkJoinNotice,
  setTargetDuration,
  siblingCandidates,
  sortProjectSummaries,
  summarizeProject,
  syncMediaPool,
  undo as historyUndo,
  uniqueProjectName,
  upsertMediaEntry,
  usageTotal,
  usedMediaPaths,
  type Clip,
  type History,
  type MediaInfo,
  type PasteSource,
  type Project,
  type ProjectSummary,
  type SaveTarget,
  type SystemClipboardFiles,
} from '../domain'
import type { NativeBridge, Thumbnail } from '../native/bridge'

export type Screen = 'home' | 'pick' | 'editor' | 'clip' | 'save' | 'saving' | 'done' | 'teleprompter' | 'trim'

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

/** Un vídeo en marcha de la lista de Inicio. */
export interface ProjectListEntry extends ProjectSummary {
  /** ¿Tiene copia anterior? («Volver a la copia anterior»). */
  hasBackup: boolean
}

/** Un fichero elegido para sustituir a uno que falta, con lo que no cuadra respecto al de antes. */
export interface RelinkCandidate {
  oldPath: string
  newPath: string
  info: MediaInfo
  /** Frases llanas de lo que no coincide (vacío si cuadra). */
  mismatches: string[]
  /** En cuántos sitios se usa. */
  uses: number
}

/** La pregunta de «Buscarlo»: el elegido y los demás que faltaban y se han encontrado en la carpeta nueva. */
export interface RelinkOffer {
  main: RelinkCandidate
  siblings: RelinkCandidate[]
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
  /** Vídeos en marcha (la lista de Inicio), lo más reciente primero. */
  const projects = shallowRef<ProjectListEntry[]>([])
  /** ¿Ya se ha leído la lista? (hasta entonces, Inicio no dice nada de ella). */
  const projectsLoaded = ref(false)
  /** El vídeo abierto: su id en la lista (null si aún no se ha guardado porque está vacío) y su nombre. */
  const projectId = ref<string | null>(null)
  const projectName = ref('')
  /** «Buscarlo»: la pregunta de volver a enlazar, mientras está abierta. */
  const relinkOffer = shallowRef<RelinkOffer | null>(null)
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
    project.value.tracks
      .flatMap((t) => t.items)
      .filter(
        (i) =>
          (i.source.type === 'file' && (!!missing.value[i.source.path] || !media.value[i.source.path])) ||
          // Un collage con el vídeo de algún hueco perdido.
          !!i.collage?.cells.some((c) => c.source && (!!missing.value[c.source.path] || !media.value[c.source.path])),
      ),
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

  /**
   * Registra un cambio del proyecto (una entrada de deshacer). Lo que se haya traído queda en la lista de
   * ficheros del proyecto (con lo medido, si se sabe).
   */
  function commit(next: Project) {
    transient.value = null
    const before = history.value.present
    history.value = pushState(history.value, syncMediaPool(next, media.value))
    keepSelectionValid()
    // Si un cambio ha encogido el paso de un trozo a otro (no cabe), se dice, con «Deshacer».
    const shrunk = shrunkJoinNotice(before, history.value.present)
    if (shrunk) showToast(shrunk, { label: 'Deshacer', run: undo })
  }

  /**
   * Mueve el historial (deshacer o rehacer) sin deshacer la lista de ficheros: lo que se ha traído sigue a
   * mano en «De mi ordenador» aunque se deshaga el trozo que lo usaba.
   */
  function moveHistory(fn: (h: History<Project>) => History<Project>) {
    transient.value = null
    const pool = history.value.present.media
    const moved = fn(history.value)
    history.value = moved === history.value ? moved : replaceState(moved, mergeMediaPool(moved.present, pool))
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
    moveHistory(historyUndo)
  }

  function redo() {
    moveHistory(historyRedo)
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
    // Si ya está en la lista de ficheros, se pone al día con lo medido (sin entrada de deshacer).
    const p = history.value.present
    if (p.media.some((m) => m.path === info.path)) {
      const next = upsertMediaEntry(p, info)
      if (next !== p) history.value = replaceState(history.value, next)
    }
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
   * Vuelve a comprobar que existen los ficheros del proyecto (los que usa y los de la lista de «De mi
   * ordenador») y lee los que se usan o no se habían medido (al abrir un vídeo).
   */
  async function refreshOriginals() {
    const present = history.value.present
    const used = new Set(usedMediaPaths(present))
    const unprobed = new Set(present.media.filter((m) => !m.probed).map((m) => m.path))
    const paths = [...new Set([...used, ...present.media.map((m) => m.path)])]
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
        if (!used.has(path) && !unprobed.has(path)) {
          setMissing(path, false)
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

  // ------------------------------------------------------------------ vídeos en marcha (la lista de Inicio)

  const now = options.now ?? (() => Date.now())

  function newProjectId(): string {
    const id = defaultIdFactory().replace(/[^A-Za-z0-9_-]/g, '')
    return id === '' ? `p-${now().toString(36)}` : id.slice(0, 64)
  }

  function namesInUse(exceptId: string | null = null): string[] {
    return projects.value.filter((p) => p.id !== exceptId).map((p) => p.name)
  }

  function putSummary(entry: ProjectListEntry) {
    projects.value = sortProjectSummaries([...projects.value.filter((p) => p.id !== entry.id), entry]) as ProjectListEntry[]
  }

  function dropSummary(id: string) {
    projects.value = projects.value.filter((p) => p.id !== id)
  }

  /** El vídeo más reciente de la lista (al que el teleprompter ofrece añadir la grabación). */
  const recentProject = computed(() => projects.value[0] ?? null)

  /**
   * Lee la lista de Inicio. Además, pasa a la lista el autoguardado de antes (un solo vídeo a medias) sin
   * perderlo: primero se guarda en la lista, se comprueba que se ha guardado y solo entonces se borra el
   * viejo. Si no se puede leer, se deja como está.
   */
  let loadingProjects: Promise<void> | null = null
  function loadProjects(): Promise<void> {
    // Si ya se está leyendo (al arrancar), se espera a esa misma lectura.
    loadingProjects ??= readProjectList().finally(() => (loadingProjects = null))
    return loadingProjects
  }

  async function readProjectList() {
    let stored: Awaited<ReturnType<NativeBridge['listProjects']>> = []
    try {
      stored = await bridge.listProjects()
    } catch (e) {
      console.warn('[easy-cut] no se ha podido leer la lista de vídeos', e)
    }
    const list: ProjectListEntry[] = []
    for (const s of stored) {
      try {
        const { project, name } = parseProjectFile(s.json)
        list.push({ ...summarizeProject(s.id, name || 'Vídeo sin nombre', project, s.modifiedMs), hasBackup: s.hasBackup })
      } catch (e) {
        // Uno dañado no se enseña (ni se borra: puede que una versión más nueva sí lo sepa leer).
        console.warn(`[easy-cut] el vídeo ${s.id} no se puede leer, no se enseña`, e)
      }
    }
    // Lo que ya se conoce de esta sesión (el abierto aún sin escribir) se queda.
    const known = new Set(list.map((p) => p.id))
    projects.value = sortProjectSummaries([...list, ...projects.value.filter((p) => !known.has(p.id) && p.id === projectId.value)]) as ProjectListEntry[]
    await migrateLegacyAutosave()
    projectsLoaded.value = true
  }

  async function migrateLegacyAutosave() {
    let json: string | null = null
    try {
      json = await bridge.loadAutosave()
    } catch (e) {
      console.warn('[easy-cut] no se ha podido leer el autoguardado de antes', e)
      return
    }
    if (!json) return
    let project: Project
    try {
      project = parseProject(json)
    } catch (e) {
      console.warn('[easy-cut] el autoguardado de antes no se puede leer: se deja como está', e)
      return
    }
    if (!projectHasContent(project)) {
      await bridge.clearAutosave().catch((e) => console.warn('[easy-cut] no se pudo borrar el autoguardado vacío', e))
      return
    }
    const id = newProjectId()
    const name = defaultProjectName(new Date(now()), namesInUse())
    const out = serializeProject(project, { name })
    try {
      await bridge.writeProject(id, out)
      if ((await bridge.readProject(id)) !== out) throw new Error('lo guardado no coincide')
    } catch (e) {
      console.warn('[easy-cut] no se ha podido pasar el autoguardado a la lista: se deja como está', e)
      return
    }
    await bridge.clearAutosave().catch((e) => console.warn('[easy-cut] no se pudo borrar el autoguardado de antes', e))
    savedJson.set(id, out)
    putSummary({ ...summarizeProject(id, name, project, now()), hasBackup: false })
    console.info(`[easy-cut] el vídeo a medias de antes está ahora en la lista como «${name}»`)
  }

  /** Lo que hay que escribir del vídeo abierto, tomado en el momento (antes de cambiar de vídeo). */
  interface Snapshot {
    id: string
    name: string
    project: Project
    history: History<Project>
  }

  function takeSnapshot(): Snapshot | null {
    const p = history.value.present
    if (!projectId.value) {
      // Uno nuevo y vacío no se guarda: así «Hacer un vídeo nuevo» y volver no deja nada en la lista.
      if (!projectHasContent(p)) return null
      projectId.value = newProjectId()
    }
    if (!projectName.value) projectName.value = defaultProjectName(new Date(now()), namesInUse(projectId.value))
    return { id: projectId.value, name: projectName.value, project: p, history: history.value }
  }

  /** Último JSON escrito de cada vídeo (para no escribir si no ha cambiado). */
  const savedJson = new Map<string, string>()
  const savedHistory = new Map<string, string>()
  /** Las escrituras van de una en una y en orden. */
  let writing: Promise<void> = Promise.resolve()

  async function persist(s: Snapshot) {
    const json = serializeProject(s.project, { name: s.name })
    if (json !== savedJson.get(s.id)) {
      try {
        await bridge.writeProject(s.id, json)
        savedJson.set(s.id, json)
        const old = projects.value.find((p) => p.id === s.id)
        putSummary({ ...summarizeProject(s.id, s.name, s.project, now()), hasBackup: old?.hasBackup ?? false })
      } catch (e) {
        console.warn('[easy-cut] no se pudo guardar el vídeo', e)
        return
      }
    }
    // Deshacer sobrevive a cerrar la app: el historial va aparte (si no ha cambiado, no se escribe).
    const hist = serializeHistoryFile(s.history)
    if (hist === savedHistory.get(s.id)) return
    try {
      await bridge.writeProjectHistory(s.id, hist)
      savedHistory.set(s.id, hist)
    } catch (e) {
      console.warn('[easy-cut] no se pudo guardar el historial de deshacer', e)
    }
  }

  let autosaveTimer: ReturnType<typeof setTimeout> | null = null
  /** Guarda ya lo pendiente del vídeo abierto (al cambiar de vídeo o cerrar la ventana). */
  function flushAutosave(): Promise<void> {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = null
    const s = takeSnapshot()
    if (s) writing = writing.then(() => persist(s))
    return writing
  }
  watch(
    [() => history.value.present, projectName],
    ([p, name], [old, oldName]) => {
      if (p === old && name === oldName) return
      if (autosaveTimer) clearTimeout(autosaveTimer)
      autosaveTimer = setTimeout(() => void flushAutosave(), autosaveDelayMs)
    },
  )

  /** Deja la app con un vídeo vacío, sin guardar nada (lo de antes ya está guardado o se ha borrado). */
  function resetToEmpty() {
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = null
    history.value = createHistory(createProject())
    transient.value = null
    projectId.value = null
    projectName.value = ''
    selectedClipId.value = null
    editingClipId.value = null
    editingEntry.value = null
    lastExport.value = null
    recordingOffer.value = null
    relinkOffer.value = null
  }

  /** Empieza un vídeo vacío. El que estaba abierto se queda guardado en la lista (no se pierde nada). */
  function startNewProject() {
    void flushAutosave()
    resetToEmpty()
  }

  /**
   * Empieza un vídeo nuevo ya hecho (p. ej. «Convertir en un vídeo normal» de «Solo recortar»), con los
   * originales ya medidos, y lo guarda ya en la lista. El que estaba abierto se queda guardado. Sin deshacer
   * hacia atrás: empieza aquí.
   */
  function startProjectFrom(next: Project, infos: readonly MediaInfo[]): Promise<void> {
    void flushAutosave()
    resetToEmpty()
    for (const info of infos) {
      setMedia(info)
      setMissing(info.path, false)
    }
    history.value = createHistory(syncMediaPool(next, media.value))
    selectedClipId.value = next.clips[0]?.id ?? null
    return flushAutosave()
  }

  /**
   * Abre un vídeo de la lista (con su deshacer, si se guardó). Si es el que ya estaba abierto, vuelve a él tal
   * cual. Devuelve false si no se ha podido (con el aviso ya enseñado).
   */
  async function openProject(id: string): Promise<boolean> {
    if (id === projectId.value) {
      hideToast()
      screen.value = 'editor'
      // Mientras se estaba en Inicio se puede haber movido algún fichero: se vuelve a mirar.
      await refreshOriginals()
      return true
    }
    await flushAutosave()
    let json: string | null
    try {
      json = await bridge.readProject(id)
    } catch (e) {
      showError('No he podido abrir ese vídeo.', e)
      return false
    }
    if (json === null) {
      dropSummary(id)
      showToast('Ese vídeo ya no está.')
      return false
    }
    let file: { project: Project; name: string }
    try {
      file = parseProjectFile(json)
    } catch (e) {
      showError('Ese vídeo está dañado y no se puede abrir. Tus vídeos originales no se han tocado.', e)
      return false
    }
    resetToEmpty()
    let restored: History<Project> | null = null
    try {
      restored = parseHistoryFile(await bridge.readProjectHistory(id), file.project)
    } catch (e) {
      console.warn('[easy-cut] no se ha podido leer el historial de deshacer', e)
    }
    history.value = restored ?? createHistory(file.project)
    projectId.value = id
    projectName.value = file.name || uniqueProjectName('Vídeo sin nombre', namesInUse(id))
    savedJson.set(id, json)
    selectedClipId.value = file.project.clips[0]?.id ?? null
    hideToast()
    screen.value = 'editor'
    await refreshOriginals()
    return true
  }

  /** El JSON de un vídeo de la lista (del abierto, lo de ahora). */
  async function projectJson(id: string): Promise<{ project: Project; name: string } | null> {
    if (id === projectId.value) {
      await flushAutosave()
      return { project: history.value.present, name: projectName.value }
    }
    const json = await bridge.readProject(id)
    return json === null ? null : parseProjectFile(json)
  }

  /** Cambia el nombre de un vídeo de la lista. Devuelve false si el nombre no vale o no se ha podido. */
  async function renameProject(id: string, raw: string): Promise<boolean> {
    const name = cleanProjectName(raw)
    if (!name) return false
    if (id === projectId.value) {
      projectName.value = name
      await flushAutosave()
      return true
    }
    try {
      const file = await projectJson(id)
      if (!file) return false
      const json = serializeProject(file.project, { name })
      await bridge.writeProject(id, json)
      savedJson.set(id, json)
      const old = projects.value.find((p) => p.id === id)
      putSummary({ ...summarizeProject(id, name, file.project, now()), hasBackup: old?.hasBackup ?? false })
      return true
    } catch (e) {
      showError('No he podido cambiarle el nombre.', e)
      return false
    }
  }

  /** Duplica un vídeo de la lista («Boda (copia)»), sin abrirlo. Devuelve el id de la copia. */
  async function duplicateProject(id: string): Promise<string | null> {
    try {
      const file = await projectJson(id)
      if (!file) return null
      const copyId = newProjectId()
      const name = duplicateProjectName(file.name || 'Vídeo sin nombre', namesInUse())
      const json = serializeProject(file.project, { name })
      await bridge.writeProject(copyId, json)
      savedJson.set(copyId, json)
      putSummary({ ...summarizeProject(copyId, name, file.project, now()), hasBackup: false })
      showToast(`Hecha una copia: «${name}».`)
      return copyId
    } catch (e) {
      showError('No he podido hacer la copia.', e)
      return null
    }
  }

  /**
   * Borra un vídeo de la lista (su fichero de proyecto, con su copia y su historial). Nunca toca los
   * originales. Si es el abierto, la app se queda con uno vacío.
   */
  async function deleteProject(id: string): Promise<boolean> {
    let kept: { id: string; json: string; history: string | null } | null = null
    try {
      // Lo de ahora se guarda antes (y se recuerda, para «Deshacer» en el aviso).
      if (id === projectId.value) await flushAutosave()
      const json = await bridge.readProject(id)
      if (json !== null) kept = { id, json, history: await bridge.readProjectHistory(id).catch(() => null) }
      await bridge.deleteProject(id)
    } catch (e) {
      showError('No he podido borrar ese vídeo de la lista.', e)
      return false
    }
    savedJson.delete(id)
    savedHistory.delete(id)
    const entry = projects.value.find((p) => p.id === id)
    dropSummary(id)
    if (id === projectId.value) resetToEmpty()
    lastDeleted = kept
    showToast(`«${entry?.name ?? 'El vídeo'}» borrado de la lista. Tus vídeos originales no se han tocado.`, kept ? { label: 'Deshacer', run: () => void undoDeleteProject() } : undefined)
    return true
  }

  let lastDeleted: { id: string; json: string; history: string | null } | null = null
  /** «Deshacer» del aviso de borrar: lo vuelve a poner en la lista tal como estaba. */
  async function undoDeleteProject(): Promise<boolean> {
    const d = lastDeleted
    lastDeleted = null
    if (!d) return false
    try {
      await bridge.writeProject(d.id, d.json)
      if (d.history) await bridge.writeProjectHistory(d.id, d.history).catch(() => {})
      const file = parseProjectFile(d.json)
      savedJson.set(d.id, d.json)
      putSummary({ ...summarizeProject(d.id, file.name || 'Vídeo sin nombre', file.project, now()), hasBackup: false })
      hideToast()
      return true
    } catch (e) {
      showError('No he podido recuperar ese vídeo.', e)
      return false
    }
  }

  /** «Volver a la copia anterior» de un vídeo (la de hace un rato); lo de ahora pasa a ser la copia. */
  async function restoreProjectBackup(id: string): Promise<boolean> {
    if (id === projectId.value) await flushAutosave()
    let json: string
    try {
      json = await bridge.restoreProjectBackup(id)
    } catch (e) {
      showError('No he podido volver a la copia anterior.', e)
      return false
    }
    try {
      const file = parseProjectFile(json)
      savedJson.set(id, json)
      savedHistory.delete(id)
      putSummary({ ...summarizeProject(id, file.name || 'Vídeo sin nombre', file.project, now()), hasBackup: true })
      if (id === projectId.value) {
        resetToEmpty()
        history.value = createHistory(file.project)
        projectId.value = id
        projectName.value = file.name
        selectedClipId.value = file.project.clips[0]?.id ?? null
        void refreshOriginals()
      }
      return true
    } catch (e) {
      showError('La copia anterior está dañada.', e)
      return false
    }
  }

  /** «Guardar en un fichero»: el vídeo en un .easycut donde se elija (para llevarlo a otro PC). */
  async function exportProject(id: string): Promise<string | null> {
    try {
      const file = await projectJson(id)
      if (!file) return null
      const path = await bridge.saveProject(serializeProject(file.project, { name: file.name }), undefined, file.name)
      if (path) showToast(`Guardado en «${baseName(path)}».`)
      return path
    } catch (e) {
      showError('No he podido guardar el fichero del vídeo.', e)
      return null
    }
  }

  /** «Abrir un fichero de vídeo (.easycut)»: lo añade a la lista (como uno más) y lo abre. */
  async function importProjectFile(): Promise<boolean> {
    let loaded: { path: string; json: string } | null
    try {
      loaded = await bridge.loadProject()
    } catch (e) {
      showError('No he podido abrir ese fichero.', e)
      return false
    }
    if (!loaded) return false
    let file: { project: Project; name: string }
    try {
      file = parseProjectFile(loaded.json)
    } catch (e) {
      showError('Ese fichero no es un vídeo de Easy Cut, o está dañado.', e)
      return false
    }
    const id = newProjectId()
    const name = uniqueProjectName(file.name || displayName(loaded.path), namesInUse())
    const json = serializeProject(file.project, { name })
    try {
      await bridge.writeProject(id, json)
    } catch (e) {
      showError('No he podido añadir ese vídeo a la lista.', e)
      return false
    }
    putSummary({ ...summarizeProject(id, name, file.project, now()), hasBackup: false })
    return openProject(id)
  }

  // ------------------------------------------------------------------ volver a enlazar un original

  /** Ficheros que usa el proyecto y no se encuentran. */
  function missingPaths(): string[] {
    return usedMediaPaths(history.value.present).filter((p) => missing.value[p] || !media.value[p])
  }

  async function probeAny(path: string): Promise<MediaInfo> {
    return bridge.probe(path, { still: isImagePath(path) })
  }

  /**
   * «Buscarlo»: pregunta dónde está ahora un fichero que falta, lo compara con el de antes y, si no cuadra o
   * hay otros que faltaban en la misma carpeta y están en la nueva, deja la pregunta en `relinkOffer`. Si todo
   * cuadra, lo cambia ya en todos los sitios (un paso de deshacer). Devuelve false si se cancela o no vale.
   */
  async function relink(oldPath: string): Promise<boolean> {
    let paths: string[]
    try {
      paths = await bridge.pickVideos({ multiple: false, forTracks: true, title: `¿Dónde está ahora «${baseName(oldPath)}»?`, defaultFolder: folderOf(oldPath) || undefined })
    } catch (e) {
      showError('No se ha podido abrir la ventana para buscar el fichero.', e)
      return false
    }
    const newPath = paths[0]
    if (!newPath) return false
    let info: MediaInfo
    try {
      info = await probeAny(newPath)
    } catch (e) {
      showError('No he podido leer ese fichero.', e)
      return false
    }
    const present = syncMediaPool(history.value.present, media.value)
    const usage = mediaUsage(present)
    const problem = relinkProblem(usage.get(oldPath) ?? NO_USAGE, info)
    if (problem) {
      showToast(problem)
      return false
    }
    const candidate = (from: string, to: string, i: MediaInfo): RelinkCandidate => {
      const before = present.media.find((m) => m.path === from)
      return { oldPath: from, newPath: to, info: i, mismatches: before ? compareMedia(before, i) : [], uses: usageTotal(usage.get(from) ?? NO_USAGE) }
    }
    const main = candidate(oldPath, newPath, info)
    const siblings: RelinkCandidate[] = []
    for (const c of siblingCandidates(missingPaths(), oldPath, newPath)) {
      try {
        if (!(await bridge.exists(c.newPath))) continue
        const i = await probeAny(c.newPath)
        if (relinkProblem(usage.get(c.oldPath) ?? NO_USAGE, i)) continue
        siblings.push(candidate(c.oldPath, c.newPath, i))
      } catch {
        // Ese no está o no se puede leer: se queda como estaba.
      }
    }
    if (main.mismatches.length === 0 && siblings.length === 0) {
      applyRelink([main])
      return true
    }
    relinkOffer.value = { main, siblings }
    return true
  }

  /** Cambia los ficheros elegidos en todos los sitios donde se usan: un solo paso de deshacer. */
  function applyRelink(list: readonly RelinkCandidate[]) {
    if (list.length === 0) return
    let p = history.value.present
    for (const c of list) {
      setMedia(c.info)
      setMissing(c.newPath, false)
      p = relinkMedia(syncMediaPool(p, media.value), c.oldPath, c.info)
    }
    commit(p)
    const uses = list.reduce((s, c) => s + c.uses, 0)
    const msg =
      list.length > 1
        ? `Encontrados ${list.length} ficheros: ya está todo en su sitio.`
        : uses > 1
          ? `Encontrado: arreglado en los ${uses} sitios donde se usa.`
          : 'Encontrado: ya está otra vez en su sitio.'
    showToast(msg, { label: 'Deshacer', run: undo })
  }

  /** Responde a la pregunta de «Buscarlo»: el elegido (si `useMain`) y los de la misma carpeta marcados. */
  function answerRelink(useMain: boolean, siblingOldPaths: readonly string[] = []) {
    const offer = relinkOffer.value
    relinkOffer.value = null
    if (!offer || !useMain) return
    const chosen = new Set(siblingOldPaths)
    applyRelink([offer.main, ...offer.siblings.filter((s) => chosen.has(s.oldPath))])
  }

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

  /**
   * Copias pequeñas (540p) de los vídeos de los huecos de un collage: aparte de `proxies`, para que el trozo que
   * use el mismo fichero se siga viendo con el original. Si no se puede hacer, se usa el original (sin avisar: se
   * guarda bien igualmente y en la vista previa solo cuesta más).
   */
  const cellProxies = shallowRef<Record<string, string>>({})
  const cellProxyStatus = shallowRef<Record<string, ProxyStatus>>({})
  async function ensureCellProxy(path: string) {
    if (cellProxyStatus.value[path]) return
    cellProxyStatus.value = { ...cellProxyStatus.value, [path]: 'working' }
    try {
      const proxy = proxies.value[path] ?? (await bridge.makePreviewProxy(path).result)
      cellProxies.value = { ...cellProxies.value, [path]: proxy }
      cellProxyStatus.value = { ...cellProxyStatus.value, [path]: 'ready' }
    } catch (e) {
      cellProxyStatus.value = { ...cellProxyStatus.value, [path]: 'error' }
      console.warn('[easy-cut] no se ha podido preparar la copia pequeña de un hueco del collage', path, e)
    }
  }

  /** De dónde sale el vídeo de un hueco en la vista previa (su copia pequeña si la hay). */
  function cellSrc(path: string): string {
    return bridge.mediaUrl(cellProxies.value[path] ?? proxies.value[path] ?? path)
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
    const info = await chooseCoverVideo()
    if (!info) return false
    apply((p) => setCover(p, clipId, info))
    return true
  }

  /**
   * El diálogo de «Elegir el vídeo» (un vídeo, leído y apuntado), sin ponerlo en ningún sitio: lo usa también
   * «Llevar a una esquina aquí» para elegir lo que se verá detrás, en el mismo paso de deshacer. null si se
   * cancela o no vale (con el aviso ya enseñado).
   */
  async function chooseCoverVideo(): Promise<MediaInfo | null> {
    let paths: string[]
    try {
      paths = await bridge.pickVideos({ multiple: false })
    } catch (e) {
      showError('No se ha podido abrir la ventana para elegir el vídeo.', e)
      return null
    }
    const path = paths[0]
    if (!path) return null
    let info: MediaInfo
    try {
      info = await bridge.probe(path)
    } catch (e) {
      showError('No he podido leer ese vídeo.', e)
      return null
    }
    if (!info.hasVideo) {
      showToast('Ese fichero no tiene imagen: elige un vídeo.')
      return null
    }
    setMedia(info)
    setMissing(path, false)
    return info
  }

  /** Cambia de pantalla. Los avisos de la anterior (p. ej. «Deshacer») ya no vienen a cuento. */
  function go(next: Screen) {
    commitPreview()
    if (screen.value !== next) {
      hideToast()
      previousScreen.value = screen.value
    }
    // Al volver a Inicio, el vídeo queda guardado y al día en la lista (sigue abierto: si se vuelve a él, con
    // su deshacer).
    if (next === 'home') void flushAutosave()
    screen.value = next
  }

  // ------------------------------------------------------------------ copiar y pegar trozos

  /** Trozo copiado en la app y la secuencia del portapapeles del sistema al copiarlo (ver domain/paste.ts). */
  /**
   * El trozo copiado, con «el vídeo de este trozo» si lo lleva (su tamaño, sitio y marcas): es parte de cómo se
   * ve el trozo, así que se pega con él (lo pegado a un trozo, sonidos y efectos, no).
   */
  const copiedClip = shallowRef<{ clip: Clip; sequence: number | null; ownVideo?: { look: EffectLook; trackId: string } | null } | null>(null)
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
    const own = findClipVideoItem(history.value.present, clipId)
    const mark = {
      clip: duplicateClip(clip, clip.id),
      sequence: systemClipboard.value?.sequence ?? null,
      ownVideo: own?.item.look ? { look: copyLook(own.item.look), trackId: own.track.id } : null,
    }
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
    const own = c.ownVideo
    apply((p) => {
      const next = insertClipAfter(p, after, fresh)
      if (!own) return next
      const itemId = `item-${defaultIdFactory()}`
      const trackId = next.tracks.some((t) => t.id === own.trackId) ? own.trackId : `track-${defaultIdFactory()}`
      return updateEffectLook(putClipVideo(next, fresh.id, own.look.box, { itemId, trackId, trackName: 'Tu vídeo encima' }), itemId, () => copyLook(own.look))
    })
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
    cellProxyStatus,
    selectedClipId,
    selectedClip,
    selectedIndex,
    editingClipId,
    editingEntry,
    preparing,
    isPreparing,
    toast,
    error,
    projects,
    projectsLoaded,
    projectId,
    projectName,
    recentProject,
    relinkOffer,
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
    loadProjects,
    openProject,
    renameProject,
    duplicateProject,
    deleteProject,
    undoDeleteProject,
    restoreProjectBackup,
    exportProject,
    importProjectFile,
    startNewProject,
    startProjectFrom,
    flushAutosave,
    missingPaths,
    relink,
    answerRelink,
    select,
    moveBy,
    moveTo,
    removeClip,
    openClipEditor,
    closeClipEditor,
    revertClipChanges,
    ensureProxy,
    mediaSrc,
    ensureCellProxy,
    cellSrc,
    thumbnail,
    thumbnails,
    waveform,
    pickCover,
    chooseCoverVideo,
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
