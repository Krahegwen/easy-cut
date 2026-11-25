import { describe, expect, it } from 'vitest'
import { createProgressParser, describeRemaining, formatPercent } from './progress'

const block = (us: number, status = 'continue') =>
  `frame=10\nfps=30.0\nout_time_us=${us}\nout_time_ms=${us}\nout_time=00:00:00.000000\nspeed=2.5x\nprogress=${status}\n`

describe('parser de -progress', () => {
  it('líneas partidas entre trozos y CRLF', () => {
    const p = createProgressParser(10_000, 0)
    const text = block(2_000_000).replace(/\n/g, '\r\n')
    expect(p.push(text.slice(0, 25), 100)).toEqual([])
    const ups = p.push(text.slice(25), 200)
    expect(ups).toHaveLength(1)
    expect(ups[0]).toMatchObject({ outTimeMs: 2000, fraction: 0.2, speed: 2.5, done: false })
  })

  it('usa out_time_ms (también en microsegundos) u out_time si falta out_time_us', () => {
    const p = createProgressParser(10_000, 0)
    expect(p.push('out_time_ms=5000000\nprogress=continue\n', 0)[0]!.outTimeMs).toBe(5000)
    expect(p.push('out_time_us=N/A\nout_time=00:00:07.500000\nprogress=continue\n', 0)[0]!.outTimeMs).toBe(7500)
    // Si no hay dato, conserva el último.
    expect(p.push('out_time_us=N/A\nprogress=continue\n', 0)[0]!.outTimeMs).toBe(7500)
  })

  it('progress=end → 100 % y 0 restante', () => {
    const p = createProgressParser(10_000, 0)
    const [u] = p.push(block(9_900_000, 'end'), 5000)
    expect(u).toMatchObject({ fraction: 1, remainingMs: 0, done: true })
    expect(p.last.done).toBe(true)
  })

  it('tiempo restante: espera a tener datos y luego se suaviza', () => {
    const p = createProgressParser(100_000, 0)
    expect(p.push(block(500_000), 500)[0]!.remainingMs).toBeNull()
    // 10 % en 10 s → 90 s restantes.
    expect(p.push(block(10_000_000), 10_000)[0]!.remainingMs).toBe(90_000)
    // Un salto brusco (50 % a los 20 s → 20 s) solo mueve la estimación un 25 %.
    expect(p.push(block(50_000_000), 20_000)[0]!.remainingMs).toBe(72_500)
  })

  it('no pasa del 100 % aunque ffmpeg dé más tiempo del previsto', () => {
    const p = createProgressParser(1000, 0)
    expect(p.push(block(3_000_000), 1)[0]!.fraction).toBe(1)
  })
})

describe('textos', () => {
  it('tiempo restante en castellano llano', () => {
    expect(describeRemaining(null)).toBe('Calculando cuánto falta…')
    expect(describeRemaining(30_000)).toBe('Falta menos de un minuto')
    expect(describeRemaining(75_000)).toBe('Falta alrededor de un minuto')
    expect(describeRemaining(130_000)).toBe('Faltan unos 2 minutos')
    expect(describeRemaining(3_700_000)).toBe('Falta alrededor de una hora')
    expect(describeRemaining(9_000_000)).toBe('Faltan unas 3 horas')
    expect(describeRemaining(0, true)).toBe('Terminado')
  })

  it('porcentaje', () => {
    expect(formatPercent(0.456)).toBe('45 %')
    expect(formatPercent(1.2)).toBe('100 %')
  })
})
