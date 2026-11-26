<script setup lang="ts">
// Pistas en la vista previa. Los sonidos van en elementos <audio> que siguen el reloj del montaje (como el
// vídeo de encima: se recolocan si se separan más de 150 ms), con su volumen y sus entradas y salidas suaves
// aplicados en vivo; solo se montan los que suenan o van a sonar en los próximos segundos (como mucho 8). Los
// efectos son <video>/<img> colocados sobre el marco (mix-blend-mode: screen para «Como luz»), con su
// transparencia y sus suaves. Silenciar u ocultar una pista se nota al momento. Con «Tamaño y sitio», el efecto
// elegido se mueve y se cambia de tamaño arrastrando sobre la vista previa: el valor de ESE instante (con marcas,
// el de la marca de la línea, que se crea si no la hay). Los efectos con marcas viajan de una a otra: el mismo
// cálculo que al guardar (boxAt), en cada fotograma, con `transform` (translate + scale) sobre su recuadro a tamaño
// 1. Con «Repasar más rápido» (`rate`), todo suena y se mueve a ese factor (playbackRate), como el reloj del montaje.
// Un collage es un recuadro como cualquier efecto con un hueco por vídeo dentro (los mismos rectángulos que al
// guardar, cellRects y cellContentLayout); cada hueco es su propio <video>, que sigue el tiempo del collage a velocidad
// normal y se queda en su última imagen al acabarse; suenan los huecos no silenciados. Los <video> de los efectos
// tienen un cupo (VIDEO_BUDGET: un efecto de vídeo cuenta 1, una imagen 0 y un collage, sus huecos con vídeo).

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  audibleOrVisible,
  boxAt,
  cellContentLayout,
  cellRects,
  cellSounds,
  cellTimeAt,
  COLLAGE_BACKGROUND_HEX,
  COLLAGE_GAP_HEX,
  layoutById,
  needsCellProxy,
  type CollageCell,
  COVER_DRIFT_TOLERANCE_MS,
  visibleMarks,
  effectRect,
  itemFadeAt,
  itemLengthMs,
  itemSourceTimeAt,
  MAX_EFFECT_SCALE,
  mediaRate,
  MIN_EFFECT_SCALE,
  moveEffectBox,
  projectTiming,
  resolveTracks,
  type EffectBox,
  type EffectLook,
  type Project,
  type ResolvedItem,
  type TrackItem,
} from '../domain'
import { library, store, tracks } from '../store'
import CollageCells from './tracks/CollageCells.vue'

const props = withDefaults(
  defineProps<{
    project: Project
    currentMs: number
    playing: boolean
    frameWidth: number
    frameHeight: number
    /**
     * «Repasar más rápido» (1 = normal): los sonidos y efectos suenan a ese ritmo para seguir al reloj del
     * montaje; como van a velocidad normal dentro de él, su tiempo y el del montaje avanzan igual y la
     * recolocación (150 ms) sigue midiendo lo mismo.
     */
    rate?: number
  }>(),
  { rate: 1 },
)

/** Sonidos montados a la vez, como mucho (los huecos que suenan de un collage también cuentan). */
const SOUND_POOL = 8
/** <video> de los efectos montados a la vez, como mucho (un collage cuenta lo que tenga de vídeos). */
const VIDEO_BUDGET = 6
/** Se carga lo que empieza en los próximos segundos, para que no tarde en sonar. */
const AHEAD_MS = 3000

function pathOf(item: TrackItem): string | null {
  const p = library.itemPath(item)
  if (!p || store.missing.value[p] || !store.media.value[p]) return null
  return p
}

const resolved = computed(() => {
  const timing = projectTiming(props.project)
  return audibleOrVisible(resolveTracks(props.project, timing)).filter((r) => r.item.collage || pathOf(r.item) !== null)
})

