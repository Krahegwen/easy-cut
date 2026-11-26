<script setup lang="ts">
// Vista de pistas (la única de «Tu vídeo»): regla de tiempo, filas proporcionales al tiempo y el cabezal que
// las cruza todas. Arriba, las pistas de efectos (la de más arriba se ve encima); en medio, la fila «Vídeo» con
// los trozos (se eligen, se reordenan arrastrando y se recortan o alargan por sus asas; cada uno con sus
// indicadores) y, al final, «Añadir vídeos o sonidos» y «Grabarme»; debajo, las de sonido con su forma de onda,
// y al pie, los botones para crear pistas nuevas. Los elementos se arrastran (también a otra pista del mismo
// tipo), se recortan o alargan por sus asas y se pegan con imanes (principio y final de los trozos, el cabezal
// y los demás elementos) dibujando una línea guía. Con muchas pistas, se desplaza hacia abajo.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  attachedCounts,
  clipInOut,
  formatClock,
  formatDuration,
  formatDurationChange,
  itemLoopMs,
  projectTiming,
  resolveTracks,
  snapMove,
  snapPoints,
  snapTime,
  visibleMarks,
  type BoxKeyframe,
  type Clip,
  type ResolvedItem,
  type Track,
} from '../../domain'
import { reapplyPauses } from '../../lib/pauses'
import { library, store, tracks } from '../../store'
import AppIcon from '../AppIcon.vue'
import KeyHint from '../KeyHint.vue'
import ThumbImage from '../ThumbImage.vue'
import TrackHeader from './TrackHeader.vue'

const props = defineProps<{ playheadMs: number; playing: boolean }>()
const emit = defineEmits<{ seek: [ms: number]; add: []; record: [] }>()

const project = computed(() => store.project.value)
const timing = computed(() => projectTiming(project.value))
const totalMs = computed(() => Math.max(1, timing.value.totalMs))
const effectTracks = computed(() => project.value.tracks.filter((t) => t.kind === 'effect'))
const soundTracks = computed(() => project.value.tracks.filter((t) => t.kind === 'sound'))
const byTrack = computed(() => {
  const map = new Map<string, ResolvedItem[]>()
  for (const r of resolveTracks(project.value, timing.value)) {
    const list = map.get(r.track.id) ?? []
    list.push(r)
    map.set(r.track.id, list)
  }
  return map
})

// ------------------------------------------------------------------ zoom

const scroller = ref<HTMLDivElement | null>(null)
const viewWidth = ref(800)
const HEADER = computed(() => (viewWidth.value < 1000 ? 168 : 196))
/** Píxeles por segundo. null = «Ver todo» (se ajusta al ancho). */
const zoom = ref<number | null>(null)
const ZOOMS = [2, 3, 5, 8, 12, 20, 32, 50, 80, 128, 200]
/**
 * Sitio al final de la fila «Vídeo» para «Añadir vídeos o sonidos» y «Grabarme»: con «Ver todo» se ven justo
 * detrás del último trozo; con zoom, se quedan pegados al borde derecho de la vista.
 */
const END_ROOM = 300
const fitPx = computed(() => Math.max(0.5, (viewWidth.value - HEADER.value - END_ROOM - 12) / (totalMs.value / 1000)))
/** Escala congelada mientras se recorta un trozo (con «Ver todo», la regla cambiaría bajo el puntero). */
const frozenPx = ref<number | null>(null)
const pxPerSec = computed(() => zoom.value ?? frozenPx.value ?? fitPx.value)
const x = (ms: number) => (ms / 1000) * pxPerSec.value
const ms = (px: number) => (px / pxPerSec.value) * 1000
const contentWidth = computed(() => Math.max(viewWidth.value - HEADER.value, x(totalMs.value) + END_ROOM + 12))

function zoomBy(direction: 1 | -1, anchorMs = props.playheadMs) {
  const current = pxPerSec.value
  const next = direction > 0 ? ZOOMS.find((z) => z > current * 1.05) : [...ZOOMS].reverse().find((z) => z < current / 1.05)
  if (next === undefined) return
  // «Alejar» hasta que todo cabe vuelve a «Ver todo».
  zoom.value = direction < 0 && next <= fitPx.value ? null : next
  void nextTick(() => centerOn(anchorMs))
}
function fitAll() {
  zoom.value = null
  void nextTick(() => scroller.value?.scrollTo({ left: 0 }))
}
function centerOn(t: number) {
  const s = scroller.value
  if (!s) return
  s.scrollLeft = Math.max(0, x(t) - (s.clientWidth - HEADER.value) / 2)
}
const canZoomIn = computed(() => pxPerSec.value < ZOOMS[ZOOMS.length - 1]!)
const canZoomOut = computed(() => zoom.value !== null)

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey) return
  e.preventDefault()
  const s = scroller.value!
  const r = s.getBoundingClientRect()
  zoomBy(e.deltaY < 0 ? 1 : -1, ms(e.clientX - r.left - HEADER.value + s.scrollLeft))
}

// ------------------------------------------------------------------ regla

const ticks = computed(() => {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const minPx = 72
  const step = steps.find((s) => s * pxPerSec.value >= minPx) ?? 600
  const out: { ms: number; label: string }[] = []
  for (let t = 0; t <= totalMs.value + step * 1000; t += step * 1000) out.push({ ms: t, label: formatClock(t) })
  return out
})

let scrubbing = false
function rulerDown(e: PointerEvent) {
  if (e.button !== 0) return
  scrubbing = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  seekAt(e)
}
function rulerMove(e: PointerEvent) {
  if (scrubbing) seekAt(e)
}
function rulerUp() {
  scrubbing = false
}
function seekAt(e: PointerEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('seek', Math.min(totalMs.value, Math.max(0, ms(e.clientX - r.left))))
}

