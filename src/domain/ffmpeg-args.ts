// Constructor de los argumentos de ffmpeg para exportar el proyecto.
// Siempre un array de argumentos (para spawn/execFile), nunca una cadena para el shell.

import { encoderVideoArgs, type VideoEncoder } from './encoders'
import { computeOutputSpec, even, type OutputSpec, type PresetId } from './output'
import {
  clipDisplaySize,
  clipInOut,
  clipOutputMs,
  type Clip,
  type MediaInfo,
  type Project,
  type Speed,
} from './project'

export const AUDIO_SAMPLE_RATE = 48_000
/** Microfundido en los bordes de cada rango conservado, para evitar clics. */
export const EDGE_FADE_MS = 30
export const BT709_SETPARAMS = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'

type MediaLookup = ReadonlyMap<string, MediaInfo> | Record<string, MediaInfo>

function lookup(media: MediaLookup, path: string): MediaInfo {
  const m = media instanceof Map ? media.get(path) : (media as Record<string, MediaInfo>)[path]
  if (!m) throw new Error(`Falta la información del original ${path}`)
  return m
}

/** Milisegundos → segundos para ffmpeg, sin ceros sobrantes («1.5», «12», «0.033»). */
export function sec(ms: number): string {
  const s = (Math.round(ms) / 1000).toFixed(3)
  return s.replace(/\.?0+$/, '') || '0'
}

/** Fotogramas que ocupa el trozo en la salida (CFR). */
export function clipFrameCount(clip: Clip, fps: number): number {
  return Math.max(1, Math.round((clipOutputMs(clip) * fps) / 1000))
}

/** Duración real del trozo exportado: un número entero de fotogramas. */
export function exportedClipDurationMs(clip: Clip, fps: number): number {
  return (clipFrameCount(clip, fps) * 1000) / fps
}

export function exportedProjectDurationMs(project: Project, fps: number): number {
  return project.clips.reduce((sum, c) => sum + exportedClipDurationMs(c, fps), 0)
}

/** atempo encadenado con factores dentro de [0.5, 2] (compatible con cualquier ffmpeg). */
export function atempoChain(speed: number): string[] {
  const filters: string[] = []
  let remaining = speed
  while (remaining > 2) {
    filters.push('atempo=2')
    remaining /= 2
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }
  if (Math.abs(remaining - 1) > 1e-9) filters.push(`atempo=${Number(remaining.toFixed(6))}`)
  return filters
}

/** ¿Este trozo lleva su sonido? A ×4, silenciado o sin pista de audio, va en silencio. */
export function clipKeepsAudio(clip: Clip, media: MediaInfo): boolean {
  return media.hasAudio && !clip.muted && clip.speed !== (4 as Speed)
}

/** Cadena de tone mapping HDR → SDR BT.709 con zscale + tonemap=hable. */
export function toneMapFilters(media: MediaInfo): string[] {
  const tin = media.colorTransfer === 'arib-std-b67' ? 'arib-std-b67' : 'smpte2084'
  const min = media.colorSpace === 'bt2020c' ? 'bt2020c' : 'bt2020nc'
  return [
    `zscale=tin=${tin}:min=${min}:pin=bt2020:rin=tv:t=linear:npl=100`,
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ]
}

export function rotationFilters(quarterTurns: number): string[] {
  switch (quarterTurns) {
    case 1:
      return ['transpose=clock']
    case 2:
      return ['hflip', 'vflip']
    case 3:
      return ['transpose=cclock']
    default:
      return []
  }
}

export interface FramingPlan {
  /** Filtros del vídeo principal (escalado + recorte). */
  foreground: string[]
  /** Filtros del fondo desenfocado, o null si el vídeo ya llena la pantalla. */
  background: string[] | null
  overlayX: number
  overlayY: number
}

/**
 * Encuadre del trozo (ya girado, de w×h) dentro de la salida W×H.
 * fit-blur: se ve entero y, si no llena, el mismo vídeo desenfocado de fondo.
 * fill: llena la pantalla recortando lo que sobra.
 */
