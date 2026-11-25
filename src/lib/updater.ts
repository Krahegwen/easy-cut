// Actualizaciones de la app: cuándo se comprueba si hay una versión nueva, qué se enseña y cómo se instala.
// La parte nativa (el plugin updater de Tauri) entra por UpdaterBackend: así esta lógica se prueba en Vitest
// sin Tauri. Las comprobaciones automáticas son silenciosas: si no hay red o fallan, solo queda un log.

import { computed, ref, shallowRef } from 'vue'

/** Eventos de la descarga, tal como los da el plugin (sin sus nombres). */
export type DownloadEvent =
  | { kind: 'started'; totalBytes: number | null }
  | { kind: 'progress'; chunkBytes: number }
  | { kind: 'finished' }

/** Una versión nueva anunciada por el servidor de actualizaciones. */
export interface AvailableUpdate {
  version: string
  /** Descarga el instalador y comprueba su firma (falla si no coincide). */
  download(onEvent: (e: DownloadEvent) => void): Promise<void>
  /** Instala lo descargado. En Windows cierra la app y el instalador la vuelve a abrir. */
  install(): Promise<void>
  /** Suelta lo que el plugin guarda de esta actualización (si no se instala). */
  close(): Promise<void>
}

export interface UpdaterBackend {
  /** La versión nueva, o null si ya se tiene la última. */
  check(): Promise<AvailableUpdate | null>
  /** Reinicia la app (por si el instalador no la cierra él mismo). */
  relaunch(): Promise<void>
}

export interface UpdaterTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface UpdaterOptions {
  backend: UpdaterBackend
  /** Antes de instalar: escribir ya el autoguardado (el vídeo a medias no se pierde). */
  beforeInstall: () => Promise<void>
  /** ¿Hay un guardado o una grabación en curso? Entonces ni se ofrece ni se instala. */
  busy: () => boolean
  /** Espera tras arrancar hasta la primera comprobación (ms). */
  firstCheckDelayMs?: number
  /** Como mucho una comprobación automática cada tanto (ms). */
  intervalMs?: number
  now?: () => number
  timers?: UpdaterTimers
  log?: (message: string, error?: unknown) => void
}

export const FIRST_CHECK_DELAY_MS = 8_000
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Lo que responde «Buscar actualizaciones» (lo pidió la persona: aquí sí se dice qué ha pasado). */
export type ManualCheckStatus = 'idle' | 'checking' | 'up-to-date' | 'found' | 'failed'

/** El diálogo de actualizar, por fases. */
export type UpdateDialog =
  | { phase: 'confirm'; version: string }
  | { phase: 'downloading'; version: string; downloadedBytes: number; totalBytes: number | null }
  | { phase: 'installing'; version: string }
  | { phase: 'failed'; details: string }

export const UPDATE_FAILED_MESSAGE = 'No se ha podido actualizar. No se ha perdido nada: puedes seguir usando esta versión.'

/** Parte descargada, de 0 a 1, o null si no se sabe el tamaño total. */
export function downloadFraction(dialog: UpdateDialog | null): number | null {
  if (!dialog || dialog.phase !== 'downloading') return null
  if (!dialog.totalBytes || dialog.totalBytes <= 0) return null
  return Math.min(1, dialog.downloadedBytes / dialog.totalBytes)
}