/** ¿Se puede ver este hueco? (tiene fichero, se encuentra y se ha leído). */
function cellReady(c: CollageCell): boolean {
  const path = c.source?.path
  return !!path && !store.missing.value[path] && !!store.media.value[path]
}

/** Lo que cuesta en <video> un efecto: 1, una imagen 0 y un collage sus huecos con vídeo. */
function videoCost(r: ResolvedItem): number {
  if (r.item.collage) return r.item.collage.cells.filter((c) => cellReady(c) && !c.source!.still).length
  return r.item.still ? 0 : 1
}

// La lista de montados cambia cada cuarto de segundo como mucho (no en cada fotograma).
const coarseMs = computed(() => Math.floor(props.currentMs / 250) * 250)

const sounds = computed(() => {
  const t = coarseMs.value
  return resolved.value.filter((r) => r.track.kind === 'sound' && r.startMs <= t + AHEAD_MS && r.shownEndMs > t - 250).slice(0, SOUND_POOL)
})
/** Cuántos de los sonidos montados quedan para los huecos de los collages. */
const soundRoom = computed(() => SOUND_POOL - sounds.value.length)

const selectedId = computed(() => tracks.selectedItemId.value)
const editingBox = computed(() => tracks.boxEditing.value && !!selectedEffect.value)

/** El efecto elegido (aunque no toque en este instante): para «Tamaño y sitio». */
const selectedEffect = computed<ResolvedItem | null>(() => {
  const id = selectedId.value
  if (!id) return null
  const timing = projectTiming(props.project)
  // «El vídeo de este trozo» también se coloca aquí (lo pinta el reproductor, pero el recuadro es el mismo).
  return resolveTracks(props.project, timing).find((r) => r.item.id === id && r.track.kind === 'effect' && (pathOf(r.item) !== null || r.item.source.type === 'clip' || !!r.item.collage)) ?? null
})

const editingCells = computed(() => tracks.cellsEditing.value && !!selectedEffect.value?.item.collage)

const effects = computed(() => {
  const t = coarseMs.value
  // Lo que se ve ahora primero; luego lo que empieza en los próximos 2 s, mientras quede cupo de <video>.
  const candidates = resolved.value
    .filter((r) => r.track.kind === 'effect' && r.startMs <= t + 2000 && r.shownEndMs > t - 250)
    .sort((a, b) => Number(isActive(b, t)) - Number(isActive(a, t)) || a.startMs - b.startMs)
  const list: ResolvedItem[] = []
  let budget = VIDEO_BUDGET
  for (const r of candidates) {
    const cost = videoCost(r)
    if (cost > budget) continue
    list.push(r)
    budget -= cost
  }
  const sel = selectedEffect.value
  if ((editingBox.value || editingCells.value) && sel && sel.item.source.type !== 'clip' && !list.some((r) => r.item.id === sel.item.id)) list.push(sel)
  // De abajo arriba: la primera pista de efectos es la de encima.
  const order = props.project.tracks.filter((x) => x.kind === 'effect').map((x) => x.id)
  return list.sort((a, b) => order.indexOf(b.track.id) - order.indexOf(a.track.id))
})

/** Lo que no tiene sonido: si va más de esto por delante del reloj del montaje, se para a esperarlo (ms). */
const AHEAD_PAUSE_MS = 40
/** …y vuelve a sonar cuando ya solo va esto o menos por delante (ms). */
const WAIT_DONE_MS = 8
/** Más por delante que esto no es el retraso del sonido (un salto, una vuelta que repite): se busca su sitio. */
const WAIT_AHEAD_MAX_MS = 400

const elements = new Map<string, HTMLMediaElement>()
/** Fondo de un hueco vacío y de las bandas de un vídeo «Entero». */
const BG = `#${COLLAGE_BACKGROUND_HEX}`
const sync = ref<Record<string, { expected: number; actual: number | null; active: boolean }>>({})

