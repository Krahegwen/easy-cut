// Constructor de los argumentos de ffmpeg para exportar el proyecto.
// Siempre un array de argumentos (para spawn/execFile), nunca una cadena para el shell.

import { encoderVideoArgs, type VideoEncoder } from './encoders'
import { effectRect, insetRect, PLAIN_BACKGROUND_HEX } from './layout'
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
  type TrackItem,
  type TrackKind,
  type Viewable,
} from './project'
import { audibleOrVisible, effectiveFades, projectTiming, resolveTracks, type ProjectTiming } from './tracks'

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
  /**
   * Fichero de cada elemento de las pistas (los de la biblioteca, ya descargados). null = no se pone. Sin
   * esta opción, solo los elementos que son ficheros del ordenador.
   */
  itemPath?: (item: TrackItem) => string | null
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
    /** Una entrada con sus opciones tal cual (antes de -i). */
    raw(path: string, options: string[]): number {
      args.push(...options, '-i', path)
      return count++
    },
  }
}

type Inputs = ReturnType<typeof createInputs>

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

/** Cadenas de audio de un trozo, con el número exacto de muestras: deja [a{i}]. `silent` = fila principal silenciada. */
function audioChains(clip: Clip, media: MediaInfo, i: number, input: number, samples: number, silent = false): string[] {
  if (silent || !clipKeepsAudio(clip, media)) {
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

// ---------------------------------------------------------------------------
// Pistas de sonidos y efectos

/** Techo del limitador de la mezcla (lineal): no satura aunque se sumen la voz y la música. */
export const MIX_LIMIT = 0.97

/** Un elemento de las pistas listo para guardarse: su tiempo en el fichero, su ruta y su información. */
export interface PlannedItem {
  item: TrackItem
  kind: TrackKind
  path: string
  media: MediaInfo
  /** Tiempo en el fichero (ms, con los tiempos de fotogramas enteros de cada trozo). */
  startMs: number
  /** Lo que dura dentro del vídeo (lo que sobresale del final se corta). */
  lengthMs: number
}

/**
 * Los elementos que cuentan al guardar: sin pistas silenciadas u ocultas, sin lo que cae fuera del vídeo y
 * solo los que tienen fichero (`itemPath`; los de la biblioteca ya descargados).
 */
export function planTrackItems(
  project: Project,
  mediaByPath: MediaLookup,
  timing: ProjectTiming,
  itemPath: (item: TrackItem) => string | null,
): PlannedItem[] {
  const planned: PlannedItem[] = []
  for (const r of audibleOrVisible(resolveTracks(project, timing))) {
    const path = itemPath(r.item)
    if (!path) continue
    const media = lookup(mediaByPath, path)
    planned.push({ item: r.item, kind: r.track.kind, path, media, startMs: r.startMs, lengthMs: r.shownEndMs - r.startMs })
  }
  return planned
}

/** Ruta de un elemento de fichero (los de la biblioteca necesitan `itemPath`). */
function defaultItemPath(item: TrackItem): string | null {
  return item.source.type === 'file' ? item.source.path : null
}

/** ¿Este elemento suena? Los sonidos con volumen y los efectos que traen sonido y se les ha subido. */
function itemSounds(p: PlannedItem): boolean {
  return p.item.volume > 0 && p.media.hasAudio && !p.item.still
}

/** ¿Se repite el fichero entero? Entonces basta -stream_loop (no hay que guardar la vuelta en memoria). */
function loopsWholeFile(item: TrackItem): boolean {
  return item.inMs <= 0 && item.outMs >= item.sourceDurationMs - 1
}

/** Cadena de sonido de un elemento: recorte, vueltas, volumen, suaves y retraso hasta su sitio. Deja [t{n}]. */
function itemAudioChains(p: PlannedItem, n: number, inputs: Inputs): string[] {
  const item = p.item
  const samples = Math.max(1, Math.round((p.lengthMs * AUDIO_SAMPLE_RATE) / 1000))
  const startSample = Math.max(0, Math.round((p.startMs * AUDIO_SAMPLE_RATE) / 1000))
  const parts: string[] = []
  let input: number
  if (!item.repeat) {
    input = inputs.add(p.path, item.inMs, Math.min(item.outMs - item.inMs, p.lengthMs) + 100, ['-vn'])
    parts.push('asetpts=PTS-STARTPTS', `aresample=${AUDIO_SAMPLE_RATE}`, AUDIO_FORMAT)
  } else if (loopsWholeFile(item)) {
    input = inputs.raw(p.path, ['-vn', '-stream_loop', '-1', '-t', sec(item.phaseMs + p.lengthMs + 500)])
    parts.push(`aresample=${AUDIO_SAMPLE_RATE}`, AUDIO_FORMAT, `atrim=start=${sec(item.phaseMs)}`, 'asetpts=PTS-STARTPTS')
  } else {
    // Un trozo del original que se repite: se guarda una vuelta y aloop la repite.
    const loopSamples = Math.max(1, Math.round(((item.outMs - item.inMs) * AUDIO_SAMPLE_RATE) / 1000))
    input = inputs.add(p.path, item.inMs, item.outMs - item.inMs, ['-vn'])
    parts.push(
      `aresample=${AUDIO_SAMPLE_RATE}`,
      AUDIO_FORMAT,
      `atrim=end_sample=${loopSamples}`,
      `aloop=loop=-1:size=${loopSamples}`,
      'asetpts=N/SR/TB',
      `atrim=start=${sec(item.phaseMs)}`,
      'asetpts=PTS-STARTPTS',
    )
  }
  const fades = effectiveFades(item, p.lengthMs)
  const fadeIn = Math.round((fades.inMs * AUDIO_SAMPLE_RATE) / 1000)
  const fadeOut = Math.round((fades.outMs * AUDIO_SAMPLE_RATE) / 1000)
  parts.push(`apad=whole_len=${samples}`, `atrim=end_sample=${samples}`)
  if (Math.abs(item.volume - 1) > 1e-6) parts.push(`volume=${Number(item.volume.toFixed(3))}`)
  if (fadeIn > 0) parts.push(`afade=t=in:ss=0:ns=${fadeIn}`)
  if (fadeOut > 0) parts.push(`afade=t=out:ss=${samples - fadeOut}:ns=${fadeOut}`)
  if (startSample > 0) parts.push(`adelay=delays=${startSample}S:all=1`)
  return [`[${input}:a:0]${parts.join(',')}[t${n}]`]
}

/**
 * Mezcla el sonido de la fila principal [amain] con los elementos que suenan: amix con normalize=0 (la voz no
 * baja de volumen por añadir música) y un limitador suave al final, con su retraso compensado. Deja
 * exactamente `totalSamples` muestras en [out].
 */
function mixChains(planned: readonly PlannedItem[], inputs: Inputs, totalSamples: number, out: string): string[] {
  const sounding = planned.filter(itemSounds)
  if (sounding.length === 0) return [`[amain]anull[${out}]`]
  const chains = sounding.flatMap((p, n) => itemAudioChains(p, n, inputs))
  const labels = sounding.map((_, n) => `[t${n}]`).join('')
  chains.push(
    `[amain]${labels}amix=inputs=${sounding.length + 1}:normalize=0:duration=first:dropout_transition=0,` +
      `alimiter=limit=${MIX_LIMIT}:level=0:latency=1,apad=whole_len=${totalSamples},atrim=end_sample=${totalSamples},${AUDIO_FORMAT}[${out}]`,
  )
  return chains
}

/** Opciones de entrada para leer la transparencia de un WebM (el decoder nativo de VP9/VP8 la descarta). */
function alphaDecoder(media: MediaInfo): string[] {
  if (!media.hasAlpha) return []
  if (media.videoCodec === 'vp9') return ['-c:v', 'libvpx-vp9']
  if (media.videoCodec === 'vp8') return ['-c:v', 'libvpx']
  return []
}

interface EffectRegion {
  startFrame: number
  endFrame: number
  /** De abajo arriba (la primera, la que va más abajo). */
  effects: { p: PlannedItem; startFrame: number; endFrame: number; layer: number }[]
}

/**
 * Tramos del vídeo con algún efecto (los efectos que se solapan van en el mismo tramo). Solo esos tramos
 * pasan a RGB y se procesan: el resto del vídeo no se toca.
 */
export function effectRegions(planned: readonly PlannedItem[], project: Project, fps: number, totalFrames: number): EffectRegion[] {
  const effectTracks = project.tracks.filter((t) => t.kind === 'effect')
  const layerOf = (item: TrackItem) => effectTracks.length - 1 - effectTracks.findIndex((t) => t.items.some((i) => i.id === item.id))
  const list = planned
    .filter((p) => p.kind === 'effect')
    .map((p) => ({
      p,
      startFrame: Math.min(totalFrames, Math.max(0, Math.round((p.startMs * fps) / 1000))),
      endFrame: Math.min(totalFrames, Math.max(0, Math.round(((p.startMs + p.lengthMs) * fps) / 1000))),
      layer: layerOf(p.item),
    }))
    .filter((e) => e.endFrame > e.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame)
  const regions: EffectRegion[] = []
  for (const e of list) {
    const last = regions[regions.length - 1]
    if (last && e.startFrame < last.endFrame) {
      last.endFrame = Math.max(last.endFrame, e.endFrame)
      last.effects.push(e)
    } else {
      regions.push({ startFrame: e.startFrame, endFrame: e.endFrame, effects: [e] })
    }
  }
  // Dentro de cada tramo, de abajo arriba; a igual pista, por tiempo.
  for (const r of regions) r.effects.sort((a, b) => a.layer - b.layer || a.startFrame - b.startFrame)
  return regions
}

/** Cadena de imagen de un efecto, ya escalado, colocado y desplazado a su instante dentro del tramo: deja [label]. */
function effectChains(
  e: EffectRegion['effects'][number],
  region: EffectRegion,
  inputs: Inputs,
  spec: OutputSpec,
  label: string,
): string[] {
  const { p } = e
  const item = p.item
  const look = item.look!
  const F = spec.fps
  const W = spec.width
  const H = spec.height
  const frames = e.endFrame - e.startFrame
  const lengthMs = (frames * 1000) / F
  const pre: string[] = []
  let input: number
  if (item.still) {
    input = inputs.raw(p.path, ['-loop', '1', '-framerate', String(F), '-t', sec(lengthMs + 500)])
  } else if (item.repeat) {
    // Un efecto que se repite da vueltas al fichero entero (las vueltas no se guardan en memoria).
    input = inputs.raw(p.path, [...alphaDecoder(p.media), '-an', '-stream_loop', '-1', '-t', sec(item.phaseMs + lengthMs + 1000)])
    if (item.phaseMs > 0) pre.push(`trim=start=${sec(item.phaseMs)}`)
  } else {
    input = inputs.add(p.path, item.inMs, Math.min(item.outMs - item.inMs, lengthMs) + 500, [...alphaDecoder(p.media), '-an'])
  }
  const rect = effectRect(look, p.media.width, p.media.height, W, H, true)
  const fades = effectiveFades(item, lengthMs)
  const offset = sec(((e.startFrame - region.startFrame) * 1000) / F)
  const timing = [...pre, 'setpts=PTS-STARTPTS', `fps=${F}`, `tpad=stop_mode=clone:stop=${frames}`, `trim=end_frame=${frames}`]
  const scale = `scale=${rect.width}:${rect.height}:flags=bicubic`
  const tail = [`setpts=PTS-STARTPTS+${offset}/TB`]
  if (look.mix === 'light') {
    // «Como luz»: lo que se ve del recuadro, sobre negro a pantalla completa (el negro no cambia nada en
    // modo screen). La transparencia la pone blend (all_opacity); las suaves, fundiendo a negro.
    const cx = Math.max(0, -rect.left)
    const cy = Math.max(0, -rect.top)
    const cw = Math.min(rect.width, W - rect.left) - cx
    const ch = Math.min(rect.height, H - rect.top) - cy
    if (cw <= 0 || ch <= 0) return []
    const parts = [...timing, scale]
    if (cx > 0 || cy > 0 || cw < rect.width || ch < rect.height) parts.push(`crop=${cw}:${ch}:${cx}:${cy}`)
    if (cw < W || ch < H) parts.push(`pad=${W}:${H}:${Math.max(0, rect.left)}:${Math.max(0, rect.top)}:black`)
    parts.push('format=gbrp')
    if (fades.inMs > 0) parts.push(`fade=t=in:st=0:d=${sec(fades.inMs)}`)
    if (fades.outMs > 0) parts.push(`fade=t=out:st=${sec(lengthMs - fades.outMs)}:d=${sec(fades.outMs)}`)
    return [`[${input}:v:0]${[...parts, ...tail].join(',')}[${label}]`]
  }
  // Normal: encima, con su transparencia; la del efecto y las suaves, en el canal alfa.
  const parts = [...timing, scale, 'format=gbrap']
  if (look.opacity < 1) parts.push(`colorchannelmixer=aa=${Number(look.opacity.toFixed(3))}`)
  if (fades.inMs > 0) parts.push(`fade=t=in:st=0:d=${sec(fades.inMs)}:alpha=1`)
  if (fades.outMs > 0) parts.push(`fade=t=out:st=${sec(lengthMs - fades.outMs)}:d=${sec(fades.outMs)}:alpha=1`)
  return [`[${input}:v:0]${[...parts, ...tail].join(',')}[${label}]`]
}

/**
 * Pone los efectos sobre el vídeo ya montado [vmain] → [out]. El vídeo se parte en tramos: los que no tienen
 * efectos pasan tal cual; los que sí, a RGB (gbrp), con cada efecto encima por orden de pista (overlay para
 * «Normal», blend=screen para «Como luz») y de vuelta a yuv420p BT.709. Cada efecto solo se lee y procesa
 * durante su tramo (empieza con setpts en su instante; fuera, overlay/blend dejan pasar la imagen).
 */
function effectLayerChains(planned: readonly PlannedItem[], project: Project, inputs: Inputs, spec: OutputSpec, totalFrames: number, out: string): string[] {
  const regions = effectRegions(planned, project, spec.fps, totalFrames)
  if (regions.length === 0) return [`[vmain]null[${out}]`]
  type Piece = { startFrame: number; endFrame: number; region: EffectRegion | null }
  const pieces: Piece[] = []
  let cursor = 0
  for (const r of regions) {
    if (r.startFrame > cursor) pieces.push({ startFrame: cursor, endFrame: r.startFrame, region: null })
    pieces.push({ startFrame: r.startFrame, endFrame: r.endFrame, region: r })
    cursor = r.endFrame
  }
  if (cursor < totalFrames) pieces.push({ startFrame: cursor, endFrame: totalFrames, region: null })

  const chains: string[] = []
  const pieceLabels = pieces.map((_, k) => `fxp${k}`)
  const toRgb = 'scale=in_color_matrix=bt709:in_range=tv:flags=bicubic,format=gbrp'
  const toYuv = `scale=out_color_matrix=bt709:out_range=tv:flags=bicubic,${VIDEO_TAIL.join(',')}`
  if (pieces.length === 1) chains.push(`[vmain]null[fxs0]`)
  else chains.push(`[vmain]split=${pieces.length}${pieces.map((_, k) => `[fxs${k}]`).join('')}`)
  pieces.forEach((piece, k) => {
    const trim = pieces.length === 1 ? [] : [`trim=start_frame=${piece.startFrame}:end_frame=${piece.endFrame}`, 'setpts=PTS-STARTPTS']
    if (!piece.region) {
      chains.push(`[fxs${k}]${trim.join(',') || 'null'}[${pieceLabels[k]}]`)
      return
    }
    let base = `fxb${k}_0`
    chains.push(`[fxs${k}]${[...trim, toRgb].join(',')}[${base}]`)
    piece.region.effects.forEach((e, j) => {
      const fx = `fxe${k}_${j}`
      const made = effectChains(e, piece.region!, inputs, spec, fx)
      if (made.length === 0) return
      chains.push(...made)
      const next = `fxb${k}_${j + 1}`
      const look = e.p.item.look!
      if (look.mix === 'light') {
        const opacity = look.opacity < 1 ? `:all_opacity=${Number(look.opacity.toFixed(3))}` : ''
        chains.push(`[${base}][${fx}]blend=all_mode=screen${opacity}:eof_action=pass:shortest=0[${next}]`)
      } else {
        const rect = effectRect(look, e.p.media.width, e.p.media.height, spec.width, spec.height, true)
        chains.push(`[${base}][${fx}]overlay=x=${rect.left}:y=${rect.top}:format=gbrp:eof_action=pass:shortest=0[${next}]`)
      }
      base = next
    })
    chains.push(`[${base}]${toYuv}[${pieceLabels[k]}]`)
  })
  if (pieces.length === 1) chains.push(`[${pieceLabels[0]}]null[${out}]`)
  else chains.push(`${pieceLabels.map((l) => `[${l}]`).join('')}concat=n=${pieces.length}:v=1:a=0[${out}]`)
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
  // Los elementos de las pistas, con los tiempos que tendrá cada trozo en el fichero (fotogramas enteros).
  const timing = projectTiming(project, project.clips.map((c) => exportedClipDurationMs(c, F)))
  const planned = planTrackItems(project, mediaByPath, timing, options.itemPath ?? defaultItemPath)
  const withTracks = planned.length > 0
  let totalFrames = 0
  let totalSamples = 0

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
    chains.push(...audioChains(clip, media, i, mainInput, samples, project.mainMuted))
    concatInputs.push(`[v${i}][a${i}]`)
    totalFrames += frames
    totalSamples += samples
  })

  if (!withTracks) {
    chains.push(`${concatInputs.join('')}concat=n=${project.clips.length}:v=1:a=1[vout][aout]`)
  } else {
    chains.push(`${concatInputs.join('')}concat=n=${project.clips.length}:v=1:a=1[vmain][amain]`)
    chains.push(...effectLayerChains(planned, project, inputs, spec, totalFrames, 'vout'))
    chains.push(...mixChains(planned, inputs, totalSamples, 'aout'))
  }
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
    chains.push(...audioChains(clip, media, i, input, samples, project.mainMuted))
  })
  // Las pistas de sonido (y el sonido de los efectos) también van en «Solo el sonido».
  const timing = projectTiming(project, project.clips.map((c) => (soundSampleCount(c) * 1000) / AUDIO_SAMPLE_RATE))
  const sounding = planTrackItems(project, mediaByPath, timing, options.itemPath ?? defaultItemPath).filter(itemSounds)
  if (sounding.length === 0) {
    chains.push(`${project.clips.map((_, i) => `[a${i}]`).join('')}concat=n=${project.clips.length}:v=0:a=1[aout]`)
  } else {
    chains.push(`${project.clips.map((_, i) => `[a${i}]`).join('')}concat=n=${project.clips.length}:v=0:a=1[amain]`)
    chains.push(...mixChains(sounding, inputs, totalSamples, 'aout'))
  }
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
