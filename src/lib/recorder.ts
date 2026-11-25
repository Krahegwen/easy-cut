// Grabador: MediaRecorder sobre el stream de la cámara (o solo del micrófono), escribiendo al disco por
// partes (cada segundo) con el RecordingWriter del bridge. Pausar pausa de verdad la grabación (no queda
// hueco en el fichero).
import {
  chooseRecorderMimeType,
  RECORDER_AUDIO_BPS,
  RECORDER_TIMESLICE_MS,
  RECORDER_VIDEO_BPS,
  recorderMimeCandidates,
  recordingExtension,
  type RecordingKind,
} from '../domain'
import type { NativeBridge, RecordingWriter } from '../native/bridge'

export interface Recorder {
  readonly kind: RecordingKind
  readonly mimeType: string
  readonly writer: RecordingWriter
  start(): void
  pause(): void
  resume(): void
  /** Para el grabador y espera a que todo lo grabado esté escrito en el disco. */
  stop(): Promise<void>
  /** Para (si hace falta) y borra lo grabado. */
  discard(): Promise<void>
}

/**
 * Prepara el grabador y el fichero temporal. `onError` recibe los fallos de escritura o del grabador
 * (disco lleno, cámara desconectada…), que no deben pasar en silencio.
 */
export async function createRecorder(
  bridge: NativeBridge,
  stream: MediaStream,
  name: string,
  kind: RecordingKind,
  onError: (e: unknown) => void,
): Promise<Recorder> {
  // Solo la voz: se graba únicamente la pista de audio (aunque el stream trajera imagen).
  const source = kind === 'audio' ? new MediaStream(stream.getAudioTracks()) : stream
  const mimeType = chooseRecorderMimeType((t) => MediaRecorder.isTypeSupported(t), recorderMimeCandidates(kind))
  const recorder = new MediaRecorder(source, {
    ...(mimeType ? { mimeType } : {}),
    ...(kind === 'video' ? { videoBitsPerSecond: RECORDER_VIDEO_BPS } : {}),
    audioBitsPerSecond: RECORDER_AUDIO_BPS,
  })
  const actual = recorder.mimeType || mimeType
  const writer = await bridge.beginRecording(name, recordingExtension(actual), kind)
  let pending: Promise<void> = Promise.resolve()
  let failed = false

  recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return
    pending = pending.then(() =>
      writer.append(e.data).catch((err: unknown) => {
        if (!failed) {
          failed = true
          onError(err)
        }
      }),
    )
  }
  recorder.onerror = (e) => onError((e as unknown as { error?: unknown }).error ?? e)

  const stopped = () =>
    new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') {
        resolve()
        return
      }
      // El último dataavailable llega antes que stop.
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.stop()
    })

  return {
    kind,
    mimeType: actual,
    writer,
    start: () => recorder.start(RECORDER_TIMESLICE_MS),
    pause: () => {
      if (recorder.state === 'recording') recorder.pause()
    },
    resume: () => {
      if (recorder.state === 'paused') recorder.resume()
    },
    async stop() {
      await stopped()
      await pending
    },
    async discard() {
      await stopped()
      await pending
      await writer.discard()
    },
  }
}
