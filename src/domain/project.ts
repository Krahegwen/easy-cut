// Modelo del proyecto y operaciones inmutables sobre él.
// Todos los tiempos son milisegundos enteros. Nada de DOM ni de Node aquí.

import { isEasing, isMotionEasing, type Easing, type MotionEasing } from './motion'

export interface TimeRange {
  startMs: number
  endMs: number
}

export type AspectRatio = '16:9' | '9:16' | '1:1'
export const ASPECT_RATIOS: readonly AspectRatio[] = ['16:9', '9:16', '1:1']

export type Speed = 0.5 | 1 | 2 | 4
export const SPEEDS: readonly Speed[] = [0.5, 1, 2, 4]

export type QuarterTurns = 0 | 1 | 2 | 3

export type FramingMode = 'fit-blur' | 'fill'

/**
 * Encuadre de un trozo dentro de la forma de salida.
 * zoom ≥ 1 (1 = sin zoom). offsetX/offsetY en [-1, 1]: -1 pega el borde
 * izquierdo/superior, 0 centra, 1 pega el borde derecho/inferior.
 */
export interface Framing {
  mode: FramingMode
  zoom: number
  offsetX: number
  offsetY: number
}

export interface MediaInfo {
  path: string
  durationMs: number
  /**
   * ¿Tiene imagen? Un fichero de sonido (M4A, MP3, WAV…) no la tiene: entonces width, height,
   * codedWidth, codedHeight y fps valen 0 y videoCodec es 'ninguno'.
   */
  hasVideo: boolean
  /** Ancho visible, con la rotación ya aplicada. */
  width: number
  /** Alto visible, con la rotación ya aplicada. */
  height: number
  /** Ancho y alto tal como vienen codificados, antes de girar. */
  codedWidth: number
  codedHeight: number
  /** Giro de visualización en grados, en sentido horario: 0, 90, 180 o 270. */
  rotation: 0 | 90 | 180 | 270
  fps: number
  hasAudio: boolean
  isHdr: boolean
  videoCodec: string
  pixelFormat: string | null
  colorTransfer: string | null
  colorPrimaries: string | null
  colorSpace: string | null
  audioCodec: string | null
  audioSampleRate: number | null
  audioChannels: number | null
  sizeBytes: number | null
  /** ¿Es una imagen fija (PNG, JPG, WebP)? Entonces durationMs vale 0. Solo para los efectos. */
  isStill?: boolean
  /** ¿La imagen trae transparencia (PNG con alfa, WebM VP9/VP8 con alfa, ProRes 4444)? */
  hasAlpha?: boolean
}

export type InsetCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export const INSET_CORNERS: readonly InsetCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
export type InsetSize = 'small' | 'medium'
export const INSET_SIZES: readonly InsetSize[] = ['small', 'medium']

/** El vídeo del propio trozo, en pequeño en una esquina (encima del vídeo de encima). */
export interface Inset {
  corner: InsetCorner
  size: InsetSize
}

/** Otro vídeo que se ve (sin su sonido) mientras suena el trozo. */
export interface CoverPicture {
  kind: 'cover'
  sourcePath: string
  /** Duración del otro vídeo, para saber cuándo se queda quieto en su última imagen. */
  sourceDurationMs: number
  /** Desde qué instante del otro vídeo se ve (ms). Corre en tiempo de salida del trozo, a velocidad normal. */
  startMs: number
  framing: Framing
  quarterTurns: QuarterTurns
  /** Solo si el trozo tiene imagen propia. */
  inset: Inset | null
}

/**
 * Qué se ve mientras suena el trozo. Manda el trozo que se oye: su duración, cortes, velocidad y sonido
 * son los que cuentan, y lo que se ve encima se adapta.
 * own: su propio vídeo · none: fondo liso (obligado si el original no tiene imagen) · cover: otro vídeo.
 */
export type Picture = { kind: 'own' } | { kind: 'none' } | CoverPicture

export interface Clip {
  id: string
  sourcePath: string
  /** Duración del original, para no salirse al recortar. */
  sourceDurationMs: number
  /** ¿El original tiene imagen? (un fichero de sonido no). */
  sourceHasVideo: boolean
  /** Rangos del original que se conservan, ordenados y sin solape. Por defecto, uno. */
  segments: TimeRange[]
  speed: Speed
  muted: boolean
  quarterTurns: QuarterTurns
  framing: Framing
  picture: Picture
  /**
   * Cómo aparece y desaparece el trozo (imagen desde/hacia negro y sonido a la vez): duración (ms; 0 = de
   * golpe, lo de siempre) y curva. Ver motion.ts.
   */
  fadeInMs: number
  fadeOutMs: number
  fadeInEasing: Easing
  fadeOutEasing: Easing
}

// ---------------------------------------------------------------------------
// Pistas de sonidos y efectos (debajo de la fila de trozos)

export type TrackKind = 'sound' | 'effect'
export const TRACK_KINDS: readonly TrackKind[] = ['sound', 'effect']

/**
 * Dónde está pegado un elemento: a un trozo (`offsetMs` en tiempo de salida de ese trozo) o, con
 * `clipId: null`, al principio del vídeo. El tiempo absoluto se calcula con la fila de trozos: si se
 * reordena un trozo, lo que lleva pegado va con él; si a uno anterior se le quitan pausas, lo de después
 * sigue en su sitio respecto a su trozo. `offsetMs` puede pasar del final del trozo (se sujeta a su final) o
 * ser negativo (se recortó el principio por delante de su momento: se sujeta al principio); en los dos
 * casos se guarda tal cual, para que al alargar el trozo vuelva a su sitio.
 */
export interface ItemAnchor {
  clipId: string | null
  offsetMs: number
}

/** De dónde sale el elemento: un fichero del ordenador o un elemento de la biblioteca. */
export type ItemSource = { type: 'file'; path: string } | { type: 'library'; assetId: string }

/** normal: se pone encima (con su transparencia, si la trae) · light: «como luz», el negro desaparece. */
export type EffectMix = 'normal' | 'light'
export const EFFECT_MIXES: readonly EffectMix[] = ['normal', 'light']
/** Cómo llena su sitio a tamaño 1: cubriendo el marco (recorta lo que sobra) o entero dentro. */
export type EffectFit = 'cover' | 'contain'

/**
 * Tamaño y sitio de un efecto, relativos al marco: (x, y) es su centro (0..1) y scale el tamaño
 * (1 = lo que da `fit` en el marco entero). Por defecto, a pantalla completa.
 */
export interface EffectBox {
  x: number
  y: number
  scale: number
}

/**
 * Una marca de sitio y tamaño: en `atMs` (tiempo del elemento, desde su principio; puede caer fuera de su tramo
 * tras recortarlo o partirlo, y sigue dando forma al camino) el efecto está en `box`. Llega a ella desde la marca
 * anterior con la curva `easing` («De golpe»: se queda quieto y salta al llegar).
 */
export interface BoxKeyframe {
  atMs: number
  box: EffectBox
  easing: MotionEasing
}

export interface EffectLook {
  mix: EffectMix
  /** 0 (no se ve) a 1. */
  opacity: number
  /** Tamaño y sitio sin marcas (todo el rato el mismo). */
  box: EffectBox
  fit: EffectFit
  /**
   * Marcas de sitio y tamaño (ordenadas por tiempo, sin dos en el mismo instante). Vacía: `box` todo el rato.
   * Con marcas, el efecto viaja de una a otra (ver keyframes.ts).
   */
  keyframes: BoxKeyframe[]
}

