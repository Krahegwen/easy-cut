<script setup lang="ts">
// «¿Para qué es el vídeo?»: WhatsApp, YouTube o calidad alta, con lo que pesará y lo que tardará.
import { computed, onMounted } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import type { IconName } from '../components/icons'
import {
  computeOutputSpec,
  describeExportTime,
  describeFileSize,
  describeTarget,
  estimateExportTimeMs,
  estimateProjectSizeBytes,
  formatDuration,
  type PresetId,
} from '../domain'
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

onMounted(() => void saveFlow.detectHardware())
</script>

<template>
  <main class="screen save" data-testid="save-view">
    <header class="topbar">
      <button class="btn quiet" type="button" data-testid="back-editor" @click="store.go('editor')">
        <AppIcon name="back" />
        Volver a tu vídeo
      </button>
      <h1>Guardar el vídeo</h1>
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
      <div class="options">
        <button
          v-for="o in options"
          :key="o.id"
          class="option card"
          type="button"
          :data-testid="`preset-${o.id}`"
          @click="saveFlow.start(o.id)"
        >
          <span class="icon"><AppIcon :name="o.icon" :size="34" /></span>
          <span class="title">{{ o.title }}</span>
          <span class="text">{{ o.text }}</span>
          <span class="meta">
            <span>{{ estimate(o.id).size }}</span>
            <span v-if="estimate(o.id).time" class="muted">{{ estimate(o.id).time }}</span>
          </span>
          <span class="go">
            <AppIcon name="save" />
            Guardar así
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
  padding: 36px 32px;
  gap: 18px;
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
.warning {
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
.warning span {
  display: block;
  color: var(--text);
  margin-top: 2px;
}
.options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 300px));
  gap: 20px;
  margin-top: 8px;
}
.option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 24px;
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
.where {
  margin-top: 6px;
}
</style>
