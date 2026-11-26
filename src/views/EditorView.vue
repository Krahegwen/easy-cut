<script setup lang="ts">
// «Tu vídeo»: arriba, la vista previa del montaje con la columna derecha (forma, «Añadir sonidos y efectos» y,
// al abrirla, la biblioteca); un divisor (arrastrable o con tres tamaños fijos, que se recuerda) y, abajo, a
// todo el ancho, la barra de lo elegido (un trozo o un sonido o efecto) y la vista de pistas, con la fila
// «Vídeo» de los trozos. La duración máxima y «Guardar el vídeo», arriba del todo.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import type { IconName } from '../components/icons'
import DurationBar from '../components/DurationBar.vue'
import PreviewPlayer from '../components/PreviewPlayer.vue'
import TargetPicker from '../components/TargetPicker.vue'
import UndoRedo from '../components/UndoRedo.vue'
import UpdateNotice from '../components/UpdateNotice.vue'
import ItemBar from '../components/tracks/ItemBar.vue'
import LibraryPanel from '../components/tracks/LibraryPanel.vue'
import TracksView from '../components/tracks/TracksView.vue'
import type { PlayerTime } from '../components/player-types'
import { clipDurationMs, clipStartTimes, formatDuration, isTrackMediaPath, neighbourMark, removeCover, resolveTracks, setAspect, setClipFade, type AspectRatio, type Easing } from '../domain'
import FadePicker from '../components/FadePicker.vue'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import { pasteFromClipboard, pickAndAddVideos } from '../lib/add-videos'
import { reapplyPauses } from '../lib/pauses'
import { fractionFor, loadSplit, nearestPreset, saveSplit, SPLIT_PRESETS, topHeightPx, type SplitPreset } from '../lib/preview-split'
import { useShortcuts } from '../lib/use-shortcuts'
import { library, store, tracks } from '../store'

const player = ref<InstanceType<typeof PreviewPlayer> | null>(null)
const tracksView = ref<InstanceType<typeof TracksView> | null>(null)
const item = computed(() => tracks.selectedItem.value)

function onTime(t: PlayerTime) {
  tracks.playheadMs.value = t.projectMs
}

function seek(ms: number) {
  player.value?.seek(ms)
}

function openLibrary() {
  player.value?.pause()
  tracks.openLibrary()
}

/** Elemento elegido con su tiempo (para las teclas que dependen de dónde está la línea). */
const itemTimes = computed(() => (item.value ? resolveTracks(store.project.value).find((r) => r.item.id === item.value!.item.id) ?? null : null))

const shapes: { id: AspectRatio; icon: IconName; label: string; hint: string }[] = [
  { id: '16:9', icon: 'horizontal', label: 'Horizontal', hint: 'Para la tele y el ordenador' },
  { id: '9:16', icon: 'vertical', label: 'Vertical', hint: 'Para el móvil' },
  { id: '1:1', icon: 'square', label: 'Cuadrado', hint: 'Para redes sociales' },
]

const clip = computed(() => store.selectedClip.value)
const index = computed(() => store.selectedIndex.value)
const count = computed(() => store.project.value.clips.length)
const clipMissing = computed(() => !!clip.value && !!store.missing.value[clip.value.sourcePath])
const clipCoverMissing = computed(() => !!clip.value && !clipMissing.value && store.coverMissing(clip.value))

/** Quita el vídeo de encima que no se encuentra, sin perder el trozo. */
function dropLostCover() {
  const c = clip.value
  if (c) store.apply((p) => removeCover(p, c.id))
}
const missingCount = computed(() => store.project.value.clips.filter((c) => store.missing.value[c.sourcePath]).length)

function setShape(a: AspectRatio) {
  store.apply((p) => setAspect(p, a))
}

function save() {
  if (store.hasMissing.value) {
    store.showToast('Antes de guardar, busca («Buscarlo») o quita los trozos, vídeos de encima o sonidos que no encuentro.')
    return
  }
  player.value?.pause()
  store.go('save')
}

const offerClip = computed(() => {
  const id = store.recordingOffer.value
  return id ? store.project.value.clips.find((c) => c.id === id) ?? null : null
})
const offerIndex = computed(() => (offerClip.value ? store.project.value.clips.indexOf(offerClip.value) : -1))

function removeRecordingPauses() {
  const c = offerClip.value
  if (!c) return
  player.value?.pause()
  store.openClipEditor(c.id, { tab: 'pauses', findPauses: true })
}

function record() {
  player.value?.pause()
  store.go('teleprompter')
}

function addMore() {
  player.value?.pause()
  void pickAndAddVideos()
}

function fix() {
  if (!clip.value) return
  player.value?.pause()
  store.openClipEditor(clip.value.id)
}

// Al elegir un trozo, la vista previa salta a su principio (si no está sonando).
watch(
  () => store.selectedClipId.value,
  (id) => {
    if (!id || !player.value || player.value.playing) return
    const playable = store.playableProject.value
    const i = playable.clips.findIndex((c) => c.id === id)
    if (i >= 0) player.value.seek(clipStartTimes(playable)[i] ?? 0)
  },
)

