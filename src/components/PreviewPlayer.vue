<script setup lang="ts">
// Vista previa sin renderizar: un <video> por trozo (el que suena y el siguiente, ya cargado),
// saltando de rango en rango según el plan de reproducción del dominio. Velocidad con playbackRate,
// giro y encuadre con CSS dentro de un marco con la forma del vídeo, y fondo desenfocado barato
// (un lienzo diminuto ampliado con blur) cuando la imagen no llena el marco.
//
// Lo que se ve lo decide la imagen del trozo: su vídeo; el fondo liso con «Solo se oye» (el <video> sigue
// sonando, escondido; también reproduce sin problema un fichero de solo sonido); u otro vídeo encima en un
// segundo <video> silenciado que sigue el tiempo de salida del trozo (se recoloca si se separa más de
// 150 ms y se queda en su última imagen si se acaba). Si el trozo lleva «el vídeo de este trozo» en una pista de
// efectos (en una esquina, o yendo y viniendo de ella con marcas), es su propio <video> el que se coloca encima con
// el sitio y el tamaño de cada instante (boxAt, transform) entre las capas de las pistas (z-index): así va siempre
// a la vez que su sonido, porque es el mismo elemento que marca el reloj del montaje.
//
// Pantalla completa (`fullscreenable`): la raíz del propio reproductor pasa a la capa superior del navegador con
// la Popover API (`popover="manual"` + `showPopover()`), sin moverla en el DOM. Así no se vuelve a montar nada
// (los <video>, el vídeo de encima y las pistas siguen siendo los mismos elementos, en el mismo instante) y la
// capa superior se salta el `container-type` de «Tu vídeo», que con una capa `position: fixed` la dejaría
// encerrada en su columna. Ocupa la ventana, y la ventana se pone a pantalla completa del sistema
// (`setWindowFullscreen`; en el modo de pruebas no). No es la Fullscreen API: WebView2 la rechaza («not
// granted») si la ventana no está activa, que es como corren las pruebas, y no se podría probar.
//
// «Repasar más rápido» (`reviewable`): un factor que solo vive aquí (se pierde al salir de la pantalla, así
// que vuelve solo a 1× al guardar o al reabrir) y multiplica el playbackRate de todo lo que suena: el trozo
// (por su velocidad), el vídeo de encima y las pistas. El reloj del montaje sale del <video> del trozo, así
// que avanza a ese ritmo sin más; la lógica está en `src/domain/playback.ts`.
//
// Transiciones entre trozos: cada trozo montado va en su capa (su vídeo, su vídeo de encima, su fondo liso y su
// fondo desenfocado), y en el paso de uno a otro cada capa lleva la opacidad, el desplazamiento y el tamaño que dice
// `joinAt` (dominio), con el que entra encima; a negro / a blanco, con una capa de color. Con solape, el reloj del
// montaje sigue siendo el <video> del que sale y el que entra (ya montado como «siguiente») se pone a sonar a la
// vez, recolocado si se separa más de 150 ms; al acabar el que sale se sigue con el que entra donde va, sin buscarlo.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildPlaybackPlan,
  clipOutputAt,
  boxAt,
  clipShowsOwnVideo,
  cornerRadius,
  findClipVideoItem,
  FULL_FRAME_SCALE,
  clipStartTimes,
  clipTimeline,
  clipVideoJoinFades,
  computeFramingLayout,
  edgeFades,
  incomingSourceMs,
  joinAt,
  overlapExitOf,
  clipOutputMs,
  coverNeedsResync,
  fadeGainAt,
  coverTimeAt,
  findSpanForSource,
  firstSpanOfClip,
  fitAspect,
  formatClock,
  formatReviewRate,
  hasReachedSpanEnd,
  locatePlayback,
  mediaRate,
  normalizeReviewRate,
  PLAIN_BACKGROUND_CSS,
  playbackTimeAt,
  REVIEW_RATES,
  reviewNotice,
  type Clip,
  type CoverPicture,
  type FramingLayout,
  type Project,
  type ReviewRate,
} from '../domain'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { isLayerCovered, openKeysPanel, useShortcuts } from '../lib/use-shortcuts'
import { store, tracks as tracksStore } from '../store'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'
import type { PanEvent, PlayerTime } from './player-types'
import PositionBar from './PositionBar.vue'
import TrackLayers from './TrackLayers.vue'

const props = withDefaults(
  defineProps<{
    project: Project
    loop?: boolean
    /** Arrastrar la imagen para encuadrar (pestaña Encuadrar). */
    pannable?: boolean
    /** Texto del reloj: posición en el vídeo o en el trozo. */
    clockLabel?: string
    /** Qué se conserva al editar: el instante del vídeo (por defecto) o el del original (al arreglar un trozo). */
    anchor?: 'project' | 'source'
    /** Con las pistas de sonidos y efectos (y la fila principal silenciada si lo está): «Tu vídeo». */
    tracks?: boolean
    /** Con el botón de pantalla completa (y sus teclas mientras dura): «Tu vídeo». */
    fullscreenable?: boolean
    /** Con «Repasar más rápido» (1×, 1,5×, 2×; solo la vista previa): «Tu vídeo». */
    reviewable?: boolean
  }>(),
  {
    loop: false,
    pannable: false,
    clockLabel: 'Posición en el vídeo',
    anchor: 'project',
    tracks: false,
    fullscreenable: false,
    reviewable: false,
  },
)

const emit = defineEmits<{ time: [t: PlayerTime]; pan: [e: PanEvent] }>()

const plan = computed(() => buildPlaybackPlan(props.project))
const spanIndex = ref(0)
const currentMs = ref(0)
const playing = ref(false)
/** «Repasar más rápido»: solo la vista previa, no se guarda en ningún sitio (al volver a montarse, 1×). */
const reviewRate = ref<ReviewRate>(1)
/** Instante del original que se enseña fuera de lo conservado (al mover el cabezal en «Cortar»). */
const freeSourceMs = ref<number | null>(null)
const sourceMs = ref(0)

const stage = ref<HTMLDivElement | null>(null)
const stageSize = ref({ width: 0, height: 0 })
const frame = computed(() => fitAspect(props.project.aspect, stageSize.value.width, stageSize.value.height))

const activeSpan = computed(() => plan.value.spans[spanIndex.value] ?? null)
const activeClipIndex = computed(() => activeSpan.value?.clipIndex ?? 0)
const activeClip = computed<Clip | null>(() => props.project.clips[activeClipIndex.value] ?? null)

/** Trozos con <video> montado: el activo y el siguiente (para que el salto no se note). */
const mountedClips = computed(() => {
  const clips = props.project.clips
  if (clips.length === 0) return []
  const a = Math.min(activeClipIndex.value, clips.length - 1)
  const list = [clips[a]!]
  const next = a + 1 < clips.length ? a + 1 : props.loop && clips.length > 1 ? 0 : -1
  if (next >= 0 && next !== a) list.push(clips[next]!)
  // Si el siguiente empieza su propio paso enseguida (un trozo corto montado entre dos transiciones), el de después
  // también, cargado de antemano: si no, al acabar el activo entraría tarde (medido: hasta medio segundo).
  if (next === a + 1 && next + 1 < clips.length) {
    const starts = clipStartTimes(props.project)
    if (starts[next + 1]! - starts[next]! < 1500) list.push(clips[next + 1]!)
  }
  return list
})
const mountedCovers = computed(() => mountedClips.value.filter((c) => c.picture.kind === 'cover'))

const markers = computed(() => clipStartTimes(props.project).slice(1))

// ------------------------------------------------------------------ transiciones

