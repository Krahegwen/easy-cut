// El collage: una pieza de las pistas de efectos que es una plantilla con varios vídeos dentro (sus «huecos»).
// Entra en las pistas como una sola pieza (se mueve, se recorta, se parte y se quita entero) y los vídeos son sus
// parámetros: se ponen en los huecos y se intercambian. Aquí: las plantillas, los rectángulos de cada hueco (los
// mismos en la vista previa y al guardar), la distribución que mejor encaja con la forma de los vídeos, el tiempo
// de cada hueco y las operaciones sobre los huecos. Puro e inmutable; tiempos en milisegundos enteros.
//
// Decisiones del dueño (Paquete 7): del collage no suena nada salvo el hueco que se elija (uno como mucho); un vídeo
// más corto que el collage se queda quieto en su última imagen; el collage dura, de serie, lo que el vídeo más largo
// de sus huecos; plantillas de 2 a 4 huecos; separación oscura (de serie, fina), blanca o ninguna.

import type { Collage, CollageCell, CollageCellSource, CollageGap, CellFit, MediaInfo, TrackItem } from './project'

/** Un hueco de una plantilla, en coordenadas relativas al collage (0..1). */
export interface LayoutCell {
  x: number
  y: number
  w: number
  h: number
}

export interface CollageLayout {
  id: string
  /** Cuántos vídeos lleva. */
  count: number
  /** Nombre llano («Uno grande a la izquierda y dos a la derecha»). */
  name: string
  /** Los huecos, en el orden de «Vídeo 1», «Vídeo 2»… */
  cells: LayoutCell[]
}

const H = 1 / 2
const T = 1 / 3

/**
 * Las plantillas. Con 4, siempre los cuatro cuadrantes (no se pregunta la distribución). El orden de los huecos: por
 * columnas en las que se parten a lo ancho (el grande primero si va a la izquierda) y por filas en las que se parten
 * a lo alto.
 */
export const COLLAGE_LAYOUTS: readonly CollageLayout[] = [
  { id: 'side-by-side', count: 2, name: 'Uno al lado del otro', cells: [{ x: 0, y: 0, w: H, h: 1 }, { x: H, y: 0, w: H, h: 1 }] },
  { id: 'stacked', count: 2, name: 'Uno encima del otro', cells: [{ x: 0, y: 0, w: 1, h: H }, { x: 0, y: H, w: 1, h: H }] },
  {
    id: 'three-columns',
    count: 3,
    name: 'En tres columnas',
    cells: [{ x: 0, y: 0, w: T, h: 1 }, { x: T, y: 0, w: T, h: 1 }, { x: 2 * T, y: 0, w: T, h: 1 }],
  },
  {
    id: 'three-rows',
    count: 3,
    name: 'En tres filas',
    cells: [{ x: 0, y: 0, w: 1, h: T }, { x: 0, y: T, w: 1, h: T }, { x: 0, y: 2 * T, w: 1, h: T }],
  },
  {
    id: 'big-left',
    count: 3,
    name: 'Uno grande a la izquierda y dos a la derecha',
    cells: [{ x: 0, y: 0, w: H, h: 1 }, { x: H, y: 0, w: H, h: H }, { x: H, y: H, w: H, h: H }],
  },
  {
    id: 'big-right',
    count: 3,
    name: 'Dos a la izquierda y uno a la derecha',
    cells: [{ x: 0, y: 0, w: H, h: H }, { x: 0, y: H, w: H, h: H }, { x: H, y: 0, w: H, h: 1 }],
  },
  {
    id: 'big-top',
    count: 3,
    name: 'Uno grande arriba y dos abajo',
    cells: [{ x: 0, y: 0, w: 1, h: H }, { x: 0, y: H, w: H, h: H }, { x: H, y: H, w: H, h: H }],
  },
  {
    id: 'big-bottom',
    count: 3,
    name: 'Dos arriba y uno abajo',
    cells: [{ x: 0, y: 0, w: H, h: H }, { x: H, y: 0, w: H, h: H }, { x: 0, y: H, w: 1, h: H }],
  },
  {
    id: 'quadrants',
    count: 4,
    name: 'Cuatro cuadrantes',
    cells: [{ x: 0, y: 0, w: H, h: H }, { x: H, y: 0, w: H, h: H }, { x: 0, y: H, w: H, h: H }, { x: H, y: H, w: H, h: H }],
  },
]