export function planFraming(clip: Clip, media: MediaInfo, spec: Pick<OutputSpec, 'width' | 'height'>): FramingPlan {
  const { width: w, height: h } = clipDisplaySize(clip, media)
  const W = spec.width
  const H = spec.height
  const { zoom, offsetX, offsetY } = clip.framing
  const scaleOpts = 'flags=bicubic:out_color_matrix=bt709:out_range=tv'
  // offset -1 → borde izquierdo/superior, 0 → centro, 1 → borde derecho/inferior.
  const cropPos = (extra: number, offset: number) => (extra <= 0 ? 0 : Math.min(extra, Math.max(0, Math.round((extra / 2) * (1 + offset)))))

  if (clip.framing.mode === 'fill') {
    const s = Math.max(W / w, H / h) * zoom
    const sw = Math.max(W, even(w * s))
    const sh = Math.max(H, even(h * s))
    const x = cropPos(sw - W, offsetX)
    const y = cropPos(sh - H, offsetY)
    const fg = [`scale=${sw}:${sh}:${scaleOpts}`]
    if (sw !== W || sh !== H) fg.push(`crop=${W}:${H}:${x}:${y}`)
    return { foreground: fg, background: null, overlayX: 0, overlayY: 0 }
  }

  const s = Math.min(W / w, H / h) * zoom
  const fw = even(w * s)
  const fh = even(h * s)
  const cw = Math.min(fw, W)
  const ch = Math.min(fh, H)
  const fg = [`scale=${fw}:${fh}:${scaleOpts}`]
  if (cw !== fw || ch !== fh) fg.push(`crop=${cw}:${ch}:${cropPos(fw - cw, offsetX)}:${cropPos(fh - ch, offsetY)}`)
  // Casi lleno (diferencia de redondeo): se estira lo poco que falta y no hace falta fondo.
  if (W - cw <= 4 && H - ch <= 4) {
    if (cw !== W || ch !== H) fg.push(`scale=${W}:${H}:flags=bicubic`)
    return { foreground: fg, background: null, overlayX: 0, overlayY: 0 }
  }
  // Fondo barato: se reduce mucho, se desenfoca a baja resolución y se vuelve a ampliar.
  const bw = even(W / 8)
  const bh = even(H / 8)
  const radius = Math.max(1, Math.min(10, Math.floor(Math.min(bw, bh) / 4)))
  const background = [
    `scale=${bw}:${bh}:force_original_aspect_ratio=increase:force_divisible_by=2:flags=fast_bilinear`,
    `crop=${bw}:${bh}`,
    `boxblur=luma_radius=${radius}:luma_power=2:chroma_radius=${radius}:chroma_power=2`,
    `scale=${W}:${H}:flags=bilinear:out_color_matrix=bt709:out_range=tv`,
  ]
  return {
    foreground: fg,
    background,
    overlayX: Math.min(W - cw, Math.max(0, Math.floor((W - cw) / 4) * 2)),
    overlayY: Math.min(H - ch, Math.max(0, Math.floor((H - ch) / 4) * 2)),
  }
}

export interface ExportCommand {
  args: string[]
  /** El filter_complex; si se pasa filterScriptPath, hay que escribirlo en ese fichero antes de lanzar ffmpeg. */
  filterComplex: string
  spec: OutputSpec
  /** Duración que tendrá el vídeo (fotogramas enteros por trozo). */
  expectedDurationMs: number
}

export interface ExportOptions {
  /**
   * Si se da, el filtro va en un fichero (`-/filter_complex ruta`, ffmpeg ≥ 7.1) en vez de en la línea
   * de comandos: con muchos trozos y pausas quitadas se pasaría del límite de 32 767 caracteres de Windows.
   */
  filterScriptPath?: string
}

