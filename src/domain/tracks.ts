// Pistas de sonidos y efectos: elementos colocados en el tiempo debajo de la fila de trozos.
//
// La fila de trozos sigue mandando: sin huecos, su orden y su duración son los del vídeo. Cada elemento va
// pegado a un trozo (o al principio del vídeo) y su tiempo absoluto se calcula a partir de la fila (ver
// ItemAnchor en project.ts). Aquí: resolver los tiempos, colocar sin solapes, mover, recortar, partir,
// duplicar, imanes y lo que hace falta para la vista previa. Todo puro e inmutable, en milisegundos.

import { effectiveFadeLengths, fadeGainAt, isEasing, type Easing } from './motion'
import {
  anchorAt,
  anchorTimeMs,
  clipOutputMs,
  MAX_ITEM_VOLUME,
  normalizeLook,
  type EffectLook,
  type ItemSource,
  type Project,
  type Track,
  type TrackItem,
  type TrackKind,
} from './project'

/** Un elemento no puede quedar más corto que esto en pantalla. */
export const MIN_ITEM_MS = 300
/** Lo que duraban la entrada y la salida suaves del interruptor de antes (ahora: Corta / Media / Larga). */
export const SOFT_FADE_MS: Record<TrackKind, number> = { sound: 1000, effect: 500 }
/** Lo que dura de serie una imagen fija. */
export const DEFAULT_STILL_MS = 4000

// ---------------------------------------------------------------------------
// Tiempos de la fila principal

/** Inicio y duración de cada trozo y duración total, para resolver los anclajes. */
export interface ProjectTiming {
  starts: number[]
  lengths: number[]
  totalMs: number
}

/**
 * Tiempos de la fila de trozos. Sin `lengths`, los de la vista previa (clipOutputMs); al guardar se pasan
 * los de los fotogramas enteros de cada trozo, para que cada sonido caiga donde cae su trozo en el fichero.
 */
export function projectTiming(project: Project, lengths: readonly number[] = project.clips.map(clipOutputMs)): ProjectTiming {
  const starts: number[] = []
  let acc = 0
  for (const len of lengths) {
    starts.push(acc)
    acc += len
  }
  return { starts, lengths: [...lengths], totalMs: acc }
}

// ---------------------------------------------------------------------------
// Duración y tiempos de un elemento

/** Lo que dura una vuelta del trozo del original que se repite. */
export function itemLoopMs(item: TrackItem): number {
  return Math.max(1, item.outMs - item.inMs)
}

/** ¿Su duración en pantalla se elige aparte (repite o es una imagen fija)? */
export function itemHasFreeLength(item: TrackItem): boolean {
  return item.repeat || item.still
}

/** Cuánto dura en pantalla si empieza en `startMs` (null en durationMs = hasta el final del vídeo). */
export function itemLengthMs(item: TrackItem, startMs: number, totalMs: number): number {
  if (itemHasFreeLength(item)) return item.durationMs === null ? Math.max(0, totalMs - startMs) : item.durationMs
  return item.outMs - item.inMs
}

export interface ResolvedItem {
  item: TrackItem
  track: Track
  trackIndex: number
  /** Dónde empieza y acaba en el vídeo (ms). Puede acabar después del final del vídeo. */
  startMs: number
  endMs: number
  /** Hasta dónde se ve o se oye (se corta al final del vídeo). */
  shownEndMs: number
}

export function itemStartMs(project: Project, item: TrackItem, timing: ProjectTiming = projectTiming(project)): number {
  return anchorTimeMs(project, item.anchor, timing.starts, timing.lengths)
}

function resolveOne(project: Project, track: Track, trackIndex: number, item: TrackItem, timing: ProjectTiming): ResolvedItem {
  const startMs = itemStartMs(project, item, timing)
  const endMs = startMs + itemLengthMs(item, startMs, timing.totalMs)
  return { item, track, trackIndex, startMs, endMs, shownEndMs: Math.min(endMs, timing.totalMs) }
}

/** Los elementos de una pista con su tiempo, ordenados por inicio. */
export function resolveTrack(project: Project, trackId: string, timing: ProjectTiming = projectTiming(project)): ResolvedItem[] {
  const trackIndex = project.tracks.findIndex((t) => t.id === trackId)
  const track = project.tracks[trackIndex]
  if (!track) return []
  return track.items.map((item) => resolveOne(project, track, trackIndex, item, timing)).sort((a, b) => a.startMs - b.startMs)
}

