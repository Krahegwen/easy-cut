// Bridge mínimo para abrir la interfaz en un navegador normal durante el desarrollo (pnpm dev).
// Lo que necesita el sistema (ffmpeg, diálogos, ficheros) lanza un error claro; lo inofensivo funciona.

import type { EncoderProbeResults } from '../domain/encoders'
import { joinWindowsPath, type NativeBridge, type RunningProcess } from './bridge'

const AUTOSAVE_KEY = 'easy-cut:autosave'

export class DesktopOnlyError extends Error {
  constructor(what: string) {
    super(`«${what}» solo funciona en la aplicación de escritorio (pnpm tauri dev), no en el navegador.`)
    this.name = 'DesktopOnlyError'
  }
}

function unavailable(what: string): Promise<never> {
  return Promise.reject(new DesktopOnlyError(what))
}

function unavailableProcess<T>(what: string): RunningProcess<T> {
  return { result: unavailable(what), cancel() {} }
}

export function createBrowserBridge(): NativeBridge {
  return {
    pickVideos: () => unavailable('Elegir vídeos'),
    probe: () => unavailable('Leer un vídeo'),
    exists: () => Promise.resolve(false),
    // En el navegador no hay acceso a rutas locales: se devuelve tal cual (sirve para URL http de prueba).
    mediaUrl: (path) => path,
    makePreviewProxy: () => unavailableProcess('Preparar la vista previa'),
    runFfmpeg: () => unavailableProcess('Exportar'),
    writeTempTextFile: () => unavailable('Escribir ficheros'),
    detectSilences: () => unavailableProcess('Quitar pausas'),
    thumbnails: () => unavailableProcess('Miniaturas'),
    waveform: () => unavailableProcess('Dibujar el sonido'),
    probeEncoders: () => Promise.resolve<EncoderProbeResults>({ libx264: true }),
    getOutputFolder: () => Promise.resolve('C:\\Users\\Usuario\\Videos\\Mis montajes'),
    pickOutputFolder: () => unavailable('Elegir carpeta'),
    listFileNames: () => Promise.resolve([]),
    joinPath: (...parts) => joinWindowsPath(...parts),
    deletePartialOutput: () => Promise.resolve(),
    outputFileSize: () => Promise.resolve(null),
    // En el navegador no se guarda nada, así que tampoco hay registro.
    appendSaveLog: () => Promise.resolve(),
    openFile: () => unavailable('Abrir el vídeo'),
    revealInFolder: () => unavailable('Mostrar en la carpeta'),
    copyFileToClipboard: () => unavailable('Copiar al portapapeles'),
    // En el navegador no se pueden leer los ficheros del portapapeles: nunca hay ninguno.
    clipboardSequence: () => Promise.resolve(0),
    clipboardFiles: () => Promise.resolve({ sequence: 0, paths: [] }),
    saveAutosave(json) {
      try {
        localStorage.setItem(AUTOSAVE_KEY, json)
      } catch {
        // Sin almacenamiento (modo privado): no pasa nada en desarrollo.
      }
      return Promise.resolve()
    },
    loadAutosave() {
      try {
        return Promise.resolve(localStorage.getItem(AUTOSAVE_KEY))
      } catch {
        return Promise.resolve(null)
      }
    },
    clearAutosave() {
      try {
        localStorage.removeItem(AUTOSAVE_KEY)
      } catch {
        // Igual que arriba.
      }
      return Promise.resolve()
    },
    saveProject: () => unavailable('Guardar el proyecto'),
    loadProject: () => unavailable('Abrir un proyecto'),
    saveRecording: () => unavailable('Guardar la grabación'),
    beginRecording: () => unavailable('Grabar'),
    deleteRecording: () => unavailable('Borrar la grabación'),
    libraryStatus: (files) => Promise.resolve(files.map(() => null)),
    libraryFetch: () => unavailableProcess('Descargar de la biblioteca'),
    libraryCatalog: () => Promise.resolve(null),
    onFilesDropped: () => () => {},
  }
}
