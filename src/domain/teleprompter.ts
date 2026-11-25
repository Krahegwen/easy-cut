// Teleprompter: palabras, duración estimada, ritmo necesario y velocidad de scroll.

import { formatDuration } from './durations'

export const DEFAULT_WPM = 140
export const NATURAL_WPM_MIN = 110
export const NATURAL_WPM_MAX = 170
/** Por encima de esto ya no se puede leer con naturalidad. */
export const MAX_READABLE_WPM = 210

/** Cuenta palabras: grupos de letras o cifras (con tildes, ñ, guiones o apóstrofos dentro). */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)
  return matches ? matches.length : 0
}

export function estimateDurationMs(words: number, wpm: number = DEFAULT_WPM): number {
  if (words <= 0 || wpm <= 0) return 0
  return Math.round((words / wpm) * 60_000)
}

/** Ritmo (palabras por minuto) necesario para decir el texto en la duración objetivo. */
export function requiredWpm(words: number, targetMs: number): number {
  if (targetMs <= 0) return Infinity
  return Math.round((words / targetMs) * 60_000)
}

export type PaceClass = 'very-slow' | 'comfortable' | 'fast' | 'too-fast'

export interface PaceAssessment {
  wpm: number
  pace: PaceClass
  /** «muy lento», «cómodo», «rápido», «no da tiempo» */
  label: string
  /** Frase llana para el usuario. */
  message: string
  natural: boolean
}

export function classifyPace(wpm: number): PaceAssessment {
  if (wpm < NATURAL_WPM_MIN) {
    return {
      wpm,
      pace: 'very-slow',
      label: 'muy lento',
      message: 'Te sobra tiempo: tendrías que hablar muy despacio. Puedes añadir texto o acortar el vídeo.',
      natural: false,
    }
  }
  if (wpm <= NATURAL_WPM_MAX) {
    return { wpm, pace: 'comfortable', label: 'cómodo', message: 'Ritmo cómodo, como una conversación tranquila.', natural: true }
  }
  if (wpm <= MAX_READABLE_WPM) {
    return {
      wpm,
      pace: 'fast',
      label: 'rápido',
      message: 'Tendrás que hablar rápido. Si quitas un poco de texto irá mejor.',
      natural: false,
    }
  }
  return {
    wpm,
    pace: 'too-fast',
    label: 'no da tiempo',
    message: 'No da tiempo a decirlo todo: quita texto o alarga el vídeo.',
    natural: false,
  }
}

/** Velocidad de scroll (px/s) para recorrer toda la altura del texto en la duración dada. */
export function scrollSpeedPxPerSec(textHeightPx: number, durationMs: number): number {
  if (durationMs <= 0 || textHeightPx <= 0) return 0
  return Math.round((textHeightPx / (durationMs / 1000)) * 100) / 100
}

export interface TeleprompterPlan {
  words: number
  /** Duración a la velocidad elegida (o la por defecto). */
  estimatedMs: number
  wpm: number
  /** Solo si hay duración objetivo. */
  target: (PaceAssessment & { targetMs: number }) | null
}

export function planTeleprompter(text: string, options: { wpm?: number; targetMs?: number | null } = {}): TeleprompterPlan {
  const words = countWords(text)
  const wpm = options.wpm ?? DEFAULT_WPM
  const targetMs = options.targetMs ?? null
  return {
    words,
    estimatedMs: estimateDurationMs(words, wpm),
    wpm,
    target: targetMs && targetMs > 0 ? { ...classifyPace(requiredWpm(words, targetMs)), targetMs } : null,
  }
}

// ================================================================== guion: palabras y pausas

/**
 * Un párrafo en blanco (línea vacía entre dos párrafos) cuenta como una pausa corta, del tiempo de
 * estas palabras: a 140 palabras por minuto, unos 0,9 segundos.
 */
export const PARAGRAPH_PAUSE_UNITS = 2