function register(id: string, el: unknown) {
  if (el instanceof HTMLMediaElement) elements.set(id, el)
  else elements.delete(id)
}

function srcOf(item: TrackItem): string {
  return store.mediaSrc(pathOf(item) ?? '')
}

function mediaSize(item: TrackItem): { width: number; height: number } {
  // El vídeo de un trozo y el collage tienen la forma del marco (el vídeo de un trozo se recorta al centro).
  if (item.source.type === 'clip' || item.collage) return { width: props.frameWidth, height: props.frameHeight }
  const p = pathOf(item)
  const m = p ? store.media.value[p] : null
  return { width: m?.width ?? 0, height: m?.height ?? 0 }
}

/**
 * El recuadro a tamaño 1 y centrado, y `transform` para llevarlo al tamaño y sitio de `box` (el centro va con el
 * puntero y el tamaño desde el centro, como effectRect: el mismo resultado, sin recolocar en cada fotograma).
 */
function rectStyle(item: TrackItem, look: EffectLook, box: EffectBox) {
  const m = mediaSize(item)
  const W = props.frameWidth
  const H = props.frameHeight
  const r = effectRect({ ...look, box: { x: 0.5, y: 0.5, scale: 1 } }, m.width, m.height, W, H)
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    transform: `translate(${(box.x - 0.5) * W}px, ${(box.y - 0.5) * H}px) scale(${box.scale})`,
  }
}

/** Capa de una pista de efectos (la de más abajo, 1), como en el reproductor. */
function layerOf(trackId: string): number {
  const order = props.project.tracks.filter((t) => t.kind === 'effect').map((t) => t.id)
  return order.length - order.indexOf(trackId)
}

/** Instante del elemento que se enseña: el de la línea; en «Tamaño y sitio», sujeto a su tramo. */
function localOf(r: ResolvedItem): number {
  return Math.min(Math.max(0, props.currentMs - r.startMs), Math.max(0, r.shownEndMs - r.startMs))
}

function isActive(r: ResolvedItem, t: number): boolean {
  return t >= r.startMs && t < r.shownEndMs
}

function effectStyle(r: ResolvedItem) {
  const look = r.item.look!
  const t = props.currentMs
  const forced = (editingBox.value || editingCells.value) && r.item.id === selectedId.value
  const active = isActive(r, t) || forced
  const fade = isActive(r, t) ? itemFadeAt(r.item, t - r.startMs, r.shownEndMs - r.startMs) : 1
  return {
    ...rectStyle(r.item, look, boxAt(look, localOf(r))),
    // Entre las capas de las pistas (el vídeo de un trozo encima, del reproductor, va en la suya).
    zIndex: String(10 + layerOf(r.track.id)),
    mixBlendMode: look.mix === 'light' ? ('screen' as const) : ('normal' as const),
    opacity: String(active ? look.opacity * fade : 0),
    visibility: active ? ('visible' as const) : ('hidden' as const),
  }
}

