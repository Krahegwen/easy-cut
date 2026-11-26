<script setup lang="ts">
// «Arreglar este trozo»: vista previa en bucle y pestañas Cortar, Quitar pausas, Encuadrar, Imagen, Velocidad
// y Sonido. Todo cambio se ve al momento; lo que se arrastra entra en el historial al soltar.
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
  baseName,
  clipInOut,
  clipMatchesAspect,
  clipOutputMs,
  computeFramingLayout,
  coverShortfallMs,
  findClip,
  fitAspect,
  formatClock,
  formatDuration,
  keptSourceMs,
  MAX_ZOOM,
  maxCoverStartMs,
  MIN_PIECE_MS,
  panOffset,
  projectDurationMs,
  removeCover,
  removedRanges,
  resetKeepSegments,
  rotateClip,
  setCoverFraming,
  setCoverStart,
  setFraming,
  setInOut,
  setMuted,
  setPicture,
  findClipVideoItem,
  setSpeed,
  sourceToOutput,
  splitClip,
  inSharedJoin,
  applyKeepSegments,
  type Clip,
  type CoverPicture,
  type FramingMode,
  type PauseLevel,
  type Picture,
  type Project,
  type Speed,
} from '../domain'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import { useShortcuts } from '../lib/use-shortcuts'
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

type Tab = 'cut' | 'pauses' | 'frame' | 'picture' | 'speed' | 'sound'
const tabs: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'cut', icon: 'scissors', label: 'Cortar' },
  { id: 'pauses', icon: 'pauses', label: 'Quitar pausas' },
  { id: 'frame', icon: 'frame', label: 'Encuadrar' },
  { id: 'picture', icon: 'image', label: 'Imagen' },
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
  // Si el vídeo de encima no está en el disco, la vista previa enseña lo de serie.
  clips: displayClip.value ? [store.visibleClip(displayClip.value)] : [],
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
  // Viene de «Quitar las pausas de esta grabación»: directo a la pestaña, con la búsqueda lanzada.
  const start = store.clipEditorStart.value
  store.clipEditorStart.value = null
  if (start?.tab === 'picture') tab.value = 'picture'
  if (start?.tab === 'pauses') {
    tab.value = 'pauses'
    if (start.findPauses && hasAudio.value && pauses.value?.status !== 'searching') findPauses()
  }
})
onBeforeUnmount(() => {
  store.cancelPreview()
})

// ------------------------------------------------------------------ teclas

const playing = computed(() => !!player.value?.playing)

