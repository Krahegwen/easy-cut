// «Solo recortar»: un vídeo, dónde empieza y dónde termina, y guardarlo. Dos formas de guardar:
// «Rápido» copia el vídeo tal cual (sin recodificar: tarda segundos y no pierde calidad), pero solo puede empezar
// en un fotograma clave, así que el principio se adelanta hasta el anterior; «Exacto» recodifica con el camino
// normal de guardado (calidad alta) y corta justo donde se marcó. Aquí, lo puro: el fotograma clave a partir
// de la salida de ffprobe, qué se ofrece y por qué, los textos, los argumentos de ffmpeg para la copia, el
// nombre del fichero y el proyecto de un solo trozo (para «Exacto» y para «Convertir en un vídeo normal»).

import { formatClock } from './durations'
import { displayName } from './file-name'
import { dominantAspect } from './layout'
import { addClip, createClip, createProject, MIN_PIECE_MS, setInOut, type MediaInfo, type Project } from './project'

export type TrimMode = 'copy' | 'exact'

/** Lo marcado: del original, en ms enteros. */
export interface TrimRange {
  inMs: number
  outMs: number
}

/** Cuánto antes y después del punto pedido se buscan fotogramas clave (ms). */
const KEYFRAME_LOOKBACK_MS = 30_000
const KEYFRAME_LOOKAHEAD_MS = 500

/**
 * Argumentos de ffprobe para los fotogramas clave del vídeo cerca de `aroundMs`: solo lee paquetes (no
 * decodifica nada), de la primera pista de vídeo y en una ventana de unos 30 s antes del punto. ffprobe busca
 * el principio de la ventana en el fotograma clave anterior, así que siempre sale al menos uno antes del punto.
 * Con `fromStart`, desde el principio del fichero (por si la ventana no hubiera dado ninguno).
 */
export function buildKeyframeProbeArgs(path: string, aroundMs: number, fromStart = false): string[] {
  const at = Math.max(0, Math.round(aroundMs))
  const from = fromStart ? 0 : Math.max(0, at - KEYFRAME_LOOKBACK_MS)
  const to = at + KEYFRAME_LOOKAHEAD_MS
  const interval = `${(from / 1000).toFixed(3)}%${(to / 1000).toFixed(3)}`
  return [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-read_intervals', interval,
    '-show_entries', 'packet=pts_time,flags',
    '-of', 'csv=p=0',
    path,
  ]
}

/**
 * Instantes (ms, ordenados y sin repetir) de los paquetes clave («K» en las banderas) de la salida de ffprobe
 * (`pts_time,flags` por línea). Se redondean **hacia arriba** al ms (tras quitar el ruido de los microsegundos):
 * así un `-ss` con ese valor nunca cae antes del fotograma clave, que haría buscar el anterior.
 */
export function parseKeyframes(stdout: string): number[] {
  const out = new Set<number>()
  for (const line of stdout.split(/\r?\n/)) {
    const [pts, flags] = line.trim().split(',')
    if (!pts || !flags || !flags.includes('K')) continue
    const seconds = Number(pts)
    if (!Number.isFinite(seconds) || seconds < 0) continue
    out.add(Math.ceil(Math.round(seconds * 1_000_000) / 1000))
  }
  return [...out].sort((a, b) => a - b)
}

/** El último fotograma clave en `atMs` o antes (null si no hay ninguno). */
export function keyframeAtOrBefore(keyframes: readonly number[], atMs: number): number | null {
  let best: number | null = null
  for (const k of keyframes) {
    if (k <= atMs) best = k
    else break
  }
  return best
}

/** Códecs que se pueden copiar tal cual a un MP4 que se vea en WhatsApp y en el reproductor de Windows. */
export const COPY_VIDEO_CODECS: readonly string[] = ['h264', 'hevc']
export const COPY_AUDIO_CODECS: readonly string[] = ['aac', 'mp3']

const CODEC_NAMES: Record<string, string> = {
  prores: 'ProRes',
  dnxhd: 'DNxHD',
  mjpeg: 'Motion JPEG',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  wmv3: 'Windows Media',
  vc1: 'VC-1',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
  pcm_s16be: 'PCM',
  opus: 'Opus',
  vorbis: 'Vorbis',
  ac3: 'Dolby Digital',
  eac3: 'Dolby Digital Plus',
  flac: 'FLAC',
  wmav2: 'Windows Media Audio',
}

function codecName(codec: string): string {
  return CODEC_NAMES[codec] ?? codec.toUpperCase()
}

