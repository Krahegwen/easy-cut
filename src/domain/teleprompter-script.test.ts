import { describe, expect, it } from 'vitest'
import {
  adviseFit,
  advanceUnits,
  clampWpm,
  describeScriptLength,
  fitIsReasonable,
  pacePhrase,
  fitWpm,
  groupIntoLines,
  lineIndexAt,
  PACE_WPM,
  PARAGRAPH_PAUSE_UNITS,
  paceName,
  parseScript,
  presetWpm,
  readingProgress,
  rewindUnits,
  roughDuration,
  roughWordCount,
  scriptDurationMs,
  scrollYAt,
  wordsOverAt,
  type PrompterLine,
} from './teleprompter'

const words = (n: number) => Array.from({ length: n }, () => 'palabra').join(' ')

describe('guion', () => {
  it('parte en párrafos y trozos con su avance', () => {
    const s = parseScript('Hola, ¿qué tal?\nSegunda línea.\n\n\n  Otro — párrafo.  ')
    expect(s.paragraphs).toHaveLength(2)
    expect(s.words).toBe(7)
    expect(s.pauses).toBe(1)
    expect(s.totalUnits).toBe(7 + PARAGRAPH_PAUSE_UNITS)
    const [p1, p2] = s.paragraphs
    expect(p1!.tokens.map((t) => t.text)).toEqual(['Hola,', '¿qué', 'tal?', 'Segunda', 'línea.'])
    expect(p1!.tokens[3]!.lineBreakBefore).toBe(true)
    expect(p1!.tokens[1]!.lineBreakBefore).toBe(false)
    // La raya no cuenta como palabra, pero se pinta.
    expect(p2!.tokens.map((t) => [t.text, t.unitStart, t.units])).toEqual([
      ['Otro', 5 + PARAGRAPH_PAUSE_UNITS, 1],
      ['—', 6 + PARAGRAPH_PAUSE_UNITS, 0],
      ['párrafo.', 6 + PARAGRAPH_PAUSE_UNITS, 1],
    ])
  })

  it('texto vacío y finales de línea de Windows', () => {
    expect(parseScript('   \n\n ')).toMatchObject({ paragraphs: [], words: 0, pauses: 0, totalUnits: 0 })
    const s = parseScript('uno dos\r\n\r\ntres')
    expect(s.paragraphs).toHaveLength(2)
    expect(s.totalUnits).toBe(3 + PARAGRAPH_PAUSE_UNITS)
  })

  it('duración con las pausas de párrafo', () => {
    expect(scriptDurationMs(parseScript(words(140)), 140)).toBe(60_000)
    const s = parseScript(`${words(69)}\n\n${words(69)}`)
    expect(scriptDurationMs(s, 140)).toBe(60_000)
  })
})

describe('ritmo', () => {
  it('preajustes y ajustado al tiempo', () => {
    const s = parseScript(words(300))
    expect(presetWpm('slow', s, null)).toBe(115)
    expect(presetWpm('normal', s, null)).toBe(140)
    expect(presetWpm('fast', s, 120_000)).toBe(165)
    expect(fitWpm(s, 120_000)).toBe(150)
    expect(presetWpm('fit', s, 120_000)).toBe(150)
    // Sin duración máxima, o si saldría un ritmo imposible, el normal.
    expect(presetWpm('fit', s, null)).toBe(PACE_WPM.normal)
    expect(presetWpm('fit', s, 60_000)).toBe(PACE_WPM.normal)
    expect(fitIsReasonable(300)).toBe(false)
    expect(fitIsReasonable(100)).toBe(true)
    expect(clampWpm(500)).toBe(220)
    expect(clampWpm(10)).toBe(80)
  })

  it('nombres llanos del ritmo', () => {
    expect(paceName(115)).toBe('despacio')
    expect(paceName(140)).toBe('normal')
    expect(paceName(165)).toBe('rápido')
    expect(paceName(200)).toBe('muy rápido')
    expect(paceName(90)).toBe('muy despacio')
  })

  it('frase de palabras y duración', () => {
    expect(describeScriptLength(parseScript(words(320)), 140, pacePhrase('normal', 0))).toBe('320 palabras · leyéndolo a ritmo normal dura unos 2 min 20 s')
    expect(describeScriptLength(parseScript('hola'), 140, pacePhrase('slow', 0))).toBe('1 palabra · leyéndolo despacio dura unos 5 s')
    expect(describeScriptLength(parseScript(words(12_000)), 140, 'x')).toMatch(/^12\.000 palabras/)
    expect(describeScriptLength(parseScript(''), 140, 'x')).toBe('Todavía no hay texto')
    expect(pacePhrase('fast', 0)).toBe('rápido')
    expect(pacePhrase('fast', 1)).toBe('a tu ritmo')
  })

  it('redondeos amables', () => {
    expect(roughDuration(137_000)).toBe(140_000)
    expect(roughDuration(22_000)).toBe(20_000)
    expect(roughDuration(1_000)).toBe(5_000)
    expect(roughWordCount(12.2)).toBe(13)
    expect(roughWordCount(83)).toBe(90)
  })

  it('¿cabe en la duración máxima?', () => {
    // 5 minutos a 150 palabras por minuto = 750 palabras como mucho a ritmo cómodo.
    expect(adviseFit(parseScript(words(700)), 300_000)).toMatchObject({
      kind: 'comfortable',
      title: 'Para que quepa en 5 minutos tienes que leer a ritmo cómodo',
      hint: null,
      wordsToCut: 0,
    })
    const hurried = adviseFit(parseScript(words(800)), 300_000)
    expect(hurried).toMatchObject({ kind: 'hurried', title: 'Para que quepa en 5 minutos tienes que leer un poco rápido', wordsToCut: 50 })
    expect(hurried.hint).toBe('Si quitas unas 50 palabras, podrás leer a ritmo cómodo.')
    const tooLong = adviseFit(parseScript(words(900)), 300_000)
    expect(tooLong).toMatchObject({ kind: 'too-long', title: 'No da tiempo: te sobran unas 150 palabras', wordsToCut: 150 })
    expect(tooLong.hint).toContain('alarga la duración máxima')
    expect(adviseFit(parseScript(words(100)), 300_000).kind).toBe('plenty')
    expect(adviseFit(parseScript(words(560)), 300_000)).toMatchObject({ kind: 'easy', title: 'Para que quepa en 5 minutos puedes leer despacio, con calma' })
    expect(adviseFit(parseScript(words(100)), 150_000).title).toContain('2 minutos y 30 segundos')
  })

  it('las pausas de párrafo cuentan al ver cuántas palabras sobran', () => {
    const s = parseScript(Array.from({ length: 6 }, () => words(25)).join('\n\n'))
    expect(s.pauses).toBe(5)
    // En 1 minuto a 150 caben 150 avances: 10 son pausas, así que caben 140 palabras de 150.
    expect(wordsOverAt(s, 60_000, 150)).toBe(10)
  })
})