/** Juntas resueltas de cada trozo (en ms; la de entrada de cada uno). */
const timeline = computed(() => clipTimeline(props.project))
/** La junta cuyo paso contiene el instante de ahora, con cómo se ve cada capa. */
const joinNow = computed(() => joinAt(plan.value, currentMs.value))
/** La junta con solape por la que sale el trozo activo (el siguiente suena a la vez durante el paso). */
const exitJoin = computed(() => overlapExitOf(plan.value, activeClipIndex.value))

/** Papel del trozo en el paso de ahora: el que sale, el que entra o ninguno (solo si los dos están montados). */
function roleOf(clip: Clip): 'out' | 'in' | null {
  const j = joinNow.value
  if (!j) return null
  const i = props.project.clips.indexOf(clip)
  const outClip = props.project.clips[j.join.clipIndex - 1]
  const inClip = props.project.clips[j.join.clipIndex]
  if (!outClip || !inClip) return null
  // Con solape, las dos capas a la vez; si el que sale ya no está montado (acaba de terminar), sin estilo.
  const mounted = mountedClips.value
  if (j.join.join.overlap && !(mounted.includes(outClip) && mounted.includes(inClip))) return null
  if (i === j.join.clipIndex - 1) return 'out'
  if (i === j.join.clipIndex) return 'in'
  return null
}

/** ¿Se ve la imagen de este trozo ahora? El activo y, en un paso con solape, el que entra. */
function clipVisible(clip: Clip): boolean {
  const role = roleOf(clip)
  if (role) return joinNow.value!.style[role].visible
  return clip.id === activeClip.value?.id
}

/** Estilo de la capa de un trozo: opacidad, desplazamiento y tamaño del paso, y el que entra encima. */
function layerStyle(clip: Clip) {
  const role = roleOf(clip)
  const visible = clipVisible(clip)
  if (!role) return { zIndex: clip.id === activeClip.value?.id ? '1' : '0', visibility: visible ? undefined : ('hidden' as const) }
  const l = joinNow.value!.style[role]
  const parts: string[] = []
  if (l.shiftX) parts.push(`translateX(${l.shiftX * frame.value.width}px)`)
  if (l.scale !== 1) parts.push(`scale(${l.scale})`)
  return {
    zIndex: role === 'in' ? '2' : '1',
    opacity: l.opacity < 1 ? String(l.opacity) : undefined,
    transform: parts.length ? parts.join(' ') : undefined,
    visibility: l.visible ? undefined : ('hidden' as const),
  }
}

/** Capa de color de a negro / a blanco (encima de los trozos, debajo de las pistas). */
const joinColor = computed(() => {
  const j = joinNow.value
  if (!j?.style.color || j.style.colorOpacity <= 0.001) return null
  return { background: j.style.color === 'white' ? '#fff' : '#000', opacity: String(j.style.colorOpacity) }
})

/** Volumen del <video> de un trozo: su aparecer / desaparecer (sin el borde con transición) por el del paso. */
function clipVolume(clip: Clip): number {
  const role = roleOf(clip)
  const base = clip.id === activeClip.value?.id ? clipFade.value : 1
  return Math.min(1, Math.max(0, role ? base * joinNow.value!.style[role].volume : base))
}

/** «El vídeo de este trozo» en un paso: el del que sale se desvanece y el del que entra aparece. */
function clipVideoOpacity(clip: Clip): number {
  const i = props.project.clips.indexOf(clip)
  if (i < 0) return 1
  const tl = timeline.value
  const fades = clipVideoJoinFades(tl.joins[i] ?? null, tl.joins[i + 1] ?? null)
  if (fades.fadeInMs <= 0 && fades.fadeOutMs <= 0) return 1
  return fadeGainAt(fades, clipOutputAt(props.project, i, currentMs.value), tl.lengths[i]!)
}

const elements = new Map<string, HTMLVideoElement>()
const coverElements = new Map<string, HTMLVideoElement>()
/** Instante que debe enseñar cada <video> montado (ms del original). */
const desired = new Map<string, number>()

// ------------------------------------------------------------------ qué se ve

function mediaOf(path: string) {
  return store.media.value[path] ?? null
}

function coverOf(clip: Clip | null): CoverPicture | null {
  return clip && clip.picture.kind === 'cover' ? clip.picture : null
}

/** «El vídeo de este trozo» en una pista de efectos que se ve (con otro vídeo de fondo en el trozo). */
function clipVideoOf(clip: Clip) {
  if (clip.picture.kind !== 'cover' || !clip.sourceHasVideo) return null
  const found = findClipVideoItem(props.project, clip.id)
  return found && !found.track.hidden && found.item.look ? found : null
}

/** ¿Se enseña el vídeo del propio trozo (entero, o encima en una pista)? */
function showsOwn(clip: Clip): boolean {
  return (clipShowsOwnVideo(clip) || !!clipVideoOf(clip)) && !!mediaOf(clip.sourcePath)?.hasVideo
}

/** Capa de una pista de efectos (la de más abajo, 1): el orden de apilado con los efectos (z-index). */
function effectLayer(trackId: string): number {
  const order = props.project.tracks.filter((t) => t.kind === 'effect').map((t) => t.id)
  return order.length - order.indexOf(trackId)
}

const activeKind = computed<'own' | 'none' | 'cover' | null>(() => {
  const c = activeClip.value
  if (!c) return null
  if (c.picture.kind === 'cover') return 'cover'
  return showsOwn(c) ? 'own' : 'none'
})

/** Encuadre de la imagen principal del trozo: su vídeo o el vídeo de encima. */
function layoutFor(clip: Clip): FramingLayout | null {
  if (frame.value.width <= 0) return null
  const cover = coverOf(clip)
  if (cover) {
    const m = mediaOf(cover.sourcePath)
    return m ? computeFramingLayout(cover, m, frame.value.width, frame.value.height) : null
  }
  const m = mediaOf(clip.sourcePath)
  if (!m || !showsOwn(clip)) return null
  return computeFramingLayout(clip, m, frame.value.width, frame.value.height)
}

const activeLayout = computed(() => (activeClip.value ? layoutFor(activeClip.value) : null))

function placed(l: FramingLayout) {
  return {
    width: `${l.elementWidth}px`,
    height: `${l.elementHeight}px`,
    left: `${l.left + l.width / 2 - l.elementWidth / 2}px`,
    top: `${l.top + l.height / 2 - l.elementHeight / 2}px`,
    transform: l.rotationDeg ? `rotate(${l.rotationDeg}deg)` : undefined,
  }
}

/**
 * Estilo del <video> del trozo: entero, encima en una pista (el vídeo de este trozo) o escondido (pero sonando).
 * Encima: un recuadro con la forma del marco que lo llena recortando al centro (object-fit: cover, como al
 * guardar), llevado a su sitio y tamaño de este instante con transform; las esquinas redondeadas (el radio se
 * divide por el tamaño, que el transform lo multiplica); oscurecido con el trozo si aparece o desaparece.
 */
