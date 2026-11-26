<script setup lang="ts">
// Pantalla activa, el único listener de teclado (los atajos los declara cada pantalla o diálogo con
// useShortcuts), ficheros soltados en la ventana y avisos.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ErrorDialog from './components/ErrorDialog.vue'
import KeysPanel from './components/KeysPanel.vue'
import PreparingOverlay from './components/PreparingOverlay.vue'
import RelinkDialog from './components/RelinkDialog.vue'
import ToastBar from './components/ToastBar.vue'
import { addVideos } from './lib/add-videos'
import { installShortcutListener } from './lib/use-shortcuts'
import UpdateDialog from './components/UpdateDialog.vue'
import type { DropPoint } from './native/bridge'
import { cacheCleaner, store, tracks, updater, updaterEnabled } from './store'
import ClipEditorView from './views/ClipEditorView.vue'
import DoneView from './views/DoneView.vue'
import EditorView from './views/EditorView.vue'
import HomeView from './views/HomeView.vue'
import PickView from './views/PickView.vue'
import SaveView from './views/SaveView.vue'
import SavingView from './views/SavingView.vue'
import TeleprompterView from './views/TeleprompterView.vue'
import TrimView from './views/TrimView.vue'

const hovering = ref(false)
const hoverPoint = ref<DropPoint | null>(null)
/**
 * En «Tu vídeo», ¿lo soltado va a las pistas? Sí con la biblioteca abierta o encima de una pista de sonido o de
 * efectos (o de su cabecera, o del pie para crear pistas); en el resto (la vista previa, la fila «Vídeo»…),
 * se añade al final como trozos.
 */
function toTracks(at: DropPoint | null | undefined): boolean {
  if (tracks.libraryOpen.value) return true
  if (!at) return false
  const el = document.elementFromPoint(at.x, at.y)
  return !!el?.closest('[data-testid=track-row], [data-testid=track-header], [data-testid=add-track-row]')
}

let stopDrop: (() => void) | null = null
let stopKeys: (() => void) | null = null
const onBeforeUnload = () => void store.flushAutosave()

onMounted(() => {
  stopKeys = installShortcutListener()
  window.addEventListener('beforeunload', onBeforeUnload)
  stopDrop = store.bridge.onFilesDropped({
    onDrop: (paths, at) => {
      const screen = store.screen.value
      // Encima de las pistas (o con la biblioteca abierta), lo que se suelta va a las pistas, donde está la línea.
      if (screen === 'editor' && toTracks(at)) void tracks.addFiles(paths, tracks.playheadMs.value)
      else if (screen === 'pick' || screen === 'editor') void addVideos(paths)
      else if (screen === 'home') {
        store.startNewProject()
        store.go('pick')
        void addVideos(paths)
      }
    },
    onHover: (h, at) => {
      hovering.value = h
      hoverPoint.value = h ? (at ?? null) : null
    },
  })
  // La lista de Inicio (y, una vez, pasar a ella el autoguardado de antes); después, un rato más tarde, la
  // limpieza de la caché (como mucho una vez al día; nunca lo que usan los vídeos de la lista).
  void store.loadProjects().then(() => cacheCleaner.schedule())
  // Solo en la app instalada: unos segundos después de arrancar mira si hay versión nueva (sin bloquear nada).
  if (updaterEnabled) updater.start()
})
onBeforeUnmount(() => {
  updater.stop()
  cacheCleaner.stop()
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
  <TrimView v-else-if="store.screen.value === 'trim'" />

  <div v-if="hovering && store.screen.value === 'editor'" class="drop-hint" :class="{ tracks: toTracks(hoverPoint) }" data-testid="drop-hint">
    {{ toTracks(hoverPoint) ? 'Suelta aquí los sonidos, vídeos o imágenes para ponerlos en las pistas, donde está la línea' : 'Suelta los vídeos o sonidos para añadirlos al final de tu vídeo (encima de las pistas de sonidos o efectos, van a las pistas)' }}
  </div>
  <PreparingOverlay />
  <ToastBar />
  <ConfirmDialog />
  <RelinkDialog />
  <UpdateDialog />
  <ErrorDialog />
  <KeysPanel />
</template>

<style scoped>
/* Un aviso arriba (no tapa la ventana: se ve dónde se va a soltar). */
.drop-hint {
  position: fixed;
  left: 50%;
  top: 14px;
  transform: translateX(-50%);
  max-width: min(900px, calc(100vw - 40px));
  padding: 14px 24px;
  border: 3px dashed var(--accent);
  border-radius: 16px;
  background: rgb(227 238 246 / 0.96);
  box-shadow: var(--shadow-lg);
  font-size: 20px;
  font-weight: 700;
  text-align: center;
  color: var(--accent-hover);
  z-index: 45;
  pointer-events: none;
}
.drop-hint.tracks {
  border-color: #7b56b0;
  background: rgb(243 237 250 / 0.96);
  color: #5b3590;
}
</style>
