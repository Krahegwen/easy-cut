// Ficheros del proyecto («media pool»): cuántas veces se usa cada uno, qué se puede hacer con él en «De mi
// ordenador» y volver a enlazar un original que se ha movido (comparar con el de antes, cambiarlo en todos
// los sitios a la vez y buscar en la carpeta nueva los demás que faltaban de la misma carpeta). Puro.

import { formatDuration } from './durations'
import { baseName } from './file-name'
import {
  clipOutputMs,
  defaultPicture,
  maxCoverStartMs,
  mediaEntryFromInfo,
  MIN_PIECE_MS,
  MIN_SEGMENT_MS,
  normalizePicture,
  normalizeSegments,
  type Clip,
  type MediaEntry,
  type MediaInfo,
  type MediaKind,
  type Project,
  type TrackItem,
} from './project'

// ---------------------------------------------------------------------------
// Usos

export interface MediaUsage {
  /** Trozos de la fila «Vídeo» que lo usan como original. */
  clips: number
  /** Trozos que lo llevan como vídeo de encima. */
  covers: number
  /** Sonidos de las pistas. */
  sounds: number
  /** Efectos de las pistas. */
  effects: number
}

export const NO_USAGE: MediaUsage = Object.freeze({ clips: 0, covers: 0, sounds: 0, effects: 0 })

export function usageTotal(u: MediaUsage): number {
  return u.clips + u.covers + u.sounds + u.effects
}

/** Cuántas veces usa el proyecto cada fichero del ordenador (los que no se usan no salen). */
export function mediaUsage(project: Project): Map<string, MediaUsage> {
  const out = new Map<string, MediaUsage>()
  const bump = (path: string, key: keyof MediaUsage) => {
    const u = out.get(path) ?? { ...NO_USAGE }
    u[key] += 1
    out.set(path, u)
  }
  for (const c of project.clips) {
    bump(c.sourcePath, 'clips')
    if (c.picture.kind === 'cover') bump(c.picture.sourcePath, 'covers')
  }
  for (const t of project.tracks) {
    for (const i of t.items) if (i.source.type === 'file') bump(i.source.path, t.kind === 'sound' ? 'sounds' : 'effects')
  }
  return out
}

/** «Se usa 2 veces», «Se usa 1 vez», «Ahora no se usa». */
export function describeUsage(u: MediaUsage): string {
  const n = usageTotal(u)
  if (n === 0) return 'Ahora no se usa'
  return n === 1 ? 'Se usa 1 vez' : `Se usa ${n} veces`
}

const KIND_NAMES: Record<MediaKind, string> = { video: 'Vídeo', sound: 'Sonido', image: 'Imagen' }

/** «Vídeo · 1 min 20 s», «Sonido · 30 s», «Imagen». */
export function describeMediaEntry(entry: MediaEntry): string {
  return entry.kind === 'image' ? KIND_NAMES.image : `${KIND_NAMES[entry.kind]} · ${formatDuration(entry.durationMs)}`
}

/**
 * Qué se puede hacer con un fichero de la lista: un vídeo o un sonido pueden ser un trozo; un vídeo o una
 * imagen, un efecto encima; lo que tenga sonido (no una imagen), un sonido de una pista. Una imagen todavía no
 * puede ser un trozo.
 */
export function poolActions(entry: Pick<MediaEntry, 'kind' | 'hasAudio'>): { clip: boolean; effect: boolean; sound: boolean } {
  return {
    clip: entry.kind !== 'image',
    effect: entry.kind !== 'sound',
    sound: entry.kind !== 'image' && entry.hasAudio,
  }
}

/** Lista de ficheros para «De mi ordenador»: lo último que se trajo, primero. */
export function poolForDisplay(project: Project): MediaEntry[] {
  return project.media.slice().reverse()
}

// ---------------------------------------------------------------------------
// Volver a enlazar un original que se ha movido

/** Diferencia de duración que no cuenta (una copia vuelta a guardar no dura exactamente lo mismo). */
export function durationToleranceMs(durationMs: number): number {
  return Math.max(300, Math.round(durationMs * 0.02))
}