function videoStyle(clip: Clip) {
  const cv = clipVideoOf(clip)
  if (cv && showsOwn(clip) && frame.value.width > 0) {
    const W = frame.value.width
    const H = frame.value.height
    const look = cv.item.look!
    const index = props.project.clips.indexOf(clip)
    const local = clip.id === activeClip.value?.id || roleOf(clip) ? clipOutputAt(props.project, index, currentMs.value) : 0
    const box = boxAt(look, local)
    const odd = clip.quarterTurns % 2 === 1
    const w = odd ? H : W
    const h = odd ? W : H
    const radius = box.scale < FULL_FRAME_SCALE ? cornerRadius(look, W, H) / Math.max(0.01, box.scale) : 0
    return {
      width: `${w}px`,
      height: `${h}px`,
      left: `${W / 2 - w / 2}px`,
      top: `${H / 2 - h / 2}px`,
      transform: `translate(${(box.x - 0.5) * W}px, ${(box.y - 0.5) * H}px) scale(${box.scale})${clip.quarterTurns ? ` rotate(${clip.quarterTurns * 90}deg)` : ''}`,
      transformOrigin: 'center',
      objectFit: 'cover' as const,
      borderRadius: `${radius}px`,
      zIndex: String(10 + effectLayer(cv.track.id)),
      filter: clipFade.value < 0.999 && clip.id === activeClip.value?.id ? `brightness(${clipFade.value})` : undefined,
      opacity: String(clipVideoOpacity(clip)),
    }
  }
  if (!coverOf(clip)) {
    const l = layoutFor(clip)
    if (l) return placed(l)
  }
  return { width: '2px', height: '2px', left: '0px', top: '0px' }
}

function videoVisible(clip: Clip): boolean {
  if (clipVideoOf(clip)) return showsOwn(clip) && (clip.id === activeClip.value?.id || !!roleOf(clip))
  return clipVisible(clip) && showsOwn(clip)
}

/** Lo que se ve de un trozo como imagen: su vídeo, el de encima o el fondo liso. */
function kindOf(clip: Clip): 'own' | 'none' | 'cover' {
  if (clip.picture.kind === 'cover') return 'cover'
  return showsOwn(clip) && !clipVideoOf(clip) ? 'own' : 'none'
}

function coverStyle(clip: Clip) {
  const l = layoutFor(clip)
  return l ? placed(l) : { display: 'none' }
}

function isMutedClip(clip: Clip): boolean {
  const m = mediaOf(clip.sourcePath)
  return clip.muted || clip.speed === 4 || !m?.hasAudio || (props.tracks && props.project.mainMuted)
}

function register(clipId: string, el: unknown) {
  if (el instanceof HTMLVideoElement) elements.set(clipId, el)
  else elements.delete(clipId)
}

function registerCover(clipId: string, el: unknown) {
  if (el instanceof HTMLVideoElement) coverElements.set(clipId, el)
  else coverElements.delete(clipId)
}

function configure(el: HTMLVideoElement, clip: Clip, active: boolean) {
  // La velocidad del trozo por la de repaso (si se está repasando más rápido).
  const rate = mediaRate(clip.speed, reviewRate.value)
  el.defaultPlaybackRate = rate
  if (el.playbackRate !== rate) el.playbackRate = rate
  el.preservesPitch = true
  const incoming = !active && roleOf(clip) === 'in'
  el.muted = !(active || incoming) || isMutedClip(clip)
  el.volume = clipVolume(clip)
}

// ------------------------------------------------------------------ aparecer y desaparecer del trozo

/**
 * Factor (0..1) de aparecer y desaparecer del trozo activo en este instante (el mismo cálculo que al guardar):
 * la imagen se oscurece hacia negro con una capa negra encima (debajo de los efectos, como en el fichero) y el
 * sonido baja con el volumen del <video>.
 */
const clipFade = computed(() => {
  const clip = activeClip.value
  if (!clip || (clip.fadeInMs <= 0 && clip.fadeOutMs <= 0)) return 1
  // En un borde con transición manda la transición.
  const i = activeClipIndex.value
  const fades = edgeFades(clip, timeline.value.joins[i] ?? null, timeline.value.joins[i + 1] ?? null)
  return fadeGainAt(fades, clipOutputAt(props.project, i, currentMs.value), clipOutputMs(clip))
})
// El volumen de cada <video> montado sigue al aparecer del trozo y al paso.
watch([clipFade, joinNow], () => {
  for (const clip of mountedClips.value) {
    const el = elements.get(clip.id)
    if (!el) continue
    const v = clipVolume(clip)
    if (Math.abs(el.volume - v) > 0.001) el.volume = v
    const shouldHear = clip.id === activeClip.value?.id || roleOf(clip) === 'in'
    const muted = !shouldHear || isMutedClip(clip)
    if (el.muted !== muted) el.muted = muted
  }
})

/** Lleva un <video> al instante que le toca, si se ha desviado. */
function sync(clip: Clip) {
  const el = elements.get(clip.id)
  const want = desired.get(clip.id)
  if (!el || want === undefined || el.readyState < 1) return
  if (Math.abs(el.currentTime * 1000 - want) > 45) el.currentTime = want / 1000
}

function emitTime() {
  emit('time', { projectMs: currentMs.value, clipIndex: activeClipIndex.value, sourceMs: sourceMs.value, playing: playing.value })
}

/** Un original con imagen que el visor no sabe enseñar (videoWidth 0) pide el proxy si hace falta su imagen. */
function checkDecodable(clip: Clip) {
  const el = elements.get(clip.id)
  if (!el || el.readyState < 1 || store.proxies.value[clip.sourcePath]) return
  if (showsOwn(clip) && el.videoWidth === 0) void store.ensureProxy(clip.sourcePath)
}

/** Prepara los <video> montados: el activo en su instante y el siguiente en su primer fotograma. */
function prepareElements() {
  const active = activeClip.value
  for (const clip of mountedClips.value) {
    const isActive = active?.id === clip.id
    const el = elements.get(clip.id)
    if (!isActive && isIncomingNow(clip)) {
      // El que entra, ya en el paso: lo lleva syncIncoming.
      if (el) configure(el, clip, false)
      continue
    } else if (!isActive) {
      const first = plan.value.spans[firstSpanOfClip(plan.value, props.project.clips.indexOf(clip))]
      if (first) desired.set(clip.id, first.sourceStartMs)
      if (el && !el.paused) el.pause()
      // El vídeo de encima del siguiente, en su primera imagen.
      const cover = coverOf(clip)
      const cel = coverElements.get(clip.id)
      if (cover && cel && cel.readyState >= 1) {
        if (!cel.paused) cel.pause()
        if (Math.abs(cel.currentTime * 1000 - cover.startMs) > 45) cel.currentTime = cover.startMs / 1000
      }
    } else {
      desired.set(clip.id, sourceMs.value)
    }
    if (el) configure(el, clip, isActive)
    sync(clip)
    checkDecodable(clip)
  }
  syncCover(playing.value, true)
  syncIncoming(playing.value, true)
}

// ------------------------------------------------------------------ el que entra (paso con solape)

/** Posición real y esperada del que entra (para las pruebas: data-incoming-ms / data-incoming-expected-ms). */
const incomingActualMs = ref<number | null>(null)
const incomingExpectedMs = ref<number | null>(null)

/**
 * Lo que se adelanta el arranque del que entra (ms del montaje, a 1×): un <video> parado tarda en empezar a avanzar
 * después de play(), y sin esto entraba siempre por detrás. Antes del paso no se ve ni se oye.
 */
const INCOMING_PREROLL_MS = 80

/** Desde cuándo (ms del vídeo) el que entra ya suena (reproduciendo, un poco antes del paso). */
function incomingFromMs(startMs: number): number {
  return playing.value ? startMs - INCOMING_PREROLL_MS * normalizeReviewRate(reviewRate.value) : startMs
}

/** ¿Es este trozo el que entra en un paso con solape que ya ha empezado (o está a punto, reproduciendo)? */
function isIncomingNow(clip: Clip): boolean {
  const ex = exitJoin.value
  return !!ex && props.project.clips[ex.clipIndex]?.id === clip.id && currentMs.value >= incomingFromMs(ex.startMs)
}

/**
 * Lleva el <video> del que entra (y su vídeo de encima) a donde le toca en el paso y lo pone a sonar o en pausa.
 * Reproduciendo, solo se recoloca si se separa más de 150 ms (en tiempo del montaje); en pausa, exacto.
 */
