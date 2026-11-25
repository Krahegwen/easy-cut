<script setup lang="ts">
// Tira de miniaturas del original a lo ancho, con asas gruesas de inicio y fin, el cabezal arrastrable,
// lo que no se conserva oscurecido y, opcionalmente, las pausas que se van a quitar en otro color.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatClock, type TimeRange } from '../domain'
import ThumbImage from './ThumbImage.vue'

const props = withDefaults(
  defineProps<{
    path: string
    durationMs: number
    inMs: number
    outMs: number
    /** Rangos conservados (para oscurecer los huecos entre ellos). */
    segments: TimeRange[]
    playheadMs: number
    /** Pausas que se van a quitar (se pintan en otro color). */
    highlights?: TimeRange[]
    editable?: boolean
    /** Texto de ayuda bajo la tira. */
    caption?: string
  }>(),
  { highlights: () => [], editable: true, caption: '' },
)

type Phase = 'start' | 'move' | 'end'
const emit = defineEmits<{
  'drag-in': [ms: number, phase: Phase]
  'drag-out': [ms: number, phase: Phase]
  scrub: [ms: number, phase: Phase]
}>()

const root = ref<HTMLDivElement | null>(null)
const width = ref(800)
let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (root.value) width.value = root.value.clientWidth
  })
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const count = computed(() => Math.min(16, Math.max(4, Math.round(width.value / 112))))
const times = computed(() => Array.from({ length: count.value }, (_, i) => ((i + 0.5) * props.durationMs) / count.value))

const pct = (ms: number) => `${(Math.min(Math.max(ms, 0), props.durationMs) / Math.max(1, props.durationMs)) * 100}%`
const widthPct = (r: TimeRange) => `${((r.endMs - r.startMs) / Math.max(1, props.durationMs)) * 100}%`

/** Huecos dentro del corte que no se conservan (pausas ya quitadas). */
const gaps = computed<TimeRange[]>(() => {
  const out: TimeRange[] = []
  for (let i = 1; i < props.segments.length; i++) {
    out.push({ startMs: props.segments[i - 1]!.endMs, endMs: props.segments[i]!.startMs })
  }
  return out
})

let dragging: 'in' | 'out' | 'scrub' | null = null

function msAt(clientX: number): number {
  const el = root.value
  if (!el) return 0
  const r = el.getBoundingClientRect()
  return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * props.durationMs)
}

function emitFor(kind: 'in' | 'out' | 'scrub', ms: number, phase: Phase) {
  if (kind === 'in') emit('drag-in', ms, phase)
  else if (kind === 'out') emit('drag-out', ms, phase)
  else emit('scrub', ms, phase)
}

function down(kind: 'in' | 'out' | 'scrub', e: PointerEvent) {
  if (e.button !== 0) return
  if (kind !== 'scrub' && !props.editable) kind = 'scrub'
  e.stopPropagation()
  dragging = kind
  root.value?.setPointerCapture(e.pointerId)
  emitFor(kind, msAt(e.clientX), 'start')
}
function move(e: PointerEvent) {
  if (dragging) emitFor(dragging, msAt(e.clientX), 'move')
}
function up(e: PointerEvent) {
  if (!dragging) return
  const kind = dragging
  dragging = null
  emitFor(kind, msAt(e.clientX), 'end')
}
</script>

