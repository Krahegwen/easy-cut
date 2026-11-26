// Guardar el vídeo: comprueba los originales, elige encoder, escribe el filtro en un fichero,
// lanza ffmpeg con progreso y, si falla con un encoder hardware, lo reintenta solo con libx264.
// Al cancelar o fallar, borra el fichero a medias. Va apuntando en `report` lo que pasa (encoders probados, cada
// intento y por qué falló) para el registro de guardados (domain/save-log.ts).

import {
  availableEncoderList,
  baseName,
  buildExportCommand,
  buildOutputFileName,
  buildSoundExportCommand,
  buildTrimCopyArgs,
  buildTrimFileName,
  copyProblem,
  chooseEncoder,
  clipPaths,
  createProgressParser,
  emptyExportReport,
  lastUsefulFfmpegLine,
  SOFTWARE_ENCODER,
  type CopyPlan,
  type ExportReport,
  type MediaInfo,
  type ProgressUpdate,
  type Project,
  type SaveTarget,
  type SaveTool,
  type TrackItem,
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
  /** null en «Solo el sonido» (no hay vídeo que codificar). */
  encoder: VideoEncoder | null
  expectedDurationMs: number
  elapsedMs: number
  /** 0 en «Solo el sonido». */
  width: number
  height: number
  fps: number
}

export interface ExportJob {
  result: Promise<ExportResult>
  cancel(): void
  readonly outputPath: string | null
  /** Lo que se sabe de este guardado hasta ahora (también si se cancela o falla). */
  readonly report: ExportReport
}

export interface ExportRequest {
  project: Project
  media: Record<string, MediaInfo>
  /** Un vídeo con uno de los presets, o 'sound' para «Solo el sonido» (M4A). */
  preset: SaveTarget
  onProgress?: (update: ProgressUpdate) => void
  /** Se avisa al pasar a otro encoder tras un fallo (para el registro). */
  onRetry?: (failed: VideoEncoder, next: VideoEncoder, stderr: string) => void
  now?: () => Date
  /** Reloj en ms para medir lo que tarda cada intento (por defecto Date.now; para los tests). */
  clock?: () => number
  /** Fichero de cada elemento de las pistas (los de la biblioteca, ya descargados; null = no está). */
  itemPath?: (item: TrackItem) => string | null
  /** Desde dónde se guarda (para el registro): «Tu vídeo» (por defecto) o «Solo recortar», «Exacto». */
  tool?: SaveTool
  /** Nombre del fichero según los que ya hay (por defecto, «Vídeo del … (para WhatsApp).mp4»…). */
  outputName?: (existingNames: readonly string[]) => string
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
  const report = emptyExportReport(request.preset, 'encode', request.tool ?? 'editor')
  const clock = request.clock ?? Date.now

  /** Apunta un intento de ffmpeg que no terminó (cancelado o error al lanzarlo). */
  const unfinished = (encoder: VideoEncoder | null, startedAt: number) => {
    report.attempts.push({ encoder, exitCode: null, ms: clock() - startedAt, error: null })
  }

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

    // Todos los originales tienen que seguir ahí (los vídeos de encima solo si se guarda un vídeo), también
    // los sonidos y efectos de las pistas que suenan o se ven.
    const itemPath = request.itemPath ?? ((i: TrackItem) => (i.source.type === 'file' ? i.source.path : null))
    // «El vídeo de este trozo» no es un fichero aparte: es el original de su trozo, que ya se comprueba.
    const trackPaths = project.tracks
      .filter((t) => !(t.kind === 'sound' ? t.muted : t.hidden))
      .flatMap((t) => t.items)
      .filter((i) => i.source.type !== 'clip')
      .map((i) => itemPath(i))
    if (trackPaths.some((p) => p === null)) {
      throw new ExportError('Falta por descargar algo de la biblioteca. Mira si hay conexión a internet y vuelve a probar.', 'elemento de la biblioteca sin fichero')
    }
    const paths = [...new Set([...project.clips.flatMap((c) => (preset === 'sound' ? [c.sourcePath] : clipPaths(c))), ...(trackPaths as string[])])]
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

    if (preset === 'sound') {
      // «Solo el sonido»: sin encoder de vídeo que elegir ni reintento.
      const folder = await bridge.getOutputFolder()
      const out = bridge.joinPath(folder, buildOutputFileName(request.now?.() ?? new Date(), 'sound', await bridge.listFileNames(folder)))
      throwIfCancelled()
      const draft = buildSoundExportCommand(project, media, out, { itemPath })
      const filterScriptPath = await bridge.writeTempTextFile('filtro-sonido.txt', draft.filterComplex)
      throwIfCancelled()
      const cmd = buildSoundExportCommand(project, media, out, { filterScriptPath, itemPath })
      report.durationMs = cmd.expectedDurationMs
      report.fileName = baseName(out)
      const startedAt = clock()
      const parser = createProgressParser(cmd.expectedDurationMs, startedAt)
      outputPath = out
      const job = bridge.runFfmpeg(cmd.args, (line) => {
        for (const update of parser.push(`${line}\n`, Date.now())) request.onProgress?.(update)
      })
      running = job
      let res: { exitCode: number; stderr: string }
      try {
        res = await job.result
      } catch (e) {
        running = null
        unfinished(null, startedAt)
        await removePartial()
        if (e instanceof CancelledError || cancelled) throw new CancelledError()
        throw e
      }
      running = null
      if (cancelled) {
        unfinished(null, startedAt)
        await removePartial()
        throw new CancelledError()
      }
      report.attempts.push({ encoder: null, exitCode: res.exitCode, ms: clock() - startedAt, error: res.exitCode === 0 ? null : lastUsefulFfmpegLine(res.stderr) })
      if (res.exitCode !== 0) {
        await removePartial()
        throw new ExportError('No se ha podido guardar el sonido.', `código ${res.exitCode}\n${tail(res.stderr)}`)
      }
      return { path: out, folder, encoder: null, expectedDurationMs: cmd.expectedDurationMs, elapsedMs: clock() - startedAt, width: 0, height: 0, fps: 0 }
    }