export const COLLAGE_COUNTS: readonly number[] = [2, 3, 4]
export const MAX_COLLAGE_CELLS = 4

/** Lo que dura un collage recién hecho, mientras no tiene ningún vídeo. */
export const COLLAGE_DEFAULT_MS = 5000

/** La separación fina: esta fracción del lado corto del collage. */
export const COLLAGE_GAP_FRACTION = 0.008
/** Color de cada separación (sin «#»). La oscura es el fondo liso de la app. */
export const COLLAGE_GAP_HEX: Record<CollageGap, string> = { dark: '1c2229', white: 'ffffff', none: '1c2229' }
/** Lo que se ve alrededor de un vídeo «Entero» y en un hueco vacío (el fondo liso de la app). */
export const COLLAGE_BACKGROUND_HEX = '1c2229'
export const COLLAGE_GAPS: readonly CollageGap[] = ['dark', 'white', 'none']
export const GAP_LABELS: Record<CollageGap, string> = { dark: 'Raya oscura', white: 'Raya blanca', none: 'Sin separación' }

/**
 * Un vídeo que se acaba se queda en su última imagen: se para esto antes de su final (el último fotograma que se
 * puede enseñar en la vista previa sin que el <video> acabe).
 */
export const LAST_FRAME_MS = 40

export function layoutById(id: string): CollageLayout | null {
  return COLLAGE_LAYOUTS.find((l) => l.id === id) ?? null
}

export function layoutsFor(count: number): CollageLayout[] {
  return COLLAGE_LAYOUTS.filter((l) => l.count === count)
}

/** ¿Hay que preguntar cómo se reparten? (con 4 no: siempre los cuatro cuadrantes). */
export function layoutHasChoice(count: number): boolean {
  return layoutsFor(count).length > 1
}

// ---------------------------------------------------------------------------
// Rectángulos

export interface CellRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Píxeles de la separación en un collage de W × H. Con `even` (para ffmpeg) múltiplo de 4, para que cada hueco
 * empiece y mida un número par de píxeles (yuv420p); como mínimo 4 si la hay.
 */
export function gapPixels(gap: CollageGap, W: number, Hh: number, even = false): number {
  if (gap === 'none') return 0
  const g = Math.min(W, Hh) * COLLAGE_GAP_FRACTION
  return even ? Math.max(4, Math.round(g / 4) * 4) : g
}

/**
 * Rectángulos de cada hueco en un collage de W × H (px). La separación va solo entre huecos, no en el borde: la
 * composición llena el collage entero. Con `even`, bordes en píxeles pares (para ffmpeg).
 */
export function cellRects(layout: CollageLayout, W: number, Hh: number, gap: CollageGap, even = false): CellRect[] {
  const g = gapPixels(gap, W, Hh, even)
  const edge = (f: number, size: number) => (even ? Math.round((f * size) / 2) * 2 : f * size)
  return layout.cells.map((c) => {
    const x0 = edge(c.x, W) + (c.x > 1e-6 ? g / 2 : 0)
    const x1 = edge(c.x + c.w, W) - (c.x + c.w < 1 - 1e-6 ? g / 2 : 0)
    const y0 = edge(c.y, Hh) + (c.y > 1e-6 ? g / 2 : 0)
    const y1 = edge(c.y + c.h, Hh) - (c.y + c.h < 1 - 1e-6 ? g / 2 : 0)
    return { left: x0, top: y0, width: Math.max(even ? 2 : 0, x1 - x0), height: Math.max(even ? 2 : 0, y1 - y0) }
  })
}

