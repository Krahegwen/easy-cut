import { describe, expect, it } from 'vitest'
import {
  availableEncoderList,
  buildSaveLogEntry,
  describeSave,
  emptyExportReport,
  lastUsefulFfmpegLine,
  localIsoString,
  redactPaths,
  saveLogDetails,
  serializeSaveLogEntry,
  type ExportReport,
} from './save-log'

const NVENC_FAILURE = [
  '[h264_nvenc @ 000001c2a3b4c5d0] OpenEncodeSessionEx failed: unsupported device (2): (no details)',
  '[h264_nvenc @ 000001c2a3b4c5d0] No capable devices found',
  '[vost#0:0/h264_nvenc @ 000001c2a3b4c600] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height.',
  '[vf#0:0 @ 000001c2a3b4c700] Error sending frames to consumers: Function not implemented',
  '[vf#0:0 @ 000001c2a3b4c700] Task finished with error code: -38 (Function not implemented)',
  '[vf#0:0 @ 000001c2a3b4c700] Terminating thread with return code -38 (Function not implemented)',
  '[out#0/mp4 @ 000001c2a3b4c800] Nothing was written into output file, because at least one of its streams received no packets.',
  'Conversion failed!',
  '',
].join('\r\n')

function report(over: Partial<ExportReport> = {}): ExportReport {
  return {
    ...emptyExportReport('youtube'),
    availableEncoders: ['h264_nvenc', 'libx264'],
    requestedEncoder: 'h264_nvenc',
    attempts: [{ encoder: 'h264_nvenc', exitCode: 0, ms: 48_000, error: null }],
    durationMs: 212_000,
    width: 1920,
    height: 1080,
    fps: 30,
    fileName: 'Vídeo del 26 de noviembre de 2026 (para YouTube).mp4',
    ...over,
  }
}

const startedAt = new Date(2026, 10, 26, 18, 4, 5)

