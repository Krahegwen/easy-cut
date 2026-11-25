<script setup lang="ts">
// «Arreglar este trozo»: vista previa en bucle y pestañas Cortar, Quitar pausas, Encuadrar, Velocidad y Sonido.
// Todo cambio se ve al momento; lo que se arrastra entra en el historial al soltar.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import DurationBar from '../components/DurationBar.vue'
import Filmstrip from '../components/Filmstrip.vue'
import type { IconName } from '../components/icons'
import type { PanEvent, PlayerTime } from '../components/player-types'
import PreviewPlayer from '../components/PreviewPlayer.vue'
import ThumbImage from '../components/ThumbImage.vue'
import UndoRedo from '../components/UndoRedo.vue'
import {
  clipInOut,
  clipMatchesAspect,
  clipOutputMs,
  computeFramingLayout,
  findClip,
  fitAspect,
  formatClock,
  formatDuration,
  formatDurationChange,
  keptSourceMs,
  MAX_ZOOM,
  MIN_PIECE_MS,
  panOffset,
  projectDurationMs,
  removedRanges,
  resetKeepSegments,
  rotateClip,
  setFraming,
  setInOut,
  setMuted,
  setSpeed,
  sourceToOutput,
  splitClip,
  applyKeepSegments,
  type Clip,
  type FramingMode,
  type PauseLevel,
  type Project,
  type Speed,
} from '../domain'
import { setKeyHandler } from '../lib/keys'
import {
  cancelPauseSearch,
  candidateSegments,
  coversRange,
  pauseState,
  reapplyPauses,
  searchPauses,
  updatePauseState,
} from '../lib/pauses'
import { store } from '../store'

type Tab = 'cut' | 'pauses' | 'frame' | 'speed' | 'sound'
const tabs: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'cut', icon: 'scissors', label: 'Cortar' },
  { id: 'pauses', icon: 'pauses', label: 'Quitar pausas' },
  { id: 'frame', icon: 'frame', label: 'Encuadrar' },
  { id: 'speed', icon: 'speed', label: 'Velocidad' },
  { id: 'sound', icon: 'sound', label: 'Sonido' },
]
const tab = ref<Tab>('cut')

const player = ref<InstanceType<typeof PreviewPlayer> | null>(null)
const playheadMs = ref(0)

const clipId = computed(() => store.editingClipId.value)
const clip = computed<Clip | null>(() => (clipId.value ? findClip(store.project.value, clipId.value) ?? null : null))
const media = computed(() => (clip.value ? store.media.value[clip.value.sourcePath] ?? null : null))
const clipNumber = computed(() => store.project.value.clips.findIndex((c) => c.id === clipId.value) + 1)
const io = computed(() => (clip.value ? clipInOut(clip.value) : { startMs: 0, endMs: 0 }))

// ------------------------------------------------------------------ pausas (propuesta en vivo)

const pauses = computed(() => (clip.value ? pauseState(clip.value.id) : null))
const applied = computed(() => (clip.value ? clip.value.segments.length > 1 : false))
const candidate = computed(() => (clip.value && pauses.value ? candidateSegments(pauses.value, clip.value) : null))
/** Propuesta pendiente de decidir: se ve en la vista previa mientras se está en la pestaña. */
const pending = computed(
  () => tab.value === 'pauses' && !!candidate.value && !applied.value && !pauses.value?.dismissed && candidate.value.length > 1,
)

const displayClip = computed<Clip | null>(() => {
  const c = clip.value
  if (!c) return null
  return pending.value && candidate.value ? { ...c, segments: candidate.value } : c
})
const previewProject = computed<Project>(() => ({
  ...store.project.value,
  clips: displayClip.value ? [displayClip.value] : [],
}))

// ------------------------------------------------------------------ duraciones

const entryClip = computed(() => (store.editingEntry.value && clipId.value ? findClip(store.editingEntry.value, clipId.value) ?? null : null))
const clipAfterMs = computed(() => (displayClip.value ? clipOutputMs(displayClip.value) : 0))
const clipBeforeMs = computed(() => (entryClip.value ? clipOutputMs(entryClip.value) : clipAfterMs.value))
const totalMs = computed(() => store.durationMs.value - (clip.value ? clipOutputMs(clip.value) : 0) + clipAfterMs.value)
const projectBeforeMs = computed(() => (store.editingEntry.value ? projectDurationMs(store.editingEntry.value) : totalMs.value))

