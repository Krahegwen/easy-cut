// Elegir o soltar vídeos (o sonidos) y añadirlos como trozos (con «Preparando tus vídeos…» y los que fallen).
import { shallowRef } from 'vue'
import { isMediaPath } from '../domain'
import { store, type PreparingItem } from '../store'

/** Ficheros que no se han podido leer en la última tanda (se enseñan hasta que se cierra el aviso). */
export const failedVideos = shallowRef<PreparingItem[]>([])
/** Ficheros soltados que no son ni vídeos ni sonidos. */
export const ignoredFiles = shallowRef<string[]>([])

export async function addVideos(paths: string[]): Promise<number> {
  const accepted = paths.filter(isMediaPath)
  ignoredFiles.value = paths.filter((p) => !isMediaPath(p))
  if (accepted.length === 0) {
    if (ignoredFiles.value.length > 0) store.showToast('Eso no parece un vídeo ni un sonido. Suelta aquí ficheros de vídeo o de sonido.')
    return 0
  }
  const { added, failed } = await store.addClipsFromPaths(accepted)
  failedVideos.value = failed
  if (added > 0 && store.screen.value === 'pick') store.go('editor')
  return added
}

export async function pickAndAddVideos(): Promise<number> {
  let paths: string[]
  try {
    paths = await store.bridge.pickVideos({ multiple: true, sounds: true })
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
