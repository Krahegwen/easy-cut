// Constructor de los argumentos de ffmpeg para exportar el proyecto.
// Siempre un array de argumentos (para spawn/execFile), nunca una cadena para el shell.

import { encoderVideoArgs, type VideoEncoder } from './encoders'
import { insetRect, PLAIN_BACKGROUND_HEX } from './layout'
import { computeOutputSpec, even, SOUND_BITRATE_KBPS, type OutputSpec, type PresetId } from './output'
import {
  clipDisplaySize,
  clipInOut,
  clipOutputMs,
  type Clip,
  type CoverPicture,
  type MediaInfo,
  type Project,
  type Speed,
  type Viewable,
} from './project'

export const AUDIO_SAMPLE_RATE = 48_000
/** Microfundido en los bordes de cada rango conservado, para evitar clics. */
export const EDGE_FADE_MS = 30
export const BT709_SETPARAMS = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'
/**
 * El vídeo de encima nunca se busca a menos de esto de su final: más allá no hay fotogramas que
 * decodificar y tpad no tendría nada que repetir (se vería su última imagen igualmente).
 */
export const COVER_SEEK_TAIL_MS = 250

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
 * Encuadre del trozo o del vídeo de encima (ya girado, de w×h) dentro de la salida W×H.
 * fit-blur: se ve entero y, si no llena, el mismo vídeo desenfocado de fondo.
 * fill: llena la pantalla recortando lo que sobra.
 */