// ------------------------------------------------------------------ el trozo elegido y la línea

/** Dónde empieza y acaba en el vídeo el trozo elegido. */
const clipTimes = computed(() => {
  const i = index.value
  if (i < 0) return null
  const start = clipStartTimes(store.project.value)[i] ?? 0
  return { start, end: start + clipDurationMs(store.project.value.clips[i]!) }
})
/** ¿La línea está dentro del trozo elegido (no en sus bordes)? E, T y P solo valen entonces. */
const lineInClip = computed(() => {
  const t = clipTimes.value
  const at = tracks.playheadMs.value
  return !!t && at > t.start + 200 && at < t.end - 200
})
const lineHint = computed(() => (lineInClip.value ? '' : ` (pon la línea dentro del trozo ${index.value + 1})`))

function clipStartHere() {
  const c = clip.value
  if (!c) return
  const start = clipTimes.value?.start ?? 0
  if (tracks.trimClipAt(c.id, 'start', tracks.playheadMs.value, (p) => reapplyPauses(p, c.id))) seek(start)
}
function clipEndHere() {
  const c = clip.value
  if (c) tracks.trimClipAt(c.id, 'end', tracks.playheadMs.value, (p) => reapplyPauses(p, c.id))
}
function clipSplitHere() {
  const c = clip.value
  if (c) tracks.splitClipAt(c.id, tracks.playheadMs.value)
}

// ------------------------------------------------------------------ aparecer y desaparecer del trozo

const clipFadesOpen = ref(false)
watch(() => clip.value?.id, () => (clipFadesOpen.value = false))
function setFadeOfClip(which: 'in' | 'out', fade: { ms: number; easing: Easing }) {
  const c = clip.value
  if (c) store.apply((p) => setClipFade(p, c.id, which, fade))
}
const clipFadeOn = computed(() => !!clip.value && (clip.value.fadeInMs > 0 || clip.value.fadeOutMs > 0))
useShortcuts({
  id: 'clip-fades',
  title: 'Aparecer y desaparecer',
  priority: LAYER_PRIORITY.popover,
  active: () => clipFadesOpen.value,
  shortcuts: () => [{ id: 'clip-fades-close', keys: ['Escape'], label: 'Esc', description: 'cerrar', run: () => (clipFadesOpen.value = false) }],
})

// ------------------------------------------------------------------ el vídeo del trozo, a una esquina

/** Solo con imagen propia y la línea en el trozo. */
const canCorner = computed(() => !!clip.value && clip.value.sourceHasVideo && !clipMissing.value && !!clipTimes.value && tracks.playheadMs.value >= clipTimes.value.start && tracks.playheadMs.value <= clipTimes.value.end)
const cornerLabel = computed(() => (clip.value && tracks.cornerMove(clip.value.id) === 'to-full' ? 'Volver a pantalla completa aquí' : 'Llevar a una esquina aquí'))
function cornerHere() {
  const c = clip.value
  if (!c) return
  player.value?.pause()
  void tracks.cornerHere(c.id)
}

// ------------------------------------------------------------------ marcas de tamaño y sitio

function goMark(itemId: string, dir: -1 | 1) {
  const ms = tracks.neighbourMarkMs(itemId, dir)
  if (ms !== null) seek(ms)
}
/** ¿Hay una marca antes (−1) o después (+1) de la línea en el efecto elegido? */
function hasMarks(dir: -1 | 1): boolean {
  const r = itemTimes.value
  const look = r?.item.look
  if (!r || !look) return false
  return !!neighbourMark(look, tracks.playheadMs.value - r.startMs, dir, r.shownEndMs - r.startMs)
}

// ------------------------------------------------------------------ copiar y pegar

const canFix = computed(() => !!clip.value && !clipMissing.value)

function copySelected() {
  if (clip.value) void store.copyClip(clip.value.id)
}

/**
 * Ctrl+V: con la biblioteca abierta o un sonido o efecto elegido, los ficheros copiados en el Explorador van a
 * las pistas, donde está la línea; si no, como siempre (al final, como trozos, o el trozo copiado).
 */
async function paste() {
  player.value?.pause()
  if (item.value || tracks.libraryOpen.value) {
    const source = await store.pasteSource()
    if (source.kind === 'files' || source.kind === 'not-media') {
      const sys = store.systemClipboard.value
      const paths = sys ? sys.paths.filter(isTrackMediaPath) : []
      if (paths.length) {
        await tracks.addFiles(paths, tracks.playheadMs.value)
        return
      }
    }
  }
  void pasteFromClipboard()
}

/** Trozo anterior o siguiente (RePág / AvPág). */
function selectBy(delta: number) {
  const clips = store.project.value.clips
  if (clips.length === 0) return
  const i = index.value < 0 ? 0 : Math.min(clips.length - 1, Math.max(0, index.value + delta))
  store.select(clips[i]!.id)
}

