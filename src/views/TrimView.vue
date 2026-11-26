<script setup lang="ts">
// «Solo recortar»: un vídeo, dónde empieza y dónde termina, y guardarlo. «Rápido» copia el vídeo tal cual (el
// principio puede adelantarse hasta el fotograma clave anterior: se ve en la barra, rayado, y al reproducir);
// «Exacto» lo vuelve a hacer en calidad alta y corta justo donde se marcó. «Convertir en un vídeo normal» lo
// lleva a «Tu vídeo» con el corte hecho.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import { baseName, describeCopyPlan, formatClock, formatClockTenths, formatDuration, trimOutputMs, type TrimMode } from '../domain'
import { useShortcuts } from '../lib/use-shortcuts'
import { store, trim } from '../store'

const info = computed(() => trim.info.value)
const range = computed(() => trim.range.value)
const duration = computed(() => trim.durationMs.value)

// ------------------------------------------------------------------ vista previa

const video = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
/** Al reproducir desde dentro de lo marcado, se para al llegar al final del corte. */
let stopAtOut = false
const src = computed(() => (info.value ? store.mediaSrc(info.value.path) : ''))
const preparingProxy = computed(() => (info.value ? store.proxyStatus.value[info.value.path] === 'working' : false))

function onMeta() {
  const v = video.value
  if (!v || !info.value) return
  // WebView2 no siempre da error con lo que no sabe decodificar: sin imagen, la vista previa ligera.
  if (v.videoWidth === 0) void store.ensureProxy(info.value.path)
  v.currentTime = trim.playheadMs.value / 1000
}
function onError() {
  if (info.value) void store.ensureProxy(info.value.path)
}

let raf = 0
function tick() {
  const v = video.value
  if (v) {
    const ms = Math.round(v.currentTime * 1000)
    trim.playheadMs.value = ms
    if (playing.value && stopAtOut && ms >= range.value.outMs) {
      v.pause()
      seek(range.value.outMs)
    }
  }
  if (playing.value) raf = requestAnimationFrame(tick)
}
function onPlay() {
  playing.value = true
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(tick)
}
function onPause() {
  playing.value = false
  cancelAnimationFrame(raf)
  tick()
}
function onSeeked() {
  if (!playing.value && video.value) trim.playheadMs.value = Math.round(video.value.currentTime * 1000)
}
onBeforeUnmount(() => cancelAnimationFrame(raf))

function seek(ms: number) {
  const t = Math.round(Math.min(Math.max(0, ms), duration.value))
  trim.playheadMs.value = t
  if (video.value) video.value.currentTime = t / 1000
}

/** Desde dónde empieza lo que se guarda (con «Rápido», el fotograma clave). */
const savedStartMs = computed(() => (trim.effectiveMode.value === 'copy' && trim.plan.value ? trim.plan.value.startMs : range.value.inMs))

function toggle() {
  const v = video.value
  if (!v) return
  if (!v.paused) {
    v.pause()
    return
  }
  const at = trim.playheadMs.value
  // Fuera de lo marcado (o al final), se reproduce lo que se va a guardar: desde su principio.
  if (at < savedStartMs.value || at >= range.value.outMs - 50) seek(savedStartMs.value)
  stopAtOut = trim.playheadMs.value < range.value.outMs
  void v.play().catch(() => {})
}

function stop() {
  video.value?.pause()
  seek(savedStartMs.value)
}

function step(deltaMs: number) {
  seek(trim.playheadMs.value + deltaMs)
}

// ------------------------------------------------------------------ barra: lo marcado y los tiradores

const bar = ref<HTMLDivElement | null>(null)
type Drag = 'in' | 'out' | 'seek'
const dragging = ref<Drag | null>(null)

const pct = (ms: number) => (duration.value > 0 ? `${Math.min(100, Math.max(0, (ms / duration.value) * 100))}%` : '0%')
const earlyShown = computed(() => trim.effectiveMode.value === 'copy' && !!trim.plan.value && !trim.plan.value.exact)

function msAt(clientX: number): number {
  const el = bar.value
  if (!el || duration.value <= 0) return 0
  const r = el.getBoundingClientRect()
  return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration.value)
}

