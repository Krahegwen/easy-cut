// Probar pasando el ratón por encima (biblioteca y «De mi ordenador»): un sonido suena y un efecto se mueve al
// dejar el ratón un momento sobre su tarjeta, sin pulsar. Lógica pura (los temporizadores se inyectan, para los
// tests); la tarjeta dice qué hacer al empezar y al parar.
//
// Reglas:
// - Hace falta quedarse `delayMs` (≈ 400 ms) encima: cruzar la lista con el ratón no hace sonar nada.
// - Uno solo a la vez: entrar en otra tarjeta cancela la espera de la anterior y para lo que estuviera sonando.
// - Salir de la tarjeta corta lo suyo (y, si aún estaba trayendo el fichero, lo cancela: `signal` se aborta con
//   el motivo «leave»).
// - Pulsar el botón de la tarjeta manda (`claim`): lo de pasar por encima se olvida de esa tarjeta hasta que el
//   ratón salga y vuelva, así no se pisa con el botón (y la descarga en marcha no se cancela: la usa el botón).
// - Nada de esto sale del foco del teclado: quien llama decide qué eventos lo disparan (solo el puntero de ratón
//   para los sonidos).

export interface HoverTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** Cuánto hay que quedarse encima para que empiece (cruzar la lista no hace sonar nada). */
export const HOVER_DELAY_MS = 400

/**
 * Un sonido de la biblioteca aún no descargado solo se trae al pasar por encima si es pequeño (lo normal en
 * sonidos cortos: 20–150 kB); uno grande (música) se prueba con el botón. Así cruzar la lista no lanza
 * descargas grandes, y como solo hay una prueba a la vez, como mucho hay una descarga «de pasar por encima».
 */
export const HOVER_FETCH_MAX_BYTES = 600 * 1024

export type HoverAbortReason = 'leave' | 'claimed' | 'released'

export interface HoverHandlers<K> {
  /** Empieza a probar `key`. Si tarda (traer el fichero), mirar `signal` antes de sonar. */
  start(key: K, signal: AbortSignal): void | Promise<void>
  /** Para lo de `key` (solo se llama si había empezado). */
  stop(key: K): void
  /** ¿Se puede probar ahora? Se mira al acabar la espera (p. ej. no, con el vídeo reproduciéndose). */
  allowed?(key: K): boolean
}

export interface HoverPreview<K> {
  enter(key: K): void
  leave(key: K): void
  /** El botón de la tarjeta toma el mando: sin espera pendiente ni prueba de pasar por encima. */
  claim(key: K): void
  /** Lo corta todo (cambio de pestaña, empieza a reproducirse el vídeo, se cierra la biblioteca). */
  release(): void
  /** Lo que está sonando o moviéndose por pasar el ratón (null si nada). */
  readonly active: K | null
  /** Lo que espera a que pase el retardo (null si nada). */
  readonly pending: K | null
}

const realTimers: HoverTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
}

export function createHoverPreview<K>(handlers: HoverHandlers<K>, { delayMs = HOVER_DELAY_MS, timers = realTimers }: { delayMs?: number; timers?: HoverTimers } = {}): HoverPreview<K> {
  let pending: K | null = null
  let timer: unknown = null
  let active: K | null = null
  let controller: AbortController | null = null
  /** La tarjeta cuyo botón se ha pulsado: no vuelve a empezar sola hasta que el ratón salga. */
  let claimed: K | null = null

  function cancelPending() {
    if (timer !== null) timers.clearTimeout(timer)
    timer = null
    pending = null
  }

  function stopActive(reason: HoverAbortReason, callStop = true) {
    if (active === null) return
    const key = active
    const c = controller
    active = null
    controller = null
    c?.abort(reason)
    if (callStop) handlers.stop(key)
  }

  function fire(key: K) {
    timer = null
    pending = null
    if (handlers.allowed && !handlers.allowed(key)) return
    active = key
    controller = new AbortController()
    const signal = controller.signal
    try {
      const r = handlers.start(key, signal)
      if (r && typeof (r as Promise<void>).catch === 'function') {
        ;(r as Promise<void>).catch(() => {
          if (active === key && controller?.signal === signal) {
            active = null
            controller = null
          }
        })
      }
    } catch {
      active = null
      controller = null
    }
  }

  return {
    enter(key) {
      if (claimed !== null && claimed !== key) claimed = null
      if (key === claimed || key === active || key === pending) return
      cancelPending()
      stopActive('leave')
      pending = key
      timer = timers.setTimeout(() => fire(key), delayMs)
    },
    leave(key) {
      if (key === claimed) claimed = null
      if (key === pending) cancelPending()
      if (key === active) stopActive('leave')
    },
    claim(key) {
      cancelPending()
      // Lo que sonaba por pasar el ratón ya no es suyo: el botón decide (lo para o suena lo otro).
      stopActive('claimed', false)
      claimed = key
    },
    release() {
      cancelPending()
      stopActive('released')
    },
    get active() {
      return active
    },
    get pending() {
      return pending
    },
  }
}

/** Qué hacer al pasar por encima de un sonido de la biblioteca: sonar ya, traerlo primero o nada. */
export function hoverSoundPlan(asset: { bytes: number }, downloaded: boolean): 'play' | 'fetch' | 'skip' {
  if (downloaded) return 'play'
  return asset.bytes <= HOVER_FETCH_MAX_BYTES ? 'fetch' : 'skip'
}
