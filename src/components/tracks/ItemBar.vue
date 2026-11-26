<script setup lang="ts">
// Lo que se puede hacer con el sonido o el efecto elegido: volumen, cómo aparece y desaparece, repetir, y en los
// efectos «Tamaño y sitio», «Cómo se mezcla» y «Transparencia»; además mover a la línea, partir, duplicar y
// quitar. Todo con botón y con su tecla dibujada (los arrastres de las pistas tienen siempre esta alternativa).
// Siempre en una sola línea: cuando no hay sitio, los botones menos usados se quedan en icono y tecla (con su
// nombre al pasar el ratón), para que la vista previa no se quede sin altura.
import { computed, ref } from 'vue'
import {
  EASING_LABELS,
  formatClock,
  hasMotion,
  markIndexAt,
  MAX_ITEM_VOLUME,
  MOTION_EASINGS,
  resolveTracks,
  segmentMarkIndex,
  visibleMarks,
  type Easing,
  type EffectMix,
  type MotionEasing,
} from '../../domain'
import CurveIcon from '../CurveIcon.vue'
import { LAYER_PRIORITY } from '../../lib/shortcuts'
import { useShortcuts } from '../../lib/use-shortcuts'
import { store, tracks } from '../../store'
import AppIcon from '../AppIcon.vue'
import FadePicker from '../FadePicker.vue'
import KeyHint from '../KeyHint.vue'

const props = defineProps<{ playheadMs: number }>()
const emit = defineEmits<{ seek: [ms: number] }>()

const found = computed(() => tracks.selectedItem.value)
const item = computed(() => found.value?.item ?? null)
const isEffect = computed(() => found.value?.track.kind === 'effect')
/** Ruta del fichero del elemento si no se encuentra (para «Buscarlo»). */
const lostPath = computed(() => {
  const s = item.value?.source
  return s?.type === 'file' && store.missingItems.value.some((i) => i.id === item.value!.id) ? s.path : null
})
const resolved = computed(() => (item.value ? resolveTracks(store.project.value).find((r) => r.item.id === item.value!.id) ?? null : null))
const playheadInside = computed(() => {
  const r = resolved.value
  return !!r && props.playheadMs > r.startMs + 300 && props.playheadMs < r.shownEndMs - 300
})

const open = ref<'volume' | 'mix' | 'opacity' | 'fades' | 'travel' | null>(null)
function toggle(which: 'volume' | 'mix' | 'opacity' | 'fades' | 'travel') {
  open.value = open.value === which ? null : which
}

const volumePercent = computed(() => Math.round((item.value?.volume ?? 0) * 100))
const opacityPercent = computed(() => Math.round((item.value?.look?.opacity ?? 1) * 100))

function onVolume(e: Event) {
  const v = Number((e.target as HTMLInputElement).value) / 100
  if (item.value) tracks.previewVolume(item.value.id, v)
}
function onOpacity(e: Event) {
  const v = Number((e.target as HTMLInputElement).value) / 100
  if (item.value) tracks.previewLook(item.value.id, { opacity: v })
}
function commitSlider() {
  store.commitPreview()
}
function stepVolume(delta: number) {
  if (item.value) tracks.setVolume(item.value.id, Math.round((item.value.volume + delta) * 10) / 10)
}
function stepOpacity(delta: number) {
  if (item.value?.look) tracks.setLook(item.value.id, { opacity: Math.round((item.value.look.opacity + delta) * 10) / 10 })
}
function setMix(mix: EffectMix) {
  if (item.value) tracks.setLook(item.value.id, { mix })
  open.value = null
}

