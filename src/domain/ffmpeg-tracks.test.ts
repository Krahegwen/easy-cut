import { describe, expect, it } from 'vitest'
import { buildExportCommand, buildSoundExportCommand, effectRegions, MIX_LIMIT, planTrackItems } from './ffmpeg-args'
import { addClip, createClip, createProject, type MediaInfo, type Project, type TrackItem } from './project'
import { fakeAudio, fakeMedia } from './test-helpers'
import { createItem, insertItem, projectTiming, setItemFade, setItemRepeat, setItemVolume, setMainMuted, setTrackHidden, setTrackMuted, type NewItem } from './tracks'

const hd = fakeMedia({ path: 'C:\\v\\a.mp4', durationMs: 10_000 })
const hd2 = fakeMedia({ path: 'C:\\v\\b.mp4', durationMs: 10_000 })
const music = fakeAudio({ path: 'C:\\s\\musica.mp3', durationMs: 4000 })
const ding = fakeAudio({ path: 'C:\\s\\ding.wav', durationMs: 1000 })
const sparks = fakeMedia({ path: 'C:\\fx\\chispas.mp4', durationMs: 6000, hasAudio: false })
const hearts = fakeMedia({ path: 'C:\\fx\\corazones.webm', durationMs: 5000, hasAudio: false, videoCodec: 'vp9', pixelFormat: 'yuv420p', hasAlpha: true, width: 1280, height: 720 })
const logo = fakeMedia({ path: 'C:\\fx\\logo.png', durationMs: 0, hasAudio: false, videoCodec: 'png', width: 400, height: 200, isStill: true, hasAlpha: true })
const media: Record<string, MediaInfo> = Object.fromEntries([hd, hd2, music, ding, sparks, hearts, logo].map((m) => [m.path, m]))

function item(id: string, kind: 'sound' | 'effect', m: MediaInfo, extra: Partial<NewItem> = {}): TrackItem {
  return createItem({ id, kind, source: { type: 'file', path: m.path }, name: id, sourceDurationMs: m.durationMs, still: m.isStill, hasAudio: m.hasAudio, ...extra })
}

function put(p: Project, it: TrackItem, kind: 'sound' | 'effect', at: number, trackId: string): Project {
  const r = insertItem(p, it, kind, at, { id: trackId })
  if (!r.ok) throw new Error('no cabe')
  return r.project
}

function twoClips(): Project {
  return addClip(addClip(createProject(), createClip(hd, 'a')), createClip(hd2, 'b'))
}

