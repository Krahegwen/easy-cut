// Plan de reproducción de la vista previa: el vídeo completo como una lista de tramos
// (un tramo = un rango conservado de un trozo). La vista previa no renderiza: salta de tramo en tramo
// sobre los originales. Aquí está el mapa tiempo del vídeo ↔ trozo / rango / tiempo del original.

import { clipOutputMs, clipStartTimes, type Clip, type CoverPicture, type Project, type Speed } from './project'

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

// ---------------------------------------------------------------------------
// Imagen de la vista previa: qué se enseña y en qué instante va el vídeo de encima

/** Se corrige la posición del vídeo de encima si se separa más que esto de la que le toca. */
export const COVER_DRIFT_TOLERANCE_MS = 150

/** Instante del vídeo completo → ms de salida del trozo `clipIndex` (0 = su principio). */
export function clipOutputAt(project: Project, clipIndex: number, projectMs: number): number {
  const start = clipStartTimes(project)[clipIndex] ?? 0
  const clip = project.clips[clipIndex]
  const total = clip ? clipOutputMs(clip) : 0
  return Math.min(Math.max(0, projectMs - start), total)
}

/**
 * Instante del vídeo de encima a los `clipOutMs` ms de salida del trozo: avanza a velocidad normal desde
 * startMs (sin la velocidad ni las pausas quitadas del trozo) y se queda en su final si se acaba.
 */
export function coverTimeAt(cover: CoverPicture, clipOutMs: number): number {
  return Math.min(cover.sourceDurationMs, cover.startMs + Math.max(0, clipOutMs))
}

/** ¿El vídeo de encima ya está quieto en su última imagen en ese instante? */
export function coverIsFrozen(cover: CoverPicture, clipOutMs: number): boolean {
  return cover.startMs + Math.max(0, clipOutMs) >= cover.sourceDurationMs
}

/** ¿Hay que recolocar el vídeo de encima? (se ha separado más de COVER_DRIFT_TOLERANCE_MS). */
export function coverNeedsResync(actualMs: number, expectedMs: number): boolean {
  return Math.abs(actualMs - expectedMs) > COVER_DRIFT_TOLERANCE_MS
}

export type PreviewPicture =
  | { kind: 'own' }
  | { kind: 'none' }
  | { kind: 'cover'; path: string; timeMs: number; frozen: boolean; inset: CoverPicture['inset'] }

/**
 * Qué enseña la vista previa del trozo a los `clipOutMs` ms de su salida. Si el vídeo de encima no está
 * (p. ej. se ha borrado del disco), se enseña lo de serie: su vídeo o el fondo liso.
 */
export function previewPicture(clip: Clip, clipOutMs: number, coverAvailable = true): PreviewPicture {
  const p = clip.picture
  if (p.kind === 'cover' && coverAvailable) {
    return { kind: 'cover', path: p.sourcePath, timeMs: coverTimeAt(p, clipOutMs), frozen: coverIsFrozen(p, clipOutMs), inset: p.inset }
  }
  if (p.kind === 'none' || !clip.sourceHasVideo) return { kind: 'none' }
  return { kind: 'own' }
}

/** Margen con el que se da por acabado un tramo (el <video> no avisa justo en el milisegundo). */
export const SPAN_END_TOLERANCE_MS = 40

/** Lo que dura un fotograma de pantalla (60 Hz), en ms: lo que avanza el reloj entre dos comprobaciones. */
const SCREEN_FRAME_MS = 17

/**
 * Margen para dar por acabado un tramo que suena a `mediaRate` (velocidad del trozo × la de repaso): como
 * mínimo SPAN_END_TOLERANCE_MS y, si va muy rápido, lo que avanza el original en un fotograma de pantalla
 * (si no, en la comprobación siguiente ya se habría pasado y se verían trozos de lo quitado).
 */
export function spanEndToleranceMs(rate = 1): number {
  return Math.max(SPAN_END_TOLERANCE_MS, Math.round(SCREEN_FRAME_MS * Math.max(0, rate)))
}

/** ¿El <video> ha llegado (casi) al final del tramo y hay que saltar al siguiente? (`rate`: su playbackRate) */
export function hasReachedSpanEnd(span: PlaybackSpan, sourceMs: number, rate = 1): boolean {
  return sourceMs >= span.sourceEndMs - spanEndToleranceMs(rate)
}

// ---------------------------------------------------------------------------
// «Repasar más rápido»: solo cambia cómo se ve ahora la vista previa, nunca el vídeo que se guarda.
//
// El reloj del montaje avanza `review` veces más deprisa que el de la pared. Cada <video>/<audio> suena a su
// velocidad propia dentro del montaje por el factor de repaso: un trozo a 2× repasado a 1,5× va a 3×; lo de
// encima y los sonidos y efectos de las pistas (que van a velocidad normal en el montaje) van a `review`. Los
// márgenes de recolocación (150 ms) siguen midiendo en tiempo del montaje: ni el original de un sonido ni el
// vídeo de encima se estiran, así que su tiempo y el del montaje avanzan igual.

export type ReviewRate = 1 | 1.5 | 2
export const REVIEW_RATES: readonly ReviewRate[] = [1, 1.5, 2]

/** Lo que admite `playbackRate` en Chromium (fuera de esto lanza una excepción). */
export const MIN_MEDIA_RATE = 0.0625
export const MAX_MEDIA_RATE = 16

/** ¿Es un factor de repaso válido? (lo que no lo sea se trata como 1×). */
export function isReviewRate(value: unknown): value is ReviewRate {
  return REVIEW_RATES.includes(value as ReviewRate)
}

/** El factor de repaso, o 1 si no es uno de los que se ofrecen. */
export function normalizeReviewRate(value: unknown): ReviewRate {
  return isReviewRate(value) ? value : 1
}

/** `playbackRate` de un elemento que en el montaje va a `speed` (1 = normal) repasando a `review`. */
export function mediaRate(speed: number, review: number = 1): number {
  const r = speed * normalizeReviewRate(review)
  if (!Number.isFinite(r) || r <= 0) return 1
  return Math.min(MAX_MEDIA_RATE, Math.max(MIN_MEDIA_RATE, r))
}

/** Cuánto avanza el reloj del montaje en `wallMs` ms de reloj de pared repasando a `review`. */
export function reviewAdvanceMs(wallMs: number, review: number = 1): number {
  return Math.max(0, wallMs) * normalizeReviewRate(review)
}

/** Cuánto se tarda de verdad (ms de pared) en ver `projectMs` ms del montaje repasando a `review`. */
export function reviewWallMs(projectMs: number, review: number = 1): number {
  return Math.max(0, projectMs) / normalizeReviewRate(review)
}

/** Cómo se escribe el factor en la interfaz: «1×», «1,5×», «2×». */
export function formatReviewRate(review: number): string {
  return `${String(normalizeReviewRate(review)).replace('.', ',')}×`
}

/** El aviso que se ve mientras se repasa más rápido (null a velocidad normal). */
export function reviewNotice(review: number): string | null {
  const r = normalizeReviewRate(review)
  return r === 1 ? null : `Repasando a ${formatReviewRate(r)} · el vídeo guardado no cambia`
}
