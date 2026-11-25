<script setup lang="ts">
// La tira de trozos: tarjetas numeradas con miniatura y duración. Se pulsa para elegir y se arrastra
// para cambiar el orden (con eventos de puntero: con dragDropEnabled, el arrastre HTML5 no va en WebView2).
import { computed, onBeforeUnmount, ref } from 'vue'
import { clipDurationMs, clipInOut, formatDuration, type Clip } from '../domain'
import { store } from '../store'
import AppIcon from './AppIcon.vue'
import ThumbImage from './ThumbImage.vue'

const emit = defineEmits<{ add: []; record: [] }>()

const clips = computed(() => store.project.value.clips)
const scroller = ref<HTMLDivElement | null>(null)
const cardEls = new Map<string, HTMLElement>()

const drag = ref<{ id: string; startX: number; startY: number; x: number; y: number; active: boolean; target: number; offsetX: number; offsetY: number } | null>(null)

function setCard(id: string, el: unknown) {
  if (el instanceof HTMLElement) cardEls.set(id, el)
  else cardEls.delete(id)
}

function thumbTime(clip: Clip): number {
  const io = clipInOut(clip)
  return Math.min(io.startMs + 400, Math.max(io.startMs, io.endMs - 100))
}

function badges(clip: Clip): { icon: 'speed' | 'mute' | 'pauses' | 'scissors'; text: string }[] {
  const out: { icon: 'speed' | 'mute' | 'pauses' | 'scissors'; text: string }[] = []
  if (clip.speed !== 1) out.push({ icon: 'speed', text: clip.speed < 1 ? 'Despacio' : clip.speed === 4 ? 'Muy rápido' : 'Rápido' })
  if (clip.muted || clip.speed === 4) out.push({ icon: 'mute', text: 'Sin sonido' })
  if (clip.segments.length > 1) out.push({ icon: 'pauses', text: 'Sin pausas' })
  return out
}

function isMissing(clip: Clip) {
  return !!store.missing.value[clip.sourcePath]
}

