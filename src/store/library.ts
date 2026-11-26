// Biblioteca de sonidos y efectos en la interfaz: el catálogo (el empaquetado o uno más nuevo de la release),
// qué ficheros están ya descargados, las descargas con su progreso y la información de cada elemento para la
// vista previa y para guardar (sin pasar por ffprobe: la da el catálogo).

import { computed, shallowRef } from 'vue'
import bundledJson from '../../library/catalog.json'
import {
  chooseCatalog,
  findAsset,
  libraryFileUrl,
  validateCatalog,
  type LibraryAsset,
  type LibraryCatalog,
  type LibraryFile,
  type MediaInfo,
  type TrackItem,
} from '../domain'
import { CancelledError, type NativeBridge, type RunningProcess } from '../native/bridge'

/** El catálogo que va con la app. Si no fuera válido (no debería: lo comprueba un test), uno vacío. */
function bundledCatalog(): LibraryCatalog {
  const { catalog, errors } = validateCatalog(bundledJson)
  if (catalog) return catalog
  console.error('[easy-cut] el catálogo de la biblioteca empaquetado no es válido', errors)
  return { schema: 1, revision: 0, baseUrl: 'https://github.com/Krahegwen/easy-cut/releases/download/library-v1/', ownLicense: 'CC0-1.0', categories: [], assets: [] }
}

/** Información de un elemento de la biblioteca ya descargado, sacada del catálogo. */
export function mediaFromAsset(asset: LibraryAsset, path: string): MediaInfo {
  const isEffect = asset.kind === 'effect'
  const codec = asset.format === 'webm' ? 'vp9' : asset.format === 'png' ? 'png' : asset.format === 'mp4' ? 'h264' : 'ninguno'
  return {
    path,
    durationMs: asset.durationMs,
    hasVideo: isEffect,
    width: isEffect ? asset.width ?? 0 : 0,
    height: isEffect ? asset.height ?? 0 : 0,
    codedWidth: isEffect ? asset.width ?? 0 : 0,
    codedHeight: isEffect ? asset.height ?? 0 : 0,
    rotation: 0,
    fps: isEffect && !asset.still ? 30 : 0,
    hasAudio: asset.hasAudio,
    isHdr: false,
    videoCodec: codec,
    pixelFormat: asset.hasAlpha ? (asset.format === 'png' ? 'rgba' : 'yuva420p') : isEffect ? 'yuv420p' : null,
    colorTransfer: null,
    colorPrimaries: null,
    colorSpace: null,
    audioCodec: asset.hasAudio ? 'aac' : null,
    audioSampleRate: asset.hasAudio ? 48_000 : null,
    audioChannels: asset.hasAudio ? asset.channels ?? 2 : null,
    sizeBytes: asset.bytes,
    ...(asset.still ? { isStill: true } : {}),
    ...(asset.hasAlpha ? { hasAlpha: true } : {}),
  }
}

