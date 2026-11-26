// Prueba de integración del collage con el ffmpeg/ffprobe reales (en el PATH).
// Vídeos de color liso a 1080p; se MIDE en el fichero: el color en el centro de cada hueco en tres instantes, las
// bandas de fondo de un vídeo «Entero», la separación oscura y la blanca, el vídeo corto que se queda en su última
// imagen (azul el primer segundo y amarillo el segundo: después, amarillo), el vídeo de debajo intacto fuera del
// collage, los tonos de dos huecos que suenan a la vez (dentro sí, fuera no), uno silenciado que no suena y la voz que no baja, «Solo el sonido» con ese tono, los
// fotogramas totales exactos, un collage reducido que viaja con marcas (su sitio en dos instantes) y lo que tarda en
// guardarse un collage de 4 huecos 1080p frente al mismo vídeo sin él. Con libx264 y, si está, con NVENC. Todo en
// test-output/collage/.

import { execFile, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  addClip,
  addMark,
  buildEncoderProbeArgs,
  buildExportCommand,
  buildProbeArgs,
  buildSoundExportCommand,
  cellSourceFromInfo,
  createClip,
  createCollage,
  createCollageItem,
  createProject,
  insertItem,
  parseProbeOutput,
  setBoxAt,
  setCell,
  setCellFit,
  setCollageGap,
  setEffectLook,
  setCellMuted,
  updateEffectLook,
  type Collage,
  type MediaInfo,
  type Project,
  type VideoEncoder,
} from '../../src/domain'

const run = promisify(execFile)
const OUT = resolve(__dirname, '../../test-output/collage')
const BIG = { maxBuffer: 512 * 1024 * 1024, windowsHide: true }
const ffmpeg = (args: string[]) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], BIG)
const W = 1920
const H = 1080
const F = 30

const GREY = [120, 120, 120]
const RED = [200, 50, 50]
const GREEN = [40, 190, 70]
const BLUE = [50, 50, 200]
const YELLOW = [220, 200, 60]
/** El fondo liso (bandas, huecos vacíos y la raya oscura). */
const BG = [0x1c, 0x22, 0x29]
const WHITE = [255, 255, 255]

