<script setup lang="ts">
// Lo que se puede hacer con el sonido o el efecto elegido: volumen, entrada y salida suaves, repetir, y en los
// efectos «Tamaño y sitio», «Cómo se mezcla» y «Transparencia»; además mover a la línea, partir, duplicar y
// quitar. Todo con botón y con su tecla dibujada (los arrastres de las pistas tienen siempre esta alternativa).
// Siempre en una sola línea: cuando no hay sitio, los botones menos usados se quedan en icono y tecla (con su
// nombre al pasar el ratón), para que la vista previa no se quede sin altura.
import { computed, ref } from 'vue'
import { MAX_ITEM_VOLUME, resolveTracks, type EffectMix } from '../../domain'
import { LAYER_PRIORITY } from '../../lib/shortcuts'
import { useShortcuts } from '../../lib/use-shortcuts'
import { store, tracks } from '../../store'
import AppIcon from '../AppIcon.vue'
import KeyHint from '../KeyHint.vue'

const props = defineProps<{ playheadMs: number }>()

const found = computed(() => tracks.selectedItem.value)
const item = computed(() => found.value?.item ?? null)
const isEffect = computed(() => found.value?.track.kind === 'effect')
const resolved = computed(() => (item.value ? resolveTracks(store.project.value).find((r) => r.item.id === item.value!.id) ?? null : null))
const playheadInside = computed(() => {
  const r = resolved.value
  return !!r && props.playheadMs > r.startMs + 300 && props.playheadMs < r.shownEndMs - 300
})

const open = ref<'volume' | 'mix' | 'opacity' | null>(null)
function toggle(which: 'volume' | 'mix' | 'opacity') {
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

function fade(which: 'in' | 'out') {
  const i = item.value
  if (i) tracks.setFade(i.id, which, which === 'in' ? i.fadeInMs === 0 : i.fadeOutMs === 0)
}
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
  if (item.value) tracks.setLook(item.value.id, { box: { x: 0.5, y: 0.5, scale: 1 } })
}

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
      <span class="hint"><strong>Tamaño y sitio de «{{ item.name }}»:</strong> arrastra el recuadro en la vista previa para moverlo; tira de una esquina para cambiar el tamaño.</span>
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

    <div v-else class="item-bar" :class="{ effect: isEffect }">
      <div class="title">
        <AppIcon :name="isEffect ? 'light' : 'sound'" :size="22" />
        <span class="name" :title="`${item.name} (en «${found.track.name}»)`">{{ item.name }}</span>
        <span class="where muted">en «{{ found.track.name }}»</span>
      </div>

      <template v-if="isEffect">
        <button class="btn small" type="button" data-testid="item-box" title="Tamaño y sitio" aria-label="Tamaño y sitio" @click="boxEdit">
          <AppIcon name="resize" />
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

      <button class="btn small toggle" :class="{ selected: item.fadeInMs > 0 }" type="button" :aria-pressed="item.fadeInMs > 0" title="Entrada suave" aria-label="Entrada suave" data-testid="item-fade-in" @click="fade('in')">
        <AppIcon name="fade-in" />
        <span class="txt fade-txt">Entrada suave</span>
      </button>
      <button class="btn small toggle" :class="{ selected: item.fadeOutMs > 0 }" type="button" :aria-pressed="item.fadeOutMs > 0" title="Salida suave" aria-label="Salida suave" data-testid="item-fade-out" @click="fade('out')">
        <AppIcon name="fade-out" />
        <span class="txt fade-txt">Salida suave</span>
      </button>
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
.hint {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  line-height: 1.25;
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