// ------------------------------------------------------------------ vista previa

function onTime(t: PlayerTime) {
  playheadMs.value = t.sourceMs
}

function showAt(ms: number) {
  const c = clip.value
  if (!c) return
  const v = Math.min(Math.max(0, ms), c.sourceDurationMs)
  playheadMs.value = v
  player.value?.showSource(0, v)
}

onMounted(() => {
  showAt(io.value.startMs)
  setKeyHandler((e) => {
    if (e.key === ' ') {
      player.value?.toggle()
      return true
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      step(e.key === 'ArrowLeft' ? -1000 : 1000)
      return true
    }
    return false
  })
})
onBeforeUnmount(() => {
  setKeyHandler(null)
  store.cancelPreview()
})

// ------------------------------------------------------------------ Cortar

const minGap = computed(() => Math.max(500, MIN_PIECE_MS * (clip.value?.speed ?? 1) + 100))

function withPauses(fn: (p: Project) => Project): (p: Project) => Project {
  return (p) => (clipId.value ? reapplyPauses(fn(p), clipId.value) : fn(p))
}

function dragIn(ms: number, phase: 'start' | 'move' | 'end') {
  const c = clip.value
  if (!c) return
  const v = Math.min(ms, io.value.endMs - minGap.value)
  store.preview(withPauses((p) => setInOut(p, c.id, { inMs: v })))
  showAt(v)
  if (phase === 'end') store.commitPreview()
}

function dragOut(ms: number, phase: 'start' | 'move' | 'end') {
  const c = clip.value
  if (!c) return
  const v = Math.max(ms, io.value.startMs + minGap.value)
  store.preview(withPauses((p) => setInOut(p, c.id, { outMs: v })))
  showAt(v)
  if (phase === 'end') store.commitPreview()
}

function scrub(ms: number) {
  showAt(ms)
}

function step(delta: number) {
  showAt(playheadMs.value + delta)
}

function startHere() {
  const c = clip.value
  if (!c) return
  const before = store.project.value
  store.apply(withPauses((p) => setInOut(p, c.id, { inMs: playheadMs.value })))
  if (store.project.value === before) store.showToast('Aquí no puede empezar: quedaría demasiado corto.')
}

function endHere() {
  const c = clip.value
  if (!c) return
  const before = store.project.value
  store.apply(withPauses((p) => setInOut(p, c.id, { outMs: playheadMs.value })))
  if (store.project.value === before) store.showToast('Aquí no puede terminar: quedaría demasiado corto.')
}

function splitHere() {
  const c = clip.value
  if (!c) return
  const at = sourceToOutput(c, playheadMs.value)
  if (at === null) {
    store.showToast('Pon la imagen dentro de la parte que se queda para partir ahí.')
    return
  }
  const before = store.project.value
  store.apply((p) => splitClip(p, c.id, at))
  if (store.project.value === before) {
    store.showToast('Demasiado cerca del principio o del final para partir aquí.')
    return
  }
  store.showToast('Trozo partido en dos')
}

function resetCut() {
  const entry = entryClip.value
  const c = clip.value
  if (!entry || !c) return
  const entryCount = store.editingEntry.value?.clips.length ?? 0
  if (store.project.value.clips.length !== entryCount) {
    // Se ha partido: lo que estaba era el trozo entero.
    store.revertClipChanges()
    return
  }
  const e = clipInOut(entry)
  store.apply(withPauses((p) => setInOut(p, c.id, { inMs: e.startMs, outMs: e.endMs })))
}

const cutChanged = computed(() => {
  const entry = entryClip.value
  if (!entry || !clip.value) return false
  const a = clipInOut(entry)
  return a.startMs !== io.value.startMs || a.endMs !== io.value.endMs || store.project.value.clips.length !== (store.editingEntry.value?.clips.length ?? 0)
})