function down(e: PointerEvent, what: Drag) {
  if (e.button !== 0) return
  e.stopPropagation()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragging.value = what
  move(e)
}
function move(e: PointerEvent) {
  const what = dragging.value
  if (!what) return
  const ms = msAt(e.clientX)
  if (what === 'in') trim.setIn(Math.min(ms, range.value.outMs - 200))
  else if (what === 'out') trim.setOut(Math.max(ms, range.value.inMs + 200))
  // Arrastrar un tirador también enseña ese fotograma.
  seek(ms)
}
function up() {
  dragging.value = null
}

// ------------------------------------------------------------------ marcar y guardar

function startHere() {
  trim.setIn(trim.playheadMs.value)
}
function endHere() {
  trim.setOut(trim.playheadMs.value)
}

const outputMs = computed(() => trimOutputMs(range.value, trim.effectiveMode.value, trim.plan.value))
const copyText = computed(() => {
  if (trim.copyBlocked.value) return trim.copyBlocked.value
  const k = trim.keyframe.value
  if (k.status === 'error') return 'No he podido mirar dónde se puede cortar este vídeo sin recodificar. Usa «Exacto».'
  if (k.status === 'working' || !trim.plan.value) return 'Mirando dónde se puede cortar sin recodificar…'
  return describeCopyPlan(trim.plan.value)
})

function choose(m: TrimMode) {
  if (m === 'copy' && !trim.copyAvailable.value) return
  trim.mode.value = m
}

function save() {
  video.value?.pause()
  void trim.save()
}

function convert() {
  video.value?.pause()
  void trim.convert()
}

function back() {
  video.value?.pause()
  trim.close()
}

onMounted(() => {
  void trim.ensureKeyframe()
  void nextTick(() => seek(trim.playheadMs.value))
})
// Si el vídeo cambia (recortar otro), la vista previa vuelve al principio.
watch(
  () => info.value?.path,
  () => seek(0),
)

useShortcuts({
  id: 'trim',
  title: 'Solo recortar',
  shortcuts: () => [
    { id: 'play', keys: ['Space'], label: 'Espacio', description: 'reproducir o parar', run: toggle },
    { id: 'stop', keys: ['Escape'], label: 'Esc', description: 'parar y volver al principio de lo marcado', run: stop, enabled: playing.value },
    { id: 'back', keys: ['Escape'], label: 'Esc', description: 'volver a Inicio (sin guardar nada)', run: back },
    { id: 'go-start', keys: ['Home'], label: 'Inicio', description: 'ir al principio del vídeo', run: () => seek(0) },
    { id: 'go-end', keys: ['End'], label: 'Fin', description: 'ir al final del vídeo', run: () => seek(duration.value) },
    { id: 'back-1s', keys: ['ArrowLeft'], label: '←', description: '1 segundo atrás', run: () => step(-1000), repeat: true },
    { id: 'forward-1s', keys: ['ArrowRight'], label: '→', description: '1 segundo adelante', run: () => step(1000), repeat: true },
    { id: 'start-here', keys: ['e'], label: 'E', description: '«Empieza aquí»', run: startHere },
    { id: 'end-here', keys: ['t'], label: 'T', description: '«Termina aquí»', run: endHere },
    { id: 'mode-copy', keys: ['1'], label: '1', description: '«Rápido»', run: () => choose('copy'), enabled: trim.copyAvailable.value },
    { id: 'mode-exact', keys: ['2'], label: '2', description: '«Exacto»', run: () => choose('exact') },
    { id: 'save', keys: ['g'], label: 'G', description: '«Guardar»', run: save },
    { id: 'save-enter', keys: ['Enter'], label: 'Intro', description: '«Guardar» también', run: save },
  ],
})
</script>

