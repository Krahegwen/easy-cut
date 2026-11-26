// Prueba de integración de las pistas de sonidos y efectos con el ffmpeg/ffprobe reales (en el PATH).
// Un montaje con pausas quitadas y trozos reordenados que lleva música repetida con entrada y salida suaves,
// dos sonidos pegados a trozos distintos, una pista silenciada, un efecto «como luz», uno con alfa en mezcla
// normal con tamaño y sitio, y una imagen. Se mide en el fichero: dónde empieza cada sonido (en la forma de
// onda), que la pista silenciada no suena, que la voz no pierde volumen por la mezcla, y el color de los
// fotogramas dentro y fuera de cada efecto. Todo en test-output/tracks/. Se lanza con `pnpm test:ffmpeg`.

import { execFile, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  addClip,
  addTrack,
  applyKeepSegments,
  buildExportCommand,
  buildProbeArgs,
  buildSilenceDetectArgs,
  buildSoundExportCommand,
  buildEncoderProbeArgs,
  clipFrameCount,
  computeKeepSegments,
  createClip,
  createItem,
  createTrack,
  createProject,
  exportedClipDurationMs,
  findItem,
  insertItem,
  moveClip,
  parseProbeOutput,
  parseSilenceDetectOutput,
  projectTiming,
  resolveTracks,
  setInOut,
  setItemFade,
  setMainMuted,
  setTrackMuted,
  soundSampleCount,
  type MediaInfo,
  type NewItem,
  type Project,
  type TrackItem,
  type VideoEncoder,
} from '../../src/domain'

const run = promisify(execFile)
const OUT = resolve(__dirname, '../../test-output/tracks')
const BIG = { maxBuffer: 256 * 1024 * 1024, windowsHide: true }

const ffmpeg = (args: string[]) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], BIG)

const f = {
  h: join(OUT, 'src-h-1080p30-440hz.mp4'),
  sil: join(OUT, 'src-pausas-720p30-500hz.mp4'),
  col: join(OUT, 'src-color-1080p30-330hz.mp4'),
  music: join(OUT, 'musica-220hz-2s.wav'),
  ding: join(OUT, 'ding-3khz.wav'),
  beep: join(OUT, 'pitido-5khz.wav'),
  light: join(OUT, 'fx-cuadrado-blanco-sobre-negro.mp4'),
  alpha: join(OUT, 'fx-rojo-mitad-transparente.webm'),
  png: join(OUT, 'fx-verde-con-borde-transparente.png'),
}
const media = new Map<string, MediaInfo>()
let nvenc = false

async function probe(path: string, still = false): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', buildProbeArgs(path), BIG)
  return parseProbeOutput(stdout, path, { still })
}

beforeAll(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10', ...enc, f.h])
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=12', '-f', 'lavfi', '-i', "sine=frequency=500:sample_rate=48000:duration=12,volume=volume=0:enable='between(t\\,4\\,7)'", ...enc, f.sil])
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x305070:size=1920x1080:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=8', ...enc, f.col])
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=2', '-af', 'volume=2', f.music])
  // Arranque seco (2 ms) para poder medir dónde empieza.
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=3000:sample_rate=48000:duration=0.3', '-af', 'volume=4,afade=t=in:d=0.002', f.ding])
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=5000:sample_rate=48000:duration=0.5', '-af', 'volume=4', f.beep])
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:size=1920x1080:rate=30:duration=3', '-vf', 'drawbox=x=760:y=340:w=400:h=400:color=white:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f.light])
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:size=640x360:rate=30:duration=3', '-vf', "format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,320),255,0)'", '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '1M', '-auto-alt-ref', '0', f.alpha])
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x00c000:size=200x200', '-vf', "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(abs(X-100),60)*lt(abs(Y-100),60),255,0)'", '-frames:v', '1', f.png])
  for (const p of [f.h, f.sil, f.col, f.music, f.ding, f.beep, f.light, f.alpha]) media.set(p, await probe(p))
  media.set(f.png, await probe(f.png, true))
  try {
    await run('ffmpeg', buildEncoderProbeArgs('h264_nvenc'), BIG)
    nvenc = true
  } catch {
    nvenc = false
  }
})

