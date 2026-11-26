// «Solo recortar»: fotograma clave, qué hace «Rápido», textos, argumentos de la copia, nombre y proyecto.
import { describe, expect, it } from 'vitest'
import { clipInOut } from './project'
import { fakeMedia } from './test-helpers'
import {
  buildKeyframeProbeArgs,
  buildTrimCopyArgs,
  buildTrimFileName,
  copyProblem,
  describeCopyPlan,
  formatClockTenths,
  formatSeconds,
  keyframeAtOrBefore,
  parseKeyframes,
  planCopy,
  setTrimIn,
  setTrimOut,
  trimOutputMs,
  trimProject,
} from './trim'

const V = 'C:\\Users\\Ana\\Vídeos\\toma 1.mov'

describe('fotogramas clave', () => {
  it('ffprobe: solo paquetes, primera pista de vídeo, ventana de 30 s antes del punto', () => {
    const args = buildKeyframeProbeArgs(V, 45_250)
    expect(args).toEqual(['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '15.250%45.750', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', V])
    expect(buildKeyframeProbeArgs(V, 5_000)).toContain('0.000%5.500')
    expect(buildKeyframeProbeArgs(V, 45_250, true)).toContain('0.000%45.750')
  })

  it('lee los K, redondea hacia arriba al ms y ordena', () => {
    const out = ['4.000000,K__', '4.033333,___', '0.000000,K__', '2.066667,K_D', 'N/A,K__', '', '6.000000,K__', '6.000000,K__'].join('\r\n')
    expect(parseKeyframes(out)).toEqual([0, 2067, 4000, 6000])
  })

  it('el último en el punto o antes', () => {
    expect(keyframeAtOrBefore([0, 2000, 4000], 3999)).toBe(2000)
    expect(keyframeAtOrBefore([0, 2000, 4000], 4000)).toBe(4000)
    expect(keyframeAtOrBefore([33, 2000], 10)).toBeNull()
    expect(keyframeAtOrBefore([], 10)).toBeNull()
  })
})

describe('qué hace «Rápido»', () => {
  it('desde el fotograma clave anterior: empieza antes, y lo dice con la cifra', () => {
    const plan = planCopy({ inMs: 4_800, outMs: 9_000 }, 4_000, 30)
    expect(plan).toEqual({ startMs: 4_000, endMs: 9_000, earlyMs: 800, exact: false })
    expect(describeCopyPlan(plan)).toBe('Empezará 0,8 s antes, en 0:04: sin recodificar, un vídeo solo se puede cortar en ciertos puntos.')
    expect(trimOutputMs({ inMs: 4_800, outMs: 9_000 }, 'copy', plan)).toBe(5_000)
    expect(trimOutputMs({ inMs: 4_800, outMs: 9_000 }, 'exact', plan)).toBe(4_200)
  })

  it('en 0 o en un fotograma clave (a menos de medio fotograma) ya es exacto', () => {
    expect(planCopy({ inMs: 0, outMs: 5_000 }, null, 30)).toEqual({ startMs: 0, endMs: 5_000, earlyMs: 0, exact: true })
    const onKey = planCopy({ inMs: 4_010, outMs: 9_000 }, 4_000, 30)
    expect(onKey.exact).toBe(true)
    expect(onKey.startMs).toBe(4_000)
    expect(describeCopyPlan(onKey)).toBe('Aquí corta justo donde has marcado.')
    expect(planCopy({ inMs: 4_020, outMs: 9_000 }, 4_000, 30).exact).toBe(false)
    // Antes del primer fotograma clave: desde el principio.
    expect(planCopy({ inMs: 10, outMs: 5_000 }, null, 30).startMs).toBe(0)
  })

  it('segundos con un decimal, nunca 0,0', () => {
    expect(formatSeconds(800)).toBe('0,8 s')
    expect(formatSeconds(30)).toBe('0,1 s')
    expect(formatSeconds(1_960)).toBe('2,0 s')
    expect(formatClockTenths(65_340)).toBe('1:05,3')
    expect(formatClockTenths(0)).toBe('0:00,0')
  })

  it('solo se ofrece con H.264 o HEVC y sonido AAC, MP3 o ninguno', () => {
    expect(copyProblem(fakeMedia({ path: V }))).toBeNull()
    expect(copyProblem(fakeMedia({ path: V, videoCodec: 'hevc', hasAudio: false, audioCodec: null }))).toBeNull()
    expect(copyProblem(fakeMedia({ path: V, audioCodec: 'mp3' }))).toBeNull()
    expect(copyProblem(fakeMedia({ path: V, videoCodec: 'prores' }))).toContain('(ProRes)')
    expect(copyProblem(fakeMedia({ path: V, audioCodec: 'pcm_s16le' }))).toContain('El sonido de este vídeo')
    expect(copyProblem(fakeMedia({ path: V, hasVideo: false }))).toBe('Este fichero no tiene imagen.')
  })
})

