// Transiciones entre trozos: cómo entra cada trozo desde el anterior. Puro, en milisegundos (o en las unidades que
// se pidan al resolver: fotogramas al guardar el vídeo, muestras en «Solo el sonido»).
//
// Dos familias:
// - Con solape («montar un trozo sobre el anterior»): el trozo entra mientras el anterior aún se ve; el vídeo se
//   acorta lo que dura el paso. Fundido, deslizar, empujar, zoom y también a negro / a blanco.
// - Sin solape (los trozos solo se tocan; la duración no cambia): solo a negro y a blanco; la mitad del paso va al
//   final del anterior y la otra mitad al principio del siguiente.
// Nunca se usa material del original fuera de lo recortado: el solape sale de lo que ya dura cada trozo.
//
// Se guarda lo pedido y se limita al resolver (como los offsets de los anclajes): al alargar el trozo, vuelve.
// Todas van «Al mismo ritmo» (las de xfade no admiten curva sin una expresión por píxel, muy lenta).

import { FADE_DURATIONS, type Fades } from './motion'

export type TransitionKind = 'dissolve' | 'dip-black' | 'dip-white' | 'cover' | 'push' | 'zoom'
/** En el orden del desplegable (teclas 1–6; el 7 es «Corte seco»). */
export const TRANSITION_KINDS: readonly TransitionKind[] = ['dissolve', 'dip-black', 'dip-white', 'cover', 'push', 'zoom']

/** Cómo entra un trozo desde el anterior. `overlap` solo puede ser false en a negro / a blanco. */
export interface ClipEntry {
  kind: TransitionKind
  /** Lo que se ha pedido (ms). El paso real puede ser más corto si no cabe (ver resolveJoins). */
  durationMs: number
  overlap: boolean
}

export const MIN_TRANSITION_MS = 200
export const MAX_TRANSITION_MS = 3000
/** Las tres duraciones (las mismas que aparecer y desaparecer). */
export const TRANSITION_DURATIONS = FADE_DURATIONS
/** Hasta dónde se acerca el trozo que sale en «Zoom». */
export const ZOOM_MAX_SCALE = 1.3

export const TRANSITION_LABELS: Record<TransitionKind, { label: string; hint: string }> = {
  dissolve: { label: 'Fundido', hint: 'Un trozo se funde en el otro' },
  'dip-black': { label: 'A negro', hint: 'Se va a negro y sale el siguiente' },
  'dip-white': { label: 'A blanco', hint: 'Se va a blanco y sale el siguiente' },
  cover: { label: 'Deslizar', hint: 'El siguiente entra deslizándose por encima' },
  push: { label: 'Empujar', hint: 'El siguiente empuja al anterior hacia un lado' },
  zoom: { label: 'Zoom', hint: 'Se acerca y se funde en el siguiente' },
}

export function isTransitionKind(v: unknown): v is TransitionKind {
  return TRANSITION_KINDS.includes(v as TransitionKind)
}

/** ¿Es «a negro» o «a blanco» (los únicos que pueden ir sin solape)? */
export function isDip(kind: TransitionKind): kind is 'dip-black' | 'dip-white' {
  return kind === 'dip-black' || kind === 'dip-white'
}

/** Qué tipos valen con o sin solape. */
export function kindsFor(overlap: boolean): TransitionKind[] {
  return overlap ? [...TRANSITION_KINDS] : ['dip-black', 'dip-white']
}

/** Duración pedida, entre los límites. */
export function clampTransitionMs(ms: number): number {
  const v = Math.round(Number.isFinite(ms) ? ms : FADE_DURATIONS.medium)
  return Math.min(MAX_TRANSITION_MS, Math.max(MIN_TRANSITION_MS, v))
}

/**
 * Una entrada válida: duración entre los límites y, si no es a negro / a blanco, siempre con solape. Sin `overlap`,
 * a negro / a blanco van sin solape (lo de serie) y el resto con solape.
 */
