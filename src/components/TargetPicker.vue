<script setup lang="ts">
// Control «Duración máxima»: sin límite, 1, 2, 3, 5, 10 minutos u otra.
import { computed, ref } from 'vue'
import { describeTargetOption, setTargetDuration, TARGET_DURATION_OPTIONS } from '../domain'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { useShortcuts } from '../lib/use-shortcuts'
import { store } from '../store'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

// Sin v-model cambia la del vídeo (con deshacer); con v-model (teleprompter), solo devuelve el valor.
const props = defineProps<{ modelValue?: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
const controlled = computed(() => props.modelValue !== undefined)

const open = ref(false)
const custom = ref(false)
const minutes = ref(4)
const seconds = ref(0)

const current = computed(() => (controlled.value ? props.modelValue ?? null : store.project.value.targetDurationMs))
const label = computed(() => describeTargetOption(current.value))

function choose(value: number | null) {
  if (controlled.value) emit('update:modelValue', value)
  else store.apply((p) => setTargetDuration(p, value))
  open.value = false
  custom.value = false
}

function openCustom() {
  const ms = current.value ?? 240_000
  minutes.value = Math.floor(ms / 60_000)
  seconds.value = Math.round((ms % 60_000) / 1000 / 5) * 5
  custom.value = true
}

function stepMinutes(d: number) {
  minutes.value = Math.min(120, Math.max(0, minutes.value + d))
}
function stepSeconds(d: number) {
  let s = seconds.value + d
  let m = minutes.value
  if (s >= 60) {
    s -= 60
    m += 1
  } else if (s < 0) {
    if (m > 0) {
      s += 60
      m -= 1
    } else s = 0
  }
  minutes.value = Math.min(120, m)
  seconds.value = s
}

const customMs = computed(() => (minutes.value * 60 + seconds.value) * 1000)

function close() {
  if (custom.value) custom.value = false
  else open.value = false
}

// Abierto, es como un diálogo: Esc lo cierra (o vuelve de «Otra…» a la lista).
useShortcuts({
  id: 'target-picker',
  title: 'Duración máxima',
  priority: LAYER_PRIORITY.popover,
  modal: true,
  active: () => open.value,
  shortcuts: () => [
    { id: 'target-close', keys: ['Escape'], label: 'Esc', description: custom.value ? 'volver a la lista' : 'cerrar sin cambiar nada', run: close },
    ...(custom.value
      ? [{ id: 'target-use', keys: ['Enter'], label: 'Intro', description: `usar ${describeTargetOption(customMs.value)}`, run: () => choose(customMs.value), enabled: customMs.value >= 5000 }]
      : []),
  ],
})
</script>

<template>
  <div class="target-picker">
    <button class="btn" :class="{ selected: open }" type="button" data-testid="target-button" :aria-expanded="open" @click="open = !open">
      <AppIcon name="clock" />
      Duración máxima: {{ label }}
    </button>
    <div v-if="open" class="backdrop" @click="open = false" />
    <div v-if="open" class="popover card" role="dialog" aria-label="Duración máxima">
      <template v-if="!custom">
        <p class="title">¿Cuánto puede durar como mucho?</p>
        <div class="grid">
          <button
            v-for="opt in TARGET_DURATION_OPTIONS"
            :key="String(opt)"
            class="btn"
            :class="{ selected: opt === current }"
            type="button"
            :data-testid="`target-${opt === null ? 'none' : opt / 60000}`"
            @click="choose(opt)"
          >
            {{ describeTargetOption(opt) }}
          </button>
          <button class="btn" type="button" data-testid="target-custom" @click="openCustom">Otra…</button>
        </div>
      </template>
      <template v-else>
        <p class="title">Elige la duración máxima</p>
        <div class="custom">
          <div class="stepper">
            <button class="btn" type="button" aria-label="Un minuto menos" @click="stepMinutes(-1)">−</button>
            <span class="value"><strong>{{ minutes }}</strong> min</span>
            <button class="btn" type="button" aria-label="Un minuto más" @click="stepMinutes(1)">+</button>
          </div>
          <div class="stepper">
            <button class="btn" type="button" aria-label="Cinco segundos menos" @click="stepSeconds(-5)">−</button>
            <span class="value"><strong>{{ seconds }}</strong> s</span>
            <button class="btn" type="button" aria-label="Cinco segundos más" @click="stepSeconds(5)">+</button>
          </div>
        </div>
        <div class="row">
          <button class="btn" type="button" @click="custom = false">
            <AppIcon name="back" />
            Volver
            <KeyHint k="Esc" />
          </button>
          <button class="btn primary" type="button" :disabled="customMs < 5000" @click="choose(customMs)">
            <AppIcon name="check" />
            Usar {{ describeTargetOption(customMs) }}
            <KeyHint k="Intro" />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.target-picker {
  position: relative;
}
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.popover {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 21;
  padding: 18px;
  width: 400px;
  box-shadow: var(--shadow-lg);
}
.title {
  font-weight: 650;
  margin-bottom: 12px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.custom {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stepper {
  display: flex;
  align-items: center;
  gap: 12px;
}
.stepper .btn {
  width: 56px;
  font-size: 24px;
  padding: 0;
}
.value {
  min-width: 90px;
  text-align: center;
  font-size: 20px;
}
.row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
}
</style>