const f = {
  base: join(OUT, 'src-gris-440hz-12s.mp4'),
  red: join(OUT, 'src-rojo-1khz-8s.mp4'),
  green: join(OUT, 'src-verde-1700hz-8s.mp4'),
  /** Vertical, 2 s: azul el primero y amarillo el segundo (sin sonido). */
  tall: join(OUT, 'src-alto-azul-amarillo-2s.mp4'),
  q: [1, 2, 3, 4].map((n) => join(OUT, `src-prueba-${n}-10s.mp4`)),
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
  const v = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709']
  const a = ['-c:a', 'aac', '-b:a', '256k', '-shortest']
  const color = (c: number[], w: number, h: number, d: number) => `color=c=${hex(c)}:size=${w}x${h}:rate=${F}:duration=${d}`
  const vf = 'scale=out_color_matrix=bt709:out_range=tv'
  await ffmpeg(['-f', 'lavfi', '-i', color(GREY, W, H, 12), '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12', '-vf', vf, ...v, ...a, f.base])
  await ffmpeg(['-f', 'lavfi', '-i', color(RED, W, H, 8), '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=8', '-vf', vf, ...v, ...a, f.red])
  await ffmpeg(['-f', 'lavfi', '-i', color(GREEN, W, H, 8), '-f', 'lavfi', '-i', 'sine=frequency=1700:sample_rate=48000:duration=8', '-vf', vf, ...v, ...a, f.green])
  await ffmpeg(['-f', 'lavfi', '-i', color(BLUE, 1080, 1920, 2), '-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=${hex(YELLOW)}:t=fill:enable='gte(t\\,1)',${vf}`, ...v, f.tall])
  for (const q of f.q) await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${F}:duration=10`, '-vf', vf, ...v, q])
  for (const p of [f.base, f.red, f.green, f.tall, ...f.q]) media.set(p, await probe(p))
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

/** Primer instante (ms) en que la señal pasa de `threshold`. */
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

const cell = (path: string) => cellSourceFromInfo(media.get(path)!)!

/** Un trozo gris de 12 s y un collage desde los `atMs` (lo que dure el collage). */
function withCollage(collage: Collage, atMs = 2000): Project {
  const p = addClip(createProject('16:9'), createClip(media.get(f.base)!, 'base'))
  const r = insertItem(p, createCollageItem('col', collage, 12_000 - atMs), 'effect', atMs, { id: 'fx' })
  if (!r.ok) throw new Error('no cabe')
  return r.project
}

/**
 * «Uno grande a la izquierda y dos a la derecha»: en el grande, el rojo entero (con bandas arriba y abajo, y su tono
 * de 1 kHz); arriba a la derecha, el vertical corto (sin sonido) llenando su hueco; abajo, el verde (1,7 kHz). Suenan
 * los dos que tienen sonido.
 */
function bigLeft(): Collage {
  let c = createCollage('big-left')
  c = setCellFit(setCell(c, 0, cell(f.red)), 0, 'whole')
  c = setCell(c, 1, cell(f.tall))
  return setCell(c, 2, cell(f.green))
}

/** Dos pasos de banda: el otro tono (440 frente a 1000 Hz) se queda por debajo del 1 %. */
const TONE_BAND = 'bandpass=f=1000:width_type=h:width=80,bandpass=f=1000:width_type=h:width=80'
const VOICE_BAND = 'bandpass=f=440:width_type=h:width=60,bandpass=f=440:width_type=h:width=60'
const GREEN_BAND = 'bandpass=f=1700:width_type=h:width=100,bandpass=f=1700:width_type=h:width=100'
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol)
const report: Record<string, unknown>[] = []
// Centros de los huecos a 1920×1080 con la raya de 8 px: el grande (0, 0, 956, 1080) y los de la derecha (964, 0 y
// 964, 544; 956 × 536).
const C0 = [478, 540] as const
const C1 = [1442, 268] as const
const C2 = [1442, 812] as const

describe.sequential('collage (ffmpeg real)', () => {
  it('cada hueco su color en tres instantes, bandas, raya, el corto quieto, fuera intacto y fotogramas exactos', async () => {
    for (const encoder of (nvenc ? ['libx264', 'h264_nvenc'] : ['libx264']) as VideoEncoder[]) {
      const p = withCollage(bigLeft())
      const { out, ms, expectedMs } = await exportVideo(`grande-izquierda-${encoder}`, p, encoder)
      const m = await countFrames(out)
      expect(m.frames).toBe(360)
      expect(Math.abs(m.durationMs - expectedMs)).toBeLessThanOrEqual(1000 / F)
      // El collage va de 2 a 10 s (fotogramas 60 a 299). Instantes: 0,5 s, 3 s y 7 s del collage.
      const rows: Record<string, unknown>[] = []
      for (const [k, tallWant] of [[75, BLUE], [150, YELLOW], [270, YELLOW]] as const) {
        const c0 = await colorAtFrame(out, k, C0[0], C0[1])
        const c1 = await colorAtFrame(out, k, C1[0], C1[1])
        const c2 = await colorAtFrame(out, k, C2[0], C2[1])
        const band = await colorAtFrame(out, k, C0[0], 100)
        const gap = await colorAtFrame(out, k, 960, 540, 4)
        rows.push({ k, c0, c1, c2, band, gap })
        expect(near(c0, RED, 6), `rojo en ${k}`).toBe(true)
        expect(near(c1, tallWant, 6), `alto en ${k}: ${c1}`).toBe(true)
        expect(near(c2, GREEN, 6), `verde en ${k}`).toBe(true)
        expect(near(band, BG, 6), `banda en ${k}: ${band}`).toBe(true)
        expect(near(gap, BG, 8), `raya en ${k}: ${gap}`).toBe(true)
      }
      // Fuera del collage, el gris de debajo, sin tocar.
      for (const k of [30, 59, 300, 340]) expect(near(await colorAtFrame(out, k, 960, 540), GREY, 4), `gris en ${k}`).toBe(true)
      // El sonido: los tonos del rojo y del verde a la vez, solo durante el collage; la voz (440 Hz) igual dentro que fuera.
      const tone = await decode(out, TONE_BAND)
      const voice = await decode(out, VOICE_BAND)
      const srcTone = rms(await decode(f.red, TONE_BAND), 1000, 6000)
      const toneIn = rms(tone, 3000, 9000) / srcTone
      const toneOut = rms(tone, 200, 1800) / srcTone + rms(tone, 10_300, 11_800) / srcTone
      const voiceRatio = rms(voice, 3000, 9000) / rms(voice, 200, 1800)
      const green = await decode(out, GREEN_BAND)
      const srcGreen = rms(await decode(f.green, GREEN_BAND), 1000, 6000)
      const greenIn = rms(green, 3000, 9000) / srcGreen
      const greenOut = rms(green, 200, 1800) / srcGreen
      expect(greenIn).toBeGreaterThan(0.85)
      expect(greenIn).toBeLessThan(1.15)
      expect(greenOut).toBeLessThan(0.05)
      // Dónde empieza el tono: donde empieza el collage (±40 ms; el filtro de banda tarda un poco en subir).
      const onset = onsetMs(tone, srcTone * 0.5 * Math.SQRT2)
      report.push({ caso: 'grande a la izquierda', encoder, ms, frames: m.frames, rows, toneIn, toneOut, greenIn, greenOut, voiceRatio, onset })
      expect(Math.abs(onset - 2000)).toBeLessThanOrEqual(40)
      expect(toneIn).toBeGreaterThan(0.85)
      expect(toneIn).toBeLessThan(1.15)
      expect(toneOut).toBeLessThan(0.05)
      expect(Math.abs(voiceRatio - 1)).toBeLessThan(0.05)
    }
  })

  it('un hueco silenciado no suena; los demás, sí', async () => {
    const p = withCollage(setCellMuted(bigLeft(), 0, true))
    const { out } = await exportVideo('rojo-silenciado', p)
    const srcTone = rms(await decode(f.red, TONE_BAND), 1000, 6000)
    const srcGreen = rms(await decode(f.green, GREEN_BAND), 1000, 6000)
    const toneIn = rms(await decode(out, TONE_BAND), 3000, 9000) / srcTone
    const greenIn = rms(await decode(out, GREEN_BAND), 3000, 9000) / srcGreen
    report.push({ caso: 'silenciado', toneIn, greenIn })
    expect(toneIn).toBeLessThan(0.05)
    expect(greenIn).toBeGreaterThan(0.85)
  })

  it('raya blanca y sin separación', async () => {
    const white = withCollage(setCollageGap(bigLeft(), 'white'))
    const { out } = await exportVideo('raya-blanca', white)
    const gap = await colorAtFrame(out, 150, 960, 540, 4)
    const gapH = await colorAtFrame(out, 150, 1442, 540, 4)
    const none = withCollage(setCollageGap(bigLeft(), 'none'))
    const n = await exportVideo('sin-raya', none)
    // Sin separación, el rojo «Entero» llega hasta x = 960 (bandas aparte) y el verde empieza justo ahí.
    const edgeL = await colorAtFrame(n.out, 150, 954, 540, 4)
    const edgeR = await colorAtFrame(n.out, 150, 966, 812, 4)
    report.push({ caso: 'rayas', gap, gapH, edgeL, edgeR })
    expect(near(gap, WHITE, 8)).toBe(true)
    expect(near(gapH, WHITE, 8)).toBe(true)
    expect(near(edgeL, RED, 8)).toBe(true)
    expect(near(edgeR, GREEN, 8)).toBe(true)
  })

  it('«Solo el sonido» lleva el tono de los huecos que suenan', async () => {
    const p = withCollage(bigLeft())
    const out = join(OUT, 'solo-el-sonido.m4a')
    const cmd = buildSoundExportCommand(p, media, out)
    const res = await exportRun(cmd.args)
    expect(res.code, res.stderr).toBe(0)
    const tone = await decode(out, TONE_BAND)
    const srcTone = rms(await decode(f.red, TONE_BAND), 1000, 6000)
    const toneIn = rms(tone, 3000, 9000) / srcTone
    const toneOut = rms(tone, 200, 1800) / srcTone
    const greenIn = rms(await decode(out, GREEN_BAND), 3000, 9000) / rms(await decode(f.green, GREEN_BAND), 1000, 6000)
    report.push({ caso: 'solo el sonido', toneIn, toneOut, greenIn, ms: res.ms })
    expect(greenIn).toBeGreaterThan(0.85)
    expect(toneIn).toBeGreaterThan(0.85)
    expect(toneOut).toBeLessThan(0.05)
  })

  it('reducido y viajando con marcas: su sitio al principio y al final del viaje', async () => {
    let c = createCollage('quadrants')
    c = setCell(c, 0, cell(f.red))
    c = setCell(c, 1, cell(f.green))
    c = setCell(c, 2, cell(f.tall))
    c = setCell(c, 3, cell(f.red))
    let p = withCollage(c, 1000)
    p = setEffectLook(p, 'col', { box: { x: 0.25, y: 0.5, scale: 0.5 } })
    p = updateEffectLook(p, 'col', (l) => setBoxAt(addMark(l, 0), 4000, { x: 0.75, y: 0.5, scale: 0.5 }))
    const { out } = await exportVideo('viaje', p)
    // A tamaño 0,5 mide 960 × 540; el hueco 1 (arriba a la derecha) está a 3/4 de su ancho y 1/4 de su alto.
    const at = async (frame: number, cx: number) => colorAtFrame(out, frame, Math.round(cx - 480 + 0.75 * 960), Math.round(540 - 270 + 0.25 * 540))
    const start = await at(30, 0.25 * W)
    const end = await at(150, 0.75 * W)
    // A la mitad del viaje (curva «Suave»), en el centro del marco.
    const mid = await at(90, 0.5 * W)
    // Donde estaba al principio, a los 4 s ya está el gris.
    const left = await colorAtFrame(out, 150, Math.round(0.25 * W + 240), 405)
    report.push({ caso: 'viaje', start, mid, end, left })
    expect(near(start, GREEN, 8)).toBe(true)
    expect(near(mid, GREEN, 8)).toBe(true)
    expect(near(end, GREEN, 8)).toBe(true)
    expect(near(left, GREY, 8)).toBe(true)
  })

  it('lo que tarda: 4 huecos 1080p frente al mismo vídeo sin collage', async () => {
    const encoders = (nvenc ? ['libx264', 'h264_nvenc'] : ['libx264']) as VideoEncoder[]
    for (const encoder of encoders) {
      const plain = addClip(createProject('16:9'), createClip(media.get(f.base)!, 'base'))
      const a = await exportVideo(`sin-collage-${encoder}`, plain, encoder)
      let c = createCollage('quadrants')
      f.q.forEach((q, i) => (c = setCell(c, i, cell(q))))
      const p = withCollage(c, 1000)
      const b = await exportVideo(`cuatro-huecos-${encoder}`, p, encoder)
      const m = await countFrames(b.out)
      report.push({ caso: 'tiempo', encoder, sinCollageMs: a.ms, cuatroHuecosMs: b.ms, vecesTiempoReal: 12_000 / b.ms })
      expect(m.frames).toBe(360)
      // Aviso (no falla): más de 4 veces lo que tarda sin collage.
      if (b.ms > a.ms * 4) console.warn(`[collage] ${encoder}: ${b.ms} ms con 4 huecos frente a ${a.ms} ms sin collage`)
    }
  })

  it('deja el informe', () => {
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ nvenc, report }, null, 2))
  })
})

