// Limpieza de la caché, un rato después de arrancar: junta lo que usan los vídeos de la lista (y el abierto)
// y se lo pasa a la shell, que borra lo viejo sin tocar eso. Si algún vídeo de la lista no se puede leer, no se
// limpia nada (no se sabría qué usa).

import { cacheProtection, libraryCacheNames, parseProject, type Project } from '../domain'
import type { CacheCleanupReport, NativeBridge } from '../native/bridge'
import type { EditorStore } from './editor'
import type { LibraryStore } from './library'

export function createCacheCleaner(bridge: NativeBridge, editor: EditorStore, library: LibraryStore) {
  async function run(force = false): Promise<CacheCleanupReport | null> {
    let projects: Project[]
    try {
      const stored = await bridge.listProjects()
      projects = stored.map((s) => parseProject(s.json))
    } catch (e) {
      console.warn('[easy-cut] no se limpia la caché: no se puede leer algún vídeo de la lista', e)
      return null
    }
    // El abierto puede tener algo que aún no se ha escrito.
    projects.push(editor.history.value.present)
    const { sources, assetIds } = cacheProtection(projects)
    try {
      const report = await bridge.cleanCache(sources, libraryCacheNames(library.catalog.value, assetIds), force)
      if (report.ran) console.info(`[easy-cut] caché limpia: ${report.deleted} ficheros, ${Math.round(report.freedBytes / 1048576)} MB liberados`)
      return report
    } catch (e) {
      console.warn('[easy-cut] no se ha podido limpiar la caché', e)
      return null
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  /** La limpieza, un rato después (para no frenar el arranque). */
  function schedule(delayMs = 30_000) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void run()
    }, delayMs)
  }
  function stop() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { run, schedule, stop }
}

export type CacheCleaner = ReturnType<typeof createCacheCleaner>
