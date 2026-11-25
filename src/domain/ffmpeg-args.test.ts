import { describe, expect, it } from 'vitest'
import {
  atempoChain,
  BT709_SETPARAMS,
  buildExportArgs,
  buildExportCommand,
  clipFrameCount,
  clipKeepsAudio,
  exportedProjectDurationMs,
  planFraming,
  rotationFilters,
  sec,
  toneMapFilters,
} from './ffmpeg-args'
import {
  addClip,
  applyKeepSegments,
  createClip,
  createProject,
  rotateClip,
  setFraming,
  setInOut,
  setMuted,
  setSpeed,
  type Clip,
  type MediaInfo,
} from './project'
import { fakeMedia } from './test-helpers'

const hd = fakeMedia({ path: 'C:\\v\\hd.mp4', durationMs: 10_000 })
const vertical = fakeMedia({ path: 'C:\\v\\vert.mp4', width: 1080, height: 1920, fps: 60 })
const silentSrc = fakeMedia({ path: 'C:\\v\\mute.mp4', hasAudio: false })
const hdr = fakeMedia({ path: 'C:\\v\\hdr.mov', isHdr: true, colorTransfer: 'arib-std-b67' })
const media = new Map<string, MediaInfo>([hd, vertical, silentSrc, hdr].map((m) => [m.path, m]))

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

describe('utilidades', () => {
  it('segundos sin ceros sobrantes', () => {
    expect(sec(0)).toBe('0')
    expect(sec(1500)).toBe('1.5')
    expect(sec(12_000)).toBe('12')
    expect(sec(33)).toBe('0.033')
  })

  it('atempo encadenado dentro de [0.5, 2]', () => {
    expect(atempoChain(1)).toEqual([])
    expect(atempoChain(2)).toEqual(['atempo=2'])
    expect(atempoChain(0.5)).toEqual(['atempo=0.5'])
    expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2'])
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5'])
    expect(atempoChain(3)).toEqual(['atempo=2', 'atempo=1.5'])
  })

  it('giros', () => {
    expect(rotationFilters(0)).toEqual([])
    expect(rotationFilters(1)).toEqual(['transpose=clock'])
    expect(rotationFilters(2)).toEqual(['hflip', 'vflip'])
    expect(rotationFilters(3)).toEqual(['transpose=cclock'])
  })

  it('tone mapping con zscale + hable según la transferencia', () => {
    const f = toneMapFilters(hdr)
    expect(f[0]).toContain('tin=arib-std-b67')
    expect(f).toContain('tonemap=tonemap=hable:desat=0')
    expect(toneMapFilters({ ...hdr, colorTransfer: 'smpte2084' })[0]).toContain('tin=smpte2084')
  })

  it('cuándo va el sonido', () => {
    const c = createClip(hd, 'a')
    expect(clipKeepsAudio(c, hd)).toBe(true)
    expect(clipKeepsAudio({ ...c, muted: true }, hd)).toBe(false)
    expect(clipKeepsAudio({ ...c, speed: 4 }, hd)).toBe(false)
    expect(clipKeepsAudio(c, silentSrc)).toBe(false)
  })

  it('fotogramas enteros por trozo', () => {
    const c: Clip = { ...createClip(hd, 'a'), segments: [{ startMs: 0, endMs: 1010 }] }
    expect(clipFrameCount(c, 30)).toBe(30)
    expect(clipFrameCount({ ...c, segments: [{ startMs: 0, endMs: 10 }] }, 30)).toBe(1)
  })
})

