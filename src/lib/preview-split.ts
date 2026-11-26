// Reparto de alto en «Tu vídeo» entre la vista previa (arriba, con la columna derecha) y las pistas (abajo).
// Se cambia con el divisor arrastrable o con tres tamaños fijos (nada depende solo de arrastrar) y se
// recuerda en localStorage. La cuenta es pura (con tests); leer y guardar, a prueba de fallos.

/** Alto mínimo de la parte de arriba (vista previa con sus controles) y de la de abajo (barra y pistas). */
export const MIN_TOP_PX = 200
export const MIN_BOTTOM_PX = 190
/**
 * Con la biblioteca abierta, la parte de arriba crece al menos hasta esto (si cabe), para que sea cómoda; y
 * abajo basta con la regla, la fila «Vídeo» y el pie (no está la barra de lo elegido).
 */
export const LIBRARY_TOP_PX = 470
export const LIBRARY_MIN_BOTTOM_PX = 150

export type SplitPreset = 'small' | 'medium' | 'large'
/** Fracción del alto disponible que se lleva la vista previa en cada tamaño fijo. */
export const SPLIT_PRESETS: Record<SplitPreset, number> = { small: 0.36, medium: 0.5, large: 0.64 }
export const DEFAULT_SPLIT = SPLIT_PRESETS.medium

const STORAGE_KEY = 'easy-cut.preview-split'

/** Alto en píxeles de la parte de arriba para una fracción, con los mínimos de los dos lados. */
export function topHeightPx(fraction: number, availablePx: number, options: { library?: boolean } = {}): number {
  const avail = Math.max(0, availablePx)
  const max = Math.max(0, avail - (options.library ? LIBRARY_MIN_BOTTOM_PX : MIN_BOTTOM_PX))
  // Si la ventana no da para los dos mínimos, se reparte lo que hay a partes iguales.
  if (max < MIN_TOP_PX) return Math.round(avail / 2)
  let px = clampFraction(fraction) * avail
  if (options.library) px = Math.max(px, LIBRARY_TOP_PX)
  return Math.round(Math.min(max, Math.max(MIN_TOP_PX, px)))
}

/** Fracción que corresponde a dejar el divisor a `topPx` píxeles (al arrastrar). */
export function fractionFor(topPx: number, availablePx: number): number {
  if (!(availablePx > 0)) return DEFAULT_SPLIT
  const px = Math.min(Math.max(topPx, MIN_TOP_PX), Math.max(MIN_TOP_PX, availablePx - MIN_BOTTOM_PX))
  return clampFraction(px / availablePx)
}

/** El tamaño fijo más cercano a una fracción (para marcar el botón que corresponde). */
export function nearestPreset(fraction: number): SplitPreset | null {
  for (const [id, f] of Object.entries(SPLIT_PRESETS) as [SplitPreset, number][]) if (Math.abs(f - fraction) < 0.02) return id
  return null
}

function clampFraction(f: number): number {
  return Number.isFinite(f) ? Math.min(0.9, Math.max(0.1, f)) : DEFAULT_SPLIT
}

/** Lo guardado (o el de serie si no hay, está dañado o no se puede leer). */
export function loadSplit(storage: Pick<Storage, 'getItem'> | null = safeStorage()): number {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    const n = raw === null || raw === undefined ? NaN : Number(raw)
    return Number.isFinite(n) ? clampFraction(n) : DEFAULT_SPLIT
  } catch {
    return DEFAULT_SPLIT
  }
}

export function saveSplit(fraction: number, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, String(Math.round(clampFraction(fraction) * 1000) / 1000))
  } catch {
    // Sin almacenamiento (modo privado, cuota…): se queda solo para esta sesión.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
