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

function mediaFor(project: Project, mediaByPath: ReadonlyMap<string, MediaInfo> | Record<string, MediaInfo>): MediaInfo[] {
  const get = (p: string) => (mediaByPath instanceof Map ? mediaByPath.get(p) : (mediaByPath as Record<string, MediaInfo>)[p])
  return project.clips.map((c) => {
    const m = get(c.sourcePath)
    if (!m) throw new Error(`Falta la información del original ${c.sourcePath}`)
    return m
  })
}

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
  const shorts = media.map((m) => Math.min(m.width, m.height))
  const largest = shorts.length > 0 ? Math.max(...shorts) : 1080
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
  const media = mediaFor(project, mediaByPath)
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
