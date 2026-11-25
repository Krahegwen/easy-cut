<script setup lang="ts">
// «Tu vídeo»: vista previa del montaje, forma, duración máxima, la tira de trozos y «Guardar el vídeo».
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import type { IconName } from '../components/icons'
import ClipStrip from '../components/ClipStrip.vue'
import DurationBar from '../components/DurationBar.vue'
import PreviewPlayer from '../components/PreviewPlayer.vue'
import TargetPicker from '../components/TargetPicker.vue'
import UndoRedo from '../components/UndoRedo.vue'
import UpdateNotice from '../components/UpdateNotice.vue'
import ItemBar from '../components/tracks/ItemBar.vue'
import LibraryPanel from '../components/tracks/LibraryPanel.vue'
import TracksView from '../components/tracks/TracksView.vue'
import type { PlayerTime } from '../components/player-types'
import { clipDurationMs, clipStartTimes, formatDuration, isTrackMediaPath, removeCover, resolveTracks, setAspect, type AspectRatio } from '../domain'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import { pasteFromClipboard, pickAndAddVideos } from '../lib/add-videos'
import { useShortcuts } from '../lib/use-shortcuts'
import { library, store, tracks } from '../store'

const player = ref<InstanceType<typeof PreviewPlayer> | null>(null)
const tracksView = ref<InstanceType<typeof TracksView> | null>(null)
const view = computed(() => tracks.view.value)
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

