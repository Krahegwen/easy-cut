// «Llevar a una esquina aquí» / «Volver a pantalla completa aquí»: el vídeo de un trozo que se encoge hasta una
// esquina (dejando ver el vídeo de fondo del trozo) y más adelante vuelve a llenar la pantalla. No es otro sistema:
// es un elemento «el vídeo de este trozo» en una pista de efectos con las mismas marcas de sitio y tamaño que una
// pegatina; aquí solo se crean las marcas por la persona. Puro e inmutable.

import { addMark, boxAt, setBoxAt } from './keyframes'
import { legacyInsetBox, type AspectRatio, type Clip, type EffectBox, type EffectLook, type Project, type Track, type TrackItem } from './project'
import { findClipVideoItem } from './project'
import { addTrack, createTrack, projectTiming } from './tracks'

/** Lo que tarda en ir a la esquina o volver (ms). */
export const CORNER_TRAVEL_MS = 800
/** El radio de las esquinas redondeadas, como fracción del lado corto del recuadro más pequeño. */
export const CORNER_RADIUS = 0.08
/** A partir de este tamaño se da por «a pantalla completa» (y no se redondean las esquinas). */
export const FULL_FRAME_SCALE = 0.98

/** La esquina de serie: abajo a la derecha, pequeña (como la de antes). */
export function cornerBox(aspect: AspectRatio): EffectBox {
  return legacyInsetBox({ corner: 'bottom-right', size: 'small' }, aspect)
}

export const FULL_BOX: EffectBox = { x: 0.5, y: 0.5, scale: 1 }

/** ¿Llena el marco? (centrado y a tamaño 1, o casi). */
export function isFullFrame(box: EffectBox): boolean {
  return box.scale >= FULL_FRAME_SCALE && Math.abs(box.x - 0.5) < 0.02 && Math.abs(box.y - 0.5) < 0.02
}

/**
 * Radio de las esquinas redondeadas (px de un marco de frameW × frameH): una fracción del lado corto del recuadro
 * en su tamaño más pequeño, el mismo todo el rato (como la esquina de antes). 0 si no se redondea.
 */
export function cornerRadius(look: Pick<EffectLook, 'rounded' | 'box' | 'keyframes'>, frameW: number, frameH: number): number {
  if (!look.rounded) return 0
  const scales = look.keyframes.length ? look.keyframes.map((k) => k.box.scale) : [look.box.scale]
  const s = Math.min(...scales)
  if (s >= FULL_FRAME_SCALE) return 0
  return CORNER_RADIUS * Math.min(frameW, frameH) * s
}

/** «El vídeo de este trozo», a pantalla completa y sin moverse. */
export function createClipVideoItem(clip: Clip, id: string): TrackItem {
  return {
    id,
    source: { type: 'clip', clipId: clip.id },
    name: 'Tu vídeo',
    sourceDurationMs: clip.sourceDurationMs,
    still: false,
    hasAudio: false,
    anchor: { clipId: clip.id, offsetMs: 0 },
    inMs: 0,
    outMs: clip.sourceDurationMs,
    phaseMs: 0,
    repeat: false,
    durationMs: null,
    volume: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    fadeInEasing: 'linear',
    fadeOutEasing: 'linear',
    look: { mix: 'normal', opacity: 1, box: { ...FULL_BOX }, fit: 'cover', keyframes: [], rounded: true },
  }
}

/**
 * Pone (o recoloca) «el vídeo de este trozo» quieto en `box`, en una pista de efectos debajo de las demás
 * (`ids.trackId`, que se crea si no existe). Sin marcas. El trozo tiene que tener imagen.
 */
