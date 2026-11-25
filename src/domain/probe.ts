// ffprobe: argumentos y lectura de su JSON a MediaInfo.

import type { MediaInfo } from './project'

export function buildProbeArgs(path: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path]
}

export const HDR_TRANSFERS = ['smpte2084', 'arib-std-b67'] as const

export class ProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProbeError'
  }
}

interface RawStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  pix_fmt?: string
  color_transfer?: string
  color_primaries?: string
  color_space?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  duration?: string
  sample_rate?: string
  channels?: number
  disposition?: Record<string, number>
  tags?: Record<string, string>
  side_data_list?: Array<Record<string, unknown>>
}

interface RawProbe {
  streams?: RawStream[]
  format?: { duration?: string; size?: string }
}

/** "30000/1001" → 29.97; "0/0" o basura → null. */
export function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null
  const [n, d] = value.split('/')
  const num = Number(n)
  const den = d === undefined ? 1 : Number(d)
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null
  return Math.round((num / den) * 1000) / 1000
}

/** Giro de visualización en grados horarios (0/90/180/270). */
export function readRotation(stream: RawStream): 0 | 90 | 180 | 270 {
  let degrees: number | null = null
  for (const sd of stream.side_data_list ?? []) {
    // ffprobe da la rotación de la matriz de visualización en sentido antihorario.
    if (typeof sd.rotation === 'number') {
      degrees = -sd.rotation
      break
    }
    if (typeof sd.rotation === 'string' && sd.rotation.trim() !== '' && Number.isFinite(Number(sd.rotation))) {
      degrees = -Number(sd.rotation)
      break
    }
  }
  if (degrees === null && stream.tags?.rotate !== undefined) {
    // La etiqueta antigua «rotate» ya va en sentido horario.
    const tag = Number(stream.tags.rotate)
    if (Number.isFinite(tag)) degrees = tag
  }
  if (degrees === null) return 0
  const normalized = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360
  return normalized as 0 | 90 | 180 | 270
}

/** Convierte la salida JSON de ffprobe en MediaInfo. Acepta el texto o el objeto ya leído. */
export function parseProbeOutput(output: string | object, path: string): MediaInfo {
  let raw: RawProbe
  if (typeof output === 'string') {
    try {
      raw = JSON.parse(output) as RawProbe
    } catch {
      throw new ProbeError('No se ha podido leer la información del vídeo.')
    }
  } else {
    raw = output as RawProbe
  }
  const streams = raw.streams ?? []
  // La carátula de un MP3 o M4A es una «pista de vídeo» de una sola imagen: no cuenta como imagen.
  const found = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  const video = found && found.width && found.height ? found : undefined
  const audio = streams.find((s) => s.codec_type === 'audio')
  if (!video && !audio) {
    throw new ProbeError('Este fichero no tiene ni imagen ni sonido.')
  }

  const durationSec = Number(raw.format?.duration ?? video?.duration ?? audio?.duration)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new ProbeError(video ? 'No se sabe cuánto dura este vídeo.' : 'No se sabe cuánto dura este sonido.')
  }
  const size = Number(raw.format?.size)

  if (!video) {
    // Solo sonido: sin dimensiones (ver MediaInfo.hasVideo).
    return {
      path,
      durationMs: Math.round(durationSec * 1000),
      hasVideo: false,
      width: 0,
      height: 0,
      codedWidth: 0,
      codedHeight: 0,
      rotation: 0,
      fps: 0,
      hasAudio: true,
      isHdr: false,
      videoCodec: 'ninguno',
      pixelFormat: null,
      colorTransfer: null,
      colorPrimaries: null,
      colorSpace: null,
      audioCodec: audio!.codec_name ?? null,
      audioSampleRate: audio!.sample_rate ? Number(audio!.sample_rate) : null,
      audioChannels: audio!.channels ?? null,
      sizeBytes: Number.isFinite(size) && size > 0 ? size : null,
    }
  }

  const rotation = readRotation(video)
  const swap = rotation === 90 || rotation === 270
  const fps = parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate) ?? 30
  const transfer = video.color_transfer ?? null
  // Ya comprobado arriba: la pista de vídeo tiene ancho y alto.
  const vw = video.width!
  const vh = video.height!

  return {
    path,
    durationMs: Math.round(durationSec * 1000),
    hasVideo: true,
    width: swap ? vh : vw,
    height: swap ? vw : vh,
    codedWidth: vw,
    codedHeight: vh,
    rotation,
    fps,
    hasAudio: audio !== undefined,
    isHdr: transfer !== null && (HDR_TRANSFERS as readonly string[]).includes(transfer),
    videoCodec: video.codec_name ?? 'desconocido',
    pixelFormat: video.pix_fmt ?? null,
    colorTransfer: transfer,
    colorPrimaries: video.color_primaries ?? null,
    colorSpace: video.color_space ?? null,
    audioCodec: audio?.codec_name ?? null,
    audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    audioChannels: audio?.channels ?? null,
    sizeBytes: Number.isFinite(size) && size > 0 ? size : null,
  }
}
