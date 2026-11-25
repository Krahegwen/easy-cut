<script setup lang="ts">
// Vista de pistas: regla de tiempo, filas proporcionales al tiempo y el cabezal que las cruza todas. Arriba,
// las pistas de efectos (la de más arriba se ve encima); en medio, la fila «Vídeo» con los trozos (se eligen y
// se reordenan arrastrando, como en la tira); debajo, las de sonido con su forma de onda. Los elementos se
// arrastran (también a otra pista del mismo tipo), se recortan o alargan por sus asas y se pegan con imanes
// (principio y final de los trozos, el cabezal y los demás elementos) dibujando una línea guía.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  clipInOut,
  formatClock,
  formatDuration,
  itemLoopMs,
  projectTiming,
  resolveTracks,
  snapMove,
  snapPoints,
  snapTime,
  type Clip,
  type ResolvedItem,
  type Track,
} from '../../domain'
import { library, store, tracks } from '../../store'
import AppIcon from '../AppIcon.vue'
import KeyHint from '../KeyHint.vue'
import ThumbImage from '../ThumbImage.vue'
import TrackHeader from './TrackHeader.vue'

const props = defineProps<{ playheadMs: number; playing: boolean }>()
const emit = defineEmits<{ seek: [ms: number] }>()

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
const fitPx = computed(() => Math.max(0.5, (viewWidth.value - HEADER.value - 40) / (totalMs.value / 1000)))
const pxPerSec = computed(() => zoom.value ?? fitPx.value)
const x = (ms: number) => (ms / 1000) * pxPerSec.value
const ms = (px: number) => (px / pxPerSec.value) * 1000
const contentWidth = computed(() => Math.max(viewWidth.value - HEADER.value, x(totalMs.value) + 40))

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
})

defineExpose({ zoomBy, fitAll, canZoomIn, canZoomOut, pxPerSec })
</script>

<template>
  <section
    class="tracks-view"
    data-testid="tracks-view"
    :data-px-per-sec="Math.round(pxPerSec * 100) / 100"
    :data-drag-render-ms="lastDragRenderMs"
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
            </div>
          </div>
        </template>

        <!-- Fila «Vídeo»: los trozos -->
        <TrackHeader main />
        <div ref="clipBlocks" class="row video-row" :class="{ off: project.mainMuted }" data-testid="video-row">
          <button
            v-for="(c, i) in project.clips"
            :key="c.id"
            class="clip-block"
            :class="{ selected: c.id === store.selectedClipId.value && !tracks.selectedItemId.value, missing: !!store.missing.value[c.sourcePath], dragging: clipDrag?.active && clipDrag.id === c.id }"
            :style="{ left: `${x(timing.starts[i]!)}px`, width: `${Math.max(6, x(timing.lengths[i]!))}px` }"
            type="button"
            :data-clip-id="c.id"
            :data-testid="`clip-block-${i + 1}`"
            :aria-label="`Trozo ${i + 1}, dura ${formatDuration(timing.lengths[i]!)}`"
            @pointerdown="clipDown(c, $event)"
          >
            <span class="clip-thumb" :style="clipThumbStyle(c)">
              <AppIcon v-if="!clipShowsThumb(c)" :name="store.missing.value[c.sourcePath] ? 'warning' : 'wave'" :size="22" />
            </span>
            <span class="clip-number">{{ i + 1 }}</span>
          </button>
          <span v-if="clipDropX !== null" class="drop-mark" :style="{ left: `${clipDropX}px` }" />
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

        <!-- Cabezal, guía de los imanes y el final del vídeo, sobre todas las filas -->
        <div class="overlay-col">
          <span class="end-shade" :style="{ left: `${x(totalMs)}px` }" />
          <span class="playhead" data-testid="tracks-playhead" :style="{ left: `${x(playheadMs)}px` }" />
          <span v-if="guideMs !== null" class="guide" data-testid="snap-guide" :style="{ left: `${x(guideMs)}px` }" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tracks-view {
  --row: 46px;
  --video-row: 56px;
  --ruler: 32px;
  position: relative;
  flex: 0 1 auto;
  /* Al menos la regla, la fila «Vídeo» y una pista: el resto se desplaza. */
  min-height: calc(var(--ruler) + var(--video-row) + var(--row) + 14px);
  display: flex;
  flex-direction: column;
}
.scroller {
  overflow: auto;
  flex: 0 1 auto;
  min-height: 0;
  max-height: 330px;
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
  z-index: 6;
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
.video-row {
  height: var(--video-row);
  background: #eef1f4;
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
  left: 4px;
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
  bottom: 0;
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
    --row: 40px;
    --video-row: 48px;
    --ruler: 30px;
  }
  .scroller {
    max-height: 260px;
  }
  .thumb {
    width: 44px;
  }
}</style>
