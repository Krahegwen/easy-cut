import { describe, expect, it } from 'vitest'
import { classifyPace, countWords, estimateDurationMs, planTeleprompter, requiredWpm, scrollSpeedPxPerSec } from './teleprompter'

describe('teleprompter', () => {
  it('cuenta palabras en castellano', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n ')).toBe(0)
    expect(countWords('¡Hola, María! ¿Qué tal estás?')).toBe(5)
    expect(countWords('El niño comió pingüino — o no.')).toBe(6)
    expect(countWords('Un texto teórico-práctico de 2026')).toBe(5)
    expect(countWords('Línea uno\nlínea dos\tfin')).toBe(5)
  })

  it('duración estimada y ritmo necesario', () => {
    expect(estimateDurationMs(140)).toBe(60_000)
    expect(estimateDurationMs(70, 140)).toBe(30_000)
    expect(estimateDurationMs(0)).toBe(0)
    expect(requiredWpm(300, 120_000)).toBe(150)
    expect(requiredWpm(10, 0)).toBe(Infinity)
  })

  it('clasifica el ritmo', () => {
    expect(classifyPace(90)).toMatchObject({ pace: 'very-slow', label: 'muy lento', natural: false })
    expect(classifyPace(110).pace).toBe('comfortable')
    expect(classifyPace(170)).toMatchObject({ pace: 'comfortable', natural: true })
    expect(classifyPace(190)).toMatchObject({ pace: 'fast', label: 'rápido' })
    expect(classifyPace(250)).toMatchObject({ pace: 'too-fast', label: 'no da tiempo' })
    expect(classifyPace(Infinity).pace).toBe('too-fast')
  })

  it('velocidad de scroll', () => {
    expect(scrollSpeedPxPerSec(3000, 60_000)).toBe(50)
    expect(scrollSpeedPxPerSec(1000, 30_000)).toBe(33.33)
    expect(scrollSpeedPxPerSec(1000, 0)).toBe(0)
  })

  it('plan completo con objetivo', () => {
    const text = Array.from({ length: 280 }, () => 'palabra').join(' ')
    const plan = planTeleprompter(text, { targetMs: 60_000 })
    expect(plan.words).toBe(280)
    expect(plan.estimatedMs).toBe(120_000)
    expect(plan.target).toMatchObject({ wpm: 280, pace: 'too-fast', targetMs: 60_000 })
    expect(planTeleprompter(text).target).toBeNull()
  })
})