function setFade(which: 'in' | 'out', fade: { ms: number; easing: Easing }) {
  const i = item.value
  if (i) tracks.setFade(i.id, which, fade)
}
/** Lo que se dice en el botón: «Aparece y desaparece» si hace las dos cosas poco a poco, si no, lo que haga. */
const fadeSummary = computed(() => {
  const i = item.value
  if (!i) return ''
  if (i.fadeInMs > 0 && i.fadeOutMs > 0) return 'Aparece y desaparece'
  if (i.fadeInMs > 0) return 'Aparece poco a poco'
  if (i.fadeOutMs > 0) return 'Desaparece poco a poco'
  return 'De golpe'
})
const fadeSubject = computed(() => (!isEffect.value ? 'sound' : item.value?.look?.mix === 'light' ? 'light' : 'effect'))
function repeat() {
  const i = item.value
  if (i && !i.still) tracks.setRepeat(i.id, !i.repeat)
}
function moveHere() {
  if (item.value) tracks.moveTo(item.value.id, props.playheadMs)
}
function split() {
  if (item.value) tracks.split(item.value.id, props.playheadMs)
}
function duplicate() {
  if (item.value) tracks.duplicate(item.value.id)
}
function remove() {
  if (item.value) tracks.remove(item.value.id)
}
function boxEdit() {
  open.value = null
  tracks.boxEditing.value = !tracks.boxEditing.value
}
function fullScreen() {
  // En el instante de la línea (con marcas, en su marca).
  if (item.value) tracks.setBoxHere(item.value.id, { x: 0.5, y: 0.5, scale: 1 })
}

// ------------------------------------------------------------------ marcas de tamaño y sitio

/** Instante del elemento en la línea. */
const local = computed(() => {
  const r = resolved.value
  return r ? Math.min(Math.max(0, props.playheadMs - r.startMs), r.shownEndMs - r.startMs) : 0
})
const marks = computed(() => (item.value?.look && resolved.value ? visibleMarks(item.value.look, resolved.value.shownEndMs - resolved.value.startMs) : []))
const onMark = computed(() => !!item.value?.look && markIndexAt(item.value.look, local.value) >= 0)
const moving = computed(() => !!item.value?.look && hasMotion(item.value.look))
const prevMark = computed(() => marks.value.filter((k) => k.atMs < local.value - 60).pop() ?? null)
const nextMark = computed(() => marks.value.find((k) => k.atMs > local.value + 60) ?? null)
const canMovePicked = computed(() => {
  const p = tracks.pickedMark.value
  return !!p && p.itemId === item.value?.id && Math.abs(p.atMs - local.value) > 120 && marks.value.some((k) => k.atMs === p.atMs)
})
/** La curva del tramo de la línea. */
const travelEasing = computed<MotionEasing | null>(() => {
  const look = item.value?.look
  if (!look || !moving.value) return null
  const i = segmentMarkIndex(look, local.value)
  return i >= 0 ? look.keyframes[i]!.easing : null
})

function toggleMark() {
  if (item.value) tracks.toggleMarkHere(item.value.id)
}
function goMark(dir: -1 | 1) {
  if (!item.value) return
  const ms = tracks.neighbourMarkMs(item.value.id, dir)
  if (ms !== null) emit('seek', ms)
}
function movePicked() {
  if (item.value) tracks.movePickedMarkHere(item.value.id)
}
function clearMotion() {
  if (item.value) tracks.clearMotion(item.value.id)
}
function setTravel(e: MotionEasing) {
  if (item.value) tracks.setTravelEasing(item.value.id, e)
  open.value = null
}
const boxHint = computed(() => {
  const at = formatClock(props.playheadMs)
  if (marks.value.length === 0) return 'Arrastra el recuadro para moverlo y tira de una esquina para el tamaño. Para que viaje: «Marcar aquí», lleva la línea a otro momento y cámbialo.'
  const n = marks.value.length === 1 ? '1 marca' : `${marks.value.length} marcas`
  return onMark.value ? `${n}. Lo que cambies se guarda en esta marca (${at}).` : `${n}. Si lo cambias, se pone una marca en la línea (${at}).`
})