describe('registro de guardados', () => {
  it('última línea útil de ffmpeg: la del encoder, sin relleno ni direcciones', () => {
    expect(lastUsefulFfmpegLine(NVENC_FAILURE)).toBe('[h264_nvenc] No capable devices found')
    expect(lastUsefulFfmpegLine('Error al abrir el encoder')).toBe('Error al abrir el encoder')
    expect(lastUsefulFfmpegLine('\n\nConversion failed!\n')).toBeNull()
    expect(lastUsefulFfmpegLine('')).toBeNull()
    // Sin líneas del encoder: la última que queda.
    expect(lastUsefulFfmpegLine('[in#0 @ 00ab] Error opening input: No such file or directory\nConversion failed!')).toBe(
      '[in#0] Error opening input: No such file or directory',
    )
    expect(lastUsefulFfmpegLine('x'.repeat(500))!.length).toBe(300)
  })

  it('sin rutas ni carpetas del usuario', () => {
    expect(redactPaths('Error opening input file C:\\Users\\Ana López\\Mis vídeos\\boda.mp4.')).toBe('Error opening input file boda.mp4.')
    expect(redactPaths("No such file 'D:/Fotos/Ana/a.mov'")).toBe("No such file 'a.mov'")
    expect(redactPaths('en \\\\NAS\\familia\\v.mp4')).toBe('en v.mp4')
    expect(redactPaths('Stream #0:0 https://github.com/x')).toBe('Stream #0:0 https://github.com/x')
    expect(lastUsefulFfmpegLine('[AVFilterGraph @ 0f] Error reading C:\\Users\\Ana\\AppData\\Local\\Temp\\filtro-exportacion.txt')).toBe(
      '[AVFilterGraph] Error reading filtro-exportacion.txt',
    )
  })

  it('encoders disponibles en orden fijo', () => {
    expect(availableEncoderList({ libx264: true, h264_amf: false, h264_nvenc: true })).toEqual(['h264_nvenc', 'libx264'])
    expect(availableEncoderList({})).toEqual([])
  })

  it('hora local con su desfase', () => {
    const iso = localIsoString(startedAt)
    expect(iso).toMatch(/^2026-11-26T18:04:05[+-]\d\d:\d\d$/)
    expect(new Date(iso).getTime()).toBe(startedAt.getTime())
  })

  it('un guardado con la tarjeta gráfica', () => {
    const entry = buildSaveLogEntry({ report: report(), result: 'ok', startedAt, elapsedMs: 48_600, appVersion: '0.3.0', bytes: 85_214_112 })
    expect(entry).toMatchObject({
      v: 1,
      appVersion: '0.3.0',
      target: 'youtube',
      result: 'ok',
      requestedEncoder: 'h264_nvenc',
      usedEncoder: 'h264_nvenc',
      retried: false,
      retryReason: null,
      elapsedMs: 48_600,
      encodeMs: 48_000,
      speed: 4.4,
      bytes: 85_214_112,
      error: null,
    })
    expect(describeSave(entry)).toBe('Guardado en 49 segundos con la tarjeta gráfica')
    const line = serializeSaveLogEntry(entry)
    expect(line).not.toContain('\n')
    expect(JSON.parse(line)).toEqual(entry)
    const details = saveLogDetails(entry)
    expect(details).toContain('Easy Cut 0.3.0 · 2026-11-26T18:04:05')
    expect(details).toContain('Guardado: Para YouTube · resultado: bien')
    expect(details).toContain('Encoder: h264_nvenc (pedido: h264_nvenc)')
    expect(details).toContain('Reintento con libx264: no')
    expect(details).toContain('Encoders disponibles: h264_nvenc, libx264')
    expect(details).toContain('Duración: 3:32 · 1920x1080 a 30 fps')
    expect(details).toContain('Tiempo: 48,6 s · ffmpeg 48,0 s (4,4x tiempo real)')
    expect(details).toContain('Peso: 85 MB (85214112 bytes)')
    expect(details).toContain('Fichero: Vídeo del 26 de noviembre de 2026 (para YouTube).mp4')
  })

  it('un reintento con libx264 dice por qué y con qué acabó', () => {
    const r = report({
      attempts: [
        { encoder: 'h264_nvenc', exitCode: 1, ms: 900, error: lastUsefulFfmpegLine(NVENC_FAILURE) },
        { encoder: 'libx264', exitCode: 0, ms: 150_000, error: null },
      ],
    })
    const entry = buildSaveLogEntry({ report: r, result: 'ok', startedAt, elapsedMs: 152_000, appVersion: '0.3.0' })
    expect(entry.usedEncoder).toBe('libx264')
    expect(entry.retried).toBe(true)
    expect(entry.retryReason).toBe('[h264_nvenc] No capable devices found')
    expect(entry.encodeMs).toBe(150_000)
    expect(entry.speed).toBe(1.4)
    expect(describeSave(entry)).toBe('Guardado en 2 minutos y 32 segundos con el procesador, porque con la tarjeta gráfica no ha funcionado')
    expect(saveLogDetails(entry)).toContain('Reintento con libx264: sí, porque: [h264_nvenc] No capable devices found')
  })

  it('sin tarjeta gráfica: con el procesador, sin más', () => {
    const r = report({ availableEncoders: ['libx264'], requestedEncoder: 'libx264', attempts: [{ encoder: 'libx264', exitCode: 0, ms: 9_000, error: null }] })
    const entry = buildSaveLogEntry({ report: r, result: 'ok', startedAt, elapsedMs: 9_400, appVersion: '0.3.0' })
    expect(describeSave(entry)).toBe('Guardado en 9 segundos con el procesador')
  })

  it('cancelado: el encoder que estaba trabajando, sin velocidad', () => {
    const r = report({ attempts: [{ encoder: 'h264_nvenc', exitCode: null, ms: 5_000, error: null }] })
    const entry = buildSaveLogEntry({ report: r, result: 'cancelled', startedAt, elapsedMs: 5_100, appVersion: '0.3.0' })
    expect(entry).toMatchObject({ result: 'cancelled', usedEncoder: 'h264_nvenc', encodeMs: null, speed: null, error: null })
    expect(saveLogDetails(entry)).toContain('resultado: cancelado')
  })

  it('error: mensaje llano y la última línea de ffmpeg, sin rutas', () => {
    const r = report({
      attempts: [
        { encoder: 'h264_nvenc', exitCode: 1, ms: 900, error: 'a' },
        { encoder: 'libx264', exitCode: 1, ms: 800, error: '[libx264] malloc failed' },
      ],
    })
    const entry = buildSaveLogEntry({ report: r, result: 'error', startedAt, elapsedMs: 2_000, appVersion: '0.3.0', errorMessage: 'No se ha podido guardar el vídeo.' })
    expect(entry.error).toBe('No se ha podido guardar el vídeo. · [libx264] malloc failed')
    expect(entry.usedEncoder).toBe('libx264')
    // Antes de llegar a ffmpeg (falta un original): solo el mensaje.
    const early = buildSaveLogEntry({
      report: emptyExportReport('whatsapp'),
      result: 'error',
      startedAt,
      elapsedMs: 10,
      appVersion: '0.3.0',
      errorMessage: 'No encuentro C:\\Users\\Ana\\boda.mp4',
    })
    expect(early.error).toBe('No encuentro boda.mp4')
    expect(early.usedEncoder).toBeNull()
    expect(saveLogDetails(early)).not.toContain('Duración')
  })

  it('«Solo el sonido»: sin encoder de vídeo', () => {
    const r: ExportReport = { ...emptyExportReport('sound'), durationMs: 30_000, attempts: [{ encoder: null, exitCode: 0, ms: 500, error: null }], fileName: 'Sonido del 26 de noviembre de 2026.m4a' }
    const entry = buildSaveLogEntry({ report: r, result: 'ok', startedAt, elapsedMs: 600, appVersion: '0.3.0', bytes: 480_000 })
    expect(entry.usedEncoder).toBeNull()
    expect(describeSave(entry)).toBe('Guardado en 1 segundo')
    const details = saveLogDetails(entry)
    expect(details).toContain('Guardado: Solo el sonido · resultado: bien')
    expect(details).not.toContain('Encoder')
    expect(details).toContain('Duración: 0:30\n')
  })
})
