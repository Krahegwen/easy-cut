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
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  if (!video || !video.width || !video.height) {
    throw new ProbeError('Este fichero no tiene imagen de vídeo.')
  }
  const audio = streams.find((s) => s.codec_type === 'audio')

  const durationSec = Number(raw.format?.duration ?? video.duration ?? audio?.duration)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new ProbeError('No se sabe cuánto dura este vídeo.')
  }

  const rotation = readRotation(video)
  const swap = rotation === 90 || rotation === 270
  const fps = parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate) ?? 30
  const transfer = video.color_transfer ?? null
  const size = Number(raw.format?.size)

  return {
    path,
    durationMs: Math.round(durationSec * 1000),
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
    codedWidth: video.width,
    codedHeight: video.height,
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
