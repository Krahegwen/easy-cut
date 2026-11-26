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
  addMark,
  BT709_SETPARAMS,
  cornerBox,
  findClipVideoItem,
  moveToCornerAt,
  parseProject,
  roundedMaskExpression,
  setCover,
  addTrack,
  boxAt,
  buildEncoderProbeArgs,
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
  setBoxAt,
  setClipFade,
  setItemFade,
  setMuted,
  setSegmentEasing,
  updateEffectLook,
  type MediaInfo,
  type NewItem,
  type Project,
  type TrackItem,
  type VideoEncoder,
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
  /** El que habla (un patrón que se mueve, con tono) y el vídeo de fondo (otro patrón): para la esquina de antes. */
  talk: join(OUT, 'src-yo-testsrc2-1080p30.mp4'),
  backdrop: join(OUT, 'src-fondo-mandelbrot-1080p30.mp4'),
  /** Verde liso (el que habla) sobre azul liso (el fondo): para medir dónde está en cada instante. */
  green: join(OUT, 'src-yo-verde-1080p30.mp4'),
  blue: join(OUT, 'src-fondo-azul-1080p30.mp4'),
}
const media = new Map<string, MediaInfo>()
/** ¿Hay NVENC en este PC? (el movimiento y la esquina se miden también con él, como en export.itest). */
let nvenc = false

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
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', ...enc, f.talk])
  await ffmpeg(['-f', 'lavfi', '-i', 'mandelbrot=size=1920x1080:rate=30', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f.backdrop])
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x20c040:size=1920x1080:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', ...enc, f.green])
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x2040c0:size=1920x1080:rate=30:duration=10', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f.blue])
  for (const p of [f.grey, f.base, f.tone, f.light, f.talk, f.backdrop, f.green, f.blue]) media.set(p, await probe(p))
  try {
    await run('ffmpeg', buildEncoderProbeArgs('h264_nvenc'), BIG)
    nvenc = true
  } catch {
    nvenc = false
  }
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

