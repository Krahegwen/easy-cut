// Registro de atajos de teclado (parte pura: sin DOM ni Vue, se prueba en Vitest).
//
// Cada pantalla, diálogo o aviso declara una «capa» con sus atajos. Las capas se ordenan por prioridad
// (pantalla < aviso < desplegable < diálogo < error < panel «Teclas») y, a igual prioridad, por orden de
// llegada. Se busca de arriba abajo y se para en la primera capa modal: con un diálogo abierto solo valen
// los suyos. El primer atajo activo que coincide con la tecla es el que se ejecuta.
//
// Las teclas se escriben como `event.key` (en minúscula las letras): 'Space', 'Escape', 'Enter', 'Delete',
// 'Home', 'End', 'ArrowLeft', 'PageUp', 'F1', 'e', '1'… y las combinaciones con Ctrl como 'Ctrl+z' o
// 'Ctrl+Shift+z'. Con teclado español `event.key` ya da la letra impresa; con Ctrl se mira además `code`
// (KeyZ), por si la distribución de teclado no es latina.

export interface Shortcut {
  /** Identificador estable (para las pruebas y el panel). */
  id: string
  /** Teclas que lo disparan (ver arriba). */
  keys: readonly string[]
  /** Cómo se ve la tecla, tal como está impresa en un teclado español: «Espacio», «Esc», «Ctrl C»… */
  label: string
  /** Qué hace, en llano, para el panel «Teclas»: «reproducir o parar». */
  description: string
  run: () => void
  /** ¿Se puede usar ahora? (p. ej. el botón no está desactivado). Por defecto, sí. */
  enabled?: boolean
  /** ¿Se repite al dejar la tecla pulsada? Solo donde no es peligroso (flechas). */
  repeat?: boolean
  /** ¿Vale también con el foco en un cuadro de texto? (F1). */
  inText?: boolean
  /** No sale en el panel «Teclas» (p. ej. la segunda forma de rehacer). */
  hidden?: boolean
}

export interface ShortcutLayer {
  id: string
  /** Mayor = más arriba. Ver LAYER_PRIORITY. */
  priority: number
  /** Si es modal, las capas de debajo no cuentan. */
  modal: boolean
  /** Orden de llegada (lo pone el registro). */
  order: number
  /** Título del grupo en el panel «Teclas». */
  title: string
  /** ¿Está activa ahora? (un diálogo cerrado no cuenta, ni para bloquear las de debajo). */
  active: () => boolean
  shortcuts: () => readonly Shortcut[]
}

export const LAYER_PRIORITY = {
  global: -10,
  screen: 0,
  overlay: 10,
  toast: 15,
  popover: 20,
  dialog: 30,
  preparing: 35,
  error: 40,
  panel: 50,
} as const

/** A qué apunta el foco cuando se pulsa la tecla. */
export type FocusKind =
  /** Un cuadro de texto, un desplegable o algo editable: se está escribiendo. */
  | 'text'
  /** Un deslizador: las flechas, Inicio y Fin son suyas. */
  | 'range'
  /** Un botón al que se ha llegado con el teclado (Tab): Intro lo pulsa, como siempre. */
  | 'button-keyboard'
  /** Un botón que se ha pulsado con el ratón (se queda con el foco): no debe volver a pulsarse con una tecla. */
  | 'button-mouse'
  | 'other'

export interface KeyInput {
  key: string
  code: string
  ctrl: boolean
  alt: boolean
  meta: boolean
  shift: boolean
  repeat: boolean
  focus: FocusKind
}

export type KeyDecision =
  | { action: 'run'; shortcut: Shortcut; layer: ShortcutLayer }
  /** Esc en un cuadro de texto: se le quita el foco. */
  | { action: 'blur' }
  /** No se hace nada; `preventDefault` dice si hay que evitar lo que haría el navegador. */
  | { action: 'none'; preventDefault: boolean }

const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/** Nombre de la tecla en la notación del registro, o null si no es un atajo posible (Alt, Win…). */
export function comboOf(input: Pick<KeyInput, 'key' | 'code' | 'ctrl' | 'alt' | 'meta' | 'shift'>): string | null {
  // Alt (y AltGr, que llega como Ctrl+Alt) y la tecla Windows nunca son atajos: son para escribir o del sistema.
  if (input.alt || input.meta) return null
  let key = input.key
  if (key === ' ' || key === 'Spacebar') key = 'Space'
  if (key === 'Esc') key = 'Escape'
  if (key === 'Del') key = 'Delete'
  if (key.length === 1) key = key.toLowerCase()
  if (!input.ctrl) return key
  // Con Ctrl: la letra por su posición si event.key no es una letra latina.
  if (!/^[a-z]$/.test(key) && /^Key[A-Z]$/.test(input.code)) key = input.code.slice(3).toLowerCase()
  return `Ctrl+${input.shift ? 'Shift+' : ''}${key}`
}

