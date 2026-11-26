// Marcas de sitio y tamaño de un efecto: colocarlo en un momento, colocarlo en otro, y que viaje de uno a otro con
// la curva elegida (las mismas palabras que al aparecer y desaparecer). Es el sistema de motion.ts aplicado a x, y
// y el tamaño. Las marcas van en tiempo del elemento (ms desde su principio). Puro e inmutable.

import { valueAt, valueExpr, type MotionEasing, type TimedValue } from './motion'
import { normalizeBox, type BoxKeyframe, type EffectBox, type EffectLook } from './project'

/** Una marca está «en la línea» si la línea cae a menos de esto de ella (ms). */
export const MARK_TOLERANCE_MS = 120
/** Dos marcas no pueden quedar más cerca que esto (ms). */
export const MIN_MARK_GAP_MS = 100
/** La curva de una marca nueva. */
export const DEFAULT_MARK_EASING: MotionEasing = 'smooth'

export function copyLook(look: EffectLook): EffectLook {
  return { ...look, box: { ...look.box }, keyframes: look.keyframes.map((k) => ({ ...k, box: { ...k.box } })) }
}

function sameBox(a: EffectBox, b: EffectBox): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.scale - b.scale) < 1e-6
}

/** ¿Cambia de sitio o de tamaño con el tiempo? (dos marcas distintas, al menos). */
export function hasMotion(look: Pick<EffectLook, 'keyframes'>): boolean {
  const k = look.keyframes
  return k.length >= 2 && k.some((m) => !sameBox(m.box, k[0]!.box))
}

const track = (kfs: readonly BoxKeyframe[], key: keyof EffectBox): TimedValue[] => kfs.map((k) => ({ atMs: k.atMs, value: k.box[key], easing: k.easing }))

/** Tamaño y sitio a los `localMs` ms del elemento: sin marcas, `box`; con marcas, el camino entre ellas. */
export function boxAt(look: Pick<EffectLook, 'box' | 'keyframes'>, localMs: number): EffectBox {
  const k = look.keyframes
  if (k.length === 0) return look.box
  if (k.length === 1) return k[0]!.box
  return { x: valueAt(track(k, 'x'), localMs), y: valueAt(track(k, 'y'), localMs), scale: valueAt(track(k, 'scale'), localMs) }
}

/** Expresiones de ffmpeg de x, y y el tamaño en función de `t` (con el reloj corrido `offsetMs`). */
export function boxExprs(look: Pick<EffectLook, 'box' | 'keyframes'>, t = 't', offsetMs = 0): { x: string; y: string; scale: string } {
  const k = look.keyframes.length > 0 ? look.keyframes : [{ atMs: 0, box: look.box, easing: 'linear' as MotionEasing }]
  return { x: valueExpr(track(k, 'x'), t, offsetMs), y: valueExpr(track(k, 'y'), t, offsetMs), scale: valueExpr(track(k, 'scale'), t, offsetMs) }
}

/** Índice de la marca que está en la línea (o -1). */
export function markIndexAt(look: Pick<EffectLook, 'keyframes'>, localMs: number): number {
  let best = -1
  look.keyframes.forEach((k, i) => {
    const d = Math.abs(k.atMs - localMs)
    if (d <= MARK_TOLERANCE_MS && (best < 0 || d < Math.abs(look.keyframes[best]!.atMs - localMs))) best = i
  })
  return best
}

/** Las marcas que se ven en el tramo del elemento (las de fuera siguen dando forma al camino). */
export function visibleMarks(look: Pick<EffectLook, 'keyframes'>, lengthMs: number): BoxKeyframe[] {
  return look.keyframes.filter((k) => k.atMs >= 0 && k.atMs <= lengthMs)
}

/** La marca anterior (dir −1) o la siguiente (+1) a `localMs` que se ve; null si no hay. */
export function neighbourMark(look: Pick<EffectLook, 'keyframes'>, localMs: number, dir: -1 | 1, lengthMs: number): BoxKeyframe | null {
  const list = visibleMarks(look, lengthMs)
  if (dir > 0) return list.find((k) => k.atMs > localMs + MARK_TOLERANCE_MS / 2) ?? null
  return [...list].reverse().find((k) => k.atMs < localMs - MARK_TOLERANCE_MS / 2) ?? null
}

function sorted(kfs: BoxKeyframe[]): BoxKeyframe[] {
  return kfs.sort((a, b) => a.atMs - b.atMs)
}

/**
 * Cambia el tamaño y sitio EN ESTE INSTANTE. Sin marcas, el de todo el rato (como siempre). Con marcas, el de la
 * marca de la línea; si no hay ninguna ahí, se crea una (con la curva de serie).
 */
export function setBoxAt(look: EffectLook, localMs: number, change: Partial<EffectBox>): EffectLook {
  if (look.keyframes.length === 0) {
    const box = normalizeBox({ ...look.box, ...change })
    return sameBox(box, look.box) ? look : { ...look, box }
  }
  const at = Math.round(localMs)
  const i = markIndexAt(look, at)
  const box = normalizeBox({ ...boxAt(look, i >= 0 ? look.keyframes[i]!.atMs : at), ...change })
  const keyframes = look.keyframes.map((k) => ({ ...k }))
  if (i >= 0) {
    if (sameBox(keyframes[i]!.box, box)) return look
    keyframes[i] = { ...keyframes[i]!, box }
  } else {
    keyframes.push({ atMs: at, box, easing: DEFAULT_MARK_EASING })
  }
  return { ...look, keyframes: sorted(keyframes) }
}

