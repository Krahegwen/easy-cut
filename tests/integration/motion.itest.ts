// Prueba de integración de «aparecer, desaparecer y movimiento» con el ffmpeg/ffprobe reales (en el PATH).
// Mide en el fichero guardado, en varios instantes de cada curva, lo mismo que calcula la vista previa
// (fadeGainAt / boxAt del dominio): el nivel del sonido de un trozo y de un sonido de una pista, el color de un
// trozo que aparece desde negro, de un efecto normal y de uno «como luz». Todo en test-output/motion/.

import { execFile, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  addClip,
  addTrack,
  buildExportCommand,
  buildProbeArgs,
  createClip,
  createItem,
  createProject,
  createTrack,
  exportedClipDurationMs,
  fadeGainAt,
  insertItem,
  parseProbeOutput,
  setClipFade,
  setItemFade,
  setMuted,
  type MediaInfo,
  type NewItem,
  type Project,
  type TrackItem,
} from '../../src/domain'

const run = promisify(execFile)
const OUT = resolve(__dirname, '../../test-output/motion')
const BIG = { maxBuffer: 256 * 1024 * 1024, windowsHide: true }
const ffmpeg = (args: string[]) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], BIG)

const f = {
  /** Gris claro con un tono de 330 Hz: el trozo que aparece y desaparece. */
  grey: join(OUT, 'src-gris-1080p30-330hz.mp4'),
  /** Gris medio sin sonido: el fondo de los efectos y del sonido de la pista. */
  base: join(OUT, 'src-gris-medio-1080p30.mp4'),
  tone: join(OUT, 'tono-1khz-4s.wav'),
  red: join(OUT, 'fx-rojo-200.png'),
  light: join(OUT, 'fx-cuadrado-blanco-sobre-negro.mp4'),
}
const media = new Map<string, MediaInfo>()

async function probe(path: string, still = false): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', buildProbeArgs(path), BIG)
  return parseProbeOutput(stdout, path, { still })
}

beforeAll(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest']
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xc8c8c8:size=1920x1080:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=8', ...enc, f.grey])
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x606060:size=1920x1080:rate=30:duration=10', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', ...enc.slice(0, -1), '-t', '10', f.base])
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=4', '-af', 'volume=2', f.tone])
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:size=200x200', '-frames:v', '1', f.red])
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:size=1920x1080:rate=30:duration=4', '-vf', 'drawbox=x=760:y=340:w=400:h=400:color=white:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f.light])
  for (const p of [f.grey, f.base, f.tone, f.light]) media.set(p, await probe(p))
  media.set(f.red, await probe(f.red, true))
})

// ---------------------------------------------------------------------------- medir

async function decode(path: string, af: string): Promise<Float32Array> {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-af', `${af},aformat=sample_fmts=flt:channel_layouts=mono`, '-ar', '48000', '-f', 'f32le', '-'], { ...BIG, encoding: 'buffer' })
  const b = stdout as unknown as Buffer
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4))
}

/** Amplitud RMS lineal en [fromMs, toMs). */
function rms(s: Float32Array, fromMs: number, toMs: number): number {
  const a = Math.max(0, Math.round(fromMs * 48))
  const b = Math.min(s.length, Math.round(toMs * 48))
  let sum = 0
  for (let i = a; i < b; i++) sum += s[i]! * s[i]!
  return Math.sqrt(sum / Math.max(1, b - a))
}

/** Color medio (RGB) de un cuadrado de `size` en (x, y) del fotograma más cercano a `ms`. */
async function averageColor(path: string, ms: number, x: number, y: number, size = 16): Promise<number[]> {
  const vf = `crop=${size}:${size}:${x - size / 2}:${y - size / 2},scale=1:1:flags=area,format=rgb24`
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', (ms / 1000).toFixed(3), '-i', path, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-'], { ...BIG, encoding: 'buffer' })
  return [...(stdout as unknown as Buffer).subarray(0, 3)]
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

