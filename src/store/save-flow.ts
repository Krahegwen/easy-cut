// Flujo de «Guardar el vídeo»: elegir para qué es, guardar con progreso, cancelar y el «¡Listo!».

import { ref, shallowRef } from 'vue'
import {
  buildSaveLogEntry,
  computeOutputSpec,
  emptyExportReport,
  librarySaveMessage,
  normalizedExportFactor,
  serializeSaveLogEntry,
  type ExportReport,
  type ProgressUpdate,
  type SaveLogEntry,
  type SaveOutcome,
  buildTrimFileName,
  trimProject,
  type CopyPlan,
  type MediaInfo,
  type Project,
  type SaveTarget,
  type SaveTool,
  type TrimMode,
  type TrimRange,
  type VideoEncoder,
} from '../domain'
import { CancelledError } from '../native/bridge'
import type { EditorStore, Screen } from './editor'
import type { LibraryStore } from './library'
import { ExportError, startExport, startTrimCopy, type ExportJob, type ExportResult } from './exporter'

/** Lo que guarda «Solo recortar». */
export interface TrimSaveRequest {
  info: MediaInfo
  range: TrimRange
  mode: TrimMode
  /** Lo que copia «Rápido» (desde el fotograma clave). */
  plan: CopyPlan
}

const FACTOR_KEY = 'easy-cut:export-factor'

type FactorStore = Partial<Record<'hardware' | 'software', number>>

function readFactors(): FactorStore {
  try {
    return JSON.parse(localStorage.getItem(FACTOR_KEY) ?? '{}') as FactorStore
  } catch {
    return {}
  }
}

function writeFactors(f: FactorStore) {
  try {
    localStorage.setItem(FACTOR_KEY, JSON.stringify(f))
  } catch {
    // Sin almacenamiento: se queda la estimación de serie.
  }
}

export interface SaveFlowOptions {
  /** Versión de la app, para el registro de guardados. */
  appVersion?: string
  /** Reloj en ms (por defecto Date.now; para los tests). */
  clock?: () => number
}

