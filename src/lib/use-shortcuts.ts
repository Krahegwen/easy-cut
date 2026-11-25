// Atajos de teclado en la interfaz: el registro único de la ventana, el composable con el que cada
// pantalla o diálogo declara los suyos, el único listener de teclado y el panel «Teclas».
import { getCurrentInstance, onBeforeUnmount, ref, shallowRef } from 'vue'
import { createShortcutRegistry, LAYER_PRIORITY, listShortcuts, type FocusKind, type Shortcut } from './shortcuts'

export type { Shortcut } from './shortcuts'

/** Sube cada vez que se añade o quita una capa (para que el panel se vuelva a pintar). */
const layersVersion = shallowRef(0)
export const shortcutRegistry = createShortcutRegistry(() => (layersVersion.value += 1))

export interface UseShortcutsOptions {
  /** Identificador de la capa (pantalla o diálogo). */
  id: string
  /** Título del grupo en el panel «Teclas». */
  title: string
  priority?: number
  modal?: boolean
  /** ¿Está activa? (un diálogo cerrado no). */
  active?: () => boolean
  /** Atajos de ahora (se vuelve a llamar en cada tecla: puede depender del estado). */
  shortcuts: () => readonly Shortcut[]
}

/** Declara una capa de atajos mientras el componente esté montado. */
export function useShortcuts(options: UseShortcutsOptions): void {
  const remove = shortcutRegistry.add({
    id: options.id,
    title: options.title,
    priority: options.priority ?? LAYER_PRIORITY.screen,
    modal: options.modal ?? false,
    active: options.active ?? (() => true),
    shortcuts: options.shortcuts,
  })
  if (getCurrentInstance()) onBeforeUnmount(remove)
}

// ------------------------------------------------------------------ panel «Teclas»

export const keysPanelOpen = ref(false)

export function openKeysPanel() {
  keysPanelOpen.value = true
}
export function closeKeysPanel() {
  keysPanelOpen.value = false
}

/** Grupos de atajos que enseña el panel (los de debajo del propio panel). */
export function panelGroups() {
  void layersVersion.value
  return listShortcuts(shortcutRegistry.layers(), { exclude: 'keys-panel' })
}

// Capa de toda la app: F1 abre el panel desde cualquier sitio (también escribiendo).
shortcutRegistry.add({
  id: 'global',
  title: 'En toda la app',
  priority: LAYER_PRIORITY.global,
  modal: false,
  active: () => true,
  shortcuts: () => [{ id: 'keys-panel', keys: ['F1'], label: 'F1', description: 'ver esta lista de teclas', run: openKeysPanel, inText: true }],
})

// ------------------------------------------------------------------ el listener

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week'])

/** A qué apunta el foco: ¿se está escribiendo?, ¿es un botón?, ¿se llegó a él con el teclado? */
export function focusKindOf(el: Element | null): FocusKind {
  if (!(el instanceof HTMLElement)) return 'other'
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return 'text'
  if (el instanceof HTMLInputElement) {
    if (el.type === 'range') return 'range'
    if (TEXT_INPUT_TYPES.has(el.type)) return 'text'
  }
  const button = el.closest('button, a[href], [role=button], [role=tab], [role=radio], [role=switch], input')
  if (button) return keyboardFocused === button || keyboardFocused === el ? 'button-keyboard' : 'button-mouse'
  return 'other'
}

// Cómo llegó el foco al elemento: con Tab (teclado) o de otra forma (ratón, programa). No vale
// :focus-visible: Chromium la activa en cuanto se pulsa cualquier tecla, también sobre un botón que se tocó
// con el ratón, y entonces Intro volvería a pulsar el último botón tocado.
let keyboardFocused: Element | null = null
let tabbing = false

function onFocusIn(e: FocusEvent) {
  keyboardFocused = tabbing ? (e.target as Element | null) : null
}

/** Teclas cuyo keyup también hay que comerse (el navegador pulsa el botón al soltar el espacio). */
let swallowKeyUp: string | null = null

function onKeyDown(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Tab') {
    tabbing = true
    return
  }
  const target = (document.activeElement ?? e.target) as Element | null
  const decision = shortcutRegistry.resolve({
    key: e.key,
    code: e.code,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    meta: e.metaKey,
    shift: e.shiftKey,
    repeat: e.repeat,
    focus: focusKindOf(target),
  })
  if (decision.action === 'blur') {
    e.preventDefault()
    ;(target as HTMLElement | null)?.blur?.()
    return
  }
  if (decision.action === 'none') {
    if (decision.preventDefault) {
      e.preventDefault()
      swallowKeyUp = e.key
    }
    return
  }
  e.preventDefault()
  e.stopPropagation()
  swallowKeyUp = e.key
  try {
    decision.shortcut.run()
  } catch (err) {
    console.error(`[easy-cut] el atajo «${decision.shortcut.label}» ha fallado`, err)
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Tab') tabbing = false
  if (swallowKeyUp !== null && e.key === swallowKeyUp) {
    swallowKeyUp = null
    e.preventDefault()
    e.stopPropagation()
  }
}

/** Instala el único listener de teclado de la ventana. Devuelve cómo quitarlo. */
export function installShortcutListener(): () => void {
  // En captura: decide antes que cualquier botón con foco.
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('focusin', onFocusIn, true)
  const onPointer = () => (tabbing = false)
  window.addEventListener('pointerdown', onPointer, true)
  return () => {
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onKeyUp, true)
    window.removeEventListener('focusin', onFocusIn, true)
    window.removeEventListener('pointerdown', onPointer, true)
  }
}

/** Para las pruebas (solo desarrollo): los atajos que valen ahora. */
export function describeActiveShortcuts() {
  return listShortcuts(shortcutRegistry.layers()).flatMap((g) =>
    g.layer.shortcuts().map((s) => ({ layer: g.layer.id, id: s.id, label: s.label, keys: [...s.keys], enabled: s.enabled !== false, hidden: !!s.hidden })),
  )
}
