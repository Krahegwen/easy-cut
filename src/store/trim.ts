// «Solo recortar»: el vídeo elegido, lo marcado (principio y final), cómo se guarda («Rápido» o «Exacto») y el
// fotograma clave desde el que copiaría «Rápido». No toca el vídeo abierto de «Tu vídeo» hasta «Convertir en
// un vídeo normal», que empieza uno nuevo (el abierto se queda guardado en la lista).

import { computed, ref, shallowRef } from 'vue'
import {
  copyProblem,
  fullRange,
  keyframeAtOrBefore,
  planCopy,
  setTrimIn,
  setTrimOut,
  trimProject,
  type CopyPlan,
  type MediaInfo,
  type TrimMode,
  type TrimRange,
} from '../domain'
import type { EditorStore } from './editor'
import type { SaveFlow } from './save-flow'

/** El fotograma clave de un punto: aún buscándolo, el que es (null = ninguno antes) o que no se ha podido. */
type KeyframeState = { status: 'working' } | { status: 'ready'; keyframeMs: number | null } | { status: 'error' }

/** Espera tras el último cambio del principio antes de mirar su fotograma clave (ms). */
const KEYFRAME_DELAY_MS = 150

export function createTrimStore(store: EditorStore, saveFlow: SaveFlow) {
  const info = shallowRef<MediaInfo | null>(null)
  const range = ref<TrimRange>({ inMs: 0, outMs: 0 })
  const mode = ref<TrimMode>('copy')
  /** Por dónde va la vista previa (la pone la pantalla; E y T la usan). */
  const playheadMs = ref(0)
  /** Fotograma clave de cada principio ya mirado (por ms del principio). */
  const keyframes = shallowRef<Record<number, KeyframeState>>({})
  const pending = new Map<string, Promise<number | null | 'error'>>()

  const durationMs = computed(() => info.value?.durationMs ?? 0)
  /** Por qué no se ofrece «Rápido» con este vídeo (null = sí se ofrece). */
  const copyBlocked = computed(() => (info.value ? copyProblem(info.value) : null))
  const keyframe = computed<KeyframeState>(() => {
    if (range.value.inMs === 0) return { status: 'ready', keyframeMs: 0 }
    return keyframes.value[range.value.inMs] ?? { status: 'working' }
  })
  /** Lo que copiaría «Rápido» ahora (null mientras se mira el fotograma clave o si no se ha podido). */
  const plan = computed<CopyPlan | null>(() => {
    const k = keyframe.value
    if (k.status !== 'ready' || !info.value) return null
    return planCopy(range.value, k.keyframeMs, info.value.fps)
  })
  /** ¿Se puede guardar «Rápido»? (el formato vale y se sabe desde dónde copiaría). */
  const copyAvailable = computed(() => !copyBlocked.value && keyframe.value.status !== 'error')
  /** Modo con el que se guardará de verdad: «Exacto» si «Rápido» no vale. */
  const effectiveMode = computed<TrimMode>(() => (mode.value === 'copy' && copyAvailable.value ? 'copy' : 'exact'))

  function setKeyframe(inMs: number, state: KeyframeState) {
    keyframes.value = { ...keyframes.value, [inMs]: state }
  }

  /** Mira (una vez por principio) el fotograma clave en el principio marcado o antes. */
  function ensureKeyframe(): Promise<number | null | 'error'> {
    const media = info.value
    const inMs = range.value.inMs
    if (!media || inMs === 0) return Promise.resolve(0)
    const known = keyframes.value[inMs]
    if (known?.status === 'ready') return Promise.resolve(known.keyframeMs)
    if (known?.status === 'error') return Promise.resolve('error')
    const key = `${media.path}|${inMs}`
    let p = pending.get(key)
    if (!p) {
      setKeyframe(inMs, { status: 'working' })
      p = (async () => {
        try {
          let k = keyframeAtOrBefore(await store.bridge.keyframes(media.path, inMs), inMs)
          // La ventana de 30 s no ha dado ninguno (raro): desde el principio.
          if (k === null) k = keyframeAtOrBefore(await store.bridge.keyframes(media.path, inMs, true), inMs)
          if (info.value === media) setKeyframe(inMs, { status: 'ready', keyframeMs: k })
          return k
        } catch (e) {
          console.warn('[easy-cut] no se han podido leer los fotogramas clave', e)
          if (info.value === media) setKeyframe(inMs, { status: 'error' })
          return 'error' as const
        } finally {
          pending.delete(key)
        }
      })()
      pending.set(key, p)
    }
    return p
  }

  /**
   * «Solo recortar un vídeo» (Inicio): elige un vídeo y abre la pantalla con el vídeo entero marcado. Devuelve
   * false si se cancela o no vale (con el aviso ya enseñado).
   */
  async function begin(): Promise<boolean> {
    let paths: string[]
    try {
      paths = await store.bridge.pickVideos({ multiple: false, title: 'Elige el vídeo que quieres recortar' })
    } catch (e) {
      store.showError('No se ha podido abrir la ventana para elegir el vídeo.', e)
      return false
    }
    const path = paths[0]
    if (!path) return false
    return openFile(path)
  }

  /** Abre la pantalla con este fichero (también para soltar uno en Inicio, si algún día se quiere). */
  async function openFile(path: string): Promise<boolean> {
    let media: MediaInfo
    try {
      media = store.media.value[path] ?? (await store.bridge.probe(path))
    } catch (e) {
      store.showError('No he podido leer ese vídeo.', e)
      return false
    }
    if (!media.hasVideo || media.width <= 0 || media.height <= 0) {
      store.showToast('Ese fichero no tiene imagen: para recortar, elige un vídeo.')
      return false
    }
    if (!(media.durationMs > 0)) {
      store.showToast('Ese vídeo no dura nada: elige otro.')
      return false
    }
    store.setMedia(media)
    info.value = media
    range.value = fullRange(media.durationMs)
    mode.value = 'copy'
    playheadMs.value = 0
    keyframes.value = {}
    store.go('trim')
    return true
  }

  /** Al arrastrar el principio cambia muchas veces seguidas: se mira el fotograma clave cuando se para. */
  let keyframeTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleKeyframe() {
    if (keyframeTimer) clearTimeout(keyframeTimer)
    keyframeTimer = setTimeout(() => {
      keyframeTimer = null
      void ensureKeyframe()
    }, KEYFRAME_DELAY_MS)
  }

  function setIn(atMs: number = playheadMs.value) {
    if (!info.value) return
    range.value = setTrimIn(range.value, atMs, info.value.durationMs)
    scheduleKeyframe()
  }

  function setOut(atMs: number = playheadMs.value) {
    if (!info.value) return
    range.value = setTrimOut(range.value, atMs, info.value.durationMs)
    scheduleKeyframe()
  }

  function setRange(next: TrimRange) {
    if (!info.value) return
    range.value = next
    scheduleKeyframe()
  }

  /** «Guardar»: con «Rápido», espera a saber desde qué fotograma clave copia; si no se puede, «Exacto». */
  async function save() {
    const media = info.value
    if (!media || saveFlow.running.value) return
    let useMode = effectiveMode.value
    let copyPlan = plan.value
    if (useMode === 'copy') {
      const k = await ensureKeyframe()
      if (k === 'error') {
        useMode = 'exact'
      } else {
        copyPlan = planCopy(range.value, k, media.fps)
      }
    }
    const fallback = planCopy(range.value, range.value.inMs, media.fps)
    await saveFlow.startTrim({ info: media, range: { ...range.value }, mode: useMode, plan: copyPlan ?? fallback })
  }

  /**
   * «Convertir en un vídeo normal»: un vídeo nuevo de la lista con este trozo ya recortado, abierto en «Tu
   * vídeo». El que hubiera abierto se queda guardado.
   */
  async function convert() {
    const media = info.value
    if (!media) return
    await store.startProjectFrom(trimProject(media, range.value), [media])
    store.go('editor')
    store.showToast('Ya es un vídeo normal: está en «Tu vídeo» y en la lista de Inicio.')
  }

  /** Volver a Inicio sin guardar nada (el original no se ha tocado). */
  function close() {
    store.go('home')
  }

  return {
    info,
    range,
    mode,
    playheadMs,
    durationMs,
    copyBlocked,
    copyAvailable,
    keyframe,
    plan,
    effectiveMode,
    ensureKeyframe,
    begin,
    openFile,
    setIn,
    setOut,
    setRange,
    save,
    convert,
    close,
  }
}

export type TrimStore = ReturnType<typeof createTrimStore>
