// «Quitar pausas»: detección de silencios con silencedetect y cálculo de los rangos que se conservan.

import type { TimeRange } from './project'

export type PauseLevel = 'few' | 'normal' | 'many'

/** Silencio mínimo que se quita en cada nivel. */
export const PAUSE_MIN_SILENCE_MS: Record<PauseLevel, number> = {
  few: 2000,
  normal: 1000,
  many: 500,
}

export const PAUSE_LEVEL_LABELS: Record<PauseLevel, string> = {
  few: 'Solo las pausas largas',
  normal: 'Las pausas normales',
  many: 'Casi todas las pausas',
}

/** Margen que se deja a cada lado de la voz. */
export const VOICE_PADDING_MS = 150
/** Por debajo de esto un hueco no se quita: el salto se notaría más que la pausa. */
export const MIN_REMOVED_MS = 250
/** Por debajo de esto un rango conservado se fusiona con su vecino. */
export const MIN_KEPT_MS = 400

export const DEFAULT_NOISE_DB = -35

export interface SilenceDetectOptions {
  noiseDb?: number
  minSilenceMs?: number
  /** Analizar solo este rango del original (in/out del trozo). */
  range?: TimeRange
}

export function buildSilenceDetectArgs(path: string, options: SilenceDetectOptions = {}): string[] {
  const noise = options.noiseDb ?? DEFAULT_NOISE_DB
  const d = (options.minSilenceMs ?? PAUSE_MIN_SILENCE_MS.many) / 1000
  const range = options.range
    ? ['-ss', (options.range.startMs / 1000).toFixed(3), '-t', ((options.range.endMs - options.range.startMs) / 1000).toFixed(3)]
    : []
  return [
    '-hide_banner',
    '-nostats',
    ...range,
    '-i', path,
    '-map', '0:a:0',
    '-vn', '-sn', '-dn',
    '-af', `silencedetect=noise=${noise}dB:d=${d}`,
    '-f', 'null',
    '-',
  ]
}

/** volumedetect para calcular un umbral relativo al volumen del trozo. */
export function buildVolumeDetectArgs(path: string, range?: TimeRange): string[] {
  const r = range ? ['-ss', (range.startMs / 1000).toFixed(3), '-t', ((range.endMs - range.startMs) / 1000).toFixed(3)] : []
  return ['-hide_banner', '-nostats', ...r, '-i', path, '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', 'volumedetect', '-f', 'null', '-']
}

export function parseMeanVolumeDb(stderr: string): number | null {
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?|-inf)\s*dB/.exec(stderr)
  if (!m || m[1] === '-inf') return null
  return Number(m[1])
}

/** Umbral de silencio relativo: 18 dB por debajo del volumen medio, entre -50 y -25 dB. */
export function relativeNoiseDb(meanVolumeDb: number | null): number {
  if (meanVolumeDb === null || !Number.isFinite(meanVolumeDb)) return DEFAULT_NOISE_DB
  return Math.round(Math.min(-25, Math.max(-50, meanVolumeDb - 18)))
}

/**
 * Lee los silencios del stderr de silencedetect.
 * @param offsetMs se suma a cada tiempo (si se analizó con -ss, los tiempos son relativos al rango).
 * @param endMs final a usar si el último silencio no se cierra antes de acabar el audio.
 */
export function parseSilenceDetectOutput(stderr: string, offsetMs = 0, endMs?: number): TimeRange[] {
  const silences: TimeRange[] = []
  let openStart: number | null = null
  const re = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    const t = Math.max(0, Math.round(Number(m[2]) * 1000)) + offsetMs
    if (m[1] === 'start') {
      openStart = t
    } else if (openStart !== null) {
      if (t > openStart) silences.push({ startMs: openStart, endMs: t })
      openStart = null
    }
  }
  if (openStart !== null && endMs !== undefined && endMs > openStart) {
    silences.push({ startMs: openStart, endMs })
  }
  return silences
}

/**
 * Rangos que se conservan del trozo [range] tras quitar las pausas del nivel elegido.
 * Deja VOICE_PADDING_MS de margen junto a la voz, no quita huecos de menos de MIN_REMOVED_MS
 * y fusiona rangos conservados de menos de MIN_KEPT_MS con su vecino.
 * Si todo es silencio, devuelve el rango entero (no se borra el trozo).
 */
export function computeKeepSegments(silences: readonly TimeRange[], range: TimeRange, level: PauseLevel): TimeRange[] {
  const minSilence = PAUSE_MIN_SILENCE_MS[level]
  const removed: TimeRange[] = []
  const sorted = [...silences].sort((a, b) => a.startMs - b.startMs)
  for (const s of sorted) {
    const start = Math.max(s.startMs, range.startMs)
    const end = Math.min(s.endMs, range.endMs)
    if (end - start < minSilence) continue
    // Junto a los bordes del trozo no hay voz que proteger.
    const cutStart = start <= range.startMs ? range.startMs : start + VOICE_PADDING_MS
    const cutEnd = end >= range.endMs ? range.endMs : end - VOICE_PADDING_MS
    if (cutEnd - cutStart < MIN_REMOVED_MS) continue
    const prev = removed[removed.length - 1]
    if (prev && cutStart <= prev.endMs) prev.endMs = Math.max(prev.endMs, cutEnd)
    else removed.push({ startMs: cutStart, endMs: cutEnd })
  }

  // Rango menos lo quitado.
  let keep: TimeRange[] = []
  let cursor = range.startMs
  for (const r of removed) {
    if (r.startMs > cursor) keep.push({ startMs: cursor, endMs: r.startMs })
    cursor = Math.max(cursor, r.endMs)
  }
  if (cursor < range.endMs) keep.push({ startMs: cursor, endMs: range.endMs })
  if (keep.length === 0) return [{ ...range }]

  // Fusiona los rangos minúsculos con el vecino más cercano (se recupera el hueco entre ambos).
  keep = mergeTinyRanges(keep)
  return keep
}

function mergeTinyRanges(ranges: TimeRange[]): TimeRange[] {
  const out = ranges.map((r) => ({ ...r }))
  for (;;) {
    if (out.length <= 1) return out
    const i = out.findIndex((r) => r.endMs - r.startMs < MIN_KEPT_MS)
    if (i < 0) return out
    const gapBefore = i > 0 ? out[i]!.startMs - out[i - 1]!.endMs : Infinity
    const gapAfter = i < out.length - 1 ? out[i + 1]!.startMs - out[i]!.endMs : Infinity
    if (gapBefore <= gapAfter) {
      out[i - 1]!.endMs = out[i]!.endMs
      out.splice(i, 1)
    } else {
      out[i + 1]!.startMs = out[i]!.startMs
      out.splice(i, 1)
    }
  }
}

/** Milisegundos que se quitan con estos rangos conservados. */
export function removedMs(keep: readonly TimeRange[], range: TimeRange): number {
  const kept = keep.reduce((sum, r) => sum + (r.endMs - r.startMs), 0)
  return Math.max(0, range.endMs - range.startMs - kept)
}
