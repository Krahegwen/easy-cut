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
import { clipDurationMs, clipStartTimes, formatDuration, removeCover, setAspect, type AspectRatio } from '../domain'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import { pasteFromClipboard, pickAndAddVideos } from '../lib/add-videos'
import { useShortcuts } from '../lib/use-shortcuts'
import { store } from '../store'

const player = ref<InstanceType<typeof PreviewPlayer> | null>(null)

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

function paste() {
  player.value?.pause()
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
    return [
      { id: 'play', keys: ['Space'], label: 'Espacio', description: 'reproducir o parar', run: () => p?.toggle(), enabled: has },
      { id: 'stop', keys: ['Escape'], label: 'Esc', description: 'parar y volver al principio', run: () => (p?.pause(), p?.seek(0)), enabled: playing.value },
      { id: 'back', keys: ['Escape'], label: 'Esc', description: 'volver a Inicio (tu vídeo no se pierde)', run: () => store.go('home') },
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

    <div class="workspace">
      <section class="preview">
        <PreviewPlayer ref="player" :project="store.playableProject.value">
          <template #overlay>
            <div v-if="missingCount > 0" class="missing-banner">
              <AppIcon name="warning" />
              {{ missingCount === 1 ? 'Hay un trozo cuyo vídeo no encuentro: no sale aquí.' : `Hay ${missingCount} trozos cuyo vídeo no encuentro: no salen aquí.` }}
            </div>
          </template>
        </PreviewPlayer>
      </section>

      <aside class="side">
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
          Arrastra los trozos de abajo para cambiar el orden, o usa «Mover» antes o después.
        </p>
      </aside>
    </div>

    <footer class="strip-area">
      <div v-if="clip" class="clip-actions" data-testid="clip-panel">
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
      <ClipStrip @add="pickAndAddVideos" @record="record" />
    </footer>
  </main>
</template>

<style scoped>
.save {
  margin-left: 8px;
}
.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
  padding: 16px 20px 0;
}
.preview {
  min-height: 0;
  min-width: 0;
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
  flex: none;
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
@media (max-height: 760px) {
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