/** Un trozo de texto entre espacios, tal como se pinta, con su sitio en el avance del texto. */
export interface ScriptToken {
  /** Texto tal cual (con su puntuación). */
  text: string
  /** Avance acumulado (en palabras) al empezar este trozo. */
  unitStart: number
  /** Cuánto avanza: las palabras que contiene (0 si es solo puntuación, como «—»). */
  units: number
  /** Va en una línea nueva dentro del mismo párrafo (había un salto de línea simple). */
  lineBreakBefore: boolean
}

export interface ScriptParagraph {
  tokens: ScriptToken[]
}

export interface Script {
  paragraphs: ScriptParagraph[]
  words: number
  /** Pausas de párrafo (una entre cada dos párrafos). */
  pauses: number
  /** Avance total: palabras + pausas de párrafo. */
  totalUnits: number
}

/** Parte el texto en párrafos (separados por líneas en blanco) y trozos, con el avance de cada uno. */
export function parseScript(text: string): Script {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((b) => b.trim())
    .filter((b) => b !== '')
  const paragraphs: ScriptParagraph[] = []
  let units = 0
  let words = 0
  blocks.forEach((block, i) => {
    if (i > 0) units += PARAGRAPH_PAUSE_UNITS
    const tokens: ScriptToken[] = []
    for (const [lineIndex, line] of block.split('\n').entries()) {
      const parts = line.split(/\s+/).filter((p) => p !== '')
      parts.forEach((part, j) => {
        const n = countWords(part)
        tokens.push({ text: part, unitStart: units, units: n, lineBreakBefore: lineIndex > 0 && j === 0 })
        units += n
        words += n
      })
    }
    paragraphs.push({ tokens })
  })
  return { paragraphs, words, pauses: Math.max(0, paragraphs.length - 1), totalUnits: units }
}

/** Duración de leer el guion entero (con sus pausas) a este ritmo. */
export function scriptDurationMs(script: Pick<Script, 'totalUnits'>, wpm: number): number {
  return estimateDurationMs(script.totalUnits, wpm)
}

// ================================================================== ritmo

export type PacePreset = 'slow' | 'normal' | 'fast' | 'fit'

/** Ritmos fijos, en palabras por minuto. */
export const PACE_WPM: Record<Exclude<PacePreset, 'fit'>, number> = { slow: 115, normal: 140, fast: 165 }
/** Ajuste fino «un poco más lento / más rápido» y flechas al grabar. */
export const PACE_STEP_WPM = 5
export const MIN_WPM = 80
export const MAX_WPM = 220
/** Hasta aquí se lee a gusto. */
export const COMFORT_MAX_WPM = 150
/** Hasta aquí se puede, aunque con prisa. Más allá, no da tiempo. */
export const HURRIED_MAX_WPM = 175
/** «Ajustado al tiempo» solo se ofrece entre estos dos ritmos. */
export const FIT_MIN_WPM = 100
export const FIT_MAX_WPM = 190

export function clampWpm(wpm: number): number {
  return Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm)))
}

/** Ritmo que hace que el guion dure justo la duración máxima (sin redondear a los fijos). */
export function fitWpm(script: Pick<Script, 'totalUnits'>, targetMs: number): number {
  if (targetMs <= 0 || script.totalUnits <= 0) return 0
  return Math.ceil((script.totalUnits / targetMs) * 60_000)
}

/** ¿Se puede ofrecer «Ajustado al tiempo»? Solo si sale un ritmo que se pueda leer. */
export function fitIsReasonable(wpm: number): boolean {
  return wpm >= FIT_MIN_WPM && wpm <= FIT_MAX_WPM
}

/** Ritmo de un preajuste («fit» necesita la duración máxima; sin ella, el normal). */
export function presetWpm(preset: PacePreset, script: Pick<Script, 'totalUnits'>, targetMs: number | null): number {
  if (preset !== 'fit') return PACE_WPM[preset]
  const wpm = targetMs ? fitWpm(script, targetMs) : 0
  return fitIsReasonable(wpm) ? wpm : PACE_WPM.normal
}