export function makeEntry(kind: TransitionKind, durationMs: number = FADE_DURATIONS.medium, overlap?: boolean): ClipEntry {
  return { kind, durationMs: clampTransitionMs(durationMs), overlap: isDip(kind) ? overlap === true : true }
}

/** Lee una entrada guardada; lo que no se entienda es un corte seco (null), sin tirar el proyecto. */
export function parseEntry(raw: unknown): ClipEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!isTransitionKind(r.kind)) return null
  if (typeof r.durationMs !== 'number' || !Number.isFinite(r.durationMs)) return null
  return makeEntry(r.kind, r.durationMs, r.overlap === true)
}

export function sameEntry(a: ClipEntry | null, b: ClipEntry | null): boolean {
  if (a === null || b === null) return a === b
  return a.kind === b.kind && a.durationMs === b.durationMs && a.overlap === b.overlap
}

// ---------------------------------------------------------------------------
// Resolver: el paso de verdad de cada junta, con lo que cabe

/** Lo que hace falta de cada trozo para resolver sus juntas, en las unidades que se quieran. */
export interface JoinInput {
  entry: ClipEntry | null
  /** Lo que dura el trozo (unidades). */
  length: number
  /** Lo que dura su primer rango conservado (unidades de salida; con pausas quitadas, menos que el trozo). */
  firstRange: number
}

/**
 * Una junta resuelta (entre el trozo i − 1 y el i), en unidades. Con solape, el paso son los `overlap` últimos del
 * anterior, que se ven a la vez que los `overlap` primeros del siguiente. Sin solape, `tail` al final del anterior
 * (hacia el color) y `head` al principio del siguiente (desde el color).
 */
export interface ResolvedJoin {
  kind: TransitionKind
  overlap: boolean
  /** Lo pedido (unidades). */
  requested: number
  /** Lo que dura el paso (unidades): overlap, o tail + head. */
  duration: number
  overlapUnits: number
  tail: number
  head: number
  /** ¿Es más corto que lo pedido (no cabe)? */
  shrunk: boolean
}

const EPS = 1e-6

/**
 * Resuelve las juntas de izquierda a derecha. Con solape: no más que lo pedido, no más que lo que queda del anterior
 * tras su propia entrada (así nunca se ven tres trozos a la vez: ov[i] + ov[i+1] ≤ len[i]) y no más que el primer
 * rango del que entra (la vista previa lo reproduce seguido, sin saltos). Sin solape: la mitad a cada lado, con lo que
 * quede. Si no cabe ni MIN_TRANSITION_MS, corte seco. El trozo 0 no tiene junta (su entrada se ignora sin borrarla).
 * `unitsPerMs`: 1 en ms, F/1000 en fotogramas, 48 en muestras.
 */
export function resolveJoins(inputs: readonly JoinInput[], unitsPerMs = 1): (ResolvedJoin | null)[] {
  const out: (ResolvedJoin | null)[] = inputs.map(() => null)
  const minUnits = Math.max(1, Math.round(MIN_TRANSITION_MS * unitsPerMs))
  // Lo que ya usa del principio de cada trozo su propia entrada.
  let usedStart = 0
  for (let i = 1; i < inputs.length; i++) {
    const a = inputs[i - 1]!
    const b = inputs[i]!
    const e = b.entry
    const availA = Math.floor(Math.max(0, a.length - usedStart) + EPS)
    usedStart = 0
    if (!e) continue
    const requested = Math.round(clampTransitionMs(e.durationMs) * unitsPerMs)
    if (e.overlap || !isDip(e.kind)) {
      const d = Math.min(requested, availA, Math.floor(b.firstRange + EPS), Math.floor(b.length + EPS))
      if (d < minUnits) continue
      out[i] = { kind: e.kind, overlap: true, requested, duration: d, overlapUnits: d, tail: 0, head: 0, shrunk: d < requested }
      usedStart = d
    } else {
      const h = Math.min(Math.floor(requested / 2), availA, Math.floor(b.length + EPS))
      if (h * 2 < minUnits) continue
      out[i] = { kind: e.kind, overlap: false, requested, duration: h * 2, overlapUnits: 0, tail: h, head: h, shrunk: h * 2 < requested }
      usedStart = h
    }
  }
  return out
}

