// Valores que cambian en el tiempo con una curva: cómo aparece y desaparece cada cosa (volumen, transparencia,
// imagen desde negro) y, con marcas, el sitio y el tamaño de un efecto. Un solo sistema: una curva (Easing) que
// lleva el avance p ∈ [0, 1] a un valor ∈ [0, 1]; su evaluación en un instante; y su traducción a expresiones de
// ffmpeg (las mismas fórmulas: la vista previa y el fichero guardado coinciden). Puro, en milisegundos.

/**
 * Forma de una curva, con palabras llanas en la interfaz:
 * linear «Al mismo ritmo» · smooth «Suave» (empieza y acaba despacio) · ease-in «Empieza despacio» ·
 * ease-out «Acaba despacio» · step «De golpe» (solo en el movimiento: se queda y salta al llegar).
 */
export type Easing = 'linear' | 'smooth' | 'ease-in' | 'ease-out'
export type MotionEasing = Easing | 'step'
export const EASINGS: readonly Easing[] = ['smooth', 'ease-in', 'ease-out', 'linear']
export const MOTION_EASINGS: readonly MotionEasing[] = ['smooth', 'ease-in', 'ease-out', 'linear', 'step']

export function isEasing(v: unknown): v is Easing {
  return v === 'linear' || v === 'smooth' || v === 'ease-in' || v === 'ease-out'
}
export function isMotionEasing(v: unknown): v is MotionEasing {
  return isEasing(v) || v === 'step'
}

/** Nombre y explicación en llano de cada curva (los mismos en los suaves y en el movimiento). */
export const EASING_LABELS: Record<MotionEasing, { label: string; hint: string }> = {
  smooth: { label: 'Suave', hint: 'Despacio al empezar y al acabar' },
  'ease-in': { label: 'Empieza despacio', hint: 'Despacio y luego deprisa' },
  'ease-out': { label: 'Acaba despacio', hint: 'Deprisa y luego despacio' },
  linear: { label: 'Al mismo ritmo', hint: 'Igual todo el rato' },
  step: { label: 'De golpe', hint: 'Se queda quieto y salta de una vez' },
}

/** Las tres duraciones de aparecer y desaparecer (ms). Las de antes (1 s en sonidos, 0,5 s en efectos) caen aquí. */
export const FADE_DURATIONS = { short: 500, medium: 1000, long: 2000 } as const
export type FadeLength = keyof typeof FADE_DURATIONS
export const FADE_LENGTHS: readonly FadeLength[] = ['short', 'medium', 'long']
export const FADE_LENGTH_LABELS: Record<FadeLength, string> = { short: 'Corta', medium: 'Media', long: 'Larga' }

/** La duración de las tres que es (o null si es otra: un proyecto escrito a mano). */
export function fadeLengthOf(ms: number): FadeLength | null {
  return FADE_LENGTHS.find((l) => FADE_DURATIONS[l] === ms) ?? null
}

/** Curva: avance p (0..1) → valor (0..1). Fuera de [0, 1], se sujeta. */
export function ease(easing: MotionEasing, p: number): number {
  const x = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0))
  switch (easing) {
    case 'smooth':
      // Medio seno: es la curva «hsin» de afade, así el sonido guardado sigue exactamente la misma.
      return (1 - Math.cos(Math.PI * x)) / 2
    case 'ease-in':
      return x * x
    case 'ease-out':
      return 1 - (1 - x) * (1 - x)
    case 'step':
      return x >= 1 ? 1 : 0
    default:
      return x
  }
}

/** Puntos de la curva para dibujarla (el dibujito de cada opción): x e y en 0..1, de abajo arriba. */
export function easingPoints(easing: MotionEasing, n = 24): { x: number; y: number }[] {
  if (easing === 'step') return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]
  return Array.from({ length: n + 1 }, (_, i) => ({ x: i / n, y: ease(easing, i / n) }))
}

// ---------------------------------------------------------------------------
// Aparecer y desaparecer

/** Cómo aparece y desaparece algo: duraciones (0 = de golpe) y curvas. */
export interface Fades {
  fadeInMs: number
  fadeOutMs: number
  fadeInEasing: Easing
  fadeOutEasing: Easing
}

export const NO_FADES: Fades = { fadeInMs: 0, fadeOutMs: 0, fadeInEasing: 'linear', fadeOutEasing: 'linear' }

/** Entrada y salida que caben en esta duración (entre las dos, como mucho lo que dura). */
export function effectiveFadeLengths(f: Pick<Fades, 'fadeInMs' | 'fadeOutMs'>, lengthMs: number): { inMs: number; outMs: number } {
  let fadeIn = Math.max(0, f.fadeInMs)
  let fadeOut = Math.max(0, f.fadeOutMs)
  const total = fadeIn + fadeOut
  if (total > lengthMs && total > 0) {
    fadeIn = Math.floor((Math.max(0, lengthMs) * fadeIn) / total)
    fadeOut = Math.floor((Math.max(0, lengthMs) * fadeOut) / total)
  }
  return { inMs: fadeIn, outMs: fadeOut }
}

/**
 * Factor (0..1) de aparecer y desaparecer a los `localMs` ms de algo que dura `lengthMs`: el volumen de un
 * sonido, la transparencia de un efecto, la imagen (desde negro) y el sonido de un trozo.
 * Al aparecer, ease(p); al desaparecer, 1 − ease(p) con p el avance de la salida (así «Empieza despacio»
 * empieza a bajar despacio).
 */