/** Todos los elementos con su tiempo (pista a pista, por inicio). */
export function resolveTracks(project: Project, timing: ProjectTiming = projectTiming(project)): ResolvedItem[] {
  return project.tracks.flatMap((t) => resolveTrack(project, t.id, timing))
}

/** Lo que se ve o se oye de verdad: sin pistas silenciadas u ocultas y sin lo que cae fuera del vídeo. */
export function audibleOrVisible(resolved: readonly ResolvedItem[]): ResolvedItem[] {
  return resolved.filter((r) => r.shownEndMs - r.startMs > 0 && !(r.track.kind === 'sound' ? r.track.muted : r.track.hidden))
}

/** Instante del original que suena o se ve a los `localMs` ms del principio del elemento. */
export function itemSourceTimeAt(item: TrackItem, localMs: number): number {
  if (item.still) return 0
  const t = Math.max(0, localMs)
  if (!item.repeat) return item.inMs + Math.min(t, item.outMs - item.inMs)
  return item.inMs + ((item.phaseMs + t) % itemLoopMs(item))
}

/** Entrada y salida que caben en esta duración (entre las dos, como mucho lo que dura). */
export function effectiveFades(item: TrackItem, lengthMs: number): { inMs: number; outMs: number } {
  return effectiveFadeLengths(item, lengthMs)
}

/** Factor de aparecer y desaparecer (0..1), con su curva, a los `localMs` ms de un elemento de `lengthMs`. */
export function itemFadeAt(item: TrackItem, localMs: number, lengthMs: number): number {
  return fadeGainAt(item, localMs, lengthMs)
}

/** Elementos que suenan o se ven en `t`, o que empiezan en los próximos `aheadMs` (para cargarlos antes). */
export function itemsAround(resolved: readonly ResolvedItem[], t: number, aheadMs = 0): ResolvedItem[] {
  return resolved.filter((r) => r.startMs <= t + aheadMs && r.shownEndMs > t)
}

// ---------------------------------------------------------------------------
// Pistas

export function tracksOfKind(project: Project, kind: TrackKind): Track[] {
  return project.tracks.filter((t) => t.kind === kind)
}

