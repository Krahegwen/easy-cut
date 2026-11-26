// Prueba de integración con el ffmpeg/ffprobe reales de la máquina (en el PATH).
// No corre en `pnpm test`; se lanza con `pnpm test:ffmpeg`. Genera todo en test-output/.

import { execFile, spawn } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  addClip,
  applyKeepSegments,
  buildEncoderProbeArgs,
  buildExportCommand,
  buildProbeArgs,
  buildSilenceDetectArgs,
  buildSoundExportCommand,
  clipInOut,
  clipStartTimes,
  computeKeepSegments,
  createClip,
  createProgressParser,
  createProject,
  HARDWARE_ENCODERS,
  parseProbeOutput,
  parseSilenceDetectOutput,
  projectDurationMs,
  rotateClip,
  setCover,
  setFraming,
  setInOut,
  legacyInsetBox,
  putClipVideo,
  updateEffectLook,
  setMuted,
  setPicture,
  setSpeed,
  splitClip,
  type MediaInfo,
  type PresetId,
  type Project,
  type VideoEncoder,
} from '../../src/domain'

const run = promisify(execFile)
const OUT = resolve(__dirname, '../../test-output')
const BIG = { maxBuffer: 64 * 1024 * 1024, windowsHide: true }

async function ffmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run('ffmpeg', args, BIG)
}

async function probe(path: string): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', buildProbeArgs(path), BIG)
  return parseProbeOutput(stdout, path)
}

interface RawStreams {
  streams: Array<Record<string, string | number | undefined>>
  format: { duration: string }
}

async function probeRaw(path: string): Promise<RawStreams> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], BIG)
  return JSON.parse(stdout) as RawStreams
}

/** Exporta con spawn, pasando stdout por el parser de progreso. */
function runExport(args: string[], totalMs: number): Promise<{ code: number; stderr: string; updates: number; ended: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true })
    const parser = createProgressParser(totalMs, Date.now())
    let updates = 0
    let ended = false
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const u of parser.push(chunk, Date.now())) {
        updates++
        if (u.done) ended = true
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stderr, updates, ended }))
  })
}

const lavfiVideo = (w: number, h: number, fps: number, d: number) => `testsrc2=size=${w}x${h}:rate=${fps}:duration=${d}`
const commonEnc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']

const files = {
  horizontal: join(OUT, 'src-horizontal-1080p30.mp4'),
  vertical: join(OUT, 'src-vertical-1080x1920-60.mp4'),
  noAudio: join(OUT, 'src-no-audio-720p30.mp4'),
  silence: join(OUT, 'src-silence-middle-720p30.mp4'),
  hdr: join(OUT, 'src-hdr-pq-1080p30.mp4'),
  rotatedTmp: join(OUT, 'src-rotated-tmp.mp4'),
  rotated: join(OUT, 'src-rotated-90.mp4'),
  // Solo sonido: voz simulada de 0 a 3 s, silencio de 3 a 6 s y voz otra vez de 6 a 10 s.
  voice: join(OUT, 'src-voice-silence.m4a'),
  // Vídeo de encima corto (2 s, barras de colores) y largo (12 s a 25 fps, testsrc con contador).
  coverShort: join(OUT, 'src-cover-short-2s.mp4'),
  coverLong: join(OUT, 'src-cover-long-25fps.mp4'),
}

const media = new Map<string, MediaInfo>()
const report: Record<string, unknown>[] = []
let nvencWorks = false
let detectedKeep: { startMs: number; endMs: number }[] | null = null
const encoderProbe: Record<string, boolean> = {}