function down(clip: Clip, e: PointerEvent) {
  if (e.button !== 0) return
  const el = cardEls.get(clip.id)
  const r = el?.getBoundingClientRect()
  drag.value = {
    id: clip.id,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    active: false,
    target: clips.value.indexOf(clip),
    offsetX: r ? e.clientX - r.left : 0,
    offsetY: r ? e.clientY - r.top : 0,
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
}

function stopListening() {
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', up)
  window.removeEventListener('pointercancel', cancel)
}

/** Índice donde caería la tarjeta según la posición del puntero respecto al centro de las demás. */
function targetIndex(x: number, draggedId: string): number {
  const others = clips.value.filter((c) => c.id !== draggedId)
  let index = 0
  for (const c of others) {
    const r = cardEls.get(c.id)?.getBoundingClientRect()
    if (r && x > r.left + r.width / 2) index++
  }
  return index
}

let autoScroll = 0
function move(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  d.x = e.clientX
  d.y = e.clientY
  if (!d.active && Math.hypot(d.x - d.startX, d.y - d.startY) > 8) d.active = true
  if (!d.active) return
  d.target = targetIndex(d.x, d.id)
  // Desplaza la tira si se arrastra cerca de los bordes.
  const s = scroller.value
  if (s) {
    const r = s.getBoundingClientRect()
    const speed = d.x < r.left + 60 ? -14 : d.x > r.right - 60 ? 14 : 0
    cancelAnimationFrame(autoScroll)
    if (speed) {
      const step = () => {
        s.scrollLeft += speed
        if (drag.value?.active) {
          drag.value.target = targetIndex(drag.value.x, drag.value.id)
          autoScroll = requestAnimationFrame(step)
        }
      }
      autoScroll = requestAnimationFrame(step)
    }
  }
}

function up() {
  const d = drag.value
  cancelAnimationFrame(autoScroll)
  stopListening()
  drag.value = null
  if (!d) return
  store.select(d.id)
  if (d.active) {
    const from = clips.value.findIndex((c) => c.id === d.id)
    if (from >= 0 && d.target !== from) store.moveTo(d.id, d.target)
  }
}

function cancel() {
  cancelAnimationFrame(autoScroll)
  stopListening()
  drag.value = null
}

onBeforeUnmount(() => {
  cancelAnimationFrame(autoScroll)
  stopListening()
})

/** Lista con el hueco donde caerá la tarjeta arrastrada. */
const draggingId = computed(() => (drag.value?.active ? drag.value.id : null))
const dropIndex = computed(() => (drag.value?.active ? drag.value.target : -1))
const ghostStyle = computed(() => {
  const d = drag.value
  if (!d?.active) return {}
  return { left: `${d.x - d.offsetX}px`, top: `${d.y - d.offsetY}px` }
})
const draggedClip = computed(() => (draggingId.value ? clips.value.find((c) => c.id === draggingId.value) ?? null : null))
/** Tarjeta delante de la cual se dibuja el hueco ('end' = al final). */
const slotBefore = computed<string | null>(() => {
  if (!draggingId.value) return null
  const others = clips.value.filter((c) => c.id !== draggingId.value)
  return others[dropIndex.value]?.id ?? 'end'
})
</script>

<template>
  <div ref="scroller" class="strip" data-testid="clip-strip">
    <template v-for="clip in clips" :key="clip.id">
      <div v-if="slotBefore === clip.id" class="drop-slot" />
      <button
        :ref="(el) => setCard(clip.id, el)"
        class="clip-card"
        :class="{ selected: clip.id === store.selectedClipId.value, missing: isMissing(clip), dragging: clip.id === draggingId }"
        type="button"
        :data-testid="`clip-card-${clips.indexOf(clip) + 1}`"
        :data-clip-id="clip.id"
        :aria-label="`Trozo ${clips.indexOf(clip) + 1}, dura ${formatDuration(clipDurationMs(clip))}`"
        :aria-pressed="clip.id === store.selectedClipId.value"
        @pointerdown="down(clip, $event)"
        @keydown.enter.prevent="store.select(clip.id)"
      >
        <span class="picture">
          <ThumbImage v-if="!isMissing(clip)" :path="clip.sourcePath" :time-ms="thumbTime(clip)" :height="120" />
          <span v-else class="lost">
            <AppIcon name="warning" :size="28" />
            No encuentro este vídeo
          </span>
          <span class="number">{{ clips.indexOf(clip) + 1 }}</span>
          <span class="duration" data-testid="clip-duration">{{ formatDuration(clipDurationMs(clip)) }}</span>
        </span>
        <span class="badges">
          <span v-for="b in badges(clip)" :key="b.text" class="badge"><AppIcon :name="b.icon" :size="16" />{{ b.text }}</span>
          <span v-if="badges(clip).length === 0" class="badge plain">Sin cambios</span>
        </span>
      </button>
    </template>
    <div v-if="slotBefore === 'end'" class="drop-slot" />
    <button class="clip-card add" type="button" data-testid="add-more" @click="emit('add')">
      <span class="add-inner">
        <AppIcon name="plus" :size="34" />
        Añadir más vídeos
      </span>
    </button>
    <button class="clip-card add record" type="button" data-testid="record-more" @click="emit('record')">
      <span class="add-inner">
        <AppIcon name="camera" :size="34" />
        Grabarme
      </span>
    </button>
    <Teleport to="body">
      <div v-if="draggedClip" class="clip-card ghost selected" :style="ghostStyle">
        <span class="picture">
          <ThumbImage :path="draggedClip.sourcePath" :time-ms="thumbTime(draggedClip)" :height="120" />
          <span class="duration">{{ formatDuration(clipDurationMs(draggedClip)) }}</span>
        </span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 14px 20px 16px;
  scrollbar-width: thin;
  align-items: stretch;
}
.clip-card {
  flex: none;
  width: 196px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 7px;
  border-radius: 14px;
  border: 2px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  text-align: left;
  touch-action: none;
  transition:
    border-color 0.12s,
    box-shadow 0.12s;
}
.clip-card:hover {
  border-color: var(--border-strong);
}
.clip-card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.picture {
  position: relative;
  display: block;
  height: 104px;
  border-radius: 9px;
  overflow: hidden;
  background: #2a3038;
}
.number {
  position: absolute;
  left: 7px;
  top: 7px;
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  border-radius: 15px;
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 0.94);
  color: var(--text);
  font-weight: 700;
  font-size: 16px;
}
.selected .number {
  background: var(--accent);
  color: #fff;
}
.duration {
  position: absolute;
  right: 7px;
  bottom: 7px;
  padding: 3px 9px;
  border-radius: 8px;
  background: rgb(0 0 0 / 0.72);
  color: #fff;
  font-weight: 650;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-height: 26px;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-size: 14px;
  font-weight: 600;
}
.badge.plain {
  background: transparent;
  color: var(--text-soft);
  font-weight: 400;
}
.missing .picture {
  background: var(--warn-soft);
}
.lost {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--warn);
  font-weight: 650;
  font-size: 15px;
  text-align: center;
  padding: 0 10px;
}
.add {
  border-style: dashed;
  border-color: var(--border-strong);
  background: transparent;
  color: var(--accent);
  justify-content: center;
}
.add.record {
  width: 150px;
}
.add:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.add-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-weight: 650;
  font-size: 17px;
}
.drop-slot {
  flex: none;
  width: 8px;
  margin: 0 -3px;
  border-radius: 4px;
  background: var(--accent);
}
.dragging {
  opacity: 0.35;
}
.ghost {
  position: fixed;
  z-index: 70;
  pointer-events: none;
  box-shadow: var(--shadow-lg);
  transform: rotate(-2deg);
  opacity: 0.95;
}
@media (max-height: 760px) {
  .strip {
    padding: 10px 20px 10px;
  }
  .clip-card {
    width: 168px;
    gap: 5px;
  }
  .picture {
    height: 84px;
  }
}
</style>
