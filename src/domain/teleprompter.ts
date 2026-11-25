// Teleprompter: palabras, duración estimada, ritmo necesario y velocidad de scroll.

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