/** Un sonido o un efecto colocado en el tiempo en una pista. */
export interface TrackItem {
  id: string
  source: ItemSource
  /** Nombre que se enseña («Aplausos», o el nombre del fichero). */
  name: string
  /** Duración del original (0 si es una imagen fija). */
  sourceDurationMs: number
  /** ¿Es una imagen fija (PNG, JPG, WebP)? */
  still: boolean
  /** ¿El original tiene sonido? (un efecto puede traerlo). */
  hasAudio: boolean
  anchor: ItemAnchor
  /** Trozo del original que se usa (ms del original). En una imagen fija, 0 y 0. */
  inMs: number
  outMs: number
  /** Si repite: por qué punto de la vuelta empieza (ms desde inMs; al partir o recortar por delante). */
  phaseMs: number
  /** Se repite el trozo [inMs, outMs) hasta llenar `durationMs`. */
  repeat: boolean
  /**
   * Cuánto dura en pantalla si repite (o si es una imagen fija). null = hasta el final del vídeo.
   * Sin repetir, dura outMs − inMs y esto no se usa.
   */
  durationMs: number | null
  /** 0 a 1,5 (1 = como viene). En los efectos, el sonido que traigan; por defecto 0. */
  volume: number
  /** Cómo aparece y desaparece (ms; 0 = de golpe) y con qué curva (ver motion.ts). */
  fadeInMs: number
  fadeOutMs: number
  fadeInEasing: Easing
  fadeOutEasing: Easing
  /** Solo en los efectos: cómo se ve. */
  look: EffectLook | null
}

export interface Track {
  id: string
  kind: TrackKind
  /** Nombre editable («Música», «Sonidos», «Efectos»). */
  name: string
  /** Pista de sonido silenciada. */
  muted: boolean
  /** Pista de efectos ocultada. */
  hidden: boolean
  /** Elementos de la pista, sin solaparse (se ordenan por tiempo al resolverlos). */
  items: TrackItem[]
}

// ---------------------------------------------------------------------------
// Ficheros del proyecto («media pool»)

/** Qué es un fichero traído al proyecto: un vídeo (con imagen), un sonido (sin imagen) o una imagen fija. */
export type MediaKind = 'video' | 'sound' | 'image'

/**
 * Un fichero que se ha traído al proyecto, con lo que se sabe de él (lo que da ffprobe). Se queda en la
 * lista aunque ya no lo use ningún trozo ni ninguna pista («De mi ordenador» lo vuelve a ofrecer), y sirve
 * para comparar al volver a enlazar un original que se ha movido.
 */
export interface MediaEntry {
  path: string
  kind: MediaKind
  /** 0 en una imagen fija. */
  durationMs: number
  hasVideo: boolean
  hasAudio: boolean
  /** Ancho y alto visibles (con el giro aplicado); 0 si no tiene imagen o no se sabe. */
  width: number
  height: number
  fps: number
  sizeBytes: number | null
  hasAlpha: boolean
  /**
   * ¿Son datos medidos con ffprobe? false en lo que viene de un proyecto anterior a la versión 4 (solo se
   * sabía la duración y si tenía imagen): se completa al leer el fichero.
   */
  probed: boolean
}

/**
 * Versión 5: aparecer y desaparecer con curva (en trozos, sonidos y efectos). La 4 (con `media`, la lista de
 * sus ficheros), la 3 (con `mainMuted` y `tracks`), la 2 (trozos con `picture` y `sourceHasVideo`) y la 1 se
 * migran al leerlas: lo que tenía «entrada/salida suave» pasa a la curva «Al mismo ritmo» con la misma
 * duración (se ve y se oye igual).
 */
export const PROJECT_VERSION = 5 as const

export interface Project {
  version: typeof PROJECT_VERSION
  aspect: AspectRatio
  clips: Clip[]
  /** Duración objetivo opcional («que no pase de 5 minutos»). */
  targetDurationMs: number | null
  /** Silencia el sonido de todos los trozos de la fila principal (sin tocar cada uno). */
  mainMuted: boolean
  /** Pistas de sonidos y efectos. El orden de las de efectos es el de apilado: la primera, encima. */
  tracks: Track[]
  /** Ficheros traídos al proyecto, en el orden en que se trajeron (ver MediaEntry). */
  media: MediaEntry[]
}

/** Ningún trozo ni parte de un corte puede quedar más corto que esto (tiempo de salida). */
export const MIN_PIECE_MS = 200
/** Rango conservado mínimo en tiempo del original. */
export const MIN_SEGMENT_MS = 50

export const DEFAULT_FRAMING: Framing = { mode: 'fit-blur', zoom: 1, offsetX: 0, offsetY: 0 }
export const MAX_ZOOM = 4

// ---------------------------------------------------------------------------
// Creación

export function createProject(aspect: AspectRatio = '16:9'): Project {
  return { version: PROJECT_VERSION, aspect, clips: [], targetDurationMs: null, mainMuted: false, tracks: [], media: [] }
}

export type IdFactory = () => string

let fallbackCounter = 0
export const defaultIdFactory: IdFactory = () => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  fallbackCounter += 1
  return `clip-${Date.now().toString(36)}-${fallbackCounter}`
}

export function createClip(media: MediaInfo, id: string = defaultIdFactory()): Clip {
  const hasVideo = media.hasVideo !== false
  return {
    id,
    sourcePath: media.path,
    sourceDurationMs: Math.max(0, Math.round(media.durationMs)),
    sourceHasVideo: hasVideo,
    segments: [{ startMs: 0, endMs: Math.max(0, Math.round(media.durationMs)) }],
    speed: 1,
    muted: false,
    quarterTurns: 0,
    framing: { ...DEFAULT_FRAMING },
    picture: defaultPicture(hasVideo),
    fadeInMs: 0,
    fadeOutMs: 0,
    fadeInEasing: 'linear',
    fadeOutEasing: 'linear',
  }
}

/** Lo que se ve por defecto: su vídeo si lo tiene; si no, fondo liso. */
export function defaultPicture(sourceHasVideo: boolean): Picture {
  return sourceHasVideo ? { kind: 'own' } : { kind: 'none' }
}

// ---------------------------------------------------------------------------
// Utilidades de tiempo de un trozo

/** Milisegundos del original que se conservan (antes de aplicar la velocidad). */
export function keptSourceMs(clip: Clip): number {
  return clip.segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0)
}

/** Duración del trozo en el vídeo final. */
export function clipOutputMs(clip: Clip): number {
  return Math.round(keptSourceMs(clip) / clip.speed)
}

/** Punto de entrada y de salida del trozo (en el original). */
export function clipInOut(clip: Clip): TimeRange {
  const first = clip.segments[0]
  const last = clip.segments[clip.segments.length - 1]
  if (!first || !last) return { startMs: 0, endMs: 0 }
  return { startMs: first.startMs, endMs: last.endMs }
}

export interface SourcePosition {
  /** Tiempo en el original. */
  sourceMs: number
  /** Índice del rango conservado donde cae. */
  segmentIndex: number
}

/**
 * Tiempo de salida del trozo (0 = su primer fotograma en el vídeo final) → tiempo del original.
 * En la frontera exacta entre dos rangos devuelve el inicio del siguiente;
 * al final del trozo, el final del último rango.
 */
export function outputToSource(clip: Clip, outputMs: number): SourcePosition {
  const total = keptSourceMs(clip)
  let remaining = Math.min(Math.max(0, outputMs * clip.speed), total)
  const segs = clip.segments
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!
    const len = seg.endMs - seg.startMs
    const isLast = i === segs.length - 1
    if (remaining < len || (isLast && remaining <= len)) {
      return { sourceMs: Math.round(seg.startMs + remaining), segmentIndex: i }
    }
    remaining -= len
  }
  const last = segs[segs.length - 1]
  return { sourceMs: last ? last.endMs : 0, segmentIndex: Math.max(0, segs.length - 1) }
}

/**
 * Tiempo del original → tiempo de salida del trozo.
 * Devuelve null si ese instante del original no se conserva (está fuera de los rangos).
 */