export function fadeGainAt(f: Fades, localMs: number, lengthMs: number): number {
  const { inMs, outMs } = effectiveFadeLengths(f, lengthMs)
  let g = 1
  if (inMs > 0 && localMs < inMs) g = Math.min(g, ease(f.fadeInEasing, Math.max(0, localMs) / inMs))
  if (outMs > 0 && localMs > lengthMs - outMs) g = Math.min(g, 1 - ease(f.fadeOutEasing, (localMs - (lengthMs - outMs)) / outMs))
  return Math.min(1, Math.max(0, g))
}

/**
 * Curva de afade para cada forma. Al desaparecer, afade aplica la curva al tiempo que queda (f(1 − p)): para
 * que sea 1 − ease(p) hacen falta las curvas «gemelas» (qua ↔ ipar). Medido en tests/integration.
 */
export function afadeCurve(easing: Easing, which: 'in' | 'out'): string {
  switch (easing) {
    case 'smooth':
      return 'hsin'
    case 'ease-in':
      return which === 'in' ? 'qua' : 'ipar'
    case 'ease-out':
      return which === 'in' ? 'ipar' : 'qua'
    default:
      return 'tri'
  }
}

// ---------------------------------------------------------------------------
// Expresiones de ffmpeg (tiempo `t` en segundos)

/** Número para una expresión de ffmpeg, sin notación científica y sin ceros sobrantes. */
export function num(v: number): string {
  if (!Number.isFinite(v)) return '0'
  const r = Math.round(v * 1e6) / 1e6
  const s = r.toFixed(6).replace(/\.?0+$/, '')
  return s === '-0' || s === '' ? '0' : s
}

/** La curva en una expresión de ffmpeg sobre el avance `p` (ya sujeto a 0..1). */
export function easeExpr(easing: MotionEasing, p: string): string {
  switch (easing) {
    case 'smooth':
      return `((1-cos(PI*${p}))/2)`
    case 'ease-in':
      return `(${p}*${p})`
    case 'ease-out':
      return `(1-(1-${p})*(1-${p}))`
    case 'step':
      return `gte(${p},1)`
    default:
      return `(${p})`
  }
}

/** Factor de aparecer y desaparecer en una expresión de ffmpeg (tiempo local `t`, en segundos). */
export function fadeGainExpr(f: Fades, lengthMs: number, t = 't'): string | null {
  const { inMs, outMs } = effectiveFadeLengths(f, lengthMs)
  const parts: string[] = []
  if (inMs > 0) parts.push(easeExpr(f.fadeInEasing, `clip(${t}/${num(inMs / 1000)},0,1)`))
  if (outMs > 0) {
    const st = (lengthMs - outMs) / 1000
    parts.push(`(1-${easeExpr(f.fadeOutEasing, `clip((${t}-${num(st)})/${num(outMs / 1000)},0,1)`)})`)
  }
  if (parts.length === 0) return null
  return parts.length === 1 ? parts[0]! : `min(${parts[0]},${parts[1]})`
}

// ---------------------------------------------------------------------------
// Valores con marcas: un número que viaja de una marca a la siguiente con la curva de la de llegada

export interface TimedValue {
  /** Instante (ms, tiempo local). */
  atMs: number
  value: number
  /** Cómo llega a este valor desde la marca anterior. */
  easing: MotionEasing
}

/** Valor en `localMs`: antes de la primera marca, el de la primera; después de la última, el de la última. */
export function valueAt(points: readonly TimedValue[], localMs: number): number {
  if (points.length === 0) return 0
  const first = points[0]!
  if (localMs <= first.atMs) return first.value
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!
    if (localMs < b.atMs) {
      const a = points[i - 1]!
      const span = b.atMs - a.atMs
      const p = span > 0 ? (localMs - a.atMs) / span : 1
      return a.value + (b.value - a.value) * ease(b.easing, p)
    }
  }
  return points[points.length - 1]!.value
}

/**
 * La misma función en una expresión de ffmpeg sobre `t` (segundos): if anidados, un tramo por par de marcas.
 * `offsetMs` corre el reloj (la marca a los X ms del elemento cae a los X + offset del tramo).
 */
export function valueExpr(points: readonly TimedValue[], t = 't', offsetMs = 0): string {
  if (points.length === 0) return '0'
  const at = (p: TimedValue) => num((p.atMs + offsetMs) / 1000)
  // Valores iguales en todo: una constante.
  if (points.every((p) => Math.abs(p.value - points[0]!.value) < 1e-9)) return num(points[0]!.value)
  let expr = num(points[points.length - 1]!.value)
  for (let i = points.length - 1; i >= 1; i--) {
    const a = points[i - 1]!
    const b = points[i]!
    const spanS = (b.atMs - a.atMs) / 1000
    const seg =
      b.easing === 'step' || spanS <= 0
        ? num(a.value)
        : `${num(a.value)}+(${num(b.value - a.value)})*${easeExpr(b.easing, `clip((${t}-${at(a)})/${num(spanS)},0,1)`)}`
    expr = `if(lt(${t},${at(b)}),${seg},${expr})`
  }
  return `if(lt(${t},${at(points[0]!)}),${num(points[0]!.value)},${expr})`
}
