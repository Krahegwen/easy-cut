// Prueba de integración de las transiciones entre trozos con el ffmpeg/ffprobe reales (en el PATH).
// Trozos de color liso con tonos distintos; se MIDE en el fichero: duración y número de fotogramas exactos, el color a
// mitad del fundido (≈ la media), el centro del «a negro» (≈ negro) y del «a blanco» sin solape, empujar y deslizar con
// los dos colores a los lados, el zoom (el borde de un cuadrado de A más allá de su sitio), un sonido pegado al que
// entra (±40 ms), los dos tonos en el cruce y la voz que no baja fuera de él, «Solo el sonido» en muestras, pausas
// quitadas, un efecto «como luz» cruzando el paso y «el vídeo de este trozo» que se desvanece. Con libx264 y, si
// está, con NVENC. Todo en test-output/transitions/.

import { execFile, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  addClip,
  addTrack,
  applyKeepSegments,
  buildEncoderProbeArgs,
  buildExportCommand,
  buildProbeArgs,
  buildSoundExportCommand,
  clipFrameCount,
  createClip,
  createItem,
  createProject,
  createTrack,
  exportTiming,
  insertItem,
  makeEntry,
  parseProbeOutput,
  putClipVideo,
  resolveTracks,
  setCover,
  setTransition,
  type MediaInfo,
  type NewItem,
  type Project,
  type TrackItem,
  type TransitionKind,
  type VideoEncoder,
} from '../../src/domain'

const run = promisify(execFile)
const OUT = resolve(__dirname, '../../test-output/transitions')
const BIG = { maxBuffer: 256 * 1024 * 1024, windowsHide: true }
const ffmpeg = (args: string[]) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], BIG)
const W = 1280
const H = 720
const F = 30