describe('guardar con pistas de sonido', () => {
  it('sin pistas, el filtro es el de siempre', () => {
    const cmd = buildExportCommand(twoClips(), media, 'whatsapp', 'libx264', 'o.mp4')
    expect(cmd.filterComplex).toMatch(/concat=n=2:v=1:a=1\[vout\]\[aout\]$/)
    expect(cmd.filterComplex).not.toContain('amix')
  })

  it('mezcla sin bajar la voz, con limitador, y cada sonido en su sitio (en muestras)', () => {
    let p = put(twoClips(), item('music', 'sound', music, { defaults: { repeat: true, durationMs: null, volume: 0.5 } }), 'sound', 0, 'mus')
    p = setItemFade(setItemFade(p, 'music', 'in', true), 'music', 'out', true)
    p = put(p, item('ding', 'sound', ding), 'sound', 12_500, 'fx')
    const cmd = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4')
    const f = cmd.filterComplex
    expect(f).toContain('concat=n=2:v=1:a=1[vmain][amain]')
    expect(f).toContain('[amain][t0][t1]amix=inputs=3:normalize=0:duration=first:dropout_transition=0')
    expect(f).toContain(`alimiter=limit=${MIX_LIMIT}:level=0:latency=1`)
    // 20 s a 30 fps = 600 fotogramas = 960 000 muestras, exactas.
    expect(f).toContain('apad=whole_len=960000,atrim=end_sample=960000')
    // La música repite el fichero entero con -stream_loop; 20 s, volumen 0,5, suaves de 1 s.
    const musicInput = cmd.args.indexOf(music.path)
    expect(cmd.args.slice(musicInput - 6, musicInput)).toEqual(['-vn', '-stream_loop', '-1', '-t', '20.5', '-i'])
    expect(f).toMatch(/apad=whole_len=960000,atrim=end_sample=960000,volume=0\.5,afade=t=in:ss=0:ns=48000,afade=t=out:ss=912000:ns=48000\[t0\]/)
    // El «ding» empieza a los 12,5 s = 600 000 muestras.
    expect(f).toContain('adelay=delays=600000S:all=1[t1]')
    expect(cmd.args.slice(cmd.args.indexOf(ding.path) - 6, cmd.args.indexOf(ding.path))).toEqual(['-vn', '-ss', '0', '-t', '1.1', '-i'])
  })

  it('un trozo del original que se repite va con aloop; la vuelta sigue por su sitio', () => {
    let p = put(twoClips(), item('m', 'sound', music), 'sound', 1000, 'mus')
    p = { ...p, tracks: p.tracks.map((t) => ({ ...t, items: t.items.map((i) => ({ ...i, inMs: 1000, outMs: 3000, repeat: true, durationMs: 5000, phaseMs: 500 })) })) }
    const f = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(f).toContain('atrim=end_sample=96000,aloop=loop=-1:size=96000,asetpts=N/SR/TB,atrim=start=0.5')
    expect(f).toContain('adelay=delays=48000S:all=1')
  })

  it('pista silenciada y efectos sin volumen no suenan; la fila principal silenciada va en silencio', () => {
    let p = put(twoClips(), item('m', 'sound', music), 'sound', 0, 'mus')
    p = put(p, item('d', 'sound', ding), 'sound', 2000, 'otra')
    p = setTrackMuted(p, 'mus', true)
    const f = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(f).toContain('amix=inputs=2')
    expect(f).not.toContain('musica')
    const muted = buildExportCommand(setMainMuted(twoClips(), true), media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(muted.match(/anullsrc/g)).toHaveLength(2)
    expect(muted).not.toContain('[0:a:0]')
  })

  it('lo que sobresale del final se corta; lo que cae fuera no se pone', () => {
    const p = put(twoClips(), item('m', 'sound', music), 'sound', 18_000, 'mus')
    const planned = planTrackItems(p, media, projectTiming(p), (i) => (i.source.type === 'file' ? i.source.path : null))
    expect(planned.map((x) => [x.startMs, x.lengthMs])).toEqual([[18_000, 2000]])
  })

  it('«Solo el sonido» también lleva las pistas', () => {
    const p = put(twoClips(), item('d', 'sound', ding), 'sound', 2500, 'fx')
    const cmd = buildSoundExportCommand(p, media, 'o.m4a')
    expect(cmd.filterComplex).toContain('concat=n=2:v=0:a=1[amain]')
    expect(cmd.filterComplex).toContain('adelay=delays=120000S:all=1')
    expect(cmd.filterComplex).toContain('apad=whole_len=960000,atrim=end_sample=960000')
    expect(cmd.expectedDurationMs).toBe(20_000)
  })

  it('un elemento de la biblioteca necesita su fichero (itemPath); sin él no se pone', () => {
    const lib = createItem({ id: 'l', kind: 'sound', source: { type: 'library', assetId: 'aplausos' }, name: 'Aplausos', sourceDurationMs: 1000, hasAudio: true })
    const p = put(twoClips(), lib, 'sound', 1000, 's')
    expect(buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex).not.toContain('amix')
    const f = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4', { itemPath: () => ding.path }).filterComplex
    expect(f).toContain('amix=inputs=2')
  })
})

describe('guardar con pistas de efectos', () => {
  it('«Como luz»: blend screen solo en su tramo, en RGB y de vuelta a BT.709', () => {
    let p = put(twoClips(), item('sp', 'effect', sparks, { defaults: { look: { mix: 'light', opacity: 0.8 } } }), 'effect', 4000, 'e1')
    p = setItemFade(p, 'sp', 'in', true)
    const cmd = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4')
    const f = cmd.filterComplex
    // Tramos: 0–120 sin efecto, 120–300 con él, 300–600 sin efecto.
    expect(f).toContain('[vmain]split=3[fxs0][fxs1][fxs2]')
    expect(f).toContain('[fxs0]trim=start_frame=0:end_frame=120,setpts=PTS-STARTPTS[fxp0]')
    expect(f).toContain('[fxs1]trim=start_frame=120:end_frame=300,setpts=PTS-STARTPTS,scale=in_color_matrix=bt709:in_range=tv:flags=bicubic,format=gbrp[fxb1_0]')
    expect(f).toMatch(/scale=1280:720:flags=bicubic,format=gbrp,fade=t=in:st=0:d=0\.5,setpts=PTS-STARTPTS\+0\/TB\[fxe1_0\]/)
    expect(f).toContain('[fxb1_0][fxe1_0]blend=all_mode=screen:all_opacity=0.8:eof_action=pass:shortest=0[fxb1_1]')
    expect(f).toContain('[fxb1_1]scale=out_color_matrix=bt709:out_range=tv:flags=bicubic,setsar=1,format=yuv420p,setparams')
    expect(f).toContain('[fxp0][fxp1][fxp2]concat=n=3:v=1:a=0[vout]')
    // El efecto solo se lee durante su tramo: -ss 0 -t (6 s + margen).
    const i = cmd.args.indexOf(sparks.path)
    expect(cmd.args.slice(i - 6, i)).toEqual(['-an', '-ss', '0', '-t', '6.5', '-i'])
  })

  it('«Normal» con alfa (WebM VP9): decoder libvpx-vp9, tamaño y sitio, transparencia y overlay', () => {
    let p = put(twoClips(), item('h', 'effect', hearts, { defaults: { look: { mix: 'normal', opacity: 0.5, box: { x: 0.75, y: 0.25, scale: 0.4 } } } }), 'effect', 0, 'e1')
    p = setItemRepeat(p, 'h', true)
    const cmd = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4')
    const f = cmd.filterComplex
    const i = cmd.args.indexOf(hearts.path)
    expect(cmd.args.slice(i - 8, i)).toEqual(['-c:v', 'libvpx-vp9', '-an', '-stream_loop', '-1', '-t', '21', '-i'])
    // Un solo tramo (todo el vídeo): sin partir.
    expect(f).toContain('[vmain]null[fxs0]')
    // 1280×720 · 0,4 = 512×288, centrado en (960, 180) → esquina en (704, 36).
    expect(f).toMatch(/scale=512:288:flags=bicubic,format=gbrap,colorchannelmixer=aa=0\.5,setpts=PTS-STARTPTS\+0\/TB\[fxe0_0\]/)
    expect(f).toContain('[fxb0_0][fxe0_0]overlay=x=704:y=36:format=gbrp:eof_action=pass:shortest=0[fxb0_1]')
  })

  it('una imagen fija entra con -loop 1 y dura lo suyo; las pistas ocultas no salen', () => {
    let p = put(twoClips(), item('logo', 'effect', logo), 'effect', 2000, 'e1')
    p = put(p, item('sp', 'effect', sparks, { defaults: { look: { mix: 'light' } } }), 'effect', 3000, 'e2')
    const cmd = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4')
    const i = cmd.args.indexOf(logo.path)
    expect(cmd.args.slice(i - 7, i)).toEqual(['-loop', '1', '-framerate', '30', '-t', '4.5', '-i'])
    expect(cmd.filterComplex).toContain('overlay=')
    const hidden = buildExportCommand(setTrackHidden(p, 'e2', true), media, 'whatsapp', 'libx264', 'o.mp4')
    expect(hidden.filterComplex).not.toContain('blend=')
    expect(hidden.args).not.toContain(sparks.path)
  })

  it('efectos que se solapan van en el mismo tramo, de abajo arriba por pista', () => {
    let p = put(twoClips(), item('low', 'effect', sparks, { defaults: { look: { mix: 'light' } } }), 'effect', 1000, 'e1')
    // La pista nueva de efectos va encima.
    p = put(p, item('top', 'effect', logo), 'effect', 3000, 'e2')
    const planned = planTrackItems(p, media, projectTiming(p), (it) => (it.source.type === 'file' ? it.source.path : null))
    const regions = effectRegions(planned, p, 30, 600)
    expect(regions).toHaveLength(1)
    expect([regions[0]!.startFrame, regions[0]!.endFrame]).toEqual([30, 210])
    expect(regions[0]!.effects.map((e) => e.p.item.id)).toEqual(['low', 'top'])
  })

  it('un efecto con sonido solo suena si se le sube el volumen', () => {
    const withAudio = fakeMedia({ path: 'C:\\fx\\fuegos.mp4', durationMs: 3000, hasAudio: true })
    const m = { ...media, [withAudio.path]: withAudio }
    let p = put(twoClips(), item('fw', 'effect', withAudio), 'effect', 1000, 'e1')
    expect(buildExportCommand(p, m, 'whatsapp', 'libx264', 'o.mp4').filterComplex).not.toContain('amix')
    p = setItemVolume(p, 'fw', 0.7)
    expect(buildExportCommand(p, m, 'whatsapp', 'libx264', 'o.mp4').filterComplex).toContain('volume=0.7')
  })
})
