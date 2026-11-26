// «Solo recortar» en la interfaz: elegir, marcar, fotograma clave, guardar «Rápido» y «Exacto» (con su entrada
// en el registro) y «Convertir en un vídeo normal».
import { describe, expect, it } from 'vitest'
import { clipInOut, describeSave, type SaveLogEntry } from '../domain'
import { fakeMedia } from '../domain/test-helpers'
import { createEditorStore } from './editor'
import { createSaveFlow } from './save-flow'
import { createFakeBridge, mediaSet, type FakeBridgeState } from './test-helpers'
import { createTrimStore } from './trim'

const V = 'C:\\v\\horizontal.mp4'
const PRORES = 'C:\\v\\camara.mov'

function setup(initial: Partial<FakeBridgeState> = {}) {
  const media = { ...mediaSet(), [PRORES]: fakeMedia({ path: PRORES, videoCodec: 'prores', audioCodec: 'pcm_s16le' }) }
  const { bridge, state } = createFakeBridge({ media, keyframes: { [V]: [0, 2_000, 4_000, 6_000, 8_000] }, ...initial })
  const editor = createEditorStore(bridge, { autosaveDelayMs: 10_000 })
  let t = 0
  const flow = createSaveFlow(editor, null, { appVersion: '9.9.9', clock: () => (t += 1_000) })
  const trim = createTrimStore(editor, flow)
  return { bridge, state, editor, flow, trim }
}

const logged = (state: FakeBridgeState) => state.saveLog.map((l) => JSON.parse(l) as SaveLogEntry)

describe('Solo recortar', () => {
  it('elegir abre la pantalla con el vídeo entero; cancelar no hace nada', async () => {
    const { bridge, editor, trim } = setup()
    bridge.pickVideos = async () => []
    expect(await trim.begin()).toBe(false)
    expect(editor.screen.value).toBe('home')
    bridge.pickVideos = async () => [V]
    expect(await trim.begin()).toBe(true)
    expect(editor.screen.value).toBe('trim')
    expect(trim.range.value).toEqual({ inMs: 0, outMs: 10_000 })
    // Al principio ya es exacto.
    expect(trim.plan.value?.exact).toBe(true)
  })

  it('un fichero sin imagen no vale', async () => {
    const A = 'C:\\v\\voz.m4a'
    const { editor, trim } = setup({ media: { [A]: fakeMedia({ path: A, hasVideo: false, width: 0, height: 0 }) } })
    expect(await trim.openFile(A)).toBe(false)
    expect(editor.toast.value?.message).toContain('no tiene imagen')
  })

  it('«Rápido»: copia desde el fotograma clave, sin recodificar, y lo apunta en el registro', async () => {
    const { state, editor, flow, trim } = setup()
    await trim.openFile(V)
    trim.setIn(4_800)
    trim.setOut(9_000)
    expect(await trim.ensureKeyframe()).toBe(4_000)
    expect(trim.plan.value).toMatchObject({ startMs: 4_000, earlyMs: 800, exact: false })
    await trim.save()
    await flow.whenRecorded()
    expect(editor.screen.value).toBe('done')
    const args = state.ffmpegRuns[0]!.args
    expect(args).toContain('copy')
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual(['-ss', '4.000'])
    expect(args[args.length - 1]).toBe('C:\\Users\\Ana\\Videos\\Mis montajes\\horizontal (recortado).mp4')
    expect(editor.lastExport.value?.durationMs).toBe(5_000)
    const [entry] = logged(state)
    expect(entry).toMatchObject({ result: 'ok', method: 'copy', tool: 'trim', usedEncoder: null, durationMs: 5_000, fileName: 'horizontal (recortado).mp4' })
    expect(describeSave(entry!)).toBe('Guardado en 1 segundo sin recodificar')
    expect(flow.origin.value).toBe('trim')
  })

  it('«Exacto»: el camino normal, calidad alta, justo lo marcado', async () => {
    const { state, flow, trim } = setup()
    await trim.openFile(V)
    trim.setIn(4_800)
    trim.setOut(9_000)
    trim.mode.value = 'exact'
    await trim.save()
    await flow.whenRecorded()
    const args = state.ffmpegRuns[0]!.args
    expect(args).not.toContain('copy')
    expect(args).toContain('h264_nvenc')
    const [entry] = logged(state)
    expect(entry).toMatchObject({ result: 'ok', method: 'encode', tool: 'trim', target: 'high', durationMs: 4_200 })
    // Con el nombre de «Solo recortar», no el de «Calidad alta».
    expect(args[args.length - 1]).toBe('C:\\Users\\Ana\\Videos\\Mis montajes\\horizontal (recortado).mp4')
  })

  it('un formato que no se puede copiar (ProRes) guarda «Exacto» y dice por qué', async () => {
    const { state, flow, trim } = setup()
    await trim.openFile(PRORES)
    expect(trim.copyBlocked.value).toContain('ProRes')
    expect(trim.effectiveMode.value).toBe('exact')
    await trim.save()
    await flow.whenRecorded()
    expect(state.ffmpegRuns[0]!.args).not.toContain('copy')
  })

  it('si no se pueden leer los fotogramas clave, «Rápido» no se ofrece', async () => {
    const { bridge, trim } = setup()
    bridge.keyframes = async () => {
      throw new Error('ffprobe roto')
    }
    await trim.openFile(V)
    trim.setIn(3_000)
    expect(await trim.ensureKeyframe()).toBe('error')
    expect(trim.copyAvailable.value).toBe(false)
    expect(trim.effectiveMode.value).toBe('exact')
  })

  it('cancelar vuelve a «Solo recortar» sin nada a medias', async () => {
    const { state, editor, flow, trim } = setup({ ffmpegHangs: true })
    await trim.openFile(V)
    const saving = trim.save()
    for (let i = 0; i < 20 && state.ffmpegRuns.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
    flow.cancel()
    await saving
    await flow.whenRecorded()
    expect(editor.screen.value).toBe('trim')
    expect(state.deleted).toHaveLength(1)
    expect(logged(state)[0]).toMatchObject({ result: 'cancelled', method: 'copy', tool: 'trim' })
  })

  it('«Convertir en un vídeo normal»: uno nuevo en la lista con el corte, abierto en «Tu vídeo»', async () => {
    const { state, editor, trim } = setup()
    await editor.addClipsFromPaths(['C:\\v\\vertical.mp4'])
    await editor.flushAutosave()
    const before = editor.projectId.value
    await trim.openFile(V)
    trim.setIn(2_500)
    trim.setOut(7_000)
    await trim.convert()
    expect(editor.screen.value).toBe('editor')
    expect(editor.projectId.value).not.toBe(before)
    expect(editor.project.value.clips).toHaveLength(1)
    expect(clipInOut(editor.project.value.clips[0]!)).toEqual({ startMs: 2_500, endMs: 7_000 })
    expect(editor.undoable.value).toBe(false)
    // Los dos en la lista: el de antes sigue guardado.
    expect(Object.keys(state.projects)).toHaveLength(2)
    expect(editor.projects.value.map((p) => p.id)).toContain(before)
  })
})