// El portapapeles del sistema puede cambiar en cualquier momento (se copia algo en el Explorador): se mira
// al volver a la ventana y cada poco (es barato: solo el número de secuencia), para activar «Pegar».
let clipboardTimer = 0
const onWindowFocus = () => void store.refreshSystemClipboard()

// ------------------------------------------------------------------ divisor entre vista previa y pistas

const work = ref<HTMLElement | null>(null)
const workHeight = ref(600)
const SPLITTER_PX = 26
const split = ref(loadSplit())
const available = computed(() => Math.max(0, workHeight.value - SPLITTER_PX))
const topPx = computed(() => topHeightPx(split.value, available.value, { library: tracks.libraryOpen.value }))
const preset = computed(() => nearestPreset(split.value))
const presets: { id: SplitPreset; label: string }[] = [
  { id: 'small', label: 'Pequeña' },
  { id: 'medium', label: 'Mediana' },
  { id: 'large', label: 'Grande' },
]

function setPreset(id: SplitPreset) {
  split.value = SPLIT_PRESETS[id]
  saveSplit(split.value)
}

let splitDrag: { offset: number } | null = null
function splitterDown(e: PointerEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
  e.preventDefault()
  const host = work.value
  if (!host) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  // Lo que hay entre el puntero y el borde de arriba del divisor (para que no salte al agarrarlo).
  splitDrag = { offset: e.clientY - (host.getBoundingClientRect().top + topPx.value) }
}
function splitterMove(e: PointerEvent) {
  const host = work.value
  if (!splitDrag || !host) return
  split.value = fractionFor(e.clientY - host.getBoundingClientRect().top - splitDrag.offset, available.value)
}
function splitterUp() {
  if (!splitDrag) return
  splitDrag = null
  saveSplit(split.value)
}

let workObserver: ResizeObserver | null = null

// ------------------------------------------------------------------ teclas

const playing = computed(() => !!player.value?.playing)

