// Instancia del bridge: la de Tauri dentro de la app; en un navegador normal, la mínima de desarrollo.

import type { NativeBridge } from './bridge'
import { createBrowserBridge } from './browser-bridge'
import { createTauriBridge } from './tauri-bridge'

export * from './bridge'

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const bridge: NativeBridge = isDesktop ? createTauriBridge() : createBrowserBridge()
