// Implementación de NativeBridge sobre Tauri 2. La lógica de ffmpeg (argumentos y lectura de la salida)
// es la del dominio; Rust solo lanza ffmpeg/ffprobe, gestiona ficheros y abre diálogos.

import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  buildEncoderProbeArgs,
  HARDWARE_ENCODERS,
  SOFTWARE_ENCODER,
  type EncoderProbeResults,
  type VideoEncoder,
} from '../domain/encoders'
import { buildProbeArgs, parseProbeOutput, ProbeError } from '../domain/probe'
import type { MediaInfo, TimeRange } from '../domain/project'
import { createProgressParser } from '../domain/progress'
import { buildSilenceDetectArgs, parseSilenceDetectOutput } from '../domain/silence'
import { recordingExtension, recordingOutputExtension } from '../domain/recording'
import {
  buildAudioRecordingTranscodeArgs,
  buildDurationProbeArgs,
  buildPreviewProxyArgs,
  buildRecordingTranscodeArgs,
  chooseFastEncoder,
  parseDurationOutput,
  type FastEncoder,
} from '../domain/transcode'
import {
  CancelledError,
  joinWindowsPath,
  type DownloadProgress,
  type FileDropHandlers,
  type NativeBridge,
  type PickVideosOptions,
  type ProcessResult,
  type ProgressCallback,
  type RunningProcess,
  type Thumbnail,
  type ThumbnailRequest,
} from './bridge'

/** Texto de error con el que Rust indica una cancelación (commands.rs). */
const CANCELLED = '__cancelled__'
/** Trozo de grabación por invoke (cuerpo binario). */
const RECORDING_CHUNK_BYTES = 8 * 1024 * 1024

type Tool = 'ffmpeg' | 'ffprobe'
type StreamName = 'stdout' | 'stderr'

interface ToolOutput {
  exitCode: number | null
  cancelled: boolean
  stdout: string
  stderr: string
}

interface LineEvent {
  stream: StreamName | 'end'
  line: string
}

let jobCounter = 0
function newJobId(kind: string): string {
  jobCounter += 1
  return `${kind}-${Date.now().toString(36)}-${jobCounter}`
}

function toError(e: unknown): Error {
  if (e instanceof Error) return e
  return new Error(typeof e === 'string' ? e : JSON.stringify(e))
}

function isCancelled(e: unknown): boolean {
  return e instanceof CancelledError || e === CANCELLED || (e instanceof Error && e.message === CANCELLED)
}

/** Última línea no vacía del stderr, para mensajes de error legibles. */
function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  return lines[lines.length - 1] ?? ''
}

/**
 * Ejecuta ffmpeg/ffprobe en Rust. Sin onLine, captura stdout y stderr enteros.
 * Espera al mensaje `end` del canal para que no se pierda ninguna línea.
 */
async function runTool(
  tool: Tool,
  args: readonly string[],
  jobId: string,
  onLine?: (stream: StreamName, line: string) => void,
): Promise<ToolOutput> {
  const channel = new Channel<LineEvent>()
  let endReceived: () => void = () => {}
  const ended = new Promise<void>((resolve) => (endReceived = resolve))
  channel.onmessage = (message) => {
    if (message.stream === 'end') endReceived()
    else onLine?.(message.stream, message.line)
  }
  const output = await invoke<ToolOutput>('run_tool', {
    tool,
    args: [...args],
    jobId,
    capture: onLine === undefined,
    onLine: channel,
  })
  // El mensaje final llega casi a la vez; el tope evita quedarse colgado si se perdiera.
  await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 2000))])
  return output
}

/** Envuelve un trabajo cancelable: cancel() mata en Rust todos los procesos del trabajo. */
function cancellable<T>(kind: string, body: (jobId: string) => Promise<T>): RunningProcess<T> {
  const jobId = newJobId(kind)
  let cancelled = false
  const result = body(jobId).then(
    (value) => {
      if (cancelled) throw new CancelledError()
      return value
    },
    (error: unknown) => {
      if (cancelled || isCancelled(error)) throw new CancelledError()
      throw toError(error)
    },
  )
  return {
    result,
    cancel() {
      if (cancelled) return
      cancelled = true
      void invoke('cancel_job', { jobId }).catch(() => {})
    },
  }
}

function throwIfCancelled(output: ToolOutput): void {
  if (output.cancelled) throw new CancelledError()
}

