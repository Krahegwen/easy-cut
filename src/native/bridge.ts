// Contrato entre la interfaz (Vue) y la shell de escritorio. Implementaciones: tauri-bridge.ts (la app)
// y browser-bridge.ts (abrir la UI en el navegador durante el desarrollo). Independiente de la plataforma.
// Todo lo de ffmpeg se pasa como array de argumentos.

import type { EncoderProbeResults } from '../domain/encoders'
import type { MediaInfo, TimeRange } from '../domain/project'
import type { ProgressUpdate } from '../domain/progress'

export interface CancelToken {
  readonly cancelled: boolean
}

/** Proceso en marcha que se puede cancelar. */
export interface RunningProcess<T> {
  /** Se resuelve al terminar; se rechaza con CancelledError si se cancela. */
  readonly result: Promise<T>
  cancel(): void
}

export interface ProcessResult {
  exitCode: number
  /** stderr completo (o sus últimas líneas, si es enorme), para diagnosticar. */
  stderr: string
}

export interface PickVideosOptions {
  multiple?: boolean
  /** Carpeta en la que abrir el diálogo (por defecto, Vídeos del usuario). */
  defaultFolder?: string
}

export interface ThumbnailRequest {
  path: string
  /** Instantes del original (ms). */
  timesMs: number[]
  /** Alto de cada miniatura en píxeles. */
  height: number
}

export interface Thumbnail {
  timeMs: number
  /** URL que la interfaz puede poner en un <img> (asset://, blob:, file://…). */
  url: string
  width: number
  height: number
}

export interface SavedRecording {
  path: string
  durationMs: number
}

export type ProgressCallback = (update: ProgressUpdate) => void

export interface FileDropHandlers {
  /** Rutas soltadas en la ventana (ficheros de cualquier tipo: filtrar en la interfaz). */
  onDrop(paths: string[]): void
  /** true al entrar arrastrando ficheros sobre la ventana, false al salir o soltar. */
  onHover?(hovering: boolean): void
}

export interface NativeBridge {
  /** Diálogo para elegir vídeos. Devuelve las rutas elegidas (vacío si se cancela). */
  pickVideos(options?: PickVideosOptions): Promise<string[]>

  /** Ejecuta ffprobe sobre el fichero y devuelve su información (ver domain/probe.ts). */
  probe(path: string): Promise<MediaInfo>

  /** ¿Sigue existiendo el fichero? (para avisar de originales movidos o borrados). */
  exists(path: string): Promise<boolean>

  /**
   * URL para reproducir el original en un <video> (o mostrarlo en un <img>). Admite seek (range requests).
   * Si el <video> da error o no tiene pista de vídeo, pedir makePreviewProxy y usar mediaUrl(proxy).
   */
  mediaUrl(path: string): string

  /**
   * Copia ligera para la vista previa (H.264 540p + AAC, mismos tiempos que el original), cacheada.
   * Devuelve su ruta. onProgress recibe el avance de ffmpeg.
   */
  makePreviewProxy(path: string, onProgress?: ProgressCallback): RunningProcess<string>

  /**
   * Lanza ffmpeg con estos argumentos. onLine recibe cada línea de stdout (`-progress pipe:1`);
   * onStderrLine, cada línea de stderr.
   */
  runFfmpeg(
    args: readonly string[],
    onLine: (line: string) => void,
    onStderrLine?: (line: string) => void,
  ): RunningProcess<ProcessResult>

  /** Escribe un fichero de texto temporal (p. ej. el filter_complex) y devuelve su ruta. */
  writeTempTextFile(name: string, contents: string): Promise<string>

  /** Detecta silencios del rango dado del original (silencedetect). Tiempos del original. */
  detectSilences(path: string, range: TimeRange, options?: { noiseDb?: number; minSilenceMs?: number }): RunningProcess<TimeRange[]>

  /** Miniaturas en instantes concretos (para la tira de trozos y el filmstrip). Cacheadas en disco. */
  thumbnails(request: ThumbnailRequest): RunningProcess<Thumbnail[]>

  /** Prueba qué encoders funcionan en este PC (ver domain/encoders.ts). Se prueba una vez por sesión. */
  probeEncoders(): Promise<EncoderProbeResults>

  /** Carpeta donde se guardan los vídeos exportados: Vídeos\Mis montajes (se crea si no existe). */
  getOutputFolder(): Promise<string>
  pickOutputFolder(): Promise<string | null>
  /** Nombres de fichero que ya existen en una carpeta (para no sobrescribir). */
  listFileNames(folder: string): Promise<string[]>
  joinPath(...parts: string[]): string

  /** Abre el fichero con la aplicación predeterminada. */
  openFile(path: string): Promise<void>
  /** Abre el Explorador con el fichero seleccionado (o la carpeta, si se da una carpeta). */
  revealInFolder(path: string): Promise<void>
  /** Copia el fichero al portapapeles como fichero (para pegarlo con Ctrl+V en WhatsApp). */
  copyFileToClipboard(path: string): Promise<void>

  /** Autoguardado del proyecto en curso (uno solo), en la carpeta de datos de la app. */
  saveAutosave(json: string): Promise<void>
  loadAutosave(): Promise<string | null>
  clearAutosave(): Promise<void>

  /** Guarda el proyecto (JSON de domain/project.ts). Sin ruta, pregunta dónde. Devuelve la ruta o null si se cancela. */
  saveProject(json: string, path?: string): Promise<string | null>
  /** Abre un proyecto guardado. Sin ruta, pregunta cuál. */
  loadProject(path?: string): Promise<{ path: string; json: string } | null>

  /**
   * Guarda una grabación de MediaRecorder (teleprompter) en Vídeos\Mis montajes\Grabaciones, sin sobrescribir,
   * convertida a MP4 H.264 + AAC CFR. Devuelve la ruta del MP4 y su duración.
   */
  saveRecording(data: Blob | ArrayBuffer, suggestedName: string, onProgress?: ProgressCallback): Promise<SavedRecording>

  /** Ficheros arrastrados a la ventana. Devuelve la función para dejar de escuchar. */
  onFilesDropped(handlers: FileDropHandlers): () => void
}

export class CancelledError extends Error {
  constructor() {
    super('Operación cancelada')
    this.name = 'CancelledError'
  }
}

/** Une partes de una ruta de Windows («C:\a» + «b.mp4» → «C:\a\b.mp4»). */
export function joinWindowsPath(...parts: string[]): string {
  const cleaned = parts.filter((p) => p !== '')
  return cleaned
    .map((p, i) => {
      let s = p.replace(/\//g, '\\')
      if (i > 0) s = s.replace(/^\\+/, '')
      if (i < cleaned.length - 1) s = s.replace(/\\+$/, '')
      return s
    })
    .join('\\')
}
