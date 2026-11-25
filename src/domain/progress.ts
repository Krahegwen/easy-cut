// Parser incremental de la salida de `ffmpeg -progress pipe:1` y estimación del tiempo restante.

export interface ProgressUpdate {
  /** Tiempo ya codificado del vídeo de salida (ms). */
  outTimeMs: number
  /** 0..1 */
  fraction: number
  /** Tiempo restante estimado y suavizado (ms), o null si aún no se puede calcular. */
  remainingMs: number | null
  /** Velocidad que informa ffmpeg (×), si la da. */
  speed: number | null
  done: boolean
}

export interface ProgressParser {
  /** Recibe un trozo de stdout (puede cortar líneas por la mitad) y devuelve los bloques completos. */
  push(chunk: string, nowMs: number): ProgressUpdate[]
  /** Último estado conocido. */
  readonly last: ProgressUpdate
}

/** Peso del dato nuevo en el suavizado exponencial del tiempo restante. */
const SMOOTHING = 0.25
/** No se estima nada hasta llevar este tiempo y esta fracción: los primeros segundos engañan. */
const MIN_ELAPSED_MS = 1500
const MIN_FRACTION = 0.01

export function createProgressParser(totalDurationMs: number, startedAtMs: number): ProgressParser {
  let buffer = ''
  let block: Record<string, string> = {}
  let smoothedRemaining: number | null = null
  let last: ProgressUpdate = { outTimeMs: 0, fraction: 0, remainingMs: null, speed: null, done: false }

  const readOutTimeMs = (b: Record<string, string>): number | null => {
    // out_time_us y out_time_ms vienen ambos en microsegundos (rareza histórica de ffmpeg).
    for (const key of ['out_time_us', 'out_time_ms']) {
      const v = b[key]
      if (v !== undefined && v !== 'N/A') {
        const n = Number(v)
        if (Number.isFinite(n)) return Math.max(0, n / 1000)
      }
    }
    const t = b.out_time
    if (t && t !== 'N/A') {
      const m = /^(-?\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(t.trim())
      if (m) return Math.max(0, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000)
    }
    return null
  }

  const finishBlock = (status: string, nowMs: number): ProgressUpdate => {
    const done = status === 'end'
    const outTimeMs = readOutTimeMs(block) ?? last.outTimeMs
    const fraction = done ? 1 : totalDurationMs > 0 ? Math.min(1, outTimeMs / totalDurationMs) : 0
    const speedRaw = block.speed?.replace('x', '').trim()
    const speed = speedRaw && speedRaw !== 'N/A' && Number.isFinite(Number(speedRaw)) ? Number(speedRaw) : null

    const elapsed = nowMs - startedAtMs
    let remainingMs: number | null = null
    if (done) {
      remainingMs = 0
      smoothedRemaining = 0
    } else if (elapsed >= MIN_ELAPSED_MS && fraction >= MIN_FRACTION) {
      const raw = (elapsed / fraction) * (1 - fraction)
      smoothedRemaining = smoothedRemaining === null ? raw : smoothedRemaining + SMOOTHING * (raw - smoothedRemaining)
      remainingMs = Math.max(0, Math.round(smoothedRemaining))
    } else if (smoothedRemaining !== null) {
      remainingMs = Math.round(smoothedRemaining)
    }
    block = {}
    last = { outTimeMs: Math.round(outTimeMs), fraction, remainingMs, speed, done }
    return last
  }

  return {
    push(chunk, nowMs) {
      buffer += chunk
      const updates: ProgressUpdate[] = []
      let nl: number
      while ((nl = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + (buffer[nl] === '\r' ? 2 : 1))
        if (!line) continue
        const eq = line.indexOf('=')
        if (eq <= 0) continue
        const key = line.slice(0, eq).trim()
        const value = line.slice(eq + 1).trim()
        if (key === 'progress') updates.push(finishBlock(value, nowMs))
        else block[key] = value
      }
      return updates
    },
    get last() {
      return last
    },
  }
}

/** «Faltan unos 2 minutos», «Falta menos de un minuto», «Calculando cuánto falta…». */
export function describeRemaining(remainingMs: number | null, done = false): string {
  if (done) return 'Terminado'
  if (remainingMs === null) return 'Calculando cuánto falta…'
  if (remainingMs < 60_000) return 'Falta menos de un minuto'
  if (remainingMs < 90_000) return 'Falta alrededor de un minuto'
  const minutes = Math.round(remainingMs / 60_000)
  if (minutes < 60) return `Faltan unos ${minutes} minutos`
  const hours = Math.round(remainingMs / 3_600_000)
  return hours <= 1 ? 'Falta alrededor de una hora' : `Faltan unas ${hours} horas`
}

/** «45 %» */
export function formatPercent(fraction: number): string {
  return `${Math.floor(Math.min(1, Math.max(0, fraction)) * 100)} %`
}