/** Capas que cuentan ahora, de arriba abajo, hasta la primera modal incluida. */
export function activeLayers(layers: readonly ShortcutLayer[]): ShortcutLayer[] {
  const sorted = layers.filter((l) => l.active()).sort((a, b) => b.priority - a.priority || b.order - a.order)
  const out: ShortcutLayer[] = []
  for (const l of sorted) {
    out.push(l)
    if (l.modal) break
  }
  return out
}

/** Decide qué hacer con una tecla. */
export function resolveKey(layers: readonly ShortcutLayer[], input: KeyInput): KeyDecision {
  const combo = comboOf(input)
  if (combo === null) return { action: 'none', preventDefault: false }
  const typing = input.focus === 'text'

  let found: { shortcut: Shortcut; layer: ShortcutLayer } | null = null
  let disabledMatch = false
  for (const layer of activeLayers(layers)) {
    for (const s of layer.shortcuts()) {
      if (!s.keys.includes(combo)) continue
      if (typing && !s.inText) continue
      if (s.enabled === false) {
        disabledMatch = true
        continue
      }
      found = { shortcut: s, layer }
      break
    }
    if (found) break
  }

  if (typing) {
    if (found) return { action: 'run', ...found }
    // Esc saca del cuadro de texto; el resto de teclas son del texto (también Ctrl+C, Ctrl+V, Ctrl+Z…).
    if (combo === 'Escape') return { action: 'blur' }
    return { action: 'none', preventDefault: false }
  }

  // En un deslizador, las flechas, Inicio y Fin lo mueven a él.
  if (input.focus === 'range' && NAVIGATION_KEYS.has(combo)) return { action: 'none', preventDefault: false }

  // Intro en un botón al que se ha llegado con Tab lo pulsa, salvo en un diálogo (que decide su opción segura).
  if (combo === 'Enter' && input.focus === 'button-keyboard' && !(found?.layer.modal ?? false)) {
    return { action: 'none', preventDefault: false }
  }

  if (found) {
    // Dejar la tecla pulsada no repite lo peligroso (Supr, partir…); tampoco deja que el navegador actúe.
    if (input.repeat && !found.shortcut.repeat) return { action: 'none', preventDefault: true }
    return { action: 'run', ...found }
  }

  if (disabledMatch) return { action: 'none', preventDefault: true }
  // Espacio nunca desplaza la pantalla ni pulsa un botón que se tocó con el ratón; con Tab, sí lo pulsa.
  if (combo === 'Space') return { action: 'none', preventDefault: input.focus !== 'button-keyboard' }
  // Intro tampoco vuelve a pulsar el último botón que se tocó con el ratón.
  if (combo === 'Enter' && input.focus === 'button-mouse') return { action: 'none', preventDefault: true }
  if (combo === 'F1') return { action: 'none', preventDefault: true }
  return { action: 'none', preventDefault: false }
}

/** Lo que enseña el panel «Teclas»: los atajos de las capas activas (debajo de la que se indique). */
export function listShortcuts(
  layers: readonly ShortcutLayer[],
  options: { exclude?: string } = {},
): { layer: ShortcutLayer; shortcuts: Shortcut[] }[] {
  const visible = layers.filter((l) => l.id !== options.exclude)
  return activeLayers(visible)
    .map((layer) => ({ layer, shortcuts: layer.shortcuts().filter((s) => !s.hidden) }))
    .filter((g) => g.shortcuts.length > 0)
}

/** Registro mutable de capas (una instancia para la ventana). */
export function createShortcutRegistry(onChange: () => void = () => {}) {
  let layers: ShortcutLayer[] = []
  let counter = 0
  function add(layer: Omit<ShortcutLayer, 'order'>): () => void {
    counter += 1
    const full: ShortcutLayer = { ...layer, order: counter }
    layers = [...layers, full]
    onChange()
    return () => {
      layers = layers.filter((l) => l !== full)
      onChange()
    }
  }
  return {
    add,
    layers: () => layers,
    resolve: (input: KeyInput) => resolveKey(layers, input),
  }
}

export type ShortcutRegistry = ReturnType<typeof createShortcutRegistry>