/** «Sonidos», «Sonidos 2»…; «Efectos», «Efectos 2»… (el primero libre). */
export function defaultTrackName(project: Project, kind: TrackKind): string {
  const base = kind === 'sound' ? 'Sonidos' : 'Efectos'
  const names = new Set(project.tracks.map((t) => t.name))
  if (!names.has(base)) return base
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`
}

export function createTrack(kind: TrackKind, id: string, name: string): Track {
  return { id, kind, name, muted: false, hidden: false, items: [] }
}

/**
 * Añade una pista (no hay límite: la vista de pistas se desplaza). Las de efectos van encima de las que ya
 * hay (lo nuevo se ve por encima); las de sonido, debajo de las de sonido.
 */
export function addTrack(project: Project, track: Track): Project {
  if (project.tracks.some((t) => t.id === track.id)) return project
  const tracks = project.tracks.slice()
  if (track.kind === 'effect') {
    const first = tracks.findIndex((t) => t.kind === 'effect')
    tracks.splice(first < 0 ? 0 : first, 0, track)
  } else {
    tracks.push(track)
  }
  return { ...project, tracks }
}

export function removeTrack(project: Project, trackId: string): Project {
  if (!project.tracks.some((t) => t.id === trackId)) return project
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) }
}

function updateTrack(project: Project, trackId: string, fn: (t: Track) => Track): Project {
  const i = project.tracks.findIndex((t) => t.id === trackId)
  if (i < 0) return project
  const next = fn(project.tracks[i]!)
  if (next === project.tracks[i]) return project
  const tracks = project.tracks.slice()
  tracks[i] = next
  return { ...project, tracks }
}

export function setTrackMuted(project: Project, trackId: string, muted: boolean): Project {
  return updateTrack(project, trackId, (t) => (t.kind !== 'sound' || t.muted === muted ? t : { ...t, muted }))
}

export function setTrackHidden(project: Project, trackId: string, hidden: boolean): Project {
  return updateTrack(project, trackId, (t) => (t.kind !== 'effect' || t.hidden === hidden ? t : { ...t, hidden }))
}

/** Nombre nuevo (sin espacios a los lados, hasta 40 letras; vacío no vale). */
export function renameTrack(project: Project, trackId: string, name: string): Project {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40)
  if (clean === '') return project
  return updateTrack(project, trackId, (t) => (t.name === clean ? t : { ...t, name: clean }))
}

/** Silencia (o no) el sonido de todos los trozos de la fila principal. */
export function setMainMuted(project: Project, mainMuted: boolean): Project {
  return project.mainMuted === mainMuted ? project : { ...project, mainMuted }
}

/** Lo que suena por su cuenta: la fila «Vídeo» (`'main'`) o una pista de sonido (su id). */
export type SoundRow = 'main' | string

function soundRowMuted(project: Project, row: SoundRow): boolean {
  return row === 'main' ? project.mainMuted : project.tracks.find((t) => t.id === row)?.muted ?? true
}

/** ¿Solo se oye esta fila? (ella suena y las demás de sonido, que las hay, están silenciadas). */
export function isSoloSound(project: Project, row: SoundRow): boolean {
  const others: SoundRow[] = ['main', ...tracksOfKind(project, 'sound').map((t) => t.id)].filter((r) => r !== row)
  return others.length > 0 && !soundRowMuted(project, row) && others.every((r) => soundRowMuted(project, r))
}

/**
 * «Escuchar solo esta»: la fila suena y las demás de sonido (la fila «Vídeo» incluida) se silencian, en un
 * solo cambio. Si ya era la única que sonaba, vuelven a sonar todas.
 */
export function toggleSoloSound(project: Project, row: SoundRow): Project {
  if (row !== 'main' && !project.tracks.some((t) => t.id === row && t.kind === 'sound')) return project
  const all = !isSoloSound(project, row)
  const mainMuted = all ? row !== 'main' : false
  const tracks = project.tracks.map((t) => {
    if (t.kind !== 'sound') return t
    const muted = all ? t.id !== row : false
    return t.muted === muted ? t : { ...t, muted }
  })
  const changed = mainMuted !== project.mainMuted || tracks.some((t, i) => t !== project.tracks[i])
  return changed ? { ...project, mainMuted, tracks } : project
}

// ---------------------------------------------------------------------------
// Elementos: crear y buscar

/** Valores de serie de un elemento (los de la biblioteca traen los suyos). */
export interface ItemDefaults {
  repeat?: boolean
  durationMs?: number | null
  volume?: number
  fadeInMs?: number
  fadeOutMs?: number
  fadeInEasing?: Easing
  fadeOutEasing?: Easing
  look?: Partial<Omit<EffectLook, 'box'>> & { box?: Partial<EffectLook['box']> }
}

export interface NewItem {
  id: string
  kind: TrackKind
  source: ItemSource
  name: string
  /** Duración del original (0 en una imagen fija). */
  sourceDurationMs: number
  still?: boolean
  hasAudio: boolean
  defaults?: ItemDefaults
}

/** Un elemento nuevo, aún sin sitio (su anclaje lo pone placeItem / insertItem). */
export function createItem(input: NewItem): TrackItem {
  const d = input.defaults ?? {}
  const still = input.kind === 'effect' && input.still === true
  const sourceDurationMs = still ? 0 : Math.max(0, Math.round(input.sourceDurationMs))
  const repeat = !still && d.repeat === true
  const freeLength = repeat || still
  let durationMs: number | null = null
  if (freeLength) {
    if (d.durationMs === null) durationMs = null
    else if (typeof d.durationMs === 'number') durationMs = Math.max(MIN_ITEM_MS, Math.round(d.durationMs))
    else durationMs = still ? DEFAULT_STILL_MS : Math.max(MIN_ITEM_MS, sourceDurationMs)
  }
  const look =
    input.kind === 'effect'
      ? normalizeLook({ mix: 'normal', opacity: 1, fit: still ? 'contain' : 'cover', ...d.look, box: { x: 0.5, y: 0.5, scale: 1, ...d.look?.box } })
      : null
  return {
    id: input.id,
    source: input.source,
    name: input.name,
    sourceDurationMs,
    still,
    hasAudio: !still && input.hasAudio,
    anchor: { clipId: null, offsetMs: 0 },
    inMs: 0,
    outMs: sourceDurationMs,
    phaseMs: 0,
    repeat,
    durationMs,
    volume: clampVolume(d.volume ?? (input.kind === 'sound' ? 1 : 0)),
    fadeInMs: Math.max(0, Math.round(d.fadeInMs ?? 0)),
    fadeOutMs: Math.max(0, Math.round(d.fadeOutMs ?? 0)),
    fadeInEasing: isEasing(d.fadeInEasing) ? d.fadeInEasing : 'linear',
    fadeOutEasing: isEasing(d.fadeOutEasing) ? d.fadeOutEasing : 'linear',
    look,
  }
}

function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(MAX_ITEM_VOLUME, Math.max(0, Math.round(v * 100) / 100)) : 1
}

export interface FoundItem {
  track: Track
  trackIndex: number
  item: TrackItem
  itemIndex: number
}

export function findItem(project: Project, itemId: string): FoundItem | null {
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex++) {
    const track = project.tracks[trackIndex]!
    const itemIndex = track.items.findIndex((i) => i.id === itemId)
    if (itemIndex >= 0) return { track, trackIndex, item: track.items[itemIndex]!, itemIndex }
  }
  return null
}

export function allItems(project: Project): TrackItem[] {
  return project.tracks.flatMap((t) => t.items)
}

/**
 * Anclaje para un elemento que empieza en `startMs`: el trozo que hay debajo; la música «de fondo» (repite
 * hasta el final y empieza en el 0) se pega al principio del vídeo y no se mueve al reordenar.
 */
export function anchorForItem(project: Project, item: TrackItem, startMs: number, timing: ProjectTiming = projectTiming(project)) {
  const t = Math.max(0, Math.round(startMs))
  if (t === 0 && item.repeat && item.durationMs === null) return { clipId: null, offsetMs: 0 }
  return anchorAt(project, t, timing.starts)
}

// ---------------------------------------------------------------------------
// Sitio en una pista (sin solapes)

/** Intervalos ocupados de una pista (sin `ignoreId`), ordenados. */
function occupied(project: Project, trackId: string, ignoreId: string | null, timing: ProjectTiming): { startMs: number; endMs: number }[] {
  return resolveTrack(project, trackId, timing)
    .filter((r) => r.item.id !== ignoreId)
    .map((r) => ({ startMs: r.startMs, endMs: r.endMs }))
}

const overlaps = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) => a.startMs < b.endMs && b.startMs < a.endMs

/** ¿Cabe [startMs, startMs + lengthMs) en la pista sin pisar nada? */
export function fitsAt(project: Project, trackId: string, startMs: number, lengthMs: number, ignoreId: string | null = null, timing = projectTiming(project)): boolean {
  const want = { startMs, endMs: startMs + lengthMs }
  return occupied(project, trackId, ignoreId, timing).every((o) => !overlaps(o, want))
}

/**
 * Primer sitio libre desde `startMs` para algo de `lengthMs`: si pisa a otro, se coloca a continuación (y
 * así hasta encontrar hueco). null si se iría más allá del final del vídeo.
 * `lengthOf` da la duración según dónde empiece (lo que dura «hasta el final» depende de eso).
 */
export function findFreeStart(
  project: Project,
  trackId: string,
  startMs: number,
  lengthOf: (start: number) => number,
  ignoreId: string | null = null,
  timing = projectTiming(project),
): number | null {
  const taken = occupied(project, trackId, ignoreId, timing)
  let start = Math.max(0, Math.round(startMs))
  for (let guard = 0; guard <= taken.length; guard++) {
    if (start >= timing.totalMs && timing.totalMs > 0) return null
    const want = { startMs: start, endMs: start + Math.max(1, lengthOf(start)) }
    const hit = taken.find((o) => overlaps(o, want))
    if (!hit) return start
    start = hit.endMs
  }
  return null
}

/** Pone el elemento (ya creado) en la pista, empezando en `startMs`, sin comprobar solapes. */
function putItem(project: Project, trackId: string, item: TrackItem, startMs: number, timing: ProjectTiming): Project {
  const placed = { ...item, anchor: anchorForItem(project, item, startMs, timing) }
  return updateTrack(project, trackId, (t) => ({ ...t, items: [...t.items.filter((i) => i.id !== item.id), placed] }))
}

/** Quita el elemento de donde esté. */
export function removeItem(project: Project, itemId: string): Project {
  const found = findItem(project, itemId)
  if (!found) return project
  return updateTrack(project, found.track.id, (t) => ({ ...t, items: t.items.filter((i) => i.id !== itemId) }))
}

export type InsertResult =
  | { ok: true; project: Project; trackId: string; startMs: number; newTrack: boolean; shifted: boolean }
  | { ok: false; reason: 'no-room' | 'empty-video' }

/**
 * «Poner aquí»: en `startMs`, en la primera pista del tipo con sitio; si no hay, en una pista nueva.
 * Con `trackId` (solo esa pista), si no cabe ahí, en el primer hueco a continuación. `newTrack` da el id y
 * el nombre de la pista que se crearía. Un solo cambio del proyecto.
 */
export function insertItem(
  project: Project,
  item: TrackItem,
  kind: TrackKind,
  startMs: number,
  newTrack: { id: string; name?: string },
  options: { trackId?: string; timing?: ProjectTiming } = {},
): InsertResult {
  const timing = options.timing ?? projectTiming(project)
  if (timing.totalMs <= 0) return { ok: false, reason: 'empty-video' }
  const start = Math.min(Math.max(0, Math.round(startMs)), Math.max(0, timing.totalMs - MIN_ITEM_MS))
  const lengthOf = (s: number) => itemLengthMs(item, s, timing.totalMs)
  const candidates = tracksOfKind(project, kind).filter((t) => !options.trackId || t.id === options.trackId)
  for (const t of candidates) {
    if (fitsAt(project, t.id, start, lengthOf(start), item.id, timing)) {
      return { ok: true, project: putItem(project, t.id, item, start, timing), trackId: t.id, startMs: start, newTrack: false, shifted: false }
    }
  }
  if (!options.trackId) {
    const withTrack = addTrack(project, createTrack(kind, newTrack.id, newTrack.name ?? defaultTrackName(project, kind)))
    return { ok: true, project: putItem(withTrack, newTrack.id, item, start, timing), trackId: newTrack.id, startMs: start, newTrack: true, shifted: false }
  }
  for (const t of candidates) {
    const free = findFreeStart(project, t.id, start, lengthOf, item.id, timing)
    if (free !== null) return { ok: true, project: putItem(project, t.id, item, free, timing), trackId: t.id, startMs: free, newTrack: false, shifted: true }
  }
  return { ok: false, reason: 'no-room' }
}

// ---------------------------------------------------------------------------
// Mover, recortar, partir, duplicar

export function updateItem(project: Project, itemId: string, fn: (item: TrackItem) => TrackItem): Project {
  const found = findItem(project, itemId)
  if (!found) return project
  const next = fn(found.item)
  if (next === found.item) return project
  return updateTrack(project, found.track.id, (t) => {
    const items = t.items.slice()
    items[found.itemIndex] = next
    return { ...t, items }
  })
}

/**
 * Mueve un elemento para que empiece en `startMs` (y, si se da, a otra pista del mismo tipo). Se vuelve a
 * pegar al trozo que hay debajo. Si pisa a otro, se coloca a continuación; null si no cabe.
 */
export function moveItem(project: Project, itemId: string, startMs: number, toTrackId?: string, timing = projectTiming(project)): Project | null {
  const found = findItem(project, itemId)
  if (!found) return null
  const target = toTrackId ? project.tracks.find((t) => t.id === toTrackId) : found.track
  if (!target || target.kind !== found.track.kind) return null
  const maxStart = Math.max(0, timing.totalMs - MIN_ITEM_MS)
  const want = Math.min(Math.max(0, Math.round(startMs)), maxStart)
  const lengthOf = (s: number) => itemLengthMs(found.item, s, timing.totalMs)
  const free = findFreeStart(project, target.id, want, lengthOf, itemId, timing)
  if (free === null) return null
  const without = target.id === found.track.id ? project : removeItem(project, itemId)
  return putItem(without, target.id, found.item, free, timing)
}

/** Vecinos en la pista: dónde acaba el de antes y dónde empieza el de después. */
function neighbours(project: Project, itemId: string, timing: ProjectTiming): { prevEnd: number; nextStart: number; self: ResolvedItem } | null {
  const found = findItem(project, itemId)
  if (!found) return null
  const list = resolveTrack(project, found.track.id, timing)
  const i = list.findIndex((r) => r.item.id === itemId)
  const self = list[i]!
  const prevEnd = list.slice(0, i).reduce((m, r) => Math.max(m, r.endMs), 0)
  const nextStart = list.slice(i + 1).reduce((m, r) => Math.min(m, r.startMs), Number.POSITIVE_INFINITY)
  return { prevEnd, nextStart, self }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/**
 * Recorta (o alarga, si se puede) el principio: el final se queda donde estaba. Sin repetir, se come el
 * original por delante; si repite, la vuelta sigue por donde iba.
 */
export function trimItemStart(project: Project, itemId: string, newStartMs: number, timing = projectTiming(project)): Project {
  const n = neighbours(project, itemId, timing)
  if (!n) return project
  const { item, startMs: s, endMs: e } = n.self
  let start = Math.round(Math.min(Math.max(newStartMs, n.prevEnd, 0), e - MIN_ITEM_MS))
  let next: TrackItem
  if (itemHasFreeLength(item)) {
    const delta = start - s
    next = {
      ...item,
      durationMs: item.durationMs === null ? null : e - start,
      phaseMs: item.repeat ? mod(item.phaseMs + delta, itemLoopMs(item)) : 0,
    }
  } else {
    const inMs = Math.min(Math.max(0, item.inMs + (start - s)), item.outMs - MIN_ITEM_MS)
    start = s + (inMs - item.inMs)
    next = { ...item, inMs }
  }
  if (start === s && next.inMs === item.inMs && next.durationMs === item.durationMs) return project
  next = { ...next, anchor: anchorForItem(project, next, start, timing) }
  return updateItem(project, itemId, () => next)
}

/**
 * Recorta o alarga el final: sin repetir, hasta el final del original; si repite (o es una imagen fija),
 * todo lo que se quiera (llegar al final del vídeo lo deja «hasta el final»). Nunca pisa al siguiente.
 */
export function trimItemEnd(project: Project, itemId: string, newEndMs: number, timing = projectTiming(project)): Project {
  const n = neighbours(project, itemId, timing)
  if (!n) return project
  const { item, startMs: s } = n.self
  const end = Math.round(Math.max(Math.min(newEndMs, n.nextStart), s + MIN_ITEM_MS))
  let next: TrackItem
  if (itemHasFreeLength(item)) {
    const untilEnd = end >= timing.totalMs && n.nextStart === Number.POSITIVE_INFINITY
    next = { ...item, durationMs: untilEnd ? null : end - s }
  } else {
    next = { ...item, outMs: Math.min(item.sourceDurationMs, Math.max(item.inMs + MIN_ITEM_MS, item.inMs + (end - s))) }
  }
  if (next.outMs === item.outMs && next.durationMs === item.durationMs) return project
  // Pasar a «hasta el final» desde el 0 lo convierte en música de fondo (pegada al principio del vídeo).
  next = { ...next, anchor: anchorForItem(project, next, s, timing) }
  return updateItem(project, itemId, () => next)
}

/** Parte un elemento en `atMs` (tiempo del vídeo). La segunda parte sigue por donde iba. */
export function splitItem(project: Project, itemId: string, atMs: number, newId: string, timing = projectTiming(project)): Project {
  const found = findItem(project, itemId)
  if (!found) return project
  const r = resolveOne(project, found.track, found.trackIndex, found.item, timing)
  const at = Math.round(atMs)
  if (at < r.startMs + MIN_ITEM_MS || at > r.shownEndMs - MIN_ITEM_MS) return project
  const item = found.item
  const elapsed = at - r.startMs
  const first: TrackItem = itemHasFreeLength(item)
    ? { ...item, durationMs: elapsed, fadeOutMs: 0 }
    : { ...item, outMs: item.inMs + elapsed, fadeOutMs: 0 }
  const restLength = item.durationMs === null ? null : r.endMs - at
  let second: TrackItem = itemHasFreeLength(item)
    ? { ...item, id: newId, durationMs: restLength, phaseMs: item.repeat ? mod(item.phaseMs + elapsed, itemLoopMs(item)) : 0, fadeInMs: 0 }
    : { ...item, id: newId, inMs: item.inMs + elapsed, fadeInMs: 0 }
  second = { ...second, look: item.look ? { ...item.look, box: { ...item.look.box } } : null, anchor: anchorForItem(project, second, at, timing) }
  return updateTrack(project, found.track.id, (t) => {
    const items = t.items.slice()
    items.splice(found.itemIndex, 1, first, second)
    return { ...t, items }
  })
}

export type DuplicateResult = { ok: true; project: Project; trackId: string; startMs: number } | { ok: false }

/**
 * Duplica un elemento justo detrás de él (en su pista o, si no cabe, en otra del mismo tipo o en una nueva).
 * Lo que dura «hasta el final» se duplica con lo que dura ahora.
 */
export function duplicateItem(project: Project, itemId: string, newId: string, newTrack: { id: string; name?: string }, timing = projectTiming(project)): DuplicateResult {
  const found = findItem(project, itemId)
  if (!found) return { ok: false }
  const r = resolveOne(project, found.track, found.trackIndex, found.item, timing)
  const length = r.shownEndMs - r.startMs
  const copy: TrackItem = {
    ...found.item,
    id: newId,
    durationMs: itemHasFreeLength(found.item) ? Math.max(MIN_ITEM_MS, length) : null,
    look: found.item.look ? { ...found.item.look, box: { ...found.item.look.box } } : null,
  }
  const start = r.endMs
  if (start > timing.totalMs - MIN_ITEM_MS) return { ok: false }
  // Primero su pista, luego las demás del mismo tipo, luego una nueva.
  const kind = found.track.kind
  const order = [found.track, ...tracksOfKind(project, kind).filter((t) => t.id !== found.track.id)]
  const lengthOf = (s: number) => itemLengthMs(copy, s, timing.totalMs)
  for (const t of order) {
    if (fitsAt(project, t.id, start, lengthOf(start), null, timing)) {
      return { ok: true, project: putItem(project, t.id, copy, start, timing), trackId: t.id, startMs: start }
    }
  }
  const res = insertItem(project, copy, kind, start, newTrack, { timing })
  return res.ok ? { ok: true, project: res.project, trackId: res.trackId, startMs: res.startMs } : { ok: false }
}

// ---------------------------------------------------------------------------
// Ajustes de un elemento

export function setItemVolume(project: Project, itemId: string, volume: number): Project {
  const v = clampVolume(volume)
  return updateItem(project, itemId, (i) => (i.volume === v ? i : { ...i, volume: v }))
}

/**
 * Cómo aparece o desaparece: una duración (0 = de golpe) y una curva. Con `true` / `false`, el interruptor de
 * antes («suave» lineal con la duración de su tipo, o de golpe).
 */
export function setItemFade(project: Project, itemId: string, which: 'in' | 'out', fade: boolean | { ms: number; easing: Easing }): Project {
  const found = findItem(project, itemId)
  if (!found) return project
  const choice = typeof fade === 'boolean' ? { ms: fade ? SOFT_FADE_MS[found.track.kind] : 0, easing: 'linear' as Easing } : fade
  const ms = Math.max(0, Math.round(Number.isFinite(choice.ms) ? choice.ms : 0))
  const easing: Easing = isEasing(choice.easing) ? choice.easing : 'linear'
  return updateItem(project, itemId, (i) => {
    if (which === 'in') return i.fadeInMs === ms && i.fadeInEasing === easing ? i : { ...i, fadeInMs: ms, fadeInEasing: easing }
    return i.fadeOutMs === ms && i.fadeOutEasing === easing ? i : { ...i, fadeOutMs: ms, fadeOutEasing: easing }
  })
}

/**
 * «Repetir»: al encenderlo, se repite hasta el final del vídeo (o hasta el siguiente de su pista); al
 * apagarlo, vuelve a durar lo que dura su original (sin pisar al siguiente).
 */
export function setItemRepeat(project: Project, itemId: string, repeat: boolean, timing = projectTiming(project)): Project {
  const n = neighbours(project, itemId, timing)
  if (!n) return project
  const { item, startMs: s } = n.self
  if (item.still || item.repeat === repeat) return project
  let next: TrackItem
  if (repeat) {
    // Un efecto repite su fichero entero (así no hay que guardar la vuelta en memoria al guardar el vídeo).
    const whole = n.self.track.kind === 'effect' ? { inMs: 0, outMs: item.sourceDurationMs } : {}
    next = { ...item, ...whole, repeat: true, phaseMs: 0, durationMs: Number.isFinite(n.nextStart) ? Math.max(MIN_ITEM_MS, n.nextStart - s) : null }
  } else {
    const room = Number.isFinite(n.nextStart) ? n.nextStart - s : Number.POSITIVE_INFINITY
    const natural = item.outMs - item.inMs
    next = { ...item, repeat: false, phaseMs: 0, durationMs: null, outMs: item.inMs + Math.max(MIN_ITEM_MS, Math.min(natural, room)) }
  }
  next = { ...next, anchor: anchorForItem(project, next, s, timing) }
  return updateItem(project, itemId, () => next)
}

/** Cambia cómo se ve un efecto (mezcla, transparencia, tamaño y sitio). */
export function setEffectLook(project: Project, itemId: string, change: Partial<Omit<EffectLook, 'box'>> & { box?: Partial<EffectLook['box']> }): Project {
  return updateItem(project, itemId, (i) => {
    if (!i.look) return i
    const look = normalizeLook({ ...i.look, ...change, box: { ...i.look.box, ...change.box } })
    return JSON.stringify(look) === JSON.stringify(i.look) ? i : { ...i, look }
  })
}

/** Tamaño y sitio de serie: centrado y a pantalla completa. */
export function resetEffectBox(project: Project, itemId: string): Project {
  return setEffectLook(project, itemId, { box: { x: 0.5, y: 0.5, scale: 1 } })
}

// ---------------------------------------------------------------------------
// Imanes

/** Puntos a los que se pegan los elementos al arrastrarlos: trozos, cabezal y los demás elementos. */
export function snapPoints(project: Project, playheadMs: number | null, excludeItemId: string | null, timing = projectTiming(project)): number[] {
  const points = new Set<number>([0, timing.totalMs])
  timing.starts.forEach((s) => points.add(s))
  if (playheadMs !== null) points.add(Math.round(playheadMs))
  for (const r of resolveTracks(project, timing)) {
    if (r.item.id === excludeItemId) continue
    points.add(r.startMs)
    points.add(r.endMs)
  }
  return [...points].sort((a, b) => a - b)
}

export interface Snapped {
  timeMs: number
  /** Dónde dibujar la línea guía (null si no se ha pegado a nada). */
  guideMs: number | null
}

/** Pega un instante al punto más cercano si está a menos de `thresholdMs`. */
export function snapTime(points: readonly number[], timeMs: number, thresholdMs: number): Snapped {
  let best: number | null = null
  for (const p of points) if (Math.abs(p - timeMs) <= thresholdMs && (best === null || Math.abs(p - timeMs) < Math.abs(best - timeMs))) best = p
  return best === null ? { timeMs, guideMs: null } : { timeMs: best, guideMs: best }
}

/** Al mover: se pega el principio o el final (lo que quede más cerca) de algo de `lengthMs`. */
export function snapMove(points: readonly number[], startMs: number, lengthMs: number, thresholdMs: number): Snapped {
  const byStart = snapTime(points, startMs, thresholdMs)
  const byEnd = snapTime(points, startMs + lengthMs, thresholdMs)
  const dStart = byStart.guideMs === null ? Infinity : Math.abs(byStart.timeMs - startMs)
  const dEnd = byEnd.guideMs === null ? Infinity : Math.abs(byEnd.timeMs - (startMs + lengthMs))
  if (dStart === Infinity && dEnd === Infinity) return { timeMs: startMs, guideMs: null }
  return dStart <= dEnd ? byStart : { timeMs: byEnd.timeMs - lengthMs, guideMs: byEnd.guideMs }
}

// ---------------------------------------------------------------------------
// Resúmenes para la interfaz

/** Rutas de fichero (no de la biblioteca) que usan las pistas. */
export function trackFilePaths(project: Project): string[] {
  return [...new Set(allItems(project).flatMap((i) => (i.source.type === 'file' ? [i.source.path] : [])))]
}

/** Ids de la biblioteca que usan las pistas. */
export function libraryAssetIds(project: Project): string[] {
  return [...new Set(allItems(project).flatMap((i) => (i.source.type === 'library' ? [i.source.assetId] : [])))]
}

/** Cuántos sonidos y efectos lleva pegados cada trozo (se ve en su bloque de la fila «Vídeo»). */
export function attachedCounts(project: Project): Map<string, { sounds: number; effects: number }> {
  const map = new Map<string, { sounds: number; effects: number }>()
  for (const t of project.tracks) {
    for (const i of t.items) {
      if (!i.anchor.clipId) continue
      const c = map.get(i.anchor.clipId) ?? { sounds: 0, effects: 0 }
      if (t.kind === 'sound') c.sounds++
      else c.effects++
      map.set(i.anchor.clipId, c)
    }
  }
  return map
}

/** «2 sonidos estaban pegados a este trozo: se quedan en el mismo sitio del vídeo». */
export function describeReanchored(counts: { sounds: number; effects: number }): string | null {
  const parts: string[] = []
  if (counts.sounds) parts.push(counts.sounds === 1 ? '1 sonido' : `${counts.sounds} sonidos`)
  if (counts.effects) parts.push(counts.effects === 1 ? '1 efecto' : `${counts.effects} efectos`)
  if (parts.length === 0) return null
  const total = counts.sounds + counts.effects
  return `${parts.join(' y ')} ${total === 1 ? 'estaba pegado' : 'estaban pegados'} a este trozo: se ${total === 1 ? 'queda' : 'quedan'} en el mismo sitio del vídeo.`
}