// Los desplegables de volumen, mezcla y transparencia: Esc los cierra (antes que el Esc de la pantalla).
useShortcuts({
  id: 'item-popover',
  title: 'Este ajuste',
  priority: LAYER_PRIORITY.popover,
  active: () => open.value !== null,
  shortcuts: () => [
    { id: 'popover-close', keys: ['Escape'], label: 'Esc', description: 'cerrar', run: () => (open.value = null) },
    ...(open.value === 'volume'
      ? [
          { id: 'volume-down', keys: ['ArrowLeft', 'ArrowDown'], label: '←', description: 'más bajo', run: () => stepVolume(-0.1), repeat: true },
          { id: 'volume-up', keys: ['ArrowRight', 'ArrowUp'], label: '→', description: 'más alto', run: () => stepVolume(0.1), repeat: true },
        ]
      : open.value === 'opacity'
        ? [
            { id: 'opacity-down', keys: ['ArrowLeft', 'ArrowDown'], label: '←', description: 'más transparente', run: () => stepOpacity(-0.1), repeat: true },
            { id: 'opacity-up', keys: ['ArrowRight', 'ArrowUp'], label: '→', description: 'menos transparente', run: () => stepOpacity(0.1), repeat: true },
          ]
        : []),
  ],
})

// «Tamaño y sitio»: Esc o Intro lo dejan.
useShortcuts({
  id: 'box-editing',
  title: 'Tamaño y sitio',
  priority: LAYER_PRIORITY.overlay,
  active: () => tracks.boxEditing.value,
  shortcuts: () => [
    { id: 'box-done', keys: ['Escape', 'Enter'], label: 'Esc', description: 'dejar «Tamaño y sitio»', run: () => (tracks.boxEditing.value = false) },
    { id: 'box-full', keys: ['f'], label: 'F', description: 'pantalla completa', run: fullScreen },
  ],
})

defineExpose({ moveHere, split, duplicate, remove, repeat })
</script>

