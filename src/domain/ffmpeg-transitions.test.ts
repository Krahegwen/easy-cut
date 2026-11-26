import { describe, expect, it } from 'vitest'
import { buildExportCommand, buildSoundExportCommand, exportedProjectDurationMs, exportTiming, planTrackItems } from './ffmpeg-args'
import { addClip, applyKeepSegments, createClip, createProject, setClipFade, setTransition, type MediaInfo, type Project } from './project'
import { fakeAudio, fakeMedia } from './test-helpers'
import { createItem, insertItem } from './tracks'
import { makeEntry } from './transitions'

const a = fakeMedia({ path: 'C:\\v\\a.mp4', durationMs: 4000 })
const b = fakeMedia({ path: 'C:\\v\\b.mp4', durationMs: 4000 })
const c = fakeMedia({ path: 'C:\\v\\c.mp4', durationMs: 4000 })
const ding = fakeAudio({ path: 'C:\\s\\ding.wav', durationMs: 500 })
const media: Record<string, MediaInfo> = Object.fromEntries([a, b, c, ding].map((m) => [m.path, m]))

function three(): Project {
  let p = createProject()
  for (const [m, id] of [[a, 'a'], [b, 'b'], [c, 'c']] as const) p = addClip(p, createClip(m, id))
  return p
}

describe('guardar con transiciones', () => {
  it('sin transiciones, el concat de siempre', () => {
    const cmd = buildExportCommand(three(), media, 'whatsapp', 'libx264', 'o.mp4')
    expect(cmd.filterComplex).toMatch(/\[v0\]\[a0\]\[v1\]\[a1\]\[v2\]\[a2\]concat=n=3:v=1:a=1\[vout\]\[aout\]$/)
    expect(cmd.filterComplex).not.toContain('xfade')
  })

  it('fundido: cola y cabeza por fotogramas, xfade y concat; duración = (Σf − Σo)/F', () => {
    const p = setTransition(three(), 'b', makeEntry('dissolve', 1000))
    const cmd = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4')
    const f = cmd.filterComplex
    expect(f).toContain('[vt0s]trim=start_frame=90:end_frame=120,setpts=PTS-STARTPTS,settb=1/30[vt0]')
    expect(f).toContain('[vh1s]trim=start_frame=0:end_frame=30,setpts=PTS-STARTPTS,settb=1/30[vh1]')
    expect(f).toContain('[vt0][vh1]xfade=transition=fade:duration=1:offset=0[vx1]')
    expect(f).toMatch(/\[vb0\]\[vx1\]\[vb1\]\[v2\]concat=n=4:v=1:a=0/)
    // Sonido: 1 s = 48 000 muestras que se cruzan.
    expect(f).toContain('[at0]afade=t=out:ss=0:ns=48000[axa1]')
    expect(f).toContain('[axa1][axb1]amix=inputs=2:normalize=0:duration=longest:dropout_transition=0,atrim=end_sample=48000')
    expect(f).toMatch(/\[ab0\]\[ax1\]\[ab1\]\[a2\]concat=n=4:v=0:a=1\[aout\]/)
    expect(cmd.expectedDurationMs).toBe(11_000)
    expect(exportedProjectDurationMs(p, 30)).toBe(11_000)
  })

  it('deslizar y empujar con coverleft y slideleft', () => {
    let p = setTransition(three(), 'b', makeEntry('cover', 500))
    p = setTransition(p, 'c', makeEntry('push', 500))
    const f = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(f).toContain('xfade=transition=coverleft:duration=0.5:offset=0[vx1]')
    expect(f).toContain('xfade=transition=slideleft:duration=0.5:offset=0[vx2]')
    // El del medio: cabeza, cuerpo y cola.
    expect(f).toContain('[v1]split=3[vh1s][vb1s][vt1s]')
  })

  it('zoom: el que sale se acerca con scale por fotograma y se funde', () => {
    const p = setTransition(three(), 'b', makeEntry('zoom', 1000))
    const f = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(f).toMatch(/\[vt0\]scale=w='2\*trunc\(\d+\*\(1\+0\.3\*min\(1,t\/1\)\)\/2\)'/)
    expect(f).toContain('[vtz1][vh1]xfade=transition=fade:duration=1:offset=0[vx1]')
  })

  it('a negro montado: mitad y mitad con fade, sin xfade', () => {
    const p = setTransition(three(), 'b', makeEntry('dip-black', 1000, true))
    const f = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(f).toContain('[vt0]trim=end_frame=15,fade=t=out:st=0:d=0.5:color=black[vxa1]')
    expect(f).toContain('[vh1]trim=start_frame=15,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.5:color=black[vxb1]')
    expect(f).not.toContain('xfade')
  })

  it('a blanco sin solape: fade de color en cada trozo, el concat de siempre y la misma duración', () => {
    const p = setTransition(three(), 'b', makeEntry('dip-white', 1000))
    const cmd = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4')
    expect(cmd.filterComplex).toContain('fade=t=out:st=3.5:d=0.5:color=white')
    expect(cmd.filterComplex).toContain('fade=t=in:st=0:d=0.5:color=white')
    // El sonido baja y sube en muestras.
    expect(cmd.filterComplex).toContain('afade=t=out:ss=168000:ns=24000')
    expect(cmd.filterComplex).toContain('afade=t=in:ss=0:ns=24000')
    expect(cmd.expectedDurationMs).toBe(12_000)
  })

  it('manda la transición: el aparecer del trozo que entra no se aplica', () => {
    let p = setClipFade(three(), 'b', 'in', { ms: 1000, easing: 'smooth' })
    p = setTransition(p, 'b', makeEntry('dissolve', 1000))
    const f = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(f).not.toContain('[v1nofade]')
    expect(f).not.toContain('curve=hsin')
  })

  it('lo pegado al que entra cae donde dice el modelo, en fotogramas', () => {
    let p = setTransition(three(), 'b', makeEntry('dissolve', 1000))
    const r = insertItem(p, createItem({ id: 'd', kind: 'sound', source: { type: 'file', path: ding.path }, name: 'd', sourceDurationMs: 500, hasAudio: true }), 'sound', 3500, { id: 's' })
    if (!r.ok) throw new Error('no cabe')
    p = r.project
    const planned = planTrackItems(p, media, exportTiming(p, 30), (i) => (i.source.type === 'file' ? i.source.path : null))
    expect(planned[0]!.startMs).toBe(3500)
    const f = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(f).toContain(`adelay=delays=${3500 * 48}S:all=1`)
  })

  it('«Solo el sonido»: los solapes en muestras exactas', () => {
    let p = setTransition(three(), 'b', makeEntry('dissolve', 1000))
    p = applyKeepSegments(p, 'c', [{ startMs: 0, endMs: 1000 }, { startMs: 1500, endMs: 4000 }])
    p = setTransition(p, 'c', makeEntry('dissolve', 2000))
    const cmd = buildSoundExportCommand(p, media, 'o.m4a')
    // c: primer rango de 1 s → el solape se queda en 1 s (48 000 muestras).
    expect(cmd.filterComplex).toMatch(/atrim=end_sample=48000,aformat=[^[]*\[ax1\]/)
    expect(cmd.filterComplex).toMatch(/atrim=end_sample=48000,aformat=[^[]*\[ax2\]/)
    expect(cmd.expectedDurationMs).toBe(4000 + 4000 + 3500 - 2000)
  })
})
