// Flujo de «Guardar el vídeo»: elegir para qué es, guardar con progreso, cancelar y el «¡Listo!».

import { ref, shallowRef } from 'vue'
import {
  computeOutputSpec,
  normalizedExportFactor,
  type ProgressUpdate,
  type SaveTarget,
  type VideoEncoder,
} from '../domain'
import { CancelledError } from '../native/bridge'
import type { EditorStore } from './editor'
import type { LibraryStore } from './library'
import { ExportError, startExport, type ExportJob, type ExportResult } from './exporter'

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

export function createSaveFlow(store: EditorStore, library: LibraryStore | null = null) {
  const preset = ref<SaveTarget>('whatsapp')
  const progress = shallowRef<ProgressUpdate | null>(null)
  const running = ref(false)
  const result = shallowRef<ExportResult | null>(null)
  const retrying = ref(false)
  /** Encoder hardware disponible (para estimar cuánto tarda). null = aún no se sabe. */
  const hardware = ref<boolean | null>(null)
  let job: ExportJob | null = null

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

  async function start(id: SaveTarget) {
    if (running.value) return
    preset.value = id
    progress.value = null
    retrying.value = false
    result.value = null
    running.value = true
    store.go('saving')
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
        running.value = false
        store.go('save')
        store.showError('Falta por descargar algo de la biblioteca y ahora no se puede. Mira si hay conexión a internet y vuelve a probar.', e)
        return
      }
    }
    const media = store.media.value
    job = startExport(store.bridge, {
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
    })
    try {
      const res = await job.result
      result.value = res
      store.lastExport.value = { path: res.path, folder: res.folder, durationMs: res.expectedDurationMs, target: id }
      // Lo que ha tardado de verdad afina la estimación de la próxima vez (solo los vídeos).
      if (id !== 'sound' && res.encoder) {
        const spec = computeOutputSpec(project, media, id)
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
      if (e instanceof CancelledError) {
        store.go('save')
        store.showToast(`No se ha guardado. No queda ningún ${what} a medias.`)
      } else {
        store.go('save')
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

  return { preset, progress, running, result, retrying, hardware, detectHardware, measuredFactor, start, cancel }
}

export type SaveFlow = ReturnType<typeof createSaveFlow>