export function createTauriBridge(): NativeBridge {
  let encoderResults: Promise<EncoderProbeResults> | null = null

  async function probe(path: string, jobId = newJobId('probe'), still = false): Promise<MediaInfo> {
    const output = await runTool('ffprobe', buildProbeArgs(path), jobId)
    throwIfCancelled(output)
    if (output.exitCode !== 0) {
      throw new ProbeError(`No se ha podido leer el vídeo: ${lastLine(output.stderr) || 'error desconocido'}`)
    }
    return parseProbeOutput(output.stdout, path, { still })
  }

  function probeEncoders(): Promise<EncoderProbeResults> {
    encoderResults ??= (async () => {
      const results: EncoderProbeResults = {}
      const all: VideoEncoder[] = [...HARDWARE_ENCODERS, SOFTWARE_ENCODER]
      for (const encoder of all) {
        try {
          const output = await runTool('ffmpeg', buildEncoderProbeArgs(encoder), newJobId('encoders'))
          results[encoder] = output.exitCode === 0
        } catch {
          results[encoder] = false
        }
      }
      return results
    })()
    // Si falla entera (p. ej. no hay ffmpeg), que se pueda reintentar.
    encoderResults.catch(() => (encoderResults = null))
    return encoderResults
  }

  /**
   * ffmpeg con progreso; si NVENC falla (driver, GPU ocupada…), reintenta con libx264.
   * `buildArgs` recibe el encoder y devuelve los argumentos.
   */
  async function runWithFallback(
    jobId: string,
    first: FastEncoder,
    buildArgs: (encoder: FastEncoder) => string[],
    totalMs: number,
    onProgress?: ProgressCallback,
  ): Promise<ToolOutput> {
    const encoders: FastEncoder[] = first === 'libx264' ? ['libx264'] : [first, 'libx264']
    let last: ToolOutput | null = null
    for (const encoder of encoders) {
      const parser = createProgressParser(totalMs, Date.now())
      last = await runTool('ffmpeg', buildArgs(encoder), jobId, (stream, line) => {
        if (stream !== 'stdout' || !onProgress) return
        for (const update of parser.push(`${line}\n`, Date.now())) onProgress(update)
      })
      throwIfCancelled(last)
      if (last.exitCode === 0) return last
      console.warn(`[easy-cut] ffmpeg con ${encoder} ha fallado:`, lastLine(last.stderr))
    }
    return last!
  }

  const bridge: NativeBridge = {
    pickVideos(options: PickVideosOptions = {}) {
      return invoke<string[]>('pick_videos', {
        multiple: options.multiple ?? true,
        defaultFolder: options.defaultFolder ?? null,
        sounds: options.sounds ?? false,
        forTracks: options.forTracks ?? false,
      })
    },

    probe: (path, options) => probe(path, undefined, options?.still ?? false),

    exists: (path) => invoke<boolean>('path_exists', { path }),

    mediaUrl: (path) => convertFileSrc(path),

    makePreviewProxy(path, onProgress) {
      return cancellable('proxy', async (jobId) => {
        const entry = await invoke<{ path: string; tmpPath: string; exists: boolean }>('cache_entry', {
          kind: 'proxy',
          path,
        })
        if (entry.exists) return entry.path
        const media = await probe(path, jobId)
        const encoder = chooseFastEncoder(await probeEncoders())
        try {
          const output = await runWithFallback(
            jobId,
            encoder,
            (e) => buildPreviewProxyArgs(media, entry.tmpPath, e),
            media.durationMs,
            onProgress,
          )
          if (output.exitCode !== 0) {
            throw new Error(`No se ha podido preparar la vista previa: ${lastLine(output.stderr)}`)
          }
          await invoke('promote_cache_file', { tmpPath: entry.tmpPath, finalPath: entry.path })
          return entry.path
        } catch (error) {
          await invoke('discard_cache_file', { path: entry.tmpPath }).catch(() => {})
          throw error
        }
      })
    },

    runFfmpeg(args, onLine, onStderrLine) {
      return cancellable('ffmpeg', async (jobId): Promise<ProcessResult> => {
        const output = await runTool('ffmpeg', args, jobId, (stream, line) => {
          if (stream === 'stdout') onLine(line)
          else onStderrLine?.(line)
        })
        throwIfCancelled(output)
        return { exitCode: output.exitCode ?? -1, stderr: output.stderr }
      })
    },

    writeTempTextFile: (name, contents) => invoke<string>('write_temp_text_file', { name, contents }),

    detectSilences(path: string, range: TimeRange, options = {}) {
      return cancellable('silence', async (jobId) => {
        const args = buildSilenceDetectArgs(path, { range, noiseDb: options.noiseDb, minSilenceMs: options.minSilenceMs })
        const output = await runTool('ffmpeg', args, jobId)
        throwIfCancelled(output)
        if (output.exitCode !== 0) {
          // Sin pista de audio no hay pausas que quitar.
          if (/matches no streams|does not contain any stream/i.test(output.stderr)) return []
          throw new Error(`No se han podido buscar las pausas: ${lastLine(output.stderr)}`)
        }
        return parseSilenceDetectOutput(output.stderr, range.startMs, range.endMs)
      })
    },

    thumbnails(request: ThumbnailRequest) {
      return cancellable('thumbs', async (jobId) => {
        const settled = await Promise.allSettled(
          request.timesMs.map(async (timeMs): Promise<Thumbnail> => {
            const file = await invoke<{ path: string; width: number; height: number }>('make_thumbnail', {
              path: request.path,
              timeMs: Math.max(0, Math.round(timeMs)),
              height: Math.round(request.height),
              jobId,
            })
            return { timeMs, url: convertFileSrc(file.path), width: file.width, height: file.height }
          }),
        )
        const thumbs = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
        const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason as unknown] : []))
        if (failures.some(isCancelled)) throw new CancelledError()
        // Un instante suelto sin imagen (p. ej. justo al final) no tumba las demás.
        if (thumbs.length === 0 && failures.length > 0) throw toError(failures[0])
        return thumbs
      })
    },

    waveform(request) {
      return cancellable('wave', async (jobId) => {
        const file = await invoke<{ path: string; width: number; height: number }>('make_waveform', {
          path: request.path,
          width: Math.round(request.width),
          height: Math.round(request.height),
          jobId,
        })
        return { timeMs: 0, url: convertFileSrc(file.path), width: file.width, height: file.height }
      })
    },

    probeEncoders,

    getOutputFolder: () => invoke<string>('get_output_folder'),
    pickOutputFolder: () => invoke<string | null>('pick_output_folder'),
    listFileNames: (folder) => invoke<string[]>('list_file_names', { folder }),
    joinPath: (...parts) => joinWindowsPath(...parts),

    deletePartialOutput: (path) => invoke<void>('delete_partial_output', { path }),
    outputFileSize: (path) => invoke<number | null>('output_file_size', { path }),
    appendSaveLog: (line) => invoke<void>('append_save_log', { line }),

    openFile: (path) => invoke<void>('open_file', { path }),
    revealInFolder: (path) => invoke<void>('reveal_in_folder', { path }),
    copyFileToClipboard: (path) => invoke<void>('copy_file_to_clipboard', { path }),
    clipboardSequence: () => invoke<number>('clipboard_sequence'),
    clipboardFiles: () => invoke<{ sequence: number; paths: string[] }>('clipboard_files'),

    saveAutosave: (json) => invoke<void>('save_autosave', { json }),
    loadAutosave: () => invoke<string | null>('load_autosave'),
    clearAutosave: () => invoke<void>('clear_autosave'),

    saveProject: (json, path) => invoke<string | null>('save_project', { json, path: path ?? null }),
    loadProject: (path) => invoke<{ path: string; json: string } | null>('load_project', { path: path ?? null }),

    async saveRecording(data, suggestedName, onProgress) {
      const blob = data instanceof Blob ? data : new Blob([data])
      const kind = blob.type.startsWith('audio/') ? 'audio' : 'video'
      const writer = await bridge.beginRecording(suggestedName, recordingExtension(blob.type), kind)
      try {
        await writer.append(blob)
      } catch (error) {
        await writer.discard().catch(() => {})
        throw toError(error)
      }
      return writer.save(onProgress)
    },

    deleteRecording: (path) => invoke<void>('delete_partial_output', { path }),

    async beginRecording(suggestedName, extension, kind = 'video') {
      const started = await invoke<{ token: string; tempPath: string }>('recording_begin', {
        suggestedName,
        extension: extension ?? null,
        outputExtension: recordingOutputExtension(kind),
      })
      const token = started.token
      // Los trozos se escriben en orden: cada append espera al anterior.
      let queue: Promise<void> = Promise.resolve()
      let closed = false

      const writeBlob = async (blob: Blob) => {
        // Por trozos y como cuerpo binario: cientos de MB no caben en un array JSON.
        for (let offset = 0; offset < blob.size; offset += RECORDING_CHUNK_BYTES) {
          const chunk = new Uint8Array(await blob.slice(offset, offset + RECORDING_CHUNK_BYTES).arrayBuffer())
          await invoke('recording_append', chunk, { headers: { 'x-recording-token': token } })
        }
      }

      return {
        tempPath: started.tempPath,
        append(blob: Blob) {
          if (closed) return Promise.reject(new Error('La grabación ya está cerrada'))
          const next = queue.then(() => writeBlob(blob))
          // Un fallo no bloquea la cola para siempre, pero sí se devuelve a quien llamó.
          queue = next.catch(() => {})
          return next
        },
        async discard() {
          if (closed) return
          closed = true
          await queue
          // Sin recording_finish, «success» solo borra el temporal.
          await invoke('recording_cleanup', { token, success: true })
        },
        async save(onProgress, expectedDurationMs) {
          if (closed) throw new Error('La grabación ya está cerrada')
          closed = true
          let targets: { tempPath: string; outputPath: string }
          try {
            await queue
            targets = await invoke<{ tempPath: string; outputPath: string }>('recording_finish', { token })
          } catch (error) {
            await invoke('recording_cleanup', { token, success: false }).catch(() => {})
            throw toError(error)
          }

          const jobId = newJobId('recording')
          let failure: string
          if (kind === 'audio') {
            try {
              // Solo la voz: a M4A, sin encoder de vídeo que elegir.
              const parser = createProgressParser(expectedDurationMs ?? 0, Date.now())
              const output = await runTool('ffmpeg', buildAudioRecordingTranscodeArgs(targets.tempPath, targets.outputPath), jobId, (stream, line) => {
                if (stream !== 'stdout' || !onProgress) return
                for (const update of parser.push(`${line}\n`, Date.now())) onProgress(update)
              })
              throwIfCancelled(output)
              if (output.exitCode === 0) {
                const probed = await runTool('ffprobe', buildDurationProbeArgs(targets.outputPath), newJobId('probe'))
                const durationMs = parseDurationOutput(probed.stdout)
                if (durationMs === null) throw new Error('No se sabe cuánto dura la grabación')
                await invoke('recording_cleanup', { token, success: true })
                return { path: targets.outputPath, durationMs, kind }
              }
              failure = lastLine(output.stderr)
            } catch (error) {
              failure = toError(error).message
            }
            const kept = await invoke<string | null>('recording_cleanup', { token, success: false })
            throw new Error(`No se ha podido convertir la grabación (${failure}). Se ha guardado sin convertir en ${kept}`)
          }
          try {
            const encoder = chooseFastEncoder(await probeEncoders())
            // Sin duración esperada (el WebM no la lleva), el progreso da el tiempo convertido, no la fracción.
            const output = await runWithFallback(
              jobId,
              encoder,
              (e) => buildRecordingTranscodeArgs(targets.tempPath, targets.outputPath, e),
              expectedDurationMs ?? 0,
              onProgress,
            )
            if (output.exitCode === 0) {
              const info = await probe(targets.outputPath)
              await invoke('recording_cleanup', { token, success: true })
              return { path: targets.outputPath, durationMs: info.durationMs, kind }
            }
            failure = lastLine(output.stderr)
          } catch (error) {
            failure = toError(error).message
          }
          const kept = await invoke<string | null>('recording_cleanup', { token, success: false })
          throw new Error(`No se ha podido convertir la grabación (${failure}). Se ha guardado sin convertir en ${kept}`)
        },
      }
    },

    libraryStatus: (files) => invoke<(string | null)[]>('library_status', { entries: files.map((f) => ({ file: f.file, sha256: f.sha256 })) }),

    libraryFetch(ref, url, onProgress) {
      return cancellable('library', async (jobId) => {
        const channel = new Channel<DownloadProgress>()
        channel.onmessage = (p) => onProgress?.(p)
        return invoke<string>('library_fetch', { file: ref.file, sha256: ref.sha256, bytes: ref.bytes, url, jobId, onProgress: channel })
      })
    },

    libraryCatalog: (url) => invoke<string | null>('library_catalog', { url }),

    onFilesDropped(handlers: FileDropHandlers) {
      let disposed = false
      let unlisten: (() => void) | null = null
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          const payload = event.payload
          if (payload.type === 'enter') handlers.onHover?.(true)
          else if (payload.type === 'leave') handlers.onHover?.(false)
          else if (payload.type === 'drop') {
            handlers.onHover?.(false)
            handlers.onDrop(payload.paths)
          }
        })
        .then((fn) => {
          if (disposed) fn()
          else unlisten = fn
        })
      return () => {
        disposed = true
        unlisten?.()
      }
    },
  }
  return bridge
}
