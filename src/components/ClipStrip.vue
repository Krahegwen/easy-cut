<script setup lang="ts">
// La tira de trozos: tarjetas numeradas con miniatura y duración. Se pulsa para elegir y se arrastra
// para cambiar el orden (con eventos de puntero: con dragDropEnabled, el arrastre HTML5 no va en WebView2).
import { computed, onBeforeUnmount, ref } from 'vue'
import { attachedCounts, clipDurationMs, clipInOut, formatDuration, type Clip } from '../domain'
import { store } from '../store'
import AppIcon from './AppIcon.vue'
import ThumbImage from './ThumbImage.vue'

const emit = defineEmits<{ add: []; record: [] }>()

const clips = computed(() => store.project.value.clips)
/** Cuántos sonidos y efectos lleva pegados cada trozo (se ve en su tarjeta). */
const attached = computed(() => attachedCounts(store.project.value))
function attachedText(clip: Clip): string | null {
  const c = attached.value.get(clip.id)
  if (!c) return null
  const parts: string[] = []
  if (c.sounds) parts.push(c.sounds === 1 ? '1 sonido' : `${c.sounds} sonidos`)
  if (c.effects) parts.push(c.effects === 1 ? '1 efecto' : `${c.effects} efectos`)
  return parts.join(' · ')
}
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

type CardPicture =
  | { kind: 'lost' | 'cover-lost' | 'sound' }
  | { kind: 'thumb' | 'cover'; path: string; timeMs: number }

/** Lo que enseña la tarjeta: la miniatura del trozo, la del vídeo de encima, el sonido o el aviso. */
function cardPicture(clip: Clip): CardPicture {
  if (isMissing(clip)) return { kind: 'lost' }
  const p = clip.picture
  if (p.kind === 'cover') {
    if (store.coverMissing(clip)) return { kind: 'cover-lost' }
    return { kind: 'cover', path: p.sourcePath, timeMs: Math.min(p.startMs + 400, Math.max(0, p.sourceDurationMs - 100)) }
  }
  if (p.kind === 'none' || !clip.sourceHasVideo) return { kind: 'sound' }
  return { kind: 'thumb', path: clip.sourcePath, timeMs: thumbTime(clip) }
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
        <span class="picture" :class="`pic-${cardPicture(clip).kind}`" :data-picture="cardPicture(clip).kind">
          <template v-if="cardPicture(clip).kind === 'thumb' || cardPicture(clip).kind === 'cover'">
            <ThumbImage
              :path="(cardPicture(clip) as { path: string }).path"
              :time-ms="(cardPicture(clip) as { timeMs: number }).timeMs"
              :height="120"
            />
            <span v-if="cardPicture(clip).kind === 'cover'" class="over" title="Lleva otro vídeo encima">
              <AppIcon name="cover-video" :size="16" />
              Vídeo encima
            </span>
          </template>
          <span v-else-if="cardPicture(clip).kind === 'sound'" class="sound-card">
            <AppIcon name="wave" :size="34" />
            Solo se oye
          </span>
          <span v-else-if="cardPicture(clip).kind === 'cover-lost'" class="lost">
            <AppIcon name="warning" :size="28" />
            No encuentro el vídeo de encima
          </span>
          <span v-else class="lost">
            <AppIcon name="warning" :size="28" />
            No encuentro este vídeo
          </span>
          <span class="number">{{ clips.indexOf(clip) + 1 }}</span>
          <span class="duration" data-testid="clip-duration">{{ formatDuration(clipDurationMs(clip)) }}</span>
        </span>
        <span class="badges">
          <span v-for="b in badges(clip)" :key="b.text" class="badge"><AppIcon :name="b.icon" :size="16" />{{ b.text }}</span>
          <span v-if="attachedText(clip)" class="badge attached" data-testid="clip-attached" :title="`Lleva pegado: ${attachedText(clip)}`"><AppIcon name="tracks" :size="16" />{{ attachedText(clip) }}</span>
          <span v-if="badges(clip).length === 0 && !attachedText(clip)" class="badge plain">Sin cambios</span>
        </span>
      </button>
    </template>
    <div v-if="slotBefore === 'end'" class="drop-slot" />
    <button class="clip-card add" type="button" data-testid="add-more" @click="emit('add')">
      <span class="add-inner">
        <AppIcon name="plus" :size="34" />
        Añadir vídeos o sonidos
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
        <span class="picture" :class="`pic-${cardPicture(draggedClip).kind}`">
          <ThumbImage
            v-if="cardPicture(draggedClip).kind === 'thumb' || cardPicture(draggedClip).kind === 'cover'"
            :path="(cardPicture(draggedClip) as { path: string }).path"
            :time-ms="(cardPicture(draggedClip) as { timeMs: number }).timeMs"
            :height="120"
          />
          <span v-else-if="cardPicture(draggedClip).kind === 'sound'" class="sound-card">
            <AppIcon name="wave" :size="34" />
            Solo se oye
          </span>
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
.badge.attached {
  background: #efe7f8;
  color: #5b3590;
}
.badge.plain {
  background: transparent;
  color: var(--text-soft);
  font-weight: 400;
}
.missing .picture,
.picture.pic-cover-lost {
  background: var(--warn-soft);
}
.picture.pic-sound {
  background: #1c2229;
}
.sound-card {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  /* Por encima de la duración, que va abajo a la derecha. */
  padding-bottom: 26px;
  color: #9ec5e0;
  font-weight: 650;
  font-size: 15px;
}
.over {
  position: absolute;
  right: 7px;
  top: 7px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 7px;
  background: rgb(0 0 0 / 0.72);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
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
  .sound-card {
    padding-bottom: 22px;
    font-size: 14px;
  }
}
</style>
