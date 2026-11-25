import { describe, expect, it } from 'vitest'
import {
  chooseRecorderMimeType,
  clockElapsed,
  clockPause,
  clockRunning,
  clockStart,
  createClock,
  describeCameraError,
  describeMicLevel,
  mediaConstraints,
  meterFraction,
  micLevel,
  peakToDb,
  recorderMimeCandidates,
  recordingExtension,
  recordingName,
  recordingOutputExtension,
} from './recording'

describe('reloj de grabación', () => {
  it('no cuenta las pausas', () => {
    let c = createClock()
    expect(clockElapsed(c, 1000)).toBe(0)
    c = clockStart(c, 1000)
    expect(clockRunning(c)).toBe(true)
    expect(clockElapsed(c, 6000)).toBe(5000)
    c = clockPause(c, 6000)
    expect(clockElapsed(c, 9000)).toBe(5000)
    c = clockStart(c, 9000)
    expect(clockElapsed(c, 16_000)).toBe(12_000)
    // Pausar o seguir dos veces no cambia nada.
    expect(clockStart(c, 20_000)).toBe(c)
    const paused = clockPause(c, 16_000)
    expect(clockPause(paused, 18_000)).toBe(paused)
  })
})

describe('formato del grabador', () => {
  it('elige el primero admitido', () => {
    expect(chooseRecorderMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus')
    expect(chooseRecorderMimeType(() => true)).toBe('video/mp4;codecs=avc1.640028,mp4a.40.2')
    expect(chooseRecorderMimeType(() => false)).toBe('')
    expect(
      chooseRecorderMimeType((t) => {
        if (t.includes('mp4')) throw new Error('no sé')
        return true
      }),
    ).toBe('video/webm;codecs=vp9,opus')
  })

  it('extensión del temporal', () => {
    expect(recordingExtension('video/mp4;codecs=avc1')).toBe('mp4')
    expect(recordingExtension('video/x-matroska;codecs=avc1,opus')).toBe('mkv')
    expect(recordingExtension('video/webm;codecs=vp9')).toBe('webm')
    expect(recordingExtension('')).toBe('webm')
  })

  it('pide 1080p30 y voz sin anulador de eco', () => {
    const c = mediaConstraints('cam', null)
    expect(c.video).toMatchObject({ deviceId: { exact: 'cam' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } })
    expect(c.audio).toMatchObject({ echoCancellation: false, noiseSuppression: true })
    expect(c.audio.deviceId).toBeUndefined()
  })
})

describe('nivel del micrófono', () => {
  const at = (t: number, peak: number) => ({ timeMs: t, peak })

  it('dB y barra', () => {
    expect(peakToDb(1)).toBe(0)
    expect(Math.round(peakToDb(0.1))).toBe(-20)
    expect(peakToDb(0)).toBe(-100)
    expect(meterFraction(1)).toBe(1)
    expect(meterFraction(0)).toBe(0)
    expect(meterFraction(0.1)).toBeCloseTo(2 / 3, 2)
  })

  it('bien, bajo, nada y esperando', () => {
    expect(micLevel([at(900, 0.2)], 1000, 0)).toBe('good')
    // Al empezar, sin voz todavía, no se acusa a nadie.
    expect(micLevel([at(900, 0.001)], 1000, 0)).toBe('waiting')
    expect(micLevel([at(4900, 0.01)], 5000, 0)).toBe('low')
    expect(micLevel([at(4900, 0.0001)], 5000, 0)).toBe('silent')
    expect(micLevel([], 5000, 0)).toBe('silent')
    // Lo que se dijo hace más de 3 s ya no cuenta.
    expect(micLevel([at(500, 0.5), at(4900, 0.0001)], 5000, 0)).toBe('silent')
    expect(describeMicLevel('good')).toBe('Se te oye bien')
    expect(describeMicLevel('low')).toMatch(/^Se te oye muy bajo/)
    expect(describeMicLevel('silent')).toBe('No se oye nada: comprueba el micrófono')
  })
})

describe('errores de la cámara en llano', () => {
  it('cada error con qué hacer', () => {
    expect(describeCameraError('NotAllowedError').title).toContain('permiso')
    expect(describeCameraError('NotFoundError').title).toBe('No encuentro ninguna cámara')
    expect(describeCameraError('NotFoundError', 'microphone').title).toBe('No encuentro ningún micrófono')
    expect(describeCameraError('NotReadableError').fix).toContain('otro programa')
    expect(describeCameraError('Rarísimo').fix).toContain('Probar otra vez')
  })
})

describe('grabar solo la voz', () => {
  it('no pide la cámara y acaba en M4A', () => {
    const c = mediaConstraints('cam', 'mic', 'audio')
    expect(c.video).toBe(false)
    expect(c.audio).toMatchObject({ deviceId: { exact: 'mic' }, echoCancellation: false })
    expect(recordingOutputExtension('audio')).toBe('m4a')
    expect(recordingOutputExtension('video')).toBe('mp4')
    expect(recordingExtension('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('webm')
  })

  it('formatos de audio para el grabador', () => {
    const supported = (t: string) => t === 'audio/webm;codecs=opus'
    expect(chooseRecorderMimeType(supported, recorderMimeCandidates('audio'))).toBe('audio/webm;codecs=opus')
    expect(chooseRecorderMimeType(() => true, recorderMimeCandidates('audio'))).toBe('audio/mp4;codecs=mp4a.40.2')
    expect(recorderMimeCandidates('video')[0]).toMatch(/^video\//)
  })

  it('si falla la cámara ofrece la voz; si falla el micrófono, no', () => {
    expect(describeCameraError('NotFoundError', 'camera').voiceOnlyMayHelp).toBe(true)
    expect(describeCameraError('NotReadableError').voiceOnlyMayHelp).toBe(true)
    expect(describeCameraError('NotFoundError', 'microphone').voiceOnlyMayHelp).toBe(false)
    expect(describeCameraError('NotFoundError', 'both').voiceOnlyMayHelp).toBe(false)
    const voice = describeCameraError('NotAllowedError', null, 'audio')
    expect(voice).toMatchObject({ title: 'No tengo permiso para usar el micrófono', voiceOnlyMayHelp: false })
    expect(describeCameraError('NotFoundError', null, 'audio').title).toBe('No encuentro ningún micrófono')
    expect(describeCameraError('NotReadableError', null, 'audio').title).toBe('El micrófono está ocupado')
  })
})

describe('nombre de la grabación', () => {
  it('fecha y hora, sin dos puntos', () => {
    expect(recordingName(new Date(2026, 10, 25, 18, 5))).toBe('Grabación del 25 de noviembre de 2026, 18.05')
  })
})
