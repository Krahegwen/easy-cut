// «Imagen» de los trozos (su vídeo, solo sonido, otro vídeo encima, esquina) y «Solo el sonido».
import { describe, expect, it } from 'vitest'
import { buildExportCommand, buildSoundExportCommand, coverSeekMs, roundedMaskExpression, soundSampleCount } from './ffmpeg-args'
import { buildOutputFileName, isAudioPath, isMediaPath, isVideoPath } from './file-name'
import { dominantAspect, insetRect, PLAIN_BACKGROUND_HEX } from './layout'
import { computeOutputSpec, estimateSoundSizeBytes, visibleMedia } from './output'
import { buildPlaybackPlan, clipOutputAt, coverNeedsResync, coverTimeAt, previewPicture } from './playback'
import {
  addClip,
  applyKeepSegments,
  clipOutputMs,
  clipPaths,
  clipShowsOwnVideo,
  COVER_MIN_TAIL_MS,
  coverShortfallMs,
  createClip,
  createProject,
  findClip,
  parseProject,
  removeCover,
  serializeProject,
  setCover,
  setCoverFraming,
  setCoverStart,
  setInset,
  setPicture,
  setSpeed,
  splitClip,
  type CoverPicture,
  type MediaInfo,
  type Project,
  syncMediaPool,
} from './project'
import { fakeAudio, fakeMedia } from './test-helpers'

const hd = fakeMedia({ path: 'C:\\v\\hd.mp4', durationMs: 10_000 })
const vertical = fakeMedia({ path: 'C:\\v\\vert.mp4', width: 1080, height: 1920, fps: 60, durationMs: 8_000 })
const shortCover = fakeMedia({ path: 'C:\\v\\corto.mp4', durationMs: 3_000, width: 1280, height: 720 })
const voice = fakeAudio({ path: 'C:\\v\\voz.m4a', durationMs: 12_000 })
const media = new Map<string, MediaInfo>([hd, vertical, shortCover, voice].map((m) => [m.path, m]))

function cover(p: Project, id: string): CoverPicture {
  const c = findClip(p, id)!
  if (c.picture.kind !== 'cover') throw new Error('sin vídeo encima')
  return c.picture
}

describe('modelo de la imagen', () => {
  it('un trozo de vídeo enseña su vídeo; uno de sonido, el fondo liso (y no puede pasar a «su vídeo»)', () => {
    const v = createClip(hd, 'a')
    expect(v.picture).toEqual({ kind: 'own' })
    expect(v.sourceHasVideo).toBe(true)
    const s = createClip(voice, 's')
    expect(s.picture).toEqual({ kind: 'none' })
    expect(s.sourceHasVideo).toBe(false)
    const p = addClip(createProject(), s)
    expect(findClip(setPicture(p, 's', { kind: 'own' }), 's')!.picture).toEqual({ kind: 'none' })
  })

  it('quitar la imagen y volver a ponerla', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = setPicture(p, 'a', { kind: 'none' })
    expect(findClip(p, 'a')!.picture.kind).toBe('none')
    expect(clipShowsOwnVideo(findClip(p, 'a')!)).toBe(false)
    const same = setPicture(p, 'a', { kind: 'none' })
    expect(same).toBe(p)
    p = setPicture(p, 'a', { kind: 'own' })
    expect(clipShowsOwnVideo(findClip(p, 'a')!)).toBe(true)
  })

  it('poner otro vídeo encima, empezar en…, encuadre, esquina y quitarlo', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = setCover(p, 'a', vertical, 1000)
    expect(cover(p, 'a')).toMatchObject({ sourcePath: vertical.path, sourceDurationMs: 8000, startMs: 1000, inset: null, quarterTurns: 0 })
    expect(clipPaths(findClip(p, 'a')!)).toEqual([hd.path, vertical.path])
    // «Empieza en…» no pasa del final menos medio segundo.
    p = setCoverStart(p, 'a', 99_000)
    expect(cover(p, 'a').startMs).toBe(8000 - COVER_MIN_TAIL_MS)
    p = setCoverStart(p, 'a', -5)
    expect(cover(p, 'a').startMs).toBe(0)
    p = setCoverFraming(p, 'a', { mode: 'fill' })
    expect(cover(p, 'a').framing.mode).toBe('fill')
    p = setInset(p, 'a', { corner: 'bottom-right', size: 'small' })
    expect(clipShowsOwnVideo(findClip(p, 'a')!)).toBe(true)
    // Cambiarlo por otro conserva la esquina.
    p = setCover(p, 'a', shortCover)
    expect(cover(p, 'a').inset).toEqual({ corner: 'bottom-right', size: 'small' })
    p = removeCover(p, 'a')
    expect(findClip(p, 'a')!.picture).toEqual({ kind: 'own' })
  })

  it('la esquina solo vale si el trozo tiene imagen propia', () => {
    let p = addClip(createProject(), createClip(voice, 's'))
    p = setCover(p, 's', hd)
    p = setInset(p, 's', { corner: 'top-left', size: 'medium' })
    expect(cover(p, 's').inset).toBeNull()
    expect(findClip(removeCover(p, 's'), 's')!.picture).toEqual({ kind: 'none' })
  })

  it('vídeo de encima más corto que el trozo: cuánto le falta', () => {
    let p = addClip(createProject(), createClip(voice, 's'))
    p = setCover(p, 's', shortCover, 1000)
    // El trozo dura 12 s; el otro vídeo da 2 s desde el segundo 1.
    expect(coverShortfallMs(findClip(p, 's')!)).toBe(10_000)
    p = setSpeed(p, 's', 4)
    expect(coverShortfallMs(findClip(p, 's')!)).toBe(1000)
  })
})