// ------------------------------------------------------------------ Quitar pausas

const hasAudio = computed(() => media.value?.hasAudio ?? false)
const levels: { id: PauseLevel; label: string }[] = [
  { id: 'few', label: 'Pocas' },
  { id: 'normal', label: 'Normal' },
  { id: 'many', label: 'Muchas' },
]

const pauseCount = computed(() => (candidate.value ? removedRanges(candidate.value, io.value).length : 0))
const pauseHighlights = computed(() => {
  if (tab.value !== 'pauses' || !candidate.value || (applied.value === false && pauses.value?.dismissed)) return []
  return removedRanges(candidate.value, io.value)
})
const candidateMs = computed(() =>
  clip.value && candidate.value ? Math.round(candidate.value.reduce((s, r) => s + r.endMs - r.startMs, 0) / clip.value.speed) : 0,
)
const withoutPausesMs = computed(() => (clip.value ? Math.round((io.value.endMs - io.value.startMs) / clip.value.speed) : 0))

function findPauses() {
  if (clip.value) void searchPauses(clip.value)
}

function setLevel(level: PauseLevel) {
  const c = clip.value
  if (!c) return
  updatePauseState(c.id, { level, dismissed: false })
  if (applied.value) {
    const keep = candidateSegments(pauseState(c.id), c)
    if (keep) store.apply((p) => (keep.length > 1 ? applyKeepSegments(p, c.id, keep) : resetKeepSegments(p, c.id)))
  }
}

function removePauses() {
  const c = clip.value
  const keep = candidate.value
  if (!c || !keep) return
  store.apply((p) => applyKeepSegments(p, c.id, keep))
  updatePauseState(c.id, { dismissed: false })
}

function keepPauses() {
  const c = clip.value
  if (!c) return
  if (applied.value) store.apply((p) => resetKeepSegments(p, c.id))
  updatePauseState(c.id, { dismissed: true })
}

// Si se cambia el inicio o el fin fuera de lo analizado, se vuelve a buscar al estar en la pestaña.
watch([tab, io], () => {
  const c = clip.value
  const s = pauses.value
  if (tab.value !== 'pauses' || !c || !s || !hasAudio.value) return
  if (s.status === 'done' && !coversRange(s, c)) void searchPauses(c)
})

// ------------------------------------------------------------------ Encuadrar

const matches = computed(() => (clip.value && media.value ? clipMatchesAspect(clip.value, media.value, store.project.value.aspect) : true))
const canPan = ref(false)
watch(
  [clip, media, () => store.project.value.aspect],
  () => {
    if (!clip.value || !media.value) return
    const f = fitAspect(store.project.value.aspect, 640, 640)
    const l = computeFramingLayout(clip.value, media.value, f.width, f.height)
    canPan.value = l.canPanX || l.canPanY
  },
  { immediate: true },
)

function setMode(mode: FramingMode) {
  const c = clip.value
  if (c) store.apply((p) => setFraming(p, c.id, { mode }))
}
function zoom(delta: number) {
  const c = clip.value
  if (c) store.apply((p) => setFraming(p, c.id, { zoom: Math.round((c.framing.zoom + delta) * 100) / 100 }))
}
function center() {
  const c = clip.value
  if (c) store.apply((p) => setFraming(p, c.id, { offsetX: 0, offsetY: 0 }))
}
function rotate(direction: 1 | -1) {
  const c = clip.value
  if (c) store.apply((p) => rotateClip(p, c.id, direction))
}

let panBase: { offsetX: number; offsetY: number } | null = null
function onPan(e: PanEvent) {
  const c = clip.value
  if (!c || tab.value !== 'frame') return
  if (e.phase === 'start') {
    panBase = { offsetX: c.framing.offsetX, offsetY: c.framing.offsetY }
    return
  }
  if (!panBase) return
  const next = panOffset(e.layout, e.frameWidth, e.frameHeight, panBase, e.dx, e.dy)
  store.preview((p) => setFraming(p, c.id, next))
  if (e.phase === 'end') {
    store.commitPreview()
    panBase = null
  }
}