function syncIncoming(play: boolean, exact = false) {
  const ex = exitJoin.value
  const clip = ex ? props.project.clips[ex.clipIndex] : undefined
  const el = clip ? elements.get(clip.id) : undefined
  if (!ex || !clip || !el || currentMs.value < incomingFromMs(ex.startMs)) {
    incomingActualMs.value = null
    incomingExpectedMs.value = null
    return
  }
  if (currentMs.value < ex.startMs) {
    // Justo antes del paso: arranca desde su principio (sin verse ni oírse) para llegar a tiempo.
    configure(el, clip, false)
    if (play && el.paused && el.readyState >= 2) void el.play().catch(() => {})
    return
  }
  const expected = incomingSourceMs(plan.value, ex.clipIndex, currentMs.value)
  incomingExpectedMs.value = Math.round(expected)
  desired.set(clip.id, expected)
  // Sonido y volumen del paso (la velocidad la lleva esto de abajo, que la ajusta para no separarse).
  el.preservesPitch = true
  el.muted = roleOf(clip) !== 'in' || isMutedClip(clip)
  el.volume = clipVolume(clip)
  syncCoverOf(clip, ex.clipIndex, play, exact)
  if (el.readyState < 1) return
  incomingActualMs.value = Math.round(el.currentTime * 1000)
  if (play) {
    if (el.paused && el.readyState >= 2) void el.play().catch(() => {})
  } else if (!el.paused) {
    el.pause()
  }
  if (el.seeking) return
  // Lo que va por delante (+) o por detrás (−), en tiempo del montaje.
  const ahead = (el.currentTime * 1000 - expected) / Math.max(0.01, clip.speed)
  const base = mediaRate(clip.speed, reviewRate.value)
  if (exact ? Math.abs(ahead) > 45 : coverNeedsResync(ahead, 0)) {
    el.currentTime = expected / 1000
    if (el.playbackRate !== base) el.playbackRate = base
    return
  }
  // Por debajo de los 150 ms no se busca (buscar se para un momento y lo deja más atrás): se alcanza acelerando o
  // frenando un 8 % (el tono no cambia) hasta quedar a menos de 25 ms.
  const want = !play || Math.abs(ahead) < 25 ? base : mediaRate(clip.speed * (ahead < 0 ? 1.08 : 0.92), reviewRate.value)
  if (Math.abs(el.playbackRate - want) > 1e-6) el.playbackRate = want
}

// ------------------------------------------------------------------ vídeo de encima

/** Posición real y esperada del vídeo de encima (para las pruebas: data-cover-ms / data-cover-expected-ms). */
const coverActualMs = ref<number | null>(null)
const coverExpectedMs = ref<number | null>(null)

/**
 * Lleva el vídeo de encima del trozo activo a donde le toca (tiempo de salida del trozo, a velocidad normal)
 * y lo pone a sonar o en pausa. Quieto al reproducir si se separa menos de 150 ms; en pausa, exacto.
 */
function syncCover(play: boolean, exact = false) {
  const clip = activeClip.value
  if (!clip || !coverOf(clip) || !coverElements.get(clip.id)) {
    coverActualMs.value = null
    coverExpectedMs.value = null
    return
  }
  syncCoverOf(clip, activeClipIndex.value, play, exact, true)
}

/** Lo mismo para cualquier trozo montado (el activo o el que entra en un paso). `report`: para las pruebas. */
function syncCoverOf(clip: Clip, clipIndex: number, play: boolean, exact = false, report = false) {
  const cover = coverOf(clip)
  const el = coverElements.get(clip.id)
  if (!cover || !el) return
  const outMs = clipOutputAt(props.project, clipIndex, currentMs.value)
  const expected = coverTimeAt(cover, outMs)
  if (report) coverExpectedMs.value = Math.round(expected)
  if (el.readyState < 1) return
  if (report) coverActualMs.value = Math.round(el.currentTime * 1000)
  const endMs = Number.isFinite(el.duration) && el.duration > 0 ? Math.min(el.duration * 1000, cover.sourceDurationMs) : cover.sourceDurationMs
  if (expected >= endMs - 40) {
    // Se ha acabado: quieto en su última imagen.
    if (!el.paused) el.pause()
    if (!el.seeking && el.currentTime * 1000 < endMs - 120) el.currentTime = Math.max(0, endMs / 1000 - 0.03)
    return
  }
  // A velocidad normal dentro del montaje: solo le afecta el repaso.
  const rate = mediaRate(1, reviewRate.value)
  if (el.playbackRate !== rate) {
    el.defaultPlaybackRate = rate
    el.playbackRate = rate
  }
  if (play) {
    if (el.paused && el.readyState >= 2) void el.play().catch(() => {})
  } else if (!el.paused) {
    el.pause()
  }
  if (el.seeking) return
  const actual = el.currentTime * 1000
  if (exact ? Math.abs(actual - expected) > 45 : coverNeedsResync(actual, expected)) el.currentTime = expected / 1000
}

function onCoverMetadata(clip: Clip, e: Event) {
  const el = e.target as HTMLVideoElement
  const cover = coverOf(clip)
  if (cover && !store.proxies.value[cover.sourcePath] && (el.error || el.videoWidth === 0)) {
    void store.ensureProxy(cover.sourcePath)
    return
  }
  el.muted = true
  if (clip.id === activeClip.value?.id) syncCover(playing.value, !playing.value)
  else if (cover) el.currentTime = cover.startMs / 1000
}

function onCoverError(clip: Clip) {
  const cover = coverOf(clip)
  if (cover && !store.proxies.value[cover.sourcePath]) void store.ensureProxy(cover.sourcePath)
}

// ------------------------------------------------------------------ reproducción

let raf = 0

function startLoop() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(tick)
}

function tick() {
  raf = 0
  if (!playing.value) return
  const span = activeSpan.value
  const clip = activeClip.value
  const el = span ? elements.get(span.clipId) : undefined
  if (!span || !clip || !el) {
    raf = requestAnimationFrame(tick)
    return
  }
  if (el.readyState >= 2 && !el.seeking) {
    const src = el.currentTime * 1000
    if (src < span.sourceStartMs - 300 || src > span.sourceEndMs + 300) {
      // Se ha desviado (p. ej. tras un salto): se recoloca en el tramo.
      el.currentTime = Math.min(Math.max(sourceMs.value, span.sourceStartMs), span.sourceEndMs) / 1000
    } else if (hasReachedSpanEnd(span, src, mediaRate(span.speed, reviewRate.value)) || el.ended) {
      advance()
    } else {
      sourceMs.value = src
      currentMs.value = playbackTimeAt(plan.value, spanIndex.value, src)
      if (el.paused) void el.play().catch(() => {})
      syncCover(true)
      syncIncoming(true)
      emitTime()
      if (stopAtMs !== null && currentMs.value >= stopAtMs) {
        stopAtMs = null
        pause()
        return
      }
    }
    paintBackground()
  }
  if (playing.value && !raf) raf = requestAnimationFrame(tick)
}

function advance() {
  const spans = plan.value.spans
  const current = activeSpan.value
  const nextIndex = spanIndex.value + 1
  if (nextIndex >= spans.length) {
    if (props.loop && spans.length > 0) {
      goToSpan(0, true)
    } else {
      pause()
      currentMs.value = plan.value.durationMs
      if (current) sourceMs.value = current.sourceEndMs
      emitTime()
    }
    return
  }
  goToSpan(nextIndex, true)
}

