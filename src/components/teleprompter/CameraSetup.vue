<script setup lang="ts">
// «Preparar la cámara»: cómo te ves (espejado solo en pantalla), qué cámara y qué micrófono, y si se
// te oye bien. Si algo falla, qué pasa y cómo arreglarlo. Encender y apagar la cámara es de la pantalla.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  describeMicLevel,
  meterFraction,
  micLevel,
  trimSamples,
  type CameraProblem,
  type LevelSample,
  type MicLevel,
  type RecordingKind,
} from '../../domain'
import { startLevelMeter, type DeviceOption } from '../../lib/camera'
import AppIcon from '../AppIcon.vue'

const props = defineProps<{
  kind: RecordingKind
  stream: MediaStream | null
  problem: CameraProblem | null
  busy: boolean
  cameras: DeviceOption[]
  mics: DeviceOption[]
  cameraId: string | null
  micId: string | null
}>()

const emit = defineEmits<{ camera: [id: string]; mic: [id: string]; retry: []; kind: [kind: RecordingKind] }>()

const kinds: { id: RecordingKind; icon: 'camera' | 'mic'; label: string; hint: string }[] = [
  { id: 'video', icon: 'camera', label: 'Grabarme en vídeo', hint: 'Con la cámara y el micrófono' },
  { id: 'audio', icon: 'mic', label: 'Grabar solo la voz', hint: 'Solo el micrófono; la cámara no se enciende' },
]

const video = ref<HTMLVideoElement | null>(null)
const peak = ref(0)
const level = ref<MicLevel>('waiting')
const size = ref<{ w: number; h: number } | null>(null)

let samples: LevelSample[] = []
let listeningSince = 0
let stopMeter: (() => void) | null = null

function onPeak(p: number) {
  const now = performance.now()
  samples = trimSamples([...samples, { timeMs: now, peak: p }], now)
  // La barra baja despacio (como los medidores de verdad) para que se pueda leer.
  peak.value = Math.max(p, peak.value * 0.85)
  level.value = micLevel(samples, now, listeningSince)
}

watch(
  [() => props.stream, video],
  ([stream]) => {
    stopMeter?.()
    stopMeter = null
    samples = []
    peak.value = 0
    level.value = 'waiting'
    size.value = null
    if (video.value) video.value.srcObject = stream ?? null
    if (stream) {
      listeningSince = performance.now()
      stopMeter = startLevelMeter(stream, onPeak)
      const s = stream.getVideoTracks()[0]?.getSettings()
      if (s?.width && s.height) size.value = { w: s.width, h: s.height }
    }
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  stopMeter?.()
  if (video.value) video.value.srcObject = null
})

const levelText = computed(() => describeMicLevel(level.value))
const quality = computed(() => {
  const s = size.value
  if (!s) return null
  const short = Math.min(s.w, s.h)
  if (short >= 1080) return 'Imagen de muy buena calidad'
  if (short >= 720) return 'Imagen de buena calidad'
  return 'Tu cámara da una imagen pequeña: se verá algo borrosa'
})
</script>