/** Miniatura de cómo quedaría cada modo de encuadre. */
function modePreview(mode: FramingMode) {
  const c = clip.value
  const m = media.value
  if (!c || !m) return null
  const frame = fitAspect(store.project.value.aspect, 132, 96)
  const l = computeFramingLayout({ ...c, framing: { mode, zoom: 1, offsetX: 0, offsetY: 0 } }, m, frame.width, frame.height)
  return {
    frame: { width: `${frame.width}px`, height: `${frame.height}px` },
    img: {
      width: `${l.elementWidth}px`,
      height: `${l.elementHeight}px`,
      left: `${l.left + l.width / 2 - l.elementWidth / 2}px`,
      top: `${l.top + l.height / 2 - l.elementHeight / 2}px`,
      transform: l.rotationDeg ? `rotate(${l.rotationDeg}deg)` : undefined,
    },
    blur: l.showsBackground,
  }
}

// ------------------------------------------------------------------ Velocidad y sonido

const speeds: { id: Speed; label: string }[] = [
  { id: 0.5, label: 'Más despacio' },
  { id: 1, label: 'Normal' },
  { id: 2, label: 'Más rápido' },
  { id: 4, label: 'Muy rápido' },
]
function speedDuration(s: Speed): string {
  return clip.value ? formatDuration(Math.round(keptSourceMs(clip.value) / s)) : ''
}
function chooseSpeed(s: Speed) {
  const c = clip.value
  if (c) store.apply((p) => setSpeed(p, c.id, s))
}
function chooseMuted(muted: boolean) {
  const c = clip.value
  if (c) store.apply((p) => setMuted(p, c.id, muted))
}

// ------------------------------------------------------------------ pie

function done() {
  player.value?.pause()
  if (clip.value) cancelPauseSearch(clip.value.id)
  store.closeClipEditor()
}
</script>