// El cabezal no se sale de la vista mientras suena.
watch(
  () => props.playheadMs,
  (t) => {
    const s = scroller.value
    if (!s || !props.playing || dragState.value) return
    const visible = s.clientWidth - HEADER.value
    const px = x(t)
    if (px < s.scrollLeft || px > s.scrollLeft + visible - 40) s.scrollLeft = Math.max(0, px - 60)
  },
)

// ------------------------------------------------------------------ fila «Vídeo»: trozos

function clipThumbTime(c: Clip): number {
  const io = clipInOut(c)
  return Math.min(io.startMs + 400, Math.max(io.startMs, io.endMs - 100))
}
function clipShowsThumb(c: Clip): boolean {
  if (store.missing.value[c.sourcePath]) return false
  return c.picture.kind === 'own' ? c.sourceHasVideo : c.picture.kind === 'cover' && !store.coverMissing(c)
}
function clipThumbPath(c: Clip): string {
  return c.picture.kind === 'cover' ? c.picture.sourcePath : c.sourcePath
}
/** Miniatura de cada trozo, repetida a lo largo de su bloque (como una tira de película). */
const clipThumbs = ref<Record<string, string>>({})
function thumbKey(c: Clip): string {
  return `${clipThumbPath(c)}|${clipThumbTime(c)}`
}
watch(
  () => project.value.clips.map((c) => (clipShowsThumb(c) ? thumbKey(c) : '')).join(','),
  () => {
    for (const c of project.value.clips) {
      if (!clipShowsThumb(c)) continue
      const key = thumbKey(c)
      if (clipThumbs.value[key]) continue
      void store.thumbnail(clipThumbPath(c), clipThumbTime(c), 64).then((t) => {
        if (t) clipThumbs.value = { ...clipThumbs.value, [key]: t.url }
      })
    }
  },
  { immediate: true },
)
function clipThumbStyle(c: Clip) {
  const url = clipShowsThumb(c) ? clipThumbs.value[thumbKey(c)] : undefined
  return url ? { backgroundImage: `url("${url}")` } : {}
}

type ClipPicture = 'own' | 'sound' | 'cover' | 'lost' | 'cover-lost'
/** Lo que enseña el bloque: su imagen, la del vídeo de encima, «solo se oye» o el aviso de original perdido. */
function clipPicture(c: Clip): ClipPicture {
  if (store.missing.value[c.sourcePath]) return 'lost'
  if (c.picture.kind === 'cover') return store.coverMissing(c) ? 'cover-lost' : 'cover'
  return c.picture.kind === 'none' || !c.sourceHasVideo ? 'sound' : 'own'
}
type BadgeId = 'speed' | 'mute' | 'pauses' | 'cover' | 'sound' | 'attached' | 'fades'
interface Badge {
  id: BadgeId
  icon: 'speed' | 'mute' | 'pauses' | 'cover-video' | 'wave' | 'tracks' | 'fade-in'
  text: string
}
const attached = computed(() => attachedCounts(project.value))
/** Indicadores de cada trozo (lo que decían sus tarjetas): velocidad, sin sonido, sin pausas, imagen, pegados. */
function clipBadges(c: Clip): Badge[] {
  const out: Badge[] = []
  if (c.speed !== 1) out.push({ id: 'speed', icon: 'speed', text: c.speed < 1 ? 'Despacio' : c.speed === 4 ? 'Muy rápido' : 'Rápido' })
  if (c.muted || c.speed === 4) out.push({ id: 'mute', icon: 'mute', text: 'Sin sonido' })
  if (c.segments.length > 1) out.push({ id: 'pauses', icon: 'pauses', text: 'Sin pausas' })
  const pic = clipPicture(c)
  if (pic === 'cover') out.push({ id: 'cover', icon: 'cover-video', text: 'Vídeo encima' })
  if (pic === 'sound') out.push({ id: 'sound', icon: 'wave', text: 'Solo se oye' })
  if (c.fadeInMs > 0 || c.fadeOutMs > 0) {
    const text = c.fadeInMs > 0 && c.fadeOutMs > 0 ? 'Aparece y desaparece poco a poco' : c.fadeInMs > 0 ? 'Aparece poco a poco' : 'Desaparece poco a poco'
    out.push({ id: 'fades', icon: 'fade-in', text })
  }
  const a = attached.value.get(c.id)
  if (a) {
    const parts: string[] = []
    if (a.sounds) parts.push(a.sounds === 1 ? '1 sonido' : `${a.sounds} sonidos`)
    if (a.effects) parts.push(a.effects === 1 ? '1 efecto' : `${a.effects} efectos`)
    out.push({ id: 'attached', icon: 'tracks', text: `Lleva pegado ${parts.join(' y ')}` })
  }
  return out
}
function lostText(c: Clip): string | null {
  const pic = clipPicture(c)
  return pic === 'lost' ? 'No encuentro este vídeo' : pic === 'cover-lost' ? 'No encuentro el vídeo de encima' : null
}
/** Nombre accesible (y lo que leen las pruebas): número, duración, aviso e indicadores. */
function clipLabel(c: Clip, i: number): string {
  const extra = [lostText(c), ...clipBadges(c).map((b) => b.text)].filter((t): t is string => !!t).map((t) => t.toLowerCase())
  return `Trozo ${i + 1}, dura ${formatDuration(timing.value.lengths[i]!)}${extra.length ? `: ${extra.join(', ')}` : ''}`
}