/**
 * ¿Por qué no se puede guardar «Rápido» este vídeo? null = sí se puede (vídeo H.264 o HEVC, y sonido AAC o
 * MP3 o ninguno). La frase es para la persona.
 */
export function copyProblem(info: Pick<MediaInfo, 'hasVideo' | 'videoCodec' | 'hasAudio' | 'audioCodec'>): string | null {
  if (!info.hasVideo) return 'Este fichero no tiene imagen.'
  if (!COPY_VIDEO_CODECS.includes(info.videoCodec)) {
    return `Este vídeo está en un formato (${codecName(info.videoCodec)}) que no se puede copiar tal cual a MP4. Con «Exacto» sí se guarda bien.`
  }
  if (info.hasAudio && (!info.audioCodec || !COPY_AUDIO_CODECS.includes(info.audioCodec))) {
    return `El sonido de este vídeo está en un formato (${codecName(info.audioCodec ?? 'desconocido')}) que no se puede copiar tal cual a MP4. Con «Exacto» sí se guarda bien.`
  }
  return null
}

/** Lo que hará «Rápido» con lo marcado. */
export interface CopyPlan {
  /** Desde dónde se copia (el fotograma clave; 0 = desde el principio). */
  startMs: number
  endMs: number
  /** Cuánto antes de lo marcado empezará (0 si es exacto). */
  earlyMs: number
  /** ¿Empieza justo donde se marcó? (en 0, o en un fotograma clave). */
  exact: boolean
}

/** Medio fotograma (ms): menos que eso de diferencia no se nota (sin fps conocidos, 20 ms). */
function halfFrameMs(fps: number): number {
  return fps > 0 ? Math.round(500 / fps) : 20
}

/**
 * Qué copia «Rápido»: desde el fotograma clave en lo marcado o antes hasta lo marcado. Si el corte empieza en
 * 0 (o antes del primer fotograma clave) se copia desde el principio; si cae en un fotograma clave (a menos de
 * medio fotograma), es exacto.
 */
export function planCopy(range: TrimRange, keyframeMs: number | null, fps: number): CopyPlan {
  const inMs = Math.max(0, Math.round(range.inMs))
  const endMs = Math.max(inMs, Math.round(range.outMs))
  const startMs = keyframeMs === null || inMs === 0 ? 0 : Math.min(keyframeMs, inMs)
  const gap = inMs - startMs
  const exact = gap <= halfFrameMs(fps)
  return { startMs, endMs, earlyMs: exact ? 0 : gap, exact }
}

/** «0,8 s» (con un decimal; nunca «0,0 s»). */
export function formatSeconds(ms: number): string {
  const s = Math.max(0.1, Math.round(ms / 100) / 10)
  return `${s.toFixed(1).replace('.', ',')} s`
}

/** Frase de «Rápido» para la persona: «Empezará 0,8 s antes, en 0:04» o que corta justo donde se marcó. */
export function describeCopyPlan(plan: CopyPlan): string {
  if (plan.exact) return 'Aquí corta justo donde has marcado.'
  return `Empezará ${formatSeconds(plan.earlyMs)} antes, en ${formatClock(plan.startMs)}: sin recodificar, un vídeo solo se puede cortar en ciertos puntos.`
}

/** Duración del vídeo guardado (ms). */
export function trimOutputMs(range: TrimRange, mode: TrimMode, plan: CopyPlan | null): number {
  const start = mode === 'copy' && plan ? plan.startMs : range.inMs
  return Math.max(0, Math.round(range.outMs - start))
}

/** Reloj con décimas, para lo marcado: «0:05,3», «1:02:03,0». */
export function formatClockTenths(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100))
  return `${formatClock(Math.floor(tenths / 10) * 1000)},${tenths % 10}`
}

/** «Del 0:05 al 0:12». */
export function describeTrimRange(range: TrimRange): string {
  return `Del ${formatClock(range.inMs)} al ${formatClock(range.outMs)}`
}

/** Todo el vídeo, para empezar. */
export function fullRange(durationMs: number): TrimRange {
  return { inMs: 0, outMs: Math.max(0, Math.round(durationMs)) }
}

/**
 * «Empieza aquí» (E): el principio pasa a `atMs`. Si quedaría a menos de MIN_PIECE_MS del final, el final se
 * va al final del vídeo (si así cabe); si ni así, no cambia.
 */
