// Contrato entre la interfaz (Vue) y la shell de escritorio. Implementaciones: tauri-bridge.ts (la app)
// y browser-bridge.ts (abrir la UI en el navegador durante el desarrollo). Independiente de la plataforma.
// Todo lo de ffmpeg se pasa como array de argumentos.

import type { EncoderProbeResults } from '../domain/encoders'
import type { MediaInfo, TimeRange } from '../domain/project'
import type { ProgressUpdate } from '../domain/progress'
import type { RecordingKind } from '../domain/recording'

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
  /** Aceptar también ficheros de sonido (m4a, mp3, wav…), para añadirlos al montaje. */
  sounds?: boolean
}

export interface WaveformRequest {
  path: string
  width: number
  height: number
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
  /**
   * 'video' = MP4 H.264 + AAC; 'audio' = M4A (AAC, 48 kHz) de solo la voz, que entra en el montaje
   * como un trozo sin imagen («Solo se oye»).
   */
  kind: RecordingKind
}

export type ProgressCallback = (update: ProgressUpdate) => void

/**
 * Grabación que se va escribiendo al disco por partes mientras se graba (no se acumula en memoria).
 * Hay que terminarla con save() o discard().
 */
export interface RecordingWriter {
  /** Fichero temporal con lo grabado hasta ahora (se puede reproducir con mediaUrl para revisarlo). */
  readonly tempPath: string
  /** Añade un trozo de datos del grabador. Los trozos se escriben en el orden en que se llaman. */
  append(data: Blob): Promise<void>
  /**
   * Convierte lo grabado a MP4 H.264 + AAC CFR (o, si es solo la voz, a M4A AAC 48 kHz) en
   * Vídeos\Mis montajes\Grabaciones, sin sobrescribir, y borra el temporal. `expectedDurationMs` sirve
   * para el porcentaje del progreso.
   */
  save(onProgress?: ProgressCallback, expectedDurationMs?: number): Promise<SavedRecording>
  /** Descarta la grabación: borra el temporal y no deja nada. */
  discard(): Promise<void>
}

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

  /**
   * Forma de onda de todo el sonido del fichero (PNG transparente de width × height), para la tira de
   * «Cortar» y «Quitar pausas» de un original sin imagen. Cacheada en disco como las miniaturas.
   */
  waveform(request: WaveformRequest): RunningProcess<Thumbnail>

  /** Prueba qué encoders funcionan en este PC (ver domain/encoders.ts). Se prueba una vez por sesión. */
  probeEncoders(): Promise<EncoderProbeResults>

  /**
   * Carpeta donde se guardan los vídeos exportados: Vídeos\Mis montajes (se crea si no existe).
   * La app de desarrollo usa Vídeos\Mis montajes (pruebas).
   */
  getOutputFolder(): Promise<string>
  pickOutputFolder(): Promise<string | null>
  /** Nombres de fichero que ya existen en una carpeta (para no sobrescribir). */
  listFileNames(folder: string): Promise<string[]>
  joinPath(...parts: string[]): string

  /**
   * Borra un vídeo a medias (exportación cancelada o fallida). Solo admite .mp4 dentro de la carpeta
   * de getOutputFolder(): nunca toca un original. No falla si el fichero ya no existe.
   */
  deletePartialOutput(path: string): Promise<void>

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
   * convertida a MP4 H.264 + AAC CFR; si el Blob es de audio (`audio/…`), a M4A de solo la voz.
   * Devuelve la ruta, su duración y qué es.
   */
  saveRecording(data: Blob | ArrayBuffer, suggestedName: string, onProgress?: ProgressCallback): Promise<SavedRecording>

  /**
   * Empieza una grabación que se escribe por partes (teleprompter). `extension` es la del formato del
   * grabador (mp4, m4a, webm o mkv); `kind`, si es con vídeo o solo la voz. El resultado final es el
   * mismo que el de saveRecording.
   */
  beginRecording(suggestedName: string, extension?: string, kind?: RecordingKind): Promise<RecordingWriter>

  /**
   * Borra una grabación ya guardada («Repetir» una de solo la voz). Solo admite .mp4 y .m4a dentro de
   * la carpeta de getOutputFolder(). No falla si ya no existe.
   */
  deleteRecording(path: string): Promise<void>

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