/** Nombre llano del ritmo: «despacio», «normal», «rápido», «muy rápido»… */
export function paceName(wpm: number): string {
  if (wpm < 105) return 'muy despacio'
  if (wpm < 128) return 'despacio'
  if (wpm <= 152) return 'normal'
  if (wpm <= 178) return 'rápido'
  return 'muy rápido'
}

/** «unos 2 min 20 s»: redondeado a 5 segundos (menos de un minuto) o a 10 (más). */
export function roughDuration(ms: number): number {
  const step = ms < 60_000 ? 5_000 : 10_000
  return Math.max(step, Math.round(ms / step) * step)
}

/** Redondeo amable de un número de palabras: exacto hasta 20, luego a la decena (hacia arriba). */
export function roughWordCount(n: number): number {
  if (n <= 20) return Math.max(1, Math.ceil(n))
  return Math.ceil(n / 10) * 10
}

export type FitKind = 'plenty' | 'easy' | 'comfortable' | 'hurried' | 'too-long'

export interface FitAdvice {
  kind: FitKind
  /** Ritmo necesario (palabras por minuto) para que dure justo la duración máxima. */
  requiredWpm: number
  /** Frase principal. */
  title: string
  /** Frase de apoyo (qué hacer), o null si no hace falta. */
  hint: string | null
  /** Palabras que habría que quitar para leer a ritmo cómodo (0 si ya se puede). */
  wordsToCut: number
}

/** Palabras que hay que quitar para que, leyendo a `wpm`, quepa en la duración máxima. */
export function wordsOverAt(script: Pick<Script, 'words' | 'pauses'>, targetMs: number, wpm: number): number {
  const maxUnits = (targetMs / 60_000) * wpm
  const maxWords = maxUnits - script.pauses * PARAGRAPH_PAUSE_UNITS
  return Math.max(0, Math.ceil(script.words - maxWords))
}

/** ¿Cabe el texto en la duración máxima, y a qué ritmo hay que leerlo? Frases llanas y accionables. */
export function adviseFit(script: Pick<Script, 'words' | 'pauses' | 'totalUnits'>, targetMs: number): FitAdvice {
  const required = fitWpm(script, targetMs)
  const limit = formatTargetPhrase(targetMs)
  const toComfort = wordsOverAt(script, targetMs, COMFORT_MAX_WPM)
  if (required < FIT_MIN_WPM) {
    return {
      kind: 'plenty',
      requiredWpm: required,
      title: `Te sobra tiempo: aunque leas despacio, cabe de sobra en ${limit}`,
      hint: 'Si quieres, puedes añadir más texto.',
      wordsToCut: 0,
    }
  }
  if (required <= 125) {
    return { kind: 'easy', requiredWpm: required, title: `Para que quepa en ${limit} puedes leer despacio, con calma`, hint: null, wordsToCut: 0 }
  }
  if (required <= COMFORT_MAX_WPM) {
    return { kind: 'comfortable', requiredWpm: required, title: `Para que quepa en ${limit} tienes que leer a ritmo cómodo`, hint: null, wordsToCut: 0 }
  }
  const cut = roughWordCount(toComfort)
  if (required <= HURRIED_MAX_WPM) {
    return {
      kind: 'hurried',
      requiredWpm: required,
      title: `Para que quepa en ${limit} tienes que leer un poco rápido`,
      hint: `Si quitas unas ${cut} palabras, podrás leer a ritmo cómodo.`,
      wordsToCut: toComfort,
    }
  }
  return {
    kind: 'too-long',
    requiredWpm: required,
    title: `No da tiempo: te sobran unas ${cut} palabras`,
    hint: `Quítalas para que quepa en ${limit} leyendo a ritmo cómodo, o alarga la duración máxima.`,
    wordsToCut: toComfort,
  }
}

/** «5 minutos», «2 minutos y 30 segundos», «45 segundos». */
function formatTargetPhrase(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  const minutes = m === 1 ? '1 minuto' : `${m} minutos`
  const seconds = s === 1 ? '1 segundo' : `${s} segundos`
  if (m === 0) return seconds
  return s === 0 ? minutes : `${minutes} y ${seconds}`
}