const clipDrag = ref<{ id: string; startX: number; x: number; active: boolean; target: number } | null>(null)
const clipBlocks = ref<HTMLElement | null>(null)

function clipDown(c: Clip, e: PointerEvent) {
  if (e.button !== 0) return
  tracks.select(null)
  store.select(c.id)
  clipDrag.value = { id: c.id, startX: e.clientX, x: e.clientX, active: false, target: project.value.clips.indexOf(c) }
  window.addEventListener('pointermove', clipMove)
  window.addEventListener('pointerup', clipUp)
  window.addEventListener('pointercancel', clipCancel)
}
function clipTarget(clientX: number, id: string): number {
  const host = clipBlocks.value
  if (!host) return 0
  const left = host.getBoundingClientRect().left
  let index = 0
  project.value.clips.forEach((c, i) => {
    if (c.id === id) return
    const mid = x(timing.value.starts[i]! + timing.value.lengths[i]! / 2)
    if (clientX - left > mid) index++
  })
  return index
}
function clipMove(e: PointerEvent) {
  const d = clipDrag.value
  if (!d) return
  d.x = e.clientX
  if (!d.active && Math.abs(d.x - d.startX) > 8) d.active = true
  if (d.active) d.target = clipTarget(d.x, d.id)
}
function clipUp() {
  const d = clipDrag.value
  clipCancel()
  if (!d?.active) return
  const from = project.value.clips.findIndex((c) => c.id === d.id)
  if (from >= 0 && d.target !== from) store.moveTo(d.id, d.target)
}
function clipCancel() {
  clipDrag.value = null
  window.removeEventListener('pointermove', clipMove)
  window.removeEventListener('pointerup', clipUp)
  window.removeEventListener('pointercancel', clipCancel)
}
// ------------------------------------------------------------------ fila «Vídeo»: recortar por las asas

/**
 * Tirar del asa del principio o del final de un trozo lo acorta o lo alarga (hasta donde dé el original); los
 * siguientes se recolocan. Se ve al momento, con el texto de cuánto duran el trozo y el vídeo, y entra en el
 * historial al soltar (un solo paso). Con pausas quitadas, se vuelven a quitar en lo que se alarga.
 */
const clipTrim = ref<{ id: string; edge: 'start' | 'end'; startX: number; active: boolean; beforeClipMs: number; beforeTotalMs: number } | null>(null)

function clipHandleDown(c: Clip, edge: 'start' | 'end', e: PointerEvent) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  tracks.select(null)
  store.select(c.id)
  const i = project.value.clips.indexOf(c)
  if (zoom.value === null) frozenPx.value = fitPx.value
  clipTrim.value = { id: c.id, edge, startX: e.clientX, active: false, beforeClipMs: timing.value.lengths[i] ?? 0, beforeTotalMs: timing.value.totalMs }
  window.addEventListener('pointermove', clipTrimMove)
  window.addEventListener('pointerup', clipTrimUp)
  window.addEventListener('pointercancel', clipTrimCancel)
}
function clipTrimMove(e: PointerEvent) {
  const t = clipTrim.value
  if (!t) return
  if (!t.active && Math.abs(e.clientX - t.startX) > 3) t.active = true
  if (!t.active) return
  const id = t.id
  tracks.previewClipTrim(id, t.edge, Math.round(ms(e.clientX - t.startX)), (p) => reapplyPauses(p, id))
}
function clipTrimUp() {
  const t = clipTrim.value
  stopClipTrim()
  if (t?.active) store.commitPreview()
}
function clipTrimCancel() {
  stopClipTrim()
  store.cancelPreview()
}
function stopClipTrim() {
  clipTrim.value = null
  frozenPx.value = null
  window.removeEventListener('pointermove', clipTrimMove)
  window.removeEventListener('pointerup', clipTrimUp)
  window.removeEventListener('pointercancel', clipTrimCancel)
}
/** «Trozo 2: 10 s → 8 s · Vídeo: 36 s → 34 s» mientras se recorta. */
const trimLive = computed(() => {
  const t = clipTrim.value
  if (!t?.active) return null
  const i = project.value.clips.findIndex((c) => c.id === t.id)
  if (i < 0) return null
  return `Trozo ${i + 1}: ${formatDurationChange(t.beforeClipMs, timing.value.lengths[i]!)} · Vídeo: ${formatDurationChange(t.beforeTotalMs, timing.value.totalMs)}`
})

/** Dónde se dibuja la marca de «aquí caerá» al reordenar (px desde el principio). */
const clipDropX = computed(() => {
  const d = clipDrag.value
  if (!d?.active) return null
  const others = project.value.clips.map((c, i) => ({ c, i })).filter((o) => o.c.id !== d.id)
  const before = others[d.target]
  return before ? x(timing.value.starts[before.i]!) : x(totalMs.value)
})

// ------------------------------------------------------------------ elementos: arrastrar y recortar

type DragMode = 'move' | 'start' | 'end'
const dragState = ref<{ id: string; mode: DragMode; startX: number; startY: number; origStart: number; origEnd: number; trackId: string; active: boolean; fits: boolean } | null>(null)
const guideMs = ref<number | null>(null)
/** Lo que tardó en dibujarse el último paso de un arrastre (ms), para medir la soltura. */
const lastDragRenderMs = ref(0)
const rowEls = new Map<string, HTMLElement>()

function setRow(id: string, el: unknown) {
  if (el instanceof HTMLElement) rowEls.set(id, el)
  else rowEls.delete(id)
}

