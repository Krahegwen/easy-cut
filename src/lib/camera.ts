// Cámara y micrófono: encenderlos con la mejor calidad razonable, listar los que hay, medir el volumen
// del micrófono y apagarlo todo. Las decisiones (calidad pedida, umbrales, mensajes) son del dominio.
import { describeCameraError, mediaConstraints, type CameraProblem, type RecordingKind } from '../domain'

export interface DeviceOption {
  id: string
  label: string
  groupId: string
}

export interface CameraResult {
  stream: MediaStream | null
  problem: CameraProblem | null
  /** Error técnico, para «Copiar detalles» o la consola. */
  details: string | null
}

function errorName(e: unknown): string {
  return e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
}

/** Streams abiertos desde aquí, para comprobar (en las pruebas) que no queda ninguno encendido. */
const opened = new Set<MediaStream>()

/** Para todas las pistas de un stream (la luz de la cámara se apaga). */
export function stopStream(stream: MediaStream | null | undefined) {
  if (!stream) return
  stream.getTracks().forEach((t) => t.stop())
  opened.delete(stream)
}

/** Pistas de cámara o micrófono que siguen encendidas. */
export function liveTracks(): { kind: string; label: string }[] {
  const out: { kind: string; label: string }[] = []
  for (const s of opened) {
    for (const t of s.getTracks()) if (t.readyState === 'live') out.push({ kind: t.kind, label: t.label })
    if (s.getTracks().every((t) => t.readyState === 'ended')) opened.delete(s)
  }
  return out
}

/**
 * Enciende cámara y micrófono. Si la cámara elegida ya no está o no da lo pedido, prueba con la de
 * por defecto. Si falta algo, averigua qué (cámara, micrófono o los dos) para decirlo bien.
 */
export async function openCamera(cameraId: string | null, micId: string | null, kind: RecordingKind = 'video'): Promise<CameraResult> {
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) {
    return { stream: null, problem: describeCameraError('NotSupportedError', null, kind), details: 'navigator.mediaDevices no existe' }
  }
  const audioOnly = kind === 'audio'
  const attempts: [string | null, string | null][] = [[audioOnly ? null : cameraId, micId]]
  if ((!audioOnly && cameraId) || micId) attempts.push([null, null])
  let lastError: unknown = null
  for (const [cam, mic] of attempts) {
    try {
      // Con solo la voz, la cámara no se pide (video: false).
      const stream = await md.getUserMedia(mediaConstraints(cam, mic, kind) as MediaStreamConstraints)
      opened.add(stream)
      return { stream, problem: null, details: null }
    } catch (e) {
      lastError = e
      const name = errorName(e)
      // Un permiso denegado o una cámara ocupada no se arreglan probando otra combinación.
      if (name === 'NotAllowedError' || name === 'NotReadableError' || name === 'SecurityError') break
    }
  }
  const name = errorName(lastError)
  let missing: 'camera' | 'microphone' | 'both' | null = null
  if (!audioOnly && (name === 'NotFoundError' || name === 'OverconstrainedError')) {
    try {
      const devices = await md.enumerateDevices()
      const hasCam = devices.some((d) => d.kind === 'videoinput')
      const hasMic = devices.some((d) => d.kind === 'audioinput')
      missing = !hasCam && !hasMic ? 'both' : !hasMic ? 'microphone' : 'camera'
    } catch {
      missing = null
    }
  }
  return { stream: null, problem: describeCameraError(name, missing, kind), details: lastError instanceof Error ? `${lastError.name}: ${lastError.message}` : String(lastError) }
}

/** Cámaras y micrófonos con su nombre (los nombres solo aparecen con el permiso ya concedido). */
export async function listDevices(): Promise<{ cameras: DeviceOption[]; mics: DeviceOption[] }> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const pick = (kind: MediaDeviceKind, fallback: string) =>
    devices
      .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.deviceId !== '')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}`, groupId: d.groupId }))
  return { cameras: pick('videoinput', 'Cámara'), mics: pick('audioinput', 'Micrófono') }
}

/**
 * Dispositivo de la lista que está usando una pista. El micrófono «predeterminado» de Windows tiene un id
 * propio ('default') que no sale en la lista: se reconoce por su grupo (el aparato físico).
 */
export function trackDeviceId(stream: MediaStream | null, kind: 'video' | 'audio', list: readonly DeviceOption[] = []): string | null {
  const track = kind === 'video' ? stream?.getVideoTracks()[0] : stream?.getAudioTracks()[0]
  const s = track?.getSettings()
  if (!s) return null
  if (list.length === 0 || list.some((d) => d.id === s.deviceId)) return s.deviceId ?? null
  return list.find((d) => d.groupId && d.groupId === s.groupId)?.id ?? s.deviceId ?? null
}

/** Medidor de volumen: llama a `onPeak` con el pico (0..1) unas 20 veces por segundo. */
export function startLevelMeter(stream: MediaStream, onPeak: (peak: number) => void): () => void {
  const track = stream.getAudioTracks()[0]
  if (!track) return () => {}
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(new MediaStream([track]))
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  const data = new Float32Array(analyser.fftSize)
  // Un AudioContext puede nacer suspendido; sin sonar nada, reanudarlo es inofensivo.
  void ctx.resume().catch(() => {})
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(data)
    let peak = 0
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]!)
      if (v > peak) peak = v
    }
    onPeak(peak)
  }, 50)
  return () => {
    window.clearInterval(timer)
    source.disconnect()
    void ctx.close().catch(() => {})
  }
}