/** Dónde va el vídeo dentro de su hueco (px, relativo al hueco; con «Llenar», puede salirse: se recorta). */
export interface CellContent {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Coloca el vídeo (de w × h, ya girado) en su hueco de cw × ch: «Llenar» lo recorta para cubrirlo, «Entero» lo deja
 * entero con bandas de fondo. offset −1 pega el borde izquierdo/superior, 0 centra, 1 el derecho/inferior (como el
 * encuadre de un trozo). Con `even`, tamaño y sitio en píxeles pares (para ffmpeg: scale + crop o pad).
 */
export function cellContentLayout(
  cell: Pick<CollageCell, 'fit' | 'zoom' | 'offsetX' | 'offsetY'>,
  w: number,
  h: number,
  cw: number,
  ch: number,
  even = false,
): CellContent {
  const sw0 = w > 0 ? w : cw
  const sh0 = h > 0 ? h : ch
  const base = cell.fit === 'fill' ? Math.max(cw / sw0, ch / sh0) : Math.min(cw / sw0, ch / sh0)
  const s = base * Math.max(1, cell.zoom)
  const round2 = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  // Lo que llena exactamente se queda en el tamaño del hueco (sin un píxel de más por redondeo).
  let bw = even ? round2(sw0 * s) : sw0 * s
  let bh = even ? round2(sh0 * s) : sh0 * s
  if (cell.fit === 'fill') {
    bw = Math.max(cw, bw)
    bh = Math.max(ch, bh)
  } else if (even) {
    bw = Math.min(bw, cw)
    bh = Math.min(bh, ch)
  }
  const place = (box: number, frame: number, offset: number) => {
    const v = box > frame ? -((box - frame) / 2) * (1 + offset) : (frame - box) / 2
    // (|| 0: sin «-0», que en ffmpeg y en CSS es lo mismo pero no en las comparaciones.)
    return (even ? Math.round(v / 2) * 2 : v) || 0
  }
  return { left: place(bw, cw, cell.offsetX), top: place(bh, ch, cell.offsetY), width: bw, height: bh }
}

/** ¿Sobra imagen en horizontal / vertical? (con «Llenar»: se puede mover el encuadre). */
export function cellCanPan(content: CellContent, cw: number, ch: number): { x: boolean; y: boolean } {
  return { x: content.width > cw + 1, y: content.height > ch + 1 }
}

/** Paso de «Mover el encuadre» con los botones (en unidades del desplazamiento, −1..1). */
export const PAN_STEP = 0.25

// ---------------------------------------------------------------------------
// Sugerencia de distribución

export interface Shape {
  width: number
  height: number
}

export interface LayoutSuggestion {
  layoutId: string
  /** order[hueco] = índice del vídeo (en el orden en que se dieron) que va en ese hueco. */
  order: number[]
  /** Lo que se pierde recortando (0 = encaja perfecto). */
  loss: number
}

function permutations(n: number): number[][] {
  if (n <= 1) return [[0]]
  const out: number[][] = []
  const rec = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(prefix)
      return
    }
    rest.forEach((v, i) => rec([...prefix, v], [...rest.slice(0, i), ...rest.slice(i + 1)]))
  }
  rec([], Array.from({ length: n }, (_, i) => i))
  return out
}

/** Lo que se pierde poniendo un vídeo de esa forma en un hueco (área × lo que no encaja de su forma). */
function cellLoss(shape: Shape | null, cell: CellRect): number {
  if (!shape || shape.width <= 0 || shape.height <= 0) return 0
  const rv = shape.width / shape.height
  const rc = cell.width / cell.height
  return cell.width * cell.height * (1 - Math.min(rv / rc, rc / rv))
}

/**
 * La distribución (de ese número de vídeos) que mejor encaja con la forma de los vídeos, y qué vídeo va en cada
 * hueco: la que menos imagen deja fuera de sus huecos con «Llenar». En empate, la primera del catálogo y los vídeos
 * en su orden. Lo que no tiene tamaño conocido (null) no cuenta.
 */