beforeAll(async () => {
  // Todo menos tracks/ y trim/ (de tracks.itest.ts y trim.itest.ts, que pueden haber corrido antes).
  for (const entry of readdirSync(OUT)) if (entry !== 'tracks' && entry !== 'trim') rmSync(join(OUT, entry), { recursive: true, force: true })
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', lavfiVideo(1920, 1080, 30, 10), '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10', ...commonEnc, files.horizontal])
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', lavfiVideo(1080, 1920, 60, 8), '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100:duration=8', ...commonEnc, files.vertical])
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', lavfiVideo(1280, 720, 30, 6), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', files.noAudio])
  // Voz simulada de 0 a 4 s, silencio de 4 a 7 s y voz de nuevo de 7 a 12 s.
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', lavfiVideo(1280, 720, 30, 12), '-f', 'lavfi', '-i', "sine=frequency=500:sample_rate=48000:duration=12,volume=volume=0:enable='between(t\\,4\\,7)'", ...commonEnc, files.silence])
  // HDR PQ sintético: 10 bits con etiquetas BT.2020 / SMPTE 2084.
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', lavfiVideo(1920, 1080, 30, 4), '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-vf', 'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc:range=tv', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-c:a', 'aac', '-shortest', files.hdr])
  // Vídeo de «móvil»: codificado en horizontal con rotación de visualización de 90°.
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', lavfiVideo(1280, 720, 30, 5), '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000:duration=5', ...commonEnc, files.rotatedTmp])
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-display_rotation', '-90', '-i', files.rotatedTmp, '-c', 'copy', files.rotated])
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', "sine=frequency=520:sample_rate=48000:duration=10,volume=volume=0:enable='between(t\\,3\\,6)'", '-c:a', 'aac', '-b:a', '128k', files.voice])
  // El corto se mueve (fractal que se acerca): así se ve si de verdad se queda quieto al acabarse.
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'mandelbrot=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=1500:sample_rate=48000:duration=2', '-t', '2', ...commonEnc, files.coverShort])
  await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=1700:sample_rate=48000:duration=12', ...commonEnc, files.coverLong])

  for (const p of Object.values(files)) {
    if (p === files.rotatedTmp) continue
    media.set(p, await probe(p))
  }

  for (const enc of HARDWARE_ENCODERS) {
    try {
      await ffmpeg(buildEncoderProbeArgs(enc))
      encoderProbe[enc] = true
    } catch {
      encoderProbe[enc] = false
    }
  }
  try {
    await ffmpeg(buildEncoderProbeArgs('libx264'))
    encoderProbe.libx264 = true
  } catch {
    encoderProbe.libx264 = false
  }
  nvencWorks = encoderProbe.h264_nvenc === true
  console.log('Prueba de encoders:', encoderProbe)
})