// ---------------------------------------------------------------------------- medir

/** Sonido decodificado a mono f32 (48 kHz), con un filtro opcional. */
async function decode(path: string, af: string): Promise<Float32Array> {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-af', `${af},aformat=sample_fmts=flt:channel_layouts=mono`, '-ar', '48000', '-f', 'f32le', '-'], { ...BIG, encoding: 'buffer' })
  const b = stdout as unknown as Buffer
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4))
}

function rmsDb(s: Float32Array, fromMs: number, toMs: number): number {
  const a = Math.max(0, Math.round(fromMs * 48))
  const b = Math.min(s.length, Math.round(toMs * 48))
  let sum = 0
  for (let i = a; i < b; i++) sum += s[i]! * s[i]!
  return 10 * Math.log10(sum / Math.max(1, b - a) + 1e-12)
}

/** Primer instante (ms) desde `fromMs` en el que una ventana de 2 ms pasa de `thresholdDb`. */
function onsetMs(s: Float32Array, fromMs: number, toMs: number, thresholdDb: number): number | null {
  for (let t = fromMs; t < toMs; t += 1) if (rmsDb(s, t, t + 2) > thresholdDb) return t
  return null
}

async function averageColor(path: string, ms: number, x: number, y: number, size = 8): Promise<number[]> {
  const vf = `crop=${size}:${size}:${x - size / 2}:${y - size / 2},scale=1:1:flags=area,format=rgb24`
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', (ms / 1000).toFixed(3), '-i', path, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-'], { ...BIG, encoding: 'buffer' })
  return [...(stdout as unknown as Buffer).subarray(0, 3)]
}

async function saveFrame(path: string, ms: number, out: string) {
  await ffmpeg(['-ss', (ms / 1000).toFixed(3), '-i', path, '-frames:v', '1', out])
}

const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol)

function exportRun(args: string[]): Promise<{ code: number; stderr: string; ms: number }> {
  const t0 = Date.now()
  return new Promise((ok, ko) => {
    const child = spawn('ffmpeg', args, { windowsHide: true })
    let stderr = ''
    child.stdout.resume()
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => (stderr += c))
    child.on('error', ko)
    child.on('close', (code) => ok({ code: code ?? -1, stderr, ms: Date.now() - t0 }))
  })
}

async function streams(path: string) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], BIG)
  return JSON.parse(stdout) as { streams: Record<string, string | number>[]; format: { duration: string } }
}

// ---------------------------------------------------------------------------- el montaje

function item(id: string, kind: 'sound' | 'effect', path: string, extra: Partial<NewItem> = {}): TrackItem {
  const m = media.get(path)!
  return createItem({ id, kind, source: { type: 'file', path }, name: id, sourceDurationMs: m.durationMs, still: m.isStill, hasAudio: m.hasAudio, ...extra })
}

function place(p: Project, it: TrackItem, kind: 'sound' | 'effect', at: number, trackId: string): Project {
  if (!p.tracks.some((t) => t.id === trackId)) p = addTrack(p, createTrack(kind, trackId, trackId))
  const r = insertItem(p, it, kind, at, { id: 'nueva' }, { trackId })
  if (!r.ok) throw new Error(`no cabe ${it.id}`)
  if (r.trackId !== trackId) throw new Error(`${it.id} ha ido a ${r.trackId} y no a ${trackId}`)
  return r.project
}

let silKeep: { startMs: number; endMs: number }[] = []

