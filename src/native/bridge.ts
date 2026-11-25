// Contrato entre la interfaz (Vue) y la shell de escritorio (Tauri 2 o Electron, por decidir).
// Solo la interfaz: la shell la implementará. Todo lo de ffmpeg se pasa como array de argumentos.

import type { MediaInfo, TimeRange } from '../domain/project'

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
  /** Carpeta en la que abrir el diálogo. */
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

export interface NativeBridge {
  /** Diálogo para elegir vídeos. Devuelve las rutas elegidas (vacío si se cancela). */
  pickVideos(options?: PickVideosOptions): Promise<string[]>

  /** Ejecuta ffprobe sobre el fichero y devuelve su información (ver domain/probe.ts). */
  probe(path: string): Promise<MediaInfo>

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

  /** Detecta silencios del rango dado del original (silencedetect). */
  detectSilences(path: string, range: TimeRange, options?: { noiseDb?: number; minSilenceMs?: number }): RunningProcess<TimeRange[]>

  /** Miniaturas en instantes concretos (para la tira de trozos y el filmstrip). */
  thumbnails(request: ThumbnailRequest): RunningProcess<Thumbnail[]>

  /** Prueba qué encoders hardware funcionan en este PC (ver domain/encoders.ts). */
  probeEncoders(): Promise<Partial<Record<string, boolean>>>

  /** Carpeta donde se guardan los vídeos exportados (por defecto, Vídeos del usuario). */
  getOutputFolder(): Promise<string>
  pickOutputFolder(): Promise<string | null>
  /** Nombres de fichero que ya existen en una carpeta (para no sobrescribir). */
  listFileNames(folder: string): Promise<string[]>
  joinPath(...parts: string[]): string

  /** Abre el fichero con la aplicación predeterminada. */
  openFile(path: string): Promise<void>
  /** Abre la carpeta en el Explorador, con el fichero seleccionado si se da. */
  revealInFolder(path: string): Promise<void>

  /** Guarda el proyecto (JSON de domain/project.ts). Sin ruta, pregunta dónde. Devuelve la ruta o null si se cancela. */
  saveProject(json: string, path?: string): Promise<string | null>
  /** Abre un proyecto guardado. Sin ruta, pregunta cuál. */
  loadProject(path?: string): Promise<{ path: string; json: string } | null>

  /** Guarda una grabación hecha desde la interfaz (teleprompter) y devuelve su ruta. */
  saveRecording(data: Blob | ArrayBuffer, suggestedName: string): Promise<SavedRecording>
}

export class CancelledError extends Error {
  constructor() {
    super('Operación cancelada')
    this.name = 'CancelledError'
  }
}