export function sourceToOutput(clip: Clip, sourceMs: number): number | null {
  let acc = 0
  for (const seg of clip.segments) {
    if (sourceMs >= seg.startMs && sourceMs <= seg.endMs) {
      return Math.round((acc + (sourceMs - seg.startMs)) / clip.speed)
    }
    acc += seg.endMs - seg.startMs
  }
  return null
}

/** Inicio de cada trozo en la línea de tiempo del vídeo completo. */
export function clipStartTimes(project: Project): number[] {
  const starts: number[] = []
  let acc = 0
  for (const clip of project.clips) {
    starts.push(acc)
    acc += clipOutputMs(clip)
  }
  return starts
}

/** Tiempo del vídeo completo → qué trozo y en qué punto de su salida. */
export function locateInProject(
  project: Project,
  projectMs: number,
): { clipIndex: number; clipOutputMs: number } | null {
  let acc = 0
  for (let i = 0; i < project.clips.length; i++) {
    const d = clipOutputMs(project.clips[i]!)
    const isLast = i === project.clips.length - 1
    if (projectMs < acc + d || (isLast && projectMs <= acc + d)) {
      return { clipIndex: i, clipOutputMs: Math.max(0, projectMs - acc) }
    }
    acc += d
  }
  return null
}

/**
 * Anclaje para un instante del vídeo: el trozo que hay debajo (en la frontera exacta, el que empieza ahí)
 * con el tiempo dentro de él. Pasado el final, el último trozo; sin trozos, el principio del vídeo.
 */
export function anchorAt(project: Project, projectMs: number, starts: readonly number[] = clipStartTimes(project)): ItemAnchor {
  const t = Math.max(0, Math.round(projectMs))
  const clips = project.clips
  if (clips.length === 0) return { clipId: null, offsetMs: t }
  for (let i = clips.length - 1; i >= 0; i--) {
    if (t >= starts[i]!) return { clipId: clips[i]!.id, offsetMs: t - starts[i]! }
  }
  return { clipId: clips[0]!.id, offsetMs: 0 }
}

/**
 * Instante del vídeo donde cae un anclaje. Si el trozo se ha acortado y el punto queda fuera, se sujeta a
 * su final; si el trozo ya no está, cuenta desde el principio del vídeo.
 */
export function anchorTimeMs(
  project: Project,
  anchor: ItemAnchor,
  starts: readonly number[] = clipStartTimes(project),
  lengths: readonly number[] = project.clips.map(clipOutputMs),
): number {
  const offset = Math.max(0, Math.round(anchor.offsetMs))
  if (anchor.clipId === null) return offset
  const i = project.clips.findIndex((c) => c.id === anchor.clipId)
  if (i < 0) return offset
  return starts[i]! + Math.min(offset, lengths[i]!)
}

/** Cambia los elementos de todas las pistas (mismo objeto si no cambia ninguno). */
function mapTrackItems(project: Project, fn: (item: TrackItem) => TrackItem): Project {
  let changed = false
  const tracks = project.tracks.map((track) => {
    let trackChanged = false
    const items = track.items.map((item) => {
      const next = fn(item)
      if (next !== item) trackChanged = true
      return next
    })
    if (!trackChanged) return track
    changed = true
    return { ...track, items }
  })
  return changed ? { ...project, tracks } : project
}

/** Cuántos elementos (sonidos y efectos) van pegados a este trozo. */
export function itemsAnchoredTo(project: Project, clipId: string): { sounds: number; effects: number } {
  let sounds = 0
  let effects = 0
  for (const track of project.tracks) {
    for (const item of track.items) {
      if (item.anchor.clipId !== clipId) continue
      if (track.kind === 'sound') sounds++
      else effects++
    }
  }
  return { sounds, effects }
}

// ---------------------------------------------------------------------------
// Normalización de rangos

/** Ordena, recorta a [0, maxMs], fusiona solapes y descarta rangos de menos de MIN_SEGMENT_MS. */
export function normalizeSegments(segments: readonly TimeRange[], maxMs: number): TimeRange[] {
  const clamped = segments
    .map((s) => ({
      startMs: Math.round(Math.min(Math.max(0, s.startMs), maxMs)),
      endMs: Math.round(Math.min(Math.max(0, s.endMs), maxMs)),
    }))
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs)
  const merged: TimeRange[] = []
  for (const s of clamped) {
    const prev = merged[merged.length - 1]
    if (prev && s.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, s.endMs)
    } else {
      merged.push({ ...s })
    }
  }
  return merged.filter((s) => s.endMs - s.startMs >= MIN_SEGMENT_MS)
}

// ---------------------------------------------------------------------------
// Operaciones sobre el proyecto (siempre devuelven un objeto nuevo, o el mismo si no cambia nada)

function updateClip(project: Project, clipId: string, fn: (clip: Clip) => Clip): Project {
  const index = project.clips.findIndex((c) => c.id === clipId)
  if (index < 0) return project
  const current = project.clips[index]!
  const next = fn(current)
  if (next === current) return project
  const clips = project.clips.slice()
  clips[index] = next
  return { ...project, clips }
}

export function findClip(project: Project, clipId: string): Clip | undefined {
  return project.clips.find((c) => c.id === clipId)
}

export function addClip(project: Project, clip: Clip, index: number = project.clips.length): Project {
  const clips = project.clips.slice()
  const at = Math.min(Math.max(0, index), clips.length)
  clips.splice(at, 0, clip)
  return { ...project, clips }
}

/**
 * Copia independiente de un trozo con otro id (copiar y pegar): mismos cortes, pausas quitadas, velocidad,
 * sonido, giro, encuadre e imagen. No comparte ningún objeto con el original.
 */
export function duplicateClip(clip: Clip, newId: string = defaultIdFactory()): Clip {
  return {
    ...clip,
    id: newId,
    segments: clip.segments.map((s) => ({ ...s })),
    framing: { ...clip.framing },
    picture: shiftPicture(clip.picture, 0),
  }
}

/**
 * Inserta un trozo justo después de otro (o al final si `afterClipId` es null o no está).
 */
export function insertClipAfter(project: Project, afterClipId: string | null, clip: Clip): Project {
  const index = afterClipId === null ? -1 : project.clips.findIndex((c) => c.id === afterClipId)
  return addClip(project, clip, index < 0 ? project.clips.length : index + 1)
}

/**
 * Quita un trozo. Lo que llevaba pegado se queda en el mismo sitio del vídeo: pasa a pegarse al trozo que
 * quede en ese instante (o al principio del vídeo). Lo pegado a otros trozos va con ellos, como siempre.
 */
export function removeClip(project: Project, clipId: string): Project {
  if (!project.clips.some((c) => c.id === clipId)) return project
  const before = clipStartTimes(project)
  const lengths = project.clips.map(clipOutputMs)
  const next: Project = { ...project, clips: project.clips.filter((c) => c.id !== clipId) }
  const after = clipStartTimes(next)
  return mapTrackItems(next, (item) => {
    if (item.anchor.clipId !== clipId) return item
    const at = anchorTimeMs(project, item.anchor, before, lengths)
    return { ...item, anchor: anchorAt(next, at, after) }
  })
}

export function moveClip(project: Project, clipId: string, toIndex: number): Project {
  const from = project.clips.findIndex((c) => c.id === clipId)
  if (from < 0) return project
  const to = Math.min(Math.max(0, toIndex), project.clips.length - 1)
  if (from === to) return project
  const clips = project.clips.slice()
  const [clip] = clips.splice(from, 1)
  clips.splice(to, 0, clip!)
  return { ...project, clips }
}

export function setAspect(project: Project, aspect: AspectRatio): Project {
  return project.aspect === aspect ? project : { ...project, aspect }
}

export function setTargetDuration(project: Project, targetDurationMs: number | null): Project {
  const value = targetDurationMs === null ? null : Math.max(0, Math.round(targetDurationMs))
  return project.targetDurationMs === value ? project : { ...project, targetDurationMs: value }
}

