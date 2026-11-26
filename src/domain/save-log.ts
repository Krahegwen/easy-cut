// Registro de guardados: con qué se codificó cada vídeo (tarjeta gráfica o procesador), cuánto tardó y cómo
// acabó. Una entrada por guardado (también los cancelados, los fallidos y «Solo el sonido»), en JSON Lines en
// la carpeta de datos de la app (el tope de entradas lo aplica la shell al escribir). Aquí, lo puro: construir
// la entrada, la frase llana de «¡Listo!» y el texto técnico de «Copiar detalles». Sin rutas del usuario.

import { formatDurationLong } from './durations'
import { SOFTWARE_ENCODER, type EncoderProbeResults, type VideoEncoder } from './encoders'
import type { SaveTarget } from './file-name'
import { formatBytes } from './output'

export type SaveOutcome = 'ok' | 'cancelled' | 'error'

/** Una pasada de ffmpeg con un encoder. */
export interface SaveAttempt {
  /** null en «Solo el sonido» (no hay encoder de vídeo). */
  encoder: VideoEncoder | null
  /** null = no terminó (cancelado o error al lanzarlo). */
  exitCode: number | null
  /** Lo que tardó esta pasada. */
  ms: number
  /** Última línea útil del error de ffmpeg (sin rutas), si falló. */
  error: string | null
}

/** Lo que el exportador va sabiendo de un guardado. Lo que no llegó a saberse se queda en null. */
export interface ExportReport {
  target: SaveTarget
  /** Encoders que pasaron la prueba (null en «Solo el sonido» o si no se llegó a probar). */
  availableEncoders: VideoEncoder[] | null
  /** El que se eligió primero. */
  requestedEncoder: VideoEncoder | null
  attempts: SaveAttempt[]
  durationMs: number | null
  width: number | null
  height: number | null
  fps: number | null
  /** Solo el nombre del fichero de salida, nunca la carpeta. */
  fileName: string | null
}

export function emptyExportReport(target: SaveTarget): ExportReport {
  return { target, availableEncoders: null, requestedEncoder: null, attempts: [], durationMs: null, width: null, height: null, fps: null, fileName: null }
}

export interface SaveLogEntry {
  /** Versión del formato de la entrada. */
  v: 1
  /** Cuándo se pulsó guardar, hora local con su desfase («2026-11-26T18:04:05+01:00»). */
  at: string
  appVersion: string
  target: SaveTarget
  result: SaveOutcome
  requestedEncoder: VideoEncoder | null
  /** El del último intento (el que salió bien, o el que estaba cuando se canceló o falló). */
  usedEncoder: VideoEncoder | null
  /** ¿Se volvió a probar con libx264 tras fallar el primero? */
  retried: boolean
  /** Por qué falló el primero (última línea útil de ffmpeg). */
  retryReason: string | null
  availableEncoders: VideoEncoder[] | null
  durationMs: number | null
  width: number | null
  height: number | null
  fps: number | null
  /** Desde que empezó el guardado hasta que acabó (lo que esperó la persona). */
  elapsedMs: number
  /** Lo que tardó la pasada de ffmpeg que salió bien. */
  encodeMs: number | null
  /** Veces tiempo real de esa pasada (duración del vídeo / encodeMs), con un decimal. */
  speed: number | null
  bytes: number | null
  fileName: string | null
  /** En un error: el mensaje llano y, si lo hay, la última línea útil de ffmpeg. */
  error: string | null
}

const ENCODER_ORDER: readonly VideoEncoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264']

/** Los encoders que pasaron la prueba, en orden fijo. */
export function availableEncoderList(results: EncoderProbeResults): VideoEncoder[] {
  return ENCODER_ORDER.filter((e) => results[e] === true)
}

/** Nombre llano del encoder, para la frase de «¡Listo!» («con la tarjeta gráfica»). */
export const ENCODER_PLAIN_NAMES: Record<VideoEncoder, string> = {
  h264_nvenc: 'la tarjeta gráfica',
  h264_amf: 'la tarjeta gráfica',
  h264_qsv: 'los gráficos de Intel',
  libx264: 'el procesador',
}

/** Quita las rutas de Windows y deja solo el último nombre («C:\Users\Ana\x.mp4» → «x.mp4»). */
export function redactPaths(text: string): string {
  return text.replace(/(?:(?<![A-Za-z0-9])[A-Za-z]:|\\\\[^\\/\s'"]+)[\\/][^'"\n]*/g, (path) => path.split(/[\\/]/).pop() ?? '')
}

/** Líneas de ffmpeg que acompañan a cualquier fallo y no dicen por qué. */
const FFMPEG_BOILERPLATE = [
  /^Conversion failed!?$/i,
  /^Exiting normally/i,
  /Nothing was written into output file/i,
  /Terminating thread with return code/i,
  /Task finished with error code/i,
  /Error sending frames to consumers/i,
  /Could not open encoder before EOF/i,
]

const MAX_LINE = 300

/**
 * La última línea útil del error de ffmpeg: sin las de relleno, sin la dirección de memoria del contexto
 * («[h264_nvenc @ 0000…]» → «[h264_nvenc]») y sin rutas. Si hay líneas del propio encoder, la última de ellas
 * (en NVENC la de «No capable devices found», no la de «Error while opening encoder» que viene después).
 */
export function lastUsefulFfmpegLine(stderr: string): string | null {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^\[([^\]@]+?) @ [^\]]+\]/, '[$1]'))
    .filter((l) => l !== '' && !FFMPEG_BOILERPLATE.some((re) => re.test(l)))
  if (lines.length === 0) return null
  const fromEncoder = lines.filter((l) => /^\[(h264_nvenc|h264_qsv|h264_amf|libx264)\]/.test(l))
  const line = redactPaths((fromEncoder[fromEncoder.length - 1] ?? lines[lines.length - 1]!).trim())
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line
}

