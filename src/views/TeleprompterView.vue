<script setup lang="ts">
// «Grabarme leyendo un texto»: escribir o pegar el texto (con cuánto dura y a qué ritmo hay que leerlo),
// ensayar, preparar la cámara, grabar con el texto pasando por arriba, revisar y usar la grabación como
// trozo del vídeo. La cámara y el micrófono se apagan siempre al salir de aquí, también si algo falla.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import CameraSetup from '../components/teleprompter/CameraSetup.vue'
import PrompterRun from '../components/teleprompter/PrompterRun.vue'
import TargetPicker from '../components/TargetPicker.vue'
import {
  adviseFit,
  clampWpm,
  describeScriptLength,
  fitIsReasonable,
  fitWpm,
  formatClock,
  formatDuration,
  PACE_STEP_WPM,
  PACE_WPM,
  pacePhrase,
  parseScript,
  presetWpm,
  recordingName,
  type CameraProblem,
  type PacePreset,
  type RecordingKind,
} from '../domain'
import type { SavedRecording } from '../native/bridge'
import { listDevices, openCamera, stopStream, trackDeviceId, type DeviceOption } from '../lib/camera'
import { askConfirm } from '../lib/confirm'
import { createRecorder, type Recorder } from '../lib/recorder'
import { FONT_SIZES, loadSettings, saveSettings } from '../lib/teleprompter-settings'
import { store } from '../store'

type Step = 'script' | 'rehearse' | 'camera' | 'record' | 'review' | 'saving'
const step = ref<Step>('script')

// ------------------------------------------------------------------ texto y ajustes (se recuerdan)

const settings = ref(loadSettings())
const projectTarget = store.project.value.targetDurationMs
const targetMs = ref<number | null>(projectTarget ?? settings.value.targetMs ?? null)

let saveTimer = 0
watch(
  [settings, targetMs],
  () => {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => saveSettings({ ...settings.value, targetMs: targetMs.value }), 300)
  },
  { deep: true },
)

const script = computed(() => parseScript(settings.value.text))
const hasText = computed(() => script.value.words > 0)
const fit = computed(() => (targetMs.value && hasText.value ? adviseFit(script.value, targetMs.value) : null))
const fitRate = computed(() => (targetMs.value ? fitWpm(script.value, targetMs.value) : 0))
const fitAvailable = computed(() => !!targetMs.value && hasText.value && fitIsReasonable(fitRate.value))
const baseWpm = computed(() => presetWpm(settings.value.preset === 'fit' && !fitAvailable.value ? 'normal' : settings.value.preset, script.value, targetMs.value))
const wpm = computed(() => clampWpm(baseWpm.value + settings.value.tweak * PACE_STEP_WPM))
const lengthText = computed(() => describeScriptLength(script.value, wpm.value, pacePhrase(settings.value.preset === 'fit' && !fitAvailable.value ? 'normal' : settings.value.preset, settings.value.tweak)))

const presets: { id: PacePreset; label: string }[] = [
  { id: 'slow', label: 'Despacio' },
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Rápido' },
]

function choosePreset(p: PacePreset) {
  settings.value.preset = p
  settings.value.tweak = 0
}

const fitHint = computed(() => {
  if (!targetMs.value) return 'Elige antes una duración máxima'
  if (!hasText.value) return 'Escribe antes el texto'
  if (!fitAvailable.value) return fitRate.value < PACE_WPM.slow ? 'Saldría demasiado despacio' : 'Saldría demasiado rápido'
  return 'El que hace falta para que quepa justo'
})

function tweak(delta: number) {
  const next = Math.max(-8, Math.min(8, settings.value.tweak + delta))
  settings.value.tweak = next
}

const fontIndex = computed(() => Math.max(0, FONT_SIZES.indexOf(settings.value.fontSize as (typeof FONT_SIZES)[number])))
function changeFont(delta: number) {
  const i = Math.min(FONT_SIZES.length - 1, Math.max(0, fontIndex.value + delta))
  settings.value.fontSize = FONT_SIZES[i]!
}

const lastRehearsalMs = ref<number | null>(null)

// ------------------------------------------------------------------ cámara

const stream = shallowRef<MediaStream | null>(null)
const problem = shallowRef<CameraProblem | null>(null)
const cameraBusy = ref(false)
const cameras = ref<DeviceOption[]>([])
const mics = ref<DeviceOption[]>([])
let cameraRequest = 0