function itemDown(r: ResolvedItem, mode: DragMode, e: PointerEvent) {
  if (e.button !== 0) return
  e.stopPropagation()
  tracks.select(r.item.id)
  dragState.value = { id: r.item.id, mode, startX: e.clientX, startY: e.clientY, origStart: r.startMs, origEnd: r.endMs, trackId: r.track.id, active: false, fits: true }
  window.addEventListener('pointermove', itemMove)
  window.addEventListener('pointerup', itemUp)
  window.addEventListener('pointercancel', itemCancel)
}

/** Pista del mismo tipo bajo el puntero (o la suya). */
function trackUnder(clientY: number, kind: Track['kind'], fallback: string): string {
  for (const t of project.value.tracks) {
    if (t.kind !== kind) continue
    const el = rowEls.get(t.id)
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (clientY >= r.top && clientY < r.bottom) return t.id
  }
  return fallback
}

function itemMove(e: PointerEvent) {
  const d = dragState.value
  if (!d) return
  if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4) d.active = true
  if (!d.active) return
  const t0 = performance.now()
  const base = store.history.value.present
  const points = snapPoints(base, props.playheadMs, d.id)
  const threshold = ms(9)
  const dms = ms(e.clientX - d.startX)
  if (d.mode === 'move') {
    const kind = project.value.tracks.find((t) => t.id === d.trackId)!.kind
    const target = trackUnder(e.clientY, kind, d.trackId)
    const snapped = snapMove(points, d.origStart + dms, d.origEnd - d.origStart, threshold)
    guideMs.value = snapped.guideMs
    d.fits = tracks.previewMove(d.id, Math.max(0, snapped.timeMs), target)
  } else {
    const edge = d.mode === 'start' ? d.origStart : d.origEnd
    const snapped = snapTime(points, edge + dms, threshold)
    guideMs.value = snapped.guideMs
    tracks.previewTrim(d.id, d.mode, snapped.timeMs)
  }
  void nextTick(() => (lastDragRenderMs.value = Math.round((performance.now() - t0) * 10) / 10))
}

function itemUp() {
  const d = dragState.value
  stopItemDrag()
  if (d?.active) store.commitPreview()
}
function itemCancel() {
  stopItemDrag()
  store.cancelPreview()
}
function stopItemDrag() {
  dragState.value = null
  guideMs.value = null
  window.removeEventListener('pointermove', itemMove)
  window.removeEventListener('pointerup', itemUp)
  window.removeEventListener('pointercancel', itemCancel)
}

// ------------------------------------------------------------------ marcas de tamaño y sitio

/** Las marcas que se ven de un efecto (rombos sobre su bloque). */
function marksOf(r: ResolvedItem): BoxKeyframe[] {
  return r.item.look ? visibleMarks(r.item.look, r.shownEndMs - r.startMs) : []
}
function isPickedMark(r: ResolvedItem, k: BoxKeyframe): boolean {
  const p = tracks.pickedMark.value
  return !!p && p.itemId === r.item.id && p.atMs === k.atMs
}

const markDrag = ref<{ itemId: string; from: number; startX: number; startMs: number; lengthMs: number; to: number; active: boolean } | null>(null)

/** Un rombo: pulsarlo lleva la línea a la marca (y la deja «a mano»); arrastrarlo la mueve en el tiempo. */
function markDown(r: ResolvedItem, k: BoxKeyframe, e: PointerEvent) {
  if (e.button !== 0) return
  e.stopPropagation()
  e.preventDefault()
  tracks.select(r.item.id)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  markDrag.value = { itemId: r.item.id, from: k.atMs, startX: e.clientX, startMs: r.startMs, lengthMs: r.shownEndMs - r.startMs, to: k.atMs, active: false }
}
function markMove(e: PointerEvent) {
  const d = markDrag.value
  if (!d) return
  if (!d.active && Math.abs(e.clientX - d.startX) > 4) d.active = true
  if (!d.active) return
  d.to = Math.round(Math.min(d.lengthMs, Math.max(0, d.from + ms(e.clientX - d.startX))))
  tracks.previewMoveMark(d.itemId, d.from, d.to)
}
function markUp() {
  const d = markDrag.value
  markDrag.value = null
  if (!d) return
  if (d.active) {
    store.commitPreview()
    tracks.pickedMark.value = { itemId: d.itemId, atMs: d.to }
    return
  }
  tracks.pickedMark.value = { itemId: d.itemId, atMs: d.from }
  emit('seek', d.startMs + d.from)
}

// ------------------------------------------------------------------ cómo se dibuja cada elemento

function blockStyle(r: ResolvedItem) {
  const left = x(r.startMs)
  const width = Math.max(8, x(r.endMs) - left)
  return { left: `${left}px`, width: `${width}px` }
}
/** Parte que sobresale del final del vídeo (se corta al guardar): se ve atenuada. */
function overflowStyle(r: ResolvedItem) {
  if (r.endMs <= totalMs.value) return null
  const w = x(r.endMs) - x(Math.max(r.startMs, totalMs.value))
  return { width: `${w}px` }
}
function fadeWidth(msLen: number) {
  return `${Math.max(0, x(msLen))}px`
}

const waves = ref<Record<string, string>>({})
const waveRequested = new Set<string>()
function waveOf(r: ResolvedItem): string | null {
  const path = library.itemPath(r.item)
  if (!path) return null
  const key = path
  if (!waveRequested.has(key)) {
    waveRequested.add(key)
    void store.waveform(path, 1600, 64).then((w) => {
      if (w) waves.value = { ...waves.value, [key]: w.url }
    })
  }
  return waves.value[key] ?? null
}
/** La forma de onda del original, colocada para que su tiempo coincida con el de la pista. */
function waveStyle(r: ResolvedItem) {
  const url = waveOf(r)
  if (!url) return {}
  const item = r.item
  const full = x(item.sourceDurationMs)
  if (item.repeat) {
    return { backgroundImage: `url("${url}")`, backgroundSize: `${x(itemLoopMs(item))}px 100%`, backgroundPositionX: `${-x(item.phaseMs)}px`, backgroundRepeat: 'repeat-x' }
  }
  return { backgroundImage: `url("${url}")`, backgroundSize: `${full}px 100%`, backgroundPositionX: `${-x(item.inMs)}px`, backgroundRepeat: 'no-repeat' }
}
function effectThumbPath(r: ResolvedItem): string | null {
  return library.itemPath(r.item)
}

