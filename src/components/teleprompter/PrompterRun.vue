<script setup lang="ts">
// Pantalla limpia del teleprompter (ensayar o grabar): el texto pasa de abajo arriba por la parte alta,
// con la línea de lectura marcada, al ritmo elegido. El avance se calcula por palabras (dominio) y se
// pinta moviendo un único bloque con translateY desde requestAnimationFrame (fluido con textos largos).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  advanceUnits,
  AFTER_END_MS,
  clampWpm,
  clockElapsed,
  clockPause,
  clockStart,
  COUNTDOWN_SECONDS,
  createClock,
  formatClock,
  formatDuration,
  groupIntoLines,
  PACE_STEP_WPM,
  paceName,
  readingProgress,
  rewindUnits,
  scrollYAt,
  type MeasuredToken,
  type PrompterLine,
  type Script,
} from '../../domain'
import { setKeyHandler } from '../../lib/keys'
import AppIcon from '../AppIcon.vue'

const props = defineProps<{
  mode: 'rehearse' | 'record'
  script: Script
  wpm: number
  fontSize: number
  targetMs: number | null
  stream?: MediaStream | null
  showCamera?: boolean
}>()

const emit = defineEmits<{
  /** Acaba la cuenta atrás: empieza a grabar. */
  begin: []
  pause: []
  resume: []
  /** «Terminar»: tiempo grabado sin pausas. */
  finish: [elapsedMs: number]
  /** «Volver» sin terminar. */
  leave: []
  wpm: [wpm: number]
  'toggle-camera': []
}>()

type Phase = 'countdown' | 'running' | 'paused'
const phase = ref<Phase>('countdown')
const countdown = ref(COUNTDOWN_SECONDS)
const liveWpm = ref(clampWpm(props.wpm))

const root = ref<HTMLElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const block = ref<HTMLElement | null>(null)
const cameraEl = ref<HTMLVideoElement | null>(null)

// Estado del avance: fuera de la reactividad (se toca en cada fotograma); lo que se enseña se copia
// a refs unas diez veces por segundo.
let units = 0
let clock = createClock()
let lastFrame = 0
let raf = 0
let lines: PrompterLine[] = []
let readingY = 0
let finishedAtElapsed: number | null = null

const shownElapsed = ref(0)
const shownUnits = ref(0)
const finishedNotice = ref(false)

/** Línea de lectura: a un 22 % del alto, cerca de la cámara (arriba del todo de la pantalla). */
const READING_FRACTION = 0.22

const progress = computed(() =>
  readingProgress({ elapsedMs: shownElapsed.value, units: shownUnits.value, totalUnits: props.script.totalUnits, wpm: liveWpm.value, targetMs: props.targetMs }),
)

const statusText = computed(() => {
  const p = progress.value
  if (finishedNotice.value && p.status !== 'over') return 'Has terminado el texto. Pulsa Terminar'
  if (p.status === 'finished') return props.targetMs ? 'Vas bien' : ''
  return p.message
})
const statusTone = computed(() => (finishedNotice.value && progress.value.status !== 'over' ? 'done' : progress.value.tone))

const remainingText = computed(() => {
  const r = progress.value.remainingMs
  if (r === null) return null
  return r > 0 ? `Quedan ${formatDuration(r)}` : `Te has pasado ${formatDuration(-r)}`
})

// ------------------------------------------------------------------ medir las líneas pintadas

function measure() {
  const el = block.value
  const st = stage.value
  if (!el || !st) return
  const tokens: MeasuredToken[] = []
  for (const span of el.querySelectorAll<HTMLElement>('[data-u]')) {
    tokens.push({ top: span.offsetTop, height: span.offsetHeight, unitStart: Number(span.dataset.u) })
  }
  lines = groupIntoLines(tokens)
  readingY = Math.round(st.clientHeight * READING_FRACTION)
  paint()
}

function paint() {
  const el = block.value
  if (!el) return
  const y = scrollYAt(lines, props.script.totalUnits, units)
  el.style.transform = `translate3d(0, ${Math.round((readingY - y) * 10) / 10}px, 0)`
}

