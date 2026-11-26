// Instancia única del store para la ventana. En desarrollo expone `window.__easyCut` para las pruebas
// por CDP (scripts/webview-smoke.mjs y scripts/ui-e2e.mjs); en producción no existe.

import * as domain from '../domain'
import { liveTracks } from '../lib/camera'
import { describeActiveShortcuts } from '../lib/use-shortcuts'
import { createUpdater, type UpdaterBackend } from '../lib/updater'
import { bridge as nativeBridge, isDesktop, type NativeBridge, type PickVideosOptions } from '../native'
import { createTauriUpdaterBackend } from '../native/tauri-updater'
import { createCacheCleaner } from './cache'
import { createEditorStore } from './editor'
import { createLibraryStore } from './library'
import { createSaveFlow } from './save-flow'
import { createTracksStore } from './tracks'
import { createTrimStore } from './trim'

/** Rutas que la prueba e2e mete en lugar del diálogo nativo (solo en desarrollo). */
const devPickQueue: string[][] = []

const appBridge: NativeBridge = import.meta.env.DEV
  ? {
      ...nativeBridge,
      pickVideos(options?: PickVideosOptions) {
        const queued = devPickQueue.shift()
        return queued ? Promise.resolve(queued) : nativeBridge.pickVideos(options)
      },
    }
  : nativeBridge

export type { PreparingItem, ProjectListEntry, RelinkCandidate, RelinkOffer, Screen } from './editor'

export const store = createEditorStore(appBridge)
export const library = createLibraryStore(appBridge, store.setMedia)
export const tracks = createTracksStore(store, library)
export const saveFlow = createSaveFlow(store, library, { appVersion: __APP_VERSION__ })
export const cacheCleaner = createCacheCleaner(appBridge, store, library)
export const trim = createTrimStore(store, saveFlow)

/** ¿Se actualiza sola? Solo la app instalada (compilación release); ni `tauri dev` ni el navegador. */
export const updaterEnabled = isDesktop && !import.meta.env.DEV

/** Versión instalada (la de package.json, que es también la de tauri.conf.json). */
export const appVersion = __APP_VERSION__

const disabledBackend: UpdaterBackend = {
  check: () => Promise.resolve(null),
  relaunch: () => Promise.resolve(),
}

export const updater = createUpdater({
  backend: updaterEnabled ? createTauriUpdaterBackend() : disabledBackend,
  beforeInstall: () => store.flushAutosave(),
  // Solo se ofrece en Inicio y en «Tu vídeo», y nunca con un guardado o la cámara/micrófono en marcha.
  busy: () => {
    const screen = store.screen.value
    return (screen !== 'home' && screen !== 'editor') || saveFlow.running.value || liveTracks().length > 0
  },
})

export function useStore() {
  return store
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__easyCut = {
    bridge: nativeBridge,
    domain,
    store,
    saveFlow,
    updater,
    library,
    tracks,
    trim,
    cacheCleaner,
    /** La próxima vez que la interfaz abra «elegir vídeos», devuelve estas rutas sin diálogo. */
    queuePickedVideos(paths: string[]) {
      devPickQueue.push(paths)
    },
    /** Pistas de cámara y micrófono que siguen encendidas (deben ser cero fuera del teleprompter). */
    liveTracks,
    /** Atajos que valen ahora (capas activas): para contrastar las teclas dibujadas con lo que hacen. */
    shortcuts: describeActiveShortcuts,
    /**
     * Punto de partida limpio para las pruebas: sin vídeos en marcha ni autoguardado de antes (en desarrollo
     * todo esto está en la subcarpeta `pruebas`). Deja la app en Inicio con un vídeo vacío.
     */
    async resetProjects() {
      // Primero, que acabe la lectura del arranque (que puede estar pasando a la lista el autoguardado de antes).
      await store.loadProjects()
      store.startNewProject()
      await store.flushAutosave()
      for (const p of await nativeBridge.listProjects()) await nativeBridge.deleteProject(p.id)
      await nativeBridge.clearAutosave()
      await store.loadProjects()
      store.go('home')
      return true
    },
  }
}