useShortcuts({
  id: 'editor',
  title: 'Tu vídeo',
  shortcuts: () => {
    const p = player.value
    const has = count.value > 0
    const it = item.value
    const at = tracks.playheadMs.value
    const r = itemTimes.value
    const inside = !!r && at > r.startMs + 300 && at < r.shownEndMs - 300
    const tv = tracksView.value
    // Con un sonido o un efecto elegido, sus teclas van antes que las del trozo. «El vídeo de este trozo» va con su
    // trozo: ni se mueve, ni se recorta, ni se parte, ni se duplica, ni repite por su cuenta.
    const own = !!it && it.item.source.type === 'clip'
    const ownClipId = it && it.item.source.type === 'clip' ? it.item.source.clipId : null
    const itemKeys = it
      ? [
          { id: 'item-deselect', keys: ['Escape'], label: 'Esc', description: 'dejar de elegir el sonido o efecto', run: () => tracks.select(null), enabled: !playing.value },
          { id: 'item-remove', keys: ['Delete'], label: 'Supr', description: 'quitar el sonido o efecto elegido (se puede deshacer)', run: () => tracks.remove(it.item.id) },
          { id: 'item-split', keys: ['p'], label: 'P', description: 'partir el elegido donde está la línea', run: () => tracks.split(it.item.id, at), enabled: inside && !own },
          { id: 'item-duplicate', keys: ['d'], label: 'D', description: 'duplicar el elegido (justo detrás)', run: () => tracks.duplicate(it.item.id), enabled: !own },
          { id: 'item-move-here', keys: ['m'], label: 'M', description: 'que el elegido empiece donde está la línea', run: () => tracks.moveTo(it.item.id, at), enabled: !own },
          { id: 'item-trim-start', keys: ['e'], label: 'E', description: 'que el elegido empiece en la línea (recorta o alarga por delante)', run: () => tracks.trimAt(it.item.id, 'start', at), enabled: !!r && at < r.endMs - 300 && !own },
          { id: 'item-trim-end', keys: ['t'], label: 'T', description: 'que el elegido termine en la línea', run: () => tracks.trimAt(it.item.id, 'end', at), enabled: !!r && at > r.startMs + 300 && !own },
          { id: 'item-repeat', keys: ['r'], label: 'R', description: 'repetir el elegido (o dejar de repetirlo)', run: () => tracks.setRepeat(it.item.id, !it.item.repeat), enabled: !it.item.still && !own },
          ...(ownClipId
            ? [{ id: 'item-corner', keys: ['q'], label: 'Q', description: 'llevar tu vídeo a una esquina en la línea (o volver a pantalla completa)', run: () => void tracks.cornerHere(ownClipId) }]
            : []),
          { id: 'item-up', keys: ['ArrowUp'], label: '↑', description: 'pasar el elegido a la pista de arriba', run: () => tracks.moveToNeighbourTrack(it.item.id, -1) },
          { id: 'item-down', keys: ['ArrowDown'], label: '↓', description: 'pasar el elegido a la pista de abajo', run: () => tracks.moveToNeighbourTrack(it.item.id, 1) },
          // Marcas de tamaño y sitio (solo en los efectos).
          ...(it.track.kind === 'effect'
            ? [
                { id: 'mark-toggle', keys: ['k'], label: 'K', description: 'marcar el tamaño y sitio en la línea (o quitar la marca que hay ahí)', run: () => tracks.toggleMarkHere(it.item.id) },
                { id: 'mark-prev', keys: ['j'], label: 'J', description: 'ir a la marca anterior del elegido', run: () => goMark(it.item.id, -1), enabled: hasMarks(-1) },
                { id: 'mark-next', keys: ['l'], label: 'L', description: 'ir a la marca siguiente del elegido', run: () => goMark(it.item.id, 1), enabled: hasMarks(1) },
                { id: 'mark-move', keys: ['n'], label: 'N', description: 'llevar la marca elegida (en amarillo) a la línea', run: () => tracks.movePickedMarkHere(it.item.id), enabled: tracks.pickedMark.value?.itemId === it.item.id },
              ]
            : []),
        ]
      : []
    // Sin sonido ni efecto elegido, E, T y P actúan sobre el trozo elegido (la barra de abajo dice cuál).
    const c = clip.value
    const clipKeys =
      !it && c && !clipMissing.value
        ? [
            { id: 'clip-trim-start', keys: ['e'], label: 'E', description: 'que el trozo elegido empiece en la línea', run: clipStartHere, enabled: lineInClip.value },
            { id: 'clip-trim-end', keys: ['t'], label: 'T', description: 'que el trozo elegido termine en la línea', run: clipEndHere, enabled: lineInClip.value },
            { id: 'clip-split', keys: ['p'], label: 'P', description: 'partir el trozo elegido en la línea', run: clipSplitHere, enabled: lineInClip.value },
            { id: 'clip-corner', keys: ['q'], label: 'Q', description: 'llevar el vídeo del trozo a una esquina en la línea (o volver a pantalla completa)', run: cornerHere, enabled: canCorner.value },
          ]
        : []
    return [
      { id: 'play', keys: ['Space'], label: 'Espacio', description: 'reproducir o parar', run: () => p?.toggle(), enabled: has },
      { id: 'stop', keys: ['Escape'], label: 'Esc', description: 'parar y volver al principio', run: () => (p?.pause(), p?.seek(0)), enabled: playing.value },
      ...itemKeys,
      ...clipKeys,
      { id: 'back', keys: ['Escape'], label: 'Esc', description: 'volver a Inicio (tu vídeo no se pierde)', run: () => store.go('home') },
      // Pantalla completa de la vista previa (en «Tamaño y sitio» la F es suya: esa capa va antes).
      { id: 'fullscreen', keys: ['f'], label: 'F', description: 'ver la vista previa a pantalla completa', run: () => p?.toggleFullscreen(), enabled: has },
      { id: 'library', keys: ['b'], label: 'B', description: 'añadir sonidos y efectos (biblioteca)', run: openLibrary, enabled: has },
      { id: 'zoom-in', keys: ['+'], label: '+', description: 'acercar las pistas', run: () => tv?.zoomBy(1), enabled: has, repeat: true },
      { id: 'zoom-out', keys: ['-'], label: '-', description: 'alejar las pistas', run: () => tv?.zoomBy(-1), enabled: has, repeat: true },
      { id: 'go-start', keys: ['Home'], label: 'Inicio', description: 'ir al principio', run: () => p?.seek(0), enabled: has },
      { id: 'go-end', keys: ['End'], label: 'Fin', description: 'ir al final', run: () => p?.seek(p.durationMs), enabled: has },
      { id: 'back-1s', keys: ['ArrowLeft'], label: '←', description: '1 segundo atrás', run: () => p?.seek(p.currentMs - 1000), enabled: has, repeat: true },
      { id: 'forward-1s', keys: ['ArrowRight'], label: '→', description: '1 segundo adelante', run: () => p?.seek(p.currentMs + 1000), enabled: has, repeat: true },
      { id: 'prev-clip', keys: ['PageUp'], label: 'RePág', description: 'elegir el trozo anterior', run: () => selectBy(-1), enabled: has, repeat: true },
      { id: 'next-clip', keys: ['PageDown'], label: 'AvPág', description: 'elegir el trozo siguiente', run: () => selectBy(1), enabled: has, repeat: true },
      { id: 'fix', keys: ['a'], label: 'A', description: 'arreglar el trozo elegido', run: fix, enabled: canFix.value },
      { id: 'remove', keys: ['Delete'], label: 'Supr', description: 'quitar el trozo elegido (se puede deshacer)', run: () => clip.value && store.removeClip(clip.value.id), enabled: !!clip.value },
      { id: 'copy', keys: ['Ctrl+c'], label: 'Ctrl C', description: 'copiar el trozo elegido', run: copySelected, enabled: !!clip.value },
      { id: 'paste', keys: ['Ctrl+v'], label: 'Ctrl V', description: 'pegar (un trozo copiado, o vídeos copiados en el Explorador)', run: paste },
      { id: 'save', keys: ['g'], label: 'G', description: 'guardar el vídeo', run: save, enabled: has },
    ]
  },
})