function releaseCamera() {
  cameraRequest += 1
  stopStream(stream.value)
  stream.value = null
}

async function startCamera() {
  releaseCamera()
  const request = cameraRequest
  cameraBusy.value = true
  problem.value = null
  const res = await openCamera(settings.value.cameraId, settings.value.micId, kind.value)
  // Si mientras tanto se ha salido de la pantalla o se ha pedido otra, esta no se usa.
  if (request !== cameraRequest || (step.value !== 'camera' && step.value !== 'record')) {
    stopStream(res.stream)
    return
  }
  cameraBusy.value = false
  if (!res.stream) {
    problem.value = res.problem
    console.warn('[easy-cut] no se ha podido encender la cámara:', res.details)
    return
  }
  stream.value = res.stream
  try {
    const list = await listDevices()
    cameras.value = list.cameras
    mics.value = list.mics
  } catch {
    cameras.value = []
    mics.value = []
  }
  // Con solo la voz no hay pista de cámara: se recuerda la cámara que se eligió la última vez.
  if (kind.value === 'video') settings.value.cameraId = trackDeviceId(res.stream, 'video', cameras.value)
  settings.value.micId = trackDeviceId(res.stream, 'audio', mics.value)
}

/** «Grabarme en vídeo» / «Grabar solo la voz» (se recuerda para la próxima vez). */
const kind = computed(() => settings.value.kind)
function chooseKind(k: RecordingKind) {
  settings.value.kind = k
  void startCamera()
}

function chooseCamera(id: string) {
  settings.value.cameraId = id
  void startCamera()
}
function chooseMic(id: string) {
  settings.value.micId = id
  void startCamera()
}

function goCamera() {
  step.value = 'camera'
  void startCamera()
}

// ------------------------------------------------------------------ grabar

const recorder = shallowRef<Recorder | null>(null)
const recordedMs = ref(0)
const reviewUrl = ref<string | null>(null)
const starting = ref(false)
const run = ref<InstanceType<typeof PrompterRun> | null>(null)

async function startRecording() {
  const s = stream.value
  if (!s || starting.value) return
  starting.value = true
  try {
    recorder.value = await createRecorder(store.bridge, s, recordingName(new Date()), kind.value, onRecorderError)
    step.value = 'record'
  } catch (e) {
    store.showError('No he podido empezar a grabar.', e)
  } finally {
    starting.value = false
  }
}

function onRecorderError(e: unknown) {
  store.showError('Ha fallado la grabación. Lo grabado no se ha podido guardar.', e)
  void discardRecording().then(() => {
    if (step.value === 'record' || step.value === 'review') goCamera()
  })
}

async function discardRecording() {
  const r = recorder.value
  recorder.value = null
  reviewUrl.value = null
  if (r) await r.discard().catch((err) => console.warn('[easy-cut] no se ha podido borrar la grabación', err))
}

async function finishRecording(elapsedMs: number) {
  const r = recorder.value
  if (!r) return
  recordedMs.value = elapsedMs
  try {
    await r.stop()
  } catch (e) {
    onRecorderError(e)
    return
  }
  // Para revisar ya no hace falta la cámara: se apaga.
  releaseCamera()
  if (r.kind === 'audio') {
    // Solo la voz: se guarda ya como M4A (no entra en el montaje) y se revisa el fichero final.
    savingLabel.value = 'Guardando tu voz…'
    const res = await saveIt()
    if (!res) return
    voiceRecording.value = res
    reviewUrl.value = store.bridge.mediaUrl(res.path)
    step.value = 'review'
    return
  }
  voiceRecording.value = null
  reviewUrl.value = store.bridge.mediaUrl(r.writer.tempPath)
  step.value = 'review'
}

// ------------------------------------------------------------------ solo la voz (ya guardada)

/**
 * Grabación de solo la voz ya guardada en Grabaciones (M4A). «Usar esta grabación» la añade al montaje
 * como un trozo sin imagen («Solo se oye»), con la misma oferta de quitarle las pausas que la de vídeo.
 */
const voiceRecording = shallowRef<SavedRecording | null>(null)

