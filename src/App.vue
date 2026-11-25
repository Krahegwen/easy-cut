<script setup lang="ts">
// Pantalla activa, el único listener de teclado (los atajos los declara cada pantalla o diálogo con
// useShortcuts), ficheros soltados en la ventana y avisos.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ErrorDialog from './components/ErrorDialog.vue'
import KeysPanel from './components/KeysPanel.vue'
import PreparingOverlay from './components/PreparingOverlay.vue'
import ToastBar from './components/ToastBar.vue'
import { addVideos } from './lib/add-videos'
import { installShortcutListener } from './lib/use-shortcuts'
import UpdateDialog from './components/UpdateDialog.vue'
import { store, updater, updaterEnabled } from './store'
import ClipEditorView from './views/ClipEditorView.vue'
import DoneView from './views/DoneView.vue'
import EditorView from './views/EditorView.vue'
import HomeView from './views/HomeView.vue'
import PickView from './views/PickView.vue'
import SaveView from './views/SaveView.vue'
import SavingView from './views/SavingView.vue'
import TeleprompterView from './views/TeleprompterView.vue'

const hovering = ref(false)

let stopDrop: (() => void) | null = null
let stopKeys: (() => void) | null = null
const onBeforeUnload = () => void store.flushAutosave()

onMounted(() => {
  stopKeys = installShortcutListener()
  window.addEventListener('beforeunload', onBeforeUnload)
  stopDrop = store.bridge.onFilesDropped({
    onDrop: (paths) => {
      const screen = store.screen.value
      if (screen === 'pick' || screen === 'editor') void addVideos(paths)
      else if (screen === 'home') {
        store.startNewProject()
        store.go('pick')
        void addVideos(paths)
      }
    },
    onHover: (h) => (hovering.value = h),
  })
  void store.loadAutosaveSummary()
  // Solo en la app instalada: unos segundos después de arrancar mira si hay versión nueva (sin bloquear nada).
  if (updaterEnabled) updater.start()
})
onBeforeUnmount(() => {
  updater.stop()
  stopKeys?.()
  window.removeEventListener('beforeunload', onBeforeUnload)
  stopDrop?.()
})
</script>

<template>
  <HomeView v-if="store.screen.value === 'home'" />
  <PickView v-else-if="store.screen.value === 'pick'" :hovering="hovering" />
  <EditorView v-else-if="store.screen.value === 'editor'" />
  <ClipEditorView v-else-if="store.screen.value === 'clip'" />
  <SaveView v-else-if="store.screen.value === 'save'" />
  <SavingView v-else-if="store.screen.value === 'saving'" />
  <DoneView v-else-if="store.screen.value === 'done'" />
  <TeleprompterView v-else-if="store.screen.value === 'teleprompter'" />

  <div v-if="hovering && store.screen.value === 'editor'" class="drop-hint">Suelta los vídeos o sonidos para añadirlos al final</div>
  <PreparingOverlay />
  <ToastBar />
  <ConfirmDialog />
  <UpdateDialog />
  <ErrorDialog />
  <KeysPanel />
</template>

<style scoped>
.drop-hint {
  position: fixed;
  inset: 12px;
  border: 4px dashed var(--accent);
  border-radius: 20px;
  background: rgb(227 238 246 / 0.85);
  display: grid;
  place-items: center;
  font-size: 28px;
  font-weight: 700;
  color: var(--accent-hover);
  z-index: 45;
  pointer-events: none;
}
</style>
