// Los vídeos en marcha (la lista de Inicio): nombres por defecto y sin repetir, el resumen de cada uno
// (trozos, duración, de dónde sacar su miniatura) y «cuándo se tocó» en llano. Puro: la fecha y la hora
// llegan de fuera.

import { projectDurationMs } from './durations'
import { clipInOut, MAX_PROJECT_NAME_LENGTH, type Project } from './project'

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

/** Para comparar nombres como lo haría una persona: sin mayúsculas ni espacios de más. */
function nameKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
}

/** «base», o «base (2)», «base (3)»… el primero que no esté ya. */
export function uniqueProjectName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map(nameKey))
  if (!taken.has(nameKey(base))) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`
    if (!taken.has(nameKey(candidate))) return candidate
  }
}

/** «Vídeo del 26 de noviembre» (con la fecha local), con «(2)» si ya hay uno que se llama así. */
export function defaultProjectName(date: Date, existing: readonly string[]): string {
  return uniqueProjectName(`Vídeo del ${date.getDate()} de ${MONTHS[date.getMonth()]}`, existing)
}

/** Nombre de la copia al duplicar: «Boda (copia)», «Boda (copia 2)»… */
export function duplicateProjectName(name: string, existing: readonly string[]): string {
  const base = `${name.replace(/ \(copia(?: \d+)?\)$/, '')} (copia)`
  const taken = new Set(existing.map(nameKey))
  if (!taken.has(nameKey(base))) return base
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, -1)} ${n})`
    if (!taken.has(nameKey(candidate))) return candidate
  }
}

/** Nombre escrito a mano: sin espacios de más y hasta MAX_PROJECT_NAME_LENGTH; null si queda vacío. */
export function cleanProjectName(raw: string): string | null {
  const s = raw.replace(/[\u0000-\u001f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, MAX_PROJECT_NAME_LENGTH).trim()
  return s === '' ? null : s
}

/** Lo que enseña la lista de Inicio de cada vídeo en marcha. */
export interface ProjectSummary {
  id: string
  name: string
  clipCount: number
  durationMs: number
  /** Cuándo se cambió por última vez (ms desde 1970). */
  modifiedMs: number
  /** De dónde sacar la miniatura: el primer trozo con imagen (su primer fotograma); null si no hay. */
  thumb: { path: string; timeMs: number } | null
}

export function summarizeProject(id: string, name: string, project: Project, modifiedMs: number): ProjectSummary {
  const withPicture = project.clips.find((c) => c.picture.kind === 'own' && c.sourceHasVideo) ?? project.clips.find((c) => c.picture.kind === 'cover')
  let thumb: ProjectSummary['thumb'] = null
  if (withPicture) {
    thumb =
      withPicture.picture.kind === 'cover'
        ? { path: withPicture.picture.sourcePath, timeMs: withPicture.picture.startMs }
        : { path: withPicture.sourcePath, timeMs: clipInOut(withPicture).startMs }
  }
  return { id, name, clipCount: project.clips.length, durationMs: projectDurationMs(project), modifiedMs, thumb }
}

/** Lo más reciente primero (y, a igualdad, por nombre). */
export function sortProjectSummaries(list: readonly ProjectSummary[]): ProjectSummary[] {
  return list.slice().sort((a, b) => b.modifiedMs - a.modifiedMs || a.name.localeCompare(b.name, 'es'))
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function hhmm(d: Date): string {
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Cuándo se tocó, en llano: «Hace un momento», «Hace 5 minutos», «Hoy a las 10:30», «Ayer a las 18:05»,
 * «El 3 de noviembre» (y con el año si no es el de ahora).
 */
export function describeTouched(modifiedMs: number, nowMs: number): string {
  const diff = nowMs - modifiedMs
  if (diff < 60_000) return 'Hace un momento'
  if (diff < 60 * 60_000) {
    const m = Math.floor(diff / 60_000)
    return m === 1 ? 'Hace 1 minuto' : `Hace ${m} minutos`
  }
  const when = new Date(modifiedMs)
  const now = new Date(nowMs)
  if (sameDay(when, now)) return `Hoy a las ${hhmm(when)}`
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDay(when, yesterday)) return `Ayer a las ${hhmm(when)}`
  const day = `El ${when.getDate()} de ${MONTHS[when.getMonth()]}`
  return when.getFullYear() === now.getFullYear() ? day : `${day} de ${when.getFullYear()}`
}

/** ¿El vídeo tiene algo? (uno vacío y sin tocar no se guarda en la lista). */
export function projectHasContent(project: Project): boolean {
  return project.clips.length > 0 || project.tracks.some((t) => t.items.length > 0)
}