const KIND_ARTICLE: Record<MediaKind, string> = { video: 'un vídeo', sound: 'un sonido', image: 'una imagen' }

/**
 * Qué no cuadra entre el fichero de antes (lo guardado en la lista) y el elegido para sustituirlo, en
 * frases llanas. Vacío si cuadra. Se comparan el tipo, la duración, el tamaño de la imagen y si tiene sonido
 * (estas dos, solo si lo de antes se llegó a medir).
 */
export function compareMedia(before: MediaEntry, after: MediaInfo): string[] {
  const next = mediaEntryFromInfo(after)
  const out: string[] = []
  if (next.kind !== before.kind) out.push(`Es ${KIND_ARTICLE[next.kind]} y el de antes era ${KIND_ARTICLE[before.kind]}.`)
  if (next.kind !== 'image' && before.kind !== 'image' && before.durationMs > 0) {
    const diff = next.durationMs - before.durationMs
    if (Math.abs(diff) > durationToleranceMs(before.durationMs)) {
      const a = formatDuration(next.durationMs)
      const b = formatDuration(before.durationMs)
      out.push(a === b ? `Dura un poco ${diff > 0 ? 'más' : 'menos'} que el de antes.` : `Dura ${a} y el de antes duraba ${b}.`)
    }
  }
  if (before.probed && before.hasVideo && next.hasVideo && before.width > 0 && (before.width !== next.width || before.height !== next.height)) {
    out.push(`La imagen es de ${next.width} × ${next.height} y la de antes era de ${before.width} × ${before.height}.`)
  }
  if (before.probed && next.kind !== 'image' && before.kind !== 'image' && before.hasAudio !== next.hasAudio) {
    out.push(next.hasAudio ? 'Tiene sonido y el de antes no.' : 'No tiene sonido y el de antes sí.')
  }
  return out
}

/**
 * ¿Vale este fichero para todos los sitios donde se usa el de antes? Un trozo necesita un vídeo o un sonido;
 * un vídeo de encima, un vídeo; un sonido de una pista, algo con sonido; un efecto, un vídeo o una imagen.
 * Devuelve la frase que lo explica, o null si vale.
 */
export function relinkProblem(usage: MediaUsage, info: MediaInfo): string | null {
  const kind = mediaEntryFromInfo(info).kind
  if (usage.clips > 0 && kind === 'image') return 'Una imagen no puede ser un trozo del vídeo: elige un vídeo o un sonido.'
  if (usage.covers > 0 && kind !== 'video') return 'Para el vídeo de encima hace falta un vídeo.'
  if (usage.sounds > 0 && (kind === 'image' || !info.hasAudio)) return 'Ese fichero no tiene sonido: elige uno que lo tenga.'
  if (usage.effects > 0 && kind === 'sound') return 'Un sonido no se puede ver encima del vídeo: elige un vídeo o una imagen.'
  return null
}

function relinkClip(clip: Clip, info: MediaInfo): Clip {
  const duration = Math.max(0, Math.round(info.durationMs))
  const hasVideo = info.hasVideo !== false
  let segments = normalizeSegments(clip.segments, duration)
  if (segments.length === 0 || clipOutputMs({ ...clip, segments }) < MIN_PIECE_MS) segments = [{ startMs: 0, endMs: duration }]
  return {
    ...clip,
    sourcePath: info.path,
    sourceDurationMs: duration,
    sourceHasVideo: hasVideo,
    segments,
    picture: normalizePicture(clip.picture, hasVideo),
  }
}

function relinkCover(clip: Clip, info: MediaInfo): Clip {
  if (clip.picture.kind !== 'cover') return clip
  if (!info.hasVideo || info.isStill) return { ...clip, picture: defaultPicture(clip.sourceHasVideo) }
  const duration = Math.max(0, Math.round(info.durationMs))
  return {
    ...clip,
    picture: { ...clip.picture, sourcePath: info.path, sourceDurationMs: duration, startMs: Math.min(clip.picture.startMs, maxCoverStartMs(duration)) },
  }
}