async function useVoiceRecording() {
  const v = voiceRecording.value
  if (!v) return
  const placement = await askPlacement()
  if (placement === null) return
  unloadReview()
  voiceRecording.value = null
  if (placement.resume) await store.resumeAutosave()
  const ok = await store.addRecording(v.path, { targetMs: targetMs.value, fresh: placement.fresh && !placement.resume })
  if (!ok) {
    store.showError('He guardado tu voz, pero no la puedo leer para añadirla al vídeo.', store.preparing.value[0]?.details ?? v.path)
    store.go(store.project.value.clips.length > 0 ? 'editor' : 'home')
    return
  }
  store.go('editor')
}

async function retakeVoice() {
  const v = voiceRecording.value
  if (!v) return
  const ok = await askConfirm({
    title: '¿Borrar esta grabación y repetirla?',
    message: 'Tu voz grabada se borrará. El texto se queda como está.',
    confirmLabel: 'Sí, repetirla',
    cancelLabel: 'No, volver',
    danger: true,
  })
  if (!ok) return
  unloadReview()
  try {
    await store.bridge.deleteRecording(v.path)
  } catch (e) {
    store.showError('No he podido borrar la grabación anterior.', e)
  }
  voiceRecording.value = null
  goCamera()
}

function leaveVoiceReview() {
  const v = voiceRecording.value
  unloadReview()
  voiceRecording.value = null
  step.value = 'script'
  if (v) {
    store.showToast(`Tu voz está guardada en Vídeos › Mis montajes › Grabaciones (dura ${formatDuration(v.durationMs)}).`, {
      label: 'Abrir la carpeta',
      run: () => void store.bridge.revealInFolder(v.path).catch(() => {}),
    })
  }
}

async function leaveRecording() {
  // En la cuenta atrás aún no se ha grabado nada: se sale sin preguntar.
  if (run.value?.phase !== 'countdown') {
    // Mientras se pregunta, ni el texto ni la grabación siguen (se sigue luego con «Seguir»).
    if (run.value?.phase === 'running') run.value.togglePause()
    const ok = await askConfirm({
      title: '¿Dejar de grabar?',
      message: 'Lo que llevas grabado se borrará.',
      confirmLabel: 'Sí, dejar de grabar',
      cancelLabel: 'No, seguir aquí',
      danger: true,
    })
    if (!ok) return
  }
  await discardRecording()
  goCamera()
}

// ------------------------------------------------------------------ revisar

const reviewVideo = ref<HTMLMediaElement | null>(null)
const reviewPlaying = ref(false)
const reviewTime = ref(0)

function toggleReview() {
  const v = reviewVideo.value
  if (!v) return
  if (v.paused) void v.play()
  else v.pause()
}
function restartReview() {
  const v = reviewVideo.value
  if (!v) return
  v.currentTime = 0
  void v.play()
}

/** Suelta el fichero del <video> de revisión (si no, Windows no deja borrarlo ni moverlo). */
function unloadReview() {
  const v = reviewVideo.value
  if (v) {
    v.pause()
    v.removeAttribute('src')
    v.load()
  }
  reviewUrl.value = null
}

async function retake() {
  const ok = await askConfirm({
    title: '¿Borrar esta grabación y repetirla?',
    message: 'La grabación se borrará. El texto se queda como está.',
    confirmLabel: 'Sí, repetirla',
    cancelLabel: 'No, volver',
    danger: true,
  })
  if (!ok) return
  unloadReview()
  await discardRecording()
  goCamera()
}

const savingProgress = ref(0)
const savingLabel = ref('Preparando la grabación…')
let saved = false

async function saveIt(): Promise<SavedRecording | null> {
  const r = recorder.value
  if (!r) return null
  unloadReview()
  step.value = 'saving'
  savingProgress.value = 0
  try {
    const res = await r.writer.save((u) => (savingProgress.value = u.fraction), recordedMs.value)
    saved = true
    recorder.value = null
    return res
  } catch (e) {
    recorder.value = null
    store.showError('No he podido preparar la grabación.', e)
    step.value = 'script'
    return null
  }
}

/**
 * Sin vídeo abierto pero con uno a medias: ¿la grabación va a ese o a uno nuevo?
 * (fresh = empezar uno nuevo; resume = seguir con el que estaba a medias).
 */