export function suggestLayout(count: number, shapes: readonly (Shape | null)[], frameWidth: number, frameHeight: number): LayoutSuggestion | null {
  const layouts = layoutsFor(count)
  if (layouts.length === 0) return null
  const perms = permutations(count)
  let best: LayoutSuggestion | null = null
  for (const layout of layouts) {
    const rects = cellRects(layout, frameWidth, frameHeight, 'none')
    const area = frameWidth * frameHeight || 1
    for (const order of perms) {
      const loss = order.reduce((sum, shapeIndex, cellIndex) => sum + cellLoss(shapes[shapeIndex] ?? null, rects[cellIndex]!), 0) / area
      if (!best || loss < best.loss - 1e-9) best = { layoutId: layout.id, order, loss }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Crear y cambiar

export function emptyCell(): CollageCell {
  return { source: null, startMs: 0, fit: 'fill', zoom: 1, offsetX: 0, offsetY: 0, volume: 0 }
}

/** Un collage vacío con esa plantilla. */
export function createCollage(layoutId: string, gap: CollageGap = 'dark'): Collage {
  const layout = layoutById(layoutId) ?? COLLAGE_LAYOUTS[0]!
  return { layoutId: layout.id, gap, cells: layout.cells.map(() => emptyCell()) }
}

/** Lo que se sabe de un fichero para ponerlo en un hueco (null si no tiene imagen: un sonido no vale). */
export function cellSourceFromInfo(info: Pick<MediaInfo, 'path' | 'durationMs' | 'hasVideo' | 'hasAudio' | 'width' | 'height' | 'isStill'>): CollageCellSource | null {
  const still = info.isStill === true
  if (!still && !info.hasVideo) return null
  if (!still && !(info.durationMs > 0)) return null
  return {
    path: info.path,
    durationMs: still ? 0 : Math.round(info.durationMs),
    still,
    hasAudio: !still && info.hasAudio,
    width: Math.max(0, Math.round(info.width)),
    height: Math.max(0, Math.round(info.height)),
  }
}

/** Lo que dura el collage por sus vídeos: lo que queda del más largo desde su comienzo. null sin vídeos (o solo fotos). */
export function collageNaturalMs(collage: Collage): number | null {
  let best: number | null = null
  for (const c of collage.cells) {
    if (!c.source || c.source.still) continue
    const left = c.source.durationMs - c.startMs
    if (left > 0 && (best === null || left > best)) best = left
  }
  return best
}

function withCells(collage: Collage, cells: CollageCell[]): Collage {
  return { ...collage, cells }
}

/** Pone un fichero en el hueco `i` (vuelve a empezar por su principio y a llenar el hueco; si sonaba otro, sigue sonando). */
export function setCell(collage: Collage, i: number, source: CollageCellSource): Collage {
  if (i < 0 || i >= collage.cells.length) return collage
  const cells = collage.cells.slice()
  const prev = cells[i]!
  // Un hueco que sonaba y pasa a algo sin sonido deja de sonar.
  const volume = prev.volume > 0 && source.hasAudio ? prev.volume : 0
  cells[i] = { ...emptyCell(), fit: prev.source ? prev.fit : 'fill', volume, source }
  return withCells(collage, cells)
}

/** Vacía el hueco `i`. */
export function clearCell(collage: Collage, i: number): Collage {
  if (i < 0 || i >= collage.cells.length || !collage.cells[i]!.source) return collage
  const cells = collage.cells.slice()
  cells[i] = emptyCell()
  return withCells(collage, cells)
}

/** Intercambia dos huecos enteros (vídeo, encuadre, comienzo y si suena). */
export function swapCells(collage: Collage, a: number, b: number): Collage {
  const n = collage.cells.length
  if (a === b || a < 0 || b < 0 || a >= n || b >= n) return collage
  const cells = collage.cells.slice()
  cells[a] = collage.cells[b]!
  cells[b] = collage.cells[a]!
  return withCells(collage, cells)
}

/** «Llenar el hueco» o «Entero». */
export function setCellFit(collage: Collage, i: number, fit: CellFit): Collage {
  const cell = collage.cells[i]
  if (!cell || cell.fit === fit) return collage
  const cells = collage.cells.slice()
  cells[i] = { ...cell, fit, offsetX: 0, offsetY: 0 }
  return withCells(collage, cells)
}

/** Encuadre dentro del hueco (desplazamiento −1..1; el zoom, de 1 en adelante). */
export function setCellFraming(collage: Collage, i: number, change: Partial<Pick<CollageCell, 'zoom' | 'offsetX' | 'offsetY'>>): Collage {
  const cell = collage.cells[i]
  if (!cell) return collage
  const clamp = (v: number) => Math.min(1, Math.max(-1, Math.round(v * 1000) / 1000))
  const next = {
    ...cell,
    zoom: change.zoom === undefined ? cell.zoom : Math.min(4, Math.max(1, change.zoom)),
    offsetX: change.offsetX === undefined ? cell.offsetX : clamp(change.offsetX),
    offsetY: change.offsetY === undefined ? cell.offsetY : clamp(change.offsetY),
  }
  if (next.zoom === cell.zoom && next.offsetX === cell.offsetX && next.offsetY === cell.offsetY) return collage
  const cells = collage.cells.slice()
  cells[i] = next
  return withCells(collage, cells)
}

/** Desde qué instante de su vídeo empieza el hueco (sin pasar de su final). */
export function setCellStart(collage: Collage, i: number, startMs: number): Collage {
  const cell = collage.cells[i]
  if (!cell?.source || cell.source.still) return collage
  const ms = Math.round(Math.min(Math.max(0, startMs), Math.max(0, cell.source.durationMs - LAST_FRAME_MS)))
  if (ms === cell.startMs) return collage
  const cells = collage.cells.slice()
  cells[i] = { ...cell, startMs: ms }
  return withCells(collage, cells)
}

/** El hueco que suena (null si no suena ninguno). */
export function heardCell(collage: Collage): number | null {
  const i = collage.cells.findIndex((c) => c.volume > 0 && !!c.source?.hasAudio)
  return i >= 0 ? i : null
}

/** «Qué se oye»: el hueco `i` (los demás, callados) o ninguno. Solo un hueco con sonido puede sonar. */
export function setHeardCell(collage: Collage, i: number | null): Collage {
  if (i !== null && !collage.cells[i]?.source?.hasAudio) return collage
  if (heardCell(collage) === i) return collage
  return withCells(
    collage,
    collage.cells.map((c, k) => {
      const volume = k === i ? 1 : 0
      return c.volume === volume ? c : { ...c, volume }
    }),
  )
}

/**
 * Otra plantilla del mismo número de huecos: los vídeos se quedan en su orden (el vídeo 1 sigue siendo el 1). Con
 * `order` (la de la sugerencia), en ese orden.
 */
export function changeLayout(collage: Collage, layoutId: string, order?: readonly number[]): Collage {
  const layout = layoutById(layoutId)
  if (!layout || layout.count !== collage.cells.length) return collage
  const cells = order && order.length === collage.cells.length ? order.map((k) => collage.cells[k]!) : collage.cells
  if (layout.id === collage.layoutId && cells.every((c, k) => c === collage.cells[k])) return collage
  return { ...collage, layoutId: layout.id, cells: cells.slice() }
}

export function setCollageGap(collage: Collage, gap: CollageGap): Collage {
  return collage.gap === gap ? collage : { ...collage, gap }
}

// ---------------------------------------------------------------------------
// Tiempos

/**
 * Qué instante de su vídeo enseña el hueco a los `collageMs` ms del collage (desde su comienzo, `phaseMs`
 * incluido): su comienzo más eso, a velocidad normal; si se ha acabado, su última imagen (`frozen`). null si está
 * vacío. Una foto, siempre 0.
 */
export function cellTimeAt(cell: CollageCell, collageMs: number): { ms: number; frozen: boolean } | null {
  if (!cell.source) return null
  if (cell.source.still) return { ms: 0, frozen: true }
  const last = Math.max(0, cell.source.durationMs - LAST_FRAME_MS)
  const t = cell.startMs + Math.max(0, collageMs)
  return t >= last ? { ms: last, frozen: true } : { ms: Math.round(t), frozen: false }
}

/** Ficheros que usa el collage (sin repetir). */
export function collagePaths(collage: Collage): string[] {
  return [...new Set(collage.cells.flatMap((c) => (c.source ? [c.source.path] : [])))]
}

/** Huecos vacíos (índices). */
export function emptyCells(collage: Collage): number[] {
  return collage.cells.flatMap((c, i) => (c.source ? [] : [i]))
}

/** ¿Es un collage? (con su plantilla). */
export function isCollageItem(item: Pick<TrackItem, 'source' | 'collage'>): item is TrackItem & { source: { type: 'collage' }; collage: Collage } {
  return item.source.type === 'collage' && !!item.collage
}

/** «Collage de 3». */
export function collageName(collage: Collage): string {
  return `Collage de ${collage.cells.length}`
}

/** Cambia la ruta de un fichero en los huecos (volver a enlazar). Mismo objeto si no lo usa. */
export function relinkCollage(collage: Collage, oldPath: string, info: Pick<MediaInfo, 'path' | 'durationMs' | 'hasAudio' | 'width' | 'height' | 'isStill'>): Collage {
  if (!collage.cells.some((c) => c.source?.path === oldPath)) return collage
  return withCells(
    collage,
    collage.cells.map((c) => {
      if (c.source?.path !== oldPath) return c
      const still = info.isStill === true
      const durationMs = still ? 0 : Math.max(1, Math.round(info.durationMs))
      const source: CollageCellSource = { path: info.path, durationMs, still, hasAudio: !still && info.hasAudio, width: info.width || c.source.width, height: info.height || c.source.height }
      return { ...c, source, startMs: Math.min(c.startMs, Math.max(0, durationMs - LAST_FRAME_MS)), volume: source.hasAudio ? c.volume : 0 }
    }),
  )
}

// ---------------------------------------------------------------------------
// Leer de un proyecto guardado

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function parseCellSource(raw: unknown): CollageCellSource | null {
  if (!isObject(raw) || typeof raw.path !== 'string' || raw.path === '') return null
  const still = raw.still === true
  const durationMs = still ? 0 : Math.round(finite(raw.durationMs, 0))
  if (!still && durationMs <= 0) return null
  return {
    path: raw.path,
    durationMs,
    still,
    hasAudio: !still && raw.hasAudio === true,
    width: Math.max(0, Math.round(finite(raw.width, 0))),
    height: Math.max(0, Math.round(finite(raw.height, 0))),
  }
}

/**
 * Un collage guardado, en valores válidos; null si no se entiende (plantilla desconocida o un número de huecos que no
 * es el suyo): entonces se descarta el elemento, nunca el proyecto. Como mucho un hueco suena.
 */
export function normalizeCollage(raw: unknown): Collage | null {
  if (!isObject(raw) || typeof raw.layoutId !== 'string') return null
  const layout = layoutById(raw.layoutId)
  if (!layout || !Array.isArray(raw.cells) || raw.cells.length !== layout.count) return null
  const gap: CollageGap = raw.gap === 'white' || raw.gap === 'none' ? raw.gap : 'dark'
  let heard = false
  const cells = raw.cells.map((c): CollageCell => {
    const r = isObject(c) ? c : {}
    const source = parseCellSource(r.source)
    const fit: CellFit = r.fit === 'whole' ? 'whole' : 'fill'
    const clamp = (v: unknown) => Math.min(1, Math.max(-1, finite(v, 0)))
    let volume = Math.min(1.5, Math.max(0, finite(r.volume, 0)))
    if (!source?.hasAudio || heard) volume = 0
    if (volume > 0) heard = true
    const startMs = source && !source.still ? Math.round(Math.min(Math.max(0, finite(r.startMs, 0)), Math.max(0, source.durationMs - LAST_FRAME_MS))) : 0
    return { source, startMs, fit, zoom: Math.min(4, Math.max(1, finite(r.zoom, 1))), offsetX: clamp(r.offsetX), offsetY: clamp(r.offsetY), volume }
  })
  return { layoutId: layout.id, gap, cells }
}
