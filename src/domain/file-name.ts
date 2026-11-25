// Nombre del fichero guardado: «Vídeo del 25 de noviembre de 2026 (para WhatsApp).mp4» o, para
// «Solo el sonido», «Sonido del 25 de noviembre de 2026.m4a». Extensiones de vídeo y de sonido.

import type { PresetId } from './output'

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

/** Qué se guarda: un vídeo con uno de los presets, o «Solo el sonido». */
export type SaveTarget = PresetId | 'sound'

const PRESET_SUFFIX: Record<PresetId, string> = {
  whatsapp: '(para WhatsApp)',
  youtube: '(para YouTube)',
  high: '(calidad alta)',
}

/** «25 de noviembre de 2026», con la fecha local. */
export function formatSpanishDate(date: Date): string {
  return `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`
}

/**
 * Nombre de salida que no choca con ninguno de los existentes (comparación sin mayúsculas, como Windows):
 * «… (para WhatsApp).mp4», «… (para WhatsApp) 2.mp4», «… (para WhatsApp) 3.mp4»…
 * Con 'sound': «Sonido del … .m4a», «Sonido del … 2.m4a»…
 */
export function buildOutputFileName(date: Date, target: SaveTarget, existingNames: readonly string[] = []): string {
  const base = target === 'sound' ? `Sonido del ${formatSpanishDate(date)}` : `Vídeo del ${formatSpanishDate(date)} ${PRESET_SUFFIX[target]}`
  const ext = target === 'sound' ? 'm4a' : 'mp4'
  const taken = new Set(existingNames.map((n) => n.normalize('NFC').toLocaleLowerCase('es')))
  const isFree = (name: string) => !taken.has(name.normalize('NFC').toLocaleLowerCase('es'))
  let candidate = `${base}.${ext}`
  for (let n = 2; !isFree(candidate); n++) candidate = `${base} ${n}.${ext}`
  return candidate
}

/** Extensiones que se aceptan como vídeo (las mismas que el diálogo de elegir vídeos, commands.rs). */
export const VIDEO_EXTENSIONS: readonly string[] = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', '3gp', 'mts', 'm2ts', 'mpg', 'wmv']

/** Extensiones que se aceptan como sonido (las mismas que el diálogo, commands.rs). */
export const AUDIO_EXTENSIONS: readonly string[] = ['m4a', 'mp3', 'wav', 'aac', 'ogg', 'opus', 'flac', 'wma']

function extensionOf(path: string): string | null {
  const m = /\.([^.\\/]+)$/.exec(path)
  return m ? m[1]!.toLowerCase() : null
}

/** ¿Parece un vídeo por la extensión? (para filtrar lo que se suelta en la ventana). */
export function isVideoPath(path: string): boolean {
  const ext = extensionOf(path)
  return !!ext && VIDEO_EXTENSIONS.includes(ext)
}

/** ¿Parece un fichero de sonido por la extensión? */
export function isAudioPath(path: string): boolean {
  const ext = extensionOf(path)
  return !!ext && AUDIO_EXTENSIONS.includes(ext)
}

/** ¿Se puede añadir al montaje? (vídeo o sonido). */
export function isMediaPath(path: string): boolean {
  return isVideoPath(path) || isAudioPath(path)
}

/** Nombre del fichero de una ruta de Windows o POSIX: «C:\a\b\toma 1.mp4» → «toma 1.mp4». */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}