<template>
  <main class="screen trim" data-testid="trim-view">
    <header class="topbar">
      <button class="btn quiet" type="button" data-testid="trim-back" @click="back">
        <AppIcon name="back" />
        Inicio
        <KeyHint k="Esc" />
      </button>
      <h1>Solo recortar</h1>
      <span v-if="info" class="file muted" :title="info.path" data-testid="trim-file">{{ baseName(info.path) }}</span>
      <span class="spacer" />
      <KeysButton />
    </header>

    <div v-if="info" class="body">
      <section class="left">
        <div class="stage">
          <video
            ref="video"
            :src="src"
            preload="auto"
            playsinline
            data-testid="trim-video"
            :data-playhead-ms="trim.playheadMs.value"
            @loadedmetadata="onMeta"
            @error="onError"
            @play="onPlay"
            @pause="onPause"
            @seeked="onSeeked"
            @click="toggle"
          />
          <p v-if="preparingProxy" class="proxy-hint"><span class="spinner" /> Preparando la vista previa…</p>
        </div>

        <div class="transport">
          <button class="btn play" type="button" :aria-label="playing ? 'Parar' : 'Reproducir'" data-testid="trim-play" @click="toggle">
            <AppIcon :name="playing ? 'pause' : 'play'" />
            <KeyHint k="Espacio" />
          </button>
          <span class="time" data-testid="trim-time">{{ formatClockTenths(trim.playheadMs.value) }} <span class="muted">/ {{ formatClock(duration) }}</span></span>
        </div>

        <div
          ref="bar"
          class="bar"
          :class="{ dragging: dragging !== null }"
          role="slider"
          tabindex="-1"
          aria-label="Posición en el vídeo"
          :aria-valuemin="0"
          :aria-valuemax="Math.round(duration / 1000)"
          :aria-valuenow="Math.round(trim.playheadMs.value / 1000)"
          data-testid="trim-bar"
          @pointerdown="down($event, 'seek')"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
        >
          <div class="kept" :style="{ left: pct(range.inMs), width: `calc(${pct(range.outMs)} - ${pct(range.inMs)})` }" data-testid="trim-kept" />
          <div
            v-if="earlyShown && trim.plan.value"
            class="early"
            :style="{ left: pct(trim.plan.value.startMs), width: `calc(${pct(range.inMs)} - ${pct(trim.plan.value.startMs)})` }"
            title="Con «Rápido», el vídeo empezará aquí"
            data-testid="trim-early"
          />
          <button
            class="handle in"
            type="button"
            tabindex="-1"
            aria-label="Principio (arrástralo)"
            :style="{ left: pct(range.inMs) }"
            data-testid="trim-handle-in"
            @pointerdown="down($event, 'in')"
            @pointermove="move"
            @pointerup="up"
            @pointercancel="up"
          />
          <button
            class="handle out"
            type="button"
            tabindex="-1"
            aria-label="Final (arrástralo)"
            :style="{ left: pct(range.outMs) }"
            data-testid="trim-handle-out"
            @pointerdown="down($event, 'out')"
            @pointermove="move"
            @pointerup="up"
            @pointercancel="up"
          />
          <span class="playhead" :style="{ left: pct(trim.playheadMs.value) }" />
        </div>

        <div class="marks">
          <button class="btn" type="button" data-testid="trim-start-here" @click="startHere">
            <AppIcon name="start-here" />
            Empieza aquí
            <KeyHint k="E" />
          </button>
          <p class="range" data-testid="trim-range">
            Empieza en <strong data-testid="trim-in">{{ formatClockTenths(range.inMs) }}</strong> · termina en
            <strong data-testid="trim-out">{{ formatClockTenths(range.outMs) }}</strong>
          </p>
          <button class="btn" type="button" data-testid="trim-end-here" @click="endHere">
            <AppIcon name="end-here" />
            Termina aquí
            <KeyHint k="T" />
          </button>
        </div>
      </section>

      <aside class="right card">
        <h2>¿Cómo lo guardo?</h2>
        <div class="modes" role="radiogroup" aria-label="Cómo guardar">
          <button
            class="mode"
            :class="{ selected: trim.effectiveMode.value === 'copy' }"
            type="button"
            role="radio"
            :aria-checked="trim.effectiveMode.value === 'copy'"
            :disabled="!trim.copyAvailable.value"
            data-testid="trim-mode-copy"
            @click="choose('copy')"
          >
            <span class="mode-title"><AppIcon name="faster" :size="20" /> Rápido <KeyHint k="1" /></span>
            <span class="mode-text">Lo copia tal cual: tarda unos segundos y no pierde nada de calidad.</span>
            <span class="mode-note" :class="{ warn: earlyShown }" data-testid="trim-copy-note">{{ copyText }}</span>
          </button>
          <button
            class="mode"
            :class="{ selected: trim.effectiveMode.value === 'exact' }"
            type="button"
            role="radio"
            :aria-checked="trim.effectiveMode.value === 'exact'"
            data-testid="trim-mode-exact"
            @click="choose('exact')"
          >
            <span class="mode-title"><AppIcon name="scissors" :size="20" /> Exacto <KeyHint k="2" /></span>
            <span class="mode-text">Corta justo donde has marcado. Tarda más, porque vuelve a hacer el vídeo (en calidad alta).</span>
          </button>
        </div>
        <p class="result" data-testid="trim-result">
          <AppIcon name="clock" :size="18" />
          El vídeo recortado durará <strong>{{ formatDuration(outputMs) }}</strong>
        </p>
        <button class="btn primary large" type="button" data-testid="trim-save" @click="save">
          <AppIcon name="save" />
          Guardar
          <KeyHint k="G" />
        </button>
        <p class="muted where">Se guarda en «Mis montajes». Tu vídeo original no se toca.</p>
        <div class="more">
          <p class="muted">¿Quieres hacerle algo más (juntarlo con otros, ponerle música…)?</p>
          <button class="btn" type="button" data-testid="trim-convert" @click="convert">
            <AppIcon name="film" />
            Convertir en un vídeo normal
          </button>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.file {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
}
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 18px;
  padding: 16px 20px 18px;
}
.left {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 160px;
  border-radius: var(--radius);
  background: var(--stage);
  overflow: hidden;
}
.stage video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  cursor: pointer;
}
.proxy-hint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 17px;
}
.transport {
  display: flex;
  align-items: center;
  gap: 14px;
}
.play {
  min-width: 96px;
}
.time {
  font-size: 19px;
  font-variant-numeric: tabular-nums;
}
/* La barra: todo el vídeo; en azul lo que se queda; rayado, lo que «Rápido» añade por delante. */
.bar {
  position: relative;
  flex: none;
  height: 54px;
  margin: 0 12px;
  border-radius: 10px;
  background: var(--surface-sunken);
  cursor: pointer;
  touch-action: none;
}
.kept {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--accent) 30%, transparent);
  border-top: 3px solid var(--accent);
  border-bottom: 3px solid var(--accent);
}
.early {
  position: absolute;
  top: 0;
  bottom: 0;
  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--pause) 55%, transparent) 0 6px, transparent 6px 12px);
  border-top: 3px solid var(--pause);
  border-bottom: 3px solid var(--pause);
}
.handle {
  position: absolute;
  top: -6px;
  bottom: -6px;
  width: 22px;
  transform: translateX(-50%);
  border: 0;
  border-radius: 8px;
  background: var(--accent);
  box-shadow: var(--shadow);
  cursor: ew-resize;
  padding: 0;
}
.handle::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 30%;
  bottom: 30%;
  width: 3px;
  transform: translateX(-50%);
  border-radius: 2px;
  background: #fff;
}
.playhead {
  position: absolute;
  top: -10px;
  bottom: -10px;
  width: 3px;
  transform: translateX(-50%);
  background: var(--text);
  border-radius: 2px;
  pointer-events: none;
}
.marks {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.range {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.right {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
}
.right h2 {
  font-size: 21px;
}
.modes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mode {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 14px;
  border: 1.5px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  font: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
}
.mode:hover:not(:disabled) {
  border-color: var(--text-muted);
}
.mode.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.mode:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}
.mode-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 650;
}
.mode-text {
  font-size: 15px;
}
.mode-note {
  font-size: 15px;
  color: var(--text-muted);
}
.mode-note.warn {
  color: var(--warn);
  font-weight: 600;
}
.result {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
}
.where {
  font-size: 15px;
}
.more {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.more p {
  font-size: 15px;
}
@media (max-width: 1180px) {
  .body {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}
@media (max-height: 760px) {
  .body {
    padding: 10px 16px 12px;
    gap: 12px;
  }
  .right {
    padding: 14px;
    gap: 8px;
  }
  .mode {
    padding: 8px 12px;
  }
}
</style>
