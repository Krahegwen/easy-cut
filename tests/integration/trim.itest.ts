// «Solo recortar» con el ffmpeg/ffprobe reales (pnpm test:ffmpeg). Un vídeo de «móvil» sintético: fotograma
// clave cada 2 s, B-frames, rotación de visualización de 90° y ubicación en los metadatos (`©xyz` y
// `com.apple.quicktime.location.ISO6709`); un destello blanco de un fotograma y un pitido a la vez en cada
// segundo y medio (0,5 s, 1,5 s…). Se mide en el fichero: dónde empieza, que el primer paquete de vídeo es
// clave, que se reproduce desde el principio, que imagen y sonido siguen a la vez (±50 ms), que no queda la
// ubicación y que se conserva la rotación. Y cuánto tarda «Rápido» frente a «Exacto» con un 1080p.
// Todo en test-output/trim/ (lo usa también scripts/trim-e2e.mjs).

import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildEncoderProbeArgs,
  buildExportCommand,
  buildKeyframeProbeArgs,
  buildProbeArgs,
  buildTrimCopyArgs,
  keyframeAtOrBefore,
  parseKeyframes,
  parseProbeOutput,
  planCopy,
  trimProject,
  type MediaInfo,
  type VideoEncoder,
} from '../../src/domain'

const run = promisify(execFile)
const OUT = resolve(__dirname, '../../test-output/trim')
const BIG = { maxBuffer: 64 * 1024 * 1024, windowsHide: true }

const SYNC = join(OUT, 'src-trim-phone.mov')
const SPEED = join(OUT, 'src-trim-1080p30.mp4')
const LOCATION = '+40.4168-003.7038'

async function ffmpeg(args: string[]) {
  return run('ffmpeg', ['-hide_banner', '-y', ...args], BIG)
}

async function probe(path: string): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', buildProbeArgs(path), BIG)
  return parseProbeOutput(stdout, path)
}

interface Raw {
  streams: { codec_type: string; start_time?: string; side_data_list?: { rotation?: number }[]; tags?: Record<string, string> }[]
  format: { duration: string; tags?: Record<string, string> }
}

async function probeRaw(path: string): Promise<Raw> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], BIG)
  return JSON.parse(stdout) as Raw
}

const rotationOf = (raw: Raw) => raw.streams.find((s) => s.codec_type === 'video')?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0

/** Instantes (s) de los fotogramas blancos (destellos), tal como los decodifica un reproductor. */
async function flashes(path: string): Promise<number[]> {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-an', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], BIG)
  const out: number[] = []
  let t = 0
  for (const line of stdout.split(/\r?\n/)) {
    const m = /pts_time:([\d.]+)/.exec(line)
    if (m) t = Number(m[1])
    const y = /YAVG=([\d.]+)/.exec(line)
    if (y && Number(y[1]) > 100) out.push(t)
  }
  return out
}

/** Instantes (s) en que empieza cada pitido (final de cada silencio). */
async function beeps(path: string): Promise<number[]> {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', path, '-vn', '-af', 'silencedetect=n=-30dB:d=0.1', '-f', 'null', '-'], BIG)
  return [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
}

/** Fotogramas decodificados, el instante del primero y lo que se queja el decodificador (vacío = bien). */
async function decode(path: string): Promise<{ frames: number; errors: string; firstMs: number }> {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', path, '-f', 'null', '-'], BIG)
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', path], BIG)
  const times = stdout.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => parseFloat(l))
  return { frames: times.length, errors: stderr.trim(), firstMs: Math.round((times[0] ?? -1) * 1000) }
}

async function keyframeFor(path: string, inMs: number): Promise<number | null> {
  const { stdout } = await run('ffprobe', buildKeyframeProbeArgs(path, inMs), BIG)
  return keyframeAtOrBefore(parseKeyframes(stdout), inMs)
}

/** El primer paquete de vídeo del fichero (para ver que es clave). */
async function firstVideoPacket(path: string): Promise<{ pts: number; flags: string }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', path], BIG)
  const [pts, flags] = stdout.trim().split(/\r?\n/)[0]!.split(',')
  return { pts: Number(pts), flags: flags ?? '' }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - t0) }
}

