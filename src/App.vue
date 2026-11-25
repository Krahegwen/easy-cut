<script setup lang="ts">
// Pantalla activa, atajos globales (Ctrl+Z / Ctrl+Y), ficheros soltados en la ventana y avisos.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ErrorDialog from './components/ErrorDialog.vue'
import PreparingOverlay from './components/PreparingOverlay.vue'
import ToastBar from './components/ToastBar.vue'
import { addVideos } from './lib/add-videos'
import { confirmRequest } from './lib/confirm'
import { dispatchKey } from './lib/keys'
import { store } from './store'
import ClipEditorView from './views/ClipEditorView.vue'
import DoneView from './views/DoneView.vue'
import EditorView from './views/EditorView.vue'
import HomeView from './views/HomeView.vue'
import PickView from './views/PickView.vue'
import SaveView from './views/SaveView.vue'
import SavingView from './views/SavingView.vue'
import TeleprompterView from './views/TeleprompterView.vue'

const hovering = ref(false)

/** Las teclas no se roban a un campo de texto ni con un diálogo abierto. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

function onKey(e: KeyboardEvent) {
  if (isTyping(e) || confirmRequest.value || store.error.value) return
  const editing = store.screen.value === 'editor' || store.screen.value === 'clip'
  if (editing && (e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault()
      store.undo()
      return
    }
    if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault()
      store.redo()
      return
    }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // Espacio sobre un botón lo pulsaría: aquí siempre es reproducir/pausa.
  if (dispatchKey(e)) e.preventDefault()
}

let stopDrop: (() => void) | null = null
const onBeforeUnload = () => void store.flushAutosave()

onMounted(() => {
  window.addEventListener('keydown', onKey)
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
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
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

  <div v-if="hovering && store.screen.value === 'editor'" class="drop-hint">Suelta los vídeos para añadirlos al final</div>
  <PreparingOverlay />
  <ToastBar />
  <ConfirmDialog />
  <ErrorDialog />
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