export function putClipVideo(project: Project, clipId: string, box: EffectBox, ids: { itemId: string; trackId: string; trackName?: string }): Project {
  const clip = project.clips.find((c) => c.id === clipId)
  if (!clip || !clip.sourceHasVideo) return project
  const found = findClipVideoItem(project, clipId)
  if (found) {
    const look: EffectLook = { ...found.item.look!, box: { ...box }, keyframes: [] }
    return { ...project, tracks: project.tracks.map((t) => (t.id !== found.track.id ? t : { ...t, items: t.items.map((x) => (x.id === found.item.id ? { ...x, look } : x)) })) }
  }
  const item = createClipVideoItem(clip, ids.itemId)
  item.look = { ...item.look!, box: { ...box } }
  const existing = project.tracks.find((t) => t.id === ids.trackId)
  if (existing) return { ...project, tracks: project.tracks.map((t) => (t.id === ids.trackId ? { ...t, items: [...t.items, item] } : t)) }
  const track: Track = { ...createTrack('effect', ids.trackId, ids.trackName ?? 'Tu vídeo encima'), items: [item] }
  const lastEffect = project.tracks.map((t) => t.kind).lastIndexOf('effect')
  if (lastEffect < 0) return addTrack(project, track)
  const tracks = project.tracks.slice()
  tracks.splice(lastEffect + 1, 0, track)
  return { ...project, tracks }
}

export type CornerMove = 'to-corner' | 'to-full'

/** Qué hará el botón con la línea a `localMs` del trozo: si ahí llena la pantalla (o aún no hay), a la esquina. */
export function cornerMoveAt(project: Project, clipId: string, localMs: number): CornerMove {
  const found = findClipVideoItem(project, clipId)
  if (!found?.item.look) return 'to-corner'
  return isFullFrame(boxAt(found.item.look, localMs)) ? 'to-corner' : 'to-full'
}

/**
 * Pone «el vídeo de este trozo» (si no estaba) y las dos marcas que lo llevan, desde la línea y en
 * CORNER_TRAVEL_MS, a la esquina o a pantalla completa. Si el trozo se acaba antes, el viaje acaba con él.
 * Lo que hubiera entre las dos marcas se quita (si no, el viaje no sería el que se pide). El trozo tiene que
 * tener imagen y otro vídeo de fondo (lo que se verá detrás); null si no se puede.
 */
export function moveToCornerAt(
  project: Project,
  clipId: string,
  localMs: number,
  ids: { itemId: string; trackId: string; trackName?: string },
): { project: Project; move: CornerMove; itemId: string; atMs: number; untilMs: number } | null {
  const i = project.clips.findIndex((c) => c.id === clipId)
  const clip = project.clips[i]
  if (!clip || !clip.sourceHasVideo || clip.picture.kind !== 'cover') return null
  const len = projectTiming(project).lengths[i]!
  if (len < 400) return null
  let p = project
  let found = findClipVideoItem(p, clipId)
  if (!found) {
    // Una pista para él, debajo de las demás de efectos (lo de las otras se sigue viendo encima).
    const track: Track = { ...createTrack('effect', ids.trackId, ids.trackName ?? 'Tu vídeo encima'), items: [createClipVideoItem(clip, ids.itemId)] }
    const lastEffect = p.tracks.map((t) => t.kind).lastIndexOf('effect')
    if (lastEffect < 0) p = addTrack(p, track)
    else {
      const tracks = p.tracks.slice()
      tracks.splice(lastEffect + 1, 0, track)
      p = { ...p, tracks }
    }
    found = findClipVideoItem(p, clipId)!
  }
  const look = found.item.look!
  const move = isFullFrame(boxAt(look, localMs)) ? 'to-corner' : 'to-full'
  const to = move === 'to-corner' ? cornerBox(p.aspect) : { ...FULL_BOX }
  let a = Math.round(Math.min(Math.max(0, localMs), len))
  let b = Math.min(len, a + CORNER_TRAVEL_MS)
  if (b - a < 300) {
    b = len
    a = Math.max(0, b - CORNER_TRAVEL_MS)
  }
  let next: EffectLook = { ...look, keyframes: look.keyframes.filter((k) => k.atMs <= a + 1 || k.atMs >= b - 1) }
  next = addMark(next, a)
  next = setBoxAt(next, b, to)
  next = { ...next, keyframes: next.keyframes.map((k) => (Math.abs(k.atMs - b) <= 1 ? { ...k, easing: 'smooth' } : k)) }
  const itemId = found.item.id
  const tracks = p.tracks.map((t) => (t.id !== found!.track.id ? t : { ...t, items: t.items.map((x) => (x.id === itemId ? { ...x, look: next } : x)) }))
  return { project: { ...p, tracks }, move, itemId, atMs: a, untilMs: b }
}