/** Construye la orden de exportación completa. */
export function buildExportCommand(
  project: Project,
  mediaByPath: MediaLookup,
  presetId: PresetId,
  encoder: VideoEncoder,
  outputPath: string,
  options: ExportOptions = {},
): ExportCommand {
  if (project.clips.length === 0) throw new Error('El proyecto no tiene trozos que exportar.')
  const spec = computeOutputSpec(project, mediaByPath, presetId)
  const F = spec.fps
  const inputs: string[] = []
  const chains: string[] = []
  const concatInputs: string[] = []

  project.clips.forEach((clip, i) => {
    const media = lookup(mediaByPath, clip.sourcePath)
    const io = clipInOut(clip)
    inputs.push('-ss', sec(io.startMs), '-t', sec(io.endMs - io.startMs), '-i', clip.sourcePath)

    const frames = clipFrameCount(clip, F)
    const samples = Math.round((frames * AUDIO_SAMPLE_RATE) / F)
    const rel = clip.segments.map((s) => ({ startMs: s.startMs - io.startMs, endMs: s.endMs - io.startMs }))
    const multi = rel.length > 1

    // --- Vídeo ---
    const vSeg = `v${i}seg`
    if (multi) {
      const labels = rel.map((_, j) => `[v${i}s${j}]`)
      chains.push(`[${i}:v:0]split=${rel.length}${labels.join('')}`)
      rel.forEach((r, j) => {
        chains.push(`[v${i}s${j}]trim=start=${sec(r.startMs)}:end=${sec(r.endMs)},setpts=PTS-STARTPTS[v${i}t${j}]`)
      })
      chains.push(`${rel.map((_, j) => `[v${i}t${j}]`).join('')}concat=n=${rel.length}:v=1:a=0[${vSeg}]`)
    } else {
      chains.push(`[${i}:v:0]setpts=PTS-STARTPTS[${vSeg}]`)
    }

    const timing = [
      clip.speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${clip.speed}`,
      `fps=${F}`,
      // Rellena con el último fotograma si faltara alguno y corta en el número exacto de fotogramas.
      `tpad=stop_mode=clone:stop=${F}`,
      `trim=end_frame=${frames}`,
    ]
    const look = [...(media.isHdr ? toneMapFilters(media) : []), ...rotationFilters(clip.quarterTurns)]
    const plan = planFraming(clip, media, spec)
    // setparams etiqueta cada fotograma como BT.709: las opciones de salida -color_trc/-color_primaries
    // no bastan en ffmpeg reciente si el fotograma llega «sin especificar» (comprobado con la build local).
    const tail = ['setsar=1', 'format=yuv420p', BT709_SETPARAMS]
    if (plan.background) {
      chains.push(`[${vSeg}]${[...timing, ...look, `split=2[v${i}bgsrc][v${i}fgsrc]`].join(',')}`)
      chains.push(`[v${i}bgsrc]${plan.background.join(',')}[v${i}bg]`)
      chains.push(`[v${i}fgsrc]${plan.foreground.join(',')}[v${i}fg]`)
      chains.push(
        `[v${i}bg][v${i}fg]overlay=x=${plan.overlayX}:y=${plan.overlayY}:shortest=1,${tail.join(',')}[v${i}]`,
      )
    } else {
      chains.push(`[${vSeg}]${[...timing, ...look, ...plan.foreground, ...tail].join(',')}[v${i}]`)
    }

    // --- Audio ---
    const audioFormat = `aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo`
    if (clipKeepsAudio(clip, media)) {
      const fade = (lenMs: number) =>
        lenMs > EDGE_FADE_MS * 2
          ? [`afade=t=in:d=${sec(EDGE_FADE_MS)}`, `afade=t=out:st=${sec(lenMs - EDGE_FADE_MS)}:d=${sec(EDGE_FADE_MS)}`]
          : []
      const pre = `[${i}:a:0]aresample=${AUDIO_SAMPLE_RATE},${audioFormat}`
      const aSeg = `a${i}seg`
      if (multi) {
        const labels = rel.map((_, j) => `[a${i}s${j}]`)
        chains.push(`${pre},asplit=${rel.length}${labels.join('')}`)
        rel.forEach((r, j) => {
          const parts = [
            `atrim=start=${sec(r.startMs)}:end=${sec(r.endMs)}`,
            'asetpts=PTS-STARTPTS',
            ...fade(r.endMs - r.startMs),
          ]
          chains.push(`[a${i}s${j}]${parts.join(',')}[a${i}t${j}]`)
        })
        chains.push(`${rel.map((_, j) => `[a${i}t${j}]`).join('')}concat=n=${rel.length}:v=0:a=1[${aSeg}]`)
      } else {
        const r = rel[0]!
        chains.push(`${pre},${['asetpts=PTS-STARTPTS', ...fade(r.endMs - r.startMs)].join(',')}[${aSeg}]`)
      }
      const after = [
        ...atempoChain(clip.speed),
        // Mismo número exacto de muestras que de fotogramas: audio y vídeo duran lo mismo.
        `apad=whole_len=${samples}`,
        `atrim=end_sample=${samples}`,
        audioFormat,
      ]
      chains.push(`[${aSeg}]${after.join(',')}[a${i}]`)
    } else {
      chains.push(
        `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE},atrim=end_sample=${samples},${audioFormat}[a${i}]`,
      )
    }
    concatInputs.push(`[v${i}][a${i}]`)
  })

  chains.push(`${concatInputs.join('')}concat=n=${project.clips.length}:v=1:a=1[vout][aout]`)
  const filterComplex = chains.join(';\n')

  const args = [
    '-hide_banner',
    '-y',
    '-nostats',
    '-loglevel', 'error',
    '-progress', 'pipe:1',
    ...inputs,
    ...(options.filterScriptPath
      ? ['-/filter_complex', options.filterScriptPath]
      : ['-filter_complex', filterComplex]),
    '-map', '[vout]',
    '-map', '[aout]',
    ...encoderVideoArgs(encoder, spec),
    '-fps_mode', 'cfr',
    '-r', String(F),
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-color_range', 'tv',
    '-c:a', 'aac',
    '-b:a', `${spec.audioBitrateKbps}k`,
    '-ar', String(AUDIO_SAMPLE_RATE),
    '-ac', '2',
    // Sin metadatos del original (p. ej. la ubicación GPS del móvil).
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-movflags', '+faststart',
    outputPath,
  ]

  return { args, filterComplex, spec, expectedDurationMs: exportedProjectDurationMs(project, F) }
}

/** Argumentos de ffmpeg para exportar (el filtro va en línea). */
export function buildExportArgs(
  project: Project,
  mediaByPath: MediaLookup,
  preset: PresetId,
  encoder: VideoEncoder,
  outputPath: string,
): string[] {
  return buildExportCommand(project, mediaByPath, preset, encoder, outputPath).args
}
