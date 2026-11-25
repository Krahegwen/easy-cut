// Guardar el vídeo: comprueba los originales, elige encoder, escribe el filtro en un fichero,
// lanza ffmpeg con progreso y, si falla con un encoder hardware, lo reintenta solo con libx264.
// Al cancelar o fallar, borra el fichero a medias.

import {
  buildExportCommand,
  buildOutputFileName,
  chooseEncoder,
  createProgressParser,
  SOFTWARE_ENCODER,
  type MediaInfo,
  type PresetId,
  type ProgressUpdate,
  type Project,
  type VideoEncoder,
} from '../domain'
import { CancelledError, type NativeBridge, type RunningProcess } from '../native/bridge'

/** Error con un mensaje para la persona y los detalles técnicos aparte. */
export class ExportError extends Error {
  constructor(
    message: string,
    readonly details: string,
  ) {
    super(message)
    this.name = 'ExportError'
  }
}

export interface ExportResult {
  path: string
  folder: string
  encoder: VideoEncoder
  expectedDurationMs: number
  elapsedMs: number
  width: number
  height: number
  fps: number
}

export interface ExportJob {
  result: Promise<ExportResult>
  cancel(): void
  readonly outputPath: string | null
}

export interface ExportRequest {
  project: Project
  media: Record<string, MediaInfo>
  preset: PresetId
  onProgress?: (update: ProgressUpdate) => void
  /** Se avisa al pasar a otro encoder tras un fallo (para el registro). */
  onRetry?: (failed: VideoEncoder, next: VideoEncoder, stderr: string) => void
  now?: () => Date
}

function tail(text: string, lines = 25): string {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(-lines).join('\n')
}

/** Encoders a probar: el elegido y, si es hardware, libx264 como red de seguridad. */
export function exportEncoderChain(first: VideoEncoder): VideoEncoder[] {
  return first === SOFTWARE_ENCODER ? [SOFTWARE_ENCODER] : [first, SOFTWARE_ENCODER]
}

export function startExport(bridge: NativeBridge, request: ExportRequest): ExportJob {
  let cancelled = false
  let running: RunningProcess<unknown> | null = null
  let outputPath: string | null = null

  const throwIfCancelled = () => {
    if (cancelled) throw new CancelledError()
  }

  const removePartial = async () => {
    if (!outputPath) return
    try {
      await bridge.deletePartialOutput(outputPath)
    } catch (e) {
      console.warn('[easy-cut] no se ha podido borrar el vídeo a medias', e)
    }
  }

  const result = (async (): Promise<ExportResult> => {
    const { project, media, preset } = request
    if (project.clips.length === 0) throw new ExportError('El vídeo no tiene ningún trozo.', 'proyecto vacío')

    // Todos los originales tienen que seguir ahí.
    const paths = [...new Set(project.clips.map((c) => c.sourcePath))]
    const exists = await Promise.all(paths.map((p) => bridge.exists(p).catch(() => false)))
    const lost = paths.filter((_, i) => !exists[i] || !media[paths[i]!])
    if (lost.length > 0) {
      throw new ExportError(
        lost.length === 1
          ? 'No encuentro uno de los vídeos originales. Quítalo del vídeo o vuelve a ponerlo donde estaba.'
          : `No encuentro ${lost.length} de los vídeos originales. Quítalos del vídeo o vuelve a ponerlos donde estaban.`,
        lost.join('\n'),
      )
    }
    throwIfCancelled()

    const encoders = await bridge.probeEncoders()
    const chain = exportEncoderChain(chooseEncoder(encoders))
    const folder = await bridge.getOutputFolder()
    const name = buildOutputFileName(request.now?.() ?? new Date(), preset, await bridge.listFileNames(folder))
    const out = bridge.joinPath(folder, name)
    throwIfCancelled()

    // El filtro va en un fichero: con muchos trozos pasaría del límite de la línea de comandos.
    const draft = buildExportCommand(project, media, preset, chain[0]!, out)
    const filterScriptPath = await bridge.writeTempTextFile('filtro-exportacion.txt', draft.filterComplex)
    throwIfCancelled()

    const failures: string[] = []
    for (let i = 0; i < chain.length; i++) {
      const encoder = chain[i]!
      const cmd = buildExportCommand(project, media, preset, encoder, out, { filterScriptPath })
      const startedAt = Date.now()
      const parser = createProgressParser(cmd.expectedDurationMs, startedAt)
      outputPath = out
      const job = bridge.runFfmpeg(cmd.args, (line) => {
        for (const update of parser.push(`${line}\n`, Date.now())) request.onProgress?.(update)
      })
      running = job
      let exitCode: number
      let stderr: string
      try {
        const res = await job.result
        exitCode = res.exitCode
        stderr = res.stderr
      } catch (e) {
        running = null
        await removePartial()
        if (e instanceof CancelledError || cancelled) throw new CancelledError()
        throw e
      }
      running = null
      if (cancelled) {
        await removePartial()
        throw new CancelledError()
      }
      if (exitCode === 0) {
        return {
          path: out,
          folder,
          encoder,
          expectedDurationMs: cmd.expectedDurationMs,
          elapsedMs: Date.now() - startedAt,
          width: cmd.spec.width,
          height: cmd.spec.height,
          fps: cmd.spec.fps,
        }
      }
      failures.push(`[${encoder}] código ${exitCode}\n${tail(stderr)}`)
      await removePartial()
      const next = chain[i + 1]
      if (next) request.onRetry?.(encoder, next, stderr)
    }
    throw new ExportError('No se ha podido guardar el vídeo.', failures.join('\n\n'))
  })()

  return {
    result,
    cancel() {
      if (cancelled) return
      cancelled = true
      running?.cancel()
    },
    get outputPath() {
      return outputPath
    },
  }
}
