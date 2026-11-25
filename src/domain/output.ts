// Presets de exportación y cálculo del tamaño, fps, bitrate y peso del fichero de salida.

import { projectDurationMs } from './durations'
import type { AspectRatio, MediaInfo, Project } from './project'

export type PresetId = 'whatsapp' | 'youtube' | 'high'
export const PRESET_IDS: readonly PresetId[] = ['whatsapp', 'youtube', 'high']

export interface ExportPreset {
  id: PresetId
  /** Texto de interfaz. */
  label: string
  description: string
  maxFps: 30 | 60
  audioBitrateKbps: number
  /** CRF de libx264 (menor = más calidad). */
  x264Crf: number
  x264Preset: 'medium' | 'slow'
  /** CQ de NVENC / global_quality de QSV / QP de AMF. */
  hwQuality: number
}

export const PRESETS: Record<PresetId, ExportPreset> = {
  whatsapp: {
    id: 'whatsapp',
    label: 'Para WhatsApp',
    description: 'Pesa poco y se envía rápido.',
    maxFps: 30,
    audioBitrateKbps: 128,
    x264Crf: 24,
    x264Preset: 'medium',
    hwQuality: 26,
  },
  youtube: {
    id: 'youtube',
    label: 'Para YouTube',
    description: 'La calidad que recomienda YouTube.',
    maxFps: 60,
    audioBitrateKbps: 384,
    x264Crf: 20,
    x264Preset: 'medium',
    hwQuality: 21,
  },
  high: {
    id: 'high',
    label: 'Calidad alta',
    description: 'Para guardar: la mejor calidad, pesa más.',
    maxFps: 60,
    audioBitrateKbps: 320,
    x264Crf: 18,
    x264Preset: 'slow',
    hwQuality: 19,
  },
}

export interface OutputSpec {
  preset: PresetId
  width: number
  height: number
  fps: 30 | 60
  /** Bitrate de vídeo objetivo (kbps). */
  videoBitrateKbps: number
  /** Tope de bitrate de vídeo (kbps). */
  maxBitrateKbps: number
  bufferKbps: number
  audioBitrateKbps: number
}

const ASPECT_FACTORS: Record<AspectRatio, { w: number; h: number }> = {
  '16:9': { w: 16, h: 9 },
  '9:16': { w: 9, h: 16 },
  '1:1': { w: 1, h: 1 },
}

export function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}

/**
 * La imagen que se ve de cada trozo: su vídeo o el vídeo de encima. Los que «solo se oyen» no cuentan
 * para decidir el tamaño ni los fps de salida.
 */
export function visibleMedia(project: Project, mediaByPath: ReadonlyMap<string, MediaInfo> | Record<string, MediaInfo>): MediaInfo[] {
  const get = (p: string) => {
    const m = mediaByPath instanceof Map ? mediaByPath.get(p) : (mediaByPath as Record<string, MediaInfo>)[p]
    if (!m) throw new Error(`Falta la información del original ${p}`)
    return m
  }
  return project.clips.flatMap((c) => {
    if (c.picture.kind === 'cover') return [get(c.picture.sourcePath)]
    if (c.picture.kind === 'none') return []
    const m = get(c.sourcePath)
    return m.hasVideo ? [m] : []
  })
}

/** Tamaño de salida cuando ningún trozo tiene imagen: lado corto de 720 (1280×720 en horizontal), a 30 fps. */
export const NO_PICTURE_SHORT_SIDE = 720

/** Bitrate de «Solo el sonido» (M4A AAC). */
export const SOUND_BITRATE_KBPS = 192

/** Bitrate de vídeo recomendado por YouTube (kbps) según el lado corto y los fps. */
export function youtubeRecommendedKbps(shortSide: number, fps: number): number {
  const high = fps > 30
  if (shortSide >= 2160) return high ? 60_000 : 40_000
  if (shortSide >= 1440) return high ? 24_000 : 16_000
  if (shortSide >= 1080) return high ? 12_000 : 8_000
  if (shortSide >= 720) return high ? 7_500 : 5_000
  if (shortSide >= 480) return high ? 4_000 : 2_500
  return high ? 1_500 : 1_000
}

/** Lado corto de salida según el preset. Nunca más que el original más grande. */
export function outputShortSide(preset: PresetId, media: readonly MediaInfo[]): number {
  const shorts = media.filter((m) => m.width > 0 && m.height > 0).map((m) => Math.min(m.width, m.height))
  if (shorts.length === 0) return NO_PICTURE_SHORT_SIDE
  const largest = Math.max(...shorts)
  switch (preset) {
    case 'whatsapp':
      return Math.min(720, largest)
    case 'youtube':
      return shorts.length > 0 && shorts.every((s) => s >= 2160) ? 2160 : Math.min(1080, largest)
    case 'high':
      return Math.min(2160, largest)
  }
}

/** 60 si la mayoría de los trozos son de ≥50 fps; si no, 30. Con tope del preset. */
export function outputFps(preset: PresetId, media: readonly MediaInfo[]): 30 | 60 {
  const fast = media.filter((m) => m.fps >= 50).length
  const fps = media.length > 0 && fast * 2 > media.length ? 60 : 30
  return Math.min(fps, PRESETS[preset].maxFps) as 30 | 60
}