describe('encuadre', () => {
  const out = { width: 1920, height: 1080 }

  it('mismo formato: sin fondo, solo escalar', () => {
    const plan = planFraming(createClip(hd, 'a'), hd, out)
    expect(plan.background).toBeNull()
    expect(plan.foreground).toEqual(['scale=1920:1080:flags=bicubic:out_color_matrix=bt709:out_range=tv'])
  })

  it('vertical dentro de horizontal (fit-blur): fondo desenfocado y centrado', () => {
    const plan = planFraming(createClip(vertical, 'v'), vertical, out)
    expect(plan.foreground[0]).toMatch(/^scale=608:1080:/)
    expect(plan.background).not.toBeNull()
    expect(plan.background!.join(',')).toContain('boxblur')
    expect(plan.background![plan.background!.length - 1]).toMatch(/^scale=1920:1080:/)
    expect(plan.overlayX).toBe(656)
    expect(plan.overlayY).toBe(0)
  })

  it('fill: cubre y recorta con desplazamiento', () => {
    const c = { ...createClip(vertical, 'v'), framing: { mode: 'fill' as const, zoom: 1, offsetX: 0, offsetY: -1 } }
    const plan = planFraming(c, vertical, out)
    expect(plan.background).toBeNull()
    expect(plan.foreground[0]).toMatch(/^scale=1920:3414:/)
    expect(plan.foreground[1]).toBe('crop=1920:1080:0:0')
    const bottom = planFraming({ ...c, framing: { ...c.framing, offsetY: 1 } }, vertical, out)
    expect(bottom.foreground[1]).toBe('crop=1920:1080:0:2334')
  })

  it('fit-blur con zoom: recorta el vídeo principal si se sale', () => {
    const c = { ...createClip(vertical, 'v'), framing: { mode: 'fit-blur' as const, zoom: 2, offsetX: 0, offsetY: 0 } }
    const plan = planFraming(c, vertical, out)
    expect(plan.foreground[0]).toMatch(/^scale=1216:2160:/)
    expect(plan.foreground[1]).toBe('crop=1216:1080:0:540')
    expect(plan.overlayX).toBe(352)
  })

  it('el giro cambia la forma: vertical girado 90° llena un 16:9', () => {
    const c = { ...createClip(vertical, 'v'), quarterTurns: 1 as const }
    expect(planFraming(c, vertical, out).background).toBeNull()
  })
})

