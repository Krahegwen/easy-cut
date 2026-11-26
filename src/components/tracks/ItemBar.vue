<script setup lang="ts">
// Lo que se puede hacer con el sonido o el efecto elegido: volumen, cómo aparece y desaparece, repetir, y en los
// efectos «Tamaño y sitio», «Cómo se mezcla» y «Transparencia»; además mover a la línea, partir, duplicar y
// quitar. Todo con botón y con su tecla dibujada (los arrastres de las pistas tienen siempre esta alternativa).
// Siempre en una sola línea: cuando no hay sitio, los botones menos usados se quedan en icono y tecla (con su
// nombre al pasar el ratón), para que la vista previa no se quede sin altura.
// Un collage lleva además «Huecos» (llenar, intercambiar, encuadre y sonido de cada hueco sobre la vista previa),
// «Distribución» y «Separación»; no tiene «Cómo se mezcla», volumen propio ni «Repetir».
import { computed, ref } from 'vue'
import {
  ASPECT_VALUES,
  cellCanPan,
  cellContentLayout,
  cellRects,
  COLLAGE_GAPS,
  GAP_LABELS,
  layoutById,
  layoutsFor,
  MAX_CELL_VOLUME,
  PAN_STEP,
  type CollageGap,
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
import LayoutIcon from '../LayoutIcon.vue'

const props = defineProps<{ playheadMs: number }>()
const emit = defineEmits<{ seek: [ms: number] }>()

const found = computed(() => tracks.selectedItem.value)
const item = computed(() => found.value?.item ?? null)
/** «El vídeo de este trozo»: va con su trozo (solo tamaño y sitio, a una esquina y quitarlo). */
const ownClipId = computed(() => (item.value?.source.type === 'clip' ? item.value.source.clipId : null))
const ownClipNumber = computed(() => (ownClipId.value ? store.project.value.clips.findIndex((c) => c.id === ownClipId.value) + 1 : 0))
const cornerLabel = computed(() => (ownClipId.value && tracks.cornerMove(ownClipId.value) === 'to-full' ? 'Volver a pantalla completa aquí' : 'Llevar a una esquina aquí'))
function corner() {
  if (ownClipId.value) void tracks.cornerHere(ownClipId.value)
}
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

type Pop = 'volume' | 'mix' | 'opacity' | 'fades' | 'travel' | 'layout' | 'gap' | 'cell-volume'
const open = ref<Pop | null>(null)
function toggle(which: Pop) {
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

// ------------------------------------------------------------------ collage

const collage = computed(() => item.value?.collage ?? null)
const isCollage = computed(() => !!collage.value)
const aspect = computed(() => ASPECT_VALUES[store.project.value.aspect])
const cellIndex = computed(() => Math.min(tracks.pickedCell.value, (collage.value?.cells.length ?? 1) - 1))
const cell = computed(() => collage.value?.cells[cellIndex.value] ?? null)
const cellName = computed(() => (cell.value?.source ? (cell.value.source.path.split(/[\\/]/).pop() ?? '') : ''))
const sameCount = computed(() => (collage.value ? layoutsFor(collage.value.cells.length) : []))
const better = computed(() => (item.value && collage.value ? tracks.betterLayout(item.value.id) : null))
const cellVolumePercent = computed(() => Math.round((cell.value?.volume ?? 1) * 100))
/** ¿Sobra imagen para mover el encuadre del hueco elegido (con «Llenar»)? En la forma del marco. */
const pan = computed(() => {
  const c = collage.value
  const x = cell.value
  if (!c || !x?.source || x.fit !== 'fill') return { x: false, y: false }
  const layout = layoutById(c.layoutId)
  const m = store.media.value[x.source.path]
  if (!layout || !m) return { x: false, y: false }
  const r = cellRects(layout, 1920, 1920 / aspect.value, c.gap)[cellIndex.value]!
  return cellCanPan(cellContentLayout(x, m.width, m.height, r.width, r.height), r.width, r.height)
})
const cellsHint = computed(() => {
  const x = cell.value
  const n = cellIndex.value + 1
  if (!x?.source) return `Hueco ${n}: vacío. Suelta aquí un vídeo o pulsa «Elegir vídeo». Arrastra un hueco sobre otro para cambiarlos de sitio.`
  const sound = !x.source.hasAudio ? 'no tiene sonido' : x.muted ? 'silenciado' : 'con sonido'
  return `Hueco ${n}: «${cellName.value}», ${x.fit === 'fill' ? 'llenando el hueco' : 'entero'}, ${sound}. Arrastra un hueco sobre otro para cambiarlos de sitio${x.fit === 'fill' ? '; dentro de él, para mover el encuadre' : ''}.`
})

function cellsEdit() {
  open.value = null
  tracks.boxEditing.value = false
  tracks.cellsEditing.value = !tracks.cellsEditing.value
}
function doneCells() {
  open.value = null
  tracks.cellsEditing.value = false
}
function pickCell(i: number) {
  if (collage.value && i < collage.value.cells.length) tracks.pickedCell.value = i
}
function moveCell(dir: -1 | 1) {
  const c = collage.value
  const i = cellIndex.value
  if (!item.value || !c) return
  const j = i + dir
  if (j < 0 || j >= c.cells.length) return
  tracks.swapCollageCells(item.value.id, i, j)
}
function chooseCell() {
  if (item.value) void tracks.pickCellVideo(item.value.id, cellIndex.value)
}
function toggleFit() {
  if (item.value && cell.value?.source) tracks.setCollageCellFit(item.value.id, cellIndex.value, cell.value.fit === 'fill' ? 'whole' : 'fill')
}
function toggleCellMuted() {
  if (item.value && cell.value?.source?.hasAudio) tracks.setCollageCellMuted(item.value.id, cellIndex.value, !cell.value.muted)
}
function clearCell() {
  if (item.value && cell.value?.source) tracks.clearCollageCell(item.value.id, cellIndex.value)
}
function panCell(dx: number, dy: number) {
  if (item.value) tracks.panCollageCell(item.value.id, cellIndex.value, dx * PAN_STEP, dy * PAN_STEP)
}
function onCellVolume(e: Event) {
  if (item.value) tracks.previewCollageCellVolume(item.value.id, cellIndex.value, Number((e.target as HTMLInputElement).value) / 100)
}
function stepCellVolume(delta: number) {
  if (item.value && cell.value) tracks.setCollageCellVolume(item.value.id, cellIndex.value, Math.round((cell.value.volume + delta) * 10) / 10)
}
function setLayout(layoutId: string, order?: number[]) {
  if (item.value) tracks.setCollageLayout(item.value.id, layoutId, order)
  open.value = null
}
function setGap(gap: CollageGap) {
  if (item.value) tracks.setCollageGap(item.value.id, gap)
  open.value = null
}

// «Huecos»: elegir, mover, poner, llenar o entero, sonido, vaciar; Esc o Intro lo dejan.
useShortcuts({
  id: 'collage-cells',
  title: 'Huecos del collage',
  priority: LAYER_PRIORITY.overlay,
  active: () => tracks.cellsEditing.value && isCollage.value,
  shortcuts: () => {
    const n = collage.value?.cells.length ?? 0
    return [
      ...Array.from({ length: n }, (_, i) => ({ id: `cell-${i + 1}`, keys: [String(i + 1)], label: String(i + 1), description: `elegir el hueco ${i + 1}`, run: () => pickCell(i) })),
      { id: 'cell-left', keys: ['ArrowLeft'], label: '←', description: 'cambiar el hueco elegido de sitio con el anterior', run: () => moveCell(-1), enabled: cellIndex.value > 0 },
      { id: 'cell-right', keys: ['ArrowRight'], label: '→', description: 'cambiar el hueco elegido de sitio con el siguiente', run: () => moveCell(1), enabled: cellIndex.value < n - 1 },
      { id: 'cell-choose', keys: ['v'], label: 'V', description: 'elegir el vídeo del hueco', run: chooseCell },
      // Siempre activas en «Huecos» (vacías no hacen nada): así no caen a las de la pista (L, marca siguiente; Supr, quitar el collage).
      { id: 'cell-fit', keys: ['l'], label: 'L', description: '«Llenar el hueco» o «Entero»', run: toggleFit },
      { id: 'cell-mute', keys: ['s'], label: 'S', description: 'silenciar el hueco o que tenga sonido', run: toggleCellMuted, enabled: !!cell.value?.source?.hasAudio },
      { id: 'cell-clear', keys: ['Delete'], label: 'Supr', description: 'vaciar el hueco (se puede deshacer)', run: clearCell },
      { id: 'cells-done', keys: ['Escape', 'Enter'], label: 'Esc', description: 'dejar «Huecos»', run: doneCells },
    ]
  },
})

// El volumen del hueco: ← → mientras está abierto.
useShortcuts({
  id: 'cell-volume-popover',
  title: 'Volumen del hueco',
  priority: LAYER_PRIORITY.popover,
  active: () => open.value === 'cell-volume',
  shortcuts: () => [
    { id: 'cell-volume-close', keys: ['Escape'], label: 'Esc', description: 'cerrar', run: () => (open.value = null) },
    { id: 'cell-volume-down', keys: ['ArrowLeft', 'ArrowDown'], label: '←', description: 'más bajo', run: () => stepCellVolume(-0.1), repeat: true },
    { id: 'cell-volume-up', keys: ['ArrowRight', 'ArrowUp'], label: '→', description: 'más alto', run: () => stepCellVolume(0.1), repeat: true },
  ],
})

defineExpose({ moveHere, split, duplicate, remove, repeat })
</script>

<template>
  <div v-if="item && found" class="item-bar-host" data-testid="item-bar">
    <!-- «Huecos» de un collage: el hueco elegido y lo que se puede hacer con él (lo mismo que arrastrando). -->
    <div v-if="tracks.cellsEditing.value && collage" class="item-bar box-mode cells-mode" data-testid="cells-bar" :data-cell="cellIndex">
      <AppIcon name="collage" :size="22" />
      <span class="hint" :title="cellsHint"><strong>Huecos:</strong> <span data-testid="cells-hint">{{ cellsHint }}</span></span>
      <span class="cell-picks" role="radiogroup" aria-label="Hueco elegido">
        <button
          v-for="(c, i) in collage.cells"
          :key="i"
          class="btn small cell-pick"
          :class="{ on: i === cellIndex }"
          type="button"
          role="radio"
          :aria-checked="i === cellIndex"
          :aria-label="`Hueco ${i + 1}`"
          :data-testid="`cell-pick-${i}`"
          @click="pickCell(i)"
        >
          {{ i + 1 }}
        </button>
      </span>
      <button class="btn small" type="button" :disabled="cellIndex === 0" title="Cambiarlo de sitio con el anterior" aria-label="Cambiarlo con el anterior" data-testid="cell-left" @click="moveCell(-1)">
        <AppIcon name="arrow-left" />
        <KeyHint k="←" />
      </button>
      <button class="btn small" type="button" :disabled="cellIndex >= collage.cells.length - 1" title="Cambiarlo de sitio con el siguiente" aria-label="Cambiarlo con el siguiente" data-testid="cell-right" @click="moveCell(1)">
        <AppIcon name="arrow-right" />
        <KeyHint k="→" />
      </button>
      <button class="btn small" type="button" :title="cell?.source ? 'Cambiar el vídeo de este hueco' : 'Elegir el vídeo de este hueco'" aria-label="Elegir vídeo" data-testid="cell-choose" @click="chooseCell">
        <AppIcon name="folder" />
        <span class="txt">{{ cell?.source ? 'Cambiar vídeo' : 'Elegir vídeo' }}</span>
        <KeyHint k="V" />
      </button>
      <template v-if="cell?.source">
        <button class="btn small" type="button" :title="cell.fit === 'fill' ? 'Ahora llena el hueco (recorta lo que sobra): pasar a «Entero»' : 'Ahora se ve entero (con bandas): pasar a «Llenar el hueco»'" :aria-label="cell.fit === 'fill' ? 'Llenar el hueco' : 'Entero'" data-testid="cell-fit" :data-fit="cell.fit" @click="toggleFit">
          <AppIcon :name="cell.fit === 'fill' ? 'fit-fill' : 'fit-whole'" />
          <span class="txt">{{ cell.fit === 'fill' ? 'Llenar el hueco' : 'Entero' }}</span>
          <KeyHint k="L" />
        </button>
        <template v-if="pan.x || pan.y">
          <button v-if="pan.x" class="btn small" type="button" title="Enseñar más de la izquierda" aria-label="Mover el encuadre a la izquierda" data-testid="cell-pan-left" @click="panCell(-1, 0)"><AppIcon name="arrow-left" /></button>
          <button v-if="pan.x" class="btn small" type="button" title="Enseñar más de la derecha" aria-label="Mover el encuadre a la derecha" data-testid="cell-pan-right" @click="panCell(1, 0)"><AppIcon name="arrow-right" /></button>
          <button v-if="pan.y" class="btn small" type="button" title="Enseñar más de arriba" aria-label="Mover el encuadre hacia arriba" data-testid="cell-pan-up" @click="panCell(0, -1)"><AppIcon name="up" /></button>
          <button v-if="pan.y" class="btn small" type="button" title="Enseñar más de abajo" aria-label="Mover el encuadre hacia abajo" data-testid="cell-pan-down" @click="panCell(0, 1)"><AppIcon name="down" /></button>
        </template>
        <template v-if="cell.source.hasAudio">
          <button class="btn small toggle" :class="{ selected: cell.muted }" type="button" :aria-pressed="cell.muted" :aria-label="cell.muted ? 'Con sonido' : 'Silenciar'" :title="cell.muted ? 'Ahora está silenciado: que suene' : 'Ahora suena: silenciarlo'" data-testid="cell-mute" @click="toggleCellMuted">
            <AppIcon :name="cell.muted ? 'mute' : 'sound'" />
            <span class="txt">{{ cell.muted ? 'Con sonido' : 'Silenciar' }}</span>
            <KeyHint k="S" />
          </button>
          <div v-if="!cell.muted" class="pop-wrap">
            <button class="btn small" type="button" data-testid="cell-volume" :aria-expanded="open === 'cell-volume'" title="Volumen de este hueco" aria-label="Volumen del hueco" @click="toggle('cell-volume')">
              <span class="value">{{ cellVolumePercent }} %</span>
            </button>
            <div v-if="open === 'cell-volume'" class="popover card" data-testid="cell-volume-popover">
              <h3>Volumen del hueco {{ cellIndex + 1 }}</h3>
              <div class="slider">
                <span>Más bajo</span>
                <input type="range" min="0" :max="MAX_CELL_VOLUME * 100" step="5" :value="cellVolumePercent" aria-label="Volumen del hueco" data-testid="cell-volume-slider" @input="onCellVolume" @change="commitSlider" />
                <span>Más alto</span>
              </div>
              <p class="muted note">{{ cellVolumePercent }} % · 100 % es como viene.</p>
            </div>
          </div>
        </template>
        <span v-else class="no-sound muted" data-testid="cell-no-sound-note"><AppIcon name="mute" :size="18" /> Sin sonido</span>
        <button class="btn small" type="button" title="Vaciar el hueco" aria-label="Vaciar el hueco" data-testid="cell-clear" @click="clearCell">
          <AppIcon name="trash" />
          <span class="txt">Vaciar</span>
          <KeyHint k="Supr" />
        </button>
      </template>
      <button class="btn small primary" type="button" data-testid="cells-done" @click="doneCells">
        <AppIcon name="check" />
        Listo
        <KeyHint k="Esc" />
      </button>
    </div>

    <!-- «Tamaño y sitio»: la barra explica qué hacer en la vista previa y cómo acabar. -->
    <div v-else-if="tracks.boxEditing.value" class="item-bar box-mode" data-testid="box-hint">
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
        <AppIcon :name="isCollage ? 'collage' : isEffect ? 'light' : 'sound'" :size="22" />
        <span class="name" :title="`${item.name} (en «${found.track.name}»)`">{{ ownClipId ? `Tu vídeo (trozo ${ownClipNumber})` : item.name }}</span>
        <span class="where muted">en «{{ found.track.name }}»</span>
      </div>

      <template v-if="isCollage && collage">
        <button class="btn small" type="button" data-testid="item-cells" title="Poner y cambiar los vídeos de los huecos" aria-label="Huecos" @click="cellsEdit">
          <AppIcon name="collage" />
          <span class="txt">Huecos</span>
        </button>
        <div class="pop-wrap">
          <button class="btn small" type="button" data-testid="item-layout" :aria-expanded="open === 'layout'" title="Cómo se reparten los vídeos" aria-label="Distribución" @click="toggle('layout')">
            <LayoutIcon :layout-id="collage.layoutId" :aspect="aspect" :width="40" />
            <span class="txt">Distribución</span>
          </button>
          <div v-if="open === 'layout'" class="popover card layout-pop" data-testid="layout-popover">
            <h3>Cómo se reparten</h3>
            <button
              v-for="l in sameCount"
              :key="l.id"
              class="choice row"
              :class="{ on: collage.layoutId === l.id }"
              type="button"
              :data-testid="`layout-${l.id}`"
              @click="setLayout(l.id, better?.layoutId === l.id ? better.order : undefined)"
            >
              <LayoutIcon :layout-id="l.id" :aspect="aspect" :width="64" numbers />
              <span class="choice-text">
                <strong>{{ l.name }}</strong>
                <span v-if="better?.layoutId === l.id" class="suggest" data-testid="layout-suggested">Te propongo esta: encaja con la forma de tus vídeos</span>
              </span>
            </button>
          </div>
        </div>
        <div class="pop-wrap">
          <button class="btn small" type="button" data-testid="item-gap" :aria-expanded="open === 'gap'" title="La raya entre los huecos" aria-label="Separación" @click="toggle('gap')">
            <span class="gap-swatch" :class="collage.gap" aria-hidden="true" />
            <span class="txt">Separación</span>
          </button>
          <div v-if="open === 'gap'" class="popover card" data-testid="gap-popover">
            <h3>Entre los huecos</h3>
            <button v-for="g in COLLAGE_GAPS" :key="g" class="choice row" :class="{ on: collage.gap === g }" type="button" :data-testid="`gap-${g}`" @click="setGap(g)">
              <span class="gap-swatch big" :class="g" aria-hidden="true" />
              <strong>{{ GAP_LABELS[g] }}</strong>
            </button>
          </div>
        </div>
      </template>

      <template v-if="isEffect">
        <button class="btn small" type="button" data-testid="item-box" :title="moving ? 'Tamaño y sitio (se mueve con marcas)' : 'Tamaño y sitio'" aria-label="Tamaño y sitio" @click="boxEdit">
          <AppIcon :name="moving ? 'motion' : 'resize'" />
          <span class="txt">Tamaño y sitio</span>
        </button>
        <button v-if="ownClipId" class="btn small" type="button" :aria-label="cornerLabel" :title="cornerLabel" data-testid="item-corner" @click="corner">
          <AppIcon :name="cornerLabel.startsWith('Volver') ? 'fullscreen' : 'corner'" />
          <span class="txt">{{ cornerLabel.startsWith('Volver') ? 'Pantalla completa' : 'A una esquina' }}</span>
          <KeyHint k="Q" />
        </button>
        <div v-if="!ownClipId && !isCollage" class="pop-wrap">
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
        <div v-if="!ownClipId" class="pop-wrap">
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

      <div v-if="!ownClipId" class="pop-wrap">
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
      <button v-if="!item.still && !ownClipId && !isCollage" class="btn small toggle" :class="{ selected: item.repeat }" type="button" :aria-pressed="item.repeat" title="Repetir" aria-label="Repetir" data-testid="item-repeat" @click="repeat">
        <AppIcon name="repeat" />
        <span class="txt">Repetir</span>
        <KeyHint k="R" />
      </button>

      <span class="spacer" />
      <p v-if="ownClipId" class="own-note muted" data-testid="item-own-note">Va con su trozo: se recorta, se parte y se mueve con él.</p>
      <template v-if="!ownClipId">
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
      </template>
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
.cell-picks {
  display: inline-flex;
  gap: 4px;
}
.cell-pick {
  width: 40px;
  padding: 0 !important;
  justify-content: center;
  font-weight: 700;
}
.cell-pick.on {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
.no-sound {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 15px;
  white-space: nowrap;
}
.gap-swatch {
  display: inline-block;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1.5px solid var(--border);
  background:
    linear-gradient(90deg, #8fb3cc 0 40%, var(--sw) 40% 60%, #8fb3cc 60%);
}
.gap-swatch.big {
  width: 44px;
  height: 30px;
}
.gap-swatch.dark {
  --sw: #1c2229;
}
.gap-swatch.white {
  --sw: #fff;
}
.gap-swatch.none {
  --sw: #8fb3cc;
}
.layout-pop {
  width: 400px;
  gap: 6px;
  max-height: calc(100vh - 160px);
  overflow: auto;
}
.suggest {
  color: var(--accent) !important;
  font-weight: 600;
}
.own-note {
  font-size: 14px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