// ------------------------------------------------------------------ bucle de animación

let lastUi = 0
function frame(now: number) {
  raf = requestAnimationFrame(frame)
  if (phase.value === 'running') {
    // El tiempo real entre fotogramas (no un paso fijo): el ritmo no depende de los fps de la pantalla.
    const dt = Math.min(250, now - lastFrame)
    units = advanceUnits(units, dt, liveWpm.value, props.script.totalUnits)
    if (units >= props.script.totalUnits && finishedAtElapsed === null) finishedAtElapsed = clockElapsed(clock, now)
    paint()
  }
  lastFrame = now
  const elapsed = clockElapsed(clock, now)
  if (root.value) (root.value as unknown as { prompterState: unknown }).prompterState = { units, elapsedMs: elapsed, wpm: liveWpm.value, phase: phase.value, at: now }
  if (now - lastUi > 100) {
    lastUi = now
    shownElapsed.value = elapsed
    shownUnits.value = units
    finishedNotice.value = finishedAtElapsed !== null && elapsed - finishedAtElapsed >= AFTER_END_MS
  }
}

// ------------------------------------------------------------------ cuenta atrás y controles

let countdownTimer = 0
function startCountdown() {
  phase.value = 'countdown'
  countdown.value = COUNTDOWN_SECONDS
  countdownTimer = window.setInterval(() => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      window.clearInterval(countdownTimer)
      countdownTimer = 0
      const now = performance.now()
      clock = clockStart(clock, now)
      lastFrame = now
      phase.value = 'running'
      emit('begin')
    }
  }, 1000)
}

function togglePause() {
  const now = performance.now()
  if (phase.value === 'running') {
    clock = clockPause(clock, now)
    phase.value = 'paused'
    emit('pause')
  } else if (phase.value === 'paused') {
    clock = clockStart(clock, now)
    lastFrame = now
    phase.value = 'running'
    emit('resume')
  }
}

function changeSpeed(delta: number) {
  liveWpm.value = clampWpm(liveWpm.value + delta)
  emit('wpm', liveWpm.value)
}

function rewind() {
  units = rewindUnits(lines, units, 2)
  if (units < props.script.totalUnits) finishedAtElapsed = null
  paint()
}

function finish() {
  if (phase.value === 'countdown') return
  const now = performance.now()
  clock = clockPause(clock, now)
  emit('finish', clockElapsed(clock, now))
}

function leave() {
  emit('leave')
}

// ------------------------------------------------------------------ cámara en la esquina

const cameraShown = computed(() => !!props.stream && props.showCamera !== false)
watch(
  [cameraShown, cameraEl],
  () => {
    if (cameraEl.value && props.stream && cameraEl.value.srcObject !== props.stream) cameraEl.value.srcObject = props.stream
  },
  { flush: 'post' },
)

// ------------------------------------------------------------------ montaje

let observer: ResizeObserver | null = null
watch(
  () => [props.fontSize, props.script],
  () => void nextTick(measure),
)

onMounted(() => {
  measure()
  observer = new ResizeObserver(() => measure())
  if (stage.value) observer.observe(stage.value)
  lastFrame = performance.now()
  raf = requestAnimationFrame(frame)
  startCountdown()
  setKeyHandler((e) => {
    if (e.key === ' ') {
      togglePause()
      return true
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      changeSpeed(e.key === 'ArrowUp' ? -PACE_STEP_WPM : PACE_STEP_WPM)
      return true
    }
    if (e.key === 'ArrowLeft') {
      rewind()
      return true
    }
    return false
  })
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (countdownTimer) window.clearInterval(countdownTimer)
  observer?.disconnect()
  setKeyHandler(null)
  if (cameraEl.value) cameraEl.value.srcObject = null
})

const paragraphs = shallowRef(props.script.paragraphs)
watch(
  () => props.script,
  (s) => (paragraphs.value = s.paragraphs),
)

defineExpose({ togglePause, finish, phase })
</script>

