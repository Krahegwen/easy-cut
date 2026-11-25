// Duraciones del trozo y del vídeo, y cómo decirlas en castellano llano.

import { clipOutputMs, type Clip, type Project } from './project'

export function clipDurationMs(clip: Clip): number {
  return clipOutputMs(clip)
}

export function projectDurationMs(project: Project): number {
  return project.clips.reduce((sum, c) => sum + clipOutputMs(c), 0)
}

export interface TargetStatus {
  targetMs: number
  totalMs: number
  /** Positivo si sobra (se pasa del objetivo), negativo si aún queda margen. */
  diffMs: number
  over: boolean
}

export function targetStatus(project: Project): TargetStatus | null {
  if (project.targetDurationMs === null || project.targetDurationMs <= 0) return null
  const totalMs = projectDurationMs(project)
  const diffMs = totalMs - project.targetDurationMs
  return { targetMs: project.targetDurationMs, totalMs, diffMs, over: diffMs > 0 }
}

interface Parts {
  hours: number
  minutes: number
  seconds: number
}

function splitSeconds(totalSeconds: number): Parts {
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

/** Redondea a segundos; lo que no llega a medio segundo pero es más que cero cuenta como 1. */
function roundSeconds(ms: number): number {
  const abs = Math.abs(ms)
  if (abs > 0 && abs < 500) return 1
  return Math.round(abs / 1000)
}

/** Formato corto: «14 seg», «2 min 10 s», «2 min», «1 h 5 min». */
export function formatDurationShort(ms: number): string {
  if (Math.abs(ms) > 0 && Math.abs(ms) < 500) return 'menos de 1 seg'
  const { hours, minutes, seconds } = splitSeconds(roundSeconds(ms))
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`
  if (minutes > 0) return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`
  return `${seconds} seg`
}

function unit(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

function joinSpanish(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/** Formato largo: «2 minutos y 10 segundos», «1 hora, 5 minutos y 3 segundos», «0 segundos». */
export function formatDurationLong(ms: number): string {
  if (Math.abs(ms) > 0 && Math.abs(ms) < 500) return 'menos de un segundo'
  const { hours, minutes, seconds } = splitSeconds(roundSeconds(ms))
  const items: string[] = []
  if (hours > 0) items.push(unit(hours, 'hora', 'horas'))
  if (minutes > 0) items.push(unit(minutes, 'minuto', 'minutos'))
  if (seconds > 0 || items.length === 0) items.push(unit(seconds, 'segundo', 'segundos'))
  return joinSpanish(items)
}

/** «Ahora dura 1 min 50 s (antes 2 min 10 s)», o «Dura 2 min 10 s» si no cambia. */
export function describeChange(beforeMs: number, afterMs: number): string {
  const before = formatDurationShort(beforeMs)
  const after = formatDurationShort(afterMs)
  if (before === after) return `Dura ${after}`
  return `Ahora dura ${after} (antes ${before})`
}

/** ¿El texto de una duración larga es singular? («1 segundo», «1 minuto», «menos de un segundo»). */
function isSingular(text: string): boolean {
  return /^1 [a-z]+$/.test(text) || text === 'menos de un segundo'
}

/** «Te sobran 20 segundos» / «Te quedan 35 segundos» / «Justo en el tiempo que querías». */
export function describeTarget(totalMs: number, targetMs: number): string {
  const diff = totalMs - targetMs
  if (Math.abs(diff) < 500) return 'Justo en el tiempo que querías'
  const text = formatDurationLong(Math.abs(diff))
  const singular = isSingular(text)
  if (diff > 0) return `Te ${singular ? 'sobra' : 'sobran'} ${text}`
  return `Te ${singular ? 'queda' : 'quedan'} ${text}`
}

export interface EditSummary {
  clip: string
  project: string
  target: string | null
}

/** Las frases que se enseñan tras cada operación: el trozo, el vídeo completo y el objetivo. */
export function summarizeEdit(input: {
  clipBeforeMs: number
  clipAfterMs: number
  projectBeforeMs: number
  projectAfterMs: number
  targetMs: number | null
}): EditSummary {
  return {
    clip: `Este trozo: ${lowerFirst(describeChange(input.clipBeforeMs, input.clipAfterMs))}`,
    project: `El vídeo completo: ${lowerFirst(describeChange(input.projectBeforeMs, input.projectAfterMs))}`,
    target: input.targetMs && input.targetMs > 0 ? describeTarget(input.projectAfterMs, input.targetMs) : null,
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}