/**
 * Cambia la entrada y/o la salida del trozo (en tiempo del original).
 * La entrada mueve el inicio del primer rango y la salida el final del último;
 * los rangos que queden fuera se descartan. Si el resultado sería demasiado corto, no cambia nada.
 * Lo pegado al trozo sigue a su imagen: al recortar (o alargar) el principio, se corre lo mismo.
 */
export function setInOut(
  project: Project,
  clipId: string,
  change: { inMs?: number; outMs?: number },
): Project {
  const changed = updateClip(project, clipId, (clip) => {
    const current = clipInOut(clip)
    const inMs = Math.round(Math.min(Math.max(0, change.inMs ?? current.startMs), clip.sourceDurationMs))
    const outMs = Math.round(Math.min(Math.max(0, change.outMs ?? current.endMs), clip.sourceDurationMs))
    if (outMs <= inMs) return clip
    const segs = clip.segments
      .map((s) => ({ ...s }))
      .filter((s) => s.endMs > inMs && s.startMs < outMs)
    if (segs.length === 0) {
      segs.push({ startMs: inMs, endMs: outMs })
    } else {
      segs[0]!.startMs = inMs
      segs[segs.length - 1]!.endMs = outMs
    }
    const segments = normalizeSegments(segs, clip.sourceDurationMs)
    const next = { ...clip, segments }
    if (segments.length === 0 || clipOutputMs(next) < MIN_PIECE_MS) return clip
    if (sameSegments(segments, clip.segments)) return clip
    return next
  })
  if (changed === project) return project
  const before = findClip(project, clipId)!
  const shift = startShiftMs(before, findClip(changed, clipId)!)
  if (shift === 0) return changed
  // Lo pegado al trozo sigue a su imagen: si se recorta el principio, se adelanta lo mismo (y si su momento
  // queda fuera, se sujeta al principio del trozo con el offset negativo guardado: al alargarlo, vuelve).
  return mapTrackItems(changed, (item) =>
    item.anchor.clipId === clipId ? { ...item, anchor: { clipId, offsetMs: item.anchor.offsetMs - shift } } : item,
  )
}

/**
 * Cuánto se ha corrido hacia delante (ms de salida) la imagen del trozo al cambiar su entrada: lo que se ha
 * quitado por delante (positivo) o lo que se ha añadido (negativo). Con pausas quitadas, solo cuenta lo
 * conservado; con otra velocidad, en tiempo de salida.
 */
function startShiftMs(before: Clip, after: Clip): number {
  const oldIn = clipInOut(before).startMs
  const newIn = clipInOut(after).startMs
  if (newIn === oldIn) return 0
  if (newIn < oldIn) return -Math.round((oldIn - newIn) / before.speed)
  const removed = before.segments.reduce((sum, s) => sum + Math.max(0, Math.min(s.endMs, newIn) - s.startMs), 0)
  return Math.round(removed / before.speed)
}

/**
 * Recorta o alarga un trozo por un extremo (desde las pistas): `deltaMs` en tiempo de salida, positivo hacia
 * la derecha. Por el principio, positivo acorta; por el final, positivo alarga. Alarga hasta donde dé el
 * original y nunca deja el trozo más corto que MIN_PIECE_MS. Con pausas quitadas, recortar se salta lo
 * quitado (cuenta lo que se ve) y alargar estira el primer o el último rango; con otra velocidad, el
 * original se mueve `deltaMs × velocidad`. Los trozos siguientes se recolocan solos (no hay huecos).
 */
export function trimClip(project: Project, clipId: string, edge: 'start' | 'end', deltaMs: number): Project {
  const clip = findClip(project, clipId)
  if (!clip) return project
  const len = clipOutputMs(clip)
  const io = clipInOut(clip)
  const d = Math.round(deltaMs)
  if (d === 0) return project
  if (edge === 'start') {
    if (d < 0) return setInOut(project, clipId, { inMs: Math.max(0, Math.round(io.startMs + d * clip.speed)) })
    const at = Math.min(d, len - MIN_PIECE_MS)
    if (at <= 0) return project
    return setInOut(project, clipId, { inMs: outputToSource(clip, at).sourceMs })
  }
  if (d > 0) return setInOut(project, clipId, { outMs: Math.min(clip.sourceDurationMs, Math.round(io.endMs + d * clip.speed)) })
  const at = Math.max(len + d, MIN_PIECE_MS)
  if (at >= len) return project
  return setInOut(project, clipId, { outMs: outputToSourceEnd(clip, at) })
}

/**
 * Como outputToSource, pero en la frontera exacta entre dos rangos devuelve el final del anterior (para
 * poner ahí una salida sin estirar ese rango por encima de lo quitado).
 */
function outputToSourceEnd(clip: Clip, outputMs: number): number {
  let remaining = Math.max(0, outputMs * clip.speed)
  for (const seg of clip.segments) {
    const len = seg.endMs - seg.startMs
    if (remaining <= len) return Math.round(seg.startMs + remaining)
    remaining -= len
  }
  return clipInOut(clip).endMs
}

/**
 * Parte un trozo en dos en un punto de su salida (la línea de tiempo del trozo ya editado,
 * con rangos y velocidad aplicados). Las dos partes apuntan al mismo original.
 * Si el punto cae a menos de MIN_PIECE_MS de un borde, no hace nada.
 */
export function splitClip(
  project: Project,
  clipId: string,
  atOutputMs: number,
  newId: string = defaultIdFactory(),
): Project {
  const index = project.clips.findIndex((c) => c.id === clipId)
  if (index < 0) return project
  const clip = project.clips[index]!
  const total = clipOutputMs(clip)
  if (atOutputMs < MIN_PIECE_MS || atOutputMs > total - MIN_PIECE_MS) return project

  const { sourceMs, segmentIndex } = outputToSource(clip, atOutputMs)
  const seg = clip.segments[segmentIndex]!
  const left: TimeRange[] = clip.segments.slice(0, segmentIndex).map((s) => ({ ...s }))
  const right: TimeRange[] = []
  if (sourceMs > seg.startMs) left.push({ startMs: seg.startMs, endMs: sourceMs })
  if (sourceMs < seg.endMs) right.push({ startMs: sourceMs, endMs: seg.endMs })
  right.push(...clip.segments.slice(segmentIndex + 1).map((s) => ({ ...s })))
  if (left.length === 0 || right.length === 0) return project

  // Cada parte se queda con su borde: la primera aparece como antes y la segunda desaparece como antes.
  const first: Clip = { ...clip, segments: left, fadeOutMs: 0 }
  // El vídeo de encima corre en tiempo de salida: la segunda parte sigue donde iba.
  const second: Clip = {
    ...clip,
    fadeInMs: 0,
    id: newId,
    segments: right,
    framing: { ...clip.framing },
    picture: shiftPicture(clip.picture, clipOutputMs(first)),
  }
  const clips = project.clips.slice()
  clips.splice(index, 1, first, second)
  // Lo pegado al trozo se queda con la parte donde cae su inicio.
  const firstMs = clipOutputMs(first)
  return mapTrackItems({ ...project, clips }, (item) =>
    item.anchor.clipId === clipId && item.anchor.offsetMs >= firstMs
      ? { ...item, anchor: { clipId: newId, offsetMs: item.anchor.offsetMs - firstMs } }
      : item,
  )
}

export function setSpeed(project: Project, clipId: string, speed: Speed): Project {
  if (!SPEEDS.includes(speed)) return project
  return updateClip(project, clipId, (clip) => (clip.speed === speed ? clip : { ...clip, speed }))
}

export function setMuted(project: Project, clipId: string, muted: boolean): Project {
  return updateClip(project, clipId, (clip) => (clip.muted === muted ? clip : { ...clip, muted }))
}