export function createSaveFlow(store: EditorStore, library: LibraryStore | null = null, options: SaveFlowOptions = {}) {
  const clock = options.clock ?? Date.now
  const preset = ref<SaveTarget>('whatsapp')
  const progress = shallowRef<ProgressUpdate | null>(null)
  const running = ref(false)
  const result = shallowRef<ExportResult | null>(null)
  const retrying = ref(false)
  /** Entrada del registro del último guardado que salió bien (la frase y «Copiar detalles» de «¡Listo!»). */
  const lastLog = shallowRef<SaveLogEntry | null>(null)
  /** Encoder hardware disponible (para estimar cuánto tarda). null = aún no se sabe. */
  const hardware = ref<boolean | null>(null)
  let job: ExportJob | null = null
  let recording: Promise<void> = Promise.resolve()

  async function detectHardware() {
    if (hardware.value !== null) return
    try {
      const r = await store.bridge.probeEncoders()
      hardware.value = !!(r.h264_nvenc || r.h264_qsv || r.h264_amf)
    } catch {
      hardware.value = false
    }
  }

  function measuredFactor(): number | null {
    const f = readFactors()
    const v = hardware.value ? f.hardware : f.software
    return typeof v === 'number' && v > 0 ? v : null
  }

  /**
   * Apunta el guardado en el registro. Nunca hace fallar el guardado: si no se puede escribir, solo un log.
   * La entrada de un guardado que salió bien se queda en `lastLog` para «¡Listo!».
   */
  async function record(report: ExportReport, outcome: SaveOutcome, startedAt: Date, startedMs: number, error: unknown, path: string | null) {
    try {
      const elapsedMs = clock() - startedMs
      const bytes = path ? await store.bridge.outputFileSize(path).catch(() => null) : null
      const entry = buildSaveLogEntry({
        report,
        result: outcome,
        startedAt,
        elapsedMs,
        appVersion: options.appVersion ?? '',
        bytes,
        errorMessage: error instanceof ExportError ? error.message : error instanceof Error ? error.message : error ? String(error) : null,
      })
      if (outcome === 'ok') lastLog.value = entry
      await store.bridge.appendSaveLog(serializeSaveLogEntry(entry))
    } catch (e) {
      console.warn('[easy-cut] no se ha podido apuntar el guardado en el registro', e)
    }
  }

  /** Desde dónde se ha guardado lo último: «Tu vídeo» o «Solo recortar» (adónde vuelven Guardando y ¡Listo!). */
  const origin = ref<SaveTool>('editor')

  async function start(id: SaveTarget) {
    if (running.value) return
    begin(id, 'editor')
    // Lo que espera la persona cuenta desde aquí (también lo que tarde en bajar algo de la biblioteca).
    const startedAt = new Date()
    const startedMs = clock()
    const project = store.project.value
    // Lo de la biblioteca que se usa tiene que estar descargado (normalmente ya lo está desde que se puso).
    if (library) {
      try {
        for (const item of project.tracks.flatMap((t) => t.items)) {
          if (item.source.type !== 'library') continue
          const asset = library.asset(item.source.assetId)
          if (asset) await library.ensureAsset(asset)
        }
      } catch (e) {
        recording = record(emptyExportReport(id), 'error', startedAt, startedMs, librarySaveMessage(e), null)
        running.value = false
        store.go('save')
        store.showError(librarySaveMessage(e), e)
        return
      }
    }
    const media = store.media.value
    await runJob(
      id,
      startExport(store.bridge, {
        project,
        media,
        itemPath: library ? library.itemPath : undefined,
        preset: id,
        onProgress: (u) => (progress.value = u),
        onRetry: (failed: VideoEncoder, next: VideoEncoder, stderr: string) => {
          retrying.value = true
          progress.value = null
          console.warn(`[easy-cut] la exportación con ${failed} ha fallado; se reintenta con ${next}`, stderr.slice(-2000))
        },
      }),
      { startedAt, startedMs, back: 'save', learn: id !== 'sound' ? { project, media } : null },
    )
  }

  /**
   * «Solo recortar»: «Rápido» copia el tramo tal cual; «Exacto» guarda un proyecto de un solo trozo por el camino
   * normal (calidad alta, con su reintento con libx264). Mismas pantallas Guardando y ¡Listo!; al cancelar o
   * fallar, se vuelve a «Solo recortar».
   */
  async function startTrim(request: TrimSaveRequest) {
    if (running.value) return
    begin('high', 'trim')
    const startedAt = new Date()
    const startedMs = clock()
    const { info, range, mode, plan } = request
    const job =
      mode === 'copy'
        ? startTrimCopy(store.bridge, { info, plan, onProgress: (u) => (progress.value = u) })
        : startExport(store.bridge, {
            project: trimProject(info, range),
            media: { [info.path]: info },
            preset: 'high',
            tool: 'trim',
            outputName: (names) => buildTrimFileName(info.path, names),
            onProgress: (u) => (progress.value = u),
            onRetry: (failed: VideoEncoder, next: VideoEncoder, stderr: string) => {
              retrying.value = true
              progress.value = null
              console.warn(`[easy-cut] el recorte con ${failed} ha fallado; se reintenta con ${next}`, stderr.slice(-2000))
            },
          })
    await runJob('high', job, { startedAt, startedMs, back: 'trim', learn: null })
  }

  function begin(id: SaveTarget, from: SaveTool) {
    preset.value = id
    origin.value = from
    progress.value = null
    retrying.value = false
    result.value = null
    lastLog.value = null
    running.value = true
    store.go('saving')
  }

  async function runJob(
    id: SaveTarget,
    current: ExportJob,
    opts: { startedAt: Date; startedMs: number; back: Screen; learn: { project: Project; media: Record<string, MediaInfo> } | null },
  ) {
    job = current
    const { startedAt, startedMs } = opts
    try {
      const res = await current.result
      result.value = res
      // El registro va aparte: no hace esperar al «¡Listo!».
      recording = record(current.report, 'ok', startedAt, startedMs, null, res.path)
      store.lastExport.value = { path: res.path, folder: res.folder, durationMs: res.expectedDurationMs, target: id }
      // Lo que ha tardado de verdad afina la estimación de la próxima vez (solo los vídeos del montaje).
      if (opts.learn && res.encoder && id !== 'sound') {
        const spec = computeOutputSpec(opts.learn.project, opts.learn.media, id)
        const factor = normalizedExportFactor(spec, res.expectedDurationMs, res.elapsedMs)
        if (factor > 0) {
          const f = readFactors()
          f[res.encoder === 'libx264' ? 'software' : 'hardware'] = factor
          writeFactors(f)
        }
      }
      store.go('done')
    } catch (e) {
      const what = id === 'sound' ? 'sonido' : 'vídeo'
      recording = record(current.report, e instanceof CancelledError ? 'cancelled' : 'error', startedAt, startedMs, e, null)
      store.go(opts.back)
      if (e instanceof CancelledError) {
        store.showToast(`No se ha guardado. No queda ningún ${what} a medias.`)
      } else {
        const message = e instanceof ExportError ? e.message : `No se ha podido guardar el ${what}.`
        store.showError(message, e instanceof ExportError ? e.details : e)
      }
    } finally {
      running.value = false
      job = null
    }
  }

  function cancel() {
    job?.cancel()
  }

  /** Espera a que se haya apuntado el último guardado en el registro (para los tests). */
  function whenRecorded(): Promise<void> {
    return recording
  }

  return { preset, origin, progress, running, result, retrying, hardware, lastLog, detectHardware, measuredFactor, start, startTrim, cancel, whenRecorded }
}

export type SaveFlow = ReturnType<typeof createSaveFlow>