let sourceOffset = 0
let sourceRotation = 0
const report: Record<string, unknown> = {}

beforeAll(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const tmp = join(OUT, 'tmp-sync.mp4')
  await ffmpeg([
    '-loglevel', 'error',
    '-f', 'lavfi', '-i', "color=c=black:s=640x360:r=30:d=12,drawbox=c=white:t=fill:enable='between(mod(t\\,1)\\,0.5\\,0.53)'",
    '-f', 'lavfi', '-i', "sine=f=1000:r=48000:d=12,volume=enable='not(between(mod(t\\,1)\\,0.5\\,0.6))':volume=0",
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', tmp,
  ])
  await ffmpeg([
    '-loglevel', 'error', '-display_rotation', '90', '-i', tmp, '-c', 'copy',
    '-metadata', `location=${LOCATION}/`,
    '-metadata', `com.apple.quicktime.location.ISO6709=${LOCATION}+650.000/`,
    '-movflags', 'use_metadata_tags', SYNC,
  ])
  rmSync(tmp, { force: true })
  // De «móvil» en 1080p: fotograma clave cada segundo.
  await ffmpeg([
    '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20',
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', SPEED,
  ])
  const [f, b] = [await flashes(SYNC), await beeps(SYNC)]
  sourceOffset = b[0]! - f[0]!
  sourceRotation = rotationOf(await probeRaw(SYNC))
  expect(readFileSync(SYNC).includes(LOCATION)).toBe(true)
})