function goToSpan(index: number, keepPlaying: boolean) {
  const span = plan.value.spans[index]
  if (!span) return
  const previousClipId = activeSpan.value?.clipId
  const incoming = elements.get(span.clipId)
  const wasIncoming = keepPlaying && incomingActualMs.value !== null && exitJoin.value?.clipIndex === span.clipIndex && !!incoming && !incoming.paused
  spanIndex.value = index
  sourceMs.value = span.sourceStartMs
  currentMs.value = span.projectStartMs
  if (wasIncoming && incoming) {
    // Ya estaba sonando en el paso: sigue donde va, sin buscarlo otra vez.
    const src = Math.min(Math.max(incoming.currentTime * 1000, span.sourceStartMs), span.sourceEndMs)
    sourceMs.value = src
    currentMs.value = playbackTimeAt(plan.value, index, src)
  }
  if (previousClipId && previousClipId !== span.clipId) pauseClip(previousClipId)
  void activate(keepPlaying)
}

function pauseClip(clipId: string) {
  elements.get(clipId)?.pause()
  coverElements.get(clipId)?.pause()
}

/** Tras cambiar de tramo: el <video> del trozo activo en su sitio y, si toca, sonando. */
async function activate(play: boolean) {
  await nextTick()
  prepareElements()
  const clip = activeClip.value
  if (!clip) return
  const el = elements.get(clip.id)
  if (!el) return
  if (play && playing.value) {
    const start = () => {
      if (playing.value && activeClip.value?.id === clip.id) void el.play().catch(() => {})
    }
    if (el.readyState >= 2) start()
    else el.addEventListener('canplay', start, { once: true })
    startLoop()
  }
  emitTime()
}

function play() {
  const spans = plan.value.spans
  if (spans.length === 0) return
  if (freeSourceMs.value !== null) {
    // Desde un punto que no se conserva: se sigue por el siguiente rango del trozo (o desde el principio).
    const clipIndex = activeClipIndex.value
    const free = freeSourceMs.value
    const idx = spans.findIndex((s) => s.clipIndex === clipIndex && s.sourceEndMs > free + 50)
    freeSourceMs.value = null
    if (idx >= 0) {
      const s = spans[idx]!
      spanIndex.value = idx
      sourceMs.value = Math.max(s.sourceStartMs, free)
      currentMs.value = playbackTimeAt(plan.value, idx, sourceMs.value)
    } else {
      locateAt(0)
    }
  } else if (currentMs.value >= plan.value.durationMs - 60) {
    locateAt(0)
  }
  playing.value = true
  void activate(true)
}

function pause() {
  playing.value = false
  cancelAnimationFrame(raf)
  raf = 0
  for (const el of elements.values()) if (!el.paused) el.pause()
  for (const el of coverElements.values()) if (!el.paused) el.pause()
  syncCover(false, true)
  syncIncoming(false, true)
  emitTime()
}

function toggle() {
  stopAtMs = null
  if (playing.value) pause()
  else play()
}

/** Dónde se para solo (null = hasta el final): «Probar» una transición. */
let stopAtMs: number | null = null

/** Reproduce de `fromMs` a `toMs` y se para ahí («Probar» una transición). */
function playRange(fromMs: number, toMs: number) {
  const d = plan.value.durationMs
  const from = Math.min(Math.max(0, fromMs), d)
  seek(from)
  stopAtMs = Math.min(Math.max(from, toMs), d)
  if (!playing.value) play()
}

function locateAt(projectMs: number) {
  const pos = locatePlayback(plan.value, projectMs)
  if (!pos) return
  spanIndex.value = pos.spanIndex
  sourceMs.value = pos.sourceMs
  currentMs.value = Math.min(Math.max(0, projectMs), plan.value.durationMs)
}

/** Salta a un instante del vídeo (ms). Si estaba sonando, sigue. */
function seek(projectMs: number) {
  freeSourceMs.value = null
  const previousClipId = activeSpan.value?.clipId
  locateAt(projectMs)
  if (previousClipId && previousClipId !== activeSpan.value?.clipId) pauseClip(previousClipId)
  void activate(playing.value)
}

/** Enseña un instante del original del trozo `clipIndex`, aunque no se conserve (pausa la reproducción). */
function showSource(clipIndex: number, ms: number) {
  if (playing.value) pause()
  const idx = findSpanForSource(plan.value, clipIndex, ms)
  if (idx >= 0) {
    freeSourceMs.value = null
    spanIndex.value = idx
    sourceMs.value = ms
    currentMs.value = playbackTimeAt(plan.value, idx, ms)
  } else {
    const first = firstSpanOfClip(plan.value, clipIndex)
    if (first < 0) return
    spanIndex.value = first
    freeSourceMs.value = ms
    sourceMs.value = ms
  }
  void activate(false)
}

// Cuando cambia el proyecto (una edición), se mantiene la posición.
watch(plan, () => {
  if (plan.value.spans.length === 0) {
    pause()
    spanIndex.value = 0
    currentMs.value = 0
    return
  }
  // En «Arreglar este trozo» manda el instante del original: tras «Empieza aquí» la imagen se queda donde
  // estaba (antes saltaba hacia delante lo mismo que se había recortado al principio).
  if (props.anchor === 'source' && !playing.value && freeSourceMs.value === null) freeSourceMs.value = sourceMs.value
  if (freeSourceMs.value !== null) {
    const clipIndex = Math.min(activeClipIndex.value, props.project.clips.length - 1)
    const idx = findSpanForSource(plan.value, clipIndex, freeSourceMs.value)
    if (idx >= 0) {
      spanIndex.value = idx
      freeSourceMs.value = null
      currentMs.value = playbackTimeAt(plan.value, idx, sourceMs.value)
    } else {
      spanIndex.value = Math.max(0, firstSpanOfClip(plan.value, clipIndex))
    }
    void activate(false)
    return
  }
  locateAt(Math.min(currentMs.value, plan.value.durationMs))
  void activate(playing.value)
})

watch(mountedClips, () => void nextTick(prepareElements))
// Al entrar en un paso o salir de él, el otro trozo se pone a sonar (o se para) y su fondo se pinta.
watch(
  () => (joinNow.value ? `${joinNow.value.join.clipIndex}` : ''),
  () =>
    void nextTick(() => {
      syncIncoming(playing.value, !playing.value)
      paintBackground()
    }),
)
// Silenciar la fila principal se oye al momento.
watch(
  () => props.project.mainMuted,
  () => {
    for (const clip of mountedClips.value) {
      const el = elements.get(clip.id)
      if (el) configure(el, clip, clip.id === activeClip.value?.id)
    }
  },
)
// Cambiar la imagen (p. ej. «Empieza en…» o quitar la esquina) no cambia el plan: se recoloca igualmente.
watch(
  () => activeClip.value?.picture,
  () => void nextTick(() => {
    prepareElements()
    paintBackground()
  }),
)

// ------------------------------------------------------------------ eventos de los <video>

function onLoadedMetadata(clip: Clip, e: Event) {
  const el = e.target as HTMLVideoElement
  const m = mediaOf(clip.sourcePath)
  // Un sonido no tiene imagen que comprobar: solo hace falta proxy si el visor no sabe ni reproducirlo.
  const needsPicture = !!m?.hasVideo && showsOwn(clip)
  if (!store.proxies.value[clip.sourcePath] && (el.error || (needsPicture && el.videoWidth === 0))) {
    void store.ensureProxy(clip.sourcePath)
    return
  }
  configure(el, clip, activeClip.value?.id === clip.id)
  sync(clip)
}

function onError(clip: Clip) {
  if (!store.proxies.value[clip.sourcePath]) void store.ensureProxy(clip.sourcePath)
}

function onSeeked(clip: Clip) {
  if (activeClip.value?.id === clip.id && !playing.value) paintBackground()
}