<template>
  <div class="filmstrip-wrap">
    <div
      ref="root"
      class="filmstrip"
      data-testid="filmstrip"
      :data-in-ms="inMs"
      :data-out-ms="outMs"
      :data-playhead-ms="Math.round(playheadMs)"
      @pointerdown="down('scrub', $event)"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <div class="thumbs">
        <div v-for="(t, i) in times" :key="`${count}-${i}`" class="cell">
          <ThumbImage :path="path" :time-ms="t" :height="72" />
        </div>
      </div>
      <div class="veil" :style="{ left: 0, width: pct(inMs) }" />
      <div class="veil" :style="{ left: pct(outMs), right: 0 }" />
      <div v-for="(g, i) in gaps" :key="`g${i}`" class="gap" :style="{ left: pct(g.startMs), width: widthPct(g) }" />
      <div
        v-for="(h, i) in highlights"
        :key="`h${i}`"
        class="pause"
        data-testid="pause-mark"
        :style="{ left: pct(h.startMs), width: widthPct(h) }"
      />
      <div class="kept" :style="{ left: pct(inMs), width: `calc(${pct(outMs)} - ${pct(inMs)})` }" />

      <template v-if="editable">
        <button
          class="handle in"
          type="button"
          :style="{ left: pct(inMs) }"
          aria-label="Asa del principio: arrastra para cambiar dónde empieza"
          data-testid="handle-in"
          @pointerdown="down('in', $event)"
        >
          <span class="grip" />
        </button>
        <button
          class="handle out"
          type="button"
          :style="{ left: pct(outMs) }"
          aria-label="Asa del final: arrastra para cambiar dónde termina"
          data-testid="handle-out"
          @pointerdown="down('out', $event)"
        >
          <span class="grip" />
        </button>
      </template>

      <div class="playhead" :style="{ left: pct(playheadMs) }" data-testid="playhead">
        <span class="knob" @pointerdown="down('scrub', $event)" />
      </div>
    </div>
    <div class="scale">
      <span>{{ formatClock(0) }}</span>
      <span class="caption">{{ caption }}</span>
      <span>{{ formatClock(durationMs) }}</span>
    </div>
  </div>
</template>

<style scoped>
.filmstrip-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 16px;
}
.filmstrip {
  position: relative;
  height: 84px;
  border-radius: 10px;
  background: #1f252c;
  cursor: pointer;
  touch-action: none;
  margin: 0 14px;
}
.thumbs {
  position: absolute;
  inset: 0;
  display: flex;
  border-radius: 10px;
  overflow: hidden;
}
.cell {
  flex: 1;
  min-width: 0;
  border-right: 1px solid rgb(0 0 0 / 0.35);
}
.veil {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgb(18 22 26 / 0.74);
  pointer-events: none;
}
.veil:first-of-type {
  border-radius: 10px 0 0 10px;
}
.gap {
  position: absolute;
  top: 0;
  bottom: 0;
  background: repeating-linear-gradient(135deg, rgb(18 22 26 / 0.78) 0 6px, rgb(18 22 26 / 0.55) 6px 12px);
  pointer-events: none;
}
.pause {
  position: absolute;
  top: 0;
  bottom: 0;
  background: repeating-linear-gradient(135deg, rgb(224 138 30 / 0.85) 0 7px, rgb(224 138 30 / 0.55) 7px 14px);
  border-left: 2px solid var(--pause);
  border-right: 2px solid var(--pause);
  pointer-events: none;
}
.kept {
  position: absolute;
  top: -3px;
  bottom: -3px;
  border-top: 4px solid #fff;
  border-bottom: 4px solid #fff;
  pointer-events: none;
}
.handle {
  position: absolute;
  top: -8px;
  bottom: -8px;
  width: 26px;
  margin-left: -13px;
  border: none;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 6px rgb(0 0 0 / 0.45);
  cursor: ew-resize;
  display: grid;
  place-items: center;
  padding: 0;
  z-index: 2;
}
.handle.in {
  margin-left: -22px;
}
.handle.out {
  margin-left: -4px;
}
.handle:hover {
  background: var(--accent-soft);
}
.grip {
  width: 6px;
  height: 30px;
  border-left: 2px solid var(--accent);
  border-right: 2px solid var(--accent);
}
.playhead {
  position: absolute;
  top: -16px;
  bottom: -6px;
  width: 0;
  z-index: 3;
  pointer-events: none;
}
.playhead::after {
  content: '';
  position: absolute;
  left: -1.5px;
  top: 12px;
  bottom: 0;
  width: 3px;
  background: var(--accent);
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.7);
}
.knob {
  position: absolute;
  left: -13px;
  top: -6px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent);
  border: 3px solid #fff;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
  pointer-events: auto;
  cursor: grab;
}
.caption {
  color: var(--text-muted);
  font-size: 15px;
}
.scale {
  display: flex;
  justify-content: space-between;
  margin: 0 14px;
  font-size: 14px;
  color: var(--text-soft);
  font-variant-numeric: tabular-nums;
}
@media (max-height: 760px) {
  .filmstrip {
    height: 68px;
  }
}
</style>
