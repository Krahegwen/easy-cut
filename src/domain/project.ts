// Modelo del proyecto y operaciones inmutables sobre él.
// Todos los tiempos son milisegundos enteros. Nada de DOM ni de Node aquí.

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
}

/** Versión 2: los trozos llevan `picture` y `sourceHasVideo` (la 1 se migra al leerla). */
export const PROJECT_VERSION = 2 as const

export interface Project {
  version: typeof PROJECT_VERSION
  aspect: AspectRatio
  clips: Clip[]
  /** Duración objetivo opcional («que no pase de 5 minutos»). */
  targetDurationMs: number | null
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
  return { version: PROJECT_VERSION, aspect, clips: [], targetDurationMs: null }
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

export function removeClip(project: Project, clipId: string): Project {
  if (!project.clips.some((c) => c.id === clipId)) return project
  return { ...project, clips: project.clips.filter((c) => c.id !== clipId) }
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
 */
export function setInOut(
  project: Project,
  clipId: string,
  change: { inMs?: number; outMs?: number },
): Project {
  return updateClip(project, clipId, (clip) => {
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

  const first: Clip = { ...clip, segments: left }
  // El vídeo de encima corre en tiempo de salida: la segunda parte sigue donde iba.
  const second: Clip = {
    ...clip,
    id: newId,
    segments: right,
    framing: { ...clip.framing },
    picture: shiftPicture(clip.picture, clipOutputMs(first)),
  }
  const clips = project.clips.slice()
  clips.splice(index, 1, first, second)
  return { ...project, clips }
}

export function setSpeed(project: Project, clipId: string, speed: Speed): Project {
  if (!SPEEDS.includes(speed)) return project
  return updateClip(project, clipId, (clip) => (clip.speed === speed ? clip : { ...clip, speed }))
}

export function setMuted(project: Project, clipId: string, muted: boolean): Project {
  return updateClip(project, clipId, (clip) => (clip.muted === muted ? clip : { ...clip, muted }))
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
// Serialización

export const PROJECT_FILE_APP = 'easy-cut'

interface ProjectFile {
  app: typeof PROJECT_FILE_APP
  version: number
  project: Omit<Project, 'version'>
}

export function serializeProject(project: Project): string {
  const file: ProjectFile = {
    app: PROJECT_FILE_APP,
    version: PROJECT_VERSION,
    project: { aspect: project.aspect, clips: project.clips, targetDurationMs: project.targetDurationMs },
  }
  return JSON.stringify(file, null, 2)
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
  return { version: PROJECT_VERSION, aspect, clips, targetDurationMs: target }
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
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
