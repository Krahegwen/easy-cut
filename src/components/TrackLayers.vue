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

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  audibleOrVisible,
  boxAt,
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

/** Sonidos montados a la vez, como mucho. */
const SOUND_POOL = 8
const EFFECT_POOL = 6
/** Se carga lo que empieza en los próximos segundos, para que no tarde en sonar. */
const AHEAD_MS = 3000

function pathOf(item: TrackItem): string | null {
  const p = library.itemPath(item)
  if (!p || store.missing.value[p] || !store.media.value[p]) return null
  return p
}

const resolved = computed(() => {
  const timing = projectTiming(props.project)
  return audibleOrVisible(resolveTracks(props.project, timing)).filter((r) => pathOf(r.item) !== null)
})

// La lista de montados cambia cada cuarto de segundo como mucho (no en cada fotograma).
const coarseMs = computed(() => Math.floor(props.currentMs / 250) * 250)

const sounds = computed(() => {
  const t = coarseMs.value
  return resolved.value.filter((r) => r.track.kind === 'sound' && r.startMs <= t + AHEAD_MS && r.shownEndMs > t - 250).slice(0, SOUND_POOL)
})

const selectedId = computed(() => tracks.selectedItemId.value)
const editingBox = computed(() => tracks.boxEditing.value && !!selectedEffect.value)

/** El efecto elegido (aunque no toque en este instante): para «Tamaño y sitio». */
const selectedEffect = computed<ResolvedItem | null>(() => {
  const id = selectedId.value
  if (!id) return null
  const timing = projectTiming(props.project)
  return resolveTracks(props.project, timing).find((r) => r.item.id === id && r.track.kind === 'effect' && pathOf(r.item) !== null) ?? null
})

const effects = computed(() => {
  const t = coarseMs.value
  const list = resolved.value.filter((r) => r.track.kind === 'effect' && r.startMs <= t + 2000 && r.shownEndMs > t - 250).slice(0, EFFECT_POOL)
  const sel = selectedEffect.value
  if (editingBox.value && sel && !list.some((r) => r.item.id === sel.item.id)) list.push(sel)
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
const sync = ref<Record<string, { expected: number; actual: number | null; active: boolean }>>({})

function register(id: string, el: unknown) {
  if (el instanceof HTMLMediaElement) elements.set(id, el)
  else elements.delete(id)
}

function srcOf(item: TrackItem): string {
  return store.mediaSrc(pathOf(item) ?? '')
}

function mediaSize(item: TrackItem): { width: number; height: number } {
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
  const forced = editingBox.value && r.item.id === selectedId.value
  const active = isActive(r, t) || forced
  const fade = isActive(r, t) ? itemFadeAt(r.item, t - r.startMs, r.shownEndMs - r.startMs) : 1
  return {
    ...rectStyle(r.item, look, boxAt(look, localOf(r))),
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

function syncAll(exact = false) {
  for (const r of sounds.value) syncOne(r, exact)
  for (const r of effects.value) syncOne(r, exact)
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
  return { mix: d?.mix ?? 'normal', opacity: d?.opacity ?? 1, fit: d?.fit ?? 'cover', box: { x: 0.5, y: 0.5, scale: 1, ...d?.box }, keyframes: [] }
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

defineExpose({ sync })

/** Para las pruebas: cuánto dura en pantalla cada elemento montado. */
function lengthOf(r: ResolvedItem): number {
  return itemLengthMs(r.item, r.startMs, Number.POSITIVE_INFINITY)
}
</script>

<template>
  <div class="track-layers" :class="{ editing: editingBox }" data-testid="track-layers" :data-sync="JSON.stringify(sync)">
    <template v-for="r in effects" :key="r.item.id">
      <img
        v-if="r.item.still"
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
  z-index: 1;
}
.mark-dot.here {
  background: var(--accent);
  color: #fff;
}
.box-editor {
  position: absolute;
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