/** Lleva un elemento a donde le toca, con su volumen; lo pone a sonar o en pausa. */
function syncOne(r: ResolvedItem, exact: boolean) {
  const el = elements.get(r.item.id)
  const t = props.currentMs
  const local = t - r.startMs
  const length = r.shownEndMs - r.startMs
  const forced = editingBox.value && r.item.id === selectedId.value
  const active = isActive(r, t)
  const expected = itemSourceTimeAt(r.item, Math.max(0, local))
  const record = { expected: Math.round(expected), actual: el && el.readyState >= 1 ? Math.round(el.currentTime * 1000) : null, active }
  sync.value[r.item.id] = record
  if (!el || el.readyState < 1 || r.item.still) return
  const rate = mediaRate(1, props.rate)
  if (el.playbackRate !== rate) {
    el.defaultPlaybackRate = rate
    el.playbackRate = rate
  }
  const sounding = r.track.kind === 'sound' || (r.item.volume > 0 && r.item.hasAudio)
  // El navegador no pasa de 1: lo que esté por encima del 100 % solo se oye más fuerte al guardar.
  el.volume = sounding && active ? Math.min(1, Math.max(0, r.item.volume * itemFadeAt(r.item, local, length))) : 0
  el.muted = !sounding
  if (!active) {
    if (!el.paused) el.pause()
    // Lo que va a empezar, ya colocado en su principio (o el elegido en «Tamaño y sitio», en su primer instante).
    if ((local < 0 || forced) && !el.seeking && Math.abs(el.currentTime * 1000 - itemSourceTimeAt(r.item, 0)) > 45) {
      el.currentTime = itemSourceTimeAt(r.item, 0) / 1000
    }
    return
  }
  if (props.playing) {
    // Un fichero sin sonido corre con el reloj de pared y arranca al momento; el reloj del montaje (el <video>
    // del trozo, con su sonido) va por lo que ya se oye, así que arranca más tarde y se queda atrás lo que tarda
    // el sonido en salir. Medido: el efecto iba siempre por delante unos 60 ms × el ritmo (64 ms a 1×, 115 a
    // 1,5×, 135 a 2×), por debajo de los 150 ms de recolocar. Por eso lo que no tiene sonido espera a que el
    // reloj se mueva para arrancar y, si aun así se adelanta, se para un momento (sin buscar) hasta que el reloj
    // lo alcanza.
    const silentClock = !r.item.hasAudio
    const ahead = el.currentTime * 1000 - expected
    if (el.paused) {
      if (silentClock && (clockWaiting() || (ahead > WAIT_DONE_MS && ahead <= WAIT_AHEAD_MAX_MS))) return
      // En pausa ya se dejó en su sitio: buscar otra vez tarda y el reloj del montaje no espera, así que
      // empezaría desplazado lo que tarde la búsqueda × el ritmo, sin llegar a recolocarse.
      if (!el.seeking && Math.abs(ahead) > 45) el.currentTime = expected / 1000
      void el.play().catch(() => {})
    } else if (silentClock && !el.seeking && ahead > AHEAD_PAUSE_MS && ahead <= WAIT_AHEAD_MAX_MS) {
      el.pause()
    } else if (!el.seeking && Math.abs(ahead) > COVER_DRIFT_TOLERANCE_MS) {
      el.currentTime = expected / 1000
    }
  } else {
    if (!el.paused) el.pause()
    if (!el.seeking && (exact || Math.abs(el.currentTime * 1000 - expected) > 45)) {
      if (Math.abs(el.currentTime * 1000 - expected) > 20) el.currentTime = expected / 1000
    }
  }
}

// ------------------------------------------------------------------ collage

