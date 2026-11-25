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

export interface Clip {
  id: string
  sourcePath: string
  /** Duración del original, para no salirse al recortar. */
  sourceDurationMs: number
  /** Rangos del original que se conservan, ordenados y sin solape. Por defecto, uno. */
  segments: TimeRange[]
  speed: Speed
  muted: boolean
  quarterTurns: QuarterTurns
  framing: Framing
}

export const PROJECT_VERSION = 1 as const

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
  return {
    id,
    sourcePath: media.path,
    sourceDurationMs: Math.max(0, Math.round(media.durationMs)),
    segments: [{ startMs: 0, endMs: Math.max(0, Math.round(media.durationMs)) }],
    speed: 1,
    muted: false,
    quarterTurns: 0,
    framing: { ...DEFAULT_FRAMING },
  }
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
  const second: Clip = { ...clip, id: newId, segments: right, framing: { ...clip.framing } }
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

function sameSegments(a: readonly TimeRange[], b: readonly TimeRange[]): boolean {
  return a.length === b.length && a.every((s, i) => s.startMs === b[i]!.startMs && s.endMs === b[i]!.endMs)
}

/** Ancho y alto visibles del trozo tras aplicar sus giros. */
export function clipDisplaySize(clip: Clip, media: Pick<MediaInfo, 'width' | 'height'>): { width: number; height: number } {
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
  // Versión 1: no hay migraciones todavía.
  const p = data.project
  if (!isObject(p)) throw new ProjectFormatError('El proyecto no tiene contenido.')
  const aspect = ASPECT_RATIOS.includes(p.aspect as AspectRatio) ? (p.aspect as AspectRatio) : '16:9'
  if (!Array.isArray(p.clips)) throw new ProjectFormatError('El proyecto no tiene la lista de trozos.')
  const clips = p.clips.map((c, i) => parseClip(c, i))
  const target = typeof p.targetDurationMs === 'number' && p.targetDurationMs > 0 ? Math.round(p.targetDurationMs) : null
  return { version: PROJECT_VERSION, aspect, clips, targetDurationMs: target }
}

function parseClip(raw: unknown, index: number): Clip {
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
  const f = isObject(raw.framing) ? raw.framing : {}
  const framing = clampFraming({
    mode: f.mode === 'fill' ? 'fill' : 'fit-blur',
    zoom: typeof f.zoom === 'number' ? f.zoom : 1,
    offsetX: typeof f.offsetX === 'number' ? f.offsetX : 0,
    offsetY: typeof f.offsetY === 'number' ? f.offsetY : 0,
  })
  return {
    id: raw.id as string,
    sourcePath: raw.sourcePath as string,
    sourceDurationMs,
    segments,
    speed,
    muted: raw.muted === true,
    quarterTurns: turns,
    framing,
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
