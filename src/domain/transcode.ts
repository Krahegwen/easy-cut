// Conversiones auxiliares: proxy ligero de vista previa y grabaciones de MediaRecorder a MP4.

import { BT709_SETPARAMS, toneMapFilters } from './ffmpeg-args'
import type { EncoderProbeResults } from './encoders'
import { even } from './output'
import type { MediaInfo } from './project'

/** Encoders que se usan para el proxy y las grabaciones: rápidos y probados. */
export type FastEncoder = 'h264_nvenc' | 'libx264'

/** Lado corto del proxy de vista previa. */
export const PROXY_SHORT_SIDE = 540
/** fps de las grabaciones convertidas (las cámaras web dan 30 o menos). */
export const RECORDING_FPS = 30

/** NVENC si pasó la prueba; si no, libx264. */
export function chooseFastEncoder(results: EncoderProbeResults): FastEncoder {
  return results.h264_nvenc === true ? 'h264_nvenc' : 'libx264'
}

/** fps del proxy: el del original, entre 1 y 60 (la cámara lenta a 120 se queda en 60). */
export function proxyFps(media: Pick<MediaInfo, 'fps'>): number {
  const fps = Number.isFinite(media.fps) && media.fps > 0 ? media.fps : 30
  return Math.min(60, Math.max(1, Math.round(fps * 1000) / 1000))
}

/** Escalado a PROXY_SHORT_SIDE de lado corto (sin agrandar), sobre la imagen ya girada. */
export function proxyScaleFilter(media: Pick<MediaInfo, 'width' | 'height'>): string {
  const short = Math.min(media.width, media.height)
  const target = even(Math.min(PROXY_SHORT_SIDE, short))
  return media.width >= media.height ? `scale=-2:${target}` : `scale=${target}:-2`
}

function fastVideoArgs(encoder: FastEncoder, quality: 'preview' | 'keep', gop: number): string[] {
  if (encoder === 'h264_nvenc') {
    // p1 = el más rápido; opciones que admite Pascal (GTX 10xx).
    return [
      '-c:v', 'h264_nvenc',
      '-preset', quality === 'preview' ? 'p1' : 'p5',
      '-rc', 'vbr',
      '-cq', quality === 'preview' ? '30' : '21',
      '-b:v', '0',
      '-bf', '0',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-g', String(gop),
    ]
  }
  return [
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', quality === 'preview' ? '26' : '20',
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-g', String(gop),
  ]
}

/**
 * Proxy de vista previa: H.264 de 540p de lado corto, CFR y AAC, con la misma duración y los mismos
 * tiempos que el original (sin -ss ni recortes: el instante t del proxy es el t del original).
 * Un fotograma clave por segundo para que el seek sea rápido.
 */
export function buildPreviewProxyArgs(media: MediaInfo, outputPath: string, encoder: FastEncoder): string[] {
  const fps = proxyFps(media)
  const filters = [
    ...(media.isHdr ? [...toneMapFilters(media), BT709_SETPARAMS] : []),
    proxyScaleFilter(media),
    `fps=${fps}`,
    'format=yuv420p',
  ]
  return [
    '-hide_banner',
    '-y',
    '-nostdin',
    '-nostats',
    '-loglevel', 'error',
    '-progress', 'pipe:1',
    '-i', media.path,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn', '-dn',
    '-vf', filters.join(','),
    ...fastVideoArgs(encoder, 'preview', Math.max(1, Math.round(fps))),
    '-fps_mode', 'cfr',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '48000',
    '-map_metadata', '-1',
    '-movflags', '+faststart',
    outputPath,
  ]
}

/** Frecuencia del audio de las grabaciones (también las de solo la voz). */
export const RECORDING_SAMPLE_RATE = 48_000

/**
 * Grabación de solo la voz (MediaRecorder de audio) a M4A: AAC a 48 kHz, sin pista de vídeo.
 * aresample=async corrige las marcas de tiempo irregulares (y los saltos tras pausar y seguir).
 */
export function buildAudioRecordingTranscodeArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-hide_banner',
    '-y',
    '-nostdin',
    '-nostats',
    '-loglevel', 'error',
    '-progress', 'pipe:1',
    '-fflags', '+genpts',
    '-i', inputPath,
    '-map', '0:a:0',
    '-vn', '-sn', '-dn',
    '-af', 'aresample=async=1:first_pts=0',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ac', '2',
    '-ar', String(RECORDING_SAMPLE_RATE),
    '-movflags', '+faststart',
    '-f', 'ipod',
    outputPath,
  ]
}

/** ffprobe que solo pide la duración del fichero (para lo que no es vídeo, como un M4A). */
export function buildDurationProbeArgs(path: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]
}

/** Duración (ms) de la salida de buildDurationProbeArgs, o null si no se sabe. */
export function parseDurationOutput(stdout: string): number | null {
  const n = Number(stdout.trim().split(/\r?\n/)[0])
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null
}

/**
 * Grabación de MediaRecorder (WebM sin duración ni índice) a MP4 H.264 + AAC a 30 fps CFR.
 * genpts y aresample=async reparan las marcas de tiempo irregulares que deja el grabador.
 */
export function buildRecordingTranscodeArgs(inputPath: string, outputPath: string, encoder: FastEncoder): string[] {
  return [
    '-hide_banner',
    '-y',
    '-nostdin',
    '-nostats',
    '-loglevel', 'error',
    '-progress', 'pipe:1',
    '-fflags', '+genpts',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn', '-dn',
    '-vf', `fps=${RECORDING_FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
    '-af', 'aresample=async=1:first_pts=0',
    ...fastVideoArgs(encoder, 'keep', RECORDING_FPS * 2),
    '-fps_mode', 'cfr',
    '-r', String(RECORDING_FPS),
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ac', '2',
    '-ar', '48000',
    '-movflags', '+faststart',
    outputPath,
  ]
}