/** Cómo aparece o desaparece algo: duración (ms; 0 = de golpe) y curva. */
export interface FadeChoice {
  ms: number
  easing: Easing
}

/** Cómo aparece (desde negro y desde silencio) o desaparece el trozo. */
export function setClipFade(project: Project, clipId: string, which: 'in' | 'out', fade: FadeChoice): Project {
  const ms = Math.max(0, Math.round(Number.isFinite(fade.ms) ? fade.ms : 0))
  const easing = isEasing(fade.easing) ? fade.easing : 'linear'
  return updateClip(project, clipId, (clip) => {
    if (which === 'in') return clip.fadeInMs === ms && clip.fadeInEasing === easing ? clip : { ...clip, fadeInMs: ms, fadeInEasing: easing }
    return clip.fadeOutMs === ms && clip.fadeOutEasing === easing ? clip : { ...clip, fadeOutMs: ms, fadeOutEasing: easing }
  })
}

/** Gira el trozo 90° (1 = horario, -1 = antihorario). */
export function rotateClip(project: Project, clipId: string, direction: 1 | -1 = 1): Project {
  return updateClip(project, clipId, (clip) => ({
    ...clip,
    quarterTurns: ((((clip.quarterTurns + direction) % 4) + 4) % 4) as QuarterTurns,
  }))
}

export function clampFraming(framing: Framing): Framing {
  const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : 0)
  return {
    mode: framing.mode === 'fill' ? 'fill' : 'fit-blur',
    zoom: Number.isFinite(framing.zoom) ? clamp(framing.zoom, 1, MAX_ZOOM) : 1,
    offsetX: clamp(framing.offsetX, -1, 1),
    offsetY: clamp(framing.offsetY, -1, 1),
  }
}

export function setFraming(project: Project, clipId: string, change: Partial<Framing>): Project {
  return updateClip(project, clipId, (clip) => {
    const framing = clampFraming({ ...clip.framing, ...change })
    const f = clip.framing
    if (
      f.mode === framing.mode &&
      f.zoom === framing.zoom &&
      f.offsetX === framing.offsetX &&
      f.offsetY === framing.offsetY
    ) {
      return clip
    }
    return { ...clip, framing }
  })
}

/**
 * Sustituye los rangos conservados (p. ej. tras «quitar pausas»).
 * Se normalizan; si no queda nada útil, no cambia nada.
 */
export function applyKeepSegments(project: Project, clipId: string, segments: readonly TimeRange[]): Project {
  return updateClip(project, clipId, (clip) => {
    const normalized = normalizeSegments(segments, clip.sourceDurationMs)
    if (normalized.length === 0) return clip
    const next = { ...clip, segments: normalized }
    if (clipOutputMs(next) < MIN_PIECE_MS) return clip
    if (sameSegments(normalized, clip.segments)) return clip
    return next
  })
}

/** Deshace «quitar pausas»: vuelve a un único rango de la entrada a la salida. */
export function resetKeepSegments(project: Project, clipId: string): Project {
  return updateClip(project, clipId, (clip) => {
    if (clip.segments.length <= 1) return clip
    return { ...clip, segments: [clipInOut(clip)] }
  })
}

// ---------------------------------------------------------------------------
// Imagen: qué se ve mientras suena el trozo

/** El vídeo de encima no puede empezar a menos de esto de su final (para que se vea algo moverse). */
export const COVER_MIN_TAIL_MS = 500

/** Copia del vídeo de encima que empieza `deltaMs` más tarde (al partir un trozo). */
function shiftPicture(picture: Picture, deltaMs: number): Picture {
  if (picture.kind !== 'cover') return { ...picture }
  return {
    ...picture,
    framing: { ...picture.framing },
    inset: picture.inset ? { ...picture.inset } : null,
    startMs: Math.min(picture.sourceDurationMs, Math.max(0, Math.round(picture.startMs + deltaMs))),
  }
}

/** Último instante desde el que puede empezar el vídeo de encima. */
export function maxCoverStartMs(coverDurationMs: number): number {
  return Math.max(0, Math.round(coverDurationMs) - COVER_MIN_TAIL_MS)
}

/** Deja la imagen en un estado válido para un trozo con o sin imagen propia. */
export function normalizePicture(picture: Picture, sourceHasVideo: boolean): Picture {
  if (picture.kind === 'own') return sourceHasVideo ? { kind: 'own' } : { kind: 'none' }
  if (picture.kind === 'none') return { kind: 'none' }
  const duration = Math.max(0, Math.round(picture.sourceDurationMs))
  const inset =
    sourceHasVideo && picture.inset && INSET_CORNERS.includes(picture.inset.corner) && INSET_SIZES.includes(picture.inset.size)
      ? { corner: picture.inset.corner, size: picture.inset.size }
      : null
  return {
    kind: 'cover',
    sourcePath: picture.sourcePath,
    sourceDurationMs: duration,
    startMs: Math.min(duration, Math.max(0, Math.round(Number.isFinite(picture.startMs) ? picture.startMs : 0))),
    framing: clampFraming(picture.framing),
    quarterTurns: ((((Math.round(picture.quarterTurns ?? 0) % 4) + 4) % 4) as QuarterTurns),
    inset,
  }
}

function samePicture(a: Picture, b: Picture): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Cambia lo que se ve. Se normaliza: «su vídeo» no vale si el original no tiene imagen. */
export function setPicture(project: Project, clipId: string, picture: Picture): Project {
  return updateClip(project, clipId, (clip) => {
    const next = normalizePicture(picture, clip.sourceHasVideo)
    return samePicture(next, clip.picture) ? clip : { ...clip, picture: next }
  })
}

/**
 * Pone otro vídeo encima (o lo cambia por otro). Si ya había uno, conserva la esquina;
 * el encuadre vuelve al de serie y empieza desde `startMs` (por defecto, el principio).
 */
export function setCover(
  project: Project,
  clipId: string,
  cover: Pick<MediaInfo, 'path' | 'durationMs'>,
  startMs = 0,
): Project {
  const clip = findClip(project, clipId)
  if (!clip) return project
  const inset = clip.picture.kind === 'cover' ? clip.picture.inset : null
  return setPicture(project, clipId, {
    kind: 'cover',
    sourcePath: cover.path,
    sourceDurationMs: Math.max(0, Math.round(cover.durationMs)),
    startMs: Math.min(startMs, maxCoverStartMs(cover.durationMs)),
    framing: { ...DEFAULT_FRAMING },
    quarterTurns: 0,
    inset,
  })
}

/** Quita el vídeo de encima: vuelve a verse su vídeo (o el fondo liso, si es un sonido). */
export function removeCover(project: Project, clipId: string): Project {
  const clip = findClip(project, clipId)
  if (!clip || clip.picture.kind !== 'cover') return project
  return setPicture(project, clipId, defaultPicture(clip.sourceHasVideo))
}

function updateCover(project: Project, clipId: string, fn: (cover: CoverPicture) => CoverPicture): Project {
  const clip = findClip(project, clipId)
  if (!clip || clip.picture.kind !== 'cover') return project
  return setPicture(project, clipId, fn(clip.picture))
}

/** Desde qué momento del otro vídeo se ve (sin pasar de su final menos COVER_MIN_TAIL_MS). */
export function setCoverStart(project: Project, clipId: string, startMs: number): Project {
  return updateCover(project, clipId, (c) => ({
    ...c,
    startMs: Math.min(Math.max(0, Math.round(startMs)), maxCoverStartMs(c.sourceDurationMs)),
  }))
}

export function setCoverFraming(project: Project, clipId: string, change: Partial<Framing>): Project {
  return updateCover(project, clipId, (c) => ({ ...c, framing: clampFraming({ ...c.framing, ...change }) }))
}

