// Qué no puede borrar la limpieza de la caché: lo que usan los vídeos de la lista (sus ficheros, también los
// que solo están en «De mi ordenador», y lo que usan de la biblioteca). Puro; la limpieza la hace la shell
// (src-tauri/src/cache_cleanup.rs).

import type { LibraryCatalog } from './library'
import { usedMediaPaths, type Project } from './project'
import { libraryAssetIds } from './tracks'

export interface CacheProtection {
  /** Ficheros del ordenador: sus proxies, miniaturas y formas de onda se quedan. */
  sources: string[]
  /** Elementos de la biblioteca que se usan. */
  assetIds: string[]
}

export function cacheProtection(projects: readonly Project[]): CacheProtection {
  const sources = new Set<string>()
  const assetIds = new Set<string>()
  for (const p of projects) {
    for (const path of usedMediaPaths(p)) sources.add(path)
    for (const m of p.media) sources.add(m.path)
    for (const id of libraryAssetIds(p)) assetIds.add(id)
  }
  return { sources: [...sources], assetIds: [...assetIds] }
}

/** Nombre de un fichero de la biblioteca en la caché (como `cache_file_name` de library.rs). */
export function libraryCacheName(file: { file: string; sha256: string }): string {
  return `${file.sha256.slice(0, 16)}-${file.file}`
}

/** Nombres en la caché de los elementos de la biblioteca que se usan (y de sus vistas previas). */
export function libraryCacheNames(catalog: LibraryCatalog, assetIds: readonly string[]): string[] {
  const wanted = new Set(assetIds)
  const out: string[] = []
  for (const a of catalog.assets) {
    if (!wanted.has(a.id)) continue
    out.push(libraryCacheName(a))
    if (a.preview) out.push(libraryCacheName(a.preview))
  }
  return out
}