const lostPaths = computed(() => new Set(store.missingItems.value.map((i) => i.id)))

// ------------------------------------------------------------------ montaje

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (scroller.value) viewWidth.value = scroller.value.clientWidth
  })
  if (scroller.value) {
    observer.observe(scroller.value)
    viewWidth.value = scroller.value.clientWidth
  }
  void library.refreshStatus()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  stopItemDrag()
  clipCancel()
  stopClipTrim()
})

defineExpose({ zoomBy, fitAll, canZoomIn, canZoomOut, pxPerSec })
</script>

<template>
  <section
    class="tracks-view"
    data-testid="tracks-view"
    :data-px-per-sec="Math.round(pxPerSec * 100) / 100"
    :data-drag-render-ms="lastDragRenderMs"
    :data-view-width="viewWidth"
    :style="{ '--header': `${HEADER}px` }"
  >
    <div ref="scroller" class="scroller" data-testid="tracks-scroller" @wheel="onWheel">
      <div class="grid" :style="{ width: `${HEADER + contentWidth}px` }">
        <!-- Regla -->
        <div class="corner" role="group" aria-label="Zoom de las pistas">
          <button class="zbtn" type="button" :disabled="!canZoomOut" aria-label="Alejar" title="Alejar" data-testid="zoom-out" @click="zoomBy(-1)">
            <AppIcon name="zoom-out" :size="18" />
            <KeyHint k="-" />
          </button>
          <button class="zbtn" type="button" :disabled="!canZoomIn" aria-label="Acercar" title="Acercar" data-testid="zoom-in" @click="zoomBy(1)">
            <AppIcon name="zoom-in" :size="18" />
            <KeyHint k="+" />
          </button>
          <button class="zbtn" type="button" :disabled="!canZoomOut" aria-label="Ver todo" title="Ver todo" data-testid="zoom-fit" @click="fitAll">
            <AppIcon name="fullscreen" :size="18" />
          </button>
        </div>
        <div class="ruler" data-testid="tracks-ruler" @pointerdown="rulerDown" @pointermove="rulerMove" @pointerup="rulerUp" @pointercancel="rulerUp">
          <span v-for="t in ticks" :key="t.ms" class="tick" :style="{ left: `${x(t.ms)}px` }">{{ t.label }}</span>
          <span class="ruler-head" :style="{ left: `${x(playheadMs)}px` }" />
        </div>

        <!-- Pistas de efectos (la de más arriba se ve encima) -->
        <template v-for="(t, i) in effectTracks" :key="t.id">
          <TrackHeader :track="t" :on-top="i === 0 && effectTracks.length > 1" />
          <div :ref="(el) => setRow(t.id, el)" class="row fx-row" :class="{ off: t.hidden }" :data-track-id="t.id" data-testid="track-row">
            <div
              v-for="r in byTrack.get(t.id) ?? []"
              :key="r.item.id"
              class="item effect"
              :class="{ selected: r.item.id === tracks.selectedItemId.value, lost: lostPaths.has(r.item.id), light: r.item.look?.mix === 'light' }"
              :style="blockStyle(r)"
              :data-item-id="r.item.id"
              :data-start-ms="r.startMs"
              :data-end-ms="r.endMs"
              data-testid="track-item"
              :title="r.item.name"
              @pointerdown="itemDown(r, 'move', $event)"
            >
              <span class="thumb">
                <img v-if="r.item.still && effectThumbPath(r)" :src="store.mediaSrc(effectThumbPath(r)!)" alt="" draggable="false" />
                <ThumbImage v-else-if="effectThumbPath(r)" :path="effectThumbPath(r)!" :time-ms="Math.min(1000, r.item.sourceDurationMs / 2)" :height="64" />
              </span>
              <span class="label">
                <AppIcon v-if="r.item.repeat" name="repeat" :size="15" />
                {{ r.item.name }}
              </span>
              <span v-if="r.item.fadeInMs" class="fade in" :style="{ width: fadeWidth(r.item.fadeInMs) }" />
              <span v-if="r.item.fadeOutMs" class="fade out" :style="{ width: fadeWidth(r.item.fadeOutMs) }" />
              <span v-if="overflowStyle(r)" class="overflow" :style="overflowStyle(r)!" title="Esto pasa del final del vídeo: se corta al guardar" />
              <span class="handle start" data-testid="item-handle-start" @pointerdown="itemDown(r, 'start', $event)" />
              <span class="handle end" data-testid="item-handle-end" @pointerdown="itemDown(r, 'end', $event)" />
              <span
                v-for="k in marksOf(r)"
                :key="k.atMs"
                class="mark"
                :class="{ picked: isPickedMark(r, k) }"
                :style="{ left: `${x(k.atMs)}px` }"
                data-testid="item-mark"
                :data-at-ms="k.atMs"
                :title="`Marca de tamaño y sitio a los ${formatClock(r.startMs + k.atMs)}: pulsa para ir a ella, arrástrala para moverla`"
                @pointerdown="markDown(r, k, $event)"
                @pointermove="markMove"
                @pointerup="markUp"
                @pointercancel="markUp"
              />
            </div>
          </div>
        </template>

        <!-- Fila «Vídeo»: los trozos -->
        <TrackHeader main class="video-sticky" />
        <div ref="clipBlocks" class="row video-row" :class="{ off: project.mainMuted, empty: project.clips.length === 0 }" data-testid="video-row">
          <button
            v-for="(c, i) in project.clips"
            :key="c.id"
            class="clip-block"
            :class="{
              selected: c.id === store.selectedClipId.value && !tracks.selectedItemId.value,
              missing: clipPicture(c) === 'lost' || clipPicture(c) === 'cover-lost',
              dragging: clipDrag?.active && clipDrag.id === c.id,
              trimming: clipTrim?.active && clipTrim.id === c.id,
              narrow: x(timing.lengths[i]!) < 64,
            }"
            :style="{ left: `${x(timing.starts[i]!)}px`, width: `${Math.max(6, x(timing.lengths[i]!))}px` }"
            type="button"
            :data-clip-id="c.id"
            :data-testid="`clip-block-${i + 1}`"
            :data-picture="clipPicture(c)"
            :data-badges="clipBadges(c).map((b) => b.id).join(' ')"
            :aria-label="clipLabel(c, i)"
            :title="clipLabel(c, i)"
            @pointerdown="clipDown(c, $event)"
          >
            <span class="clip-thumb" :style="clipThumbStyle(c)">
              <AppIcon v-if="!clipShowsThumb(c)" :name="lostText(c) ? 'warning' : 'wave'" :size="22" />
            </span>
            <span class="clip-number">{{ i + 1 }}</span>
            <span v-if="lostText(c)" class="clip-lost" data-testid="clip-lost">{{ lostText(c) }}</span>
            <span class="clip-badges" aria-hidden="true">
              <span v-for="b in clipBadges(c)" :key="b.id" class="clip-badge" :class="`b-${b.id}`" :title="b.text"><AppIcon :name="b.icon" :size="14" /></span>
            </span>
            <span class="clip-duration" data-testid="clip-duration">{{ formatDuration(timing.lengths[i]!) }}</span>
            <span class="clip-handle start" data-testid="clip-handle-start" title="Tira para que empiece antes o después" @pointerdown="clipHandleDown(c, 'start', $event)" />
            <span class="clip-handle end" data-testid="clip-handle-end" title="Tira para que termine antes o después" @pointerdown="clipHandleDown(c, 'end', $event)" />
          </button>
          <span v-if="clipDropX !== null" class="drop-mark" :style="{ left: `${clipDropX}px` }" />
          <!-- Al final de la fila (o, con zoom, pegados al borde derecho): lo que eran las tarjetas del final. -->
          <div class="row-end" :style="{ marginLeft: `${x(project.clips.length ? timing.totalMs : 0) + 8}px` }" data-testid="video-row-end">
            <button class="end-btn add" type="button" data-testid="add-more" @click="emit('add')">
              <AppIcon name="plus" :size="22" />
              <span class="end-text">Añadir vídeos o sonidos</span>
            </button>
            <button class="end-btn record" type="button" data-testid="record-more" @click="emit('record')">
              <AppIcon name="camera" :size="22" />
              <span class="end-text">Grabarme</span>
            </button>
            <p v-if="project.clips.length === 0" class="empty-invite" data-testid="empty-invite">
              Tu vídeo está vacío: añade el primer vídeo o sonido, o grábate. También puedes soltarlos aquí.
            </p>
          </div>
        </div>

        <!-- Pistas de sonido -->
        <template v-for="t in soundTracks" :key="t.id">
          <TrackHeader :track="t" />
          <div :ref="(el) => setRow(t.id, el)" class="row sound-row" :class="{ off: t.muted }" :data-track-id="t.id" data-testid="track-row">
            <div
              v-for="r in byTrack.get(t.id) ?? []"
              :key="r.item.id"
              class="item sound"
              :class="{ selected: r.item.id === tracks.selectedItemId.value, lost: lostPaths.has(r.item.id) }"
              :style="blockStyle(r)"
              :data-item-id="r.item.id"
              :data-start-ms="r.startMs"
              :data-end-ms="r.endMs"
              data-testid="track-item"
              :title="r.item.name"
              @pointerdown="itemDown(r, 'move', $event)"
            >
              <span class="wave" :style="waveStyle(r)" />
              <span class="label">
                <AppIcon v-if="r.item.repeat" name="repeat" :size="15" />
                <AppIcon v-if="r.item.volume === 0" name="mute" :size="15" />
                {{ r.item.name }}
              </span>
              <span v-if="r.item.fadeInMs" class="fade in" :style="{ width: fadeWidth(r.item.fadeInMs) }" />
              <span v-if="r.item.fadeOutMs" class="fade out" :style="{ width: fadeWidth(r.item.fadeOutMs) }" />
              <span v-if="overflowStyle(r)" class="overflow" :style="overflowStyle(r)!" title="Esto pasa del final del vídeo: se corta al guardar" />
              <span class="handle start" data-testid="item-handle-start" @pointerdown="itemDown(r, 'start', $event)" />
              <span class="handle end" data-testid="item-handle-end" @pointerdown="itemDown(r, 'end', $event)" />
            </div>
          </div>
        </template>

        <!-- Pistas nuevas a mano (sin límite) y cómo pasar algo de una pista a otra -->
        <div class="add-row" data-testid="add-track-row">
          <div class="add-row-inner" :style="{ width: `${viewWidth - 2}px` }">
            <button class="add-track" type="button" :disabled="project.clips.length === 0" data-testid="add-sound-track" @click="tracks.addTrack('sound')">
              <AppIcon name="add-row" :size="18" />
              Pista de sonido
            </button>
            <button class="add-track fx" type="button" :disabled="project.clips.length === 0" data-testid="add-effect-track" @click="tracks.addTrack('effect')">
              <AppIcon name="add-row" :size="18" />
              Pista de efectos
            </button>
            <span class="add-hint muted">Para pasar un sonido o un efecto a otra pista, arrástralo hasta ella (o elígelo y pulsa ↑ o ↓).</span>
          </div>
        </div>

        <!-- Cabezal, guía de los imanes y el final del vídeo, sobre todas las filas -->
        <div class="overlay-col">
          <span class="end-shade" :style="{ left: `${x(totalMs)}px` }" />
          <span class="playhead" data-testid="tracks-playhead" :style="{ left: `${x(playheadMs)}px` }" />
          <span v-if="guideMs !== null" class="guide" data-testid="snap-guide" :style="{ left: `${x(guideMs)}px` }" />
        </div>
      </div>
    </div>
    <div v-if="trimLive" class="trim-live" data-testid="clip-trim-live" role="status">{{ trimLive }}</div>
  </section>