/** Convierte un error del plugin en texto para «Copiar detalles». */
export function updateErrorDetails(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const defaultTimers: UpdaterTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export function createUpdater(options: UpdaterOptions) {
  const backend = options.backend
  const firstCheckDelayMs = options.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS
  const intervalMs = options.intervalMs ?? CHECK_INTERVAL_MS
  const now = options.now ?? (() => Date.now())
  const timers = options.timers ?? defaultTimers
  const log = options.log ?? ((message: string, error?: unknown) => console.warn(`[easy-cut] ${message}`, error ?? ''))

  /** La versión nueva encontrada (se queda hasta instalarla o hasta cerrar la app). */
  const available = shallowRef<AvailableUpdate | null>(null)
  /** «Más tarde»: no se vuelve a enseñar el aviso hasta el próximo arranque. */
  const dismissed = ref(false)
  const dialog = shallowRef<UpdateDialog | null>(null)
  const manualStatus = ref<ManualCheckStatus>('idle')

  let timer: unknown = null
  let lastCheckAt: number | null = null
  let inFlight: Promise<void> | null = null
  let started = false
  /** Descarga en curso que se ha cancelado: cuando acabe, no se instala. */
  let cancelledDownload: AvailableUpdate | null = null

  /** ¿Se enseña el aviso? Hay versión nueva, no se ha dicho «Más tarde», no hay diálogo ni nada en curso. */
  const noticeVisible = computed(() => !!available.value && !dismissed.value && !dialog.value && !options.busy())

  function schedule(delayMs: number) {
    if (timer !== null) timers.clearTimeout(timer)
    timer = timers.setTimeout(() => {
      timer = null
      void autoCheck()
    }, delayMs)
  }

  async function autoCheck() {
    // Si ya se sabe que hay una nueva, no hace falta seguir preguntando.
    if (available.value) return
    const elapsed = lastCheckAt === null ? Infinity : now() - lastCheckAt
    if (elapsed < intervalMs) {
      schedule(intervalMs - elapsed)
      return
    }
    await runCheck(false)
    if (!available.value) schedule(intervalMs)
  }

  async function runCheck(manual: boolean): Promise<void> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      lastCheckAt = now()
      try {
        const update = await backend.check()
        if (update) {
          const previous = available.value
          if (previous && previous !== update) void previous.close().catch(() => {})
          available.value = update
          if (manual) {
            dismissed.value = false
            manualStatus.value = 'found'
          }
        } else if (manual) {
          manualStatus.value = 'up-to-date'
        }
      } catch (e) {
        // Sin red, GitHub caído, latest.json que no está…: silencio (solo el log).
        log('no se ha podido comprobar si hay una versión nueva', e)
        if (manual) manualStatus.value = 'failed'
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  /** Empieza a comprobar sola: la primera vez unos segundos después de arrancar, luego cada `intervalMs`. */
  function start() {
    if (started) return
    started = true
    schedule(firstCheckDelayMs)
  }

  function stop() {
    started = false
    if (timer !== null) timers.clearTimeout(timer)
    timer = null
  }

  /** «Buscar actualizaciones»: comprueba ya y dice qué ha pasado. */
  async function checkNow() {
    if (dialog.value) return
    if (available.value) {
      // Ya se sabe: se vuelve a enseñar el aviso aunque se hubiera dicho «Más tarde».
      dismissed.value = false
      manualStatus.value = 'found'
      return
    }
    manualStatus.value = 'checking'
    await runCheck(true)
  }

  /** «Más tarde»: hasta el próximo arranque. */
  function later() {
    dismissed.value = true
  }

  /** «Actualizar ahora» del aviso: abre la pregunta (Easy Cut se cerrará un momento). */
  function askToUpdate() {
    const update = available.value
    if (!update || dialog.value || options.busy()) return
    dialog.value = { phase: 'confirm', version: update.version }
  }

  /** «Actualizar ahora» del diálogo: escribe el autoguardado, descarga con progreso e instala. */
  async function updateNow() {
    const update = available.value
    if (!update || options.busy()) return
    if (dialog.value && dialog.value.phase !== 'confirm') return
    cancelledDownload = null
    dialog.value = { phase: 'downloading', version: update.version, downloadedBytes: 0, totalBytes: null }
    try {
      await options.beforeInstall()
      await update.download((e) => {
        const d = dialog.value
        if (cancelledDownload === update || !d || d.phase !== 'downloading') return
        if (e.kind === 'started') dialog.value = { ...d, totalBytes: e.totalBytes }
        else if (e.kind === 'progress') dialog.value = { ...d, downloadedBytes: d.downloadedBytes + e.chunkBytes }
        else dialog.value = { ...d, downloadedBytes: d.totalBytes ?? d.downloadedBytes }
      })
      if (cancelledDownload === update) {
        cancelledDownload = null
        return
      }
      // Mientras se descargaba no ha podido empezar nada (el diálogo tapa la app), pero por si acaso.
      if (options.busy()) {
        dialog.value = null
        return
      }
      dialog.value = { phase: 'installing', version: update.version }
      // Justo antes de que el instalador cierre la app: lo último del vídeo a medias, al disco.
      await options.beforeInstall()
      await update.install()
      // En Windows no se llega aquí (el instalador cierra la app y la vuelve a abrir).
      await backend.relaunch()
    } catch (e) {
      if (cancelledDownload === update) {
        cancelledDownload = null
        return
      }
      log('no se ha podido actualizar', e)
      dialog.value = { phase: 'failed', details: updateErrorDetails(e) }
      // No se vuelve a ofrecer en esta sesión: la versión instalada sigue funcionando.
      available.value = null
      dismissed.value = true
      void update.close().catch(() => {})
    }
  }

  /** Cerrar el diálogo: en la pregunta, «Más tarde»; descargando, «Cancelar»; tras un fallo, «Entendido». */
  function closeDialog() {
    const d = dialog.value
    if (!d) return
    if (d.phase === 'installing') return
    if (d.phase === 'confirm') {
      dialog.value = null
      later()
      return
    }
    if (d.phase === 'downloading') {
      // El plugin no corta una descarga empezada: se deja acabar y se descarta (no se instala).
      const update = available.value
      cancelledDownload = update
      dialog.value = null
      available.value = null
      dismissed.value = true
      if (update) void update.close().catch(() => {})
      return
    }
    dialog.value = null
  }

  return {
    available,
    dismissed,
    dialog,
    manualStatus,
    noticeVisible,
    start,
    stop,
    checkNow,
    later,
    askToUpdate,
    updateNow,
    closeDialog,
  }
}

export type Updater = ReturnType<typeof createUpdater>