async function exportVideo(name: string, p: Project, encoder: VideoEncoder = 'libx264'): Promise<{ out: string; ms: number }> {
  const out = join(OUT, `${name}.mp4`)
  const script = join(OUT, `${name}.filter.txt`)
  writeFileSync(script, buildExportCommand(p, media, 'youtube', encoder, out).filterComplex)
  const cmd = buildExportCommand(p, media, 'youtube', encoder, out, { filterScriptPath: script })
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

  // ------------------------------------------------------------------ B. Movimiento con marcas

  /** Proyecto con una pegatina roja (contain) que viaja con tres marcas, y un cuadrado «como luz» que también. */
  function movingProject(withMotion: boolean): Project {
    let p = createProject('16:9')
    p = addClip(p, createClip(media.get(f.base)!, 'b'))
    p = place(p, item('rojo', 'effect', f.red, { defaults: { durationMs: 4000, look: { fit: 'contain', box: { x: 0.2, y: 0.3, scale: 0.2 } } } }), 'effect', 1000, 'Encima')
    p = place(p, item('luz', 'effect', f.light, { defaults: { look: { mix: 'light', box: { x: 0.3, y: 0.5, scale: 0.5 } } } }), 'effect', 5500, 'Luz')
    if (!withMotion) return p
    p = updateEffectLook(p, 'rojo', (l) => {
      let look = addMark(l, 500)
      look = setBoxAt(look, 2500, { x: 0.75, y: 0.7, scale: 0.4 })
      look = setBoxAt(look, 3500, { x: 0.5, y: 0.5, scale: 0.3 })
      return setSegmentEasing(look, 3200, 'ease-in')
    })
    p = updateEffectLook(p, 'luz', (l) => setBoxAt(addMark(l, 500), 3000, { x: 0.7, y: 0.5, scale: 0.25 }))
    return p
  }

  /** Recuadro (fracciones del marco) de lo que pasa `test` en el fotograma de `ms`, a 480×270. */
  async function blob(path: string, ms: number, test: (r: number, g: number, b: number) => boolean) {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', (ms / 1000).toFixed(3), '-i', path, '-frames:v', '1', '-vf', 'scale=480:270:flags=area,format=rgb24', '-f', 'rawvideo', '-'], { ...BIG, encoding: 'buffer' })
    const b = stdout as unknown as Buffer
    let minX = 480
    let maxX = -1
    let minY = 270
    let maxY = -1
    for (let y = 0; y < 270; y++) {
      for (let x = 0; x < 480; x++) {
        const i = (y * 480 + x) * 3
        if (!test(b[i]!, b[i + 1]!, b[i + 2]!)) continue
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
    if (maxX < 0) return null
    return { cx: (minX + maxX + 1) / 2 / 480, cy: (minY + maxY + 1) / 2 / 270, w: (maxX - minX + 1) / 480, h: (maxY - minY + 1) / 270 }
  }

  for (const encoder of ['libx264', 'h264_nvenc'] as const)
  it(`una pegatina con marcas viaja por el fichero como en la vista previa (±2 % del marco), y «como luz» también · ${encoder}`, async (ctx) => {
    if (encoder === 'h264_nvenc' && !nvenc) ctx.skip()
    const still = await exportVideo(`sin-movimiento-${encoder}`, movingProject(false), encoder)
    const p = movingProject(true)
    const moved = await exportVideo(`con-movimiento-${encoder}`, p, encoder)
    const red = p.tracks.find((t) => t.id === 'Encima')!.items[0]!
    const light = p.tracks.find((t) => t.id === 'Luz')!.items[0]!
    const rows: Record<string, unknown>[] = []
    let worst = 0
    for (const local of [200, 800, 1300, 1700, 2400, 2900, 3300, 3700]) {
      const frameLocal = (Math.floor(((1000 + local) * 30) / 1000) * 1000) / 30 - 1000
      const want = boxAt(red.look!, frameLocal)
      // La pegatina es un cuadrado: su lado es el alto del recuadro (contain en 16:9) por el tamaño.
      const got = await blob(moved.out, 1000 + local, (r, g, b) => r > 180 && g < 80 && b < 80)
      expect(got, `pegatina a los ${local} ms`).not.toBeNull()
      const err = Math.max(Math.abs(got!.cx - want.x), Math.abs(got!.cy - want.y), Math.abs(got!.h - want.scale))
      worst = Math.max(worst, err)
      rows.push({ caso: 'pegatina', local, x: got!.cx.toFixed(3), wantX: want.x.toFixed(3), y: got!.cy.toFixed(3), wantY: want.y.toFixed(3), size: got!.h.toFixed(3), wantSize: want.scale.toFixed(3) })
      expect(err, `pegatina a los ${local} ms`).toBeLessThanOrEqual(0.02)
    }
    for (const local of [300, 1200, 1900, 2600, 3400]) {
      const frameLocal = (Math.floor(((5500 + local) * 30) / 1000) * 1000) / 30 - 5500
      const want = boxAt(light.look!, frameLocal)
      // El cuadrado blanco ocupa 400/1080 del alto del efecto (cover a 1920×1080): su lado, por el tamaño.
      const got = await blob(moved.out, 5500 + local, (r, g, b) => r > 200 && g > 200 && b > 200)
      expect(got, `luz a los ${local} ms`).not.toBeNull()
      const err = Math.max(Math.abs(got!.cx - want.x), Math.abs(got!.cy - want.y), Math.abs(got!.h - (want.scale * 400) / 1080))
      worst = Math.max(worst, err)
      rows.push({ caso: 'luz', local, x: got!.cx.toFixed(3), wantX: want.x.toFixed(3), y: got!.cy.toFixed(3), wantY: want.y.toFixed(3), size: got!.h.toFixed(3), wantSize: ((want.scale * 400) / 1080).toFixed(3) })
      expect(err, `luz a los ${local} ms`).toBeLessThanOrEqual(0.02)
    }
    console.table(rows)
    console.log(`Coste de guardar (10 s a 1080p, ${encoder}):`, { sinMovimiento: still.ms, conMovimiento: moved.ms, peorError: worst.toFixed(4) })
    report.push({ caso: `movimiento-${encoder}`, sinMovimientoMs: still.ms, conMovimientoMs: moved.ms, peorError: worst, rows })
  })

  // ------------------------------------------------------------------ C. El vídeo del trozo a una esquina y de vuelta

  /** SSIM entre dos imágenes del mismo tamaño (1 = iguales). */
  async function ssim(a: string, b: string): Promise<number> {
    // ssim da el resultado en el registro normal (no con -loglevel error).
    const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', '[0:v][1:v]ssim', '-f', 'null', '-'], BIG)
    const m = /All:([\d.]+)/.exec(stderr)
    return m ? Number(m[1]) : 0
  }
  async function frameAt(path: string, ms: number, out: string, vf?: string): Promise<string> {
    await ffmpeg(['-ss', (ms / 1000).toFixed(3), '-i', path, '-frames:v', '1', ...(vf ? ['-vf', vf] : []), out])
    return out
  }

  it('un proyecto de antes con la esquina se ve igual al abrirlo (fotogramas del guardado de antes y del convertido)', async () => {
    // El proyecto de la versión 4: el trozo que habla, con el fondo encima y él en la esquina de abajo a la derecha.
    const v4 = JSON.stringify({
      app: 'easy-cut',
      version: 4,
      project: {
        aspect: '16:9',
        clips: [
          {
            id: 'a',
            sourcePath: f.talk,
            sourceDurationMs: media.get(f.talk)!.durationMs,
            sourceHasVideo: true,
            segments: [{ startMs: 500, endMs: 6500 }],
            speed: 1,
            picture: { kind: 'cover', sourcePath: f.backdrop, sourceDurationMs: media.get(f.backdrop)!.durationMs, startMs: 1000, framing: { mode: 'fit-blur', zoom: 1, offsetX: 0, offsetY: 0 }, quarterTurns: 0, inset: { corner: 'bottom-right', size: 'small' } },
          },
        ],
        media: [],
      },
    })
    const migrated = parseProject(v4)
    expect(migrated.tracks.flatMap((t) => t.items).map((i) => i.source.type)).toEqual(['clip'])
    const now = await exportVideo('esquina-convertida', migrated)

    // El guardado de antes, con el filtro de la versión 4 (el de ffmpeg-args.ts de entonces): la imagen del trozo
    // con el fondo y su vídeo en la esquina (recorte centrado, máscara geq una sola vez, alphamerge, overlay).
    const coverOnly = { ...migrated, tracks: [] }
    const out = join(OUT, 'esquina-antes.mp4')
    const script = join(OUT, 'esquina-antes.filter.txt')
    const draft = buildExportCommand(coverOnly, media, 'youtube', 'libx264', out)
    const W = draft.spec.width
    const H = draft.spec.height
    const frames = Math.round((6000 * 30) / 1000)
    const ev = (n: number) => Math.max(2, Math.round(n / 2) * 2)
    const iw = ev(W * 0.28)
    const ih = ev(H * 0.28)
    const margin = ev(Math.min(W, H) * 0.04)
    const left = W - iw - margin
    const top = H - ih - margin
    const radius = Math.max(2, Math.round(Math.min(iw, ih) * 0.08))
    const legacy = [
      '[0:v:0]setpts=PTS-STARTPTS[old0seg]',
      `[old0seg]setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop=30,trim=end_frame=${frames},scale=${iw}:${ih}:force_original_aspect_ratio=increase:flags=bicubic:out_color_matrix=bt709:out_range=tv,crop=${iw}:${ih},setsar=1,format=yuva420p[old0inset]`,
      `color=c=white:s=${iw}x${ih}:r=30,trim=end_frame=1,format=gray,geq=lum='${roundedMaskExpression(radius)}',loop=loop=-1:size=1,trim=end_frame=${frames},setpts=N/30/TB[old0mask]`,
      '[old0inset][old0mask]alphamerge[old0round]',
      `[v0][old0round]overlay=x=${left}:y=${top}:shortest=1,setsar=1,format=yuv420p,${BT709_SETPARAMS}[v0old]`,
    ]
    const fc = draft.filterComplex.replace('[v0][a0]concat', '[v0old][a0]concat') + ';\n' + legacy.join(';\n')
    writeFileSync(script, fc)
    const cmd = buildExportCommand(coverOnly, media, 'youtube', 'libx264', out, { filterScriptPath: script })
    const res = await exportRun(cmd.args)
    expect(res.code, res.stderr).toBe(0)

    const rows: Record<string, unknown>[] = []
    for (const ms of [300, 2000, 4500, 5800]) {
      const a = await frameAt(out, ms, join(OUT, `esquina-antes-${ms}.png`))
      const b = await frameAt(now.out, ms, join(OUT, `esquina-ahora-${ms}.png`))
      const whole = await ssim(a, b)
      // La esquina, por zonas: el color medio de 8 × 5 casillas (el sitio de ahora puede caer 1 px más allá, porque
      // el de antes redondeaba el margen a pares, y en un patrón de barras de colores eso hunde el SSIM sin que se
      // note nada; por casillas se compara lo que se ve).
      const cells = async (path: string, vf: string) => {
        const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', (ms / 1000).toFixed(3), '-i', path, '-frames:v', '1', '-vf', `${vf},format=rgb24`, '-f', 'rawvideo', '-'], { ...BIG, encoding: 'buffer' })
        return [...(stdout as unknown as Buffer)]
      }
      const worstOf = async (vf: string) => {
        const ca = await cells(out, vf)
        const cb = await cells(now.out, vf)
        return Math.max(...ca.map((v, k) => Math.abs(v - cb[k]!)))
      }
      const corner = await worstOf(`crop=${iw}:${ih}:${left}:${top},scale=8:5:flags=area`)
      // Y el fotograma entero, en 16 × 9 casillas.
      const frameCells = await worstOf('scale=16:9:flags=area')
      rows.push({ ms, ssim: whole.toFixed(4), cornerWorstLevel: corner, frameWorstLevel: frameCells })
      // Medido: SSIM del fotograma entero entre 0,93 y 0,97 (el tramo pasa ahora por RGB y vuelve y el fondo es un
      // fractal lleno de detalle a 8 Mbit/s); las casillas, a pocos niveles.
      expect(whole, `fotograma entero a los ${ms} ms`).toBeGreaterThan(0.9)
      expect(corner, `la esquina a los ${ms} ms`).toBeLessThanOrEqual(16)
      expect(frameCells, `el fotograma por casillas a los ${ms} ms`).toBeLessThanOrEqual(10)
    }
    console.table(rows)
    console.log('Coste de guardar la esquina (6 s a 1080p, libx264):', { antes: res.ms, ahora: now.ms })
    report.push({ caso: 'esquina-de-antes', antesMs: res.ms, ahoraMs: now.ms, rows })
  })

  for (const encoder of ['libx264', 'h264_nvenc'] as const)
  it(`«Llevar a una esquina aquí» y «Volver a pantalla completa aquí»: el vídeo del trozo viaja y vuelve (±2 %) · ${encoder}`, async (ctx) => {
    if (encoder === 'h264_nvenc' && !nvenc) ctx.skip()
    let p = createProject('16:9')
    p = addClip(p, createClip(media.get(f.green)!, 'g'))
    p = setCover(p, 'g', media.get(f.blue)!)
    const base0 = p
    const go = moveToCornerAt(p, 'g', 1500, { itemId: 'yo', trackId: 'Tu vídeo encima' })!
    const back = moveToCornerAt(go.project, 'g', 5000, { itemId: 'yo', trackId: 'Tu vídeo encima' })!
    p = back.project
    expect([go.move, back.move]).toEqual(['to-corner', 'to-full'])
    const still = await exportVideo(`esquina-quieta-${encoder}`, moveToCornerAt(base0, 'g', 0, { itemId: 'yo', trackId: 't' })!.project, encoder)
    const moved = await exportVideo(`esquina-viaje-${encoder}`, p, encoder)
    const look = findClipVideoItem(p, 'g')!.item.look!
    const green = (r: number, g: number, b: number) => g > 140 && r < 90 && b < 110
    const rows: Record<string, unknown>[] = []
    for (const ms of [1000, 1700, 1900, 2100, 3500, 5200, 5400, 5600, 7000]) {
      const frameMs = (Math.floor((ms * 30) / 1000) * 1000) / 30
      const want = boxAt(look, frameMs)
      const got = await blob(moved.out, ms, green)
      expect(got, `a los ${ms} ms`).not.toBeNull()
      const err = Math.max(Math.abs(got!.cx - want.x), Math.abs(got!.cy - want.y), Math.abs(got!.h - want.scale))
      rows.push({ ms, x: got!.cx.toFixed(3), wantX: want.x.toFixed(3), y: got!.cy.toFixed(3), wantY: want.y.toFixed(3), size: got!.h.toFixed(3), wantSize: want.scale.toFixed(3) })
      expect(err, `a los ${ms} ms`).toBeLessThanOrEqual(0.02)
    }
    console.table(rows)
    // En la esquina, las esquinas redondeadas dejan ver el fondo (azul) justo en el vértice del recuadro.
    const corner = cornerBox('16:9')
    const vx = Math.round((corner.x + corner.scale / 2) * 1920) - 3
    const vy = Math.round((corner.y + corner.scale / 2) * 1080) - 3
    const atVertex = await averageColor(moved.out, 3500, vx, vy, 4)
    const inside = await averageColor(moved.out, 3500, Math.round(corner.x * 1920), Math.round(corner.y * 1080), 8)
    console.log('Esquina redondeada:', { atVertex, inside })
    expect(atVertex[2]!).toBeGreaterThan(150)
    expect(inside[1]!).toBeGreaterThan(150)
    // Y a pantalla completa, sin esquinas: el vértice de la pantalla es del trozo (verde).
    expect((await averageColor(moved.out, 7500, 1916, 1076, 4))[1]!).toBeGreaterThan(150)
    console.log(`Coste de guardar el viaje a la esquina (8 s a 1080p, ${encoder}):`, { quieto: still.ms, viajando: moved.ms })
    report.push({ caso: `llevar-a-la-esquina-${encoder}`, quietoMs: still.ms, viajandoMs: moved.ms, rows })
  })

  it('resumen', () => {
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  })
})