/** «Verme en una esquina» (null = no). Solo vale si el trozo tiene imagen propia. */
export function setInset(project: Project, clipId: string, inset: Inset | null): Project {
  return updateCover(project, clipId, (c) => ({ ...c, inset }))
}

/** ¿Se ve la imagen del propio trozo (entera o en la esquina)? */
export function clipShowsOwnVideo(clip: Clip): boolean {
  return clip.sourceHasVideo && (clip.picture.kind === 'own' || (clip.picture.kind === 'cover' && clip.picture.inset !== null))
}

/** ¿El trozo enseña alguna imagen? (con «Solo se oye», no). */
export function clipShowsPicture(clip: Clip): boolean {
  return clip.picture.kind !== 'none'
}

/**
 * Cuánto le falta al vídeo de encima para cubrir el trozo (ms; 0 si llega). Si le falta,
 * al acabarse se queda quieto en su última imagen.
 */
export function coverShortfallMs(clip: Clip): number {
  if (clip.picture.kind !== 'cover') return 0
  const available = clip.picture.sourceDurationMs - clip.picture.startMs
  return Math.max(0, clipOutputMs(clip) - available)
}

/** Todos los ficheros que usa el trozo (el original y, si lo hay, el vídeo de encima). */
export function clipPaths(clip: Clip): string[] {
  return clip.picture.kind === 'cover' ? [clip.sourcePath, clip.picture.sourcePath] : [clip.sourcePath]
}

function sameSegments(a: readonly TimeRange[], b: readonly TimeRange[]): boolean {
  return a.length === b.length && a.every((s, i) => s.startMs === b[i]!.startMs && s.endMs === b[i]!.endMs)
}

/** Lo que hace falta para encuadrar una imagen: el trozo (su vídeo) o el vídeo de encima. */
export type Viewable = Pick<Clip, 'framing' | 'quarterTurns'>

/** Ancho y alto visibles del trozo (o del vídeo de encima) tras aplicar sus giros. */
export function clipDisplaySize(clip: Viewable, media: Pick<MediaInfo, 'width' | 'height'>): { width: number; height: number } {
  return clip.quarterTurns % 2 === 1
    ? { width: media.height, height: media.width }
    : { width: media.width, height: media.height }
}

// ---------------------------------------------------------------------------
// Ficheros del proyecto («media pool»): lo básico, que hace falta también al leer un proyecto

/** Qué es un fichero según lo que dice ffprobe. */
export function mediaKindOf(info: Pick<MediaInfo, 'hasVideo' | 'isStill'>): MediaKind {
  if (info.isStill) return 'image'
  return info.hasVideo !== false ? 'video' : 'sound'
}

/** La entrada de la lista de ficheros con lo que ha medido ffprobe. */
export function mediaEntryFromInfo(info: MediaInfo): MediaEntry {
  const kind = mediaKindOf(info)
  const hasVideo = kind !== 'sound'
  return {
    path: info.path,
    kind,
    durationMs: kind === 'image' ? 0 : Math.max(0, Math.round(info.durationMs)),
    hasVideo,
    hasAudio: kind !== 'image' && info.hasAudio,
    width: hasVideo ? Math.max(0, Math.round(info.width)) : 0,
    height: hasVideo ? Math.max(0, Math.round(info.height)) : 0,
    fps: hasVideo && Number.isFinite(info.fps) ? info.fps : 0,
    sizeBytes: typeof info.sizeBytes === 'number' && Number.isFinite(info.sizeBytes) ? info.sizeBytes : null,
    hasAlpha: info.hasAlpha === true,
    probed: true,
  }
}

/** Todos los ficheros del ordenador que usa el proyecto (trozos, vídeos de encima y pistas), sin repetir. */
export function usedMediaPaths(project: Project): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (p: string) => {
    if (seen.has(p)) return
    seen.add(p)
    out.push(p)
  }
  for (const c of project.clips) {
    add(c.sourcePath)
    if (c.picture.kind === 'cover') add(c.picture.sourcePath)
  }
  for (const t of project.tracks) for (const i of t.items) if (i.source.type === 'file') add(i.source.path)
  return out
}

/**
 * Lo poco que se sabe de un fichero por cómo lo usa el proyecto (sin ffprobe): para los proyectos de antes
 * de la versión 4 o un fichero que falta. El trozo sabe más que el vídeo de encima y que la pista.
 */
function inferredEntry(project: Project, path: string): MediaEntry | null {
  const base = (kind: MediaKind, durationMs: number, hasAudio: boolean): MediaEntry => ({
    path,
    kind,
    durationMs: kind === 'image' ? 0 : Math.max(0, Math.round(durationMs)),
    hasVideo: kind !== 'sound',
    hasAudio,
    width: 0,
    height: 0,
    fps: 0,
    sizeBytes: null,
    hasAlpha: false,
    probed: false,
  })
  const clip = project.clips.find((c) => c.sourcePath === path)
  // De un trozo no se guardaba si tenía sonido: se supone que sí (es lo normal).
  if (clip) return base(clip.sourceHasVideo ? 'video' : 'sound', clip.sourceDurationMs, true)
  for (const c of project.clips) {
    if (c.picture.kind === 'cover' && c.picture.sourcePath === path) return base('video', c.picture.sourceDurationMs, true)
  }
  for (const t of project.tracks) {
    for (const i of t.items) {
      if (i.source.type !== 'file' || i.source.path !== path) continue
      const kind: MediaKind = i.still ? 'image' : t.kind === 'effect' ? 'video' : 'sound'
      return base(kind, i.sourceDurationMs, i.hasAudio)
    }
  }
  return null
}

function sameEntry(a: MediaEntry, b: MediaEntry): boolean {
  return (
    a.path === b.path &&
    a.kind === b.kind &&
    a.durationMs === b.durationMs &&
    a.hasVideo === b.hasVideo &&
    a.hasAudio === b.hasAudio &&
    a.width === b.width &&
    a.height === b.height &&
    a.fps === b.fps &&
    a.sizeBytes === b.sizeBytes &&
    a.hasAlpha === b.hasAlpha &&
    a.probed === b.probed
  )
}

/**
 * Deja en la lista de ficheros todo lo que usa el proyecto: lo que falte se añade al final (con lo medido
 * en `known`, si se sabe; si no, con lo que dice el propio proyecto), y lo que estaba sin medir se completa
 * con `known`. Nunca quita nada. Devuelve el mismo objeto si no cambia nada.
 */
export function syncMediaPool(project: Project, known: Readonly<Record<string, MediaInfo>> = {}): Project {
  let media: MediaEntry[] | null = null
  const at = new Map(project.media.map((m, i) => [m.path, i]))
  const list = () => (media ??= project.media.slice())
  for (const path of usedMediaPaths(project)) {
    const info = known[path]
    const i = at.get(path)
    if (i === undefined) {
      const entry = info ? mediaEntryFromInfo(info) : inferredEntry(project, path)
      if (!entry) continue
      at.set(path, list().length)
      list().push(entry)
    } else if (info && !(media ?? project.media)[i]!.probed) {
      list()[i] = mediaEntryFromInfo(info)
    }
  }
  return media ? { ...project, media } : project
}

/**
 * Pone o actualiza la entrada de un fichero con lo medido (sin tocar nada más). Devuelve el mismo objeto si
 * ya estaba igual.
 */
export function upsertMediaEntry(project: Project, info: MediaInfo): Project {
  const entry = mediaEntryFromInfo(info)
  const i = project.media.findIndex((m) => m.path === info.path)
  if (i >= 0 && sameEntry(project.media[i]!, entry)) return project
  const media = project.media.slice()
  if (i >= 0) media[i] = entry
  else media.push(entry)
  return { ...project, media }
}