async function askPlacement(): Promise<{ fresh: boolean; resume: boolean } | null> {
  let fresh = store.project.value.clips.length === 0
  let resume = false
  if (fresh && store.autosave.value) {
    const startNew = await askConfirm({
      title: '¿Dónde pongo la grabación?',
      message: 'Tienes un vídeo sin terminar. Puedo añadirla al final de ese vídeo o empezar uno nuevo con ella.',
      confirmLabel: 'Empezar un vídeo nuevo con ella',
      cancelLabel: 'Añadirla al vídeo sin terminar',
    })
    resume = !startNew
    fresh = startNew
  }
  return { fresh, resume }
}

async function useRecording() {
  const placement = await askPlacement()
  if (placement === null) return
  let fresh = placement.fresh
  savingLabel.value = 'Preparando la grabación…'
  const res = await saveIt()
  if (!res) return
  if (placement.resume) {
    await store.resumeAutosave()
    fresh = false
  }
  const ok = await store.addRecording(res.path, { targetMs: targetMs.value, fresh })
  if (!ok) {
    store.showError('He guardado la grabación, pero no la puedo leer para añadirla al vídeo.', store.preparing.value[0]?.details ?? res.path)
    store.go(store.project.value.clips.length > 0 ? 'editor' : 'home')
    return
  }
  store.go('editor')
}

async function keepRecording() {
  savingLabel.value = 'Guardando la grabación…'
  const res = await saveIt()
  if (!res) return
  step.value = 'script'
  store.showToast(`Grabación guardada en Vídeos › Mis montajes › Grabaciones (dura ${formatDuration(res.durationMs)}).`, {
    label: 'Mostrar en la carpeta',
    run: () => void store.bridge.revealInFolder(res.path).catch(() => {}),
  })
}

// ------------------------------------------------------------------ salir

const title = computed(() => {
  if (step.value === 'script') return 'Grabarme leyendo un texto'
  if (step.value === 'camera') return kind.value === 'audio' ? 'Prepara el micrófono' : 'Prepara la cámara'
  return voiceRecording.value ? 'Escucha cómo ha quedado' : 'Mira cómo ha quedado'
})

const backTarget = computed(() => (store.previousScreen.value === 'editor' || store.previousScreen.value === 'clip' ? 'editor' : 'home'))

async function goBack() {
  if (step.value === 'review' && voiceRecording.value) {
    leaveVoiceReview()
    return
  }
  if (step.value === 'review') {
    const ok = await askConfirm({
      title: '¿Salir sin usar la grabación?',
      message: 'La grabación se borrará. El texto se guarda para la próxima vez.',
      confirmLabel: 'Salir y borrarla',
      cancelLabel: 'No, volver',
      danger: true,
    })
    if (!ok) return
    unloadReview()
    await discardRecording()
  }
  if (step.value === 'camera' || step.value === 'review') {
    releaseCamera()
    step.value = 'script'
    return
  }
  store.go(backTarget.value)
}

onMounted(() => {
  // Si se viene de «Tu vídeo» con una duración máxima, esa manda.
  if (projectTarget !== null) targetMs.value = projectTarget
})

onBeforeUnmount(() => {
  window.clearTimeout(saveTimer)
  saveSettings({ ...settings.value, targetMs: targetMs.value })
  releaseCamera()
  if (!saved && recorder.value) void discardRecording()
  unloadReview()
})
</script>