<template>
  <main v-if="clip && media" class="screen clip-editor" data-testid="clip-editor">
    <header class="topbar">
      <button class="btn quiet" type="button" data-testid="clip-back" @click="done">
        <AppIcon name="back" />
        Volver
      </button>
      <h1>Arreglar el trozo {{ clipNumber }}</h1>
      <span class="spacer" />
      <UndoRedo />
    </header>

    <DurationBar
      :total-ms="totalMs"
      :target-ms="store.project.value.targetDurationMs"
      :clip-before-ms="clipBeforeMs"
      :clip-after-ms="clipAfterMs"
      :project-before-ms="projectBeforeMs"
    />

    <nav class="tabs" role="tablist" aria-label="Herramientas">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="tab"
        :class="{ active: tab === t.id }"
        type="button"
        role="tab"
        :aria-selected="tab === t.id"
        :data-testid="`tab-${t.id}`"
        @click="tab = t.id"
      >
        <AppIcon :name="t.icon" :size="24" />
        {{ t.label }}
      </button>
    </nav>

    <div class="content" :class="{ 'with-strip': tab === 'cut' || tab === 'pauses' }">
      <section class="preview">
        <PreviewPlayer
          ref="player"
          :project="previewProject"
          loop
          :pannable="tab === 'frame'"
          clock-label="Posición en el trozo"
          @time="onTime"
          @pan="onPan"
        />
      </section>

      <aside class="panel" data-testid="tool-panel">
        <!-- Cortar -->
        <template v-if="tab === 'cut'">
          <p class="facts" data-testid="cut-facts">
            Empieza en <strong>{{ formatClock(io.startMs) }}</strong> · Termina en <strong>{{ formatClock(io.endMs) }}</strong>
          </p>
          <div class="pair">
            <button class="btn" type="button" data-testid="step-back" @click="step(-1000)">
              <AppIcon name="step-back" />
              1 segundo atrás
            </button>
            <button class="btn" type="button" data-testid="step-forward" @click="step(1000)">
              1 segundo adelante
              <AppIcon name="step-forward" />
            </button>
          </div>
          <div class="pair">
            <button class="btn strong" type="button" data-testid="start-here" @click="startHere">
              <AppIcon name="start-here" />
              Empieza aquí
            </button>
            <button class="btn strong" type="button" data-testid="end-here" @click="endHere">
              <AppIcon name="end-here" />
              Termina aquí
            </button>
          </div>
          <button class="btn strong" type="button" data-testid="split-here" @click="splitHere">
            <AppIcon name="split" />
            Partir aquí
          </button>
          <button class="btn quiet" type="button" :disabled="!cutChanged" data-testid="reset-cut" @click="resetCut">
            <AppIcon name="reset" />
            Volver a como estaba
          </button>
        </template>

        <!-- Quitar pausas -->
        <template v-else-if="tab === 'pauses'">
          <template v-if="!hasAudio">
            <div class="note">
              <AppIcon name="mute" />
              <p>Este trozo no tiene sonido, así que no hay pausas que buscar. Las pausas se encuentran por los silencios al hablar.</p>
            </div>
            <button class="btn" type="button" disabled>
              <AppIcon name="search" />
              Buscar pausas
            </button>
          </template>
          <template v-else-if="pauses?.status === 'searching'">
            <div class="searching" data-testid="pauses-searching">
              <span class="spinner" />
              <p>Buscando pausas…</p>
            </div>
            <button class="btn quiet" type="button" @click="cancelPauseSearch(clip.id)">
              <AppIcon name="close" />
              Dejar de buscar
            </button>
          </template>
          <template v-else-if="pauses?.status === 'done' && candidate">
            <p v-if="pauseCount === 0" class="note" data-testid="pauses-none">
              No he encontrado pausas. Suele pasar si hay ruido o música de fondo.
            </p>
            <template v-else>
              <p class="found" data-testid="pauses-found">
                He encontrado {{ pauseCount }} {{ pauseCount === 1 ? 'pausa' : 'pausas' }}.
                <span>Este trozo: <strong>{{ formatDurationChange(withoutPausesMs, candidateMs) }}</strong></span>
              </p>
              <p class="legend"><span class="swatch" /> En naranja, lo que se quita.</p>
            </template>
            <div class="levels" role="radiogroup" aria-label="Cuántas pausas quitar">
              <button
                v-for="l in levels"
                :key="l.id"
                class="btn"
                :class="{ selected: pauses.level === l.id }"
                type="button"
                role="radio"
                :aria-checked="pauses.level === l.id"
                :data-testid="`level-${l.id}`"
                @click="setLevel(l.id)"
              >
                {{ l.label }}
              </button>
            </div>
            <p v-if="applied" class="applied" data-testid="pauses-applied"><AppIcon name="check" /> Pausas quitadas</p>
            <div v-if="pauseCount > 0" class="pair">
              <button class="btn primary" type="button" :disabled="applied" data-testid="remove-pauses" @click="removePauses">
                <AppIcon name="pauses" />
                Quitar las pausas
              </button>
              <button class="btn" type="button" :disabled="!applied && pauses.dismissed" data-testid="keep-pauses" @click="keepPauses">
                <AppIcon name="undo" />
                Dejar las pausas
              </button>
            </div>
          </template>
          <template v-else>
            <p class="lead">Busco los silencios al hablar y los quito, para que el vídeo vaya al grano y dure menos.</p>
            <p v-if="applied" class="applied"><AppIcon name="check" /> Ya has quitado pausas en este trozo.</p>
            <button class="btn primary large" type="button" data-testid="find-pauses" @click="findPauses">
              <AppIcon name="search" />
              Buscar pausas
            </button>
            <button v-if="applied" class="btn" type="button" data-testid="keep-pauses" @click="keepPauses">
              <AppIcon name="undo" />
              Dejar las pausas
            </button>
          </template>
        </template>

        <!-- Encuadrar -->
        <template v-else-if="tab === 'frame'">
          <template v-if="!matches">
            <p class="lead">Este trozo tiene otra forma que el vídeo. ¿Cómo lo pongo?</p>
            <div class="modes">
              <button
                v-for="m in (['fit-blur', 'fill'] as const)"
                :key="m"
                class="mode"
                :class="{ selected: clip.framing.mode === m }"
                type="button"
                :data-testid="`mode-${m}`"
                @click="setMode(m)"
              >
                <span v-if="modePreview(m)" class="mini" :style="modePreview(m)!.frame">
                  <span v-if="modePreview(m)!.blur" class="mini-bg"><ThumbImage :path="clip.sourcePath" :time-ms="io.startMs + 300" :height="72" /></span>
                  <span class="mini-img" :style="modePreview(m)!.img"><ThumbImage :path="clip.sourcePath" :time-ms="io.startMs + 300" :height="72" fit="contain" /></span>
                </span>
                <span>{{ m === 'fit-blur' ? 'Que se vea entero' : 'Que llene la pantalla' }}</span>
              </button>
            </div>
          </template>
          <p class="lead small">{{ canPan ? 'Arrastra la imagen para moverla.' : 'Acerca la imagen para poder moverla.' }}</p>
          <div class="pair">
            <button class="btn" type="button" :disabled="clip.framing.zoom >= MAX_ZOOM" data-testid="zoom-in" @click="zoom(0.25)">
              <AppIcon name="zoom-in" />
              Acercar
            </button>
            <button class="btn" type="button" :disabled="clip.framing.zoom <= 1" data-testid="zoom-out" @click="zoom(-0.25)">
              <AppIcon name="zoom-out" />
              Alejar
            </button>
          </div>
          <button class="btn" type="button" data-testid="center" @click="center">
            <AppIcon name="center" />
            Centrar
          </button>
          <div class="pair">
            <button class="btn" type="button" data-testid="rotate-left" @click="rotate(-1)">
              <AppIcon name="rotate-left" />
              Girar a la izquierda
            </button>
            <button class="btn" type="button" data-testid="rotate-right" @click="rotate(1)">
              <AppIcon name="rotate-right" />
              Girar a la derecha
            </button>
          </div>
        </template>

        <!-- Velocidad -->
        <template v-else-if="tab === 'speed'">
          <div class="speeds">
            <button
              v-for="s in speeds"
              :key="s.id"
              class="speed"
              :class="{ selected: clip.speed === s.id }"
              type="button"
              :data-testid="`speed-${s.id}`"
              @click="chooseSpeed(s.id)"
            >
              <strong>{{ s.label }}</strong>
              <span>El trozo durará {{ speedDuration(s.id) }}</span>
            </button>
          </div>
          <p v-if="clip.speed === 4" class="note warn" data-testid="speed-warning">
            <AppIcon name="mute" />
            A esta velocidad el sonido no se entiende, así que se quita.
          </p>
        </template>

        <!-- Sonido -->
        <template v-else-if="tab === 'sound'">
          <template v-if="!hasAudio">
            <p class="note"><AppIcon name="mute" /> Este vídeo no tiene sonido.</p>
          </template>
          <template v-else>
            <div class="pair tall">
              <button class="btn" :class="{ selected: !clip.muted }" type="button" data-testid="sound-on" @click="chooseMuted(false)">
                <AppIcon name="sound" />
                Con sonido
              </button>
              <button class="btn" :class="{ selected: clip.muted }" type="button" data-testid="sound-off" @click="chooseMuted(true)">
                <AppIcon name="mute" />
                Sin sonido
              </button>
            </div>
            <p v-if="clip.speed === 4" class="note warn">
              <AppIcon name="warning" />
              Con «Muy rápido» el trozo va sin sonido de todas formas.
            </p>
          </template>
        </template>
      </aside>

      <section v-if="tab === 'cut' || tab === 'pauses'" class="strip">
        <Filmstrip
          :path="clip.sourcePath"
          :duration-ms="clip.sourceDurationMs"
          :in-ms="io.startMs"
          :out-ms="io.endMs"
          :segments="pending && candidate ? [] : clip.segments"
          :playhead-ms="playheadMs"
          :highlights="pauseHighlights"
          :editable="tab === 'cut'"
          :caption="tab === 'cut' ? 'Mueve las asas blancas, o pon la imagen donde quieras y pulsa un botón' : ''"
          @drag-in="dragIn"
          @drag-out="dragOut"
          @scrub="scrub"
        />
      </section>
    </div>

    <footer class="footer">
      <button class="btn" type="button" data-testid="revert-clip" @click="store.revertClipChanges()">
        <AppIcon name="reset" />
        Deshacer los cambios de este trozo
      </button>
      <button class="btn primary large" type="button" data-testid="clip-done" @click="done">
        <AppIcon name="check" />
        Listo
      </button>
    </footer>
  </main>
