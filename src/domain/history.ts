// Historial deshacer/rehacer genérico por instantáneas (snapshots inmutables).

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  limit: number
}

export const DEFAULT_HISTORY_LIMIT = 100

export function createHistory<T>(initial: T, limit: number = DEFAULT_HISTORY_LIMIT): History<T> {
  return { past: [], present: initial, future: [], limit: Math.max(1, limit) }
}

/** Registra un estado nuevo. Si es el mismo objeto que el actual, no hace nada. */
export function pushState<T>(history: History<T>, next: T): History<T> {
  if (Object.is(next, history.present)) return history
  const past = [...history.past, history.present]
  if (past.length > history.limit) past.splice(0, past.length - history.limit)
  return { ...history, past, present: next, future: [] }
}

/** Sustituye el estado actual sin crear entrada (p. ej. mientras se arrastra un control). */
export function replaceState<T>(history: History<T>, next: T): History<T> {
  if (Object.is(next, history.present)) return history
  return { ...history, present: next }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history
  const past = history.past.slice(0, -1)
  const previous = history.past[history.past.length - 1] as T
  return { ...history, past, present: previous, future: [history.present, ...history.future] }
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history
  const [next, ...future] = history.future as [T, ...T[]]
  return { ...history, past: [...history.past, history.present], present: next, future }
}
