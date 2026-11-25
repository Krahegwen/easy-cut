// Grabación con la cámara: reloj que no cuenta las pausas, formato del grabador, nivel del micrófono
// y los errores de la cámara dichos en llano. Puro: sin DOM (el componente le pasa los datos).

// ------------------------------------------------------------------ reloj de grabación

export interface RecordingClock {
  /** Tiempo acumulado de los tramos ya cerrados (ms). */
  accumulatedMs: number
  /** Instante en que empezó el tramo en curso, o null si está en pausa / parado. */
  runningSince: number | null
}

export function createClock(): RecordingClock {
  return { accumulatedMs: 0, runningSince: null }
}

export function clockStart(clock: RecordingClock, now: number): RecordingClock {
  return clock.runningSince === null ? { ...clock, runningSince: now } : clock
}

export function clockPause(clock: RecordingClock, now: number): RecordingClock {
  if (clock.runningSince === null) return clock
  return { accumulatedMs: clock.accumulatedMs + Math.max(0, now - clock.runningSince), runningSince: null }
}

/** Tiempo grabado hasta `now`, sin contar las pausas. */
export function clockElapsed(clock: RecordingClock, now: number): number {
  return Math.round(clock.accumulatedMs + (clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince)))
}

export function clockRunning(clock: RecordingClock): boolean {
  return clock.runningSince !== null
}

// ------------------------------------------------------------------ formato del grabador

/**
 * Formatos de MediaRecorder por orden de preferencia. El MP4 (H.264 + AAC) que da WebView2 sabe su
 * duración y se puede revisar con normalidad; el WebM queda de reserva. Todo se convierte luego a MP4
 * H.264 + AAC de imagen constante (saveRecording).
 */
export const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const

/**
 * Qué se graba: «Grabarme en vídeo» (cámara y micrófono) o «Grabar solo la voz» (solo micrófono;
 * la cámara no se pide nunca). La de solo voz acaba en un M4A que, de momento, no entra en el montaje.
 */
export type RecordingKind = 'video' | 'audio'

/** Formatos de MediaRecorder para solo la voz: AAC en MP4 si se puede (sabe su duración), si no Opus. */
export const AUDIO_RECORDER_MIME_CANDIDATES = ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const

/** Candidatos según lo que se graba. */
export function recorderMimeCandidates(kind: RecordingKind): readonly string[] {
  return kind === 'audio' ? AUDIO_RECORDER_MIME_CANDIDATES : RECORDER_MIME_CANDIDATES
}

/** Extensión del fichero final: MP4 con vídeo, M4A (AAC) con solo la voz. */
export function recordingOutputExtension(kind: RecordingKind): 'mp4' | 'm4a' {
  return kind === 'audio' ? 'm4a' : 'mp4'
}

/** Bits por segundo pedidos al grabador: generosos, que la conversión ya comprime. */
export const RECORDER_VIDEO_BPS = 8_000_000
export const RECORDER_AUDIO_BPS = 160_000
/** Cada cuánto entrega datos el grabador (ms): se escriben al disco por partes. */
export const RECORDER_TIMESLICE_MS = 1000

/** El primer formato que admite el grabador, o '' (que elija él). */
export function chooseRecorderMimeType(isSupported: (type: string) => boolean, candidates: readonly string[] = RECORDER_MIME_CANDIDATES): string {
  for (const type of candidates) {
    try {
      if (isSupported(type)) return type
    } catch {
      // Un navegador que lanza en vez de responder: se prueba el siguiente.
    }
  }
  return ''
}

/** Extensión del fichero temporal según el formato real del grabador. */
export function recordingExtension(mimeType: string): 'mp4' | 'm4a' | 'webm' | 'mkv' {
  const t = mimeType.toLowerCase()
  if (t.startsWith('video/mp4')) return 'mp4'
  if (t.startsWith('audio/mp4')) return 'm4a'
  if (t.includes('matroska')) return 'mkv'
  return 'webm'
}

// ------------------------------------------------------------------ calidad pedida a la cámara

export const CAMERA_IDEAL = { width: 1920, height: 1080, frameRate: 30 } as const

/**
 * Restricciones de getUserMedia: 1080p30 ideal (lo que dé la cámara si no) y un sonido limpio para la voz.
 * Con solo la voz, `video: false`: la cámara no se pide.
 */
export function mediaConstraints(
  cameraId: string | null,
  micId: string | null,
  kind: RecordingKind = 'video',
): { video: Record<string, unknown> | false; audio: Record<string, unknown> } {
  return {
    video:
      kind === 'audio'
        ? false
        : {
            ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
            width: { ideal: CAMERA_IDEAL.width },
            height: { ideal: CAMERA_IDEAL.height },
            frameRate: { ideal: CAMERA_IDEAL.frameRate },
          },
    audio: {
      ...(micId ? { deviceId: { exact: micId } } : {}),
      // Mientras se graba no suena nada por los altavoces: el anulador de eco solo estropearía la voz.
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48_000 },
    },
  }
}

// ------------------------------------------------------------------ nivel del micrófono

export type MicLevel = 'waiting' | 'good' | 'low' | 'silent'

/** Por debajo de esto (pico, en dB respecto al máximo) no entra sonido. */
export const MIC_SILENT_DB = -60
/** Por debajo de esto la voz se oirá muy baja. */
export const MIC_LOW_DB = -32
/** Ventana en la que se mira el pico más alto (ms): hablar a ratos no debe dar «no se oye». */
export const MIC_WINDOW_MS = 3000