<template>
  <div
    ref="root"
    class="run"
    :class="[mode, phase]"
    data-testid="prompter-run"
    :data-phase="phase"
    :data-mode="mode"
  >
    <div ref="stage" class="stage" :style="{ '--font-size': `${fontSize}px` }">
      <div class="column">
        <div ref="block" class="block" data-testid="prompter-text">
          <p v-for="(p, i) in paragraphs" :key="i" class="para">
            <template v-for="(t, j) in p.tokens" :key="j"><br v-if="t.lineBreakBefore" /><span :data-u="t.unitStart">{{ t.text }}</span>{{ ' ' }}</template>
          </p>
        </div>
      </div>
      <div class="fade-top" aria-hidden="true" />
      <div class="reading-line" :style="{ top: `${READING_FRACTION * 100}%` }" aria-hidden="true">
        <span class="mark left" />
        <span class="mark right" />
      </div>
      <div class="fade-bottom" aria-hidden="true" />

      <div v-if="phase === 'countdown'" class="countdown" data-testid="countdown">
        <span class="count">{{ countdown }}</span>
        <span class="count-hint">{{ mode === 'record' ? 'Empieza a grabar en…' : 'Empieza el ensayo en…' }}</span>
      </div>
      <div v-else-if="phase === 'paused'" class="paused-badge" data-testid="paused">
        <AppIcon name="pause" :size="28" />
        {{ mode === 'record' ? 'En pausa: no se está grabando' : 'En pausa' }}
      </div>

      <div v-if="cameraShown" class="camera">
        <video ref="cameraEl" autoplay muted playsinline />
        <span v-if="mode === 'record' && phase === 'running'" class="rec-dot"><span />Grabando</span>
      </div>
    </div>

    <footer class="bar">
      <div class="status" :class="statusTone" data-testid="run-status">
        <span class="clock" data-testid="run-elapsed">
          <AppIcon :name="mode === 'record' ? 'record' : 'clock'" :size="20" />
          {{ formatClock(shownElapsed) }}
        </span>
        <span class="status-text">
          <strong v-if="remainingText" data-testid="run-remaining">{{ remainingText }}</strong>
          <span v-if="statusText" data-testid="run-message">{{ statusText }}</span>
          <span v-else class="pace">Ritmo {{ paceName(liveWpm) }}</span>
        </span>
      </div>

      <div class="controls">
        <button class="btn dark" type="button" data-testid="run-leave" @click="leave">
          <AppIcon name="back" />
          Volver
        </button>
        <button class="btn dark" type="button" data-testid="run-rewind" :disabled="phase === 'countdown'" title="Flecha izquierda" @click="rewind">
          <AppIcon name="rewind" />
          Retroceder un poco
        </button>
        <button class="btn dark" type="button" data-testid="run-slower" title="Flecha arriba" @click="changeSpeed(-PACE_STEP_WPM)">
          <AppIcon name="slower" />
          Más despacio
        </button>
        <button class="btn dark" type="button" data-testid="run-faster" title="Flecha abajo" @click="changeSpeed(PACE_STEP_WPM)">
          <AppIcon name="faster" />
          Más rápido
        </button>
        <button class="btn dark pause" type="button" data-testid="run-pause" :disabled="phase === 'countdown'" title="Barra espaciadora" @click="togglePause">
          <AppIcon :name="phase === 'paused' ? 'play' : 'pause'" />
          {{ phase === 'paused' ? 'Seguir' : 'Pausa' }}
        </button>
        <button v-if="stream" class="btn dark" type="button" data-testid="run-camera" @click="emit('toggle-camera')">
          <AppIcon :name="showCamera === false ? 'eye' : 'eye-off'" />
          {{ showCamera === false ? 'Verme' : 'Ocultarme' }}
        </button>
        <button class="btn finish" type="button" data-testid="run-finish" :disabled="phase === 'countdown'" @click="finish">
          <AppIcon name="stop" />
          {{ mode === 'record' ? 'Terminar' : 'Terminar el ensayo' }}
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.run {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: #0b0d10;
  color: #f6f4ee;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
/* Columna centrada con márgenes anchos: la mirada apenas se mueve de lado a lado. */
.column {
  position: absolute;
  inset: 0 0 auto;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.block {
  position: relative;
  width: min(1180px, 74%);
  font-family: var(--font-display);
  font-size: var(--font-size);
  font-weight: 600;
  line-height: 1.42;
  letter-spacing: 0.005em;
  will-change: transform;
}
.para {
  margin: 0 0 0.7em;
}
/* Lo ya leído se apaga; el degradado termina antes de la línea que se está leyendo. */
.fade-top {
  position: absolute;
  inset: 0 0 auto;
  height: calc(22% - var(--font-size) * 0.75);
  background: linear-gradient(rgb(11 13 16 / 0.92), rgb(11 13 16 / 0.55) 70%, rgb(11 13 16 / 0));
  pointer-events: none;
}
.fade-bottom {
  position: absolute;
  inset: auto 0 0;
  height: 18%;
  background: linear-gradient(rgb(11 13 16 / 0), rgb(11 13 16 / 0.85));
  pointer-events: none;
}
.reading-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  pointer-events: none;
}
.mark {
  position: absolute;
  top: -16px;
  width: 0;
  height: 0;
  border-top: 16px solid transparent;
  border-bottom: 16px solid transparent;
}
.mark.left {
  left: max(16px, calc(13% - 54px));
  border-left: 26px solid #f0b43c;
}
.mark.right {
  right: max(16px, calc(13% - 54px));
  border-right: 26px solid #f0b43c;
}
.countdown {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgb(11 13 16 / 0.72);
}
.count {
  font-family: var(--font-display);
  font-size: 180px;
  font-weight: 700;
  line-height: 1;
}
.count-hint {
  font-size: 26px;
  color: #c9c6be;
}
.paused-badge {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 22px;
  border-radius: 14px;
  background: #f0b43c;
  color: #1a1408;
  font-size: 22px;
  font-weight: 700;
}
/* Pequeña y abajo, en la franja que ya está apagada (lo que se leerá dentro de varias líneas). */
.camera {
  position: absolute;
  right: 16px;
  bottom: 12px;
  width: clamp(150px, 13vw, 250px);
  aspect-ratio: 16 / 9;
  border-radius: 14px;
  overflow: hidden;
  background: #000;
  box-shadow: 0 0 0 2px rgb(255 255 255 / 0.18);
}
.camera video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
  display: block;
}
.rec-dot {
  position: absolute;
  left: 8px;
  top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 8px;
  background: rgb(0 0 0 / 0.6);
  font-size: 14px;
  font-weight: 700;
}
.rec-dot span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ff4b3e;
  animation: blink 1.2s ease-in-out infinite;
}
@keyframes blink {
  50% {
    opacity: 0.3;
  }
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 20px;
  background: #16191e;
  border-top: 1px solid #2a2f37;
}
.status {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 16px;
}
.clock {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 30px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.record .clock :deep(.app-icon) {
  color: #ff4b3e;
}
.status-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 18px;
  line-height: 1.25;
  color: #d8d5cd;
}
.status-text strong {
  font-size: 19px;
  color: #f6f4ee;
}
.status.warn .status-text,
.status.warn .status-text strong {
  color: #ffc861;
}
.status.danger .status-text,
.status.danger .status-text strong,
.status.danger .clock {
  color: #ff7b6e;
}
.status.done .status-text span {
  color: #7fe0a4;
  font-weight: 650;
}
.pace {
  color: #a9a59c;
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.btn.dark {
  background: #232830;
  border-color: #3a414b;
  color: #f6f4ee;
}
.btn.dark:hover:not(:disabled) {
  background: #2d333d;
  border-color: #59626e;
}
.btn.dark.pause {
  min-width: 132px;
}
.btn.finish {
  background: #c8382d;
  border-color: #c8382d;
  color: #fff;
  min-height: 56px;
  font-size: 19px;
}
.btn.finish:hover:not(:disabled) {
  background: #a92c23;
  border-color: #a92c23;
}
.rehearse .btn.finish {
  background: #155e8c;
  border-color: #155e8c;
}
@media (max-width: 1400px) {
  .bar {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .controls {
    justify-content: center;
  }
}
</style>
