// Atajos de teclado: Ctrl+Z / Ctrl+Y los gestiona App.vue; el resto (espacio, flechas) la pantalla activa.
export type KeyHandler = (e: KeyboardEvent) => boolean

let handler: KeyHandler | null = null

export function setKeyHandler(next: KeyHandler | null) {
  handler = next
}

/** Devuelve true si la pantalla ha usado la tecla. */
export function dispatchKey(e: KeyboardEvent): boolean {
  return handler ? handler(e) : false
}