// ================================================================== scroll proporcional al texto

/** Una línea del texto tal como ha quedado pintada (medida en el DOM), con su tramo de avance. */
export interface PrompterLine {
  /** Posición vertical del centro de la línea dentro del bloque de texto (px). */
  centerY: number
  /** Avance (palabras) en el que empieza la línea. */
  unitStart: number
}

export interface MeasuredToken {
  top: number
  height: number
  unitStart: number
}

/**
 * Agrupa los trozos medidos en líneas (los que comparten `top`, con 2 px de margen). La línea empieza
 * en el avance de su primer trozo; los párrafos vacíos no generan línea.
 */
export function groupIntoLines(tokens: readonly MeasuredToken[]): PrompterLine[] {
  const lines: PrompterLine[] = []
  let currentTop = Number.NEGATIVE_INFINITY
  for (const t of tokens) {
    if (Math.abs(t.top - currentTop) > 2) {
      lines.push({ centerY: t.top + t.height / 2, unitStart: t.unitStart })
      currentTop = t.top
    }
  }
  return lines
}

/**
 * Posición vertical (en el bloque) que debe estar en la línea de lectura cuando se va por `units`.
 * Dentro de cada línea avanza de forma continua hasta la siguiente, así que la velocidad del scroll
 * sale de las palabras de cada línea, no de los píxeles: una línea corta pasa antes que una larga.
 */
export function scrollYAt(lines: readonly PrompterLine[], totalUnits: number, units: number): number {
  if (lines.length === 0) return 0
  const first = lines[0]!
  if (units <= first.unitStart) return first.centerY
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const next = lines[i + 1]
    const endUnits = next ? next.unitStart : totalUnits
    if (units < endUnits || !next) {
      const span = endUnits - line.unitStart
      const f = span > 0 ? Math.min(1, Math.max(0, (units - line.unitStart) / span)) : 1
      // La última línea se queda en la línea de lectura (no hay a dónde ir).
      const nextY = next ? next.centerY : line.centerY
      return line.centerY + (nextY - line.centerY) * f
    }
  }
  return lines[lines.length - 1]!.centerY
}

/** Índice de la línea que se está leyendo. */
export function lineIndexAt(lines: readonly PrompterLine[], units: number): number {
  let index = 0
  for (let i = 0; i < lines.length; i++) if (lines[i]!.unitStart <= units) index = i
  return index
}

/** «Retroceder un poco»: vuelve al principio de la línea que está `linesBack` líneas más arriba. */
export function rewindUnits(lines: readonly PrompterLine[], units: number, linesBack = 2): number {
  if (lines.length === 0) return 0
  const i = Math.max(0, lineIndexAt(lines, units) - linesBack)
  return lines[i]!.unitStart
}

/** Avance tras `elapsedMs` a `wpm` palabras por minuto (los cambios de ritmo se integran por tramos). */
export function advanceUnits(units: number, elapsedMs: number, wpm: number, totalUnits: number): number {
  if (elapsedMs <= 0 || wpm <= 0) return units
  return Math.min(totalUnits, units + (elapsedMs * wpm) / 60_000)
}

// ================================================================== ¿vas bien o vas tarde?

export type ProgressTone = 'normal' | 'warn' | 'danger'

export interface ReadingProgress {
  /** Tiempo grabado (sin pausas). */
  elapsedMs: number
  /** Con duración máxima: lo que queda hasta ella (negativo si ya se ha pasado). */
  remainingMs: number | null
  /** Con duración máxima: cuánto se pasaría (positivo) si sigue a este ritmo. */
  projectedOverMs: number | null
  status: 'free' | 'ok' | 'behind' | 'over' | 'finished'
  message: string
  tone: ProgressTone
}

/** Aviso de «queda poco»: los últimos 30 segundos (o el último 10 %, si es más corto). */
export function nearEndMs(targetMs: number): number {
  return Math.min(30_000, Math.round(targetMs * 0.1))
}

