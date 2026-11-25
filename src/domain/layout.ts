// Forma de los trozos y del vídeo, y cómo colocar un trozo dentro del marco de la vista previa.
// Es el mismo cálculo que planFraming (ffmpeg-args.ts), en píxeles de pantalla y sin redondear a pares.

import { clipDisplaySize, type AspectRatio, type EffectBox, type EffectLook, type Inset, type InsetSize, type MediaInfo, type Viewable } from './project'

export const ASPECT_VALUES: Record<AspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
}

/** Fondo liso de los trozos que «solo se oyen»: gris pizarra muy oscuro (el mismo en la vista previa y al guardar). */
export const PLAIN_BACKGROUND_HEX = '1c2229'
export const PLAIN_BACKGROUND_CSS = `#${PLAIN_BACKGROUND_HEX}`

/** Ancho del vídeo en la esquina respecto al del vídeo (es una copia en pequeño, con la misma forma). */
export const INSET_SCALE: Record<InsetSize, number> = { small: 0.28, medium: 0.4 }
/** Margen respecto al borde, como fracción del lado corto del vídeo. */
export const INSET_MARGIN = 0.04
/** Radio de las esquinas redondeadas, como fracción del lado corto del recuadro. */
export const INSET_RADIUS = 0.08

export interface InsetRect {
  left: number
  top: number
  width: number
  height: number
  radius: number
}

/**
 * Dónde va el vídeo en la esquina dentro de un marco de frameWidth × frameHeight.
 * Con `even`, todo en píxeles pares (para ffmpeg); sin él, en píxeles de pantalla.
 */
export function insetRect(inset: Inset, frameWidth: number, frameHeight: number, even = false): InsetRect {
  const round = (n: number) => (even ? Math.max(2, Math.round(n / 2) * 2) : n)
  const scale = INSET_SCALE[inset.size]
  const width = round(frameWidth * scale)
  const height = round(frameHeight * scale)
  const margin = round(Math.min(frameWidth, frameHeight) * INSET_MARGIN)
  const left = inset.corner.endsWith('left') ? margin : frameWidth - width - margin
  const top = inset.corner.startsWith('top') ? margin : frameHeight - height - margin
  const radius = even ? Math.max(2, Math.round(Math.min(width, height) * INSET_RADIUS)) : Math.min(width, height) * INSET_RADIUS
  return { left, top, width, height, radius }
}

/** Forma más parecida a un ancho × alto («horizontal», «vertical» o «cuadrado»). */
export function closestAspect(width: number, height: number): AspectRatio {
  if (width <= 0 || height <= 0) return '16:9'
  const ratio = width / height
  if (ratio >= 1.2) return '16:9'
  if (ratio <= 1 / 1.2) return '9:16'
  return '1:1'
}

/** Forma de la mayoría de los vídeos; en empate, la del primero; sin vídeos, horizontal. Los sonidos (sin imagen) no cuentan. */
export function dominantAspect(all: readonly Pick<MediaInfo, 'width' | 'height'>[]): AspectRatio {
  const sizes = all.filter((s) => s.width > 0 && s.height > 0)
  if (sizes.length === 0) return '16:9'
  const counts = new Map<AspectRatio, number>()
  for (const s of sizes) {
    const a = closestAspect(s.width, s.height)
    counts.set(a, (counts.get(a) ?? 0) + 1)
  }
  let best = closestAspect(sizes[0]!.width, sizes[0]!.height)
  for (const [aspect, n] of counts) if (n > (counts.get(best) ?? 0)) best = aspect
  return best
}

/** ¿El trozo (ya girado) tiene la misma forma que el vídeo? Si no, hay que elegir cómo encuadrarlo. */
export function clipMatchesAspect(clip: Viewable, media: Pick<MediaInfo, 'width' | 'height'>, aspect: AspectRatio): boolean {
  const { width, height } = clipDisplaySize(clip, media)
  if (width <= 0 || height <= 0) return true
  return Math.abs(width / height / ASPECT_VALUES[aspect] - 1) < 0.03
}

/** Mayor rectángulo de la forma dada que cabe en el espacio disponible. */
export function fitAspect(aspect: AspectRatio, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const r = ASPECT_VALUES[aspect]
  if (maxWidth <= 0 || maxHeight <= 0) return { width: 0, height: 0 }
  return maxWidth / maxHeight > r
    ? { width: maxHeight * r, height: maxHeight }
    : { width: maxWidth, height: maxWidth / r }
}

