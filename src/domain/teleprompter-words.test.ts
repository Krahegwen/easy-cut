import { describe, expect, it } from 'vitest'
import {
  advanceUnits,
  cursorDirtyRange,
  flattenTokens,
  PARAGRAPH_PAUSE_UNITS,
  parseScript,
  rewindUnits,
  wordCursorAt,
  wordStateAt,
  type PrompterLine,
  type WordCursor,
} from './teleprompter'

const words = (n: number, w = 'palabra') => Array.from({ length: n }, () => w).join(' ')

/** Texto de unos 5 minutos a 140 palabras por minuto: 750 palabras en 10 párrafos. */
const LONG = Array.from({ length: 10 }, (_, i) => words(75, `p${i}`)).join('\n\n')

describe('por dónde va la lectura', () => {
  const script = parseScript('Hola, ¿qué tal?\n\nOtro — párrafo aquí.')
  const tokens = flattenTokens(script)

  it('los trozos de todos los párrafos, en orden', () => {
    expect(tokens.map((t) => t.text)).toEqual(['Hola,', '¿qué', 'tal?', 'Otro', '—', 'párrafo', 'aquí.'])
    expect(flattenTokens(parseScript(''))).toEqual([])
  })

  it('al principio toca la primera palabra; dentro de una palabra, esa', () => {
    expect(wordCursorAt(tokens, 0)).toEqual({ read: 0, current: 0 })
    expect(wordCursorAt(tokens, 0.99)).toEqual({ read: 0, current: 0 })
    expect(wordCursorAt(tokens, 1)).toEqual({ read: 1, current: 1 })
    expect(wordCursorAt(tokens, 2.5)).toEqual({ read: 2, current: 2 })
    // Antes del principio o un avance sin sentido: la primera.
    expect(wordCursorAt(tokens, -3)).toEqual({ read: 0, current: 0 })
    expect(wordCursorAt(tokens, Number.NaN)).toEqual({ read: 0, current: 0 })
  })

  it('párrafo nuevo = pausa corta: entre los dos no toca ninguna', () => {
    // «tal?» acaba en 3; «Otro» empieza en 3 + la pausa.
    expect(wordCursorAt(tokens, 3)).toEqual({ read: 3, current: -1 })
    expect(wordCursorAt(tokens, 3 + PARAGRAPH_PAUSE_UNITS - 0.01)).toEqual({ read: 3, current: -1 })
    expect(wordCursorAt(tokens, 3 + PARAGRAPH_PAUSE_UNITS)).toEqual({ read: 3, current: 3 })
  })

  it('la puntuación suelta se da por leída en cuanto se llega a ella', () => {
    // «—» no avanza: al llegar a «párrafo» ya está leída.
    const at = 4 + PARAGRAPH_PAUSE_UNITS
    expect(wordCursorAt(tokens, at)).toEqual({ read: 5, current: 5 })
    expect(wordStateAt(wordCursorAt(tokens, at), 4)).toBe('read')
    // Una raya al principio del texto también.
    expect(wordCursorAt(flattenTokens(parseScript('— Hola')), 0)).toEqual({ read: 1, current: 1 })
  })

  it('al final del texto todo está leído y no toca ninguna', () => {
    const end = script.totalUnits
    expect(wordCursorAt(tokens, end - 0.01)).toEqual({ read: 6, current: 6 })
    expect(wordCursorAt(tokens, end)).toEqual({ read: 7, current: -1 })
    expect(wordCursorAt(tokens, end + 50)).toEqual({ read: 7, current: -1 })
    expect(wordCursorAt([], 3)).toEqual({ read: 0, current: -1 })
  })

  it('un trozo con dos palabras pegadas toca mientras dura', () => {
    const t = flattenTokens(parseScript('uno,dos tres'))
    expect(t[0]!.units).toBe(2)
    expect(wordCursorAt(t, 1.5)).toEqual({ read: 0, current: 0 })
    expect(wordCursorAt(t, 2)).toEqual({ read: 1, current: 1 })
  })

  it('estado de cada trozo: leído, el de ahora, por leer', () => {
    const c: WordCursor = { read: 2, current: 2 }
    expect([0, 1, 2, 3].map((i) => wordStateAt(c, i))).toEqual(['read', 'read', 'current', 'ahead'])
    expect([2, 3].map((i) => wordStateAt({ read: 3, current: -1 }, i))).toEqual(['read', 'ahead'])
  })

  it('al pintar solo se tocan los trozos que cambian', () => {
    expect(cursorDirtyRange({ read: 4, current: 4 }, { read: 4, current: 4 })).toBeNull()
    expect(cursorDirtyRange({ read: 4, current: 4 }, { read: 5, current: 5 })).toEqual({ from: 4, to: 6 })
    // Entra en la pausa y sale de ella.
    expect(cursorDirtyRange({ read: 4, current: 4 }, { read: 5, current: -1 })).toEqual({ from: 4, to: 6 })
    expect(cursorDirtyRange({ read: 5, current: -1 }, { read: 5, current: 5 })).toEqual({ from: 5, to: 6 })
    // Retroceder: todo lo que deja de estar leído.
    expect(cursorDirtyRange({ read: 30, current: 30 }, { read: 12, current: 12 })).toEqual({ from: 12, to: 31 })
  })
})