describe('Solo recortar con ffmpeg', () => {
  it('fotograma clave anterior al principio marcado', async () => {
    expect(await keyframeFor(SYNC, 5_000)).toBe(4_000)
    expect(await keyframeFor(SYNC, 4_000)).toBe(4_000)
    expect(await keyframeFor(SYNC, 1_500)).toBe(0)
    expect(await keyframeFor(SYNC, 11_900)).toBe(10_000)
  })

  it('«Rápido»: desde el fotograma clave, se reproduce desde el principio, a la vez, sin ubicación y derecho', async () => {
    const info = await probe(SYNC)
    expect(info.rotation).not.toBe(0)
    const range = { inMs: 5_000, outMs: 9_500 }
    const plan = planCopy(range, await keyframeFor(SYNC, range.inMs), info.fps)
    expect(plan).toMatchObject({ startMs: 4_000, earlyMs: 1_000, exact: false })
    const out = join(OUT, 'rapido.mp4')
    const { ms } = await timed(() => ffmpeg(buildTrimCopyArgs({ sourcePath: SYNC, outputPath: out, plan, info })))
    const raw = await probeRaw(out)
    // Dura desde el fotograma clave hasta el final marcado (al copiar, el final puede llevar un par de
    // fotogramas más: los B-frames que van detrás en el orden de decodificación).
    expect(Math.abs(Number(raw.format.duration) - 5.5)).toBeLessThan(0.1)
    // Vídeo y sonido empiezan a la vez, en 0.
    for (const s of raw.streams) expect(Math.abs(Number(s.start_time ?? 0))).toBeLessThan(0.05)
    // El primer paquete de vídeo es el fotograma clave: se ve desde el primer instante, sin congelarse.
    const first = await firstVideoPacket(out)
    expect(first.flags).toContain('K')
    const dec = await decode(out)
    expect(dec.errors).toBe('')
    expect(dec.firstMs).toBeLessThanOrEqual(40)
    expect(Math.abs(dec.frames - 5.5 * 30)).toBeLessThanOrEqual(3)
    // Los destellos de 4,5 / 5,5 / … del original caen en 0,5 / 1,5 / …; el sonido, con ellos (±50 ms).
    const f = await flashes(out)
    const b = await beeps(out)
    expect(f.slice(0, 5).map((t) => Math.round(t * 10) / 10)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5])
    const drift = b[0]! - f[0]! - sourceOffset
    expect(Math.abs(drift)).toBeLessThan(0.05)
    // Sin la ubicación del móvil (ni en los metadatos ni en ningún sitio del fichero) y con la misma rotación.
    expect(readFileSync(out).includes(LOCATION)).toBe(false)
    expect(Object.keys(raw.format.tags ?? {}).some((k) => /location/i.test(k))).toBe(false)
    expect(rotationOf(raw)).toBe(sourceRotation)
    const outInfo = await probe(out)
    expect([outInfo.width, outInfo.height]).toEqual([info.width, info.height])
    report.rapido = { ms, startMs: plan.startMs, earlyMs: plan.earlyMs, durationS: Number(raw.format.duration), avDriftMs: Math.round(drift * 1000), rotation: rotationOf(raw) }
  })

  it('«Rápido» en un fotograma clave: empieza justo ahí', async () => {
    const info = await probe(SYNC)
    const range = { inMs: 6_000, outMs: 8_000 }
    const plan = planCopy(range, await keyframeFor(SYNC, range.inMs), info.fps)
    expect(plan.exact).toBe(true)
    const out = join(OUT, 'rapido-en-clave.mp4')
    await ffmpeg(buildTrimCopyArgs({ sourcePath: SYNC, outputPath: out, plan, info }))
    expect(Math.abs(Number((await probeRaw(out)).format.duration) - 2)).toBeLessThan(0.1)
    // El destello de 6,5 cae en 0,5.
    expect(Math.round((await flashes(out))[0]! * 10) / 10).toBe(0.5)
  })

  it('«Exacto»: justo lo marcado, derecho y sin ubicación', async () => {
    const info = await probe(SYNC)
    const range = { inMs: 5_000, outMs: 9_500 }
    const project = trimProject(info, range)
    const out = join(OUT, 'exacto.mp4')
    const cmd = buildExportCommand(project, { [SYNC]: info }, 'high', 'libx264', out)
    const { ms } = await timed(() => ffmpeg(cmd.args))
    const raw = await probeRaw(out)
    expect(Number(raw.format.duration)).toBeCloseTo(4.5, 1)
    // El destello de 5,5 cae en 0,5: empieza justo donde se marcó.
    const f = await flashes(out)
    const b = await beeps(out)
    expect(Math.round(f[0]! * 10) / 10).toBe(0.5)
    expect(Math.abs(b[0]! - f[0]! - sourceOffset)).toBeLessThan(0.05)
    expect(readFileSync(out).includes(LOCATION)).toBe(false)
    // Recodificado ya derecho (en vertical), sin rotación que aplicar.
    expect(rotationOf(raw)).toBe(0)
    const outInfo = await probe(out)
    expect(outInfo.height).toBeGreaterThan(outInfo.width)
    report.exactoSync = { ms, durationS: Number(raw.format.duration) }
  })

  it('cuánto tarda: «Rápido» frente a «Exacto» con 1080p (8 s de 20)', async () => {
    const info = await probe(SPEED)
    const range = { inMs: 5_300, outMs: 13_300 }
    const plan = planCopy(range, await keyframeFor(SPEED, range.inMs), info.fps)
    expect(plan.startMs).toBe(5_000)
    const copy = await timed(() => ffmpeg(buildTrimCopyArgs({ sourcePath: SPEED, outputPath: join(OUT, 'speed-rapido.mp4'), plan, info })))
    const encoders: VideoEncoder[] = ['libx264']
    try {
      await ffmpeg(buildEncoderProbeArgs('h264_nvenc'))
      encoders.unshift('h264_nvenc')
    } catch {
      // Sin NVENC en este PC: solo libx264.
    }
    const exact: Record<string, number> = {}
    for (const e of encoders) {
      const cmd = buildExportCommand(trimProject(info, range), { [SPEED]: info }, 'high', e, join(OUT, `speed-exacto-${e}.mp4`))
      exact[e] = (await timed(() => ffmpeg(cmd.args))).ms
    }
    report.speed = { source: '1920x1080 30 fps, 20 s', range, copyStartMs: plan.startMs, rapidoMs: copy.ms, exactoMs: exact }
    console.log('[trim] tiempos', JSON.stringify(report.speed))
    for (const ms of Object.values(exact)) expect(copy.ms).toBeLessThan(ms)
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  })
})