/**
 * Une la lista de ficheros del proyecto con otra más nueva (la de antes de deshacer o rehacer): la lista de
 * ficheros no se deshace, porque lo que se ha traído se queda a mano aunque se deshaga el trozo que lo usaba.
 * Para un mismo fichero gana `newer`. Devuelve el mismo objeto si no cambia nada.
 */
export function mergeMediaPool(project: Project, newer: readonly MediaEntry[]): Project {
  if (newer === project.media) return project
  let changed = false
  const byPath = new Map(newer.map((m) => [m.path, m]))
  const media = project.media.map((m) => {
    const n = byPath.get(m.path)
    if (n && !sameEntry(n, m)) {
      changed = true
      return n
    }
    return m
  })
  const have = new Set(project.media.map((m) => m.path))
  for (const n of newer) {
    if (have.has(n.path)) continue
    media.push(n)
    have.add(n.path)
    changed = true
  }
  return changed ? { ...project, media } : project
}

// ---------------------------------------------------------------------------
// Serialización

export const PROJECT_FILE_APP = 'easy-cut'
/** Nombre de un proyecto: hasta esta longitud. */
export const MAX_PROJECT_NAME_LENGTH = 80

interface ProjectFile {
  app: typeof PROJECT_FILE_APP
  version: number
  /** Nombre que se enseña en la lista de Inicio (va fuera del proyecto: cambiarlo no se deshace). */
  name?: string
  project: Omit<Project, 'version'>
}

export function serializeProject(project: Project, meta: { name?: string } = {}): string {
  const file: ProjectFile = {
    app: PROJECT_FILE_APP,
    version: PROJECT_VERSION,
    ...(meta.name ? { name: meta.name } : {}),
    project: {
      aspect: project.aspect,
      clips: project.clips,
      targetDurationMs: project.targetDurationMs,
      mainMuted: project.mainMuted,
      tracks: project.tracks,
      media: project.media,
    },
  }
  return JSON.stringify(file, null, 2)
}

/** Lee un proyecto guardado con su nombre ('' si no lo tiene). Lanza ProjectFormatError como parseProject. */
export function parseProjectFile(json: string): { project: Project; name: string } {
  const project = parseProject(json)
  let name = ''
  try {
    const data = JSON.parse(json) as unknown
    if (isObject(data) && typeof data.name === 'string') name = data.name.trim().slice(0, MAX_PROJECT_NAME_LENGTH)
  } catch {
    // parseProject ya lo habría rechazado.
  }
  return { project, name }
}

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFormatError'
  }
}

/** Lee un proyecto guardado. Lanza ProjectFormatError con un mensaje en castellano si no es válido. */
export function parseProject(json: string): Project {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new ProjectFormatError('El fichero del proyecto está dañado: no es JSON válido.')
  }
  if (!isObject(data) || data.app !== PROJECT_FILE_APP) {
    throw new ProjectFormatError('Este fichero no es un proyecto de easy-cut.')
  }
  if (typeof data.version !== 'number' || data.version > PROJECT_VERSION) {
    throw new ProjectFormatError('Este proyecto se guardó con una versión más nueva de easy-cut.')
  }
  const p = data.project
  if (!isObject(p)) throw new ProjectFormatError('El proyecto no tiene contenido.')
  const aspect = ASPECT_RATIOS.includes(p.aspect as AspectRatio) ? (p.aspect as AspectRatio) : '16:9'
  if (!Array.isArray(p.clips)) throw new ProjectFormatError('El proyecto no tiene la lista de trozos.')
  const version = data.version
  const clips = p.clips.map((c, i) => parseClip(c, i, version))
  const target = typeof p.targetDurationMs === 'number' && p.targetDurationMs > 0 ? Math.round(p.targetDurationMs) : null
  // Migración 1/2 → 3: sin pistas y con el sonido de la fila principal puesto.
  const tracks = version < 3 || !Array.isArray(p.tracks) ? [] : parseTracks(p.tracks)
  // Migración 1/2/3 → 4: la lista de ficheros sale de lo que usa el proyecto (sin medir: se mide al abrirlo).
  // En la 4, la guardada, y lo que falte en ella (un fichero a mano en el JSON) se añade igual.
  const media = version >= 4 && Array.isArray(p.media) ? parseMediaPool(p.media) : []
  const project: Project = { version: PROJECT_VERSION, aspect, clips, targetDurationMs: target, mainMuted: version >= 3 && p.mainMuted === true, tracks, media }
  return syncMediaPool(project)
}

function parseMediaPool(raw: unknown[]): MediaEntry[] {
  const out: MediaEntry[] = []
  const seen = new Set<string>()
  for (const m of raw) {
    if (!isObject(m) || typeof m.path !== 'string' || m.path === '' || seen.has(m.path)) continue
    const kind: MediaKind | null = m.kind === 'video' || m.kind === 'sound' || m.kind === 'image' ? m.kind : null
    if (!kind) continue
    seen.add(m.path)
    const hasVideo = kind !== 'sound'
    const size = finiteOr(m.sizeBytes, NaN)
    out.push({
      path: m.path,
      kind,
      durationMs: kind === 'image' ? 0 : Math.max(0, Math.round(finiteOr(m.durationMs, 0))),
      hasVideo,
      hasAudio: kind !== 'image' && m.hasAudio !== false,
      width: hasVideo ? Math.max(0, Math.round(finiteOr(m.width, 0))) : 0,
      height: hasVideo ? Math.max(0, Math.round(finiteOr(m.height, 0))) : 0,
      fps: hasVideo ? Math.max(0, finiteOr(m.fps, 0)) : 0,
      sizeBytes: Number.isFinite(size) && size >= 0 ? Math.round(size) : null,
      hasAlpha: m.hasAlpha === true,
      probed: m.probed === true,
    })
  }
  return out
}

