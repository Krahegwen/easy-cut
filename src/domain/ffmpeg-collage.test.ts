import { describe, expect, it } from 'vitest'
import { createCollage, setCell, setCellFit, setCellMuted, setCellStart } from './collage'
import { buildExportCommand, buildSoundExportCommand, planTrackItems } from './ffmpeg-args'
import { addMark, setBoxAt } from './keyframes'
import { addClip, createClip, createProject, type CollageCellSource, type MediaInfo, type Project } from './project'
import { fakeMedia } from './test-helpers'
import { createCollageItem, insertItem, projectTiming, setEffectLook, updateCollage, updateEffectLook } from './tracks'

const base = fakeMedia({ path: 'C:\\v\\base.mp4', durationMs: 12_000 })
const red = fakeMedia({ path: 'C:\\c\\rojo.mp4', durationMs: 8000 })
const tall = fakeMedia({ path: 'C:\\c\\alto.mp4', durationMs: 2000, width: 1080, height: 1920, hasAudio: true })
const blue = fakeMedia({ path: 'C:\\c\\azul.mp4', durationMs: 6000, hasAudio: false })
const media: Record<string, MediaInfo> = Object.fromEntries([base, red, tall, blue].map((m) => [m.path, m]))

const cell = (m: MediaInfo): CollageCellSource => ({ path: m.path, durationMs: m.durationMs, still: false, hasAudio: m.hasAudio, width: m.width, height: m.height })

/** Un trozo de 12 s y un collage «Uno grande a la izquierda y dos a la derecha» de 2 a 10 s. */
function project(): Project {
  let collage = createCollage('big-left')
  collage = setCell(collage, 0, cell(tall))
  collage = setCell(collage, 1, cell(red))
  collage = setCellFit(setCell(collage, 2, cell(blue)), 2, 'whole')
  const res = insertItem(addClip(createProject(), createClip(base, 'a')), createCollageItem('col', collage), 'effect', 2000, { id: 'fx' })
  if (!res.ok) throw new Error('no cabe')
  return res.project
}