const preparingPreview = computed(() => {
  const clip = activeClip.value
  if (!clip) return false
  const cover = coverOf(clip)
  return store.proxyStatus.value[clip.sourcePath] === 'working' || (!!cover && store.proxyStatus.value[cover.sourcePath] === 'working')
})

// ------------------------------------------------------------------ fondo desenfocado

const BG_WIDTH = 48
const canvases = new Map<string, HTMLCanvasElement>()
function registerCanvas(clipId: string, el: unknown) {
  if (el instanceof HTMLCanvasElement) canvases.set(clipId, el)
  else canvases.delete(clipId)
}

/** Pinta el fondo desenfocado del activo y, en un paso, del otro trozo que se ve. */
function paintBackground() {
  for (const clip of mountedClips.value) if (clip.id === activeClip.value?.id || roleOf(clip)) paintBackgroundOf(clip)
}

function paintBackgroundOf(clip: Clip) {
  const layout = layoutFor(clip)
  const c = canvases.get(clip.id)
  if (!layout?.showsBackground || !c) return
  const cover = coverOf(clip)
  const el = cover ? coverElements.get(clip.id) : elements.get(clip.id)
  const turns = cover ? cover.quarterTurns : clip.quarterTurns
  if (!el || el.readyState < 2) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const W = c.width
  const H = c.height
  const odd = turns % 2 === 1
  const vw = odd ? el.videoHeight : el.videoWidth
  const vh = odd ? el.videoWidth : el.videoHeight
  if (!vw || !vh) return
  const s = Math.max(W / vw, H / vh)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.rotate((turns * Math.PI) / 2)
  const dw = (odd ? vh : vw) * s
  const dh = (odd ? vw : vh) * s
  try {
    ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh)
  } catch {
    // Un fotograma aún no disponible: se pinta en el siguiente.
  }
  ctx.restore()
}

const canvasHeight = computed(() => Math.max(1, Math.round((BG_WIDTH * frame.value.height) / Math.max(1, frame.value.width))))
watch([activeLayout, canvasHeight], () => void nextTick(paintBackground))

// ------------------------------------------------------------------ encuadre arrastrando

let panStart: { x: number; y: number } | null = null
function panDown(e: PointerEvent) {
  if (!props.pannable || e.button !== 0 || !activeLayout.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  panStart = { x: e.clientX, y: e.clientY }
  emit('pan', { phase: 'start', dx: 0, dy: 0, layout: activeLayout.value, frameWidth: frame.value.width, frameHeight: frame.value.height })
}
function panMove(e: PointerEvent) {
  if (!panStart || !activeLayout.value) return
  emit('pan', {
    phase: 'move',
    dx: e.clientX - panStart.x,
    dy: e.clientY - panStart.y,
    layout: activeLayout.value,
    frameWidth: frame.value.width,
    frameHeight: frame.value.height,
  })
}
function panUp(e: PointerEvent) {
  if (!panStart || !activeLayout.value) return
  emit('pan', {
    phase: 'end',
    dx: e.clientX - panStart.x,
    dy: e.clientY - panStart.y,
    layout: activeLayout.value,
    frameWidth: frame.value.width,
    frameHeight: frame.value.height,
  })
  panStart = null
}

// ------------------------------------------------------------------ repasar más rápido

const notice = computed(() => (props.reviewable ? reviewNotice(reviewRate.value) : null))

function setReviewRate(rate: number) {
  if (!props.reviewable) return
  reviewRate.value = normalizeReviewRate(rate)
}

// Cambiar el factor se nota al momento: el trozo que suena, el siguiente y el vídeo de encima.
watch(reviewRate, () => {
  for (const clip of mountedClips.value) {
    const el = elements.get(clip.id)
    if (el) configure(el, clip, clip.id === activeClip.value?.id)
  }
  syncCover(playing.value)
})

// ------------------------------------------------------------------ pantalla completa

const root = ref<HTMLDivElement | null>(null)
const fullscreen = ref(false)
/** Cuándo se salió de la pantalla completa (para que un Esc rezagado no haga además lo de la pantalla). */
let exitedAt = Number.NEGATIVE_INFINITY
const FULLSCREEN_LAYER = 'preview-fullscreen'
const ESC_GRACE_MS = 400
/** ¿Se ha pedido poner la ventana a pantalla completa del sistema (y hay que dejarla como estaba)? */
let windowFullscreenAsked = false
/** Las peticiones a la ventana, en orden: entrar y salir muy seguido no se cruzan. */
let windowQueue: Promise<unknown> = Promise.resolve()

function setWindowFullscreen(on: boolean) {
  windowQueue = windowQueue
    .then(() => store.bridge.setWindowFullscreen(on))
    .catch((err) => console.warn('[easy-cut] no se ha podido cambiar la pantalla completa de la ventana', err))
}

function enterFullscreen() {
  const el = root.value
  if (!props.fullscreenable || !el || fullscreen.value) return
  try {
    // El atributo solo mientras dura: un popover cerrado es `display: none`.
    el.setAttribute('popover', 'manual')
    el.showPopover()
  } catch (err) {
    el.removeAttribute('popover')
    console.warn('[easy-cut] no se ha podido poner la vista previa a pantalla completa', err)
    store.showToast('No se ha podido poner la vista previa a pantalla completa.')
    return
  }
  fullscreen.value = true
  windowFullscreenAsked = true
  setWindowFullscreen(true)
}

function exitFullscreen() {
  if (!fullscreen.value) return
  const el = root.value
  if (el) {
    try {
      if (el.matches(':popover-open')) el.hidePopover()
    } catch {
      // Ya no estaba en la capa superior.
    }
    el.removeAttribute('popover')
  }
  fullscreen.value = false
  exitedAt = performance.now()
  if (windowFullscreenAsked) {
    windowFullscreenAsked = false
    setWindowFullscreen(false)
  }
}

function toggleFullscreen() {
  if (fullscreen.value) exitFullscreen()
  else void enterFullscreen()
}

if (props.fullscreenable) {
  const has = () => props.project.clips.length > 0
  // Mientras dura, solo valen estas (modal): lo de la pantalla de debajo no se ve. Esc sale y nada más.
  useShortcuts({
    id: FULLSCREEN_LAYER,
    title: 'Pantalla completa',
    priority: LAYER_PRIORITY.fullscreen,
    modal: true,
    active: () => fullscreen.value,
    shortcuts: () => [
      { id: 'fullscreen-exit', keys: ['Escape', 'f'], label: 'Esc', description: 'salir de la pantalla completa (también F)', run: exitFullscreen },
      { id: 'fullscreen-play', keys: ['Space'], label: 'Espacio', description: 'reproducir o parar', run: toggle, enabled: has() },
      { id: 'fullscreen-start', keys: ['Home'], label: 'Inicio', description: 'ir al principio', run: () => seek(0), enabled: has() },
      { id: 'fullscreen-end', keys: ['End'], label: 'Fin', description: 'ir al final', run: () => seek(durationMs.value), enabled: has() },
      { id: 'fullscreen-back', keys: ['ArrowLeft'], label: '←', description: '1 segundo atrás', run: () => seek(currentMs.value - 1000), enabled: has(), repeat: true },
      { id: 'fullscreen-forward', keys: ['ArrowRight'], label: '→', description: '1 segundo adelante', run: () => seek(currentMs.value + 1000), enabled: has(), repeat: true },
      // F1 abre la lista; como la tapa, se sale de la pantalla completa (ver abajo) y se ve.
      { id: 'fullscreen-keys', keys: ['F1'], label: 'F1', description: 'ver la lista de teclas (sale de la pantalla completa)', run: openKeysPanel, inText: true },
    ],
  })
  // Justo después de salir, un Esc que llegue tarde (una tecla que se repite, dos pulsaciones) no hace nada más.
  useShortcuts({
    id: `${FULLSCREEN_LAYER}-grace`,
    title: 'Pantalla completa',
    priority: LAYER_PRIORITY.fullscreen,
    active: () => !fullscreen.value && performance.now() - exitedAt < ESC_GRACE_MS,
    shortcuts: () => [{ id: 'fullscreen-esc-grace', keys: ['Escape'], label: 'Esc', description: 'nada (acabas de salir)', run: () => {}, hidden: true }],
  })
}

// Un diálogo, un error o la lista de teclas quedarían tapados por la pantalla completa: se sale para verlos.
const covered = computed(() => fullscreen.value && isLayerCovered(FULLSCREEN_LAYER))
watch(covered, (v) => {
  if (v) exitFullscreen()
})
// Al cambiar de tamaño, el marco se recalcula solo (ResizeObserver); el fondo desenfocado, a pintarlo.
watch(fullscreen, () => void nextTick(paintBackground))

// ------------------------------------------------------------------ montaje

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(() => {
    const el = stage.value
    if (el) stageSize.value = { width: el.clientWidth, height: el.clientHeight }
  })
  if (stage.value) observer.observe(stage.value)
  locateAt(0)
  void activate(false)
})
onBeforeUnmount(() => {
  exitFullscreen()
  observer?.disconnect()
  cancelAnimationFrame(raf)
  stopAtMs = null
  for (const el of [...elements.values(), ...coverElements.values()]) {
    el.pause()
    el.removeAttribute('src')
    el.load()
  }
})