const pad = (n: number, size = 2) => String(Math.abs(Math.trunc(n))).padStart(size, '0')

/** Fecha y hora local con su desfase: «2026-11-26T18:04:05+01:00». */
export function localIsoString(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  )
}

export interface SaveLogInput {
  report: ExportReport
  result: SaveOutcome
  startedAt: Date
  elapsedMs: number
  appVersion: string
  bytes?: number | null
  /** Mensaje llano del error (sin detalles técnicos, que pueden llevar rutas). */
  errorMessage?: string | null
}

export function buildSaveLogEntry(input: SaveLogInput): SaveLogEntry {
  const { report, result } = input
  const attempts = report.attempts
  const last = attempts[attempts.length - 1] ?? null
  const ok = result === 'ok' ? attempts.find((a) => a.exitCode === 0) ?? last : null
  const encodeMs = ok ? Math.max(0, Math.round(ok.ms)) : null
  const speed = encodeMs && report.durationMs ? Math.round((report.durationMs / encodeMs) * 10) / 10 : null
  let error: string | null = null
  if (result === 'error') {
    const plain = input.errorMessage ? redactPaths(input.errorMessage) : 'Error'
    error = last?.error ? `${plain} · ${last.error}` : plain
  }
  return {
    v: 1,
    at: localIsoString(input.startedAt),
    appVersion: input.appVersion,
    target: report.target,
    result,
    requestedEncoder: report.requestedEncoder,
    // En «Solo el sonido» no hay intentos con encoder de vídeo.
    usedEncoder: ok?.encoder ?? last?.encoder ?? null,
    retried: attempts.length > 1,
    retryReason: attempts.length > 1 ? attempts[0]!.error : null,
    availableEncoders: report.availableEncoders,
    durationMs: report.durationMs,
    width: report.width,
    height: report.height,
    fps: report.fps,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
    encodeMs,
    speed,
    bytes: input.bytes ?? null,
    fileName: report.fileName,
    error,
  }
}

/** Una línea de JSON Lines. */
export function serializeSaveLogEntry(entry: SaveLogEntry): string {
  return JSON.stringify(entry)
}

/**
 * Frase llana para «¡Listo!»: «Guardado en 48 segundos con la tarjeta gráfica», «… con el procesador, porque
 * con la tarjeta gráfica no ha funcionado», o sin encoder en «Solo el sonido».
 */
export function describeSave(entry: SaveLogEntry): string {
  const time = `Guardado en ${formatDurationLong(entry.elapsedMs)}`
  const used = entry.usedEncoder
  if (entry.target === 'sound' || !used) return time
  const withUsed = `${time} con ${ENCODER_PLAIN_NAMES[used]}`
  const first = entry.requestedEncoder
  if (entry.retried && first && first !== used && used === SOFTWARE_ENCODER) {
    return `${withUsed}, porque con ${ENCODER_PLAIN_NAMES[first]} no ha funcionado`
  }
  return withUsed
}

const TARGET_NAMES: Record<SaveTarget, string> = {
  whatsapp: 'Para WhatsApp',
  youtube: 'Para YouTube',
  high: 'Calidad alta',
  sound: 'Solo el sonido',
}

const RESULT_NAMES: Record<SaveOutcome, string> = { ok: 'bien', cancelled: 'cancelado', error: 'error' }

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}

/** «3:32» (minutos:segundos) o «1:02:05». */
function clock(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Texto técnico de «Copiar detalles»: para leérselo o pegárselo al dueño. */
export function saveLogDetails(entry: SaveLogEntry): string {
  const lines: string[] = [`Easy Cut ${entry.appVersion} · ${entry.at}`, `Guardado: ${TARGET_NAMES[entry.target]} · resultado: ${RESULT_NAMES[entry.result]}`]
  if (entry.target !== 'sound') {
    lines.push(`Encoder: ${entry.usedEncoder ?? '—'} (pedido: ${entry.requestedEncoder ?? '—'})`)
    lines.push(`Reintento con libx264: ${entry.retried ? `sí, porque: ${entry.retryReason ?? 'sin detalle'}` : 'no'}`)
    lines.push(`Encoders disponibles: ${entry.availableEncoders ? entry.availableEncoders.join(', ') || 'ninguno' : '—'}`)
  }
  const size = entry.width && entry.height ? ` · ${entry.width}x${entry.height} a ${entry.fps ?? '?'} fps` : ''
  if (entry.durationMs !== null) lines.push(`Duración: ${clock(entry.durationMs)}${size}`)
  const speed = entry.speed !== null ? ` (${String(entry.speed).replace('.', ',')}x tiempo real)` : ''
  const encode = entry.encodeMs !== null && entry.encodeMs !== entry.elapsedMs ? ` · ffmpeg ${seconds(entry.encodeMs)}` : ''
  lines.push(`Tiempo: ${seconds(entry.elapsedMs)}${encode}${speed}`)
  if (entry.bytes !== null) lines.push(`Peso: ${formatBytes(entry.bytes)} (${entry.bytes} bytes)`)
  if (entry.fileName) lines.push(`Fichero: ${entry.fileName}`)
  if (entry.error) lines.push(`Error: ${entry.error}`)
  return lines.join('\n')
}