export function setTrimIn(range: TrimRange, atMs: number, durationMs: number): TrimRange {
  const inMs = Math.round(Math.min(Math.max(0, atMs), durationMs))
  if (range.outMs - inMs >= MIN_PIECE_MS) return inMs === range.inMs ? range : { inMs, outMs: range.outMs }
  if (durationMs - inMs >= MIN_PIECE_MS) return { inMs, outMs: Math.round(durationMs) }
  return range
}

/**
 * «Termina aquí» (T): el final pasa a `atMs`. Si quedaría a menos de MIN_PIECE_MS del principio, el principio
 * vuelve al 0 (si así cabe); si ni así, no cambia.
 */
export function setTrimOut(range: TrimRange, atMs: number, durationMs: number): TrimRange {
  const outMs = Math.round(Math.min(Math.max(0, atMs), durationMs))
  if (outMs - range.inMs >= MIN_PIECE_MS) return outMs === range.outMs ? range : { inMs: range.inMs, outMs }
  if (outMs >= MIN_PIECE_MS) return { inMs: 0, outMs }
  return range
}

/** ¿Lo marcado es el vídeo entero? */
export function isFullRange(range: TrimRange, durationMs: number): boolean {
  return range.inMs <= 0 && range.outMs >= Math.round(durationMs)
}

/**
 * Nombre del fichero recortado, sin chocar con ninguno de los que ya hay (sin mayúsculas, como Windows):
 * «toma 1 (recortado).mp4», «toma 1 (recortado) 2.mp4»…
 */
export function buildTrimFileName(sourcePath: string, existingNames: readonly string[] = []): string {
  const base = `${displayName(sourcePath).trim() || 'Vídeo'} (recortado)`
  const taken = new Set(existingNames.map((n) => n.normalize('NFC').toLocaleLowerCase('es')))
  const isFree = (name: string) => !taken.has(name.normalize('NFC').toLocaleLowerCase('es'))
  let candidate = `${base}.mp4`
  for (let n = 2; !isFree(candidate); n++) candidate = `${base} ${n}.mp4`
  return candidate
}

function seconds3(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3)
}

export interface TrimCopyRequest {
  sourcePath: string
  outputPath: string
  plan: CopyPlan
  info: Pick<MediaInfo, 'videoCodec' | 'hasAudio'>
}

/**
 * ffmpeg para «Rápido»: `-ss` de entrada en el fotograma clave (así el primer paquete de vídeo es ese
 * fotograma y el sonido empieza a la vez), `-t` con lo que dura, copia de la primera pista de vídeo y la
 * primera de sonido (ninguna otra: ni subtítulos ni pistas de datos, donde algunos móviles y cámaras guardan la
 * ubicación), sin metadatos globales ni capítulos (la ubicación `©xyz` / `com.apple.quicktime.location…`) y con
 * `+faststart`. La rotación del móvil (display matrix) va con la pista y se conserva.
 *
 * Sin `-avoid_negative_ts make_zero`: con B-frames, quitaba la edit list y el vídeo empezaba 75 ms después
 * que el sonido (medido); sin él, los dos empiezan en 0 como en el original.
 */
export function buildTrimCopyArgs(req: TrimCopyRequest): string[] {
  const { plan } = req
  const seek = plan.startMs > 0 ? ['-ss', seconds3(plan.startMs)] : []
  return [
    '-hide_banner',
    '-y',
    '-nostats',
    '-loglevel', 'error',
    '-progress', 'pipe:1',
    ...seek,
    '-i', req.sourcePath,
    '-t', seconds3(plan.endMs - plan.startMs),
    '-map', '0:v:0',
    ...(req.info.hasAudio ? ['-map', '0:a:0'] : []),
    '-c', 'copy',
    // HEVC con la etiqueta que entienden los reproductores de Apple (y WhatsApp en el iPhone).
    ...(req.info.videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-movflags', '+faststart',
    req.outputPath,
  ]
}

/**
 * Proyecto de un solo trozo con lo marcado (la forma, la del vídeo). Es el de «Exacto» (se guarda por el camino
 * normal, calidad alta) y el de «Convertir en un vídeo normal».
 */
export function trimProject(info: MediaInfo, range: TrimRange, clipId?: string): Project {
  const clip = createClip(info, clipId)
  let p = addClip(createProject(dominantAspect([info])), clip)
  if (!isFullRange(range, info.durationMs)) p = setInOut(p, clip.id, { inMs: range.inMs, outMs: range.outMs })
  return p
}