useShortcuts({
  id: 'clip-editor',
  title: 'Arreglar este trozo',
  shortcuts: () => {
    const cut = tab.value === 'cut'
    return [
      { id: 'play', keys: ['Space'], label: 'Espacio', description: 'reproducir o parar', run: () => player.value?.toggle() },
      { id: 'stop', keys: ['Escape'], label: 'Esc', description: 'parar y volver al principio del trozo', run: () => showAt(io.value.startMs), enabled: playing.value },
      { id: 'back', keys: ['Escape'], label: 'Esc', description: 'volver a «Tu vídeo» (los cambios se quedan)', run: done },
      { id: 'go-start', keys: ['Home'], label: 'Inicio', description: 'ir al principio del trozo', run: () => showAt(io.value.startMs) },
      { id: 'go-end', keys: ['End'], label: 'Fin', description: 'ir al final del trozo', run: () => showAt(io.value.endMs) },
      { id: 'back-1s', keys: ['ArrowLeft'], label: '←', description: '1 segundo atrás', run: () => step(-1000), repeat: true },
      { id: 'forward-1s', keys: ['ArrowRight'], label: '→', description: '1 segundo adelante', run: () => step(1000), repeat: true },
      { id: 'start-here', keys: ['e'], label: 'E', description: '«Empieza aquí» (en «Cortar»)', run: startHere, enabled: cut },
      { id: 'end-here', keys: ['t'], label: 'T', description: '«Termina aquí» (en «Cortar»)', run: endHere, enabled: cut },
      { id: 'split-here', keys: ['p'], label: 'P', description: '«Partir aquí» (en «Cortar»)', run: splitHere, enabled: cut },
      ...tabs.map((t, i) => ({
        id: `tab-${t.id}`,
        keys: [String(i + 1)],
        label: String(i + 1),
        description: `pestaña «${t.label}»`,
        run: () => (tab.value = t.id),
      })),
      { id: 'done', keys: ['l'], label: 'L', description: '«Listo»: volver a «Tu vídeo»', run: done },
      { id: 'done-enter', keys: ['Enter'], label: 'Intro', description: '«Listo» también', run: done },
    ]
  },
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
  if (inSharedJoin(store.project.value, c.id, at)) {
    store.showToast('Aquí no se puede partir: es el paso de un trozo a otro.')
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

/** Encuadrar solo tiene sentido si se ve el vídeo del propio trozo. */
const ownVisible = computed(() => !!clip.value && clip.value.sourceHasVideo && clip.value.picture.kind === 'own')
const matches = computed(() => (clip.value && media.value && ownVisible.value ? clipMatchesAspect(clip.value, media.value, store.project.value.aspect) : true))
const canPan = ref(false)
watch(
  [clip, media, () => store.project.value.aspect],
  () => {
    if (!clip.value || !media.value || !ownVisible.value) return
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

// ------------------------------------------------------------------ Imagen

const cover = computed<CoverPicture | null>(() => (clip.value?.picture.kind === 'cover' ? clip.value.picture : null))
const coverLost = computed(() => !!clip.value && store.coverMissing(clip.value))
const coverMedia = computed(() => (cover.value ? store.media.value[cover.value.sourcePath] ?? null : null))
const coverShortMs = computed(() => (clip.value ? coverShortfallMs(clip.value) : 0))
const coverMaxStart = computed(() => (cover.value ? maxCoverStartMs(cover.value.sourceDurationMs) : 0))
/** Instantes de la tira de miniaturas de «Empieza en…». */
const coverStripTimes = computed(() => {
  const c = cover.value
  if (!c) return []
  const n = 6
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * c.sourceDurationMs) / n))
})
/** Último vídeo de encima de cada trozo, para recuperarlo si se vuelve a «Poner otro vídeo encima». */
const lastCovers = new Map<string, CoverPicture>()

async function choosePicture(kind: Picture['kind']) {
  const c = clip.value
  if (!c) return
  if (c.picture.kind === 'cover') lastCovers.set(c.id, c.picture)
  if (kind === 'own' || kind === 'none') {
    const hadOwnVideo = !!findClipVideoItem(store.project.value, c.id)
    store.apply((p) => setPicture(p, c.id, { kind }))
    if (hadOwnVideo && !findClipVideoItem(store.project.value, c.id)) {
      store.showToast('Tu vídeo encima (en la esquina) se ha quitado: solo va encima de otro vídeo.', { label: 'Deshacer', run: store.undo })
    }
    return
  }
  if (c.picture.kind === 'cover') return
  const saved = lastCovers.get(c.id)
  if (saved && store.media.value[saved.sourcePath] && !store.missing.value[saved.sourcePath]) {
    store.apply((p) => setPicture(p, c.id, saved))
    return
  }
  player.value?.pause()
  await store.pickCover(c.id)
}

async function changeCover() {
  const c = clip.value
  if (!c) return
  player.value?.pause()
  await store.pickCover(c.id)
}

function dropCover() {
  const c = clip.value
  if (!c) return
  const hadOwnVideo = !!findClipVideoItem(store.project.value, c.id)
  store.apply((p) => removeCover(p, c.id))
  if (hadOwnVideo) store.showToast('Tu vídeo encima (en la esquina) se ha quitado: solo va encima de otro vídeo.', { label: 'Deshacer', run: store.undo })
}

function dragCoverStart(e: Event, commit: boolean) {
  const c = clip.value
  if (!c) return
  const v = Number((e.target as HTMLInputElement).value)
  store.preview((p) => setCoverStart(p, c.id, v))
  if (commit) store.commitPreview()
}

function stepCoverStart(delta: number) {
  const c = clip.value
  const cv = cover.value
  if (c && cv) store.apply((p) => setCoverStart(p, c.id, cv.startMs + delta))
}

function setCoverMode(mode: FramingMode) {
  const c = clip.value
  if (c) store.apply((p) => setCoverFraming(p, c.id, { mode }))
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
        <KeyHint k="Esc" />
      </button>
      <h1>Arreglar el trozo {{ clipNumber }}</h1>
      <span class="spacer" />
      <KeysButton />
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
        <KeyHint :k="String(tabs.indexOf(t) + 1)" />
      </button>
    </nav>

    <div class="content" :class="{ 'with-strip': tab === 'cut' || tab === 'pauses' }">
      <section class="preview">
        <PreviewPlayer
          ref="player"
          :project="previewProject"
          loop
          :pannable="tab === 'frame' && ownVisible"
          clock-label="Posición en el trozo"
          anchor="source"
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
              <KeyHint k="←" />
            </button>
            <button class="btn" type="button" data-testid="step-forward" @click="step(1000)">
              1 segundo adelante
              <AppIcon name="step-forward" />
              <KeyHint k="→" />
            </button>
          </div>
          <div class="pair">
            <button class="btn strong" type="button" data-testid="start-here" @click="startHere">
              <AppIcon name="start-here" />
              Empieza aquí
              <KeyHint k="E" />
            </button>
            <button class="btn strong" type="button" data-testid="end-here" @click="endHere">
              <AppIcon name="end-here" />
              Termina aquí
              <KeyHint k="T" />
            </button>
          </div>
          <button class="btn strong" type="button" data-testid="split-here" @click="splitHere">
            <AppIcon name="split" />
            Partir aquí
            <KeyHint k="P" />
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
                <!-- Solo el ahorro: el «antes → después» del trozo está arriba, en la barra de duración. -->
                <span>Quitarlas ahorra <strong>{{ formatDuration(Math.max(0, withoutPausesMs - candidateMs)) }}</strong>.</span>
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
        <template v-else-if="tab === 'frame' && !ownVisible">
          <div class="note" data-testid="frame-nothing">
            <AppIcon :name="cover ? 'cover-video' : 'wave'" />
            <p v-if="cover">Lo que se ve es el vídeo de encima. Cómo se ve («entero» o «que llene la pantalla») se elige en la pestaña «Imagen».</p>
            <p v-else>Este trozo solo se oye: no hay imagen que encuadrar.</p>
          </div>
          <button class="btn" type="button" data-testid="frame-go-picture" @click="tab = 'picture'">
            <AppIcon name="image" />
            Ir a «Imagen»
          </button>
        </template>
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

        <!-- Imagen: qué se ve mientras suena el trozo -->
        <template v-else-if="tab === 'picture'">
          <div class="pictures" :class="{ two: !clip.sourceHasVideo }" role="radiogroup" aria-label="Qué se ve mientras suena este trozo">
            <button
              v-if="clip.sourceHasVideo"
              class="picture-option"
              :class="{ selected: clip.picture.kind === 'own' }"
              type="button"
              role="radio"
              :aria-checked="clip.picture.kind === 'own'"
              data-testid="picture-own"
              @click="choosePicture('own')"
            >
              <svg class="sketch" viewBox="0 0 72 44" aria-hidden="true">
                <rect x="1" y="1" width="70" height="42" rx="4" fill="#4d7290" />
                <circle cx="36" cy="18" r="7" fill="#d5e6f2" />
                <path d="M22 43c2-9 8-13 14-13s12 4 14 13z" fill="#d5e6f2" />
              </svg>
              <span>Se ve el vídeo</span>
            </button>
            <button
              class="picture-option"
              :class="{ selected: clip.picture.kind === 'none' }"
              type="button"
              role="radio"
              :aria-checked="clip.picture.kind === 'none'"
              data-testid="picture-none"
              @click="choosePicture('none')"
            >
              <svg class="sketch" viewBox="0 0 72 44" aria-hidden="true">
                <rect x="1" y="1" width="70" height="42" rx="4" fill="#1c2229" />
                <path d="M22 22h3M29 16v12M34 10v24M39 15v14M44 19v6M49 22h2" stroke="#7fb4dc" stroke-width="3" stroke-linecap="round" />
              </svg>
              <span>Solo se oye</span>
            </button>
            <button
              class="picture-option"
              :class="{ selected: clip.picture.kind === 'cover' }"
              type="button"
              role="radio"
              :aria-checked="clip.picture.kind === 'cover'"
              data-testid="picture-cover"
              @click="choosePicture('cover')"
            >
              <svg class="sketch" viewBox="0 0 72 44" aria-hidden="true">
                <rect x="1" y="1" width="70" height="42" rx="4" fill="#3e6e5c" />
                <circle cx="54" cy="13" r="5" fill="#f3d27a" />
                <path d="M1 39l20-18 14 12 10-8 26 17v1a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4z" fill="#9cc7a4" />
              </svg>
              <span>Poner otro vídeo encima</span>
            </button>
          </div>

          <template v-if="cover && coverLost">
            <div class="note warn" data-testid="cover-lost">
              <AppIcon name="warning" />
              <p>No encuentro el vídeo de encima ({{ baseName(cover.sourcePath) }}). Puede que se haya movido o borrado.</p>
            </div>
            <div class="pair">
              <button class="btn primary" type="button" data-testid="cover-relink" @click="store.relink(cover.sourcePath)">
                <AppIcon name="relink" />
                Buscarlo
              </button>
              <button class="btn" type="button" data-testid="cover-change" @click="changeCover">
                <AppIcon name="folder" />
                Elegir otro
              </button>
              <button class="btn" type="button" data-testid="cover-remove" @click="dropCover">
                <AppIcon name="close" />
                Quitarlo
              </button>
            </div>
          </template>

          <template v-else-if="cover">
            <div class="chosen" data-testid="cover-chosen">
              <span class="chosen-thumb"><ThumbImage :path="cover.sourcePath" :time-ms="cover.startMs + 300" :height="72" /></span>
              <span class="chosen-text">
                <strong>{{ baseName(cover.sourcePath) }}</strong>
                <span>Dura {{ formatDuration(cover.sourceDurationMs) }} · se ve sin su sonido</span>
              </span>
            </div>
            <div class="pair">
              <button class="btn" type="button" data-testid="cover-change" @click="changeCover">
                <AppIcon name="folder" />
                Cambiarlo
              </button>
              <button class="btn" type="button" data-testid="cover-remove" @click="dropCover">
                <AppIcon name="close" />
                Quitarlo
              </button>
            </div>

            <h3 class="sub">Empieza en…</h3>
            <div class="start-strip">
              <div class="start-thumbs">
                <span v-for="t in coverStripTimes" :key="t" class="start-cell"><ThumbImage :path="cover.sourcePath" :time-ms="t" :height="56" /></span>
              </div>
              <input
                class="start-range"
                type="range"
                min="0"
                :max="coverMaxStart"
                step="100"
                :value="cover.startMs"
                aria-label="Desde qué momento del otro vídeo se ve"
                data-testid="cover-start"
                @input="dragCoverStart($event, false)"
                @change="dragCoverStart($event, true)"
              />
            </div>
            <div class="start-row">
              <button class="btn small-step" type="button" aria-label="Un segundo antes" data-testid="cover-start-back" :disabled="cover.startMs <= 0" @click="stepCoverStart(-1000)">
                <AppIcon name="step-back" />
                1 s
              </button>
              <p class="start-text" data-testid="cover-start-text">Se ve desde el <strong>{{ formatClock(cover.startMs) }}</strong> del otro vídeo</p>
              <button class="btn small-step" type="button" aria-label="Un segundo después" data-testid="cover-start-forward" :disabled="cover.startMs >= coverMaxStart" @click="stepCoverStart(1000)">
                1 s
                <AppIcon name="step-forward" />
              </button>
            </div>
            <p v-if="coverShortMs > 0" class="note warn" data-testid="cover-short">
              <AppIcon name="warning" />
              El vídeo de encima dura menos: al acabar se queda quieto en su última imagen.
            </p>

            <h3 class="sub">Cómo se ve</h3>
            <div class="pair">
              <button class="btn" :class="{ selected: cover.framing.mode === 'fit-blur' }" type="button" data-testid="cover-fit-blur" @click="setCoverMode('fit-blur')">
                <AppIcon name="horizontal" />
                Que se vea entero
              </button>
              <button class="btn" :class="{ selected: cover.framing.mode === 'fill' }" type="button" data-testid="cover-fill" @click="setCoverMode('fill')">
                <AppIcon name="frame" />
                Que llene la pantalla
              </button>
            </div>

            <p v-if="clip.sourceHasVideo" class="lead small corner-tip" data-testid="corner-tip">
              <AppIcon name="corner" />
              ¿Quieres que se te vea en una esquina? En «Tu vídeo», con este trozo elegido, «Llevar a una esquina aquí»: te encoges hasta la esquina en ese momento y puedes volver a pantalla completa más adelante.
            </p>
          </template>

          <p v-else-if="clip.picture.kind === 'none'" class="lead small" data-testid="picture-none-text">
            Mientras suena este trozo se ve un fondo liso. {{ clip.sourceHasVideo ? '' : 'Es un sonido: no tiene imagen propia.' }}
          </p>
          <p v-else class="lead small">Se ve el vídeo de este trozo, como siempre.</p>
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
          :waveform="!clip.sourceHasVideo"
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
        <KeyHint k="L" />
        <KeyHint k="Intro" />
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
.pictures {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.pictures.two {
  grid-template-columns: repeat(2, 1fr);
}
.picture-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-height: 96px;
  padding: 10px 6px 8px;
  border-radius: 12px;
  border: 1.5px solid var(--border-strong);
  background: var(--surface);
  cursor: pointer;
  font-weight: 650;
  font-size: 15px;
  line-height: 1.15;
  text-align: center;
}
.picture-option:hover {
  border-color: var(--accent);
}
.picture-option.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.sketch {
  width: 72px;
  height: 44px;
  flex: none;
}
.sub {
  font-size: 17px;
  font-weight: 650;
  margin-top: 6px;
}
.chosen {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.chosen-thumb {
  flex: none;
  width: 96px;
  height: 54px;
  border-radius: 6px;
  overflow: hidden;
}
.chosen-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chosen-text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chosen-text span {
  color: var(--text-muted);
  font-size: 15px;
}
.start-strip {
  position: relative;
  flex: none;
  height: 60px;
  margin: 0 12px;
}
.start-thumbs {
  position: absolute;
  inset: 4px 0;
  display: flex;
  border-radius: 8px;
  overflow: hidden;
  background: #1f252c;
}
.start-cell {
  flex: 1;
  min-width: 0;
  border-right: 1px solid rgb(0 0 0 / 0.35);
}
.start-range {
  position: absolute;
  inset: 0 -12px;
  width: calc(100% + 24px);
  height: 60px;
  margin: 0;
  background: transparent;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}
.start-range::-webkit-slider-runnable-track {
  height: 60px;
  background: transparent;
}
.start-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 24px;
  height: 60px;
  border-radius: 8px;
  background: #fff;
  border: 3px solid var(--accent);
  box-shadow: 0 1px 6px rgb(0 0 0 / 0.45);
}
.start-range:focus-visible {
  outline: 3px solid var(--accent-ring);
  border-radius: 8px;
}
.start-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.start-text {
  flex: 1;
  text-align: center;
  font-size: 15px;
  color: var(--text-muted);
}
.start-text strong {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.small-step {
  padding: 0 10px;
  gap: 4px;
  font-size: 15px;
}
.switch {
  justify-content: flex-start;
  gap: 10px;
  margin-top: 6px;
}
.switch-label {
  flex: 1;
  text-align: left;
}
.knob-track {
  position: relative;
  width: 46px;
  height: 26px;
  border-radius: 13px;
  background: var(--border-strong);
  transition: background 0.15s;
}
.switch-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
.switch.on {
  border-color: var(--accent);
  color: var(--accent-hover);
}
.switch.on .knob-track {
  background: var(--accent);
}
.switch.on .switch-knob {
  transform: translateX(20px);
}
.corners {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.corner-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 6px 10px;
  border-radius: 12px;
  border: 1.5px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  line-height: 1.15;
}
.corner-btn svg {
  flex: none;
  width: 48px;
  height: 30px;
}
.corner-btn span {
  color: var(--text);
}
.corner-btn.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
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