</template>

<style scoped>
.tracks-view {
  --row: 50px;
  --video-row: 64px;
  --ruler: 32px;
  --add-row: 40px;
  position: relative;
  /* Ocupa todo el alto que deja el divisor; con muchas pistas, se desplaza (la regla y las cabeceras, fijas). */
  flex: 1 1 auto;
  min-height: calc(var(--ruler) + var(--video-row) + 14px);
  display: flex;
  flex-direction: column;
}
.scroller {
  overflow: auto;
  flex: 1 1 auto;
  min-height: 0;
  scrollbar-width: thin;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}
.grid {
  position: relative;
  display: grid;
  grid-template-columns: var(--header) 1fr;
  grid-auto-rows: auto;
}
.corner {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 9; /* por encima de las cabeceras, que pasan por debajo al desplazar */
  height: var(--ruler);
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
}
.corner {
  gap: 4px;
  padding: 0 6px;
}
.zbtn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: calc(var(--ruler) - 6px);
  padding: 0 6px;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.zbtn:hover:not(:disabled) {
  border-color: var(--text-muted);
}
.zbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ruler {
  position: sticky;
  top: 0;
  z-index: 4;
  height: var(--ruler);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  touch-action: none;
}
.tick {
  position: absolute;
  top: 0;
  bottom: 0;
  padding-left: 4px;
  border-left: 1px solid var(--border-strong);
  font-size: 13px;
  line-height: var(--ruler);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  white-space: nowrap;
}
.ruler-head {
  position: absolute;
  top: 0;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  background: var(--bad);
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  pointer-events: none;
}
.row {
  position: relative;
  height: var(--row);
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.row.off {
  background: repeating-linear-gradient(135deg, var(--surface-sunken) 0 8px, var(--surface-2) 8px 16px);
}
.row.off .item,
.row.off .clip-block {
  opacity: 0.4;
  filter: grayscale(0.7);
}
/*
 * La fila «Vídeo» (y su cabecera) nunca se sale de la vista al desplazar hacia abajo con muchas pistas: se
 * queda pegada bajo la regla o encima del pie. El pie (pistas nuevas), siempre abajo.
 */
.video-row {
  position: sticky;
  top: var(--ruler);
  bottom: var(--add-row);
  z-index: 3;
  height: var(--video-row);
  background: #eef1f4;
  display: flex;
  align-items: center;
}
.grid .video-sticky {
  top: var(--ruler);
  bottom: var(--add-row);
  z-index: 7;
}
/* «Añadir vídeos o sonidos» y «Grabarme», detrás del último trozo; con zoom, pegados al borde derecho. */
.row-end {
  position: sticky;
  right: 8px;
  z-index: 3;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.end-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: calc(var(--video-row) - 12px);
  padding: 0 12px;
  border-radius: 10px;
  border: 2px dashed var(--border-strong);
  background: var(--surface);
  color: var(--accent);
  font-weight: 650;
  font-size: 15px;
  line-height: 1.15;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
}
.end-btn.add .end-text {
  width: 104px;
  white-space: normal;
}
.end-btn:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.empty-invite {
  max-width: 520px;
  margin-left: 6px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--text-muted);
}
.add-row {
  position: sticky;
  bottom: 0;
  z-index: 7;
  grid-column: 1 / -1;
  height: var(--add-row);
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.add-row-inner {
  position: sticky;
  left: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  overflow: hidden;
}
.add-track {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: calc(var(--add-row) - 10px);
  padding: 0 10px;
  border-radius: 8px;
  border: 1.5px solid #3c8f9b;
  background: var(--surface);
  color: #1f6670;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
}
.add-track.fx {
  border-color: #7b56b0;
  color: #5b3590;
}
.add-track:hover:not(:disabled) {
  background: var(--surface-2);
}
.add-track:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.add-hint {
  min-width: 0;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trim-live {
  position: absolute;
  top: 3px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 3px 12px;
  border-radius: 8px;
  background: var(--text);
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
.item {
  position: absolute;
  top: 5px;
  bottom: 5px;
  border-radius: 8px;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  display: flex;
  align-items: center;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  user-select: none;
}
.item:active {
  cursor: grabbing;
}
.item.sound {
  background: #d6ecef;
  border: 1.5px solid #3c8f9b;
  color: #134a52;
}
.item.effect {
  background: #e8e0f4;
  border: 1.5px solid #7b56b0;
  color: #3d2463;
}
.item.effect.light {
  background: linear-gradient(90deg, #2b2340, #4a3a6b);
  color: #fff;
}
.item.selected {
  border-width: 3px;
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px var(--accent-ring),
    0 2px 8px rgb(0 0 0 / 0.2);
  z-index: 2;
}
.item.lost {
  background: var(--warn-soft);
  border-color: var(--warn);
}
.wave {
  position: absolute;
  inset: 0;
  opacity: 0.85;
  background-repeat: no-repeat;
  pointer-events: none;
  filter: brightness(0.55) saturate(1.4);
}
.thumb {
  flex: none;
  width: 52px;
  height: 100%;
  overflow: hidden;
  background: #000;
  pointer-events: none;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.label {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  text-shadow: 0 0 4px rgb(255 255 255 / 0.9);
}
.item.effect.light .label {
  text-shadow: 0 0 4px rgb(0 0 0 / 0.9);
}
.fade {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  background: rgb(255 255 255 / 0.55);
}
.fade.in {
  left: 0;
  clip-path: polygon(0 0, 100% 0, 0 100%);
}
.fade.out {
  right: 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%);
}
.overflow {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(135deg, rgb(255 255 255 / 0.75) 0 6px, rgb(255 255 255 / 0.4) 6px 12px);
  pointer-events: auto;
}
.mark {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  transform: rotate(45deg);
  border-radius: 2px;
  background: #fff;
  border: 2.5px solid #5b3d8a;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
  cursor: ew-resize;
  z-index: 3;
  touch-action: none;
}
/* Zona para cogerlo más grande que el dibujo. */
.mark::before {
  content: '';
  position: absolute;
  inset: -7px;
}
.mark.picked {
  background: #f2b632;
  border-color: #1d2b36;
}
.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 12px;
  cursor: ew-resize;
  z-index: 1;
}
.handle.start {
  left: 0;
}
.handle.end {
  right: 0;
}
.item.selected .handle::after,
.item:hover .handle::after {
  content: '';
  position: absolute;
  top: 25%;
  bottom: 25%;
  left: 4px;
  width: 4px;
  border-radius: 2px;
  background: var(--accent);
}
.clip-block {
  position: absolute;
  top: 5px;
  bottom: 5px;
  padding: 0;
  border-radius: 8px;
  border: 2px solid var(--border-strong);
  background: #2a3038;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}
.clip-block.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
  z-index: 1;
}
.clip-block.missing {
  background: var(--warn-soft);
  border-color: var(--warn);
}
.clip-block.dragging {
  opacity: 0.45;
}
.clip-block.trimming {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.clip-lost {
  position: absolute;
  left: 44px;
  right: 14px;
  top: 6px;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.15;
  color: var(--warn);
  text-align: left;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  pointer-events: none;
}
.clip-badges {
  position: absolute;
  right: 13px;
  top: 4px;
  display: flex;
  gap: 2px;
  pointer-events: none;
}
.clip-badge {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: rgb(255 255 255 / 0.94);
  color: var(--accent-hover);
}
.clip-badge.b-attached,
.clip-badge.b-cover {
  color: #5b3590;
}
.clip-duration {
  position: absolute;
  left: 13px;
  bottom: 4px;
  padding: 0 6px;
  border-radius: 6px;
  background: rgb(0 0 0 / 0.72);
  color: #fff;
  font-size: 13px;
  font-weight: 650;
  line-height: 19px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}
.clip-block.missing .clip-badges,
.clip-block.narrow .clip-badges,
.clip-block.narrow .clip-lost {
  display: none;
}
/* Asas para recortar o alargar el trozo desde las pistas. */
.clip-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 12px;
  z-index: 2;
  cursor: ew-resize;
  touch-action: none;
}
.clip-handle.start {
  left: 0;
}
.clip-handle.end {
  right: 0;
}
.clip-handle::after {
  content: '';
  position: absolute;
  top: 30%;
  bottom: 30%;
  left: 4px;
  width: 4px;
  border-radius: 2px;
  background: rgb(255 255 255 / 0.55);
}
.clip-block.selected .clip-handle::after,
.clip-block:hover .clip-handle::after,
.clip-block.trimming .clip-handle::after {
  background: var(--accent);
  box-shadow: 0 0 0 1.5px #fff;
}
.clip-block.narrow .clip-handle {
  width: 8px;
}
.clip-block.narrow .clip-handle::after {
  left: 2px;
}
.clip-thumb {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #9ec5e0;
  pointer-events: none;
}
.clip-thumb {
  background-size: auto 100%;
  background-repeat: repeat-x;
}
.clip-number {
  position: absolute;
  left: 13px;
  top: 4px;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 0.94);
  color: var(--text);
  font-weight: 700;
  font-size: 14px;
  pointer-events: none;
}
.clip-block.selected .clip-number {
  background: var(--accent);
  color: #fff;
}
.drop-mark {
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 6px;
  margin-left: -3px;
  border-radius: 3px;
  background: var(--accent);
  z-index: 3;
}
.overlay-col {
  position: absolute;
  top: 0;
  bottom: var(--add-row);
  left: var(--header);
  right: 0;
  pointer-events: none;
  z-index: 5;
}
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--bad);
}
.guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px dashed #e08a1e;
}
.end-shade {
  position: absolute;
  top: var(--ruler);
  bottom: 0;
  right: 0;
  background: rgb(28 34 41 / 0.08);
  border-left: 2px solid var(--text-soft);
}
@media (max-height: 860px) {
  .tracks-view {
    --row: 44px;
    --video-row: 56px;
    --ruler: 30px;
    --add-row: 36px;
  }
  .thumb {
    width: 44px;
  }
  .end-btn {
    font-size: 14px;
  }
}</style>
