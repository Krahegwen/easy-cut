// Elegir o soltar vídeos y añadirlos como trozos (con «Preparando tus vídeos…» y los que fallen).
import { shallowRef } from 'vue'
import { isVideoPath } from '../domain'
import { store, type PreparingItem } from '../store'

/** Vídeos que no se han podido leer en la última tanda (se enseñan hasta que se cierra el aviso). */
export const failedVideos = shallowRef<PreparingItem[]>([])
/** Ficheros soltados que no son vídeos. */
export const ignoredFiles = shallowRef<string[]>([])

export async function addVideos(paths: string[]): Promise<number> {
  const videos = paths.filter(isVideoPath)
  ignoredFiles.value = paths.filter((p) => !isVideoPath(p))
  if (videos.length === 0) {
    if (ignoredFiles.value.length > 0) store.showToast('Eso no parece un vídeo. Suelta aquí ficheros de vídeo.')
    return 0
  }
  const { added, failed } = await store.addClipsFromPaths(videos)
  failedVideos.value = failed
  if (added > 0 && store.screen.value === 'pick') store.go('editor')
  return added
}

export async function pickAndAddVideos(): Promise<number> {
  let paths: string[]
  try {
    paths = await store.bridge.pickVideos({ multiple: true })
  } catch (e) {
    store.showError('No se ha podido abrir la ventana para elegir vídeos.', e)
    return 0
  }
  if (paths.length === 0) return 0
  return addVideos(paths)
}

export function dismissFailures() {
  failedVideos.value = []
}