/**
 * «Marcar aquí»: una marca en la línea con el tamaño y sitio que tiene en ese instante (no cambia nada de lo que
 * se ve; a partir de ahí, mover o cambiar el tamaño en otro instante hace que viaje). Si ya hay una, nada.
 */
export function addMark(look: EffectLook, localMs: number): EffectLook {
  if (markIndexAt(look, localMs) >= 0) return look
  const at = Math.round(localMs)
  return { ...look, keyframes: sorted([...look.keyframes.map((k) => ({ ...k })), { atMs: at, box: { ...boxAt(look, at) }, easing: DEFAULT_MARK_EASING }]) }
}

/**
 * «Quitar esta marca». Si era la última, el efecto se queda quieto donde estaba en esa marca (nada salta).
 */
export function removeMark(look: EffectLook, localMs: number): EffectLook {
  const i = markIndexAt(look, localMs)
  if (i < 0) return look
  const keyframes = look.keyframes.filter((_, j) => j !== i).map((k) => ({ ...k }))
  if (keyframes.length === 0) return { ...look, box: { ...look.keyframes[i]!.box }, keyframes }
  return { ...look, keyframes }
}

/** «Quitar el movimiento»: sin marcas, quieto en el tamaño y sitio que tenía en la línea. */
export function clearMotion(look: EffectLook, localMs: number): EffectLook {
  if (look.keyframes.length === 0) return look
  return { ...look, box: { ...boxAt(look, localMs) }, keyframes: [] }
}

/**
 * Lleva la marca de `fromMs` a `toMs` (arrastrándola en su pista o con «Mover la marca aquí»). No puede pasar a
 * menos de MIN_MARK_GAP_MS de otra; si no cabe, no se mueve.
 */
export function moveMark(look: EffectLook, fromMs: number, toMs: number): EffectLook {
  const i = markIndexAt(look, fromMs)
  if (i < 0) return look
  const to = Math.round(toMs)
  if (to === look.keyframes[i]!.atMs) return look
  if (look.keyframes.some((k, j) => j !== i && Math.abs(k.atMs - to) < MIN_MARK_GAP_MS)) return look
  const keyframes = look.keyframes.map((k, j) => (j === i ? { ...k, atMs: to } : { ...k }))
  return { ...look, keyframes: sorted(keyframes) }
}

/**
 * La marca a la que va el tramo de la línea: la que está en ella, o la siguiente; pasada la última, la última.
 * Su curva es la del viaje que acaba en ella.
 */
export function segmentMarkIndex(look: Pick<EffectLook, 'keyframes'>, localMs: number): number {
  const k = look.keyframes
  if (k.length < 2) return -1
  const on = markIndexAt(look, localMs)
  if (on > 0) return on
  const next = k.findIndex((m) => m.atMs > localMs)
  if (next > 0) return next
  return next === 0 ? 1 : k.length - 1
}

/** Cómo viaja en el tramo de la línea («Suave», «De golpe»…). */
export function setSegmentEasing(look: EffectLook, localMs: number, easing: MotionEasing): EffectLook {
  const i = segmentMarkIndex(look, localMs)
  if (i < 0 || look.keyframes[i]!.easing === easing) return look
  return { ...look, keyframes: look.keyframes.map((k, j) => (j === i ? { ...k, easing } : { ...k })) }
}

/** Corre todas las marcas `deltaMs` (al recortar el principio, para que se queden en su sitio del vídeo). */
export function shiftKeyframes(kfs: readonly BoxKeyframe[], deltaMs: number): BoxKeyframe[] {
  return kfs.map((k) => ({ ...k, box: { ...k.box }, atMs: k.atMs + Math.round(deltaMs) }))
}

/**
 * Al partir el elemento en `cutMs` (tiempo del elemento): cada mitad se queda con sus marcas y con la primera de
 * más allá del corte (fuera de su tramo, sin verse), así el camino de cada mitad es exactamente el de antes: no
 * salta nada en el corte ni cambia la curva del tramo partido (una marca nueva en el corte sí la cambiaría,
 * porque la curva se estiraría a medio tramo). La segunda mitad cuenta desde el corte.
 */
export function splitKeyframes(kfs: readonly BoxKeyframe[], cutMs: number): { first: BoxKeyframe[]; second: BoxKeyframe[] } {
  if (kfs.length === 0) return { first: [], second: [] }
  const copy = (k: BoxKeyframe, shift = 0): BoxKeyframe => ({ ...k, box: { ...k.box }, atMs: k.atMs - shift })
  const after = kfs.findIndex((k) => k.atMs > cutMs)
  const first = (after < 0 ? kfs : kfs.slice(0, after + 1)).map((k) => copy(k))
  const lastBefore = after < 0 ? kfs.length - 1 : after - 1
  const second = kfs.slice(Math.max(0, lastBefore)).map((k) => copy(k, cutMs))
  return { first, second }
}
