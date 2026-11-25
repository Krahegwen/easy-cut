<script setup lang="ts">
// «¿Para qué es el vídeo?»: WhatsApp, YouTube o calidad alta, con lo que pesará y lo que tardará; y, más
// discreta debajo, «Solo el sonido» (un M4A). Si ningún trozo tiene imagen, esa pasa a ser la destacada.
import { computed, onMounted } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import type { IconName } from '../components/icons'
import {
  clipShowsPicture,
  computeOutputSpec,
  describeExportTime,
  describeFileSize,
  describeTarget,
  estimateExportTimeMs,
  estimateProjectSizeBytes,
  estimateSoundSizeBytes,
  estimateSoundTimeMs,
  formatDuration,
  type PresetId,
} from '../domain'
import { useShortcuts } from '../lib/use-shortcuts'
import { saveFlow, store } from '../store'

const options: { id: PresetId; icon: IconName; title: string; text: string }[] = [
  { id: 'whatsapp', icon: 'phone', title: 'Para WhatsApp', text: 'Pequeño, para mandarlo por el móvil' },
  { id: 'youtube', icon: 'globe', title: 'Para YouTube', text: 'Para subirlo a internet con buena calidad' },
  { id: 'high', icon: 'star', title: 'Calidad alta', text: 'Para guardarlo de recuerdo o verlo en la tele' },
]

const project = computed(() => store.project.value)
const total = computed(() => store.durationMs.value)
const target = computed(() => project.value.targetDurationMs)
const over = computed(() => target.value !== null && total.value - target.value >= 500)
/** Ningún trozo enseña imagen: el vídeo saldría con fondo liso, así que se destaca «Solo el sonido». */
const soundOnly = computed(() => project.value.clips.length > 0 && !project.value.clips.some(clipShowsPicture))

function estimate(id: PresetId) {
  try {
    const spec = computeOutputSpec(project.value, store.media.value, id)
    const size = describeFileSize(estimateProjectSizeBytes(project.value, store.media.value, id))
    const time = estimateExportTimeMs(spec, total.value, saveFlow.hardware.value ?? true, saveFlow.measuredFactor())
    return { size: `Tamaño: ${size.label} · ${size.amount}`, time: describeExportTime(time) }
  } catch {
    return { size: '', time: '' }
  }
}

const soundEstimate = computed(() => {
  const size = describeFileSize(estimateSoundSizeBytes(total.value))
  return `${size.amount.charAt(0).toUpperCase()}${size.amount.slice(1)} · ${describeExportTime(estimateSoundTimeMs(total.value))}`
})

onMounted(() => void saveFlow.detectHardware())

// 1, 2, 3: las tres tarjetas en su orden; 4: «Solo el sonido».
useShortcuts({
  id: 'save',
  title: 'Guardar el vídeo',
  shortcuts: () => [
    ...options.map((o, i) => ({ id: `preset-${o.id}`, keys: [String(i + 1)], label: String(i + 1), description: `guardar «${o.title}»`, run: () => void saveFlow.start(o.id) })),
    { id: 'preset-sound', keys: ['4'], label: '4', description: 'guardar «Solo el sonido»', run: () => void saveFlow.start('sound') },
    { id: 'back', keys: ['Escape'], label: 'Esc', description: 'volver a tu vídeo', run: () => store.go('editor') },
  ],
})
</script>