describe('partir un trozo con vídeo encima', () => {
  it('la segunda parte sigue el vídeo de encima donde iba (en tiempo de salida)', () => {
    let p = addClip(createProject(), createClip(voice, 's'))
    p = setCover(p, 's', hd, 500)
    p = setSpeed(p, 's', 2)
    p = splitClip(p, 's', 2000, 's2')
    expect(cover(p, 's').startMs).toBe(500)
    expect(cover(p, 's2').startMs).toBe(2500)
    expect(cover(p, 's2').sourcePath).toBe(hd.path)
  })

  it('con pausas quitadas cuenta la salida, no el original', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = applyKeepSegments(p, 'a', [
      { startMs: 0, endMs: 2000 },
      { startMs: 5000, endMs: 10_000 },
    ])
    p = setCover(p, 'a', vertical)
    p = splitClip(p, 'a', 3000, 'b')
    expect(clipOutputMs(findClip(p, 'a')!)).toBe(3000)
    expect(cover(p, 'b').startMs).toBe(3000)
  })

  it('si la segunda parte empieza después del final del otro vídeo, se queda en su final', () => {
    let p = addClip(createProject(), createClip(voice, 's'))
    p = setCover(p, 's', shortCover)
    p = splitClip(p, 's', 9000, 's2')
    expect(cover(p, 's2').startMs).toBe(3000)
  })
})

describe('migración y lectura', () => {
  it('un proyecto de la versión 1 se lee con su vídeo en cada trozo', () => {
    const v1 = JSON.stringify({
      app: 'easy-cut',
      version: 1,
      project: {
        aspect: '16:9',
        targetDurationMs: null,
        clips: [
          { id: 'a', sourcePath: 'C:\\v\\a.mp4', sourceDurationMs: 5000, segments: [{ startMs: 0, endMs: 5000 }], speed: 1, muted: false, quarterTurns: 0, framing: { mode: 'fill', zoom: 1, offsetX: 0, offsetY: 0 } },
        ],
      },
    })
    const p = parseProject(v1)
    expect(p.version).toBe(5)
    expect(p.clips[0]!.picture).toEqual({ kind: 'own' })
    expect(p.clips[0]!.sourceHasVideo).toBe(true)
    expect(p.tracks).toEqual([])
    expect(p.mainMuted).toBe(false)
    expect(JSON.parse(serializeProject(p)).version).toBe(5)
  })

  it('ida y vuelta con sonido, fondo liso, vídeo encima y esquina', () => {
    let p = addClip(createProject(), createClip(voice, 's'))
    p = addClip(p, createClip(hd, 'a'))
    p = setCover(p, 'a', vertical, 1200)
    p = setInset(p, 'a', { corner: 'top-right', size: 'medium' })
    p = addClip(p, createClip(hd, 'b'))
    p = setPicture(p, 'b', { kind: 'none' })
    expect(parseProject(serializeProject(p))).toEqual(syncMediaPool(p))
  })

  it('una imagen dañada vuelve a lo de serie sin perder el trozo', () => {
    const json = JSON.stringify({
      app: 'easy-cut',
      version: 2,
      project: {
        aspect: '16:9',
        clips: [
          { id: 'a', sourcePath: 'C:\\a.mp4', sourceDurationMs: 5000, sourceHasVideo: true, segments: [{ startMs: 0, endMs: 5000 }], picture: { kind: 'cover', sourcePath: '' } },
          { id: 's', sourcePath: 'C:\\s.m4a', sourceDurationMs: 5000, sourceHasVideo: false, segments: [{ startMs: 0, endMs: 5000 }], picture: { kind: 'own' } },
          { id: 'c', sourcePath: 'C:\\s.m4a', sourceDurationMs: 5000, sourceHasVideo: false, segments: [{ startMs: 0, endMs: 5000 }], picture: { kind: 'cover', sourcePath: 'C:\\b.mp4', sourceDurationMs: 4000, startMs: 9000, inset: { corner: 'top-left', size: 'small' } } },
        ],
      },
    })
    const p = parseProject(json)
    expect(p.clips[0]!.picture).toEqual({ kind: 'own' })
    expect(p.clips[1]!.picture).toEqual({ kind: 'none' })
    expect(p.clips[2]!.picture).toMatchObject({ kind: 'cover', startMs: 4000, inset: null })
  })
})