describe('scroll proporcional', () => {
  const lines: PrompterLine[] = [
    { centerY: 20, unitStart: 0 },
    { centerY: 60, unitStart: 10 },
    { centerY: 100, unitStart: 12 },
  ]

  it('agrupa los trozos medidos en líneas', () => {
    expect(
      groupIntoLines([
        { top: 0, height: 40, unitStart: 0 },
        { top: 1, height: 40, unitStart: 1 },
        { top: 40, height: 40, unitStart: 2 },
        { top: 40, height: 40, unitStart: 3 },
        { top: 120, height: 40, unitStart: 6 },
      ]),
    ).toEqual([
      { centerY: 20, unitStart: 0 },
      { centerY: 60, unitStart: 2 },
      { centerY: 140, unitStart: 6 },
    ])
  })

  it('la velocidad la marcan las palabras de cada línea, no los píxeles', () => {
    expect(scrollYAt(lines, 15, 0)).toBe(20)
    expect(scrollYAt(lines, 15, 5)).toBe(40)
    // La línea 2 tiene solo 2 palabras: recorre los mismos 40 px en una quinta parte del tiempo.
    expect(scrollYAt(lines, 15, 11)).toBe(80)
    expect(scrollYAt(lines, 15, 12)).toBe(100)
    // La última se queda en la línea de lectura.
    expect(scrollYAt(lines, 15, 14)).toBe(100)
    expect(scrollYAt(lines, 15, 99)).toBe(100)
    expect(scrollYAt([], 0, 3)).toBe(0)
    expect(scrollYAt(lines, 15, -1)).toBe(20)
  })

  it('retroceder un poco vuelve dos líneas atrás', () => {
    expect(lineIndexAt(lines, 13)).toBe(2)
    expect(rewindUnits(lines, 13)).toBe(0)
    expect(rewindUnits(lines, 13, 1)).toBe(10)
    expect(rewindUnits(lines, 3)).toBe(0)
  })

  it('avance según el tiempo y el ritmo', () => {
    expect(advanceUnits(0, 60_000, 140, 1000)).toBe(140)
    expect(advanceUnits(0, 30_000, 140, 1000)).toBe(70)
    expect(advanceUnits(990, 60_000, 140, 1000)).toBe(1000)
    expect(advanceUnits(5, 0, 140, 1000)).toBe(5)
  })
})

describe('¿vas bien o vas tarde?', () => {
  const base = { totalUnits: 700, wpm: 140, targetMs: 300_000 }

  it('vas bien si lo que falta cabe en lo que queda', () => {
    const p = readingProgress({ ...base, elapsedMs: 60_000, units: 140 })
    expect(p).toMatchObject({ status: 'ok', message: 'Vas bien', remainingMs: 240_000, tone: 'normal' })
    expect(p.projectedOverMs).toBe(0)
  })

  it('vas tarde: cuántos segundos y qué hacer', () => {
    // Tras 1 minuto 15 s solo va por 140 palabras: le faltan 560 = 4 min → se pasaría 15 s.
    const p = readingProgress({ ...base, elapsedMs: 75_000, units: 140 })
    expect(p).toMatchObject({ status: 'behind', message: 'Vas 15 segundos por detrás: acelera un poco', tone: 'warn' })
    // Un par de segundos de margen no cuentan.
    expect(readingProgress({ ...base, elapsedMs: 63_000, units: 140 }).status).toBe('ok')
  })

  it('cerca del final cambia de color, y al pasarse avisa sin cortar', () => {
    expect(readingProgress({ ...base, elapsedMs: 280_000, units: 660 })).toMatchObject({ status: 'ok', tone: 'warn' })
    expect(readingProgress({ ...base, elapsedMs: 300_500, units: 690 })).toMatchObject({
      status: 'over',
      tone: 'danger',
      message: 'Has llegado a 5 minutos: termina en cuanto puedas',
    })
  })

  it('texto terminado y sin duración máxima', () => {
    expect(readingProgress({ ...base, elapsedMs: 200_000, units: 700 })).toMatchObject({ status: 'finished', message: 'Has terminado el texto. Pulsa Terminar' })
    expect(readingProgress({ ...base, targetMs: null, elapsedMs: 10_000, units: 5 })).toMatchObject({ status: 'free', remainingMs: null, message: '' })
    expect(readingProgress({ ...base, targetMs: null, elapsedMs: 10_000, units: 700 }).status).toBe('finished')
  })
})