async function buildProject(): Promise<Project> {
  let p = createProject('16:9')
  p = addClip(p, createClip(media.get(f.sil)!, 'sil'))
  // Pausas quitadas de verdad (silencedetect).
  let stderr = ''
  try {
    stderr = (await ffmpeg(buildSilenceDetectArgs(f.sil, { minSilenceMs: 500 }))).stderr
  } catch (e) {
    stderr = (e as { stderr: string }).stderr
  }
  silKeep = computeKeepSegments(parseSilenceDetectOutput(stderr, 0, 12_000), { startMs: 0, endMs: 12_000 }, 'normal')
  p = applyKeepSegments(p, 'sil', silKeep)
  p = addClip(p, createClip(media.get(f.h)!, 'h'))
  p = setInOut(p, 'h', { outMs: 5000 })
  p = addClip(p, createClip(media.get(f.col)!, 'col'))
  // Orden de la fila tras reordenar: h, sil, col.
  const silMs = Math.round(silKeep.reduce((s, r) => s + r.endMs - r.startMs, 0))
  const at = { h: 0, sil: 5000, col: 5000 + silMs }
  // Los elementos se ponen con el orden original (sil, h, col) y después se reordena: lo pegado va con su trozo.
  const before = { sil: 0, h: silMs, col: silMs + 5000 }
  p = place(p, item('music', 'sound', f.music, { defaults: { repeat: true, durationMs: null, volume: 0.6 } }), 'sound', 0, 'Música')
  p = setItemFade(setItemFade(p, 'music', 'in', true), 'music', 'out', true)
  p = place(p, item('ding-sil', 'sound', f.ding), 'sound', before.sil + 6000, 'Sonidos')
  p = place(p, item('ding-col', 'sound', f.ding), 'sound', before.col + 1500, 'Sonidos')
  p = place(p, item('beep', 'sound', f.beep), 'sound', before.h + 2000, 'Silenciada')
  p = setTrackMuted(p, 'Silenciada', true)
  p = place(p, item('light', 'effect', f.light, { defaults: { look: { mix: 'light' } } }), 'effect', before.col + 3000, 'Luz')
  p = place(p, item('alpha', 'effect', f.alpha, { defaults: { look: { mix: 'normal', box: { x: 0.75, y: 0.25, scale: 0.4 } } } }), 'effect', before.col + 4000, 'Encima')
  p = place(p, item('png', 'effect', f.png, { defaults: { durationMs: 2000, look: { fit: 'contain', box: { x: 0.2, y: 0.75, scale: 0.3 } } } }), 'effect', before.h + 1000, 'Encima')
  p = moveClip(p, 'h', 0)
  expect(p.clips.map((c) => c.id)).toEqual(['h', 'sil', 'col'])
  void at
  return p
}

/** Dónde caen los trozos en el fichero (fotogramas enteros a 30 fps). */
function clipStarts(p: Project): Record<string, number> {
  let acc = 0
  const out: Record<string, number> = {}
  for (const c of p.clips) {
    out[c.id] = acc
    acc += exportedClipDurationMs(c, 30)
  }
  return out
}

const report: Record<string, unknown>[] = []