export interface FramingLayout {
  /** Caja visible del trozo (ya girado) dentro del marco, en píxeles del marco. Puede salirse. */
  left: number
  top: number
  width: number
  height: number
  /** Tamaño del elemento <video> antes de girarlo (con giro impar, ancho y alto cambiados). */
  elementWidth: number
  elementHeight: number
  rotationDeg: number
  /** El trozo no llena el marco y va el fondo desenfocado. */
  showsBackground: boolean
  /** Sobra imagen en horizontal / vertical: se puede mover arrastrando. */
  canPanX: boolean
  canPanY: boolean
}

/**
 * Coloca el trozo en un marco de frameWidth × frameHeight.
 * fit-blur: se ve entero (con zoom puede salirse); fill: llena recortando.
 * offset −1 pega el borde izquierdo/superior, 0 centra y 1 el derecho/inferior (como planFraming).
 */
export function computeFramingLayout(
  clip: Viewable,
  media: Pick<MediaInfo, 'width' | 'height'>,
  frameWidth: number,
  frameHeight: number,
): FramingLayout {
  const { width: w, height: h } = clipDisplaySize(clip, media)
  const W = frameWidth
  const H = frameHeight
  const { zoom, offsetX, offsetY, mode } = clip.framing
  const safeW = w > 0 ? w : W
  const safeH = h > 0 ? h : H
  const base = mode === 'fill' ? Math.max(W / safeW, H / safeH) : Math.min(W / safeW, H / safeH)
  const s = base * zoom
  const bw = safeW * s
  const bh = safeH * s
  const place = (box: number, frame: number, offset: number) =>
    box > frame ? -((box - frame) / 2) * (1 + offset) : (frame - box) / 2
  const odd = clip.quarterTurns % 2 === 1
  const tolerance = 1
  return {
    left: place(bw, W, offsetX),
    top: place(bh, H, offsetY),
    width: bw,
    height: bh,
    elementWidth: odd ? bh : bw,
    elementHeight: odd ? bw : bh,
    rotationDeg: clip.quarterTurns * 90,
    showsBackground: mode === 'fit-blur' && (bw < W - tolerance || bh < H - tolerance),
    canPanX: bw > W + tolerance,
    canPanY: bh > H + tolerance,
  }
}

export interface EffectRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Dónde va un efecto (de srcWidth × srcHeight) en un marco de frameWidth × frameHeight según su tamaño y
 * sitio: a tamaño 1 llena el marco (`cover`, recortando lo que sobre) o cabe entero (`contain`), y se
 * centra en (x, y). Puede salirse del marco. Con `even`, en píxeles pares (para ffmpeg).
 */
export function effectRect(
  look: Pick<EffectLook, 'box' | 'fit'>,
  srcWidth: number,
  srcHeight: number,
  frameWidth: number,
  frameHeight: number,
  even = false,
): EffectRect {
  const w0 = srcWidth > 0 ? srcWidth : frameWidth
  const h0 = srcHeight > 0 ? srcHeight : frameHeight
  const base = look.fit === 'contain' ? Math.min(frameWidth / w0, frameHeight / h0) : Math.max(frameWidth / w0, frameHeight / h0)
  const s = base * look.box.scale
  const round = (n: number) => (even ? Math.max(2, Math.round(n / 2) * 2) : n)
  const width = round(w0 * s)
  const height = round(h0 * s)
  const left = frameWidth * look.box.x - width / 2
  const top = frameHeight * look.box.y - height / 2
  return { left: even ? Math.round(left) : left, top: even ? Math.round(top) : top, width, height }
}

/**
 * Tamaño y sitio nuevos al arrastrar un efecto dx/dy píxeles (en un marco de frameWidth × frameHeight):
 * su centro se mueve con el puntero, sin salirse del todo del marco.
 */
export function moveEffectBox(box: EffectBox, frameWidth: number, frameHeight: number, dx: number, dy: number): EffectBox {
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return { ...box, x: clamp(box.x + dx / Math.max(1, frameWidth)), y: clamp(box.y + dy / Math.max(1, frameHeight)) }
}

/**
 * Nuevo desplazamiento al arrastrar la imagen dx/dy píxeles (en el marco).
 * Arrastrar a la derecha enseña lo que hay a la izquierda (el offset baja).
 */
export function panOffset(
  layout: Pick<FramingLayout, 'width' | 'height'>,
  frameWidth: number,
  frameHeight: number,
  start: { offsetX: number; offsetY: number },
  dx: number,
  dy: number,
): { offsetX: number; offsetY: number } {
  const extraX = layout.width - frameWidth
  const extraY = layout.height - frameHeight
  const clamp = (v: number) => Math.min(1, Math.max(-1, v))
  return {
    offsetX: extraX > 0 ? clamp(start.offsetX - (2 * dx) / extraX) : start.offsetX,
    offsetY: extraY > 0 ? clamp(start.offsetY - (2 * dy) / extraY) : start.offsetY,
  }
}