/** Límites de los valores de un elemento. */
export const MAX_ITEM_VOLUME = 1.5
export const MIN_EFFECT_SCALE = 0.05
export const MAX_EFFECT_SCALE = 3

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clampNumber(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/** Deja un aspecto de efecto en valores válidos. */
export function normalizeLook(raw: unknown): EffectLook {
  const l = isObject(raw) ? raw : {}
  return {
    mix: l.mix === 'light' ? 'light' : 'normal',
    opacity: clampNumber(finiteOr(l.opacity, 1), 0, 1),
    box: normalizeBox(l.box),
    fit: l.fit === 'contain' ? 'contain' : 'cover',
    keyframes: normalizeKeyframes(l.keyframes),
  }
}

/** Un tamaño y sitio en valores válidos (centro dentro del marco y tamaño entre los límites). */
export function normalizeBox(raw: unknown): EffectBox {
  const box = isObject(raw) ? raw : {}
  return {
    x: clampNumber(finiteOr(box.x, 0.5), 0, 1),
    y: clampNumber(finiteOr(box.y, 0.5), 0, 1),
    scale: clampNumber(finiteOr(box.scale, 1), MIN_EFFECT_SCALE, MAX_EFFECT_SCALE),
  }
}

/** Marcas en orden y válidas: sin dos en el mismo milisegundo (gana la última), curvas conocidas. */
function normalizeKeyframes(raw: unknown): BoxKeyframe[] {
  if (!Array.isArray(raw)) return []
  const byTime = new Map<number, BoxKeyframe>()
  for (const k of raw) {
    if (!isObject(k) || typeof k.atMs !== 'number' || !Number.isFinite(k.atMs)) continue
    const atMs = Math.round(k.atMs)
    byTime.set(atMs, { atMs, box: normalizeBox(k.box), easing: isMotionEasing(k.easing) ? k.easing : 'smooth' })
  }
  return [...byTime.values()].sort((a, b) => a.atMs - b.atMs)
}

/**
 * Elementos de las pistas guardadas. Lo que no se entienda se descarta (el elemento o la pista entera),
 * nunca el proyecto: las pistas son un añadido sobre los trozos.
 */
function parseTracks(raw: unknown[]): Track[] {
  const tracks: Track[] = []
  for (const t of raw) {
    if (!isObject(t) || typeof t.id !== 'string' || t.id === '') continue
    const kind: TrackKind | null = t.kind === 'sound' || t.kind === 'effect' ? t.kind : null
    if (!kind) continue
    const items = Array.isArray(t.items) ? t.items.flatMap((i) => parseTrackItem(i, kind)) : []
    tracks.push({
      id: t.id,
      kind,
      name: typeof t.name === 'string' && t.name.trim() !== '' ? t.name.slice(0, 40) : kind === 'sound' ? 'Sonidos' : 'Efectos',
      muted: kind === 'sound' && t.muted === true,
      hidden: kind === 'effect' && t.hidden === true,
      items,
    })
  }
  return tracks
}

function parseTrackItem(raw: unknown, kind: TrackKind): TrackItem[] {
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '') return []
  const s = raw.source
  let source: ItemSource
  if (isObject(s) && s.type === 'file' && typeof s.path === 'string' && s.path !== '') source = { type: 'file', path: s.path }
  else if (isObject(s) && s.type === 'library' && typeof s.assetId === 'string' && s.assetId !== '') source = { type: 'library', assetId: s.assetId }
  else return []
  const still = kind === 'effect' && raw.still === true
  const sourceDurationMs = still ? 0 : Math.round(finiteOr(raw.sourceDurationMs, 0))
  if (!still && sourceDurationMs <= 0) return []
  const a = isObject(raw.anchor) ? raw.anchor : {}
  const anchor: ItemAnchor = {
    clipId: typeof a.clipId === 'string' && a.clipId !== '' ? a.clipId : null,
    // Puede ser negativo: lo pegado a un momento que se ha recortado por delante (ver setInOut).
    offsetMs: Math.round(finiteOr(a.offsetMs, 0)),
  }
  const inMs = still ? 0 : Math.round(clampNumber(finiteOr(raw.inMs, 0), 0, sourceDurationMs))
  const outMs = still ? 0 : Math.round(clampNumber(finiteOr(raw.outMs, sourceDurationMs), 0, sourceDurationMs))
  if (!still && outMs - inMs < MIN_SEGMENT_MS) return []
  const duration = raw.durationMs === null ? null : Math.round(finiteOr(raw.durationMs, NaN))
  const repeat = !still && raw.repeat === true
  const durationMs = repeat || still ? (duration === null || !Number.isFinite(duration) ? null : Math.max(MIN_SEGMENT_MS, duration)) : null
  const loopMs = Math.max(1, outMs - inMs)
  return [
    {
      id: raw.id,
      source,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
      sourceDurationMs,
      still,
      hasAudio: !still && raw.hasAudio !== false,
      anchor,
      inMs,
      outMs,
      phaseMs: repeat ? Math.round(clampNumber(finiteOr(raw.phaseMs, 0), 0, loopMs - 1)) : 0,
      repeat,
      durationMs,
      volume: clampNumber(finiteOr(raw.volume, kind === 'sound' ? 1 : 0), 0, MAX_ITEM_VOLUME),
      fadeInMs: Math.max(0, Math.round(finiteOr(raw.fadeInMs, 0))),
      fadeOutMs: Math.max(0, Math.round(finiteOr(raw.fadeOutMs, 0))),
      // Antes de la 5 eran lineales (el interruptor «suave»).
      fadeInEasing: isEasing(raw.fadeInEasing) ? raw.fadeInEasing : 'linear',
      fadeOutEasing: isEasing(raw.fadeOutEasing) ? raw.fadeOutEasing : 'linear',
      look: kind === 'effect' ? normalizeLook(raw.look) : null,
    },
  ]
}

function parseFraming(raw: unknown): Framing {
  const f = isObject(raw) ? raw : {}
  return clampFraming({
    mode: f.mode === 'fill' ? 'fill' : 'fit-blur',
    zoom: typeof f.zoom === 'number' ? f.zoom : 1,
    offsetX: typeof f.offsetX === 'number' ? f.offsetX : 0,
    offsetY: typeof f.offsetY === 'number' ? f.offsetY : 0,
  })
}

/** Imagen guardada (versión 2). Lo que no se entienda vuelve a lo de serie, sin perder el trozo. */
function parsePicture(raw: unknown, sourceHasVideo: boolean): Picture {
  if (!isObject(raw)) return defaultPicture(sourceHasVideo)
  if (raw.kind === 'none') return { kind: 'none' }
  if (raw.kind === 'cover' && typeof raw.sourcePath === 'string' && raw.sourcePath !== '' && typeof raw.sourceDurationMs === 'number' && raw.sourceDurationMs > 0) {
    const inset = isObject(raw.inset) ? { corner: raw.inset.corner as InsetCorner, size: raw.inset.size as InsetSize } : null
    return normalizePicture(
      {
        kind: 'cover',
        sourcePath: raw.sourcePath,
        sourceDurationMs: raw.sourceDurationMs,
        startMs: typeof raw.startMs === 'number' ? raw.startMs : 0,
        framing: parseFraming(raw.framing),
        quarterTurns: (typeof raw.quarterTurns === 'number' ? raw.quarterTurns : 0) as QuarterTurns,
        inset,
      },
      sourceHasVideo,
    )
  }
  return defaultPicture(sourceHasVideo)
}

function parseClip(raw: unknown, index: number, version: number): Clip {
  const fail = (what: string): never => {
    throw new ProjectFormatError(`El trozo ${index + 1} está dañado (${what}).`)
  }
  if (!isObject(raw)) return fail('no es un objeto')
  if (typeof raw.id !== 'string' || raw.id === '') fail('sin identificador')
  if (typeof raw.sourcePath !== 'string' || raw.sourcePath === '') fail('sin fichero original')
  if (typeof raw.sourceDurationMs !== 'number' || raw.sourceDurationMs <= 0) fail('sin duración')
  if (!Array.isArray(raw.segments)) fail('sin rangos')
  const sourceDurationMs = Math.round(raw.sourceDurationMs as number)
  const segments = normalizeSegments(
    (raw.segments as unknown[]).map((s) =>
      isObject(s) && typeof s.startMs === 'number' && typeof s.endMs === 'number'
        ? { startMs: s.startMs, endMs: s.endMs }
        : fail('rango no válido'),
    ),
    sourceDurationMs,
  )
  if (segments.length === 0) fail('sin rangos válidos')
  const speed = SPEEDS.includes(raw.speed as Speed) ? (raw.speed as Speed) : 1
  const turns = typeof raw.quarterTurns === 'number' ? ((((Math.round(raw.quarterTurns) % 4) + 4) % 4) as QuarterTurns) : 0
  const framing = parseFraming(raw.framing)
  // Migración 1 → 2: en la versión 1 todos los trozos eran vídeos con su imagen.
  const sourceHasVideo = version < 2 ? true : raw.sourceHasVideo !== false
  const picture = version < 2 ? defaultPicture(true) : parsePicture(raw.picture, sourceHasVideo)
  return {
    id: raw.id as string,
    sourcePath: raw.sourcePath as string,
    sourceDurationMs,
    sourceHasVideo,
    segments,
    speed,
    muted: raw.muted === true,
    quarterTurns: turns,
    framing,
    picture,
    // Antes de la 5 los trozos no aparecían ni desaparecían.
    fadeInMs: version >= 5 ? Math.max(0, Math.round(finiteOr(raw.fadeInMs, 0))) : 0,
    fadeOutMs: version >= 5 ? Math.max(0, Math.round(finiteOr(raw.fadeOutMs, 0))) : 0,
    fadeInEasing: isEasing(raw.fadeInEasing) ? raw.fadeInEasing : 'linear',
    fadeOutEasing: isEasing(raw.fadeOutEasing) ? raw.fadeOutEasing : 'linear',
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