export function createLibraryStore(bridge: NativeBridge, setMedia: (info: MediaInfo) => void) {
  const catalog = shallowRef<LibraryCatalog>(bundledCatalog())
  /** Ruta en la caché de cada fichero descargado (por nombre de fichero). */
  const paths = shallowRef<Record<string, string>>({})
  /** Descargas en marcha: fracción de 0 a 1 por nombre de fichero. */
  const progress = shallowRef<Record<string, number>>({})
  const inFlight = new Map<string, Promise<string>>()
  const running = new Map<string, RunningProcess<string>>()
  let catalogChecked = false
  let statusChecked = false

  const categories = computed(() => catalog.value.categories.filter((c) => catalog.value.assets.some((a) => a.category === c.id)))

  function setPath(file: string, path: string) {
    paths.value = { ...paths.value, [file]: path }
  }

  function setProgress(file: string, value: number | null) {
    const next = { ...progress.value }
    if (value === null) delete next[file]
    else next[file] = value
    progress.value = next
  }

  /** Mira qué hay ya en la caché (sin red). Una vez por sesión, o al cambiar de catálogo. */
  async function refreshStatus(force = false) {
    if (statusChecked && !force) return
    statusChecked = true
    const files: LibraryFile[] = catalog.value.assets.flatMap((a) => (a.preview ? [a, a.preview] : [a]))
    try {
      const found = await bridge.libraryStatus(files)
      const next = { ...paths.value }
      files.forEach((f, i) => {
        const p = found[i]
        if (p) next[f.file] = p
      })
      paths.value = next
      for (const a of catalog.value.assets) if (next[a.file]) setMedia(mediaFromAsset(a, next[a.file]!))
    } catch (e) {
      console.warn('[easy-cut] no se ha podido mirar la caché de la biblioteca', e)
    }
  }

  /** Pide el catálogo de la release (una vez por sesión); si es válido y más nuevo, lo usa. Sin red, nada. */
  async function refreshCatalog() {
    if (catalogChecked) return
    catalogChecked = true
    try {
      const text = await bridge.libraryCatalog(libraryFileUrl(catalog.value, 'catalog.json'))
      if (!text) return
      const next = chooseCatalog(catalog.value, JSON.parse(text))
      if (next !== catalog.value) {
        catalog.value = next
        await refreshStatus(true)
      }
    } catch (e) {
      console.warn('[easy-cut] catálogo de la biblioteca no actualizado', e)
    }
  }

  /** Trae un fichero (si no está ya) y devuelve su ruta. Varias peticiones del mismo comparten la descarga. */
  function ensureFile(ref: LibraryFile): Promise<string> {
    const have = paths.value[ref.file]
    if (have) return Promise.resolve(have)
    const pending = inFlight.get(ref.file)
    if (pending) return pending
    setProgress(ref.file, 0)
    const job = bridge.libraryFetch(ref, libraryFileUrl(catalog.value, ref.file), (p) => setProgress(ref.file, p.total > 0 ? p.received / p.total : 0))
    running.set(ref.file, job)
    const promise = job.result
      .then((path) => {
        setPath(ref.file, path)
        return path
      })
      .finally(() => {
        inFlight.delete(ref.file)
        running.delete(ref.file)
        setProgress(ref.file, null)
      })
    inFlight.set(ref.file, promise)
    return promise
  }

  /** Trae el fichero de un elemento y deja su información lista (para la vista previa y para guardar). */
  async function ensureAsset(asset: LibraryAsset): Promise<string> {
    const path = await ensureFile(asset)
    setMedia(mediaFromAsset(asset, path))
    return path
  }

  /** Vista previa pequeña de un efecto (o null si no tiene o no se ha podido traer). */
  async function ensurePreview(asset: LibraryAsset): Promise<string | null> {
    if (!asset.preview) return null
    try {
      return await ensureFile(asset.preview)
    } catch (e) {
      if (!(e instanceof CancelledError)) console.warn(`[easy-cut] sin vista previa de ${asset.id}`, e)
      return null
    }
  }

  function cancel(file: string) {
    running.get(file)?.cancel()
  }

  function asset(assetId: string): LibraryAsset | null {
    return findAsset(catalog.value, assetId)
  }

  /** Ruta del fichero de un elemento de las pistas (o null si es de la biblioteca y no está descargado). */
  function itemPath(item: TrackItem): string | null {
    if (item.source.type === 'file') return item.source.path
    // «El vídeo de este trozo» no es un fichero de las pistas: lo enseña y lo guarda el propio trozo.
    if (item.source.type !== 'library') return null
    const a = asset(item.source.assetId)
    return a ? paths.value[a.file] ?? null : null
  }

  /** Progreso de la descarga de un elemento (0..1) o null si no se está descargando. */
  function downloadProgress(a: LibraryAsset): number | null {
    return progress.value[a.file] ?? null
  }

  function isDownloaded(a: LibraryAsset): boolean {
    return !!paths.value[a.file]
  }

  return {
    catalog,
    categories,
    paths,
    progress,
    refreshStatus,
    refreshCatalog,
    ensureFile,
    ensureAsset,
    ensurePreview,
    cancel,
    asset,
    itemPath,
    downloadProgress,
    isDownloaded,
  }
}

export type LibraryStore = ReturnType<typeof createLibraryStore>