onMounted(() => {
  void library.refreshStatus()
  void store.refreshSystemClipboard()
  clipboardTimer = window.setInterval(() => void store.refreshSystemClipboard(), 1500)
  window.addEventListener('focus', onWindowFocus)
  workObserver = new ResizeObserver(() => {
    if (work.value) workHeight.value = work.value.clientHeight
  })
  if (work.value) {
    workObserver.observe(work.value)
    workHeight.value = work.value.clientHeight
  }
})
onBeforeUnmount(() => {
  window.clearInterval(clipboardTimer)
  window.removeEventListener('focus', onWindowFocus)
  workObserver?.disconnect()
})
</script>

<template>
  <main class="screen editor" data-testid="editor">
    <header class="topbar">
      <button class="btn quiet" type="button" data-testid="go-home" @click="store.go('home')">
        <AppIcon name="home" />
        Inicio
        <KeyHint k="Esc" />
      </button>
      <h1>Tu vídeo</h1>
      <span class="spacer" />
      <KeysButton />
      <UndoRedo />
      <button class="btn primary large save" type="button" data-testid="save-video" :disabled="count === 0" @click="save">
        <AppIcon name="save" />
        Guardar el vídeo
        <KeyHint k="G" />
      </button>
    </header>

    <DurationBar :total-ms="store.durationMs.value" :target-ms="store.project.value.targetDurationMs">
      <TargetPicker />
    </DurationBar>

    <div ref="work" class="work" :data-top-px="topPx" data-testid="editor-work">
      <div class="upper" :class="{ 'with-library': tracks.libraryOpen.value }" :style="{ height: `${topPx}px` }" data-testid="editor-upper">
        <section class="preview">
          <PreviewPlayer ref="player" :project="store.playableProject.value" tracks fullscreenable reviewable @time="onTime">
            <template #overlay>
              <div v-if="missingCount > 0" class="missing-banner">
                <AppIcon name="warning" />
                {{ missingCount === 1 ? 'Hay un trozo cuyo vídeo no encuentro: no sale aquí.' : `Hay ${missingCount} trozos cuyo vídeo no encuentro: no salen aquí.` }}
              </div>
            </template>
          </PreviewPlayer>
        </section>

        <aside v-if="!tracks.libraryOpen.value" class="side" data-testid="editor-side">
          <UpdateNotice compact />
          <section v-if="offerClip" class="panel offer" data-testid="recording-offer">
            <h2><AppIcon name="check" :size="22" /> Grabación añadida</h2>
            <p>Es el trozo {{ offerIndex + 1 }} y dura {{ formatDuration(clipDurationMs(offerClip)) }}. ¿Quito los silencios entre frase y frase?</p>
            <button class="btn primary offer-main" type="button" data-testid="offer-remove-pauses" @click="removeRecordingPauses">
              <AppIcon name="pauses" />
              Quitar las pausas de esta grabación
            </button>
            <button class="btn quiet" type="button" data-testid="offer-dismiss" @click="store.dismissRecordingOffer()">
              <AppIcon name="close" />
              Ahora no
            </button>
          </section>
          <section class="panel fx-panel" data-testid="fx-panel">
            <h2>Sonidos y efectos</h2>
            <p class="fx-hint">Música, aplausos, confeti, luces… por encima de tu vídeo.</p>
            <button class="btn add-fx" type="button" :disabled="count === 0" data-testid="add-sounds-effects" @click="openLibrary">
              <AppIcon name="library" />
              <span class="add-fx-text">Añadir sonidos y efectos</span>
              <KeyHint k="B" />
            </button>
          </section>
          <section class="panel">
            <h2>Forma del vídeo</h2>
            <div class="shapes" role="radiogroup" aria-label="Forma del vídeo">
              <button
                v-for="s in shapes"
                :key="s.id"
                class="shape"
                :class="{ selected: store.project.value.aspect === s.id }"
                type="button"
                role="radio"
                :aria-checked="store.project.value.aspect === s.id"
                :title="s.hint"
                :data-testid="`shape-${s.label.toLowerCase()}`"
                @click="setShape(s.id)"
              >
                <AppIcon :name="s.icon" :size="28" />
                <span class="shape-text">
                  <strong>{{ s.label }}</strong>
                  <span class="shape-hint">{{ s.hint }}</span>
                </span>
              </button>
            </div>
          </section>
          <p class="tip muted">
            <AppIcon name="drag" :size="20" />
            Arrastra los trozos y lo que hay en las pistas para moverlos; tira de sus bordes para recortarlos.
          </p>
        </aside>
        <LibraryPanel v-else class="side-library" :preview-playing="playing" />
      </div>

      <!-- Divisor: se arrastra, o se elige uno de los tres tamaños (nada depende solo de arrastrar). -->
      <div
        class="splitter"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Tamaño de la vista previa"
        data-testid="splitter"
        @pointerdown="splitterDown"
        @pointermove="splitterMove"
        @pointerup="splitterUp"
        @pointercancel="splitterUp"
      >
        <span class="grip" aria-hidden="true" />
        <div class="sizes" role="radiogroup" aria-label="Tamaño de la vista previa">
          <span class="sizes-label">Vista previa:</span>
          <button
            v-for="s in presets"
            :key="s.id"
            class="size"
            :class="{ on: preset === s.id }"
            type="button"
            role="radio"
            :aria-checked="preset === s.id"
            :data-testid="`split-${s.id}`"
            @click="setPreset(s.id)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>

      <footer class="strip-area">
        <!-- Con la biblioteca abierta, abajo solo las pistas: lo puesto queda elegido para después. -->
        <ItemBar v-if="item && !tracks.libraryOpen.value" :playhead-ms="tracks.playheadMs.value" @seek="seek" />
        <div v-else-if="clip && !tracks.libraryOpen.value" class="clip-actions" data-testid="clip-panel">
          <h2>
            Trozo {{ index + 1 }} <span class="muted">de {{ count }}</span>
            <span class="clip-len" data-testid="clip-panel-duration">{{ formatDuration(clipDurationMs(clip)) }}</span>
          </h2>
          <span class="nav-keys" title="RePág y AvPág: elegir el trozo anterior o el siguiente"><KeyHint k="RePág" /><KeyHint k="AvPág" /></span>
          <template v-if="clipMissing">
            <p class="lost"><AppIcon name="warning" /> No encuentro este vídeo. Puede que se haya movido o borrado.</p>
            <span class="spacer" />
            <button class="btn primary" type="button" data-testid="relink-clip" @click="store.relink(clip.sourcePath)">
              <AppIcon name="relink" />
              Buscarlo
            </button>
            <button class="btn danger" type="button" data-testid="remove-clip" @click="store.removeClip(clip.id)">
              <AppIcon name="trash" />
              Quitarlo del vídeo
              <KeyHint k="Supr" />
            </button>
          </template>
          <template v-else-if="clipCoverMissing">
            <p class="lost" data-testid="cover-lost-panel"><AppIcon name="warning" /> No encuentro el vídeo de encima de este trozo.</p>
            <span class="spacer" />
            <button v-if="clip.picture.kind === 'cover'" class="btn primary" type="button" data-testid="relink-cover" @click="store.relink(clip.picture.sourcePath)">
              <AppIcon name="relink" />
              Buscarlo
            </button>
            <button class="btn" type="button" data-testid="remove-lost-cover" @click="dropLostCover">
              <AppIcon name="close" />
              Quitar el vídeo de encima
            </button>
            <button class="btn fix" type="button" data-testid="fix-clip" @click="fix">
              <AppIcon name="wrench" />
              Arreglar este trozo
              <KeyHint k="A" />
            </button>
          </template>
          <template v-else>
            <button class="btn fix" type="button" data-testid="fix-clip" aria-label="Arreglar este trozo" @click="fix">
              <AppIcon name="wrench" />
              <span>Arreglar<span class="long"> este trozo</span></span>
              <KeyHint k="A" />
            </button>
            <div class="move" role="group" aria-label="Mover el trozo">
              <span class="move-label">Mover</span>
              <button class="btn" type="button" :disabled="index <= 0" aria-label="Mover antes" title="Mover antes" data-testid="move-before" @click="store.moveBy(clip.id, -1)">
                <AppIcon name="arrow-left" />
              </button>
              <button class="btn" type="button" :disabled="index >= count - 1" aria-label="Mover después" title="Mover después" data-testid="move-after" @click="store.moveBy(clip.id, 1)">
                <AppIcon name="arrow-right" />
              </button>
            </div>
            <div class="pop-wrap">
              <button
                class="btn"
                :class="{ selected: clipFadeOn }"
                type="button"
                :aria-expanded="clipFadesOpen"
                aria-label="Aparecer y desaparecer"
                :title="`Cómo aparece y desaparece el trozo ${index + 1} (desde negro y desde silencio)`"
                data-testid="clip-fades"
                @click="clipFadesOpen = !clipFadesOpen"
              >
                <AppIcon name="fade-in" />
                <span class="txt fade-txt">Aparecer</span>
              </button>
              <div v-if="clipFadesOpen" class="popover card clip-fades-pop" data-testid="clip-fades-popover">
                <FadePicker :fades="clip" subject="clip" @change="setFadeOfClip" />
              </div>
            </div>
            <div class="at-line" role="group" aria-label="En la línea">
              <button class="btn" type="button" :disabled="!lineInClip" aria-label="Empieza aquí" :title="`Que el trozo ${index + 1} empiece donde está la línea${lineHint}`" data-testid="clip-start-here" @click="clipStartHere">
                <AppIcon name="start-here" />
                <span class="txt">Empieza aquí</span>
                <KeyHint k="E" />
              </button>
              <button class="btn" type="button" :disabled="!lineInClip" aria-label="Termina aquí" :title="`Que el trozo ${index + 1} termine donde está la línea${lineHint}`" data-testid="clip-end-here" @click="clipEndHere">
                <AppIcon name="end-here" />
                <span class="txt">Termina aquí</span>
                <KeyHint k="T" />
              </button>
              <button class="btn" type="button" :disabled="!lineInClip" aria-label="Partir aquí" :title="`Partir el trozo ${index + 1} donde está la línea${lineHint}`" data-testid="clip-split-here" @click="clipSplitHere">
                <AppIcon name="split" />
                <span class="txt">Partir</span>
                <KeyHint k="P" />
              </button>
            </div>
            <button
              v-if="clip.sourceHasVideo"
              class="btn corner"
              type="button"
              :disabled="!canCorner"
              :aria-label="cornerLabel"
              :title="`${cornerLabel}: tu vídeo se encoge hasta la esquina (o vuelve a llenar la pantalla) desde donde está la línea, dejando ver el vídeo de detrás`"
              data-testid="clip-corner"
              @click="cornerHere"
            >
              <AppIcon :name="cornerLabel.startsWith('Volver') ? 'fullscreen' : 'corner'" />
              <span class="txt corner-txt">{{ cornerLabel.startsWith('Volver') ? 'Pantalla completa' : 'A una esquina' }}</span>
              <KeyHint k="Q" />
            </button>
            <span class="spacer" />
            <button class="btn tail" type="button" data-testid="copy-clip" aria-label="Copiar este trozo" @click="copySelected">
              <AppIcon name="copy" />
              <span class="txt">Copiar<span class="long"> este trozo</span></span>
              <KeyHint k="Ctrl C" />
            </button>
            <button class="btn tail" type="button" :disabled="!store.pasteAvailable.value" data-testid="paste-clip" aria-label="Pegar" @click="paste">
              <AppIcon name="paste" />
              <span class="txt">Pegar</span>
              <KeyHint k="Ctrl V" />
            </button>
            <button class="btn danger tail" type="button" aria-label="Quitar del vídeo" data-testid="remove-clip" @click="store.removeClip(clip.id)">
              <AppIcon name="trash" />
              <span class="txt">Quitar<span class="long"> del vídeo</span></span>
              <KeyHint k="Supr" />
            </button>
          </template>
        </div>
        <TracksView ref="tracksView" :playhead-ms="tracks.playheadMs.value" :playing="playing" @seek="seek" @add="addMore" @record="record" />
      </footer>
    </div>
  </main>
