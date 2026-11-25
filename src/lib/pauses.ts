// Estado de «quitar pausas» por trozo: silencios detectados (del original), nivel elegido y búsqueda en curso.
// Se guarda fuera de la pantalla para no repetir la búsqueda al volver a la pestaña.
import { shallowRef } from 'vue'
import {
  applyKeepSegments,
  clipInOut,
  computeKeepSegments,
  findClip,
  PAUSE_MIN_SILENCE_MS,
  type Clip,
  type PauseLevel,
  type Project,
  type TimeRange,
} from '../domain'
import type { RunningProcess } from '../native/bridge'
import { store } from '../store'

export interface PauseState {
  status: 'idle' | 'searching' | 'done' | 'error'
  /** Rango del original analizado. */
  range: TimeRange | null
  silences: TimeRange[]
  level: PauseLevel
  /** La persona ha dicho «Dejar las pausas»: no se enseña la propuesta. */
  dismissed: boolean
}

const states = shallowRef<Record<string, PauseState>>({})
const jobs = new Map<string, RunningProcess<TimeRange[]>>()

const initial = (): PauseState => ({ status: 'idle', range: null, silences: [], level: 'normal', dismissed: false })

export function pauseState(clipId: string): PauseState {
  return states.value[clipId] ?? initial()
}

export function updatePauseState(clipId: string, change: Partial<PauseState>) {
  states.value = { ...states.value, [clipId]: { ...pauseState(clipId), ...change } }
}

/** ¿Los silencios detectados cubren el rango actual del trozo? Si no, hay que volver a buscar. */
export function coversRange(state: PauseState, clip: Clip): boolean {
  if (!state.range) return false
  const io = clipInOut(clip)
  return io.startMs >= state.range.startMs && io.endMs <= state.range.endMs
}

/** Rangos que se conservarían quitando las pausas del nivel elegido, con el inicio y el fin actuales. */
export function candidateSegments(state: PauseState, clip: Clip): TimeRange[] | null {
  if (state.status !== 'done' || !coversRange(state, clip)) return null
  return computeKeepSegments(state.silences, clipInOut(clip), state.level)
}

export async function searchPauses(clip: Clip): Promise<void> {
  jobs.get(clip.id)?.cancel()
  const range = clipInOut(clip)
  updatePauseState(clip.id, { status: 'searching' })
  // Se busca con el silencio más corto de los tres niveles; cada nivel filtra luego los suyos.
  const job = store.bridge.detectSilences(clip.sourcePath, range, { minSilenceMs: PAUSE_MIN_SILENCE_MS.many })
  jobs.set(clip.id, job)
  try {
    const silences = await job.result
    updatePauseState(clip.id, { status: 'done', range, silences, dismissed: false })
  } catch (e) {
    if (e instanceof Error && e.name === 'CancelledError') {
      updatePauseState(clip.id, { status: pauseState(clip.id).range ? 'done' : 'idle' })
      return
    }
    updatePauseState(clip.id, { status: 'error' })
    store.showError('No he podido buscar las pausas de este trozo.', e)
  } finally {
    if (jobs.get(clip.id) === job) jobs.delete(clip.id)
  }
}

export function cancelPauseSearch(clipId: string) {
  jobs.get(clipId)?.cancel()
}

/**
 * Tras cambiar el inicio o el fin de un trozo con las pausas ya quitadas, las vuelve a calcular
 * con el nivel elegido (si los silencios detectados cubren el rango nuevo).
 */
export function reapplyPauses(project: Project, clipId: string): Project {
  const clip = findClip(project, clipId)
  if (!clip || clip.segments.length <= 1) return project
  const state = pauseState(clipId)
  const keep = candidateSegments(state, clip)
  return keep ? applyKeepSegments(project, clipId, keep) : project
}
