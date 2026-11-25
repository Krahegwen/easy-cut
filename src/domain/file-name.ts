// Nombre del fichero exportado: «Vídeo del 25 de noviembre de 2026 (para WhatsApp).mp4».

import type { PresetId } from './output'

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const

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
 */
export function buildOutputFileName(date: Date, preset: PresetId, existingNames: readonly string[] = []): string {
  const base = `Vídeo del ${formatSpanishDate(date)} ${PRESET_SUFFIX[preset]}`
  const taken = new Set(existingNames.map((n) => n.normalize('NFC').toLocaleLowerCase('es')))
  const isFree = (name: string) => !taken.has(name.normalize('NFC').toLocaleLowerCase('es'))
  let candidate = `${base}.mp4`
  for (let n = 2; !isFree(candidate); n++) candidate = `${base} ${n}.mp4`
  return candidate
}