</template>

<style scoped>
.pop-wrap {
  position: relative;
  flex: none;
}
.clip-fades-pop {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 30;
  width: min(600px, calc(100vw - 48px));
  max-height: calc(100vh - 140px);
  overflow: auto;
  padding: 14px 16px;
  box-shadow: var(--shadow-lg);
}
.save {
  margin-left: 8px;
}
/* Todo lo que queda bajo la barra de duración: arriba, abajo y el divisor entre los dos. */
.work {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.upper {
  flex: none;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
  padding: 14px 20px 0;
}
.upper.with-library {
  grid-template-columns: minmax(0, 1fr) clamp(380px, 36%, 500px);
}
.preview {
  min-height: 0;
  min-width: 0;
  /* La vista previa sabe su alto (para encoger sus controles cuando es baja). */
  container-type: size;
  container-name: preview;
}
.side-library {
  min-height: 0;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  container-type: size;
  container-name: side;
}
.panel {
  flex: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.panel h2 {
  font-size: 17px;
  font-weight: 650;
}
.panel h2 .muted {
  font-weight: 400;
}
/* «Sonidos y efectos» en la columna de la derecha. */
.fx-panel {
  border-color: #cdb9e6;
}
.fx-hint {
  font-size: 15px;
  color: var(--text-muted);
  line-height: 1.3;
}
.add-fx {
  justify-content: flex-start;
  min-height: 50px;
  padding: 6px 12px;
  white-space: normal;
  text-align: left;
  line-height: 1.2;
  border-color: #7b56b0;
  color: #5b3590;
}
.add-fx-text {
  flex: 1;
}
.add-fx:hover:not(:disabled) {
  background: #f3edfa !important;
  border-color: #7b56b0 !important;
}
.offer {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.offer h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent-hover);
}
.offer p {
  font-size: 16px;
}
.offer-main {
  white-space: normal;
  line-height: 1.2;
  min-height: 56px;
  padding: 6px 12px;
  text-align: left;
}
/* Forma del vídeo: en fila de tres (sin las explicaciones, que van en el título) cuando la columna es baja. */
.shapes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.shape {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-height: 62px;
  padding: 6px 4px;
  border-radius: 12px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  text-align: center;
  color: var(--text-muted);
}
.shape:hover {
  border-color: var(--border-strong);
}
.shape.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.shape-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.shape-text strong {
  color: var(--text);
  font-size: 14px;
  font-weight: 650;
}
.shape-hint {
  display: none;
  font-size: 15px;
}
.tip {
  display: none;
  gap: 10px;
  font-size: 15px;
  padding: 0 6px;
}
/* Columna alta: las formas en lista con su explicación, y el consejo de arrastrar. */
@container side (min-height: 470px) {
  .shapes {
    grid-template-columns: minmax(0, 1fr);
  }
  .shape {
    flex-direction: row;
    gap: 14px;
    min-height: 54px;
    padding: 6px 12px;
    text-align: left;
  }
  .shape-text strong {
    font-size: 17px;
  }
  .shape-hint {
    display: block;
  }
  .tip {
    display: flex;
  }
}
@container side (max-height: 330px) {
  .fx-hint {
    display: none;
  }
}

/* El divisor: se arrastra en cualquier parte de la barra (salvo los botones). */
.splitter {
  flex: none;
  position: relative;
  height: 26px;
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
  touch-action: none;
  user-select: none;
}
.grip {
  width: 64px;
  height: 6px;
  border-radius: 3px;
  background: var(--border-strong);
}
.splitter:hover .grip {
  background: var(--text-muted);
}
.sizes {
  position: absolute;
  right: 20px;
  top: 1px;
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: default;
}
.sizes-label {
  margin-right: 4px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-muted);
}
.size {
  height: 24px;
  padding: 0 9px;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}