</template>

<style scoped>
.tabs {
  flex: none;
  display: flex;
  gap: 6px;
  padding: 10px 20px 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 54px;
  padding: 0 20px;
  border: none;
  border-bottom: 4px solid transparent;
  background: transparent;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 10px 10px 0 0;
}
.tab:hover {
  background: var(--surface-2);
  color: var(--text);
}
.tab.active {
  color: var(--accent-hover);
  border-bottom-color: var(--accent);
  background: var(--accent-soft);
}
.content {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 440px;
  grid-template-rows: minmax(0, 1fr);
  gap: 16px;
  padding: 16px 20px 12px;
}
.content.with-strip {
  grid-template-rows: minmax(0, 1fr) auto;
}
.preview {
  min-height: 0;
  min-width: 0;
}
.panel {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.strip {
  grid-column: 1 / -1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 0 0 8px;
}
.lead {
  color: var(--text-muted);
}
.lead.small {
  font-size: 16px;
}
.facts strong {
  font-variant-numeric: tabular-nums;
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.pair .btn {
  padding: 0 8px;
  gap: 8px;
  font-size: 16px;
  white-space: normal;
  line-height: 1.15;
  text-align: center;
}
.pair.tall .btn {
  min-height: 72px;
}
.strong {
  border-color: var(--accent);
  color: var(--accent-hover);
}
.strong:hover:not(:disabled) {
  background: var(--accent-soft) !important;
  border-color: var(--accent) !important;
}
.note {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.note.warn {
  background: var(--warn-soft);
  border-color: color-mix(in srgb, var(--warn) 30%, var(--border));
  color: var(--warn);
  font-weight: 600;
}
.searching {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 600;
}
.found {
  font-size: 19px;
  font-weight: 650;
}
.found span {
  display: block;
  font-weight: 400;
  color: var(--text-muted);
  font-size: 17px;
  margin-top: 2px;
}
.found strong {
  color: var(--text);
}
.legend {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  color: var(--text-muted);
}
.swatch {
  width: 22px;
  height: 14px;
  border-radius: 3px;
  background: repeating-linear-gradient(135deg, rgb(224 138 30 / 0.95) 0 5px, rgb(224 138 30 / 0.6) 5px 10px);
}
.levels {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.applied {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--good);
  font-weight: 650;
}
.modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.mode {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  font-weight: 600;
  font-size: 16px;
}
.mode.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.mini {
  position: relative;
  display: block;
  overflow: hidden;
  background: #000;
  border-radius: 4px;
}
.mini-bg {
  position: absolute;
  inset: -10%;
  filter: blur(8px) brightness(0.8);
}
.mini-img {
  position: absolute;
  display: block;
}
.speeds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.speed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 80px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1.5px solid var(--border-strong);
  background: var(--surface);
  cursor: pointer;
  text-align: left;
}
.speed strong {
  font-size: 18px;
}
.speed span {
  color: var(--text-muted);
  font-size: 15px;
}
.speed.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.speed.selected strong {
  color: var(--accent-hover);
}
.footer {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: var(--surface);
  border-top: 1px solid var(--border);
}
@media (max-width: 1250px) {
  .content {
    grid-template-columns: minmax(0, 1fr) 380px;
  }
  .tab {
    padding: 0 14px;
  }
}
@media (max-height: 760px) {
  .tab {
    min-height: 46px;
  }
  .tabs {
    padding-top: 6px;
  }
  .content {
    padding: 10px 20px 8px;
    gap: 10px;
  }
  .panel {
    padding: 12px;
    gap: 8px;
  }
  .footer {
    padding: 6px 20px;
  }
  .pair .btn,
  .panel > .btn {
    min-height: 44px;
  }
}
</style>
