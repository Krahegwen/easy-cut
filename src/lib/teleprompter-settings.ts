// Lo que se recuerda del teleprompter entre una vez y otra (también tras cerrar la app): el texto,
// el ritmo, el tamaño de letra, la duración máxima y la cámara y el micrófono elegidos.
import { PACE_STEP_WPM, type PacePreset, type RecordingKind } from '../domain'

const KEY = 'easy-cut:teleprompter'

export interface TeleprompterSettings {
  text: string
  preset: PacePreset
  /** Ajuste fino sobre el ritmo del preajuste, en pasos de PACE_STEP_WPM. */
  tweak: number
  fontSize: number
  /** undefined = la del proyecto (o ninguna). */
  targetMs?: number | null
  cameraId: string | null
  micId: string | null
  /** La vista de la cámara en la esquina al grabar. */
  showCamera: boolean
  /** Último modo elegido: «Grabarme en vídeo» o «Grabar solo la voz». */
  kind: RecordingKind
}

export const FONT_SIZES = [36, 44, 52, 60, 68, 78, 90] as const
export const DEFAULT_FONT_SIZE = 60

const defaults = (): TeleprompterSettings => ({
  text: '',
  preset: 'normal',
  tweak: 0,
  fontSize: DEFAULT_FONT_SIZE,
  cameraId: null,
  micId: null,
  showCamera: true,
  kind: 'video',
})

export function loadSettings(): TeleprompterSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    const v = JSON.parse(raw) as Partial<TeleprompterSettings>
    const d = defaults()
    return {
      text: typeof v.text === 'string' ? v.text : d.text,
      preset: v.preset === 'slow' || v.preset === 'fast' || v.preset === 'fit' || v.preset === 'normal' ? v.preset : d.preset,
      tweak: typeof v.tweak === 'number' && Number.isFinite(v.tweak) ? Math.max(-8, Math.min(8, Math.round(v.tweak))) : 0,
      fontSize: FONT_SIZES.includes(v.fontSize as (typeof FONT_SIZES)[number]) ? (v.fontSize as number) : d.fontSize,
      targetMs: v.targetMs === null || (typeof v.targetMs === 'number' && v.targetMs > 0) ? v.targetMs : undefined,
      cameraId: typeof v.cameraId === 'string' ? v.cameraId : null,
      micId: typeof v.micId === 'string' ? v.micId : null,
      showCamera: v.showCamera !== false,
      kind: v.kind === 'audio' ? 'audio' : 'video',
    }
  } catch {
    return defaults()
  }
}

export function saveSettings(s: TeleprompterSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Sin almacenamiento no se recuerda, pero se puede grabar igual.
  }
}

export const TWEAK_WPM = PACE_STEP_WPM