.size:hover {
  border-color: var(--text-muted);
}
.size.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.fix {
  border-color: var(--accent);
  color: var(--accent-hover);
}
.fix:hover {
  background: var(--accent-soft) !important;
  border-color: var(--accent) !important;
}
.strip-area {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-top: 1px solid var(--border);
  /* La barra de lo elegido se adapta al ancho (cuanto menos, más botones en icono y tecla). */
  container-type: inline-size;
  container-name: strip;
}
.clip-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
}
.clip-actions .btn {
  min-height: 44px;
  padding: 0 12px;
  gap: 7px;
  font-size: 16px;
}
.clip-actions h2 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 18px;
  font-weight: 650;
  margin-right: 4px;
  white-space: nowrap;
}
.clip-actions h2 .muted {
  font-weight: 400;
}
.clip-len {
  padding: 1px 7px;
  border-radius: 7px;
  background: var(--surface-sunken);
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.move,
.at-line {
  display: flex;
  align-items: center;
  gap: 5px;
}
.at-line {
  margin-left: 6px;
  padding-left: 10px;
  border-left: 1px solid var(--border);
}
.move-label {
  font-weight: 600;
  color: var(--text-muted);
  margin-right: 2px;
}
.move .btn {
  width: 44px;
  padding: 0;
}
.nav-keys {
  display: inline-flex;
  gap: 3px;
  margin: 0 4px 0 -4px;
  color: var(--text-muted);
  font-size: 14px;
}
/*
 * Cuanto menos ancho, más botones se quedan en icono y tecla (el nombre sale al pasar el ratón): primero
 * copiar, pegar y quitar; lo último, «Empieza aquí», «Termina aquí» y «Partir», que dicen qué hace cada letra.
 */
@container strip (max-width: 1600px) {
  .clip-actions .long {
    display: none;
  }
}
@container strip (max-width: 1460px) {
  /* RePág / AvPág siguen en el panel «Teclas»; aquí se queda «Mover», que explica las flechas. */
  .nav-keys {
    display: none;
  }
  .clip-actions .tail .txt,
  .clip-actions .fade-txt,
  .clip-actions .corner-txt,
  .move-label {
    display: none;
  }
  .clip-actions {
    gap: 6px;
  }
  .clip-actions .btn {
    padding: 0 10px;
    gap: 6px;
  }
}
/* Con «Aparecer» y «A una esquina» la barra no cabe entera a 1280 px: los textos se van antes. */
@container strip (max-width: 1340px) {
  .clip-actions .txt {
    display: none;
  }
}
@container strip (max-width: 1180px) {
  .clip-actions {
    gap: 6px;
  }
  .clip-actions .btn {
    padding: 0 10px;
    gap: 5px;
  }
  .clip-actions .fix .long,
  .move-label {
    display: none;
  }
  .move .btn {
    width: 40px;
  }
}
.spacer {
  flex: 1;
}
.lost {
  display: flex;
  gap: 8px;
  color: var(--warn);
  font-weight: 600;
}
.missing-banner {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--warn);
  font-weight: 600;
}
@media (max-width: 1250px) {
  .upper {
    grid-template-columns: minmax(0, 1fr) 250px;
  }
  .topbar .save {
    padding: 0 18px;
  }
}
@media (max-height: 760px) {
  .upper {
    padding-top: 10px;
  }
  .clip-actions {
    padding: 6px 20px;
  }
  .panel {
    padding: 10px;
  }
  .add-fx {
    min-height: 46px;
  }
}
</style>