describe('vista previa', () => {
  it('el vídeo de encima va en tiempo de salida, a velocidad normal, y se congela al acabarse', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = addClip(p, createClip(voice, 's'))
    p = setCover(p, 's', shortCover, 1000)
    p = setSpeed(p, 's', 2)
    const plan = buildPlaybackPlan(p)
    expect(plan.durationMs).toBe(16_000)
    // A los 11 s del vídeo completo: 1 s de salida del trozo 2 (a ×2 serían 2 s del original de la voz).
    const t = clipOutputAt(p, 1, 11_000)
    expect(t).toBe(1000)
    const c = cover(p, 's')
    expect(coverTimeAt(c, t)).toBe(2000)
    expect(coverTimeAt(c, 5000)).toBe(3000)
    expect(previewPicture(findClip(p, 's')!, 1000)).toEqual({ kind: 'cover', path: shortCover.path, timeMs: 2000, frozen: false, inset: null })
    expect(previewPicture(findClip(p, 's')!, 2500)).toMatchObject({ timeMs: 3000, frozen: true })
    expect(previewPicture(findClip(p, 'a')!, 0)).toEqual({ kind: 'own' })
    // Si el vídeo de encima no está en el disco, se enseña lo de serie.
    expect(previewPicture(findClip(p, 's')!, 0, false)).toEqual({ kind: 'none' })
  })

  it('se corrige la deriva a partir de 150 ms', () => {
    expect(coverNeedsResync(1000, 1100)).toBe(false)
    expect(coverNeedsResync(1000, 1200)).toBe(true)
  })

  it('la esquina en pantalla y en ffmpeg (pares) caen en el mismo sitio', () => {
    const screen = insetRect({ corner: 'bottom-right', size: 'small' }, 640, 360)
    expect(screen.width).toBeCloseTo(640 * 0.28)
    expect(screen.left + screen.width).toBeCloseTo(640 - 360 * 0.04)
    const ff = insetRect({ corner: 'bottom-right', size: 'small' }, 1280, 720, true)
    expect(ff).toEqual({ left: 1280 - 358 - 28, top: 720 - 202 - 28, width: 358, height: 202, radius: 16 })
    const tl = insetRect({ corner: 'top-left', size: 'medium' }, 1280, 720, true)
    expect([tl.left, tl.top, tl.width, tl.height]).toEqual([28, 28, 512, 288])
  })
})

describe('tamaño de salida', () => {
  it('los trozos sin imagen no cuentan; el vídeo de encima sí', () => {
    let p = addClip(createProject(), createClip(voice, 's'))
    p = addClip(p, createClip(hd, 'a'))
    p = setPicture(p, 'a', { kind: 'none' })
    expect(visibleMedia(p, media)).toEqual([])
    const spec = computeOutputSpec(p, media, 'high')
    expect([spec.width, spec.height, spec.fps]).toEqual([1280, 720, 30])
    p = setCover(p, 's', vertical)
    expect(visibleMedia(p, media)).toEqual([vertical])
    expect(computeOutputSpec(p, media, 'youtube').fps).toBe(60)
  })

  it('la forma por defecto no cuenta los sonidos', () => {
    expect(dominantAspect([voice, voice, vertical])).toBe('9:16')
    expect(dominantAspect([voice])).toBe('16:9')
  })
})

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