/** Pico (0..1) a dB, con suelo en -100. */
export function peakToDb(peak: number): number {
  if (!(peak > 0)) return -100
  return Math.max(-100, 20 * Math.log10(peak))
}

export interface LevelSample {
  timeMs: number
  peak: number
}

/** Quita las muestras que ya se salen de la ventana. */
export function trimSamples(samples: readonly LevelSample[], now: number, windowMs = MIC_WINDOW_MS): LevelSample[] {
  return samples.filter((s) => now - s.timeMs <= windowMs)
}

/** Estado del micrófono con el pico más alto de la ventana. Hasta llenar la ventana, «waiting» si no hay voz. */
export function micLevel(samples: readonly LevelSample[], now: number, listeningSinceMs: number, windowMs = MIC_WINDOW_MS): MicLevel {
  const recent = trimSamples(samples, now, windowMs)
  const maxDb = peakToDb(Math.max(0, ...recent.map((s) => s.peak)))
  if (maxDb >= MIC_LOW_DB) return 'good'
  if (now - listeningSinceMs < windowMs) return 'waiting'
  return maxDb < MIC_SILENT_DB ? 'silent' : 'low'
}

export function describeMicLevel(level: MicLevel): string {
  switch (level) {
    case 'good':
      return 'Se te oye bien'
    case 'low':
      return 'Se te oye muy bajo: acércate al micrófono o habla un poco más alto'
    case 'silent':
      return 'No se oye nada: comprueba el micrófono'
    default:
      return 'Di algo para probar el micrófono'
  }
}

/** Fracción (0..1) para pintar la barra del medidor: de -60 dB a 0 dB. */
export function meterFraction(peak: number): number {
  const db = peakToDb(peak)
  return Math.min(1, Math.max(0, (db - MIC_SILENT_DB) / -MIC_SILENT_DB))
}

// ------------------------------------------------------------------ errores de la cámara

export interface CameraProblem {
  title: string
  /** Qué hacer para arreglarlo. */
  fix: string
  /** ¿Puede servir pasar a «Grabar solo la voz»? (no, si lo que falta es el micrófono). */
  voiceOnlyMayHelp: boolean
}

/**
 * Errores de getUserMedia (por su `name`) dichos en llano, con qué hacer. Con `kind` 'audio' solo se
 * pidió el micrófono, así que el problema es siempre del micrófono.
 */
export function describeCameraError(name: string, missing: 'camera' | 'microphone' | 'both' | null = null, kind: RecordingKind = 'video'): CameraProblem {
  const voice = kind === 'audio'
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return voice
        ? {
            title: 'No tengo permiso para usar el micrófono',
            fix: 'Abre Configuración de Windows › Privacidad y seguridad › Micrófono, activa el acceso para las aplicaciones de escritorio y pulsa «Probar otra vez».',
            voiceOnlyMayHelp: false,
          }
        : {
            title: 'No tengo permiso para usar la cámara o el micrófono',
            fix: 'Abre Configuración de Windows › Privacidad y seguridad › Cámara (y también Micrófono), activa el acceso para las aplicaciones de escritorio y pulsa «Probar otra vez».',
            voiceOnlyMayHelp: true,
          }
    case 'NotFoundError':
    case 'OverconstrainedError':
      if (voice || missing === 'microphone') {
        return { title: 'No encuentro ningún micrófono', fix: 'Conecta un micrófono (o unos auriculares con micrófono) y pulsa «Probar otra vez».', voiceOnlyMayHelp: false }
      }
      if (missing === 'both') {
        return { title: 'No encuentro ni cámara ni micrófono', fix: 'Conecta una cámara con micrófono y pulsa «Probar otra vez».', voiceOnlyMayHelp: false }
      }
      return {
        title: 'No encuentro ninguna cámara',
        fix: 'Conecta una cámara (o comprueba que no esté tapada o apagada) y pulsa «Probar otra vez». O graba solo tu voz.',
        voiceOnlyMayHelp: true,
      }
    case 'NotReadableError':
    case 'AbortError':
      return voice
        ? {
            title: 'El micrófono está ocupado',
            fix: 'Seguramente lo está usando otro programa (una videollamada, por ejemplo). Ciérralo y pulsa «Probar otra vez».',
            voiceOnlyMayHelp: false,
          }
        : {
            title: 'La cámara está ocupada',
            fix: 'Seguramente la está usando otro programa (una videollamada, por ejemplo). Ciérralo y pulsa «Probar otra vez». O graba solo tu voz.',
            voiceOnlyMayHelp: true,
          }
    default:
      return voice
        ? { title: 'No he podido encender el micrófono', fix: 'Desconecta y vuelve a conectar el micrófono y pulsa «Probar otra vez».', voiceOnlyMayHelp: false }
        : {
            title: 'No he podido encender la cámara',
            fix: 'Desconecta y vuelve a conectar la cámara y pulsa «Probar otra vez». Si sigue igual, reinicia el ordenador. O graba solo tu voz.',
            voiceOnlyMayHelp: true,
          }
  }
}

// ------------------------------------------------------------------ nombre de la grabación

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «Grabación del 25 de noviembre de 2026, 18.05» (sin dos puntos: no valen en un nombre de fichero). */
export function recordingName(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `Grabación del ${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}, ${hh}.${mm}`
}