function toggleView() {
  if (!tracks.hasTracks.value) return
  tracks.setView(view.value === 'cards' ? 'tracks' : 'cards')
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
    store.showToast('Antes de guardar, quita los trozos (o los vídeos de encima) que no encuentro.')
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

// ------------------------------------------------------------------ copiar y pegar

const canFix = computed(() => !!clip.value && !clipMissing.value)

function copySelected() {
  if (clip.value) void store.copyClip(clip.value.id)
}

/**
 * Ctrl+V: con la vista de pistas o la biblioteca abierta, los ficheros copiados en el Explorador van a las
 * pistas, donde está la línea; si no, como siempre (al final, como trozos, o el trozo copiado).
 */
async function paste() {
  player.value?.pause()
  if (view.value === 'tracks' || tracks.libraryOpen.value) {
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
    // Con un sonido o un efecto elegido, sus teclas van antes que las del trozo.
    const itemKeys = it && view.value === 'tracks'
      ? [
          { id: 'item-deselect', keys: ['Escape'], label: 'Esc', description: 'dejar de elegir el sonido o efecto', run: () => tracks.select(null), enabled: !playing.value },
          { id: 'item-remove', keys: ['Delete'], label: 'Supr', description: 'quitar el sonido o efecto elegido (se puede deshacer)', run: () => tracks.remove(it.item.id) },
          { id: 'item-split', keys: ['p'], label: 'P', description: 'partir el elegido donde está la línea', run: () => tracks.split(it.item.id, at), enabled: inside },
          { id: 'item-duplicate', keys: ['d'], label: 'D', description: 'duplicar el elegido (justo detrás)', run: () => tracks.duplicate(it.item.id) },
          { id: 'item-move-here', keys: ['m'], label: 'M', description: 'que el elegido empiece donde está la línea', run: () => tracks.moveTo(it.item.id, at) },
          { id: 'item-trim-start', keys: ['e'], label: 'E', description: 'que el elegido empiece en la línea (recorta o alarga por delante)', run: () => tracks.trimAt(it.item.id, 'start', at), enabled: !!r && at < r.endMs - 300 },
          { id: 'item-trim-end', keys: ['t'], label: 'T', description: 'que el elegido termine en la línea', run: () => tracks.trimAt(it.item.id, 'end', at), enabled: !!r && at > r.startMs + 300 },
          { id: 'item-repeat', keys: ['r'], label: 'R', description: 'repetir el elegido (o dejar de repetirlo)', run: () => tracks.setRepeat(it.item.id, !it.item.repeat), enabled: !it.item.still },
          { id: 'item-up', keys: ['ArrowUp'], label: '↑', description: 'pasar el elegido a la pista de arriba', run: () => tracks.moveToNeighbourTrack(it.item.id, -1) },
          { id: 'item-down', keys: ['ArrowDown'], label: '↓', description: 'pasar el elegido a la pista de abajo', run: () => tracks.moveToNeighbourTrack(it.item.id, 1) },
        ]
      : []
    return [
      { id: 'play', keys: ['Space'], label: 'Espacio', description: 'reproducir o parar', run: () => p?.toggle(), enabled: has },
      { id: 'stop', keys: ['Escape'], label: 'Esc', description: 'parar y volver al principio', run: () => (p?.pause(), p?.seek(0)), enabled: playing.value },
      ...itemKeys,
      { id: 'back', keys: ['Escape'], label: 'Esc', description: 'volver a Inicio (tu vídeo no se pierde)', run: () => store.go('home') },
      { id: 'library', keys: ['b'], label: 'B', description: 'añadir sonidos y efectos (biblioteca)', run: openLibrary, enabled: has },
      { id: 'view', keys: ['v'], label: 'V', description: 'ver las pistas o las tarjetas', run: toggleView, enabled: tracks.hasTracks.value },
      { id: 'zoom-in', keys: ['+'], label: '+', description: 'acercar (pistas)', run: () => tv?.zoomBy(1), enabled: view.value === 'tracks', repeat: true },
      { id: 'zoom-out', keys: ['-'], label: '-', description: 'alejar (pistas)', run: () => tv?.zoomBy(-1), enabled: view.value === 'tracks', repeat: true },
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
})
onBeforeUnmount(() => {
  window.clearInterval(clipboardTimer)
  window.removeEventListener('focus', onWindowFocus)
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

    <div class="body">
    <div class="main-col">
    <div class="workspace" :class="{ 'with-library': tracks.libraryOpen.value }">
      <section class="preview">
        <PreviewPlayer ref="player" :project="store.playableProject.value" tracks @time="onTime">
          <template #overlay>
            <div v-if="missingCount > 0" class="missing-banner">
              <AppIcon name="warning" />
              {{ missingCount === 1 ? 'Hay un trozo cuyo vídeo no encuentro: no sale aquí.' : `Hay ${missingCount} trozos cuyo vídeo no encuentro: no salen aquí.` }}
            </div>
          </template>
        </PreviewPlayer>
      </section>

      <aside v-if="!tracks.libraryOpen.value" class="side">
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
          <p v-if="!tracks.hasTracks.value" class="fx-hint">Música, aplausos, confeti, luces… por encima de tu vídeo.</p>
          <button class="btn add-fx" type="button" :disabled="count === 0" data-testid="add-sounds-effects" @click="openLibrary">
            <AppIcon name="library" />
            <span class="add-fx-text">Añadir sonidos y efectos</span>
            <KeyHint k="B" />
          </button>
          <span v-if="tracks.hasTracks.value" class="switch-label">Ver abajo <KeyHint k="V" /></span>
          <div v-if="tracks.hasTracks.value" class="switch" role="radiogroup" aria-label="Cómo ver la parte de abajo">
            <button class="seg" :class="{ on: view === 'cards' }" type="button" role="radio" :aria-checked="view === 'cards'" data-testid="view-cards" @click="tracks.setView('cards')">
              <AppIcon name="cards" :size="20" />
              Tarjetas
            </button>
            <button class="seg" :class="{ on: view === 'tracks' }" type="button" role="radio" :aria-checked="view === 'tracks'" data-testid="view-tracks" @click="tracks.setView('tracks')">
              <AppIcon name="tracks" :size="20" />
              Pistas
            </button>
          </div>
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
              :data-testid="`shape-${s.label.toLowerCase()}`"
              @click="setShape(s.id)"
            >
              <AppIcon :name="s.icon" :size="30" />
              <span class="shape-text">
                <strong>{{ s.label }}</strong>
                <span>{{ s.hint }}</span>
              </span>
            </button>
          </div>
        </section>

        <p class="tip muted">
          <AppIcon name="drag" :size="20" />
          {{ view === 'tracks' ? 'Arrastra los trozos y lo que hay en las pistas para moverlos; tira de sus bordes para recortarlos.' : 'Arrastra los trozos de abajo para cambiar el orden, o usa «Mover» antes o después.' }}
        </p>
      </aside>
    </div>

    <footer class="strip-area">
      <!-- Con la biblioteca abierta, abajo solo las pistas (o la tira): lo puesto queda elegido para después. -->
      <ItemBar v-if="item && view === 'tracks' && !tracks.libraryOpen.value" :playhead-ms="tracks.playheadMs.value" />
      <div v-else-if="clip && !tracks.libraryOpen.value" class="clip-actions" data-testid="clip-panel">
        <h2>Trozo {{ index + 1 }} <span class="muted">de {{ count }}</span></h2>
        <span class="nav-keys" title="RePág y AvPág: elegir el trozo anterior o el siguiente"><KeyHint k="RePág" /><KeyHint k="AvPág" /></span>
        <template v-if="clipMissing">
          <p class="lost"><AppIcon name="warning" /> No encuentro este vídeo. Puede que se haya movido o borrado.</p>
          <span class="spacer" />
          <button class="btn danger" type="button" data-testid="remove-clip" @click="store.removeClip(clip.id)">
            <AppIcon name="trash" />
            Quitarlo del vídeo
            <KeyHint k="Supr" />
          </button>
        </template>
        <template v-else-if="clipCoverMissing">
          <p class="lost" data-testid="cover-lost-panel"><AppIcon name="warning" /> No encuentro el vídeo de encima de este trozo.</p>
          <span class="spacer" />
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
          <button class="btn fix" type="button" data-testid="fix-clip" @click="fix">
            <AppIcon name="wrench" />
            Arreglar este trozo
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
          <span class="spacer" />
          <button class="btn" type="button" data-testid="copy-clip" aria-label="Copiar este trozo" @click="copySelected">
            <AppIcon name="copy" />
            <span>Copiar<span class="long"> este trozo</span></span>
            <KeyHint k="Ctrl C" />
          </button>
          <button class="btn" type="button" :disabled="!store.pasteAvailable.value" data-testid="paste-clip" aria-label="Pegar" @click="paste">
            <AppIcon name="paste" />
            Pegar
            <KeyHint k="Ctrl V" />
          </button>
          <button class="btn danger" type="button" aria-label="Quitar del vídeo" data-testid="remove-clip" @click="store.removeClip(clip.id)">
            <AppIcon name="trash" />
            <span>Quitar<span class="long"> del vídeo</span></span>
            <KeyHint k="Supr" />
          </button>
        </template>
      </div>
      <ClipStrip v-if="view === 'cards'" @add="pickAndAddVideos" @record="record" />
      <TracksView v-else ref="tracksView" :playhead-ms="tracks.playheadMs.value" :playing="playing" @seek="seek" />
    </footer>
    </div>
    <LibraryPanel v-if="tracks.libraryOpen.value" class="side-library" />
    </div>
  </main>
</template>

<style scoped>
.save {
  margin-left: 8px;
}
.workspace {
  flex: 1;
  /* La vista previa nunca se queda sin altura: si abajo no cabe todo, las pistas se desplazan. */
  min-height: 250px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
  padding: 16px 20px 0;
}
.preview {
  min-height: 0;
  min-width: 0;
}
/*
 * Con la biblioteca abierta, ocupa toda la altura de la derecha: la vista previa (para «Probar sobre mi vídeo»)
 * y las pistas (para ver dónde cae lo que se pone) siguen a la vista, a la izquierda.
 */
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.main-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* Lo de abajo se adapta al ancho que le queda (menos con la biblioteca abierta). */
  container-type: inline-size;
}
.workspace.with-library {
  grid-template-columns: minmax(0, 1fr);
}
.side-library {
  flex: none;
  width: clamp(380px, 36%, 500px);
  margin: 16px 20px 14px 0;
}
/* «Sonidos y efectos» en la columna de la derecha: añadir y cambiar entre tarjetas y pistas. */
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
  min-height: 52px;
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
.switch {
  display: flex;
  align-items: center;
  gap: 6px;
}
.switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: -4px;
  font-weight: 600;
  font-size: 15px;
  color: var(--text-muted);
}
.seg {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 42px;
  padding: 0 8px;
  border: 1.5px solid var(--border-strong);
  background: var(--surface);
  font-weight: 600;
  font-size: 16px;
  white-space: nowrap;
  cursor: pointer;
}
.seg:nth-of-type(1) {
  border-radius: 10px 0 0 10px;
}
.seg:nth-of-type(2) {
  border-radius: 0 10px 10px 0;
  margin-left: -6px;
}
.seg.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
  position: relative;
  z-index: 1;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel h2 {
  font-size: 18px;
  font-weight: 650;
}
.panel h2 .muted {
  font-weight: 400;
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
.shapes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shape {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 54px;
  padding: 6px 12px;
  border-radius: 12px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  text-align: left;
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
  line-height: 1.25;
}
.shape-text strong {
  color: var(--text);
  font-size: 17px;
}
.shape-text span {
  font-size: 15px;
}
.fix {
  border-color: var(--accent);
  color: var(--accent-hover);
}
.fix:hover {
  background: var(--accent-soft) !important;
  border-color: var(--accent) !important;
}
.clip-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px 0;
}
.clip-actions h2 {
  font-size: 19px;
  font-weight: 650;
  margin-right: 8px;
  white-space: nowrap;
}
.clip-actions h2 .muted {
  font-weight: 400;
}
.move {
  display: flex;
  align-items: center;
  gap: 6px;
}
.move-label {
  font-weight: 600;
  color: var(--text-muted);
  margin-right: 2px;
}
.move .btn {
  width: 48px;
  padding: 0;
}
.nav-keys {
  display: inline-flex;
  gap: 3px;
  margin: 0 6px 0 -6px;
  color: var(--text-muted);
  font-size: 14px;
}
@media (max-width: 1420px) {
  .clip-actions .long {
    display: none;
  }
}
@media (max-width: 1250px) {
  .clip-actions {
    gap: 7px;
  }
  .clip-actions h2 {
    margin-right: 2px;
    font-size: 18px;
  }
  .clip-actions .btn {
    padding: 0 11px;
    gap: 6px;
    font-size: 16px;
  }
  /* RePág / AvPág siguen en el panel «Teclas»; aquí se queda «Mover», que explica las flechas. */
  .nav-keys {
    display: none;
  }
  .move .btn {
    width: 44px;
    padding: 0;
  }
  .topbar .save {
    padding: 0 18px;
  }
}
.spacer {
  flex: 1;
}
.tip {
  display: flex;
  gap: 10px;
  font-size: 15px;
  padding: 0 6px;
}
.lost {
  display: flex;
  gap: 8px;
  color: var(--warn);
  font-weight: 600;
}
.strip-area {
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 14px;
  background: var(--surface);
  border-top: 1px solid var(--border);
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
  .workspace {
    grid-template-columns: minmax(0, 1fr) 250px;
  }
}
@media (max-width: 1250px) {
  .seg {
    font-size: 15px;
    padding: 0 6px;
  }
}
@media (max-height: 760px) {
  .workspace {
    min-height: 220px;
  }
  .seg {
    min-height: 38px;
  }
  .add-fx {
    min-height: 46px;
  }
  .fx-hint {
    display: none;
  }
  .workspace {
    padding-top: 10px;
  }
  .clip-actions {
    padding-top: 8px;
  }
  .strip-area {
    margin-top: 10px;
  }
  .tip {
    display: none;
  }
  .panel {
    padding: 10px;
  }
}
</style>
