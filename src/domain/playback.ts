// Plan de reproducción de la vista previa: el vídeo completo como una lista de tramos
// (un tramo = un rango conservado de un trozo). La vista previa no renderiza: salta de tramo en tramo
// sobre los originales. Aquí está el mapa tiempo del vídeo ↔ trozo / rango / tiempo del original.

import { clipOutputMs, clipStartTimes, type Clip, type Project, type Speed } from './project'

export interface PlaybackSpan {
  clipIndex: number
  clipId: string
  segmentIndex: number
  sourcePath: string
  /** Rango del original que se reproduce. */
  sourceStartMs: number
  sourceEndMs: number
  speed: Speed
  /** Dónde cae en el vídeo completo (ms). */
  projectStartMs: number
  projectEndMs: number
}

export interface PlaybackPlan {
  spans: PlaybackSpan[]
  durationMs: number
}

export interface PlaybackPosition {
  spanIndex: number
  /** Instante del original que corresponde. */
  sourceMs: number
}

/** Tramos de un trozo con su posición en el vídeo, empezando en `clipStartMs`. */
function clipSpans(clip: Clip, clipIndex: number, clipStartMs: number): PlaybackSpan[] {
  const spans: PlaybackSpan[] = []
  const total = clipOutputMs(clip)
  let acc = 0
  clip.segments.forEach((seg, segmentIndex) => {
    const len = seg.endMs - seg.startMs
    const start = clipStartMs + Math.round(acc / clip.speed)
    acc += len
    const isLast = segmentIndex === clip.segments.length - 1
    const end = isLast ? clipStartMs + total : clipStartMs + Math.round(acc / clip.speed)
    spans.push({
      clipIndex,
      clipId: clip.id,
      segmentIndex,
      sourcePath: clip.sourcePath,
      sourceStartMs: seg.startMs,
      sourceEndMs: seg.endMs,
      speed: clip.speed,
      projectStartMs: start,
      projectEndMs: end,
    })
  })
  return spans
}

export function buildPlaybackPlan(project: Project): PlaybackPlan {
  const starts = clipStartTimes(project)
  const spans = project.clips.flatMap((clip, i) => clipSpans(clip, i, starts[i]!))
  const last = spans[spans.length - 1]
  return { spans, durationMs: last ? last.projectEndMs : 0 }
}

/**
 * Tiempo del vídeo completo → tramo e instante del original.
 * En la frontera exacta entre dos tramos devuelve el siguiente; al final, el final del último.
 */
export function locatePlayback(plan: PlaybackPlan, projectMs: number): PlaybackPosition | null {
  const spans = plan.spans
  if (spans.length === 0) return null
  const t = Math.min(Math.max(0, projectMs), plan.durationMs)
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!
    const isLast = i === spans.length - 1
    if (t < s.projectEndMs || isLast) {
      const within = Math.max(0, t - s.projectStartMs) * s.speed
      const sourceMs = Math.min(s.sourceEndMs, s.sourceStartMs + within)
      return { spanIndex: i, sourceMs }
    }
  }
  return null
}

/** Instante del original dentro de un tramo → tiempo del vídeo completo (sin salirse del tramo). */
export function playbackTimeAt(plan: PlaybackPlan, spanIndex: number, sourceMs: number): number {
  const s = plan.spans[spanIndex]
  if (!s) return 0
  const clamped = Math.min(Math.max(sourceMs, s.sourceStartMs), s.sourceEndMs)
  const t = s.projectStartMs + (clamped - s.sourceStartMs) / s.speed
  return Math.min(t, s.projectEndMs)
}

/** Tramo del trozo `clipIndex` que contiene ese instante del original, o -1 si no se conserva. */
export function findSpanForSource(plan: PlaybackPlan, clipIndex: number, sourceMs: number): number {
  return plan.spans.findIndex(
    (s) => s.clipIndex === clipIndex && sourceMs >= s.sourceStartMs && sourceMs < s.sourceEndMs,
  )
}

/** Primer tramo de cada trozo (para saber qué cargar antes de tiempo). */
export function firstSpanOfClip(plan: PlaybackPlan, clipIndex: number): number {
  return plan.spans.findIndex((s) => s.clipIndex === clipIndex)
}

/** Margen con el que se da por acabado un tramo (el <video> no avisa justo en el milisegundo). */
export const SPAN_END_TOLERANCE_MS = 40

/** ¿El <video> ha llegado (casi) al final del tramo y hay que saltar al siguiente? */
export function hasReachedSpanEnd(span: PlaybackSpan, sourceMs: number): boolean {
  return sourceMs >= span.sourceEndMs - SPAN_END_TOLERANCE_MS
}