describe.sequential('pistas con ffmpeg real', () => {
  let project: Project
  let starts: Record<string, number>

  it('el modelo pone cada elemento donde le toca tras reordenar', async () => {
    project = await buildProject()
    starts = clipStarts(project)
    const timing = projectTiming(project, project.clips.map((c) => exportedClipDurationMs(c, 30)))
    const at = Object.fromEntries(resolveTracks(project, timing).map((r) => [r.item.id, r.startMs]))
    console.log('Trozos en el fichero:', starts, 'elementos:', at)
    expect(at['ding-sil']).toBeCloseTo(starts.sil! + 6000, 3)
    expect(at['ding-col']).toBeCloseTo(starts.col! + 1500, 3)
    expect(at.beep).toBeCloseTo(starts.h! + 2000, 3)
    expect(at.light).toBeCloseTo(starts.col! + 3000, 3)
    expect(at.png).toBeCloseTo(starts.h! + 1000, 3)
    expect(at.music).toBe(0)
    expect(findItem(project, 'music')!.item.anchor.clipId).toBeNull()
  })

  async function exportVideo(name: string, p: Project, encoder: VideoEncoder) {
    const out = join(OUT, `${name}-${encoder}.mp4`)
    const script = join(OUT, `${name}-${encoder}.filter.txt`)
    const draft = buildExportCommand(p, media, 'whatsapp', encoder, out)
    writeFileSync(script, draft.filterComplex)
    const cmd = buildExportCommand(p, media, 'whatsapp', encoder, out, { filterScriptPath: script })
    const res = await exportRun(cmd.args)
    expect(res.code, res.stderr).toBe(0)
    const raw = await streams(out)
    const v = raw.streams.find((s) => s.codec_type === 'video')!
    const a = raw.streams.find((s) => s.codec_type === 'audio')!
    const row = { export: `${name}/${encoder}`, size: `${v.width}x${v.height}`, videoMs: Math.round(Number(v.duration) * 1000), audioMs: Math.round(Number(a.duration) * 1000), expectedMs: Math.round(cmd.expectedDurationMs), wallMs: res.ms }
    report.push(row)
    console.log(row)
    expect(`${v.width}x${v.height}`).toBe('1280x720')
    expect(v.avg_frame_rate).toBe('30/1')
    expect(v.color_primaries).toBe('bt709')
    expect(v.color_transfer).toBe('bt709')
    expect(Math.abs(Number(v.duration) * 1000 - cmd.expectedDurationMs)).toBeLessThan(40)
    expect(Math.abs(Number(v.duration) - Number(a.duration)) * 1000).toBeLessThan(45)
    return out
  }

  let plainOut = ''
  it('sin pistas (referencia para el volumen de la voz)', async () => {
    plainOut = await exportVideo('referencia', { ...project, tracks: [] }, 'libx264')
  })

  for (const encoder of ['libx264', 'h264_nvenc'] as const) {
    it(`con pistas · whatsapp · ${encoder}: sonidos en su sitio, silenciada sin sonar, voz igual y efectos en su tramo`, async (ctx) => {
      if (encoder === 'h264_nvenc' && !nvenc) ctx.skip()
      const out = await exportVideo('pistas', project, encoder)
      // 1) Cada «ding» empieza donde dice el modelo (±40 ms).
      const high = await decode(out, 'highpass=f=2000,highpass=f=2000')
      const dingSil = onsetMs(high, starts.sil! + 6000 - 300, starts.sil! + 6000 + 300, -35)
      const dingCol = onsetMs(high, starts.col! + 1500 - 300, starts.col! + 1500 + 300, -35)
      console.log('Arranques medidos:', { dingSil, esperado: starts.sil! + 6000, dingCol, esperadoCol: starts.col! + 1500 })
      expect(dingSil).not.toBeNull()
      expect(Math.abs(dingSil! - (starts.sil! + 6000))).toBeLessThanOrEqual(40)
      expect(Math.abs(dingCol! - (starts.col! + 1500))).toBeLessThanOrEqual(40)
      // Fuera de los «ding», nada por encima de 2 kHz (la pista silenciada no suena).
      const beepBand = await decode(out, 'bandpass=f=5000:width_type=h:width=300,bandpass=f=5000:width_type=h:width=300')
      const beepDb = rmsDb(beepBand, starts.h! + 2050, starts.h! + 2450)
      console.log('Pista silenciada (5 kHz):', beepDb.toFixed(1), 'dB')
      expect(beepDb).toBeLessThan(-60)
      // 2) La voz no pierde volumen por la mezcla (440 Hz en h; 330 Hz en col), menos de 0,5 dB.
      const band = (hz: number) => `bandpass=f=${hz}:width_type=h:width=40,bandpass=f=${hz}:width_type=h:width=40`
      const voiceWith = rmsDb(await decode(out, band(440)), 2500, 4500)
      const voiceWithout = rmsDb(await decode(plainOut, band(440)), 2500, 4500)
      const colWith = rmsDb(await decode(out, band(330)), starts.col! + 2000, starts.col! + 7000)
      const colWithout = rmsDb(await decode(plainOut, band(330)), starts.col! + 2000, starts.col! + 7000)
      console.log('Voz con y sin pistas:', { voiceWith, voiceWithout, colWith, colWithout })
      expect(Math.abs(voiceWith - voiceWithout)).toBeLessThan(0.5)
      expect(Math.abs(colWith - colWithout)).toBeLessThan(0.5)
      // 3) La música suena todo el vídeo, entra y sale suave.
      const music = await decode(out, band(220))
      const total = Number((await streams(out)).format.duration) * 1000
      const musicStart = rmsDb(music, 0, 150)
      const musicMid = rmsDb(music, 3000, 4000)
      const musicLate = rmsDb(music, total - 3000, total - 2000)
      const musicEnd = rmsDb(music, total - 150, total)
      console.log('Música:', { musicStart, musicMid, musicLate, musicEnd })
      expect(musicMid).toBeGreaterThan(-40)
      expect(musicLate).toBeGreaterThan(-40)
      expect(musicMid - musicStart).toBeGreaterThan(10)
      expect(musicLate - musicEnd).toBeGreaterThan(10)

      // 4) Efectos: «como luz» (cuadrado blanco en el centro) solo en su tramo.
      const base = [0x30, 0x50, 0x70]
      const shots = join(OUT, `frames-${encoder}`)
      mkdirSync(shots, { recursive: true })
      const c = starts.col!
      const centerBefore = await averageColor(out, c + 2500, 640, 360)
      const centerIn = await averageColor(out, c + 3600, 640, 360)
      const centerAfter = await averageColor(out, c + 7500, 640, 360)
      // Con alfa, en mezcla normal: la mitad izquierda roja en (704..960, 36..324); la derecha, transparente.
      const redIn = await averageColor(out, c + 5000, 830, 180)
      const clearIn = await averageColor(out, c + 5000, 1090, 180)
      const redBefore = await averageColor(out, c + 3600, 830, 180)
      const redAfter = await averageColor(out, c + 7500, 830, 180)
      // La imagen: verde en su centro (256, 540) de h + 1 s a h + 3 s.
      const pngIn = await averageColor(out, starts.h! + 2000, 256, 540)
      const pngRef = await averageColor(plainOut, starts.h! + 2000, 256, 540)
      const pngAfter = await averageColor(out, starts.h! + 3500, 256, 540)
      const pngAfterRef = await averageColor(plainOut, starts.h! + 3500, 256, 540)
      for (const [label, ms] of [['antes-luz', c + 2500], ['luz', c + 3600], ['luz-y-alfa', c + 5000], ['despues', c + 7500], ['imagen', starts.h! + 2000]] as const) {
        await saveFrame(out, ms, join(shots, `${label}.png`))
      }
      const colors = { centerBefore, centerIn, centerAfter, redIn, clearIn, redBefore, redAfter, pngIn, pngRef, pngAfter, pngAfterRef }
      console.log('Colores medidos:', colors)
      expect(near(centerBefore, base, 12)).toBe(true)
      expect(centerIn.every((v) => v >= 235)).toBe(true)
      expect(near(centerAfter, base, 12)).toBe(true)
      expect(redIn[0]!).toBeGreaterThan(200)
      expect(redIn[1]!).toBeLessThan(60)
      expect(near(clearIn, base, 12)).toBe(true)
      expect(near(redBefore, base, 12)).toBe(true)
      expect(near(redAfter, base, 12)).toBe(true)
      expect(pngIn[1]!).toBeGreaterThan(150)
      expect(pngIn[0]!).toBeLessThan(60)
      expect(near(pngRef, pngIn, 30)).toBe(false)
      expect(near(pngAfter, pngAfterRef, 20)).toBe(true)
    })
  }

  it('fila principal silenciada: la voz no suena y los sonidos sí', async () => {
    const out = await exportVideo('voz-silenciada', setMainMuted(project, true), 'libx264')
    const voice = rmsDb(await decode(out, 'bandpass=f=440:width_type=h:width=40,bandpass=f=440:width_type=h:width=40'), 2500, 4500)
    const high = await decode(out, 'highpass=f=2000,highpass=f=2000')
    const ding = onsetMs(high, starts.col! + 1200, starts.col! + 1800, -35)
    console.log('Voz silenciada:', voice.toFixed(1), 'dB; ding en', ding)
    // Lo que queda es la música (220 Hz) que se cuela en el filtro de 440 Hz: la voz va a −21 dB sin silenciar.
    expect(voice).toBeLessThan(-60)
    expect(Math.abs(ding! - (starts.col! + 1500))).toBeLessThanOrEqual(40)
  })

  it('«Solo el sonido» con pistas: los sonidos en su sitio y la duración exacta', async () => {
    const out = join(OUT, 'solo-el-sonido.m4a')
    const script = join(OUT, 'solo-el-sonido.filter.txt')
    writeFileSync(script, buildSoundExportCommand(project, media, out).filterComplex)
    const cmd = buildSoundExportCommand(project, media, out, { filterScriptPath: script })
    const res = await exportRun(cmd.args)
    expect(res.code, res.stderr).toBe(0)
    const raw = await streams(out)
    expect(raw.streams.some((s) => s.codec_type === 'video')).toBe(false)
    expect(Math.abs(Number(raw.format.duration) * 1000 - cmd.expectedDurationMs)).toBeLessThan(50)
    // En «Solo el sonido» cada trozo dura sus muestras exactas (sin redondear a fotogramas).
    let acc = 0
    const soundStarts: Record<string, number> = {}
    for (const c of project.clips) {
      soundStarts[c.id] = acc
      acc += (soundSampleCount(c) * 1000) / 48_000
    }
    const high = await decode(out, 'highpass=f=2000,highpass=f=2000')
    const d1 = onsetMs(high, soundStarts.sil! + 5700, soundStarts.sil! + 6300, -35)
    const d2 = onsetMs(high, soundStarts.col! + 1200, soundStarts.col! + 1800, -35)
    console.log('«Solo el sonido»:', { d1, esperado1: soundStarts.sil! + 6000, d2, esperado2: soundStarts.col! + 1500, ms: res.ms })
    expect(Math.abs(d1! - (soundStarts.sil! + 6000))).toBeLessThanOrEqual(40)
    expect(Math.abs(d2! - (soundStarts.col! + 1500))).toBeLessThanOrEqual(40)
    report.push({ export: 'solo-el-sonido', expectedMs: Math.round(cmd.expectedDurationMs), formatMs: Math.round(Number(raw.format.duration) * 1000), wallMs: res.ms })
  })

  it('muchas pistas (ya sin límite): 10 de sonido, 6 de efectos y 2 vacías, cada «ding» en su sitio', async () => {
    let p: Project = { ...project, tracks: [] }
    // Un «ding» por pista, cada 700 ms desde el 500, y seis efectos «como luz» apilados a la vez.
    const dings: number[] = []
    for (let k = 0; k < 10; k++) {
      dings.push(500 + k * 700)
      p = place(p, item(`d${k}`, 'sound', f.ding), 'sound', dings[k]!, `Sonidos ${k + 1}`)
    }
    for (let k = 0; k < 6; k++) p = place(p, item(`l${k}`, 'effect', f.light, { defaults: { look: { mix: 'light', opacity: 0.4 } } }), 'effect', starts.col! + 3000, `Luz ${k + 1}`)
    p = addTrack(addTrack(p, createTrack('sound', 'vacia-1', 'Vacía')), createTrack('effect', 'vacia-2', 'Vacía 2'))
    expect(p.tracks).toHaveLength(18)
    const out = await exportVideo('muchas-pistas', p, 'libx264')
    const high = await decode(out, 'highpass=f=2000,highpass=f=2000')
    const measured = dings.map((at) => onsetMs(high, at - 200, at + 250, -35))
    console.log('Muchas pistas, arranques:', measured, 'esperados:', dings)
    measured.forEach((m, k) => {
      expect(m).not.toBeNull()
      expect(Math.abs(m! - dings[k]!)).toBeLessThanOrEqual(40)
    })
    // Seis «como luz» al 40 % apilados: el centro, casi blanco; antes, el color del trozo.
    const c = starts.col!
    const centerIn = await averageColor(out, c + 3600, 640, 360)
    const centerBefore = await averageColor(out, c + 2500, 640, 360)
    console.log('Muchas pistas, colores:', { centerIn, centerBefore })
    expect(centerIn.every((v) => v >= 200)).toBe(true)
    expect(near(centerBefore, [0x30, 0x50, 0x70], 12)).toBe(true)
  })

  it('resumen', () => {
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ silKeep, frames: project.clips.map((c) => clipFrameCount(c, 30)), exports: report }, null, 2))
    console.table(report)
  })
})