/** Lo mismo en ms a partir de unidades (para la línea de tiempo). */
export function joinToMs(j: ResolvedJoin, unitsPerMs: number): ResolvedJoin {
  if (unitsPerMs === 1) return j
  const f = (u: number) => u / unitsPerMs
  return { ...j, requested: f(j.requested), duration: f(j.duration), overlapUnits: f(j.overlapUnits), tail: f(j.tail), head: f(j.head) }
}

/**
 * Cómo aparece y desaparece un trozo con transiciones: en un borde con transición manda la transición (su aparecer
 * o desaparecer de ese lado no cuenta).
 */
export function edgeFades<F extends Fades>(fades: F, entry: ResolvedJoin | null, exit: ResolvedJoin | null): Fades {
  return {
    fadeInMs: entry ? 0 : fades.fadeInMs,
    fadeOutMs: exit ? 0 : fades.fadeOutMs,
    fadeInEasing: fades.fadeInEasing,
    fadeOutEasing: fades.fadeOutEasing,
  }
}

/**
 * Aparecer y desaparecer de un trozo con las juntas sin solape (a negro / a blanco): su sonido baja al final y sube
 * al principio, «Al mismo ritmo», lo que dura cada mitad del paso. Donde no hay junta, lo del trozo; con solape, nada
 * (el sonido se cruza en el paso). En ms.
 */
export function dipFades(fades: Fades, entry: ResolvedJoin | null, exit: ResolvedJoin | null): Fades {
  const f = edgeFades(fades, entry, exit)
  return {
    fadeInMs: entry && !entry.overlap ? entry.head : f.fadeInMs,
    fadeOutMs: exit && !exit.overlap ? exit.tail : f.fadeOutMs,
    fadeInEasing: entry && !entry.overlap ? 'linear' : f.fadeInEasing,
    fadeOutEasing: exit && !exit.overlap ? 'linear' : f.fadeOutEasing,
  }
}

/**
 * «El vídeo de este trozo» en un paso: el del que sale se desvanece y el del que entra aparece, sea cual sea el tipo,
 * lo que dura el paso por su lado («Al mismo ritmo»). En ms.
 */
export function clipVideoJoinFades(entry: ResolvedJoin | null, exit: ResolvedJoin | null): Fades {
  const side = (j: ResolvedJoin | null, which: 'in' | 'out') => (!j ? 0 : j.overlap ? j.overlapUnits : which === 'in' ? j.head : j.tail)
  return { fadeInMs: side(entry, 'in'), fadeOutMs: side(exit, 'out'), fadeInEasing: 'linear', fadeOutEasing: 'linear' }
}

// ---------------------------------------------------------------------------
// Cómo se ve cada instante del paso (vista previa; el fichero sigue las mismas fórmulas)

/** Una capa (el trozo que sale o el que entra) en un instante del paso. */
export interface JoinLayer {
  visible: boolean
  opacity: number
  /** Desplazamiento horizontal, en anchos del marco (+ a la derecha). */
  shiftX: number
  /** Tamaño respecto al centro del marco. */
  scale: number
  /** Volumen de su sonido (0..1). */
  volume: number
}

export interface JoinStyle {
  /** Avance del paso (0..1). */
  progress: number
  out: JoinLayer
  in: JoinLayer
  /** Color de encima (a negro / a blanco) y su opacidad. */
  color: 'black' | 'white' | null
  colorOpacity: number
}

const SHOWN: JoinLayer = { visible: true, opacity: 1, shiftX: 0, scale: 1, volume: 1 }
const HIDDEN: JoinLayer = { visible: false, opacity: 0, shiftX: 0, scale: 1, volume: 0 }

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
}