<template>
  <div class="camera-setup" data-testid="camera-setup">
    <section class="view">
      <div class="frame">
        <video v-show="stream && kind === 'video'" ref="video" class="mirror" autoplay muted playsinline data-testid="camera-preview" />
        <div v-if="!stream && busy" class="placeholder">
          <span class="spinner" />
          {{ kind === 'audio' ? 'Encendiendo el micrófono…' : 'Encendiendo la cámara…' }}
        </div>
        <div v-else-if="!stream && problem" class="placeholder problem" data-testid="camera-problem">
          <AppIcon name="warning" :size="40" />
          <h2>{{ problem.title }}</h2>
          <p>{{ problem.fix }}</p>
          <div class="problem-actions">
            <button class="btn primary large" type="button" data-testid="camera-retry" @click="emit('retry')">
              <AppIcon name="reset" />
              Probar otra vez
            </button>
            <button
              v-if="kind === 'video' && problem.voiceOnlyMayHelp"
              class="btn large on-dark"
              type="button"
              data-testid="switch-to-voice"
              @click="emit('kind', 'audio')"
            >
              <AppIcon name="mic" />
              Grabar solo la voz
            </button>
          </div>
        </div>
        <div v-else-if="stream && kind === 'audio'" class="placeholder voice" data-testid="voice-only">
          <span class="voice-icon"><AppIcon name="mic" :size="56" /></span>
          <h2>Solo se grabará tu voz</h2>
          <p>La cámara no se enciende. El texto pasará igual por la pantalla.</p>
        </div>
      </div>
      <p v-if="stream && kind === 'video'" class="mirror-note muted">
        <AppIcon name="eye" :size="20" />
        Aquí te ves como en un espejo. En la grabación saldrás al derecho.
        <span v-if="quality"> · {{ quality }}</span>
      </p>
    </section>

    <aside class="side">
      <div class="kinds" role="radiogroup" aria-label="Qué grabar">
        <button
          v-for="k in kinds"
          :key="k.id"
          class="kind"
          :class="{ selected: kind === k.id }"
          type="button"
          role="radio"
          :aria-checked="kind === k.id"
          :disabled="busy"
          :data-testid="`kind-${k.id}`"
          @click="kind !== k.id && emit('kind', k.id)"
        >
          <AppIcon :name="k.icon" :size="30" />
          <span class="kind-text">
            <strong>{{ k.label }}</strong>
            <span>{{ k.hint }}</span>
          </span>
        </button>
      </div>

      <section class="panel" :class="{ dim: !stream }">
        <h2><AppIcon name="mic" :size="22" /> ¿Se te oye bien?</h2>
        <div class="meter" role="meter" :aria-valuenow="Math.round(meterFraction(peak) * 100)" aria-valuemin="0" aria-valuemax="100" aria-label="Volumen del micrófono">
          <span class="fill" :class="level" :style="{ width: `${Math.round(meterFraction(peak) * 100)}%` }" />
        </div>
        <p class="level" :class="level" data-testid="mic-level">{{ stream ? levelText : 'El micrófono está apagado' }}</p>
      </section>

      <section v-if="kind === 'video' && cameras.length > 1" class="panel">
        <h2><AppIcon name="camera" :size="22" /> Cámara</h2>
        <div class="choices" role="radiogroup" aria-label="Cámara">
          <button
            v-for="c in cameras"
            :key="c.id"
            class="btn choice"
            :class="{ selected: c.id === cameraId }"
            type="button"
            role="radio"
            :aria-checked="c.id === cameraId"
            :disabled="busy"
            data-testid="camera-choice"
            @click="emit('camera', c.id)"
          >
            {{ c.label }}
          </button>
        </div>
      </section>

      <section v-if="mics.length > 1" class="panel">
        <h2><AppIcon name="mic" :size="22" /> Micrófono</h2>
        <div class="choices" role="radiogroup" aria-label="Micrófono">
          <button
            v-for="m in mics"
            :key="m.id"
            class="btn choice"
            :class="{ selected: m.id === micId }"
            type="button"
            role="radio"
            :aria-checked="m.id === micId"
            :disabled="busy"
            data-testid="mic-choice"
            @click="emit('mic', m.id)"
          >
            {{ m.label }}
          </button>
        </div>
      </section>

      <p v-if="kind === 'video'" class="tip muted">
        <AppIcon name="camera" :size="20" />
        Mira a la cámara, no a la pantalla: el texto pasará por arriba, justo debajo de ella.
      </p>
    </aside>
  </div>
</template>

<style scoped>
.camera-setup {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  padding: 16px 20px;
}
.view {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.frame {
  position: relative;
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
}
.mirror {
  transform: scaleX(-1);
}
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: #e9e6df;
  font-size: 19px;
  text-align: center;
  padding: 24px;
  max-width: 620px;
}
.placeholder.problem > .app-icon {
  color: #ffc861;
}
.placeholder h2 {
  font-size: 26px;
}
.placeholder p {
  color: #cfccc4;
}
.problem-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
.btn.on-dark {
  background: #232830;
  border-color: #59626e;
  color: #f6f4ee;
}
.btn.on-dark:hover:not(:disabled) {
  background: #2d333d;
  border-color: #8a93a0;
}
.voice-icon {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 0.08);
  color: #9fd0f0;
}
.kinds {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kind {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 72px;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  border: 1.5px solid var(--border-strong);
  background: var(--surface);
  cursor: pointer;
  text-align: left;
  color: var(--text-muted);
}
.kind:hover:not(:disabled) {
  border-color: var(--text-muted);
}
.kind:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.kind.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.kind-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.kind-text strong {
  color: var(--text);
  font-size: 18px;
}
.kind.selected .kind-text strong {
  color: var(--accent-hover);
}
.kind-text span {
  font-size: 15px;
}
.mirror-note {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
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
.panel.dim {
  opacity: 0.6;
}
.panel h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 650;
}
.meter {
  height: 22px;
  border-radius: 11px;
  background: var(--surface-sunken);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  border-radius: 11px;
  background: var(--good);
  transition: width 0.05s linear;
}
.fill.low,
.fill.waiting {
  background: #d79a2b;
}
.fill.silent {
  background: var(--bad);
}
.level {
  font-weight: 650;
  font-size: 17px;
}
.level.good {
  color: var(--good);
}
.level.low {
  color: var(--warn);
}
.level.silent {
  color: var(--bad);
}
.level.waiting {
  color: var(--text-muted);
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.choice {
  justify-content: flex-start;
  white-space: normal;
  text-align: left;
  line-height: 1.2;
  padding: 8px 14px;
}
.tip {
  display: flex;
  gap: 10px;
  font-size: 15px;
  padding: 0 6px;
}
@media (max-width: 1250px) {
  .camera-setup {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}
</style>