/** Los huecos del collage en el marco (px de pantalla; el recuadro a tamaño 1 es el marco entero). */
function collageCells(r: ResolvedItem) {
  const c = r.item.collage!
  const layout = layoutById(c.layoutId)
  if (!layout) return []
  const W = props.frameWidth
  const H = props.frameHeight
  return cellRects(layout, W, H, c.gap).map((rect, i) => {
    const cell = c.cells[i]!
    const ready = cellReady(cell)
    const m = ready ? store.media.value[cell.source!.path]! : null
    const content = m ? cellContentLayout(cell, m.width, m.height, rect.width, rect.height) : null
    return {
      i,
      key: `${r.item.id}:${i}`,
      cell,
      ready,
      still: !!cell.source?.still,
      rectStyle: { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` },
      contentStyle: content ? { left: `${content.left}px`, top: `${content.top}px`, width: `${content.width}px`, height: `${content.height}px` } : {},
      src: ready ? store.cellSrc(cell.source!.path) : '',
    }
  })
}

function collageStyle(r: ResolvedItem) {
  return { ...effectStyle(r), background: `#${COLLAGE_GAP_HEX[r.item.collage!.gap]}` }
}

/** Los huecos que suenan, dentro del cupo de sonidos montados (los de los collages más cercanos primero). */
const soundingCellKeys = computed(() => {
  const keys = new Set<string>()
  let room = soundRoom.value
  for (const r of effects.value) {
    if (!r.item.collage) continue
    r.item.collage.cells.forEach((c, i) => {
      if (room > 0 && cellSounds(c) && cellReady(c)) {
        keys.add(`${r.item.id}:${i}`)
        room--
      }
    })
  }
  return keys
})

/** Lleva cada hueco de un collage a su instante (a velocidad normal; quieto en su última imagen) con su sonido. */
function syncCollage(r: ResolvedItem, exact: boolean) {
  const c = r.item.collage!
  const t = props.currentMs
  const local = t - r.startMs
  const length = r.shownEndMs - r.startMs
  const active = isActive(r, t)
  const forced = editingCells.value && r.item.id === selectedId.value
  const collageMs = r.item.phaseMs + Math.max(0, Math.min(local, length))
  c.cells.forEach((cell, i) => {
    const key = `${r.item.id}:${i}`
    const el = elements.get(key)
    const at = cellTimeAt(cell, collageMs)
    if (!at || cell.source?.still) return
    const expected = at.ms
    sync.value[key] = { expected, actual: el && el.readyState >= 1 ? Math.round(el.currentTime * 1000) : null, active }
    if (!el || el.readyState < 1) return
    const rate = mediaRate(1, props.rate)
    if (el.playbackRate !== rate) {
      el.defaultPlaybackRate = rate
      el.playbackRate = rate
    }
    const sounding = soundingCellKeys.value.has(key)
    el.muted = !sounding
    el.volume = sounding && active && !at.frozen ? Math.min(1, Math.max(0, cell.volume * itemFadeAt(r.item, local, length))) : 0
    // Quieto: en su última imagen (o el collage aún no empieza / ya acabó): parado en su sitio, sin buscar otra vez.
    if (!active || at.frozen || !props.playing) {
      if (!el.paused) el.pause()
      const want = !active && !forced && local < 0 ? (cellTimeAt(cell, r.item.phaseMs)?.ms ?? 0) : expected
      if (!el.seeking && (exact || Math.abs(el.currentTime * 1000 - want) > 45) && Math.abs(el.currentTime * 1000 - want) > 20) el.currentTime = want / 1000
      return
    }
    const ahead = el.currentTime * 1000 - expected
    const silentClock = !sounding
    if (el.paused) {
      if (silentClock && (clockWaiting() || (ahead > WAIT_DONE_MS && ahead <= WAIT_AHEAD_MAX_MS))) return
      if (!el.seeking && Math.abs(ahead) > 45) el.currentTime = expected / 1000
      void el.play().catch(() => {})
    } else if (silentClock && !el.seeking && ahead > AHEAD_PAUSE_MS && ahead <= WAIT_AHEAD_MAX_MS) {
      el.pause()
    } else if (!el.seeking && Math.abs(ahead) > COVER_DRIFT_TOLERANCE_MS) {
      el.currentTime = expected / 1000
    }
  })
}

/** Un hueco que el <video> no sabe reproducir (o que es muy grande) pide su copia pequeña. */
function onCellMetadata(r: ResolvedItem, i: number, e: Event) {
  const cell = r.item.collage?.cells[i]
  const path = cell?.source?.path
  const m = path ? store.media.value[path] : null
  const el = e.target as HTMLVideoElement
  if (path && ((m && needsCellProxy(m)) || el.videoWidth === 0)) void store.ensureCellProxy(path)
  syncCollage(r, true)
}

function onCellError(r: ResolvedItem, i: number) {
  const path = r.item.collage?.cells[i]?.source?.path
  if (path) void store.ensureCellProxy(path)
}

function syncAll(exact = false) {
  for (const r of sounds.value) syncOne(r, exact)
  for (const r of effects.value) {
    if (r.item.collage) syncCollage(r, exact)
    else syncOne(r, exact)
  }
  syncTrying(exact)
}

/** Dónde estaba el reloj del montaje al darle a reproducir, hasta que se mueve (null: ya se mueve, o parado). */
let playStartMs: number | null = null
const clockWaiting = () => props.playing && playStartMs !== null && props.currentMs === playStartMs

watch(
  () => props.currentMs,
  (ms) => {
    if (playStartMs !== null && ms !== playStartMs) playStartMs = null
    syncAll(false)
  },
)
watch(
  () => props.playing,
  (playing) => {
    playStartMs = playing ? props.currentMs : null
    syncAll(true)
  },
)
// Cambiar el ritmo de repaso: todo lo montado, al nuevo ritmo y en su sitio.
watch(
  () => props.rate,
  () => syncAll(false),
)
// Silenciar u ocultar una pista, cambiar el volumen…: al momento.
watch([sounds, effects, () => props.project], () => void nextTick(() => syncAll(true)))

function onMetadata(r: ResolvedItem) {
  syncOne(r, true)
}

// ------------------------------------------------------------------ «Probar sobre mi vídeo»

const tryingEl = ref<HTMLVideoElement | null>(null)
const trying = computed(() => tracks.trying.value)
const tryingLook = computed<EffectLook>(() => {
  const d = trying.value?.asset.defaults.look
  return { mix: d?.mix ?? 'normal', opacity: d?.opacity ?? 1, fit: d?.fit ?? 'cover', box: { x: 0.5, y: 0.5, scale: 1, ...d?.box }, keyframes: [], rounded: false }
})
const tryingStyle = computed(() => {
  const t = trying.value
  if (!t) return {}
  const r = effectRect(tryingLook.value, t.asset.width ?? 0, t.asset.height ?? 0, props.frameWidth, props.frameHeight)
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    mixBlendMode: tryingLook.value.mix === 'light' ? ('screen' as const) : ('normal' as const),
    opacity: String(tryingLook.value.opacity),
  }
})

function syncTrying(_exact: boolean) {
  const el = tryingEl.value
  if (!el) return
  // Se repite solo mientras se prueba, siga o no el vídeo.
  if (el.paused) void el.play().catch(() => {})
}

// ------------------------------------------------------------------ «Tamaño y sitio»

/**
 * El recuadro de «Tamaño y sitio»: la parte del efecto que cae dentro del marco (si se sale, las esquinas se
 * quedan dentro y se pueden seguir cogiendo). El tamaño depende de la distancia al centro de verdad.
 */
const editRect = computed(() => {
  const r = selectedEffect.value
  if (!r || !editingBox.value) return null
  const m = mediaSize(r.item)
  const look = r.item.look!
  const e = effectRect({ ...look, box: boxAt(look, localOf(r)) }, m.width, m.height, props.frameWidth, props.frameHeight)
  const left = Math.max(0, e.left)
  const top = Math.max(0, e.top)
  const right = Math.min(props.frameWidth, e.left + e.width)
  const bottom = Math.min(props.frameHeight, e.top + e.height)
  if (right - left < 12 || bottom - top < 12) return { left: '0px', top: '0px', width: `${props.frameWidth}px`, height: `${props.frameHeight}px` }
  return { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` }
})

let drag: { mode: 'move' | 'scale'; x: number; y: number; box: EffectLook['box']; cx: number; cy: number; dist: number; local: number } | null = null

/** Las marcas que se ven, en la vista previa mientras se edita: dónde estará en cada una (con su número). */
const markDots = computed(() => {
  const r = selectedEffect.value
  if (!r || !editingBox.value) return []
  const look = r.item.look!
  const here = localOf(r)
  return visibleMarks(look, r.shownEndMs - r.startMs).map((k, i) => ({
    n: i + 1,
    left: `${k.box.x * props.frameWidth}px`,
    top: `${k.box.y * props.frameHeight}px`,
    here: Math.abs(k.atMs - here) <= 120,
  }))
})

function boxDown(mode: 'move' | 'scale', e: PointerEvent) {
  const r = selectedEffect.value
  if (!r || e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const host = (e.currentTarget as HTMLElement).closest('.track-layers') as HTMLElement
  const rect = host.getBoundingClientRect()
  // Se edita el valor de este instante (con marcas, el de la marca de la línea; si no la hay, se crea).
  const local = localOf(r)
  const box = boxAt(r.item.look!, local)
  const cx = rect.left + box.x * props.frameWidth
  const cy = rect.top + box.y * props.frameHeight
  drag = { mode, x: e.clientX, y: e.clientY, box: { ...box }, cx, cy, dist: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)), local }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function boxMove(e: PointerEvent) {
  const r = selectedEffect.value
  if (!drag || !r) return
  if (drag.mode === 'move') {
    tracks.previewBoxAt(r.item.id, drag.local, moveEffectBox(drag.box, props.frameWidth, props.frameHeight, e.clientX - drag.x, e.clientY - drag.y))
  } else {
    // El tamaño sigue a la distancia del puntero al centro.
    const k = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) / drag.dist
    const scale = Math.min(MAX_EFFECT_SCALE, Math.max(MIN_EFFECT_SCALE, Math.round(drag.box.scale * k * 100) / 100))
    tracks.previewBoxAt(r.item.id, drag.local, { ...drag.box, scale })
  }
}

function boxUp() {
  if (!drag) return
  drag = null
  store.commitPreview()
}

onBeforeUnmount(() => {
  for (const el of elements.values()) {
    el.pause()
    el.removeAttribute('src')
    el.load()
  }
})

/** Dónde está ahora el collage elegido (para «Huecos»): su recuadro en el instante de la línea. */
const cellsRect = computed(() => {
  const r = selectedEffect.value
  if (!r || !editingCells.value) return null
  const look = r.item.look!
  return effectRect({ ...look, box: boxAt(look, localOf(r)) }, props.frameWidth, props.frameHeight, props.frameWidth, props.frameHeight)
})

defineExpose({ sync })

/** Para las pruebas: cuánto dura en pantalla cada elemento montado. */
function lengthOf(r: ResolvedItem): number {
  return itemLengthMs(r.item, r.startMs, Number.POSITIVE_INFINITY)
}
</script>

<template>
  <div class="track-layers" :class="{ editing: editingBox || editingCells }" data-testid="track-layers" :data-sync="JSON.stringify(sync)">
    <template v-for="r in effects" :key="r.item.id">
      <div v-if="r.item.collage" class="fx collage" :style="collageStyle(r)" :data-item-id="r.item.id" data-testid="track-collage">
        <div
          v-for="c in collageCells(r)"
          :key="c.key"
          class="cell"
          :style="{ ...c.rectStyle, background: BG }"
          :data-cell="c.i"
          data-testid="collage-cell"
        >
          <template v-if="c.ready">
            <img v-if="c.still" class="cell-media" :src="c.src" :style="c.contentStyle" alt="" draggable="false" />
            <video
              v-else
              :ref="(el) => register(c.key, el)"
              class="cell-media"
              :src="c.src"
              :style="c.contentStyle"
              :data-cell-key="c.key"
              data-testid="collage-cell-video"
              muted
              preload="auto"
              playsinline
              disablepictureinpicture
              disableremoteplayback
              @loadedmetadata="onCellMetadata(r, c.i, $event)"
              @error="onCellError(r, c.i)"
            />
          </template>
        </div>
      </div>
      <img
        v-else-if="r.item.still"
        class="fx"
        :src="srcOf(r.item)"
        :style="effectStyle(r)"
        :data-item-id="r.item.id"
        data-testid="track-effect"
        alt=""
        draggable="false"
      />
      <video
        v-else
        :ref="(el) => register(r.item.id, el)"
        class="fx"
        :src="srcOf(r.item)"
        :style="effectStyle(r)"
        :data-item-id="r.item.id"
        :data-start-ms="r.startMs"
        :data-length-ms="lengthOf(r)"
        data-testid="track-effect"
        muted
        preload="auto"
        playsinline
        disablepictureinpicture
        disableremoteplayback
        @loadedmetadata="onMetadata(r)"
      />
    </template>
    <video
      v-if="trying"
      ref="tryingEl"
      class="fx trying"
      :src="store.mediaSrc(trying.path)"
      :style="tryingStyle"
      data-testid="trying-effect"
      muted
      loop
      autoplay
      playsinline
    />
    <audio
      v-for="r in sounds"
      :key="r.item.id"
      :ref="(el) => register(r.item.id, el)"
      :src="srcOf(r.item)"
      :data-item-id="r.item.id"
      :data-start-ms="r.startMs"
      data-testid="track-sound"
      preload="auto"
      @loadedmetadata="onMetadata(r)"
    />
    <span
      v-for="d in markDots"
      :key="d.n"
      class="mark-dot"
      :class="{ here: d.here }"
      :style="{ left: d.left, top: d.top }"
      data-testid="mark-dot"
      aria-hidden="true"
    >{{ d.n }}</span>
    <CollageCells v-if="cellsRect && selectedEffect" :item="selectedEffect.item" :rect="cellsRect" />
    <div
      v-if="editRect"
      class="box-editor"
      :style="editRect"
      data-testid="box-editor"
      @pointerdown="boxDown('move', $event)"
      @pointermove="boxMove"
      @pointerup="boxUp"
      @pointercancel="boxUp"
    >
      <span
        v-for="corner in ['tl', 'tr', 'bl', 'br']"
        :key="corner"
        class="handle"
        :class="corner"
        :data-testid="`box-handle-${corner}`"
        @pointerdown="boxDown('scale', $event)"
        @pointermove="boxMove"
        @pointerup="boxUp"
        @pointercancel="boxUp"
      />
    </div>
  </div>
</template>

<style scoped>
.track-layers {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* El recuadro de «Tamaño y sitio» puede salirse del marco: se recorta como al guardar. */
  overflow: hidden;
}
.track-layers.editing {
  pointer-events: auto;
}
.fx {
  position: absolute;
  object-fit: fill;
  pointer-events: none;
  transform-origin: center;
}
.collage {
  overflow: hidden;
}
.cell {
  position: absolute;
  overflow: hidden;
}
.cell-media {
  position: absolute;
  object-fit: fill;
  pointer-events: none;
}
.mark-dot {
  position: absolute;
  width: 22px;
  height: 22px;
  margin: -11px 0 0 -11px;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.85);
  color: #1d2b36;
  border: 2px solid var(--accent);
  font-size: 12px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  pointer-events: none;
  z-index: 41;
}
.mark-dot.here {
  background: var(--accent);
  color: #fff;
}
.box-editor {
  position: absolute;
  z-index: 40;
  outline: 2px dashed #fff;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.6),
    0 0 0 9999px rgb(0 0 0 / 0.18);
  cursor: move;
  touch-action: none;
}
.handle {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid var(--accent);
  box-shadow: 0 1px 6px rgb(0 0 0 / 0.5);
  touch-action: none;
}
/* Las esquinas, hacia dentro: así no las recorta el borde del marco. */
.handle.tl {
  left: 2px;
  top: 2px;
  cursor: nwse-resize;
}
.handle.tr {
  right: 2px;
  top: 2px;
  cursor: nesw-resize;
}
.handle.bl {
  left: 2px;
  bottom: 2px;
  cursor: nesw-resize;
}
.handle.br {
  right: 2px;
  bottom: 2px;
  cursor: nwse-resize;
}
</style>