describe('ffmpeg según la imagen', () => {
  it('solo sonido (original M4A): fondo liso de la duración exacta y su audio', () => {
    const p = addClip(createProject(), createClip(voice, 's'))
    const cmd = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4')
    const fc = cmd.filterComplex
    expect(fc).toContain(`color=c=0x${PLAIN_BACKGROUND_HEX}:s=1280x720:r=30,trim=end_frame=360,`)
    expect(fc).not.toContain('[0:v:0]')
    expect(fc).toContain('[0:a:0]aresample=48000')
    expect(fc).toContain('apad=whole_len=576000')
    expect(cmd.expectedDurationMs).toBe(12_000)
  })

  it('imagen quitada en un vídeo: no se lee su imagen, sí su sonido', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = addClip(p, createClip(hd, 'b'))
    p = setPicture(p, 'b', { kind: 'none' })
    const fc = buildExportCommand(p, media, 'youtube', 'libx264', 'o.mp4').filterComplex
    expect(fc).toContain('[0:v:0]')
    expect(fc).not.toContain('[1:v:0]')
    expect(fc).toContain(`color=c=0x${PLAIN_BACKGROUND_HEX}:s=1920x1080:r=30,trim=end_frame=300`)
    expect(fc).toContain('[1:a:0]')
  })

  it('vídeo de encima: otra entrada desde startMs, sin su sonido, congelado con tpad hasta los fotogramas del trozo', () => {
    let p = addClip(createProject(), createClip(voice, 's'))
    p = applyKeepSegments(p, 's', [
      { startMs: 0, endMs: 4000 },
      { startMs: 6000, endMs: 12_000 },
    ])
    p = setCover(p, 's', shortCover, 1000)
    const cmd = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4')
    // Entradas: 0 = la voz, 1 = el vídeo de encima desde el segundo 1.
    expect(cmd.args.slice(cmd.args.lastIndexOf('-ss'), cmd.args.lastIndexOf('-ss') + 6)).toEqual(['-ss', '1', '-t', '11', '-i', shortCover.path])
    const fc = cmd.filterComplex
    expect(fc).toContain('[1:v:0]setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop=300,trim=end_frame=300')
    expect(fc).not.toContain('[1:a:0]')
    expect(fc).not.toContain('[0:v:0]')
    // El sonido sigue sin las pausas.
    expect(fc).toContain('[0:a:0]aresample=48000')
    expect(fc).toContain('asplit=2')
    expect(cmd.expectedDurationMs).toBe(10_000)
  })

  it('vídeo de encima en otra forma (fit-blur): fondo desenfocado del propio vídeo de encima', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = setCover(p, 'a', vertical)
    const fc = buildExportCommand(p, media, 'high', 'libx264', 'o.mp4').filterComplex
    expect(fc).toContain('split=2[c0bgsrc][c0fgsrc]')
    expect(fc).toContain('[c0bg][c0fg]overlay=x=656:y=0:shortest=1')
    const fill = buildExportCommand(setCoverFraming(p, 'a', { mode: 'fill' }), media, 'high', 'libx264', 'o.mp4').filterComplex
    expect(fill).not.toContain('[c0bgsrc]')
    expect(fill).toContain('scale=1920:3414')
  })

  it('vídeo de encima + yo en la esquina: recorte centrado, máscara redondeada y overlay en su sitio', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = setSpeed(p, 'a', 2)
    p = setCover(p, 'a', shortCover)
    p = setInset(p, 'a', { corner: 'bottom-right', size: 'small' })
    const fc = buildExportCommand(p, media, 'whatsapp', 'libx264', 'o.mp4').filterComplex
    expect(fc).toContain('[0:v:0]setpts=PTS-STARTPTS[v0seg]')
    expect(fc).toContain('[v0seg]setpts=(PTS-STARTPTS)/2,fps=30,tpad=stop_mode=clone:stop=30,trim=end_frame=150,scale=358:202:force_original_aspect_ratio=increase:')
    expect(fc).toContain('crop=358:202,setsar=1,format=yuva420p[v0inset]')
    expect(fc).toContain(`geq=lum='${roundedMaskExpression(16)}',loop=loop=-1:size=1,trim=end_frame=150`)
    expect(fc).toContain('[v0inset][v0mask]alphamerge[v0insetround]')
    expect(fc).toContain('[v0base][v0insetround]overlay=x=894:y=490:shortest=1')
    expect(fc).toContain('[1:v:0]setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop=150,trim=end_frame=150')
  })

  it('si el vídeo de encima empieza en su final, se lee un poco antes para tener qué repetir', () => {
    let p = addClip(createProject(), createClip(voice, 's'))
    p = setCover(p, 's', shortCover)
    p = splitClip(p, 's', 9000, 's2')
    expect(coverSeekMs(cover(p, 's2'))).toBe(2750)
  })
})