<template>
  <main class="screen save" data-testid="save-view">
    <header class="topbar">
      <button class="btn quiet" type="button" data-testid="back-editor" @click="store.go('editor')">
        <AppIcon name="back" />
        Volver a tu vídeo
        <KeyHint k="Esc" />
      </button>
      <h1>Guardar el vídeo</h1>
      <span class="spacer" />
      <KeysButton />
    </header>
    <div class="body">
      <h2 class="question">¿Para qué es el vídeo?</h2>
      <p class="summary" data-testid="save-summary">
        <AppIcon name="clock" />
        Tu vídeo dura <strong>{{ formatDuration(total) }}</strong>
        <template v-if="target !== null && !over">
          <span class="ok">· {{ describeTarget(total, target) }}</span>
        </template>
      </p>
      <div v-if="over && target !== null" class="warning" data-testid="save-over-warning">
        <AppIcon name="warning" :size="26" />
        <div>
          <strong>{{ describeTarget(total, target) }}</strong> respecto al máximo de {{ formatDuration(target) }}.
          <span>Puedes guardarlo igualmente, o volver y acortarlo.</span>
        </div>
      </div>
      <div v-if="soundOnly" class="info" data-testid="save-sound-only-hint">
        <AppIcon name="wave" :size="26" />
        <div>
          <strong>Tu vídeo no tiene imagen: todos los trozos solo se oyen.</strong>
          <span>Si lo guardas como vídeo, saldrá con un fondo liso. Para tener solo el sonido, usa «Solo el sonido».</span>
        </div>
      </div>
      <div class="choices">
      <div class="options">
        <button
          v-for="o in options"
          :key="o.id"
          class="option card"
          :class="{ dimmed: soundOnly }"
          type="button"
          :data-testid="`preset-${o.id}`"
          @click="saveFlow.start(o.id)"
        >
          <span class="icon"><AppIcon :name="o.icon" :size="34" /></span>
          <span class="title">{{ o.title }}</span>
          <span class="text">{{ o.text }}</span>
          <span v-if="soundOnly" class="plain-note">Saldrá con fondo liso</span>
          <span class="meta">
            <span>{{ estimate(o.id).size }}</span>
            <span v-if="estimate(o.id).time" class="muted">{{ estimate(o.id).time }}</span>
          </span>
          <span class="go">
            <AppIcon name="save" />
            Guardar así
            <KeyHint :k="String(options.indexOf(o) + 1)" />
          </span>
        </button>
      </div>
      <button class="sound card" :class="{ featured: soundOnly }" type="button" data-testid="preset-sound" @click="saveFlow.start('sound')">
        <span class="sound-icon"><AppIcon name="wave" :size="28" /></span>
        <span class="sound-text">
          <strong>Solo el sonido</strong>
          <span>Un fichero de audio, sin imagen · {{ soundEstimate }}</span>
        </span>
        <span class="sound-go">
          <AppIcon name="save" />
          Guardar el sonido
          <KeyHint k="4" />
        </span>
      </button>
      </div>
      <p class="where muted">Se guarda en tu carpeta Vídeos, dentro de «Mis montajes». Tus vídeos originales no se tocan.</p>
    </div>
  </main>
</template>

<style scoped>
.body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 32px;
  gap: 16px;
}
.question {
  font-size: 32px;
}
.summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 19px;
}
.ok {
  color: var(--good);
  font-weight: 600;
}
.warning,
.info {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 14px 18px;
  border-radius: 14px;
  background: var(--bad-soft);
  color: var(--bad);
  font-size: 18px;
  max-width: 820px;
}
.info {
  background: var(--accent-soft);
  color: var(--accent-hover);
}
.warning span,
.info span {
  display: block;
  color: var(--text);
  margin-top: 2px;
}
.choices {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
}
.options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 300px));
  gap: 20px;
  margin-top: 4px;
}
.option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 22px 24px;
  text-align: left;
  cursor: pointer;
  border: 2px solid var(--border);
  transition:
    border-color 0.12s,
    transform 0.12s,
    box-shadow 0.12s;
}
.option:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring), var(--shadow);
}
.option.dimmed {
  opacity: 0.85;
}
.icon {
  width: 62px;
  height: 62px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent);
  margin-bottom: 4px;
}
.title {
  font-size: 23px;
  font-weight: 700;
  font-family: var(--font-display);
}
.text {
  color: var(--text-muted);
  font-size: 17px;
  min-height: 48px;
}
.plain-note {
  font-size: 15px;
  font-weight: 650;
  color: var(--warn);
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 16px;
  font-weight: 600;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  width: 100%;
}
.meta .muted {
  font-weight: 400;
}
.go {
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font-weight: 650;
  align-self: stretch;
  justify-content: center;
}
/* «Solo el sonido»: secundaria (una fila, más pequeña) salvo que el vídeo no tenga imagen. */
.sound {
  display: flex;
  align-items: center;
  gap: 14px;
  width: min(940px, 100%);
  padding: 10px 14px;
  border: 2px solid var(--border);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.12s,
    box-shadow 0.12s;
}
.sound:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.sound-icon {
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--surface-2);
  color: var(--accent);
}
.sound-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sound-text strong {
  font-size: 18px;
}
.sound-text span {
  color: var(--text-muted);
  font-size: 15px;
}
.sound-go {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 0 16px;
  border-radius: 12px;
  border: 1.5px solid var(--accent);
  color: var(--accent-hover);
  font-weight: 650;
  white-space: nowrap;
}
.sound.featured {
  /* Sin imagen en todo el vídeo, va la primera. */
  order: -1;
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 3px var(--accent-ring);
  padding: 16px 18px;
}
.sound.featured .sound-icon {
  background: var(--accent);
  color: #fff;
}
.sound.featured .sound-go {
  background: var(--accent);
  color: #fff;
}
.where {
  margin-top: 2px;
}
@media (max-height: 760px) {
  .body {
    padding: 20px 32px;
    gap: 12px;
  }
  .question {
    font-size: 28px;
  }
}
</style>