<template>
  <div v-if="item && found" class="item-bar-host" data-testid="item-bar">
    <!-- «Tamaño y sitio»: la barra explica qué hacer en la vista previa y cómo acabar. -->
    <div v-if="tracks.boxEditing.value" class="item-bar box-mode" data-testid="box-hint">
      <AppIcon name="resize" :size="22" />
      <span class="hint" :title="boxHint"><strong>Tamaño y sitio de «{{ item.name }}»:</strong> <span data-testid="box-hint-text">{{ boxHint }}</span></span>
      <button class="btn small" type="button" :title="onMark ? 'Quitar la marca de la línea' : 'Poner una marca en la línea'" :aria-label="onMark ? 'Quitar esta marca' : 'Marcar aquí'" data-testid="mark-toggle" @click="toggleMark">
        <AppIcon :name="onMark ? 'mark-off' : 'mark'" />
        <span class="txt">{{ onMark ? 'Quitar esta marca' : 'Marcar aquí' }}</span>
        <KeyHint k="K" />
      </button>
      <button class="btn small" type="button" :disabled="!prevMark" title="Ir a la marca anterior" aria-label="Marca anterior" data-testid="mark-prev" @click="goMark(-1)">
        <AppIcon name="step-back" />
        <KeyHint k="J" />
      </button>
      <button class="btn small" type="button" :disabled="!nextMark" title="Ir a la marca siguiente" aria-label="Marca siguiente" data-testid="mark-next" @click="goMark(1)">
        <AppIcon name="step-forward" />
        <KeyHint k="L" />
      </button>
      <button v-if="canMovePicked" class="btn small" type="button" title="Llevar la marca elegida (en amarillo en su pista) a la línea" aria-label="Mover la marca aquí" data-testid="mark-move-here" @click="movePicked">
        <AppIcon name="move-here" />
        <span class="txt">Mover la marca aquí</span>
        <KeyHint k="N" />
      </button>
      <div v-if="moving" class="pop-wrap">
        <button class="btn small" type="button" :aria-expanded="open === 'travel'" title="Cómo viaja hasta la marca siguiente" aria-label="Cómo viaja" data-testid="mark-travel" @click="toggle('travel')">
          <CurveIcon v-if="travelEasing" :easing="travelEasing" :size="28" />
          <span class="txt">Cómo viaja</span>
        </button>
        <div v-if="open === 'travel'" class="popover card travel-pop" data-testid="travel-popover">
          <h3>Cómo viaja hasta la marca</h3>
          <p class="muted note">El tramo donde está la línea.</p>
          <button
            v-for="e in MOTION_EASINGS"
            :key="e"
            class="choice row"
            :class="{ on: travelEasing === e }"
            type="button"
            :data-testid="`travel-${e}`"
            @click="setTravel(e)"
          >
            <CurveIcon :easing="e" />
            <span class="choice-text">
              <strong>{{ EASING_LABELS[e].label }}</strong>
              <span>{{ EASING_LABELS[e].hint }}</span>
            </span>
          </button>
        </div>
      </div>
      <button v-if="marks.length" class="btn small" type="button" title="Quitar todas las marcas: se queda quieto como está en la línea" aria-label="Quitar el movimiento" data-testid="mark-clear" @click="clearMotion">
        <AppIcon name="reset" />
        <span class="txt">Quitar el movimiento</span>
      </button>
      <button class="btn small" type="button" data-testid="box-fullscreen" @click="fullScreen">
        <AppIcon name="fullscreen" />
        <span class="txt">Pantalla completa</span>
        <KeyHint k="F" />
      </button>
      <button class="btn small primary" type="button" data-testid="box-done" @click="tracks.boxEditing.value = false">
        <AppIcon name="check" />
        Listo
        <KeyHint k="Esc" />
      </button>
    </div>

    <!-- Un fichero del ordenador que ya no está: se dice y se ofrece buscarlo (o quitarlo). -->
    <div v-else-if="lostPath" class="item-bar lost-mode" data-testid="item-lost">
      <AppIcon name="warning" :size="22" />
      <span class="hint"><strong>No encuentro «{{ item.name }}».</strong> Puede que se haya movido o borrado.</span>
      <button class="btn small primary" type="button" data-testid="relink-item" @click="store.relink(lostPath)">
        <AppIcon name="relink" />
        Buscarlo
      </button>
      <button class="btn small danger" type="button" data-testid="item-lost-remove" @click="tracks.remove(item.id)">
        <AppIcon name="trash" />
        Quitarlo
        <KeyHint k="Supr" />
      </button>
    </div>

    <div v-else class="item-bar" :class="{ effect: isEffect }">
      <div class="title">
        <AppIcon :name="isEffect ? 'light' : 'sound'" :size="22" />
        <span class="name" :title="`${item.name} (en «${found.track.name}»)`">{{ item.name }}</span>
        <span class="where muted">en «{{ found.track.name }}»</span>
      </div>

      <template v-if="isEffect">
        <button class="btn small" type="button" data-testid="item-box" :title="moving ? 'Tamaño y sitio (se mueve con marcas)' : 'Tamaño y sitio'" aria-label="Tamaño y sitio" @click="boxEdit">
          <AppIcon :name="moving ? 'motion' : 'resize'" />
          <span class="txt">Tamaño y sitio</span>
        </button>
        <div class="pop-wrap">
          <button class="btn small" type="button" data-testid="item-mix" :aria-expanded="open === 'mix'" title="Cómo se mezcla" @click="toggle('mix')">
            <AppIcon name="blend" />
            {{ item.look?.mix === 'light' ? 'Como luz' : 'Normal' }}
          </button>
          <div v-if="open === 'mix'" class="popover card mix-pop" data-testid="mix-popover">
            <h3>Cómo se mezcla</h3>
            <button class="choice" :class="{ on: item.look?.mix !== 'light' }" type="button" data-testid="mix-normal" @click="setMix('normal')">
              <strong>Normal</strong>
              <span>Se pone encima, tal cual (con su transparencia, si la trae).</span>
            </button>
            <button class="choice" :class="{ on: item.look?.mix === 'light' }" type="button" data-testid="mix-light" @click="setMix('light')">
              <strong>Como luz</strong>
              <span>El negro desaparece y solo queda la luz: para chispas, luces, nieve…</span>
            </button>
          </div>
        </div>
        <div class="pop-wrap">
          <button class="btn small" type="button" data-testid="item-opacity" :aria-expanded="open === 'opacity'" title="Transparencia" aria-label="Transparencia" @click="toggle('opacity')">
            <AppIcon name="eye" />
            {{ opacityPercent }} %
          </button>
          <div v-if="open === 'opacity'" class="popover card" data-testid="opacity-popover">
            <h3>Transparencia</h3>
            <div class="slider">
              <span>Más transparente</span>
              <input type="range" min="0" max="100" step="5" :value="opacityPercent" aria-label="Transparencia" data-testid="opacity-slider" @input="onOpacity" @change="commitSlider" />
              <span>Se ve entero</span>
            </div>
          </div>
        </div>
      </template>

      <div v-if="!isEffect || item.hasAudio" class="pop-wrap">
        <button class="btn small" type="button" data-testid="item-volume" :aria-expanded="open === 'volume'" title="Volumen" aria-label="Volumen" @click="toggle('volume')">
          <AppIcon :name="item.volume === 0 ? 'mute' : 'sound'" />
          <span class="txt">Volumen</span>
          <span class="value">{{ volumePercent }} %</span>
        </button>
        <div v-if="open === 'volume'" class="popover card" data-testid="volume-popover">
          <h3>Volumen</h3>
          <div class="slider">
            <span>Más bajo</span>
            <input type="range" min="0" :max="MAX_ITEM_VOLUME * 100" step="5" :value="volumePercent" aria-label="Volumen" data-testid="volume-slider" @input="onVolume" @change="commitSlider" />
            <span>Más alto</span>
          </div>
          <p class="muted note">{{ volumePercent }} % · 100 % es como viene. <template v-if="volumePercent > 100">En la vista previa se oye al 100 %; al guardar, más fuerte.</template></p>
        </div>
      </div>

      <div class="pop-wrap">
        <button
          class="btn small toggle"
          :class="{ selected: item.fadeInMs > 0 || item.fadeOutMs > 0 }"
          type="button"
          :aria-expanded="open === 'fades'"
          :title="`Aparecer y desaparecer (ahora: ${fadeSummary})`"
          aria-label="Aparecer y desaparecer"
          data-testid="item-fades"
          :data-summary="fadeSummary"
          @click="toggle('fades')"
        >
          <AppIcon name="fade-in" />
          <span class="txt fade-txt">Aparecer</span>
        </button>
        <div v-if="open === 'fades'" class="popover card fades-pop" data-testid="fades-popover">
          <FadePicker :fades="item" :subject="fadeSubject" @change="setFade" />
        </div>
      </div>
      <button v-if="!item.still" class="btn small toggle" :class="{ selected: item.repeat }" type="button" :aria-pressed="item.repeat" title="Repetir" aria-label="Repetir" data-testid="item-repeat" @click="repeat">
        <AppIcon name="repeat" />
        <span class="txt">Repetir</span>
        <KeyHint k="R" />
      </button>

      <span class="spacer" />
      <button class="btn small" type="button" data-testid="item-move-here" title="Que empiece donde está la línea" aria-label="A la línea" @click="moveHere">
        <AppIcon name="move-here" />
        <span class="txt action-txt">A la línea</span>
        <KeyHint k="M" />
      </button>
      <button class="btn small" type="button" :disabled="!playheadInside" data-testid="item-split" title="Partir donde está la línea" aria-label="Partir" @click="split">
        <AppIcon name="split" />
        <span class="txt action-txt">Partir</span>
        <KeyHint k="P" />
      </button>
      <button class="btn small" type="button" data-testid="item-duplicate" title="Duplicar" aria-label="Duplicar" @click="duplicate">
        <AppIcon name="copy" />
        <span class="txt action-txt">Duplicar</span>
        <KeyHint k="D" />
      </button>
      <button class="btn small danger" type="button" data-testid="item-remove" title="Quitar" aria-label="Quitar" @click="remove">
        <AppIcon name="trash" />
        <span class="txt">Quitar</span>
        <KeyHint k="Supr" />
      </button>
      <button class="btn small quiet close" type="button" aria-label="Dejar de elegirlo" title="Dejar de elegirlo (Esc)" data-testid="item-deselect" @click="tracks.select(null)">
        <AppIcon name="close" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.item-bar-host {
  container-type: inline-size;
  padding: 10px 20px 0;
}
.item-bar {
  position: relative;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 70px;
  max-width: 260px;
  margin-right: 4px;
  color: #3c8f9b;
}
.effect .title {
  color: #7b56b0;
}
.name {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 650;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.where {
  font-size: 15px;
  white-space: nowrap;
}
.btn.small {
  flex: none;
  min-height: 44px;
  padding: 0 12px;
  gap: 7px;
  font-size: 16px;
}
.btn.toggle.selected {
  font-weight: 650;
}
.btn.close {
  width: 44px;
  padding: 0;
}
.value {
  font-variant-numeric: tabular-nums;
}
.spacer {
  flex: 1 1 0;
  min-width: 0;
}
.pop-wrap {
  position: relative;
  flex: none;
}
.popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 30;
  width: 360px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--shadow-lg);
}
.popover h3 {
  font-size: 17px;
}
.slider {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  color: var(--text-muted);
  white-space: nowrap;
}
.slider input {
  flex: 1;
  accent-color: var(--accent);
  height: 32px;
}
.note {
  font-size: 14px;
}
.mix-pop {
  width: 380px;
}
.travel-pop {
  width: 340px;
  gap: 6px;
  left: auto;
  right: 0;
}
.choice.row {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
}
.choice-text {
  display: flex;
  flex-direction: column;
}
.choice .choice-text span {
  font-size: 13px;
}
.fades-pop {
  width: min(600px, calc(100vw - 48px));
  max-height: calc(100vh - 140px);
  overflow: auto;
}
.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
}
.choice strong {
  font-size: 17px;
}
.choice span {
  font-size: 15px;
  color: var(--text-muted);
}
.choice.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.box-mode {
  padding: 0 4px 0 12px;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent-hover);
}
.lost-mode {
  padding: 0 4px 0 12px;
  border-radius: 12px;
  background: var(--warn-soft);
  color: var(--warn);
}
.lost-mode .hint {
  color: var(--text);
}
.hint {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  line-height: 1.25;
  /* Dos líneas como mucho: la barra no crece (el texto entero sale al pasar el ratón). */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.box-mode .btn.small {
  padding: 0 10px;
}
/* Cuanto menos ancho, más botones se quedan en icono y tecla (el nombre sale al pasar el ratón). */
@container (max-width: 1480px) {
  .where {
    display: none;
  }
  .fade-txt {
    display: none;
  }
}
@container (max-width: 1560px) {
  /* En «Tamaño y sitio», los botones de las marcas en icono y tecla: el texto de arriba explica qué hacer. */
  .box-mode .txt {
    display: none;
  }
}
@container (max-width: 1260px) {
  .action-txt {
    display: none;
  }
}
@container (max-width: 1120px) {
  .txt {
    display: none;
  }
  .title {
    max-width: 170px;
  }
  .item-bar {
    gap: 6px;
  }
  .btn.small {
    padding: 0 10px;
    gap: 5px;
  }
}
@container (max-width: 900px) {
  .hint {
    font-size: 14px;
  }
  .box-mode .key-hint {
    display: none;
  }
}
</style>