describe('«Solo el sonido»', () => {
  it('mismo camino de audio, sin vídeo, M4A AAC 192k 48 kHz con +faststart', () => {
    let p = addClip(createProject(), createClip(hd, 'a'))
    p = applyKeepSegments(p, 'a', [
      { startMs: 1000, endMs: 2000 },
      { startMs: 3000, endMs: 4500 },
    ])
    p = setSpeed(p, 'a', 2)
    p = addClip(p, createClip(voice, 's'))
    p = setCover(p, 's', vertical)
    const cmd = buildSoundExportCommand(p, media, 'C:\\out\\Sonido.m4a', { filterScriptPath: 'C:\\tmp\\f.txt' })
    const a = cmd.args
    expect(a.filter((x) => x === '-vn').length).toBe(3)
    expect(a).not.toContain(vertical.path)
    expect(opt(a, '-c:a')).toBe('aac')
    expect(opt(a, '-b:a')).toBe('192k')
    expect(opt(a, '-ar')).toBe('48000')
    expect(opt(a, '-ac')).toBe('2')
    expect(opt(a, '-movflags')).toBe('+faststart')
    expect(opt(a, '-map')).toBe('[aout]')
    expect(opt(a, '-/filter_complex')).toBe('C:\\tmp\\f.txt')
    expect(a).not.toContain('-c:v')
    const fc = cmd.filterComplex
    expect(fc).not.toMatch(/:v:0/)
    expect(fc).toContain('atrim=start=2:end=3.5,asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st=1.47:d=0.03')
    expect(fc).toContain('atempo=2')
    expect(fc).toContain('[a0][a1]concat=n=2:v=0:a=1[aout]')
    // 2500 / 2 = 1250 ms y 12 000 ms: muestras exactas, sin redondear a fotogramas.
    expect(soundSampleCount(findClip(p, 'a')!)).toBe(60_000)
    expect(cmd.expectedDurationMs).toBe(13_250)
  })

  it('peso aproximado', () => {
    expect(estimateSoundSizeBytes(60_000)).toBe(Math.round(24_000 * 60 * 1.01))
  })
})

describe('nombres y extensiones', () => {
  const d = new Date(2026, 10, 25)
  it('«Sonido del 25 de noviembre de 2026.m4a», sin sobrescribir', () => {
    expect(buildOutputFileName(d, 'sound')).toBe('Sonido del 25 de noviembre de 2026.m4a')
    expect(buildOutputFileName(d, 'sound', ['sonido del 25 de noviembre de 2026.M4A'])).toBe('Sonido del 25 de noviembre de 2026 2.m4a')
    expect(buildOutputFileName(d, 'whatsapp', ['Sonido del 25 de noviembre de 2026.m4a'])).toBe('Vídeo del 25 de noviembre de 2026 (para WhatsApp).mp4')
  })

  it('ficheros de sonido que se pueden añadir', () => {
    for (const ext of ['m4a', 'mp3', 'wav', 'aac', 'ogg', 'opus', 'flac', 'wma']) expect(isAudioPath(`C:\\a\\voz.${ext.toUpperCase()}`)).toBe(true)
    expect(isAudioPath('C:\\a\\b.mp4')).toBe(false)
    expect(isVideoPath('C:\\a\\b.m4a')).toBe(false)
    expect(isMediaPath('C:\\a\\b.m4a')).toBe(true)
    expect(isMediaPath('C:\\a\\b.txt')).toBe(false)
  })
})