describe('marcar', () => {
  const D = 10_000
  it('E y T mueven un extremo; si se cruzan, el otro se va al final o al principio', () => {
    expect(setTrimIn({ inMs: 0, outMs: D }, 3_000, D)).toEqual({ inMs: 3_000, outMs: D })
    expect(setTrimIn({ inMs: 0, outMs: 5_000 }, 6_000, D)).toEqual({ inMs: 6_000, outMs: D })
    expect(setTrimIn({ inMs: 0, outMs: D }, 9_900, D)).toEqual({ inMs: 0, outMs: D })
    expect(setTrimOut({ inMs: 3_000, outMs: D }, 7_000, D)).toEqual({ inMs: 3_000, outMs: 7_000 })
    expect(setTrimOut({ inMs: 6_000, outMs: D }, 2_000, D)).toEqual({ inMs: 0, outMs: 2_000 })
    expect(setTrimOut({ inMs: 0, outMs: D }, 100, D)).toEqual({ inMs: 0, outMs: D })
    expect(setTrimIn({ inMs: 0, outMs: D }, -50, D)).toEqual({ inMs: 0, outMs: D })
  })
})

describe('guardar «Rápido»', () => {
  it('copia sin recodificar desde el fotograma clave, sin metadatos y con faststart', () => {
    const args = buildTrimCopyArgs({
      sourcePath: V,
      outputPath: 'C:\\out\\toma 1 (recortado).mp4',
      plan: { startMs: 4_000, endMs: 9_500, earlyMs: 800, exact: false },
      info: { videoCodec: 'h264', hasAudio: true },
    })
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual(['-ss', '4.000', '-i', V])
    expect(args).toContain('-progress')
    const after = args.slice(args.indexOf('-i') + 2)
    expect(after).toEqual([
      '-t', '5.500',
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-c', 'copy',
      '-map_metadata', '-1',
      '-map_chapters', '-1',
      '-movflags', '+faststart',
      'C:\\out\\toma 1 (recortado).mp4',
    ])
    // Sin make_zero: quitaba la edit list y descolocaba el vídeo respecto al sonido.
    expect(args).not.toContain('-avoid_negative_ts')
  })

  it('desde el principio, sin -ss; HEVC con hvc1; sin sonido, sin pista de sonido', () => {
    const args = buildTrimCopyArgs({
      sourcePath: V,
      outputPath: 'o.mp4',
      plan: { startMs: 0, endMs: 3_000, earlyMs: 0, exact: true },
      info: { videoCodec: 'hevc', hasAudio: false },
    })
    expect(args).not.toContain('-ss')
    expect(args).not.toContain('0:a:0')
    expect(args.join(' ')).toContain('-tag:v hvc1')
  })

  it('nombre «… (recortado).mp4» sin sobrescribir', () => {
    expect(buildTrimFileName(V)).toBe('toma 1 (recortado).mp4')
    expect(buildTrimFileName(V, ['TOMA 1 (recortado).mp4', 'toma 1 (recortado) 2.mp4'])).toBe('toma 1 (recortado) 3.mp4')
    expect(buildTrimFileName('C:\\a\\.mp4')).toBe('Vídeo (recortado).mp4')
  })
})

describe('proyecto de un trozo', () => {
  it('con lo marcado y la forma del vídeo', () => {
    const info = fakeMedia({ path: V, width: 1080, height: 1920, durationMs: 20_000 })
    const p = trimProject(info, { inMs: 2_000, outMs: 8_500 })
    expect(p.aspect).toBe('9:16')
    expect(p.clips).toHaveLength(1)
    expect(clipInOut(p.clips[0]!)).toEqual({ startMs: 2_000, endMs: 8_500 })
    expect(clipInOut(trimProject(info, { inMs: 0, outMs: 20_000 }).clips[0]!)).toEqual({ startMs: 0, endMs: 20_000 })
  })
})
