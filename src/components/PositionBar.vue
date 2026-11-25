<script setup lang="ts">
// Barra de posición grande: se pulsa o se arrastra (sin hover ni doble clic). Marca dónde empieza cada trozo.
import { computed, ref } from 'vue'

const props = defineProps<{
  value: number
  max: number
  /** Posiciones (ms) donde empieza cada trozo, sin el 0. */
  markers?: number[]
  label?: string
}>()
const emit = defineEmits<{ seek: [ms: number]; 'seek-start': []; 'seek-end': [] }>()

const track = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const pct = computed(() => (props.max > 0 ? Math.min(1, Math.max(0, props.value / props.max)) * 100 : 0))

function msAt(clientX: number): number {
  const el = track.value
  if (!el || props.max <= 0) return 0
  const r = el.getBoundingClientRect()
  return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * props.max)
}

function down(e: PointerEvent) {
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragging.value = true
  emit('seek-start')
  emit('seek', msAt(e.clientX))
}
function move(e: PointerEvent) {
  if (dragging.value) emit('seek', msAt(e.clientX))
}
function up() {
  if (!dragging.value) return
  dragging.value = false
  emit('seek-end')
}
</script>

<template>
  <div
    class="position-bar"
    :class="{ dragging }"
    role="slider"
    tabindex="0"
    :aria-label="label ?? 'Posición en el vídeo'"
    :aria-valuemin="0"
    :aria-valuemax="Math.round(max / 1000)"
    :aria-valuenow="Math.round(value / 1000)"
    data-testid="position-bar"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
  >
    <div ref="track" class="track">
      <div class="done" :style="{ width: `${pct}%` }" />
      <span v-for="(m, i) in markers ?? []" :key="i" class="marker" :style="{ left: `${(m / max) * 100}%` }" />
      <div class="thumb" :style="{ left: `${pct}%` }" />
    </div>
  </div>
</template>

<style scoped>
.position-bar {
  flex: 1;
  min-width: 0;
  height: 48px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
  padding: 0 12px;
}
.track {
  position: relative;
  width: 100%;
  height: 10px;
  border-radius: 5px;
  background: rgb(255 255 255 / 0.22);
}
.done {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 5px;
  background: #fff;
}
.marker {
  position: absolute;
  top: -5px;
  width: 3px;
  height: 20px;
  margin-left: -1.5px;
  border-radius: 2px;
  background: rgb(255 255 255 / 0.55);
}
.thumb {
  position: absolute;
  top: 50%;
  width: 26px;
  height: 26px;
  margin: -13px 0 0 -13px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid var(--accent);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
}
.dragging .thumb {
  transform: scale(1.12);
}
</style>