// Colores en RGB (lo que se mide) de cada trozo y su tono.
const RED = [200, 50, 50]
const BLUE = [50, 50, 200]
const GREEN = [40, 190, 70]
const f = {
  red: join(OUT, 'src-rojo-330hz.mp4'),
  blue: join(OUT, 'src-azul-550hz.mp4'),
  green: join(OUT, 'src-verde-880hz.mp4'),
  /** Gris oscuro con un cuadrado blanco de 200 px en el centro: para medir el zoom. */
  square: join(OUT, 'src-cuadrado-330hz.mp4'),
  ding: join(OUT, 'pitido-2khz.wav'),
  light: join(OUT, 'fx-cuadrado-blanco-sobre-negro.mp4'),
}
const media = new Map<string, MediaInfo>()
let nvenc = false
const hex = (c: number[]) => `0x${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

async function probe(path: string): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', buildProbeArgs(path), BIG)
  return parseProbeOutput(stdout, path)
}

beforeAll(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-c:a', 'aac', '-b:a', '256k', '-shortest']
  const clipSrc = (color: number[], hz: number, out: string, vf = 'null') =>
    ffmpeg(['-f', 'lavfi', '-i', `color=c=${hex(color)}:size=${W}x${H}:rate=${F}:duration=4`, '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=4`, '-vf', `${vf},scale=out_color_matrix=bt709:out_range=tv`, ...enc, out])
  await clipSrc(RED, 330, f.red)
  await clipSrc(BLUE, 550, f.blue)
  await clipSrc(GREEN, 880, f.green)
  await clipSrc([40, 40, 40], 330, f.square, `drawbox=x=${W / 2 - 100}:y=${H / 2 - 100}:w=200:h=200:color=white:t=fill`)
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=2000:sample_rate=48000:duration=0.3', '-af', 'volume=2', f.ding])
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=black:size=${W}x${H}:rate=${F}:duration=4`, '-vf', `drawbox=x=${W / 2 - 100}:y=${H / 2 - 100}:w=200:h=200:color=white:t=fill`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f.light])
  for (const p of Object.values(f)) media.set(p, await probe(p))
  try {
    await run('ffmpeg', buildEncoderProbeArgs('h264_nvenc'), BIG)
    nvenc = true
  } catch {
    nvenc = false
  }
})

// ---------------------------------------------------------------------------- medir

async function decode(path: string, af: string): Promise<Float32Array> {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-af', `${af},aformat=sample_fmts=flt:channel_layouts=mono`, '-ar', '48000', '-f', 'f32le', '-'], { ...BIG, encoding: 'buffer' })
  const b = stdout as unknown as Buffer
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4))
}

function rms(s: Float32Array, fromMs: number, toMs: number): number {
  const a = Math.max(0, Math.round(fromMs * 48))
  const b = Math.min(s.length, Math.round(toMs * 48))
  let sum = 0
  for (let i = a; i < b; i++) sum += s[i]! * s[i]!
  return Math.sqrt(sum / Math.max(1, b - a))
}

/** Primer instante (ms) en que la envolvente pasa de `threshold`. */
function onsetMs(s: Float32Array, threshold: number, fromMs = 0): number {
  for (let i = Math.round(fromMs * 48); i < s.length; i++) if (Math.abs(s[i]!) > threshold) return i / 48
  return -1
}

/** Color medio (RGB) de un cuadrado en (x, y) del fotograma número `frame`. */
async function colorAtFrame(path: string, frame: number, x: number, y: number, size = 16): Promise<number[]> {
  const vf = `select=eq(n\\,${frame}),crop=${size}:${size}:${x - size / 2}:${y - size / 2},scale=1:1:flags=area,format=rgb24`
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-'], { ...BIG, encoding: 'buffer' })
  return [...(stdout as unknown as Buffer).subarray(0, 3)]
}

async function countFrames(path: string): Promise<{ frames: number; durationMs: number }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', path], BIG)
  const j = JSON.parse(stdout) as { streams: { nb_read_frames: string }[]; format: { duration: string } }
  return { frames: Number(j.streams[0]!.nb_read_frames), durationMs: Number(j.format.duration) * 1000 }
}

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

async function exportVideo(name: string, p: Project, encoder: VideoEncoder = 'libx264') {
  const out = join(OUT, `${name}.mp4`)
  const script = join(OUT, `${name}.filter.txt`)
  writeFileSync(script, buildExportCommand(p, media, 'youtube', encoder, out).filterComplex)
  const cmd = buildExportCommand(p, media, 'youtube', encoder, out, { filterScriptPath: script })
  const res = await exportRun(cmd.args)
  expect(res.code, res.stderr).toBe(0)
  return { out, ms: res.ms, expectedMs: cmd.expectedDurationMs }
}

function item(id: string, kind: 'sound' | 'effect', path: string, extra: Partial<NewItem> = {}): TrackItem {
  const m = media.get(path)!
  return createItem({ id, kind, source: { type: 'file', path }, name: id, sourceDurationMs: m.durationMs, still: m.isStill, hasAudio: m.hasAudio, ...extra })
}

function place(p: Project, it: TrackItem, kind: 'sound' | 'effect', at: number, trackId: string): Project {
  if (!p.tracks.some((t) => t.id === trackId)) p = addTrack(p, createTrack(kind, trackId, trackId))
  const r = insertItem(p, it, kind, at, { id: 'nueva' }, { trackId })
  if (!r.ok) throw new Error(`no cabe ${it.id}`)
  return r.project
}

/** Rojo → azul → verde (4 s cada uno), con la entrada de azul. */
function threeClips(kind: TransitionKind | null, ms = 1000, overlap?: boolean): Project {
  let p = createProject('16:9')
  for (const [path, id] of [[f.red, 'r'], [f.blue, 'b'], [f.green, 'g']] as const) p = addClip(p, createClip(media.get(path)!, id))
  return kind ? setTransition(p, 'b', makeEntry(kind, ms, overlap)) : p
}

const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol)
const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v * (1 - k) + b[i]! * k)
const report: Record<string, unknown>[] = []

describe.sequential('transiciones (ffmpeg real)', () => {
  it('fundido: fotogramas exactos, la media a mitad del paso, los dos tonos en el cruce y la voz que no baja fuera', async () => {
    for (const encoder of (nvenc ? ['libx264', 'h264_nvenc'] : ['libx264']) as VideoEncoder[]) {
      const p = threeClips('dissolve', 1000)
      const { out, ms, expectedMs } = await exportVideo(`fundido-${encoder}`, p, encoder)
      const frames = p.clips.reduce((s, c) => s + clipFrameCount(c, F), 0) - 30
      const m = await countFrames(out)
      expect(m.frames).toBe(frames)
      expect(Math.abs(m.durationMs - expectedMs)).toBeLessThanOrEqual(1000 / F)
      // El paso: fotogramas 90 a 119 (la cola de rojo con la cabeza de azul). xfade: el que entra a k/o.
      const rows: Record<string, unknown>[] = []
      for (const k of [0, 8, 15, 22, 29]) {
        const c = await colorAtFrame(out, 90 + k, W / 2, H / 2)
        const want = mix(RED, BLUE, k / 30)
        rows.push({ k, c: c.join(','), want: want.map(Math.round).join(',') })
        expect(near(c, want, 6), `fotograma ${k} del paso`).toBe(true)
      }
      expect(near(await colorAtFrame(out, 60, W / 2, H / 2), RED, 4)).toBe(true)
      expect(near(await colorAtFrame(out, 150, W / 2, H / 2), BLUE, 4)).toBe(true)
      // Sonido: en el cruce suenan los dos (a la mitad, cada uno a ~0,5); fuera, cada uno entero.
      const red = await decode(out, 'bandpass=f=330:width_type=h:width=60')
      const blue = await decode(out, 'bandpass=f=550:width_type=h:width=60')
      const srcRed = rms(await decode(f.red, 'bandpass=f=330:width_type=h:width=60'), 1000, 2500)
      const redBefore = rms(red, 1000, 2500) / srcRed
      const redMid = rms(red, 3480, 3520) / srcRed
      const blueMid = rms(blue, 3480, 3520) / rms(blue, 5000, 6000)
      rows.push({ redBefore, redMid, blueMid })
      console.table(rows)
      expect(Math.abs(redBefore - 1)).toBeLessThanOrEqual(0.03)
      expect(Math.abs(redMid - 0.5)).toBeLessThanOrEqual(0.06)
      expect(Math.abs(blueMid - 0.5)).toBeLessThanOrEqual(0.06)
      report.push({ caso: `fundido-${encoder}`, ms, frames: m.frames, expectedFrames: frames, durationMs: m.durationMs, expectedMs, rows })
    }
  })

  it('a negro montado: negro en el centro del paso; a blanco sin solape: blanco en la junta y la misma duración', async () => {
    const black = await exportVideo('a-negro-montado', threeClips('dip-black', 1000, true))
    expect((await countFrames(black.out)).frames).toBe(360 - 30)
    const centre = await colorAtFrame(black.out, 90 + 15, W / 2, H / 2)
    const quarter = await colorAtFrame(black.out, 90 + 7, W / 2, H / 2)
    const threeQ = await colorAtFrame(black.out, 90 + 23, W / 2, H / 2)
    expect(Math.max(...centre)).toBeLessThanOrEqual(6)
    // A un cuarto, rojo a mitad de camino; a tres cuartos, azul a mitad de camino (lineal, simétrico).
    expect(near(quarter, mix(RED, [0, 0, 0], 7 / 15), 8)).toBe(true)
    expect(near(threeQ, mix([0, 0, 0], BLUE, 8 / 15), 8)).toBe(true)
    const white = await exportVideo('a-blanco-sin-solape', threeClips('dip-white', 1000))
    expect((await countFrames(white.out)).frames).toBe(360)
    const atJoin = await colorAtFrame(white.out, 120, W / 2, H / 2)
    const before = await colorAtFrame(white.out, 119, W / 2, H / 2)
    expect(Math.min(...atJoin)).toBeGreaterThanOrEqual(245)
    expect(Math.min(...before)).toBeGreaterThanOrEqual(235)
    expect(near(await colorAtFrame(white.out, 120 - 8, W / 2, H / 2), mix(RED, [255, 255, 255], 7 / 15), 10)).toBe(true)
    report.push({ caso: 'a negro / a blanco', centre, quarter, threeQ, atJoin, before })
  })

  it('empujar y deslizar: a mitad del paso, el que sale a la izquierda y el que entra a la derecha', async () => {
    const rows: Record<string, unknown>[] = []
    for (const kind of ['push', 'cover'] as const) {
      const { out } = await exportVideo(`${kind}`, threeClips(kind, 1000))
      const left = await colorAtFrame(out, 105, W / 4, H / 2)
      const right = await colorAtFrame(out, 105, (3 * W) / 4, H / 2)
      rows.push({ kind, left: left.join(','), right: right.join(',') })
      expect(near(left, RED, 6)).toBe(true)
      expect(near(right, BLUE, 6)).toBe(true)
      // A un cuarto: el que entra ocupa solo el último cuarto.
      expect(near(await colorAtFrame(out, 90 + 7, W * 0.6, H / 2), RED, 6)).toBe(true)
      expect(near(await colorAtFrame(out, 90 + 8, W * 0.9, H / 2), BLUE, 6)).toBe(true)
    }
    console.table(rows)
    report.push({ caso: 'empujar y deslizar', rows })
  })

  it('zoom: el cuadrado del que sale crece hasta 1,3 × mientras se funde', async () => {
    let p = createProject('16:9')
    p = addClip(p, createClip(media.get(f.square)!, 's'))
    p = addClip(p, createClip(media.get(f.blue)!, 'b'))
    p = setTransition(p, 'b', makeEntry('zoom', 1000))
    const { out } = await exportVideo('zoom', p)
    // A mitad (k = 15, p = 0,5): escala 1,15 → el borde del cuadrado, de 100 a 115 px del centro; A pesa 0,5.
    const inside = await colorAtFrame(out, 105, W / 2 + 108, H / 2, 6)
    const outside = await colorAtFrame(out, 105, W / 2 + 124, H / 2, 6)
    const wantIn = mix([255, 255, 255], BLUE, 0.5)
    const wantOut = mix([40, 40, 40], BLUE, 0.5)
    expect(near(inside, wantIn, 12)).toBe(true)
    expect(near(outside, wantOut, 12)).toBe(true)
    // El ancho del cuadrado en cada fotograma del paso: 200 · (1 + 0,3 · k/30), centrado.
    const widths: Record<string, unknown>[] = []
    for (const k of [0, 5, 15, 25, 29]) {
      const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', out, '-vf', `select=eq(n\\,${90 + k}),crop=${W}:2:0:${H / 2 - 2},format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { ...BIG, encoding: 'buffer' })
      const row = [...(stdout as unknown as Buffer).subarray(0, W)]
      const lo = row[100]!
      const hi = row[W / 2]!
      const th = (lo + hi) / 2
      const xs = row.flatMap((v, x) => (v > th ? [x] : []))
      const width = xs[xs.length - 1]! - xs[0]! + 1
      const want = 200 * (1 + 0.3 * (k / 30))
      widths.push({ k, width, want, left: xs[0], wantLeft: W / 2 - want / 2 })
      expect(Math.abs(width - want), `ancho en el fotograma ${k}`).toBeLessThanOrEqual(3)
      expect(Math.abs(xs[0]! - (W / 2 - want / 2)), `centrado en el fotograma ${k}`).toBeLessThanOrEqual(2)
    }
    console.table(widths)
    report.push({ caso: 'zoom', inside, outside, wantIn, wantOut, widths })
  })

  it('un sonido pegado al que entra empieza donde dice el modelo (±40 ms)', async () => {
    let p = threeClips('dissolve', 1000)
    p = place(p, item('pi', 'sound', f.ding), 'sound', 4500, 'Sonidos')
    expect(p.tracks[0]!.items[0]!.anchor.clipId).toBe('b')
    const model = resolveTracks(p, exportTiming(p, F))[0]!.startMs
    const { out } = await exportVideo('sonido-pegado', p)
    const s = await decode(out, 'bandpass=f=2000:width_type=h:width=200')
    const at = onsetMs(s, 0.05, 3000)
    report.push({ caso: 'sonido pegado', model, measured: at })
    expect(Math.abs(at - model)).toBeLessThanOrEqual(40)
  })

  it('«Solo el sonido»: las muestras exactas del montaje', async () => {
    const p = threeClips('dissolve', 1000)
    const out = join(OUT, 'solo-el-sonido.m4a')
    const cmd = buildSoundExportCommand(p, media, out)
    const res = await exportRun(cmd.args)
    expect(res.code, res.stderr).toBe(0)
    const s = await decode(out, 'anull')
    const ms = (s.length * 1000) / 48000
    report.push({ caso: 'solo el sonido', samples: s.length, expectedSamples: 11 * 48000, ms, expectedMs: cmd.expectedDurationMs })
    expect(cmd.expectedDurationMs).toBe(11_000)
    // AAC añade como mucho un paquete (1024 muestras) al final.
    expect(Math.abs(s.length - 11 * 48000)).toBeLessThanOrEqual(1024)
    const blue = await decode(out, 'bandpass=f=550:width_type=h:width=60')
    expect(rms(blue, 3480, 3520) / rms(blue, 5000, 6000)).toBeGreaterThan(0.4)
  })

  it('con pausas quitadas en el que entra, el paso no pasa de su primer rango', async () => {
    let p = threeClips('dissolve', 2000)
    p = applyKeepSegments(p, 'b', [{ startMs: 0, endMs: 1500 }, { startMs: 2000, endMs: 4000 }])
    const timing = exportTiming(p, F)
    expect(timing.overlaps[1]).toBe(1500)
    const { out, expectedMs } = await exportVideo('pausas-quitadas', p)
    const m = await countFrames(out)
    expect(m.frames).toBe(120 + 105 + 120 - 45)
    expect(Math.abs(m.durationMs - expectedMs)).toBeLessThanOrEqual(1000 / F)
    // A mitad del paso (fotograma 75 + 22).
    expect(near(await colorAtFrame(out, 75 + 22, W / 2, H / 2), mix(RED, BLUE, 22 / 45), 6)).toBe(true)
    report.push({ caso: 'pausas quitadas', frames: m.frames })
  })

  it('un efecto «como luz» cruzando el paso se suma encima del fundido', async () => {
    let p = threeClips('dissolve', 1000)
    p = place(p, item('luz', 'effect', f.light, { defaults: { look: { mix: 'light' } } }), 'effect', 2500, 'Luz')
    const { out } = await exportVideo('luz-en-el-paso', p)
    const k = 15
    const under = mix(RED, BLUE, k / 30)
    const lit = await colorAtFrame(out, 90 + k, W / 2, H / 2)
    const side = await colorAtFrame(out, 90 + k, W / 4, H / 2)
    report.push({ caso: 'luz en el paso', lit, side, under })
    expect(Math.min(...lit)).toBeGreaterThanOrEqual(245)
    // Fuera de la luz, el fundido; el tramo pasa por RGB y vuelve (unos 3 niveles más que sin efecto).
    expect(near(side, under, 9)).toBe(true)
  })

  it('«el vídeo de este trozo» del que sale se desvanece durante el paso', async () => {
    let p = createProject('16:9')
    p = addClip(p, createClip(media.get(f.green)!, 'g'))
    p = addClip(p, createClip(media.get(f.red)!, 'r'))
    // El verde habla con el azul de fondo y su propio vídeo encima, a pantalla completa.
    p = setCover(p, 'g', media.get(f.blue)!)
    p = putClipVideo(p, 'g', { x: 0.5, y: 0.5, scale: 1 }, { itemId: 'yo', trackId: 'Tu vídeo' })
    p = setTransition(p, 'r', makeEntry('dissolve', 1000))
    const { out } = await exportVideo('tu-video-en-el-paso', p)
    const before = await colorAtFrame(out, 60, W / 2, H / 2)
    const mid = await colorAtFrame(out, 105, W / 2, H / 2)
    // Debajo, el fundido del azul (fondo de g) al rojo; encima, el verde con 1 − p.
    const want = mix(mix(BLUE, RED, 0.5), GREEN, 0.5)
    report.push({ caso: 'tu vídeo en el paso', before, mid, want })
    expect(near(before, GREEN, 6)).toBe(true)
    expect(near(mid, want, 10)).toBe(true)
  })

  it('deja el informe', () => {
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ nvenc, report }, null, 2))
  })
})