const durationMs = computed(() => plan.value.durationMs)

defineExpose({
  play,
  pause,
  toggle,
  seek,
  playRange,
  showSource,
  playing,
  currentMs,
  durationMs,
  sourceMs,
  fullscreen,
  enterFullscreen,
  exitFullscreen,
  toggleFullscreen,
  reviewRate,
  setReviewRate,
})
</script>

<template>
  <div
    ref="root"
    class="player"
    :class="{ 'is-fullscreen': fullscreen }"
    data-testid="player"
    :data-fullscreen="fullscreen ? '1' : '0'"
    :data-review-rate="reviewRate"
    :data-current-ms="Math.round(currentMs)"
    :data-duration-ms="durationMs"
    :data-playing="playing ? '1' : '0'"
    :data-clip-index="activeClipIndex"
    :data-source-ms="Math.round(sourceMs)"
    :data-picture="activeKind ?? ''"
    :data-cover-ms="coverActualMs ?? ''"
    :data-cover-expected-ms="coverExpectedMs ?? ''"
    :data-main-muted="tracks && project.mainMuted ? '1' : '0'"
    :data-clip-fade="clipFade.toFixed(3)"
    :data-join-progress="joinNow ? joinNow.style.progress.toFixed(3) : ''"
    :data-join-kind="joinNow ? joinNow.join.join.kind : ''"
    :data-incoming-ms="incomingActualMs ?? ''"
    :data-incoming-expected-ms="incomingExpectedMs ?? ''"
  >
    <div ref="stage" class="stage">
      <div
        class="frame"
        :class="{ pannable }"
        :style="{ width: `${frame.width}px`, height: `${frame.height}px` }"
        data-testid="preview-frame"
        @pointerdown="panDown"
        @pointermove="panMove"
        @pointerup="panUp"
        @pointercancel="panUp"
      >
        <!-- Cada trozo montado, en su capa: en un paso, cada una con su opacidad, desplazamiento y tamaño. -->
        <div
          v-for="clip in mountedClips"
          :key="`layer-${clip.id}`"
          class="clip-layer"
          :style="layerStyle(clip)"
          :data-layer-clip="clip.id"
          :data-layer-role="roleOf(clip) ?? ''"
          data-testid="clip-layer"
        >
          <canvas
            v-show="layoutFor(clip)?.showsBackground && clipVisible(clip)"
            :ref="(el) => registerCanvas(clip.id, el)"
            class="background"
            :width="BG_WIDTH"
            :height="canvasHeight"
            aria-hidden="true"
          />
          <video
            v-if="clip.picture.kind === 'cover'"
            :key="`cover-${clip.id}`"
            :ref="(el) => registerCover(clip.id, el)"
            class="video cover"
            :class="{ hidden: !clipVisible(clip) }"
            :src="store.mediaSrc(coverOf(clip)?.sourcePath ?? '')"
            :style="coverStyle(clip)"
            data-testid="cover-video"
            muted
            preload="auto"
            playsinline
            disablepictureinpicture
            disableremoteplayback
            @loadedmetadata="onCoverMetadata(clip, $event)"
            @error="onCoverError(clip)"
            @seeked="onSeeked(clip)"
          />
          <div
            v-if="kindOf(clip) === 'none' && clipVisible(clip)"
            class="plain"
            :style="{ background: PLAIN_BACKGROUND_CSS }"
            data-testid="preview-sound-only"
          >
            <span class="plain-icon" :class="{ playing }"><AppIcon name="wave" :size="56" /></span>
            <span class="plain-text">Solo se oye</span>
          </div>
          <video
            v-if="!clipVideoOf(clip)"
            :key="clip.id"
            :ref="(el) => register(clip.id, el)"
            class="video"
            :class="{ hidden: !videoVisible(clip) }"
            data-clip-video=""
            :data-clip-id="clip.id"
            :src="store.mediaSrc(clip.sourcePath)"
            :style="videoStyle(clip)"
            preload="auto"
            playsinline
            disablepictureinpicture
            disableremoteplayback
            @loadedmetadata="onLoadedMetadata(clip, $event)"
            @error="onError(clip)"
            @seeked="onSeeked(clip)"
          />
        </div>
        <!-- «El vídeo de este trozo»: su propio <video>, encima, entre las capas de las pistas (z-index). -->
        <template v-for="clip in mountedClips" :key="`inset-${clip.id}`">
          <video
            v-if="clipVideoOf(clip)"
            :ref="(el) => register(clip.id, el)"
            class="video inset"
            :class="{ hidden: !videoVisible(clip) }"
            :data-clip-video="clipVideoOf(clip)?.item.id ?? ''"
            :data-clip-id="clip.id"
            :src="store.mediaSrc(clip.sourcePath)"
            :style="videoStyle(clip)"
            preload="auto"
            playsinline
            disablepictureinpicture
            disableremoteplayback
            @loadedmetadata="onLoadedMetadata(clip, $event)"
            @error="onError(clip)"
            @seeked="onSeeked(clip)"
          />
        </template>
        <div v-if="clipFade < 0.999" class="clip-fade" :style="{ opacity: String(1 - clipFade) }" data-testid="clip-fade" aria-hidden="true" />
        <div v-if="joinColor" class="join-color" :style="joinColor" data-testid="join-color" aria-hidden="true" />
        <TrackLayers
          v-if="tracks && frame.width > 0"
          :project="project"
          :current-ms="currentMs"
          :playing="playing"
          :frame-width="frame.width"
          :frame-height="frame.height"
          :rate="reviewRate"
        />
        <div v-if="project.clips.length === 0" class="empty">Aquí verás tu vídeo</div>
        <div v-if="notice" class="review-notice" role="status" data-testid="review-notice">
          <AppIcon name="speed" :size="20" />
          {{ notice }}
        </div>
        <div v-if="preparingPreview" class="notice">
          <span class="spinner" />
          Preparando la vista previa…
        </div>
        <div class="overlay-layer"><slot name="overlay" /></div>
      </div>
    </div>
    <div class="controls">
      <button
        class="play"
        type="button"
        :aria-label="playing ? 'Pausa' : 'Reproducir'"
        :disabled="project.clips.length === 0"
        data-testid="play-toggle"
        @click="toggle"
      >
        <AppIcon :name="playing ? 'pause' : 'play'" :size="26" />
        <span>{{ playing ? 'Pausa' : 'Reproducir' }}</span>
        <KeyHint k="Espacio" />
      </button>
      <span class="clock" data-testid="player-clock">{{ formatClock(currentMs) }} / {{ formatClock(durationMs) }}</span>
      <PositionBar
        :value="currentMs"
        :max="durationMs"
        :markers="markers"
        :label="clockLabel"
        @seek="seek"
      />
      <div
        v-if="reviewable"
        class="review"
        role="group"
        aria-label="Repasar más rápido: solo cambia cómo lo ves ahora, no el vídeo que se guarda"
        data-testid="review-rate"
      >
        <span class="review-label" aria-hidden="true">Repasar más rápido</span>
        <button
          v-for="r in REVIEW_RATES"
          :key="r"
          class="review-btn"
          :class="{ on: reviewRate === r }"
          type="button"
          :aria-pressed="reviewRate === r"
          :aria-label="r === 1 ? 'Ver a velocidad normal' : `Repasar a ${formatReviewRate(r)}`"
          :data-testid="`review-rate-${r}`"
          @click="setReviewRate(r)"
        >
          {{ formatReviewRate(r) }}
        </button>
      </div>
      <button
        v-if="fullscreenable && !fullscreen"
        class="fs-btn"
        type="button"
        aria-label="Ver a pantalla completa"
        :disabled="project.clips.length === 0"
        data-testid="fullscreen-enter"
        @click="enterFullscreen"
      >
        <AppIcon name="fullscreen" :size="24" />
        <!-- En «Tamaño y sitio» la F es otra cosa (el efecto a pantalla completa): ahí no se dibuja. -->
        <KeyHint v-if="!tracksStore.boxEditing.value" k="F" />
      </button>
      <button v-if="fullscreen" class="fs-btn exit" type="button" data-testid="fullscreen-exit" @click="exitFullscreen">
        <AppIcon name="close" :size="22" />
        <span>Salir</span>
        <KeyHint k="Esc" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--stage);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: grid;
  place-items: center;
  margin: 16px 16px 0;
}
.frame {
  position: relative;
  overflow: hidden;
  background: #000;
  border-radius: 6px;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.08);
}
.frame.pannable {
  cursor: grab;
  touch-action: none;
}
.frame.pannable:active {
  cursor: grabbing;
}
.background {
  position: absolute;
  inset: -8%;
  width: 116%;
  height: 116%;
  filter: blur(22px) brightness(0.8) saturate(1.1);
}
.video {
  position: absolute;
  object-fit: fill;
  transform-origin: 50% 50%;
  pointer-events: none;
}
.overlay-layer {
  position: absolute;
  inset: 0;
  z-index: 50;
  pointer-events: none;
}
.overlay-layer > :deep(*) {
  pointer-events: auto;
}
.clip-fade {
  position: absolute;
  z-index: 3;
  inset: 0;
  background: #000;
  pointer-events: none;
}
/* Cada trozo montado, en su capa (debajo del negro de aparecer, del color del paso y de las pistas). */
.clip-layer {
  position: absolute;
  inset: 0;
  background: #000;
  transform-origin: 50% 50%;
  pointer-events: none;
}
.join-color {
  position: absolute;
  z-index: 4;
  inset: 0;
  pointer-events: none;
}
.video.inset {
  /* Encima, como al guardar: sin sombra (el fichero no la lleva). */
  box-shadow: none;
}
.video.hidden {
  visibility: hidden;
}
.plain {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgb(255 255 255 / 0.6);
}
.plain-icon {
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.06);
}
.plain-icon.playing {
  animation: breathe 1.6s ease-in-out infinite;
}
.plain-text {
  font-size: 20px;
  font-weight: 600;
}
@keyframes breathe {
  50% {
    transform: scale(1.08);
    background: rgb(255 255 255 / 0.1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .plain-icon.playing {
    animation: none;
  }
}
.empty {
  position: absolute;
  z-index: 50;
  inset: 0;
  display: grid;
  place-items: center;
  color: rgb(255 255 255 / 0.55);
  font-size: 20px;
}
.notice {
  position: absolute;
  z-index: 50;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-radius: 12px;
  background: rgb(0 0 0 / 0.72);
  color: #fff;
  font-size: 18px;
}
.controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px 12px;
  color: #fff;
}
.play {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  min-width: 156px;
  padding: 0 16px 0 20px;
  border: none;
  border-radius: 26px;
  background: #fff;
  color: var(--stage);
  font-size: 18px;
  font-weight: 650;
  cursor: pointer;
}
.play:hover:not(:disabled) {
  background: #e9eef2;
}
.play:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.clock {
  font-variant-numeric: tabular-nums;
  font-size: 17px;
  white-space: nowrap;
  min-width: 110px;
  color: rgb(255 255 255 / 0.85);
}
/* Pantalla completa: en la capa superior (popover) y ocupando toda la ventana, sin lo que el navegador pone de
   serie a un popover (borde, relleno, tamaño ajustado al contenido y colores del sistema); sin bordes redondeados
   y la imagen con algo más de aire. */
.player.is-fullscreen {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: inherit;
}
.player.is-fullscreen .stage {
  margin: 20px 24px 0;
}
.player.is-fullscreen .controls {
  padding: 12px 24px 18px;
}
/* «Repasar más rápido»: aviso visible mientras dura, para no confundirlo con la velocidad de un trozo. */
.review-notice {
  position: absolute;
  z-index: 50;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 24px);
  padding: 8px 14px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.72);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