describe('buildExportArgs', () => {
  it('un trozo simple: -ss/-t de entrada, concat de 1 y opciones de salida', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = setInOut(p, 'a', { inMs: 1500, outMs: 4000 })
    const args = buildExportArgs(p, media, 'whatsapp', 'libx264', 'C:\\Salida\\v.mp4')
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 6)).toEqual(['-ss', '1.5', '-t', '2.5', '-i', 'C:\\v\\hd.mp4'])
    const fc = opt(args, '-filter_complex')!
    expect(fc).toContain('[0:v:0]setpts=PTS-STARTPTS[v0seg]')
    expect(fc).toContain('fps=30')
    expect(fc).toContain('trim=end_frame=75')
    expect(fc).toContain(BT709_SETPARAMS)
    expect(fc).toContain('apad=whole_len=120000')
    expect(fc).toContain('atrim=end_sample=120000')
    expect(fc).toContain('afade=t=in:d=0.03')
    expect(fc).toContain('afade=t=out:st=2.47:d=0.03')
    expect(fc).toContain('concat=n=1:v=1:a=1[vout][aout]')
    expect(args).toContain('+faststart')
    expect(opt(args, '-progress')).toBe('pipe:1')
    expect(args).toContain('-nostats')
    expect(args).toContain('-y')
    expect(opt(args, '-colorspace')).toBe('bt709')
    expect(opt(args, '-b:a')).toBe('128k')
    expect(opt(args, '-r')).toBe('30')
    expect(args[args.length - 1]).toBe('C:\\Salida\\v.mp4')
  })

  it('varios rangos: split + trim por rango y concat dentro del trozo, con microfundidos', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = applyKeepSegments(p, 'a', [
      { startMs: 1000, endMs: 2000 },
      { startMs: 3000, endMs: 4500 },
    ])
    p = setSpeed(p, 'a', 2)
    const cmd = buildExportCommand(p, media, 'youtube', 'libx264', 'o.mp4')
    const fc = cmd.filterComplex
    expect(opt(cmd.args, '-ss')).toBe('1')
    expect(opt(cmd.args, '-t')).toBe('3.5')
    expect(fc).toContain('[0:v:0]split=2[v0s0][v0s1]')
    expect(fc).toContain('trim=start=0:end=1,setpts=PTS-STARTPTS[v0t0]')
    expect(fc).toContain('trim=start=2:end=3.5,setpts=PTS-STARTPTS[v0t1]')
    expect(fc).toContain('[v0t0][v0t1]concat=n=2:v=1:a=0[v0seg]')
    expect(fc).toContain('asplit=2[a0s0][a0s1]')
    expect(fc).toContain('atrim=start=2:end=3.5,asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st=1.47:d=0.03')
    expect(fc).toContain('setpts=(PTS-STARTPTS)/2')
    expect(fc).toContain('atempo=2')
    // 2500 ms conservados / 2 = 1250 ms → 37,5 → 38 fotogramas a 30 fps.
    expect(fc).toContain('trim=end_frame=38')
    expect(cmd.expectedDurationMs).toBeCloseTo((38 * 1000) / 30, 6)
  })

  it('a ×4, silenciado o sin pista de audio: silencio de la duración exacta', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = setSpeed(p, 'a', 4)
    p = addClip(p, createClip(hd, 'b'))
    p = setMuted(p, 'b', true)
    p = addClip(p, createClip(silentSrc, 'c'))
    const fc = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(fc).not.toContain('[0:a:0]')
    expect(fc).not.toContain('[1:a:0]')
    expect(fc).not.toContain('[2:a:0]')
    expect(fc).toContain('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end_sample=120000')
    expect(fc).toContain('anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end_sample=480000')
    expect(fc).toContain('concat=n=3:v=1:a=1[vout][aout]')
  })

  it('×0.5 con audio usa atempo=0.5', () => {
    const p = setSpeed(addClip(createProject(), createClip(hd, 'a')), 'a', 0.5)
    const fc = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(fc).toContain('setpts=(PTS-STARTPTS)/0.5')
    expect(fc).toContain('atempo=0.5')
    expect(fc).toContain('trim=end_frame=600')
  })

  it('vertical dentro de horizontal, HDR y giro', () => {
    let p = addClip(createProject(), createClip(vertical, 'v'))
    p = addClip(p, createClip(hdr, 'h'))
    p = rotateClip(p, 'h')
    p = setFraming(p, 'h', { mode: 'fill' })
    const fc = buildExportCommand(p, media, 'high', 'h264_nvenc', 'o.mp4').filterComplex
    expect(fc).toContain('split=2[v0bgsrc][v0fgsrc]')
    expect(fc).toContain('[v0bg][v0fg]overlay=x=656:y=0:shortest=1')
    expect(fc).toMatch(/\[v1seg\][^;]*zscale=tin=arib-std-b67[^;]*tonemap=tonemap=hable[^;]*transpose=clock/)
  })

  it('encoder y preset llegan a los argumentos; filtro en fichero si se pide', () => {
    const p = addClip(createProject(), createClip(hd, 'a'))
    const cmd = buildExportCommand(p, media, 'youtube', 'h264_nvenc', 'o.mp4', { filterScriptPath: 'C:\\tmp\\f.txt' })
    expect(opt(cmd.args, '-c:v')).toBe('h264_nvenc')
    expect(opt(cmd.args, '-/filter_complex')).toBe('C:\\tmp\\f.txt')
    expect(cmd.args).not.toContain('-filter_complex')
    expect(opt(cmd.args, '-b:a')).toBe('384k')
  })

  it('duración exportada = suma de fotogramas enteros; proyecto vacío falla', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = addClip(p, createClip(vertical, 'b'))
    expect(exportedProjectDurationMs(p, 30)).toBe(20_000)
    expect(() => buildExportArgs(createProject(), media, 'youtube', 'libx264', 'o.mp4')).toThrow(/no tiene trozos/)
  })
})