describe.sequential('ffmpeg real', () => {
  it('ffprobe + parser: forma, fps, audio, HDR y rotación', () => {
    const h = media.get(files.horizontal)!
    expect([h.width, h.height, h.fps, h.hasAudio, h.isHdr]).toEqual([1920, 1080, 30, true, false])
    const v = media.get(files.vertical)!
    expect([v.width, v.height, v.fps, v.hasAudio]).toEqual([1080, 1920, 60, true])
    const n = media.get(files.noAudio)!
    expect(n.hasAudio).toBe(false)
    const hdr = media.get(files.hdr)!
    expect(hdr.isHdr).toBe(true)
    expect(hdr.colorTransfer).toBe('smpte2084')
    const r = media.get(files.rotated)!
    expect(r.rotation === 90 || r.rotation === 270).toBe(true)
    expect([r.width, r.height]).toEqual([720, 1280])
    console.log('Rotación leída del vídeo girado:', r.rotation)
    const voice = media.get(files.voice)!
    expect([voice.hasVideo, voice.hasAudio, voice.width, voice.height]).toEqual([false, true, 0, 0])
    expect(Math.abs(voice.durationMs - 10_000)).toBeLessThan(60)
    expect(media.get(files.coverLong)!.fps).toBe(25)
  })

  it('silencedetect + parser + computeKeepSegments', async () => {
    const m = media.get(files.silence)!
    const range = { startMs: 0, endMs: m.durationMs }
    let stderr = ''
    try {
      stderr = (await ffmpeg(buildSilenceDetectArgs(files.silence, { minSilenceMs: 500 }))).stderr
    } catch (e) {
      stderr = (e as { stderr: string }).stderr
    }
    const silences = parseSilenceDetectOutput(stderr, 0, m.durationMs)
    console.log('Silencios detectados:', silences)
    expect(silences.length).toBe(1)
    expect(Math.abs(silences[0]!.startMs - 4000)).toBeLessThan(80)
    expect(Math.abs(silences[0]!.endMs - 7000)).toBeLessThan(80)
    const keep = computeKeepSegments(silences, range, 'normal')
    console.log('Rangos conservados (normal):', keep)
    expect(keep.length).toBe(2)
    detectedKeep = keep

    // Con -ss en un rango parcial, los tiempos se desplazan.
    const partial = { startMs: 2000, endMs: 10_000 }
    let stderr2 = ''
    try {
      stderr2 = (await ffmpeg(buildSilenceDetectArgs(files.silence, { range: partial }))).stderr
    } catch (e) {
      stderr2 = (e as { stderr: string }).stderr
    }
    const s2 = parseSilenceDetectOutput(stderr2, partial.startMs, partial.endMs)
    expect(Math.abs(s2[0]!.startMs - 4000)).toBeLessThan(80)
    expect(Math.abs(s2[0]!.endMs - 7000)).toBeLessThan(80)
  })

  function buildFullProject(silenceKeep: { startMs: number; endMs: number }[]): Project {
    let p = createProject('16:9')
    const mk = (path: string, id: string) => createClip(media.get(path)!, id)
    // 1) Horizontal con varios rangos, que luego se parte en dos; la segunda parte a ×0.5.
    p = addClip(p, mk(files.horizontal, 'h'))
    p = applyKeepSegments(p, 'h', [
      { startMs: 0, endMs: 2000 },
      { startMs: 3000, endMs: 5000 },
      { startMs: 6000, endMs: 9000 },
    ])
    p = splitClip(p, 'h', 3000, 'h2')
    p = setSpeed(p, 'h2', 0.5)
    // 2) Vertical 60 fps dentro de horizontal (fit-blur), recortado y a ×2.
    p = addClip(p, mk(files.vertical, 'v'))
    p = setInOut(p, 'v', { inMs: 1000, outMs: 7000 })
    p = setSpeed(p, 'v', 2)
    // 3) Sin pista de audio, en modo fill con zoom y desplazamiento.
    p = addClip(p, mk(files.noAudio, 'n'))
    p = setFraming(p, 'n', { mode: 'fill', zoom: 1.3, offsetX: 0.5, offsetY: -0.5 })
    // 4) Con pausas quitadas.
    p = addClip(p, mk(files.silence, 's'))
    p = applyKeepSegments(p, 's', silenceKeep)
    // 5) Horizontal a ×4 (va en silencio).
    p = addClip(p, mk(files.horizontal, 'x4'))
    p = setSpeed(p, 'x4', 4)
    // 6) Vertical silenciado y girado 90° (pasa a horizontal), en fill.
    p = addClip(p, mk(files.vertical, 'vm'))
    p = setInOut(p, 'vm', { inMs: 0, outMs: 3000 })
    p = setMuted(p, 'vm', true)
    p = rotateClip(p, 'vm', 1)
    p = setFraming(p, 'vm', { mode: 'fill' })
    // 7) HDR con tone mapping, girado 180°.
    p = addClip(p, mk(files.hdr, 'hdr'))
    p = rotateClip(p, 'hdr', 1)
    p = rotateClip(p, 'hdr', 1)
    // 8) Vídeo de móvil con rotación de visualización (vertical) en fit-blur con zoom.
    p = addClip(p, mk(files.rotated, 'rot'))
    p = setFraming(p, 'rot', { zoom: 1.5, offsetY: 0.3 })
    return p
  }

  /** Los rangos que salieron de silencedetect real (si esa prueba no corrió, unos fijos). */
  function silenceKeep(): { startMs: number; endMs: number }[] {
    if (detectedKeep) return detectedKeep
    const m = media.get(files.silence)!
    return computeKeepSegments([{ startMs: 4000, endMs: 7000 }], { startMs: 0, endMs: m.durationMs }, 'normal')
  }

  async function exportAndCheck(name: string, project: Project, preset: PresetId, encoder: VideoEncoder) {
    const outPath = join(OUT, `${name}-${preset}-${encoder}.mp4`)
    const cmd = buildExportCommand(project, media, preset, encoder, outPath)
    writeFileSync(join(OUT, `${name}-${preset}-${encoder}.filter.txt`), cmd.filterComplex)
    const calculatedMs = projectDurationMs(project)
    const t0 = Date.now()
    const res = await runExport(cmd.args, cmd.expectedDurationMs)
    const wallMs = Date.now() - t0
    if (res.code !== 0) console.error(res.stderr)
    expect(res.code, res.stderr).toBe(0)
    expect(res.ended).toBe(true)

    const raw = await probeRaw(outPath)
    const v = raw.streams.find((s) => s.codec_type === 'video')!
    const a = raw.streams.find((s) => s.codec_type === 'audio')!
    const fmtMs = Number(raw.format.duration) * 1000
    const vMs = Number(v.duration) * 1000
    const aMs = Number(a.duration) * 1000
    const row = {
      export: `${name}/${preset}/${encoder}`,
      size: `${v.width}x${v.height}`,
      expectedSize: `${cmd.spec.width}x${cmd.spec.height}`,
      fps: v.avg_frame_rate,
      calculatedMs,
      expectedFramesMs: Math.round(cmd.expectedDurationMs),
      videoMs: Math.round(vMs),
      audioMs: Math.round(aMs),
      formatMs: Math.round(fmtMs),
      avDiffMs: Math.round(Math.abs(vMs - aMs)),
      wallMs,
      progressUpdates: res.updates,
    }
    report.push(row)
    console.log(row)

    expect(v.codec_name).toBe('h264')
    expect(v.pix_fmt).toBe('yuv420p')
    expect(v.color_space).toBe('bt709')
    expect(v.color_transfer).toBe('bt709')
    expect(v.color_primaries).toBe('bt709')
    expect(Number(v.width)).toBe(cmd.spec.width)
    expect(Number(v.height)).toBe(cmd.spec.height)
    expect(v.avg_frame_rate).toBe(`${cmd.spec.fps}/1`)
    expect(v.r_frame_rate).toBe(`${cmd.spec.fps}/1`)
    expect(a.codec_name).toBe('aac')
    expect(Number(a.sample_rate)).toBe(48_000)
    expect(Number(a.channels)).toBe(2)
    // Duración ≈ la calculada (medio fotograma de redondeo por trozo como mucho).
    const tolerance = (project.clips.length * 500) / cmd.spec.fps + 50
    expect(Math.abs(vMs - calculatedMs)).toBeLessThan(tolerance)
    expect(Math.abs(vMs - cmd.expectedDurationMs)).toBeLessThan(40)
    // Audio y vídeo duran lo mismo (un frame AAC de margen).
    expect(Math.abs(vMs - aMs)).toBeLessThan(45)
  }

  const presets: PresetId[] = ['whatsapp', 'youtube', 'high']

  for (const preset of presets) {
    it(`proyecto completo · ${preset} · libx264`, async () => {
      await exportAndCheck('full', buildFullProject(silenceKeep()), preset, 'libx264')
    })
    it(`proyecto completo · ${preset} · h264_nvenc (si hay)`, async (ctx) => {
      if (!nvencWorks) ctx.skip()
      await exportAndCheck('full', buildFullProject(silenceKeep()), preset, 'h264_nvenc')
    })
  }

  function verticalProject(): Project {
    // Mayoría de trozos a 60 fps en formato vertical → YouTube a 60 fps.
    let p = createProject('9:16')
    p = addClip(p, createClip(media.get(files.vertical)!, 'a'))
    p = addClip(p, createClip(media.get(files.vertical)!, 'b'))
    p = setInOut(p, 'b', { inMs: 2000, outMs: 5000 })
    p = addClip(p, createClip(media.get(files.horizontal)!, 'c'))
    p = setInOut(p, 'c', { inMs: 0, outMs: 3000 })
    return p
  }

  it('vertical 9:16 a 60 fps · youtube · libx264', async () => {
    await exportAndCheck('vertical', verticalProject(), 'youtube', 'libx264')
  })
  it('vertical 9:16 a 60 fps · youtube · h264_nvenc (si hay)', async (ctx) => {
    if (!nvencWorks) ctx.skip()
    await exportAndCheck('vertical', verticalProject(), 'youtube', 'h264_nvenc')
  })

  it('cuadrado 1:1 · whatsapp · libx264, filtro desde fichero (-/filter_complex)', async () => {
    let p = createProject('1:1')
    p = addClip(p, createClip(media.get(files.horizontal)!, 'a'))
    p = setInOut(p, 'a', { inMs: 0, outMs: 2500 })
    p = addClip(p, createClip(media.get(files.vertical)!, 'b'))
    p = setInOut(p, 'b', { inMs: 0, outMs: 2500 })
    const outPath = join(OUT, 'square-script-whatsapp-libx264.mp4')
    const scriptPath = join(OUT, 'square.filter.txt')
    const cmd = buildExportCommand(p, media, 'whatsapp', 'libx264', outPath, { filterScriptPath: scriptPath })
    writeFileSync(scriptPath, cmd.filterComplex)
    const res = await runExport(cmd.args, cmd.expectedDurationMs)
    expect(res.code, res.stderr).toBe(0)
    const raw = await probeRaw(outPath)
    const v = raw.streams.find((s) => s.codec_type === 'video')!
    expect(`${v.width}x${v.height}`).toBe('720x720')
    expect(Math.abs(Number(v.duration) * 1000 - 5000)).toBeLessThan(60)
  })

  // ---------------------------------------------------------------- imagen: sonido, sin imagen, vídeo encima, esquina

  const FRAMES = join(OUT, 'picture-frames')

  /** Rangos conservados del M4A de voz, con silencedetect real. */
  async function voiceKeep(): Promise<{ startMs: number; endMs: number }[]> {
    const m = media.get(files.voice)!
    let stderr = ''
    try {
      stderr = (await ffmpeg(buildSilenceDetectArgs(files.voice, { minSilenceMs: 500 }))).stderr
    } catch (e) {
      stderr = (e as { stderr: string }).stderr
    }
    const silences = parseSilenceDetectOutput(stderr, 0, m.durationMs)
    expect(silences.length).toBe(1)
    return computeKeepSegments(silences, { startMs: 0, endMs: m.durationMs }, 'normal')
  }

  async function buildPictureProject(): Promise<Project> {
    let p = createProject('16:9')
    // 1) Solo sonido (original M4A) con las pausas quitadas.
    p = addClip(p, createClip(media.get(files.voice)!, 'voice'))
    p = applyKeepSegments(p, 'voice', await voiceKeep())
    // 2) Vídeo con la imagen quitada, a ×2.
    p = addClip(p, createClip(media.get(files.horizontal)!, 'nopic'))
    p = setInOut(p, 'nopic', { inMs: 0, outMs: 6000 })
    p = setPicture(p, 'nopic', { kind: 'none' })
    p = setSpeed(p, 'nopic', 2)
    // 3) Vídeo de encima más corto que el trozo (se queda quieto), con las pausas del trozo quitadas.
    p = addClip(p, createClip(media.get(files.silence)!, 'cov'))
    p = applyKeepSegments(p, 'cov', silenceKeep())
    p = setCover(p, 'cov', media.get(files.coverShort)!)
    // 4) Vídeo de encima + yo en la esquina, partido: la segunda parte sigue el vídeo de encima y va en otra esquina.
    p = addClip(p, createClip(media.get(files.horizontal)!, 'ins'))
    p = setCover(p, 'ins', media.get(files.coverLong)!, 1000)
    // Desde la versión 5, su vídeo en la esquina va en una pista («el vídeo de este trozo»); al partir, cada parte
    // lleva el suyo.
    p = putClipVideo(p, 'ins', legacyInsetBox({ corner: 'bottom-right', size: 'small' }, '16:9'), { itemId: 'iv', trackId: 'esquina' })
    p = splitClip(p, 'ins', 4000, 'ins2')
    p = updateEffectLook(p, 'iv~ins2', (l) => ({ ...l, box: legacyInsetBox({ corner: 'top-left', size: 'medium' }, '16:9') }))
    return p
  }

  /** Un fotograma (o un recorte suyo) a PNG. `vf` se aplica antes de guardar. */
  async function frame(path: string, ms: number, out: string, vf?: string) {
    await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-ss', (ms / 1000).toFixed(3), '-i', path, '-frames:v', '1', ...(vf ? ['-vf', vf] : []), out])
    return out
  }

  /** Color medio (RGB) de un fotograma o de un recorte. */
  async function averageColor(path: string, ms: number, crop?: string): Promise<number[]> {
    const vf = `${crop ? `crop=${crop},` : ''}scale=1:1:flags=area,format=rgb24`
    const { stdout } = await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', (ms / 1000).toFixed(3), '-i', path, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-'], { ...BIG, encoding: 'buffer' })
    return [...(stdout as unknown as Buffer).subarray(0, 3)]
  }

  /** SSIM entre dos imágenes del mismo tamaño (1 = iguales). */
  async function ssim(a: string, b: string): Promise<number> {
    const { stderr } = await ffmpeg(['-hide_banner', '-i', a, '-i', b, '-lavfi', '[0:v][1:v]ssim', '-f', 'null', '-'])
    const m = /All:([\d.]+)/.exec(stderr)
    return m ? Number(m[1]) : 0
  }

  const plainRgb = [0x1c, 0x22, 0x29]
  const isPlain = (rgb: number[]) => rgb.every((v, i) => Math.abs(v - plainRgb[i]!) <= 10)

  for (const encoder of ['libx264', 'h264_nvenc'] as const) {
    it(`imagen: solo sonido, sin imagen, vídeo encima congelado y en la esquina · whatsapp · ${encoder}`, async (ctx) => {
      if (encoder === 'h264_nvenc' && !nvencWorks) ctx.skip()
      const p = await buildPictureProject()
      await exportAndCheck('picture', p, 'whatsapp', encoder)
      const out = join(OUT, `picture-whatsapp-${encoder}.mp4`)
      mkdirSync(FRAMES, { recursive: true })
      const starts = clipStartTimes(p)
      const at = (id: string) => starts[p.clips.findIndex((c) => c.id === id)]!
      const tag = encoder === 'libx264' ? 'x264' : 'nvenc'

      // 1) y 2): fondo liso.
      const voiceRgb = await averageColor(out, at('voice') + 800)
      const nopicRgb = await averageColor(out, at('nopic') + 1000)
      await frame(out, at('voice') + 800, join(FRAMES, `${tag}-1-solo-sonido.png`))
      await frame(out, at('nopic') + 1000, join(FRAMES, `${tag}-2-imagen-quitada.png`))
      console.log('Fondo liso:', { voiceRgb, nopicRgb })
      expect(isPlain(voiceRgb)).toBe(true)
      expect(isPlain(nopicRgb)).toBe(true)

      // 3): el vídeo de encima se mueve los 2 s que dura y luego se queda quieto en su última imagen.
      const c = at('cov')
      const moving1 = await frame(out, c + 200, join(FRAMES, `${tag}-3a-encima-0.2s.png`))
      const moving2 = await frame(out, c + 1500, join(FRAMES, `${tag}-3b-encima-1.5s.png`))
      const frozen1 = await frame(out, c + 2600, join(FRAMES, `${tag}-3c-quieto-2.6s.png`))
      const frozen2 = await frame(out, c + 6500, join(FRAMES, `${tag}-3d-quieto-6.5s.png`))
      const last = await frame(files.coverShort, 1960, join(FRAMES, `${tag}-3e-ultima-del-corto.png`))
      const moving = await ssim(moving1, moving2)
      const still = await ssim(frozen1, frozen2)
      const sameAsLast = await ssim(frozen1, last)
      console.log('Vídeo de encima corto (SSIM):', { moving, still, sameAsLast })
      expect(isPlain(await averageColor(out, c + 500))).toBe(false)
      // El fractal a 2,5 Mbit/s tiene ruido de compresión: quieto da ≈0,95-0,98 y en movimiento ≈0,71.
      expect(moving).toBeLessThan(0.85)
      expect(still).toBeGreaterThan(0.93)
      expect(still - moving).toBeGreaterThan(0.15)
      expect(sameAsLast).toBeGreaterThan(0.9)

      // 4): el otro vídeo desde el segundo 1 y yo abajo a la derecha (pequeño); tras partir, sigue por el 5 y voy arriba a la izquierda (mediano).
      const i1 = at('ins') + 1000
      await frame(out, i1, join(FRAMES, `${tag}-4a-esquina-abajo-derecha.png`))
      // Lejos de la esquina se ve el otro vídeo en su segundo 1 + 1 = 2.
      const outArea = await frame(out, i1, join(FRAMES, `${tag}-4b-zona-encima.png`), 'crop=600:300:0:0')
      const refArea = await frame(files.coverLong, 2000, join(FRAMES, `${tag}-4c-ref-encima-2s.png`), 'crop=600:300:0:0')
      // En la esquina (894,490 358×202) se ve el trozo en su segundo 1.
      const outInset = await frame(out, i1, join(FRAMES, `${tag}-4d-zona-esquina.png`), 'crop=300:160:923:511')
      const refInset = await frame(files.horizontal, 1000, join(FRAMES, `${tag}-4e-ref-esquina-1s.png`), 'scale=358:202,crop=300:160:29:21')
      const i2 = at('ins2') + 500
      await frame(out, i2, join(FRAMES, `${tag}-4f-partido-arriba-izquierda.png`))
      const outArea2 = await frame(out, i2, join(FRAMES, `${tag}-4g-zona-encima-partido.png`), 'crop=600:300:680:420')
      const refArea2 = await frame(files.coverLong, 5500, join(FRAMES, `${tag}-4h-ref-encima-5.5s.png`), 'crop=600:300:680:420')
      const outInset2 = await frame(out, i2, join(FRAMES, `${tag}-4i-zona-esquina-partido.png`), 'crop=440:240:64:52')
      const refInset2 = await frame(files.horizontal, 4500, join(FRAMES, `${tag}-4j-ref-esquina-4.5s.png`), 'scale=512:288,crop=440:240:36:24')
      const scores = {
        cover: await ssim(outArea, refArea),
        inset: await ssim(outInset, refInset),
        coverAfterSplit: await ssim(outArea2, refArea2),
        insetAfterSplit: await ssim(outInset2, refInset2),
      }
      console.log('Vídeo de encima + esquina (SSIM):', scores)
      expect(scores.cover).toBeGreaterThan(0.85)
      expect(scores.inset).toBeGreaterThan(0.7)
      expect(scores.coverAfterSplit).toBeGreaterThan(0.85)
      expect(scores.insetAfterSplit).toBeGreaterThan(0.7)
    })
  }

  it('«Solo el sonido»: M4A sin vídeo, AAC 48 kHz estéreo y la duración calculada', async () => {
    const p = await buildPictureProject()
    const outPath = join(OUT, 'picture-solo-el-sonido.m4a')
    const scriptPath = join(OUT, 'picture-solo-el-sonido.filter.txt')
    const cmd = buildSoundExportCommand(p, media, outPath, { filterScriptPath: scriptPath })
    writeFileSync(scriptPath, cmd.filterComplex)
    const t0 = Date.now()
    const res = await runExport(cmd.args, cmd.expectedDurationMs)
    const wallMs = Date.now() - t0
    expect(res.code, res.stderr).toBe(0)
    expect(res.ended).toBe(true)
    const raw = await probeRaw(outPath)
    const a = raw.streams.find((s) => s.codec_type === 'audio')!
    const hasVideo = raw.streams.some((s) => s.codec_type === 'video')
    const fmtMs = Number(raw.format.duration) * 1000
    const row = { export: 'solo-el-sonido', calculatedMs: projectDurationMs(p), expectedMs: cmd.expectedDurationMs, formatMs: Math.round(fmtMs), audioMs: Math.round(Number(a.duration) * 1000), wallMs }
    report.push(row)
    console.log(row)
    expect(hasVideo).toBe(false)
    expect(a.codec_name).toBe('aac')
    expect(Number(a.sample_rate)).toBe(48_000)
    expect(Number(a.channels)).toBe(2)
    expect(Math.abs(fmtMs - cmd.expectedDurationMs)).toBeLessThan(50)
    expect(Math.abs(fmtMs - projectDurationMs(p))).toBeLessThan(50)
  })

  it('resumen', () => {
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ encoderProbe, exports: report }, null, 2))
    console.table(report)
    expect(clipInOut(buildFullProject(silenceKeep()).clips[0]!).startMs).toBe(0)
  })
})
