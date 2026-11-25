// UpdaterBackend sobre los plugins oficiales de Tauri: updater (buscar, descargar, comprobar la firma e
// instalar) y process (reiniciar). El endpoint y la clave pública están en plugins.updater de tauri.conf.json.

import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent as PluginDownloadEvent } from '@tauri-apps/plugin-updater'
import type { AvailableUpdate, DownloadEvent, UpdaterBackend } from '../lib/updater'

function toEvent(e: PluginDownloadEvent): DownloadEvent {
  if (e.event === 'Started') return { kind: 'started', totalBytes: e.data.contentLength ?? null }
  if (e.event === 'Progress') return { kind: 'progress', chunkBytes: e.data.chunkLength }
  return { kind: 'finished' }
}

export function createTauriUpdaterBackend(): UpdaterBackend {
  return {
    async check() {
      // Un tiempo máximo para no dejar la comprobación colgada si la red va mal.
      const update = await check({ timeout: 30_000 })
      if (!update) return null
      const wrapped: AvailableUpdate = {
        version: update.version,
        download: (onEvent) => update.download((e) => onEvent(toEvent(e))),
        install: () => update.install(),
        close: () => update.close(),
      }
      return wrapped
    },
    relaunch: () => relaunch(),
  }
}