export function computeOutputSpec(
  project: Project,
  mediaByPath: ReadonlyMap<string, MediaInfo> | Record<string, MediaInfo>,
  presetId: PresetId,
): OutputSpec {
  const preset = PRESETS[presetId]
  const media = visibleMedia(project, mediaByPath)
  const shortSide = even(outputShortSide(presetId, media))
  const f = ASPECT_FACTORS[project.aspect]
  const shortFactor = Math.min(f.w, f.h)
  const width = even((shortSide * f.w) / shortFactor)
  const height = even((shortSide * f.h) / shortFactor)
  const fps = outputFps(presetId, media)

  let videoBitrateKbps: number
  let maxBitrateKbps: number
  if (presetId === 'whatsapp') {
    videoBitrateKbps = 2_500
    maxBitrateKbps = 2_500
  } else if (presetId === 'youtube') {
    videoBitrateKbps = youtubeRecommendedKbps(shortSide, fps)
    maxBitrateKbps = Math.round(videoBitrateKbps * 1.5)
  } else {
    videoBitrateKbps = Math.round(youtubeRecommendedKbps(shortSide, fps) * 1.5)
    maxBitrateKbps = Math.round(videoBitrateKbps * 1.6)
  }
  return {
    preset: presetId,
    width,
    height,
    fps,
    videoBitrateKbps,
    maxBitrateKbps,
    bufferKbps: maxBitrateKbps * 2,
    audioBitrateKbps: preset.audioBitrateKbps,
  }
}

/** Estimación del peso del fichero (bytes): bitrate objetivo × duración, más un 1 % de contenedor. */
export function estimateFileSizeBytes(spec: OutputSpec, durationMs: number): number {
  const kbps = spec.videoBitrateKbps + spec.audioBitrateKbps
  return Math.round(((kbps * 1000) / 8) * (durationMs / 1000) * 1.01)
}

export function estimateProjectSizeBytes(
  project: Project,
  mediaByPath: ReadonlyMap<string, MediaInfo> | Record<string, MediaInfo>,
  presetId: PresetId,
): number {
  return estimateFileSizeBytes(computeOutputSpec(project, mediaByPath, presetId), projectDurationMs(project))
}

/** Peso de «Solo el sonido» (bytes). */
export function estimateSoundSizeBytes(durationMs: number): number {
  return Math.round(((SOUND_BITRATE_KBPS * 1000) / 8) * (durationMs / 1000) * 1.01)
}

/** Lo que tarda «Solo el sonido»: sin imagen que hacer, unas 60 veces más rápido que lo que dura. */
export function estimateSoundTimeMs(durationMs: number): number {
  return Math.round(1_500 + durationMs / 60)
}

export type SizeCategory = 'small' | 'medium' | 'large'

export interface SizeDescription {
  category: SizeCategory
  /** «pequeño», «mediano», «grande». */
  label: string
  /** «unos 12 MB», «1,3 GB». */
  amount: string
  /** «Pequeño (unos 12 MB)». */
  text: string
}

const MB = 1_000_000

export function formatBytes(bytes: number): string {
  if (bytes >= 1000 * MB) {
    return `${(bytes / (1000 * MB)).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GB`
  }
  const mb = bytes / MB
  if (mb < 1) return 'menos de 1 MB'
  return `${Math.round(mb).toLocaleString('es-ES')} MB`
}

/** Pequeño < 25 MB (cabe en WhatsApp sin problemas), mediano < 250 MB, grande el resto. */
export function describeFileSize(bytes: number): SizeDescription {
  const category: SizeCategory = bytes < 25 * MB ? 'small' : bytes < 250 * MB ? 'medium' : 'large'
  const label = category === 'small' ? 'pequeño' : category === 'medium' ? 'mediano' : 'grande'
  const formatted = formatBytes(bytes)
  const amount = formatted.startsWith('menos') ? formatted : `unos ${formatted}`
  return { category, label, amount, text: `${label.charAt(0).toUpperCase()}${label.slice(1)} (${amount})` }
}

/**
 * Estimación aproximada de lo que tarda en guardarse (ms), según los píxeles por segundo de la salida
 * y el encoder. Las cifras son de un PC de sobremesa normal: es una orientación, no una promesa.
 * `measuredFactor` (de normalizedExportFactor, medido en un guardado anterior con el mismo tipo de
 * encoder) sustituye al de serie si se conoce.
 */
export function estimateExportTimeMs(
  spec: Pick<OutputSpec, 'width' | 'height' | 'fps' | 'preset'>,
  durationMs: number,
  hardware: boolean,
  measuredFactor?: number | null,
): number {
  const pixelScale = (spec.width * spec.height * spec.fps) / (1920 * 1080 * 30)
  const perPixel = hardware ? 0.18 : spec.preset === 'high' ? 1.2 : 0.6
  const factor = measuredFactor && measuredFactor > 0 ? measuredFactor * pixelScale : 0.05 + perPixel * pixelScale
  return Math.round(2_000 + durationMs * factor)
}

/** Factor medido (tiempo de proceso ÷ duración) normalizado a 1080p30, para reutilizarlo en otra salida. */
export function normalizedExportFactor(spec: Pick<OutputSpec, 'width' | 'height' | 'fps'>, durationMs: number, elapsedMs: number): number {
  const pixelScale = (spec.width * spec.height * spec.fps) / (1920 * 1080 * 30)
  if (durationMs <= 0 || pixelScale <= 0) return 0
  return elapsedMs / durationMs / pixelScale
}

/** «tardará menos de un minuto», «tardará unos 3 minutos». */
export function describeExportTime(ms: number): string {
  if (ms < 60_000) return 'tardará menos de un minuto'
  if (ms < 90_000) return 'tardará alrededor de un minuto'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `tardará unos ${minutes} minutos`
  const hours = Math.round(ms / 3_600_000)
  return hours <= 1 ? 'tardará alrededor de una hora' : `tardará unas ${hours} horas`
}