async function exportVideo(name: string, p: Project): Promise<{ out: string; ms: number }> {
  const out = join(OUT, `${name}.mp4`)
  const script = join(OUT, `${name}.filter.txt`)
  writeFileSync(script, buildExportCommand(p, media, 'youtube', 'libx264', out).filterComplex)
  const cmd = buildExportCommand(p, media, 'youtube', 'libx264', out, { filterScriptPath: script })
  const res = await exportRun(cmd.args)
  expect(res.code, res.stderr).toBe(0)
  return { out, ms: res.ms }
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

/** Instantes de una curva de `startMs` a `startMs + lengthMs` (los extremos y tres por dentro). */
const inside = (startMs: number, lengthMs: number) => [0.2, 0.4, 0.6, 0.8].map((k) => Math.round(startMs + lengthMs * k))

const report: Record<string, unknown>[] = []

describe.sequential('aparecer y desaparecer con curva (ffmpeg real)', () => {
  it('un trozo aparece desde negro y desaparece hacia negro, imagen y sonido, con su curva', async () => {
    let p = createProject('16:9')
    p = addClip(p, createClip(media.get(f.grey)!, 'g'))
    p = setClipFade(p, 'g', 'in', { ms: 2000, easing: 'ease-in' })
    p = setClipFade(p, 'g', 'out', { ms: 2000, easing: 'smooth' })
    const { out, ms } = await exportVideo('trozo-curvas', p)
    const len = exportedClipDurationMs(p.clips[0]!, 30)
    const clip = p.clips[0]!
    const steady = (await averageColor(out, 4000, 960, 540))[0]!
    const tone = await decode(out, 'bandpass=f=330:width_type=h:width=60')
    const toneSteady = rms(tone, 3500, 4500)
    const rows: Record<string, unknown>[] = []
    for (const t of [...inside(0, 2000), ...inside(len - 2000, 2000)]) {
      // El fotograma que se enseña en t es el que empieza en floor(t·30)/30.
      const frameMs = (Math.floor((t * 30) / 1000) * 1000) / 30
      const g = fadeGainAt(clip, frameMs, len)
      const c = (await averageColor(out, t, 960, 540))[0]!
      // El sonido, en una ventana de 20 ms centrada en t.
      const a = rms(tone, t - 10, t + 10) / toneSteady
      const ga = fadeGainAt(clip, t, len)
      rows.push({ t, gain: Number(g.toFixed(3)), color: c, expectedColor: Math.round(steady * g), sound: Number(a.toFixed(3)), expectedSound: Number(ga.toFixed(3)) })
      // Color: ±4 niveles (compresión, redondeo de eq); sonido: ±0,04 (la ventana promedia la curva).
      expect(Math.abs(c - steady * g), `color en ${t} ms`).toBeLessThanOrEqual(4)
      expect(Math.abs(a - ga), `sonido en ${t} ms`).toBeLessThanOrEqual(0.04)
    }
    console.table(rows)
    report.push({ caso: 'trozo', ms, rows })
    // Al principio, negro; en medio, como es.
    expect((await averageColor(out, 0, 960, 540))[0]!).toBeLessThan(8)
    expect(steady).toBeGreaterThan(190)
  })

  it('un sonido de una pista aparece con «Acaba despacio» y desaparece con «Empieza despacio»', async () => {
    let p = createProject('16:9')
    p = addClip(p, createClip(media.get(f.base)!, 'b'))
    p = setMuted(p, 'b', true)
    p = place(p, item('tono', 'sound', f.tone), 'sound', 2000, 'Sonidos')
    p = setItemFade(p, 'tono', 'in', { ms: 1000, easing: 'ease-out' })
    p = setItemFade(p, 'tono', 'out', { ms: 2000, easing: 'ease-in' })
    const it = p.tracks[0]!.items[0]!
    const { out, ms } = await exportVideo('sonido-curvas', p)
    const s = await decode(out, 'bandpass=f=1000:width_type=h:width=100')
    const steady = rms(s, 3200, 3700)
    const rows: Record<string, unknown>[] = []
    for (const local of [...inside(0, 1000), ...inside(2000, 2000)]) {
      const a = rms(s, 2000 + local - 10, 2000 + local + 10) / steady
      const g = fadeGainAt(it, local, 4000)
      rows.push({ local, sound: Number(a.toFixed(3)), expected: Number(g.toFixed(3)) })
      expect(Math.abs(a - g), `sonido a los ${local} ms`).toBeLessThanOrEqual(0.04)
    }
    console.table(rows)
    report.push({ caso: 'sonido', ms, rows })
  })

  it('un efecto normal aparece con «Empieza despacio» y uno «como luz» con «Suave»', async () => {
    let p = createProject('16:9')
    p = addClip(p, createClip(media.get(f.base)!, 'b'))
    // Rojo a pantalla completa (cover), aparece en 1,5 s.
    p = place(p, item('rojo', 'effect', f.red, { defaults: { durationMs: 3000, look: { fit: 'cover' } } }), 'effect', 1000, 'Encima')
    p = setItemFade(p, 'rojo', 'in', { ms: 2000, easing: 'ease-in' })
    p = setItemFade(p, 'rojo', 'out', { ms: 500, easing: 'ease-out' })
    // Cuadrado blanco «como luz», de 5 s a 9 s.
    p = place(p, item('luz', 'effect', f.light, { defaults: { look: { mix: 'light' } } }), 'effect', 5500, 'Luz')
    p = setItemFade(p, 'luz', 'in', { ms: 2000, easing: 'smooth' })
    const red = p.tracks.find((t) => t.id === 'Encima')!.items[0]!
    const light = p.tracks.find((t) => t.id === 'Luz')!.items[0]!
    const { out, ms } = await exportVideo('efectos-curvas', p)
    const base = (await averageColor(out, 300, 960, 540))[0]!
    const rows: Record<string, unknown>[] = []
    for (const local of [...inside(0, 2000), ...inside(2500, 500)]) {
      const frameLocal = (Math.floor(((1000 + local) * 30) / 1000) * 1000) / 30 - 1000
      const a = fadeGainAt(red, frameLocal, 3000)
      const c = await averageColor(out, 1000 + local, 960, 540)
      // Rojo encima con transparencia a: R = base + (255 − base)·a, G = base·(1 − a).
      const expR = base + (255 - base) * a
      const expG = base * (1 - a)
      rows.push({ caso: 'normal', local, a: Number(a.toFixed(3)), r: c[0], expR: Math.round(expR), g: c[1], expG: Math.round(expG) })
      expect(Math.abs(c[0]! - expR), `rojo a los ${local} ms`).toBeLessThanOrEqual(8)
      expect(Math.abs(c[1]! - expG), `verde a los ${local} ms`).toBeLessThanOrEqual(8)
    }
    for (const local of inside(0, 2000)) {
      const frameLocal = (Math.floor(((5500 + local) * 30) / 1000) * 1000) / 30 - 5500
      const k = fadeGainAt(light, frameLocal, 4000)
      const c = (await averageColor(out, 5500 + local, 960, 540))[0]!
      // «Como luz» (screen) con blanco atenuado k: 1 − (1 − B)(1 − k).
      const exp = 255 * (1 - (1 - base / 255) * (1 - k))
      rows.push({ caso: 'luz', local, k: Number(k.toFixed(3)), v: c, exp: Math.round(exp) })
      expect(Math.abs(c - exp), `luz a los ${local} ms`).toBeLessThanOrEqual(8)
    }
    console.table(rows)
    report.push({ caso: 'efectos', ms, rows })
  })

  it('resumen', () => {
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  })
})