/** Simula el bucle de la pantalla: fotogramas de `frameMs`, con el avance por palabras del dominio. */
function simulate(tokens: ReturnType<typeof flattenTokens>, totalUnits: number) {
  let units = 0
  let cursor = wordCursorAt(tokens, 0)
  const state = { written: 0, maxPerFrame: 0 }
  const step = (ms: number, wpm: number, frameMs = 1000 / 60) => {
    const frames = Math.round(ms / frameMs)
    for (let f = 0; f < frames; f++) {
      units = advanceUnits(units, frameMs, wpm, totalUnits)
      const next = wordCursorAt(tokens, units)
      const dirty = cursorDirtyRange(cursor, next)
      const n = dirty ? Math.min(tokens.length, dirty.to) - dirty.from : 0
      state.written += n
      state.maxPerFrame = Math.max(state.maxPerFrame, n)
      cursor = next
    }
  }
  return {
    step,
    get units() {
      return units
    },
    set units(u: number) {
      units = u
      cursor = wordCursorAt(tokens, u)
    },
    get cursor() {
      return cursor
    },
    state,
  }
}

describe('lectura al ritmo elegido', () => {
  const script = parseScript(words(60))
  const tokens = flattenTokens(script)

  // Los tiempos caen a mitad de palabra (x,5) para no depender del redondeo de la suma de fotogramas.
  it('a 120 palabras por minuto, dos palabras por segundo', () => {
    const run = simulate(tokens, script.totalUnits)
    run.step(5250, 120)
    expect(run.cursor.current).toBe(10)
  })

  it('en pausa no avanza', () => {
    const run = simulate(tokens, script.totalUnits)
    run.step(3250, 120)
    const before = run.cursor
    // En pausa la pantalla no llama a advanceUnits: el avance se queda igual.
    expect(advanceUnits(run.units, 0, 120, script.totalUnits)).toBe(run.units)
    expect(wordCursorAt(tokens, run.units)).toEqual(before)
    run.step(1000, 120)
    expect(run.cursor.current).toBe(before.current + 2)
  })

  it('cambio de ritmo a mitad: cada tramo a su velocidad', () => {
    const run = simulate(tokens, script.totalUnits)
    run.step(5250, 120) // 10,5 palabras
    run.step(6000, 180) // 18 más
    expect(run.cursor.current).toBe(28)
    run.step(6000, 60) // 6 más
    expect(run.cursor.current).toBe(34)
  })

  it('retroceder vuelve a dejar por leer lo que ya se había leído', () => {
    const run = simulate(tokens, script.totalUnits)
    // Líneas de 6 palabras.
    const lines: PrompterLine[] = Array.from({ length: 10 }, (_, i) => ({ centerY: i * 40, unitStart: i * 6 }))
    run.step(10_250, 120) // palabra 20, en la línea 3
    expect(run.cursor.current).toBe(20)
    run.units = rewindUnits(lines, run.units, 2)
    expect(run.cursor).toEqual({ read: 6, current: 6 })
    expect(wordStateAt(run.cursor, 10)).toBe('ahead')
  })

  it('al llegar al final no toca ninguna y deja de cambiar', () => {
    const run = simulate(tokens, script.totalUnits)
    run.step(40_000, 120)
    expect(run.cursor).toEqual({ read: 60, current: -1 })
  })
})

describe('texto largo (unos 5 minutos)', () => {
  const script = parseScript(LONG)
  const tokens = flattenTokens(script)

  it('750 palabras en 10 párrafos', () => {
    expect(script.words).toBe(750)
    expect(tokens).toHaveLength(750)
  })

  it('leerlo entero toca unos dos trozos por palabra y nunca más de dos por fotograma', () => {
    const run = simulate(tokens, script.totalUnits)
    run.step(6 * 60_000, 140)
    expect(run.cursor).toEqual({ read: 750, current: -1 })
    expect(run.state.maxPerFrame).toBeLessThanOrEqual(2)
    // Dos por palabra y uno más al entrar y al salir de cada pausa de párrafo.
    expect(run.state.written).toBeLessThanOrEqual(2 * tokens.length + 2 * script.pauses)
  })

  it('buscar la palabra es barato (búsqueda binaria)', () => {
    const t0 = performance.now()
    let sum = 0
    for (let i = 0; i < 100_000; i++) sum += wordCursorAt(tokens, (i * 0.0123) % script.totalUnits).read
    const ms = performance.now() - t0
    expect(sum).toBeGreaterThan(0)
    // 100 000 búsquedas (≈ 28 minutos a 60 fps) en mucho menos que un fotograma por búsqueda.
    expect(ms).toBeLessThan(500)
  })
})
