import { describe, expect, it } from 'vitest'
import { addClip, createClip, createProject } from '../domain'
import { CancelledError } from '../native/bridge'
import { exportEncoderChain, ExportError, startExport } from './exporter'
import { createFakeBridge, mediaSet } from './test-helpers'

const H = 'C:\\v\\horizontal.mp4'
const V = 'C:\\v\\vertical.mp4'
const date = new Date(2026, 10, 25)

function project() {
  const media = mediaSet()
  let p = createProject()
  p = addClip(p, createClip(media[H]!, 'a'))
  p = addClip(p, createClip(media[V]!, 'b'))
  return { p, media }
}

describe('guardar el vídeo', () => {
  it('cadena de encoders: hardware y luego libx264', () => {
    expect(exportEncoderChain('h264_nvenc')).toEqual(['h264_nvenc', 'libx264'])
    expect(exportEncoderChain('libx264')).toEqual(['libx264'])
  })

  it('guarda con el filtro en un fichero y un nombre que no sobrescribe', async () => {
    const { p, media } = project()
    const { bridge, state } = createFakeBridge({ media })
    state.files.add('C:\\Users\\Ana\\Videos\\Mis montajes\\Vídeo del 25 de noviembre de 2026 (para WhatsApp).mp4')
    const updates: number[] = []
    const job = startExport(bridge, { project: p, media, preset: 'whatsapp', now: () => date, onProgress: (u) => updates.push(u.fraction) })
    const res = await job.result
    expect(res.path).toBe('C:\\Users\\Ana\\Videos\\Mis montajes\\Vídeo del 25 de noviembre de 2026 (para WhatsApp) 2.mp4')
    expect(res.encoder).toBe('h264_nvenc')
    expect(res.expectedDurationMs).toBe(18_000)
    const args = state.ffmpegRuns[0]!.args
    expect(args).toContain('-/filter_complex')
    const script = args[args.indexOf('-/filter_complex') + 1]!
    expect(state.tempFiles[script]).toContain('concat=n=2')
    expect(args).not.toContain('-filter_complex')
    expect(updates.at(-1)).toBe(1)
  })

  it('si falla con el encoder hardware, reintenta solo con libx264 y borra lo que quedó a medias', async () => {
    const { p, media } = project()
    const { bridge, state } = createFakeBridge({ media, ffmpegExitCodes: [1, 0] })
    const retries: string[] = []
    const res = await startExport(bridge, { project: p, media, preset: 'youtube', now: () => date, onRetry: (a, b) => retries.push(`${a}>${b}`) }).result
    expect(res.encoder).toBe('libx264')
    expect(retries).toEqual(['h264_nvenc>libx264'])
    expect(state.ffmpegRuns).toHaveLength(2)
    expect(state.ffmpegRuns[1]!.args).toContain('libx264')
    expect(state.deleted).toEqual([res.path])
  })

  it('si falla también con libx264, da un error llano con los detalles técnicos', async () => {
    const { p, media } = project()
    const { bridge, state } = createFakeBridge({ media, ffmpegExitCodes: [1, 1] })
    const err = await startExport(bridge, { project: p, media, preset: 'high', now: () => date }).result.catch((e) => e)
    expect(err).toBeInstanceOf(ExportError)
    expect(err.message).toBe('No se ha podido guardar el vídeo.')
    expect(err.details).toContain('[h264_nvenc]')
    expect(err.details).toContain('[libx264]')
    expect(state.files.size).toBe(0)
  })

  it('sin encoder hardware usa libx264 directamente', async () => {
    const { p, media } = project()
    const { bridge, state } = createFakeBridge({ media, encoders: { libx264: true } })
    const res = await startExport(bridge, { project: p, media, preset: 'whatsapp', now: () => date }).result
    expect(res.encoder).toBe('libx264')
    expect(state.ffmpegRuns).toHaveLength(1)
  })

  it('no empieza si falta un original', async () => {
    const { p, media } = project()
    const { bridge, state } = createFakeBridge({ media })
    state.existing.delete(V)
    const err = await startExport(bridge, { project: p, media, preset: 'whatsapp' }).result.catch((e) => e)
    expect(err).toBeInstanceOf(ExportError)
    expect(err.message).toContain('No encuentro uno de los vídeos originales')
    expect(state.ffmpegRuns).toHaveLength(0)
  })

  it('cancelar mata ffmpeg y borra el fichero a medias', async () => {
    const { p, media } = project()
    const { bridge, state } = createFakeBridge({ media, ffmpegHangs: true })
    const job = startExport(bridge, { project: p, media, preset: 'whatsapp', now: () => date })
    for (let i = 0; i < 20 && state.ffmpegRuns.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
    expect(state.ffmpegRuns).toHaveLength(1)
    job.cancel()
    await expect(job.result).rejects.toBeInstanceOf(CancelledError)
    expect(state.deleted).toHaveLength(1)
    expect(state.files.size).toBe(0)
    expect(job.report.attempts).toEqual([{ encoder: 'h264_nvenc', exitCode: null, ms: expect.any(Number), error: null }])
  })
})

describe('lo que se apunta de cada guardado', () => {
  it('encoders probados, el pedido, cada intento y por qué falló, sin la carpeta del fichero', async () => {
    const { p, media } = project()
    const { bridge } = createFakeBridge({ media, ffmpegExitCodes: [1, 0], encoders: { h264_nvenc: true, h264_qsv: false, libx264: true } })
    let t = 0
    const job = startExport(bridge, { project: p, media, preset: 'youtube', now: () => date, clock: () => (t += 1000) })
    await job.result
    expect(job.report).toEqual({
      target: 'youtube',
      method: 'encode',
      tool: 'editor',
      availableEncoders: ['h264_nvenc', 'libx264'],
      requestedEncoder: 'h264_nvenc',
      attempts: [
        { encoder: 'h264_nvenc', exitCode: 1, ms: 1000, error: 'Error al abrir el encoder' },
        { encoder: 'libx264', exitCode: 0, ms: 1000, error: null },
      ],
      durationMs: 18_000,
      width: expect.any(Number),
      height: expect.any(Number),
      fps: expect.any(Number),
      fileName: 'Vídeo del 25 de noviembre de 2026 (para YouTube).mp4',
    })
  })

  it('«Solo el sonido»: un intento sin encoder de vídeo', async () => {
    const { p, media } = project()
    const { bridge } = createFakeBridge({ media })
    const job = startExport(bridge, { project: p, media, preset: 'sound', now: () => date })
    await job.result
    expect(job.report.availableEncoders).toBeNull()
    expect(job.report.attempts).toEqual([{ encoder: null, exitCode: 0, ms: expect.any(Number), error: null }])
    expect(job.report.fileName).toMatch(/\.m4a$/)
    expect(job.report.width).toBeNull()
  })
})