/**
 * Estilo de un paso CON solape en el avance p (0 al empezar el paso, 1 al acabar). Es lo que hace xfade con el
 * avance P = 1 − p (fade, coverleft, slideleft) y, en zoom y a negro / a blanco, lo que se hace a mano al guardar.
 * El que entra va encima. El sonido se cruza todo el paso.
 */
export function overlapStyleAt(kind: TransitionKind, progress: number): JoinStyle {
  const p = clamp01(progress)
  const out: JoinLayer = { ...SHOWN, volume: 1 - p }
  const inn: JoinLayer = { ...SHOWN, volume: p }
  switch (kind) {
    case 'dissolve':
      return { progress: p, out, in: { ...inn, opacity: p }, color: null, colorOpacity: 0 }
    case 'cover':
      return { progress: p, out, in: { ...inn, shiftX: 1 - p }, color: null, colorOpacity: 0 }
    case 'push':
      return { progress: p, out: { ...out, shiftX: -p }, in: { ...inn, shiftX: 1 - p }, color: null, colorOpacity: 0 }
    case 'zoom':
      return { progress: p, out: { ...out, scale: 1 + (ZOOM_MAX_SCALE - 1) * p }, in: { ...inn, opacity: p }, color: null, colorOpacity: 0 }
    default: {
      // A negro / a blanco montados: la primera mitad, el anterior hacia el color; la segunda, el siguiente desde él.
      const color = kind === 'dip-white' ? 'white' : 'black'
      if (p < 0.5) return { progress: p, out, in: { ...HIDDEN, volume: p }, color, colorOpacity: 2 * p }
      return { progress: p, out: { ...HIDDEN, volume: 1 - p }, in: inn, color, colorOpacity: 2 * (1 - p) }
    }
  }
}

/**
 * Estilo de una junta en el instante `t` (ms del vídeo), con `startMs` el principio del trozo que entra. null si
 * `t` cae fuera del paso. Sin solape: antes de startMs solo se ve el anterior, yendo al color; después, el siguiente
 * saliendo de él (el avance es el del paso entero).
 */
export function joinStyleAt(join: ResolvedJoin, startMs: number, t: number): JoinStyle | null {
  if (join.overlap) {
    if (t < startMs || t > startMs + join.overlapUnits) return null
    return overlapStyleAt(join.kind, (t - startMs) / Math.max(1, join.overlapUnits))
  }
  const color = join.kind === 'dip-white' ? 'white' : 'black'
  if (t < startMs - join.tail || t > startMs + join.head) return null
  const progress = clamp01((t - (startMs - join.tail)) / Math.max(1, join.duration))
  if (t < startMs) {
    const q = clamp01((t - (startMs - join.tail)) / Math.max(1, join.tail))
    return { progress, out: { ...SHOWN, volume: 1 - q }, in: HIDDEN, color, colorOpacity: q }
  }
  const q = clamp01((t - startMs) / Math.max(1, join.head))
  return { progress, out: HIDDEN, in: { ...SHOWN, volume: q }, color, colorOpacity: 1 - q }
}

// ---------------------------------------------------------------------------
// Textos

/** «0,5 s», «1 s», «1,5 s». */
export function formatTransitionSeconds(ms: number): string {
  const s = Math.round(ms / 100) / 10
  return `${String(s).replace('.', ',')} s`
}

/** Cómo se describe una entrada en llano: «Fundido de 1 s», «A negro de 0,5 s, sin acortar el vídeo». */
export function describeEntry(entry: ClipEntry | null, effectiveMs?: number): string {
  if (!entry) return 'Corte seco'
  const ms = effectiveMs ?? entry.durationMs
  const base = `${TRANSITION_LABELS[entry.kind].label} de ${formatTransitionSeconds(ms)}`
  return isDip(entry.kind) && !entry.overlap ? `${base}, sin acortar el vídeo` : base
}