.review {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}
.review-label {
  margin-right: 4px;
  font-size: 15px;
  color: rgb(255 255 255 / 0.85);
  white-space: nowrap;
}
.review-btn {
  min-width: 48px;
  min-height: 40px;
  padding: 0 8px;
  border: 2px solid rgb(255 255 255 / 0.35);
  border-radius: 10px;
  background: transparent;
  color: #fff;
  font-size: 16px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.review-btn:hover {
  border-color: rgb(255 255 255 / 0.7);
}
.review-btn.on {
  border-color: #fff;
  background: #fff;
  color: var(--stage);
}
.fs-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 12px;
  border: 2px solid rgb(255 255 255 / 0.35);
  border-radius: 12px;
  background: transparent;
  color: #fff;
  font-size: 17px;
  font-weight: 650;
  cursor: pointer;
}
.fs-btn:hover:not(:disabled) {
  border-color: rgb(255 255 255 / 0.7);
}
.fs-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.fs-btn.exit {
  border-color: #fff;
  background: #fff;
  color: var(--stage);
}
/* Con poco ancho, «Repasar más rápido» se queda en los tres botones (el aviso sigue diciendo qué es). */
@container preview (max-width: 820px) {
  .review-label {
    display: none;
  }
}
/* A pantalla completa hay sitio (las consultas de contenedor siguen mirando la columna de «Tu vídeo»). */
.player.is-fullscreen .review-label {
  display: inline;
}
/* En «Tu vídeo» la vista previa se puede encoger (divisor): baja, los controles ocupan menos alto. */
@container preview (max-height: 340px) {
  .stage {
    margin: 8px 10px 0;
  }
  .controls {
    gap: 10px;
    padding: 6px 12px 8px;
  }
  .play {
    min-height: 42px;
    min-width: 132px;
    font-size: 16px;
  }
  .clock {
    font-size: 16px;
  }
}
</style>