<template>
  <main class="screen teleprompter" data-testid="teleprompter-view" :data-step="step">
    <header v-if="step === 'script' || step === 'camera' || step === 'review'" class="topbar">
      <button class="btn quiet" type="button" data-testid="back-home" @click="goBack">
        <AppIcon name="back" />
        {{ step === 'script' ? 'Volver' : step === 'camera' ? 'Volver al texto' : voiceRecording ? 'Volver' : 'Salir' }}
      </button>
      <h1>{{ title }}</h1>
      <span class="spacer" />
      <template v-if="step === 'script'">
        <button class="btn" type="button" data-testid="rehearse" :disabled="!hasText" @click="step = 'rehearse'">
          <AppIcon name="play" />
          Ensayar
        </button>
        <button class="btn primary large" type="button" data-testid="go-camera" :disabled="!hasText" @click="goCamera">
          <AppIcon :name="kind === 'audio' ? 'mic' : 'camera'" />
          {{ kind === 'audio' ? 'Preparar el micrófono' : 'Preparar la cámara' }}
        </button>
      </template>
      <button v-else-if="step === 'camera'" class="btn primary large rec" type="button" data-testid="start-recording" :disabled="!stream || starting" @click="startRecording">
        <AppIcon name="record" />
        Empezar a grabar
      </button>
    </header>

    <!-- 1. El texto -->
    <div v-if="step === 'script'" class="script-step">
      <section class="editor-area">
        <textarea
          v-model="settings.text"
          class="script-input"
          data-testid="script-input"
          placeholder="Escribe o pega aquí lo que vas a decir"
          spellcheck="true"
          lang="es"
          aria-label="Lo que vas a decir"
        />
        <p class="hint muted">Deja una línea en blanco entre párrafos: ahí el texto hará una pausa corta.</p>
      </section>

      <aside class="side">
        <section class="panel facts">
          <p class="length" data-testid="script-length">{{ lengthText }}</p>
          <p v-if="lastRehearsalMs !== null" class="muted rehearsal" data-testid="last-rehearsal">
            Último ensayo: {{ formatDuration(lastRehearsalMs) }}
          </p>
        </section>

        <section class="panel">
          <h2>Duración máxima</h2>
          <TargetPicker v-model="targetMs" class="target" />
          <div v-if="fit" class="advice" :class="fit.kind" data-testid="fit-advice">
            <AppIcon :name="fit.kind === 'too-long' ? 'warning' : fit.kind === 'hurried' ? 'speed' : 'check'" />
            <div>
              <strong data-testid="fit-title">{{ fit.title }}</strong>
              <span v-if="fit.hint" data-testid="fit-hint">{{ fit.hint }}</span>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>Ritmo</h2>
          <div class="presets" role="radiogroup" aria-label="Ritmo">
            <button
              v-for="p in presets"
              :key="p.id"
              class="btn"
              :class="{ selected: settings.preset === p.id }"
              type="button"
              role="radio"
              :aria-checked="settings.preset === p.id"
              :data-testid="`pace-${p.id}`"
              @click="choosePreset(p.id)"
            >
              {{ p.label }}
            </button>
          </div>
          <button
            class="btn fit"
            :class="{ selected: settings.preset === 'fit' && fitAvailable }"
            type="button"
            role="radio"
            :aria-checked="settings.preset === 'fit'"
            :disabled="!fitAvailable"
            data-testid="pace-fit"
            @click="choosePreset('fit')"
          >
            <AppIcon name="clock" />
            <span class="fit-text">
              <strong>Ajustado al tiempo</strong>
              <span>{{ fitHint }}</span>
            </span>
          </button>
          <div class="pair">
            <button class="btn small" type="button" data-testid="pace-slower" :disabled="wpm <= 80" @click="tweak(-1)">
              <AppIcon name="slower" :size="20" />
              Un poco más lento
            </button>
            <button class="btn small" type="button" data-testid="pace-faster" :disabled="wpm >= 220" @click="tweak(1)">
              <AppIcon name="faster" :size="20" />
              Un poco más rápido
            </button>
          </div>
          <p class="muted small-note" data-testid="pace-wpm">{{ wpm }} palabras por minuto</p>
        </section>

        <section class="panel">
          <h2>Tamaño de la letra</h2>
          <div class="pair">
            <button class="btn small" type="button" data-testid="font-smaller" :disabled="fontIndex === 0" @click="changeFont(-1)">
              <AppIcon name="text-smaller" :size="20" />
              Letra más pequeña
            </button>
            <button class="btn small" type="button" data-testid="font-larger" :disabled="fontIndex === FONT_SIZES.length - 1" @click="changeFont(1)">
              <AppIcon name="text-larger" :size="20" />
              Letra más grande
            </button>
          </div>
          <p class="font-sample" :style="{ fontSize: `${Math.round(settings.fontSize * 0.45)}px` }">Así se verá la letra</p>
        </section>
      </aside>
    </div>

    <!-- 2. La cámara -->
    <CameraSetup
      v-else-if="step === 'camera'"
      :kind="kind"
      :stream="stream"
      :problem="problem"
      :busy="cameraBusy"
      :cameras="cameras"
      :mics="mics"
      :camera-id="settings.cameraId"
      :mic-id="settings.micId"
      @camera="chooseCamera"
      @mic="chooseMic"
      @retry="startCamera"
      @kind="chooseKind"
    />

    <!-- Ensayar y grabar: pantalla limpia -->
    <PrompterRun
      v-else-if="step === 'rehearse'"
      mode="rehearse"
      :script="script"
      :wpm="wpm"
      :font-size="settings.fontSize"
      :target-ms="targetMs"
      @finish="(ms) => ((lastRehearsalMs = ms), (step = 'script'))"
      @leave="step = 'script'"
    />
    <PrompterRun
      v-else-if="step === 'record'"
      ref="run"
      mode="record"
      :script="script"
      :wpm="wpm"
      :font-size="settings.fontSize"
      :target-ms="targetMs"
      :stream="kind === 'video' ? stream : null"
      :show-camera="settings.showCamera"
      @begin="recorder?.start()"
      @pause="recorder?.pause()"
      @resume="recorder?.resume()"
      @finish="finishRecording"
      @leave="leaveRecording"
      @toggle-camera="settings.showCamera = !settings.showCamera"
    />

    <!-- 4. Revisar -->
    <div v-else-if="step === 'review'" class="review-step">
      <section class="review-view">
        <div class="frame">
          <div v-if="voiceRecording" class="voice-review" data-testid="voice-review" @click="toggleReview">
            <span class="voice-icon" :class="{ playing: reviewPlaying }"><AppIcon name="sound" :size="64" /></span>
            <p>Solo tu voz, sin imagen</p>
            <audio
              v-if="reviewUrl"
              ref="reviewVideo"
              :src="reviewUrl"
              data-testid="review-audio"
              @play="reviewPlaying = true"
              @pause="reviewPlaying = false"
              @ended="reviewPlaying = false"
              @timeupdate="reviewTime = Math.round(($event.target as HTMLMediaElement).currentTime * 1000)"
            />
          </div>
          <video
            v-else-if="reviewUrl"
            ref="reviewVideo"
            :src="reviewUrl"
            playsinline
            data-testid="review-video"
            @play="reviewPlaying = true"
            @pause="reviewPlaying = false"
            @ended="reviewPlaying = false"
            @timeupdate="reviewTime = Math.round(($event.target as HTMLVideoElement).currentTime * 1000)"
            @click="toggleReview"
          />
        </div>
        <div class="review-controls">
          <button class="btn" type="button" data-testid="review-play" @click="toggleReview">
            <AppIcon :name="reviewPlaying ? 'pause' : 'play'" />
            {{ reviewPlaying ? 'Pausa' : voiceRecording ? 'Escuchar la grabación' : 'Ver la grabación' }}
          </button>
          <button class="btn quiet" type="button" @click="restartReview">
            <AppIcon name="reset" />
            Desde el principio
          </button>
          <span class="review-time" data-testid="review-time">{{ formatClock(reviewTime) }} / {{ formatClock(recordedMs) }}</span>
        </div>
      </section>
      <aside v-if="voiceRecording" class="side review-side">
        <p class="recorded" data-testid="recorded-length">Has grabado <strong>{{ formatDuration(voiceRecording.durationMs) }}</strong> de voz</p>
        <p class="muted saved-note" data-testid="voice-saved">Está guardada en Vídeos › Mis montajes › Grabaciones. Si la usas, entra en tu vídeo como un trozo que solo se oye.</p>
        <button class="btn primary large" type="button" data-testid="use-recording" @click="useVoiceRecording">
          <AppIcon name="check" />
          Usar esta grabación
        </button>
        <button class="btn large" type="button" data-testid="retake" @click="retakeVoice">
          <AppIcon name="reset" />
          Repetir
        </button>
        <button class="btn quiet" type="button" data-testid="keep-recording" @click="leaveVoiceReview">
          <AppIcon name="save" />
          Guardarla sin usarla
        </button>
      </aside>
      <aside v-else class="side review-side">
        <p class="recorded" data-testid="recorded-length">Has grabado <strong>{{ formatDuration(recordedMs) }}</strong></p>
        <button class="btn primary large" type="button" data-testid="use-recording" @click="useRecording">
          <AppIcon name="check" />
          Usar esta grabación
        </button>
        <button class="btn large" type="button" data-testid="retake" @click="retake">
          <AppIcon name="reset" />
          Repetir
        </button>
        <button class="btn quiet" type="button" data-testid="keep-recording" @click="keepRecording">
          <AppIcon name="save" />
          Guardarla sin usarla
        </button>
      </aside>
    </div>

    <!-- Preparando -->
    <div v-else-if="step === 'saving'" class="saving-step" data-testid="recording-saving">
      <div class="card saving-card">
        <span class="spinner big" />
        <h2>{{ savingLabel }}</h2>
        <div class="bar"><span :style="{ width: `${Math.round(savingProgress * 100)}%` }" /></div>
        <p class="muted" data-testid="recording-saving-percent">{{ Math.round(savingProgress * 100) }} %</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.rec :deep(.app-icon) {
  color: #ff8a80;
}
.script-step,
.review-step {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  gap: 16px;
  padding: 16px 20px;
}
.editor-area {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.script-input {
  flex: 1;
  min-height: 0;
  resize: none;
  padding: 20px 22px;
  border-radius: var(--radius-lg);
  border: 1.5px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 20px;
  line-height: 1.55;
  user-select: text;
}
.script-input::placeholder {
  color: var(--text-soft);
}
.script-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.hint {
  font-size: 15px;
  padding: 0 6px;
}
.side {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel h2 {
  font-size: 18px;
  font-weight: 650;
}
.length {
  font-size: 19px;
  font-weight: 650;
}
.rehearsal {
  font-size: 16px;
}
.target :deep(.btn) {
  width: 100%;
}
.target :deep(.popover) {
  left: 0;
  right: auto;
}
.advice {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--good-soft);
  color: var(--good);
}
.advice > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.advice strong {
  font-size: 17px;
  line-height: 1.3;
}
.advice span {
  color: var(--text);
  font-size: 15px;
}
.advice.hurried {
  background: var(--warn-soft);
  color: var(--warn);
}
.advice.too-long {
  background: var(--bad-soft);
  color: var(--bad);
}
.presets {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.presets .btn {
  padding: 0 8px;
}
.fit {
  justify-content: flex-start;
  min-height: 64px;
  text-align: left;
  white-space: normal;
}
.fit-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.fit-text span {
  font-weight: 400;
  font-size: 15px;
  color: var(--text-muted);
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.pair .btn {
  min-height: 48px;
  white-space: normal;
  line-height: 1.15;
  padding: 0 8px;
  gap: 6px;
}
.small-note {
  font-size: 15px;
}
.font-sample {
  font-family: var(--font-display);
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 10px;
  background: #0b0d10;
  color: #f6f4ee;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.review-view {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.frame {
  flex: 1;
  min-height: 0;
  border-radius: var(--radius-lg);
  background: var(--stage);
  overflow: hidden;
  display: grid;
  place-items: center;
}
.frame video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  cursor: pointer;
}
.voice-review {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: #e9e6df;
  font-size: 19px;
  cursor: pointer;
}
.voice-icon {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 0.08);
  color: #9fd0f0;
  transition: box-shadow 0.2s;
}
.voice-icon.playing {
  box-shadow: 0 0 0 10px rgb(159 208 240 / 0.18);
}
.saved-note {
  text-align: center;
  font-size: 16px;
}
.review-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}
.review-time {
  margin-left: auto;
  font-size: 18px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.review-side {
  justify-content: center;
  gap: 14px;
}
.recorded {
  font-size: 20px;
  text-align: center;
}
.saving-step {
  flex: 1;
  display: grid;
  place-items: center;
}
.saving-card {
  width: min(520px, calc(100% - 40px));
  padding: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: var(--accent);
}
.saving-card h2 {
  color: var(--text);
  font-size: 24px;
}
.spinner.big {
  width: 44px;
  height: 44px;
  border-width: 4px;
}
.bar {
  width: 100%;
  height: 14px;
  border-radius: 7px;
  background: var(--surface-sunken);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}
@media (max-width: 1250px) {
  .script-step,
  .review-step {
    grid-template-columns: minmax(0, 1fr) 360px;
  }
}
/* En pantallas bajas, la muestra de letra sobra: así cabe todo el panel sin desplazarse. */
@media (max-height: 860px) {
  .font-sample {
    display: none;
  }
  .side {
    gap: 10px;
  }
  .panel {
    padding: 12px 14px;
    gap: 8px;
  }
  .fit {
    min-height: 56px;
  }
}
@media (max-height: 760px) {
  .script-step,
  .review-step {
    padding: 10px 20px;
  }
  .panel {
    padding: 10px 12px;
    gap: 8px;
  }
}
</style>