    const encoders = await bridge.probeEncoders()
    const chain = exportEncoderChain(chooseEncoder(encoders))
    report.availableEncoders = availableEncoderList(encoders)
    report.requestedEncoder = chain[0]!
    const folder = await bridge.getOutputFolder()
    const existing = await bridge.listFileNames(folder)
    const name = request.outputName ? request.outputName(existing) : buildOutputFileName(request.now?.() ?? new Date(), preset, existing)
    const out = bridge.joinPath(folder, name)
    report.fileName = name
    throwIfCancelled()

    // El filtro va en un fichero: con muchos trozos pasaría del límite de la línea de comandos.
    const draft = buildExportCommand(project, media, preset, chain[0]!, out, { itemPath })
    report.durationMs = draft.expectedDurationMs
    report.width = draft.spec.width
    report.height = draft.spec.height
    report.fps = draft.spec.fps
    const filterScriptPath = await bridge.writeTempTextFile('filtro-exportacion.txt', draft.filterComplex)
    throwIfCancelled()

    const failures: string[] = []
    for (let i = 0; i < chain.length; i++) {
      const encoder = chain[i]!
      const cmd = buildExportCommand(project, media, preset, encoder, out, { filterScriptPath, itemPath })
      const startedAt = clock()
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
        unfinished(encoder, startedAt)
        await removePartial()
        if (e instanceof CancelledError || cancelled) throw new CancelledError()
        throw e
      }
      running = null
      if (cancelled) {
        unfinished(encoder, startedAt)
        await removePartial()
        throw new CancelledError()
      }
      report.attempts.push({ encoder, exitCode, ms: clock() - startedAt, error: exitCode === 0 ? null : lastUsefulFfmpegLine(stderr) })
      if (exitCode === 0) {
        return {
          path: out,
          folder,
          encoder,
          expectedDurationMs: cmd.expectedDurationMs,
          elapsedMs: clock() - startedAt,
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
    report,
  }
}

export interface TrimCopyExportRequest {
  info: MediaInfo
  plan: CopyPlan
  onProgress?: (update: ProgressUpdate) => void
  clock?: () => number
}

/**
 * «Solo recortar», «Rápido»: copia el tramo del original tal cual (sin recodificar) a «Mis montajes» con el
 * nombre «… (recortado).mp4». Sin encoder que elegir ni reintento. Al cancelar o fallar, borra el fichero a
 * medias. El original no se toca.
 */
export function startTrimCopy(bridge: NativeBridge, request: TrimCopyExportRequest): ExportJob {
  let cancelled = false
  let running: RunningProcess<unknown> | null = null
  let outputPath: string | null = null
  const report = emptyExportReport('high', 'copy', 'trim')
  const clock = request.clock ?? Date.now
  const { info, plan } = request

  const removePartial = async () => {
    if (!outputPath) return
    try {
      await bridge.deletePartialOutput(outputPath)
    } catch (e) {
      console.warn('[easy-cut] no se ha podido borrar el vídeo a medias', e)
    }
  }

  const result = (async (): Promise<ExportResult> => {
    const problem = copyProblem(info)
    if (problem) throw new ExportError(problem, `copia no disponible: ${info.videoCodec} / ${info.audioCodec ?? 'sin sonido'}`)
    if (!(await bridge.exists(info.path).catch(() => false))) {
      throw new ExportError('No encuentro el vídeo original. Vuelve a ponerlo donde estaba.', info.path)
    }
    if (cancelled) throw new CancelledError()
    const folder = await bridge.getOutputFolder()
    const name = buildTrimFileName(info.path, await bridge.listFileNames(folder))
    const out = bridge.joinPath(folder, name)
    const expectedMs = plan.endMs - plan.startMs
    report.fileName = name
    report.durationMs = expectedMs
    report.width = info.width
    report.height = info.height
    report.fps = info.fps
    if (cancelled) throw new CancelledError()

    const args = buildTrimCopyArgs({ sourcePath: info.path, outputPath: out, plan, info })
    const startedAt = clock()
    const parser = createProgressParser(expectedMs, startedAt)
    outputPath = out
    const job = bridge.runFfmpeg(args, (line) => {
      for (const update of parser.push(`${line}\n`, Date.now())) request.onProgress?.(update)
    })
    running = job
    let res: { exitCode: number; stderr: string }
    try {
      res = await job.result
    } catch (e) {
      running = null
      report.attempts.push({ encoder: null, exitCode: null, ms: clock() - startedAt, error: null })
      await removePartial()
      if (e instanceof CancelledError || cancelled) throw new CancelledError()
      throw e
    }
    running = null
    if (cancelled) {
      report.attempts.push({ encoder: null, exitCode: null, ms: clock() - startedAt, error: null })
      await removePartial()
      throw new CancelledError()
    }
    report.attempts.push({ encoder: null, exitCode: res.exitCode, ms: clock() - startedAt, error: res.exitCode === 0 ? null : lastUsefulFfmpegLine(res.stderr) })
    if (res.exitCode !== 0) {
      await removePartial()
      throw new ExportError('No se ha podido guardar el vídeo recortado. Prueba con «Exacto».', `código ${res.exitCode}\n${tail(res.stderr)}`)
    }
    return { path: out, folder, encoder: null, expectedDurationMs: expectedMs, elapsedMs: clock() - startedAt, width: info.width, height: info.height, fps: info.fps }
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
    report,
  }
}