function relinkItem(item: TrackItem, info: MediaInfo): TrackItem {
  const still = info.isStill === true
  const duration = still ? 0 : Math.max(0, Math.round(info.durationMs))
  const base = { ...item, source: { type: 'file' as const, path: info.path }, sourceDurationMs: duration, still, hasAudio: !still && info.hasAudio }
  if (still) return { ...base, inMs: 0, outMs: 0, phaseMs: 0, repeat: false, durationMs: item.still ? item.durationMs : null }
  if (item.still) return { ...base, inMs: 0, outMs: duration, phaseMs: 0, repeat: false, durationMs: null }
  let inMs = Math.min(item.inMs, duration)
  let outMs = Math.min(item.outMs, duration)
  if (outMs - inMs < MIN_SEGMENT_MS) {
    inMs = 0
    outMs = duration
  }
  return { ...base, inMs, outMs, phaseMs: Math.min(item.phaseMs, Math.max(0, outMs - inMs - 1)) }
}

/**
 * Cambia un fichero por otro en todos los sitios donde se usa (trozos, vídeos de encima y pistas),
 * conservando todo lo demás. Si el nuevo dura menos, lo que se usaba se recorta a lo que hay (y si no
 * quedara nada, se usa entero). La entrada de la lista de ficheros pasa a ser la del nuevo, en el mismo
 * sitio. Devuelve el mismo objeto si el fichero no se usa ni está en la lista.
 */
export function relinkMedia(project: Project, oldPath: string, info: MediaInfo): Project {
  const inPool = project.media.some((m) => m.path === oldPath)
  let touched = false
  const clips = project.clips.map((c) => {
    let next = c
    if (c.sourcePath === oldPath) next = relinkClip(next, info)
    if (c.picture.kind === 'cover' && c.picture.sourcePath === oldPath) next = relinkCover(next, info)
    if (next !== c) touched = true
    return next
  })
  const tracks = project.tracks.map((t) => {
    let changed = false
    const items = t.items.map((i) => {
      if (i.source.type !== 'file' || i.source.path !== oldPath) return i
      changed = true
      return relinkItem(i, info)
    })
    if (!changed) return t
    touched = true
    return { ...t, items }
  })
  if (!touched && !inPool) return project
  const entry = mediaEntryFromInfo(info)
  const media: MediaEntry[] = []
  let placed = false
  for (const m of project.media) {
    if (m.path === oldPath || m.path === info.path) {
      if (!placed) media.push(entry)
      placed = true
    } else {
      media.push(m)
    }
  }
  if (!placed) media.push(entry)
  return { ...project, clips, tracks, media }
}

/** Carpeta de una ruta de Windows o POSIX: «C:\a\b\toma.mp4» → «C:\a\b» (vacío si no tiene). */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i < 0 ? '' : path.slice(0, i)
}

function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').normalize('NFC').toLocaleLowerCase('es')
  return norm(a) === norm(b)
}

/**
 * Tras encontrar `oldPath` en `newPath`: los demás ficheros que faltan y estaban en la misma carpeta que él,
 * con dónde estarían en la carpeta nueva (mismo nombre de fichero). Si la carpeta no ha cambiado, ninguno.
 */
export function siblingCandidates(missingPaths: readonly string[], oldPath: string, newPath: string): { oldPath: string; newPath: string }[] {
  const oldFolder = folderOf(oldPath)
  const newFolder = folderOf(newPath)
  if (sameFolder(oldFolder, newFolder)) return []
  const sep = newPath.includes('\\') || !newPath.includes('/') ? '\\' : '/'
  const out: { oldPath: string; newPath: string }[] = []
  const seen = new Set<string>()
  for (const p of missingPaths) {
    if (p === oldPath || seen.has(p) || !sameFolder(folderOf(p), oldFolder)) continue
    seen.add(p)
    out.push({ oldPath: p, newPath: `${newFolder}${sep}${baseName(p)}` })
  }
  return out
}
