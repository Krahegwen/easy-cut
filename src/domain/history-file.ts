// El historial de deshacer de un vídeo, guardado aparte (`<id>.history.json`) para que deshacer siga
// valiendo tras cerrar la app. Solo vale para el proyecto tal como está guardado: si no coincide (se volvió a
// la copia anterior, se cambió el fichero a mano…), se descarta y se empieza sin deshacer. Puro.

import { createHistory, type History } from './history'
import { parseProject, PROJECT_VERSION, serializeProject, type Project } from './project'

/** Pasos de deshacer (y de rehacer) que se guardan: los más cercanos. */
export const SAVED_HISTORY_STEPS = 30

const HISTORY_FILE_KIND = 'easy-cut-history'

interface HistoryFile {
  kind: typeof HISTORY_FILE_KIND
  version: number
  /** El proyecto de ahora, para saber si el historial es suyo. */
  present: string
  past: string[]
  future: string[]
}

/**
 * Cada paso ya convertido, por objeto: los pasos del historial no cambian nunca (son inmutables), así que al
 * guardar tras cada cambio solo se convierte el nuevo.
 */
const compactCache = new WeakMap<Project, string>()
function compact(p: Project): string {
  let s = compactCache.get(p)
  if (s === undefined) {
    s = JSON.stringify(JSON.parse(serializeProject(p)))
    compactCache.set(p, s)
  }
  return s
}

/** El historial como JSON compacto (cada paso, como el fichero del proyecto). */
export function serializeHistoryFile(history: History<Project>, steps = SAVED_HISTORY_STEPS): string {
  const one = compact
  const file: HistoryFile = {
    kind: HISTORY_FILE_KIND,
    version: PROJECT_VERSION,
    present: one(history.present),
    past: history.past.slice(-steps).map(one),
    future: history.future.slice(0, steps).map(one),
  }
  return JSON.stringify(file)
}

/**
 * El historial guardado, si es del proyecto `present` (comparado tal como se guarda). Los pasos que no se
 * entiendan se descartan con todo lo que hay más allá de ellos (deshacer nunca salta un paso). null si no vale.
 */
export function parseHistoryFile(json: string | null, present: Project, limit?: number): History<Project> | null {
  if (!json) return null
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const f = data as Partial<HistoryFile>
  if (f.kind !== HISTORY_FILE_KIND || typeof f.present !== 'string' || !Array.isArray(f.past) || !Array.isArray(f.future)) return null
  if (f.present !== compact(present)) return null
  const read = (s: unknown): Project | null => {
    if (typeof s !== 'string') return null
    try {
      return parseProject(s)
    } catch {
      return null
    }
  }
  const past: Project[] = []
  for (let i = f.past.length - 1; i >= 0; i--) {
    const p = read(f.past[i])
    if (!p) break
    past.unshift(p)
  }
  const future: Project[] = []
  for (const s of f.future) {
    const p = read(s)
    if (!p) break
    future.push(p)
  }
  const base = createHistory(present, limit)
  return { ...base, past: past.slice(-base.limit), future }
}
