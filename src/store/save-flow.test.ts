// El flujo de guardar apunta cada guardado en el registro (bien, cancelado o con error) y nunca falla por él.
import { describe, expect, it } from 'vitest'
import type { SaveLogEntry } from '../domain'
import { createEditorStore } from './editor'
import { createSaveFlow } from './save-flow'
import { createFakeBridge, mediaSet, type FakeBridgeState } from './test-helpers'

const H = 'C:\\v\\horizontal.mp4'

async function setup(initial: Partial<FakeBridgeState> = {}) {
  const { bridge, state } = createFakeBridge({ media: mediaSet(), ...initial })
  const editor = createEditorStore(bridge, { autosaveDelayMs: 10_000 })
  await editor.addClipsFromPaths([H])
  let t = 0
  const flow = createSaveFlow(editor, null, { appVersion: '9.9.9', clock: () => (t += 500) })
  return { editor, flow, state }
}

const logged = (state: FakeBridgeState) => state.saveLog.map((l) => JSON.parse(l) as SaveLogEntry)

describe('registro de guardados en el flujo de guardar', () => {
  it('un guardado que sale bien: una línea en el registro y la frase de «¡Listo!»', async () => {
    const { editor, flow, state } = await setup()
    await flow.start('youtube')
    await flow.whenRecorded()
    expect(editor.screen.value).toBe('done')
    const [entry] = logged(state)
    expect(state.saveLog).toHaveLength(1)
    expect(entry).toMatchObject({ v: 1, appVersion: '9.9.9', target: 'youtube', result: 'ok', usedEncoder: 'h264_nvenc', retried: false, bytes: 1_000_000 })
    // Solo el nombre del fichero: ni la carpeta ni el usuario.
    expect(state.saveLog[0]).not.toContain('Ana')
    expect(state.saveLog[0]).not.toContain('Mis montajes')
    expect(flow.lastLog.value).toEqual(entry)
  })

  it('con error y reintento: se apunta y no hay frase de «¡Listo!»', async () => {
    const { flow, state } = await setup({ ffmpegExitCodes: [1, 1] })
    await flow.start('whatsapp')
    await flow.whenRecorded()
    const [entry] = logged(state)
    expect(entry).toMatchObject({ result: 'error', retried: true, usedEncoder: 'libx264', error: 'No se ha podido guardar el vídeo. · Error al abrir el encoder' })
    expect(flow.lastLog.value).toBeNull()
  })

  it('cancelado: se apunta', async () => {
    const { flow, state } = await setup({ ffmpegHangs: true })
    const started = flow.start('high')
    for (let i = 0; i < 20 && state.ffmpegRuns.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
    flow.cancel()
    await started
    await flow.whenRecorded()
    expect(logged(state)[0]).toMatchObject({ result: 'cancelled', target: 'high', usedEncoder: 'h264_nvenc' })
  })

  it('si no se puede escribir el registro, el guardado sale bien igual', async () => {
    const { editor, flow, state } = await setup({ saveLogFails: true })
    await flow.start('sound')
    await flow.whenRecorded()
    expect(editor.screen.value).toBe('done')
    expect(editor.error.value).toBeNull()
    expect(state.saveLog).toHaveLength(0)
    expect(flow.lastLog.value).toMatchObject({ target: 'sound', result: 'ok', usedEncoder: null })
  })
})