describe('guardar un collage', () => {
  it('cada hueco lee solo su tramo, se escala a su hueco y xstack los junta con la separación', () => {
    const cmd = buildExportCommand(project(), media, 'youtube', 'libx264', 'o.mp4')
    const f = cmd.filterComplex
    // 1920×1080: la raya de 8 px; el hueco grande de 956×1080 y los dos de la derecha de 956×536.
    expect(f).toMatch(/xstack=inputs=3:layout=0_0\|964_0\|964_544:fill=0x1c2229/)
    // El vertical llena su hueco: se escala a lo ancho y se recorta al centro.
    expect(f).toContain('scale=956:1700:flags=bicubic:out_color_matrix=bt709:out_range=tv,crop=956:1080:0:310')
    // «Entero»: bandas de fondo con pad.
    expect(f).toMatch(/scale=952:536:[^,]*,pad=956:536:2:0:color=0x1c2229/)
    // Se queda en su última imagen: tpad hasta los fotogramas del collage (8 s a 30 fps).
    expect(f).toContain('tpad=stop_mode=clone:stop=240,trim=end_frame=240')
    // Cada hueco: -an, desde donde va y lo que dura el collage (+1 s).
    const at = cmd.args.indexOf(red.path)
    expect(cmd.args.slice(at - 6, at + 1)).toEqual(['-an', '-ss', '0', '-t', '9', '-i', red.path])
    // Solo el tramo del collage pasa a RGB: el resto del vídeo, tal cual.
    expect(f).toMatch(/trim=start_frame=60:end_frame=300/)
  })

  it('recortado por delante, cada hueco sigue por donde iba; el que ya se acabó, desde su final', () => {
    let p = project()
    p = updateCollage(p, 'col', (c) => setCellStart(c, 1, 1500))
    p = { ...p, tracks: p.tracks.map((t) => ({ ...t, items: t.items.map((i) => ({ ...i, phaseMs: 3000 })) })) }
    const args = buildExportCommand(p, media, 'youtube', 'libx264', 'o.mp4').args
    const at = args.indexOf(red.path)
    expect(args[at - 4]).toBe('4.5')
    // El alto (2 s) ya se acabó: desde 250 ms antes de su final (tpad repite su última imagen).
    expect(args[args.indexOf(tall.path) - 4]).toBe('1.75')
  })

  it('suena cada hueco no silenciado como un sonido más (y en «Solo el sonido»); el collage en sí, no', () => {
    // El rojo y el alto tienen sonido; el azul, no.
    let p = project()
    let planned = planTrackItems(p, media, projectTiming(p), () => null)
    expect(planned.map((x) => [x.kind, x.path, x.startMs, x.lengthMs])).toEqual([
      ['effect', '', 2000, 8000],
      ['sound', tall.path, 2000, 8000],
      ['sound', red.path, 2000, 8000],
    ])
    // El alto dura 2 s: su sonido se lee solo hasta su final (apad pone el silencio).
    const cmd = buildExportCommand(p, media, 'youtube', 'libx264', 'o.mp4')
    expect(cmd.filterComplex).toContain('[amain][t0][t1]amix=inputs=3:normalize=0')
    expect(cmd.filterComplex).toContain('adelay=delays=96000S:all=1[t0]')
    expect(cmd.args.slice(cmd.args.lastIndexOf(tall.path) - 6, cmd.args.lastIndexOf(tall.path))).toEqual(['-vn', '-ss', '0', '-t', '2.1', '-i'])
    // Silenciado, no suena.
    p = updateCollage(p, 'col', (c) => setCellMuted(c, 0, true))
    planned = planTrackItems(p, media, projectTiming(p), () => null)
    expect(planned.map((x) => [x.kind, x.path])).toEqual([
      ['effect', ''],
      ['sound', red.path],
    ])
    const sound = buildSoundExportCommand(p, media, 'o.m4a')
    expect(sound.filterComplex).toContain('amix=inputs=2')
    // «Solo el sonido» no lee ningún vídeo de los huecos que no suenan.
    expect(sound.args).not.toContain(blue.path)
    expect(sound.args).not.toContain(tall.path)
    expect(sound.args.slice(sound.args.indexOf(red.path) - 6, sound.args.indexOf(red.path))).toEqual(['-vn', '-ss', '0', '-t', '8.1', '-i'])
  })

  it('un hueco vacío o sin su fichero es fondo liso', () => {
    let p = project()
    p = updateCollage(p, 'col', (c) => ({ ...c, cells: [c.cells[0]!, { ...c.cells[1]!, source: null }, c.cells[2]!] }))
    const { [blue.path]: _gone, ...lessMedia } = media
    const f = buildExportCommand(p, lessMedia, 'youtube', 'libx264', 'o.mp4').filterComplex
    expect(f.match(/color=c=0x1c2229:s=956x536:r=30,trim=end_frame=180/g)).toHaveLength(2)
  })

  it('reducido y quieto se monta a su tamaño; con marcas, a pantalla completa y escalado en cada fotograma', () => {
    let p = setEffectLook(project(), 'col', { box: { scale: 0.5, x: 0.25, y: 0.25 } })
    let f = buildExportCommand(p, media, 'youtube', 'libx264', 'o.mp4').filterComplex
    expect(f).toMatch(/xstack=inputs=3:layout=0_0\|482_0\|482_272:fill=0x1c2229/)
    expect(f).toContain('overlay=x=0:y=0:format=gbrp')
    p = updateEffectLook(p, 'col', (l) => setBoxAt(addMark(l, 0), 4000, { x: 0.75 }))
    f = buildExportCommand(p, media, 'youtube', 'libx264', 'o.mp4').filterComplex
    expect(f).toMatch(/xstack=inputs=3:layout=0_0\|964_0\|964_544/)
    expect(f).toMatch(/scale=w='max\(2,1920\*/)
    expect(f).toContain('eval=frame')
  })

  it('separación blanca o ninguna', () => {
    const white = updateCollage(project(), 'col', (c) => ({ ...c, gap: 'white' }))
    expect(buildExportCommand(white, media, 'youtube', 'libx264', 'o.mp4').filterComplex).toContain('fill=0xffffff')
    const none = updateCollage(project(), 'col', (c) => ({ ...c, gap: 'none' }))
    expect(buildExportCommand(none, media, 'youtube', 'libx264', 'o.mp4').filterComplex).toMatch(/layout=0_0\|960_0\|960_540/)
  })
})