export function planFraming(clip: Viewable, media: MediaInfo, spec: Pick<OutputSpec, 'width' | 'height'>): FramingPlan {
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

// setparams etiqueta cada fotograma como BT.709: las opciones de salida -color_trc/-color_primaries
// no bastan en ffmpeg reciente si el fotograma llega «sin especificar» (comprobado con la build local).
const VIDEO_TAIL = ['setsar=1', 'format=yuv420p', BT709_SETPARAMS]
const AUDIO_FORMAT = `aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo`

/** Entradas de ffmpeg con su recorte (-ss/-t de entrada); add devuelve el índice de la entrada. */
function createInputs() {
  const args: string[] = []
  let count = 0
  return {
    args,
    add(path: string, startMs: number, lengthMs: number, extra: string[] = []): number {
      args.push(...extra, '-ss', sec(startMs), '-t', sec(lengthMs), '-i', path)
      return count++
    },
  }
}

/** Rangos conservados relativos a la entrada del trozo (la entrada ya empieza en su punto de entrada). */
function relativeSegments(clip: Clip) {
  const io = clipInOut(clip)
  return clip.segments.map((s) => ({ startMs: s.startMs - io.startMs, endMs: s.endMs - io.startMs }))
}

/** Une los rangos conservados del vídeo propio: deja la etiqueta [v{i}seg]. */
function ownSegmentChains(clip: Clip, i: number, input: number): string[] {
  const rel = relativeSegments(clip)
  const vSeg = `v${i}seg`
  if (rel.length <= 1) return [`[${input}:v:0]setpts=PTS-STARTPTS[${vSeg}]`]
  const labels = rel.map((_, j) => `[v${i}s${j}]`)
  return [
    `[${input}:v:0]split=${rel.length}${labels.join('')}`,
    ...rel.map((r, j) => `[v${i}s${j}]trim=start=${sec(r.startMs)}:end=${sec(r.endMs)},setpts=PTS-STARTPTS[v${i}t${j}]`),
    `${rel.map((_, j) => `[v${i}t${j}]`).join('')}concat=n=${rel.length}:v=1:a=0[${vSeg}]`,
  ]
}

/** Tiempos del vídeo propio: velocidad, fps fijos y el número exacto de fotogramas. */
function ownTiming(clip: Clip, fps: number, frames: number): string[] {
  return [
    clip.speed === 1 ? 'setpts=PTS-STARTPTS' : `setpts=(PTS-STARTPTS)/${clip.speed}`,
    `fps=${fps}`,
    // Rellena con el último fotograma si faltara alguno y corta en el número exacto de fotogramas.
    `tpad=stop_mode=clone:stop=${fps}`,
    `trim=end_frame=${frames}`,
  ]
}

/** HDR → SDR y giro. */
function lookFilters(media: MediaInfo, quarterTurns: number): string[] {
  return [...(media.isHdr ? toneMapFilters(media) : []), ...rotationFilters(quarterTurns)]
}

/** [src] → tiempos, aspecto y encuadre (con fondo desenfocado si hace falta) → [out], ya en BT.709. */
function framedChains(
  src: string,
  timing: string[],
  media: MediaInfo,
  view: Viewable,
  spec: Pick<OutputSpec, 'width' | 'height'>,
  prefix: string,
  out: string,
): string[] {
  const look = lookFilters(media, view.quarterTurns)
  const plan = planFraming(view, media, spec)
  if (!plan.background) return [`[${src}]${[...timing, ...look, ...plan.foreground, ...VIDEO_TAIL].join(',')}[${out}]`]
  return [
    `[${src}]${[...timing, ...look, `split=2[${prefix}bgsrc][${prefix}fgsrc]`].join(',')}`,
    `[${prefix}bgsrc]${plan.background.join(',')}[${prefix}bg]`,
    `[${prefix}fgsrc]${plan.foreground.join(',')}[${prefix}fg]`,
    `[${prefix}bg][${prefix}fg]overlay=x=${plan.overlayX}:y=${plan.overlayY}:shortest=1,${VIDEO_TAIL.join(',')}[${out}]`,
  ]
}

/** Dónde se empieza a leer el vídeo de encima (sin pasar de su final menos COVER_SEEK_TAIL_MS). */
export function coverSeekMs(cover: CoverPicture): number {
  return Math.max(0, Math.min(cover.startMs, cover.sourceDurationMs - COVER_SEEK_TAIL_MS))
}

/**
 * Expresión de geq para la máscara de esquinas redondeadas de un recuadro de w×h con radio r:
 * 255 dentro, 0 fuera. Va entre comillas simples: las comas no separan filtros.
 */
export function roundedMaskExpression(radius: number): string {
  const r = Math.max(1, Math.round(radius))
  return `255*lte(pow(max(0,abs(X-(W-1)/2)-(W/2-${r})),2)+pow(max(0,abs(Y-(H-1)/2)-(H/2-${r})),2),${r * r})`
}

/** Cadenas de audio de un trozo, con el número exacto de muestras: deja [a{i}]. */
function audioChains(clip: Clip, media: MediaInfo, i: number, input: number, samples: number): string[] {
  if (!clipKeepsAudio(clip, media)) {
    return [`anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SAMPLE_RATE},atrim=end_sample=${samples},${AUDIO_FORMAT}[a${i}]`]
  }
  const rel = relativeSegments(clip)
  const chains: string[] = []
  const fade = (lenMs: number) =>
    lenMs > EDGE_FADE_MS * 2
      ? [`afade=t=in:d=${sec(EDGE_FADE_MS)}`, `afade=t=out:st=${sec(lenMs - EDGE_FADE_MS)}:d=${sec(EDGE_FADE_MS)}`]
      : []
  const pre = `[${input}:a:0]aresample=${AUDIO_SAMPLE_RATE},${AUDIO_FORMAT}`
  const aSeg = `a${i}seg`
  if (rel.length > 1) {
    const labels = rel.map((_, j) => `[a${i}s${j}]`)
    chains.push(`${pre},asplit=${rel.length}${labels.join('')}`)
    rel.forEach((r, j) => {
      const parts = [`atrim=start=${sec(r.startMs)}:end=${sec(r.endMs)}`, 'asetpts=PTS-STARTPTS', ...fade(r.endMs - r.startMs)]
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
    AUDIO_FORMAT,
  ]
  chains.push(`[${aSeg}]${after.join(',')}[a${i}]`)
  return chains
}

/**
 * Imagen de un trozo según `picture`, con exactamente `frames` fotogramas: deja [v{i}].
 * own: su vídeo · none: fondo liso · cover: el otro vídeo (sin su sonido) desde startMs, en tiempo de salida
 * y a velocidad normal, quieto en su última imagen si se acaba · cover + inset: además, su vídeo en una esquina.
 */
function pictureChains(
  clip: Clip,
  i: number,
  mainInput: number,
  coverInput: number | null,
  media: MediaInfo,
  coverMedia: MediaInfo | null,
  spec: OutputSpec,
  frames: number,
): string[] {
  const F = spec.fps
  const W = spec.width
  const H = spec.height
  const picture = clip.picture

  if (picture.kind === 'none' || (picture.kind === 'own' && !media.hasVideo)) {
    return [`color=c=0x${PLAIN_BACKGROUND_HEX}:s=${W}x${H}:r=${F},trim=end_frame=${frames},${VIDEO_TAIL.join(',')}[v${i}]`]
  }
  if (picture.kind === 'own') {
    return [...ownSegmentChains(clip, i, mainInput), ...framedChains(`v${i}seg`, ownTiming(clip, F, frames), media, clip, spec, `v${i}`, `v${i}`)]
  }

  // Vídeo de encima: setpts a cero, fps fijos y, si se acaba antes, su última imagen repetida.
  const coverTiming = ['setpts=PTS-STARTPTS', `fps=${F}`, `tpad=stop_mode=clone:stop=${frames}`, `trim=end_frame=${frames}`]
  const inset = picture.inset && media.hasVideo ? picture.inset : null
  const coverOut = inset ? `v${i}base` : `v${i}`
  const chains = framedChains(`${coverInput}:v:0`, coverTiming, coverMedia!, picture, spec, `c${i}`, coverOut)
  if (!inset) return chains

  // Su vídeo en pequeño: recorte centrado con la forma del vídeo, esquinas redondeadas y margen.
  const r = insetRect(inset, W, H, true)
  const scaleOpts = 'flags=bicubic:out_color_matrix=bt709:out_range=tv'
  chains.push(...ownSegmentChains(clip, i, mainInput))
  chains.push(
    `[v${i}seg]${[
      ...ownTiming(clip, F, frames),
      ...lookFilters(media, clip.quarterTurns),
      `scale=${r.width}:${r.height}:force_original_aspect_ratio=increase:${scaleOpts}`,
      `crop=${r.width}:${r.height}`,
      'setsar=1',
      'format=yuva420p',
    ].join(',')}[v${i}inset]`,
  )
  // La máscara se calcula una sola vez y se repite (geq por fotograma sería mucho más lento).
  chains.push(
    `color=c=white:s=${r.width}x${r.height}:r=${F},trim=end_frame=1,format=gray,geq=lum='${roundedMaskExpression(r.radius)}',loop=loop=-1:size=1,trim=end_frame=${frames},setpts=N/${F}/TB[v${i}mask]`,
  )
  chains.push(`[v${i}inset][v${i}mask]alphamerge[v${i}insetround]`)
  chains.push(`[v${i}base][v${i}insetround]overlay=x=${r.left}:y=${r.top}:shortest=1,${VIDEO_TAIL.join(',')}[v${i}]`)
  return chains
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
  const inputs = createInputs()
  const chains: string[] = []
  const concatInputs: string[] = []

  project.clips.forEach((clip, i) => {
    const media = lookup(mediaByPath, clip.sourcePath)
    const io = clipInOut(clip)
    const mainInput = inputs.add(clip.sourcePath, io.startMs, io.endMs - io.startMs)
    const frames = clipFrameCount(clip, F)
    const samples = Math.round((frames * AUDIO_SAMPLE_RATE) / F)

    let coverInput: number | null = null
    let coverMedia: MediaInfo | null = null
    if (clip.picture.kind === 'cover') {
      coverMedia = lookup(mediaByPath, clip.picture.sourcePath)
      // Un segundo de más: lo que sobre lo corta trim; si falta, tpad repite la última imagen.
      coverInput = inputs.add(clip.picture.sourcePath, coverSeekMs(clip.picture), (frames * 1000) / F + 1000)
    }

    chains.push(...pictureChains(clip, i, mainInput, coverInput, media, coverMedia, spec, frames))
    chains.push(...audioChains(clip, media, i, mainInput, samples))
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
    ...inputs.args,
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

// ---------------------------------------------------------------------------
// «Solo el sonido»: el mismo camino de audio, sin imagen

/** Muestras del trozo en «Solo el sonido»: su duración exacta (sin redondear a fotogramas). */
export function soundSampleCount(clip: Clip): number {
  return Math.max(1, Math.round((clipOutputMs(clip) * AUDIO_SAMPLE_RATE) / 1000))
}

export interface SoundExportCommand {
  args: string[]
  filterComplex: string
  /** Duración del fichero (suma de las muestras de cada trozo). */
  expectedDurationMs: number
}

/**
 * «Solo el sonido»: M4A (AAC 192 kbps, 48 kHz estéreo, +faststart) con el sonido del montaje entero:
 * mismos cortes, velocidades, silencios y microfundidos que el vídeo. Sin imagen: las entradas van con
 * -vn para no leer ni decodificar el vídeo, y es rápido.
 */
export function buildSoundExportCommand(
  project: Project,
  mediaByPath: MediaLookup,
  outputPath: string,
  options: ExportOptions = {},
): SoundExportCommand {
  if (project.clips.length === 0) throw new Error('El proyecto no tiene trozos que exportar.')
  const inputs = createInputs()
  const chains: string[] = []
  let totalSamples = 0
  project.clips.forEach((clip, i) => {
    const media = lookup(mediaByPath, clip.sourcePath)
    const io = clipInOut(clip)
    const input = inputs.add(clip.sourcePath, io.startMs, io.endMs - io.startMs, ['-vn'])
    const samples = soundSampleCount(clip)
    totalSamples += samples
    chains.push(...audioChains(clip, media, i, input, samples))
  })
  chains.push(`${project.clips.map((_, i) => `[a${i}]`).join('')}concat=n=${project.clips.length}:v=0:a=1[aout]`)
  const filterComplex = chains.join(';\n')
  const args = [
    '-hide_banner',
    '-y',
    '-nostats',
    '-loglevel', 'error',
    '-progress', 'pipe:1',
    ...inputs.args,
    ...(options.filterScriptPath
      ? ['-/filter_complex', options.filterScriptPath]
      : ['-filter_complex', filterComplex]),
    '-map', '[aout]',
    '-vn',
    '-c:a', 'aac',
    '-b:a', `${SOUND_BITRATE_KBPS}k`,
    '-ar', String(AUDIO_SAMPLE_RATE),
    '-ac', '2',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    '-movflags', '+faststart',
    outputPath,
  ]
  return { args, filterComplex, expectedDurationMs: (totalSamples * 1000) / AUDIO_SAMPLE_RATE }
}
