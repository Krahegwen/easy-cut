// Instancia única del store para la ventana. En desarrollo expone `window.__easyCut` para las pruebas
// por CDP (scripts/webview-smoke.mjs y scripts/ui-e2e.mjs); en producción no existe.

import * as domain from '../domain'
import { liveTracks } from '../lib/camera'
import { describeActiveShortcuts } from '../lib/use-shortcuts'
import { bridge as nativeBridge, type NativeBridge, type PickVideosOptions } from '../native'
import { createEditorStore } from './editor'
import { createSaveFlow } from './save-flow'

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

export type { PreparingItem, Screen } from './editor'

export const store = createEditorStore(appBridge)
export const saveFlow = createSaveFlow(store)

export function useStore() {
  return store
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__easyCut = {
    bridge: nativeBridge,
    domain,
    store,
    saveFlow,
    /** La próxima vez que la interfaz abra «elegir vídeos», devuelve estas rutas sin diálogo. */
    queuePickedVideos(paths: string[]) {
      devPickQueue.push(paths)
    },
    /** Pistas de cámara y micrófono que siguen encendidas (deben ser cero fuera del teleprompter). */
    liveTracks,
    /** Atajos que valen ahora (capas activas): para contrastar las teclas dibujadas con lo que hacen. */
    shortcuts: describeActiveShortcuts,
  }
}