/** Margen antes de decir «vas tarde» (unos segundos de más no son un problema). */
export const BEHIND_TOLERANCE_MS = 4000

/**
 * Estado de la lectura mientras se graba: tiempo grabado, lo que queda y si se va bien o tarde según
 * por dónde va el texto (lo que falta por leer, a este ritmo, ¿cabe en lo que queda?).
 */
export function readingProgress(input: {
  elapsedMs: number
  units: number
  totalUnits: number
  wpm: number
  targetMs: number | null
}): ReadingProgress {
  const { elapsedMs, units, totalUnits, wpm, targetMs } = input
  const finished = totalUnits > 0 && units >= totalUnits
  if (!targetMs || targetMs <= 0) {
    return {
      elapsedMs,
      remainingMs: null,
      projectedOverMs: null,
      status: finished ? 'finished' : 'free',
      message: finished ? 'Has terminado el texto. Pulsa Terminar' : '',
      tone: 'normal',
    }
  }
  const remainingMs = targetMs - elapsedMs
  const leftMs = wpm > 0 ? ((totalUnits - Math.min(units, totalUnits)) / wpm) * 60_000 : 0
  const projectedOverMs = Math.round(elapsedMs + leftMs - targetMs)
  const near = remainingMs <= nearEndMs(targetMs)
  if (remainingMs <= 0) {
    return {
      elapsedMs,
      remainingMs,
      projectedOverMs,
      status: 'over',
      message: finished ? `Has pasado de ${formatTargetPhrase(targetMs)}. Pulsa Terminar` : `Has llegado a ${formatTargetPhrase(targetMs)}: termina en cuanto puedas`,
      tone: 'danger',
    }
  }
  if (finished) {
    return { elapsedMs, remainingMs, projectedOverMs, status: 'finished', message: 'Has terminado el texto. Pulsa Terminar', tone: near ? 'warn' : 'normal' }
  }
  if (projectedOverMs > BEHIND_TOLERANCE_MS) {
    const late = roundLate(projectedOverMs)
    return {
      elapsedMs,
      remainingMs,
      projectedOverMs,
      status: 'behind',
      message: `Vas ${late} por detrás: acelera un poco`,
      tone: near ? 'danger' : 'warn',
    }
  }
  return { elapsedMs, remainingMs, projectedOverMs, status: 'ok', message: 'Vas bien', tone: near ? 'warn' : 'normal' }
}

/** «15 segundos», «1 minuto y 10 segundos»: redondeado a 5 segundos. */
function roundLate(ms: number): string {
  return formatTargetPhrase(Math.max(5000, Math.round(ms / 5000) * 5000))
}

/** Cómo se dice el ritmo elegido en la frase de la duración: «a ritmo normal», «despacio», «a tu ritmo»… */
export function pacePhrase(preset: PacePreset, tweak: number): string {
  if (tweak !== 0) return 'a tu ritmo'
  switch (preset) {
    case 'slow':
      return 'despacio'
    case 'fast':
      return 'rápido'
    case 'fit':
      return 'ajustado al tiempo'
    default:
      return 'a ritmo normal'
  }
}

/** «320 palabras · leyéndolo a ritmo normal dura unos 2 min 20 s». */
export function describeScriptLength(script: Pick<Script, 'words' | 'totalUnits'>, wpm: number, phrase: string): string {
  if (script.words === 0) return 'Todavía no hay texto'
  const count = script.words === 1 ? '1 palabra' : `${script.words.toLocaleString('es-ES')} palabras`
  return `${count} · leyéndolo ${phrase} dura unos ${formatDuration(roughDuration(scriptDurationMs(script, wpm)))}`
}

/** Cuenta atrás antes de empezar a grabar (segundos). */
export const COUNTDOWN_SECONDS = 3
/** Tras acabar el texto se sigue grabando este rato antes de avisar. */
export const AFTER_END_MS = 2000
