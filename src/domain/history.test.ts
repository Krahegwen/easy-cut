import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, createHistory, pushState, redo, replaceState, undo } from './history'

describe('historial', () => {
  it('deshace y rehace', () => {
    let h = createHistory({ n: 0 })
    h = pushState(h, { n: 1 })
    h = pushState(h, { n: 2 })
    expect(canUndo(h)).toBe(true)
    h = undo(h)
    expect(h.present).toEqual({ n: 1 })
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present).toEqual({ n: 2 })
    expect(canRedo(h)).toBe(false)
  })

  it('un cambio nuevo borra lo que se podía rehacer', () => {
    let h = createHistory(0)
    h = pushState(h, 1)
    h = undo(h)
    h = pushState(h, 5)
    expect(canRedo(h)).toBe(false)
    expect(h.past).toEqual([0])
  })

  it('sin nada que deshacer o rehacer devuelve lo mismo', () => {
    const h = createHistory('a')
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
    expect(pushState(h, 'a')).toBe(h)
  })

  it('respeta el límite', () => {
    let h = createHistory(0, 3)
    for (let i = 1; i <= 10; i++) h = pushState(h, i)
    expect(h.past).toEqual([7, 8, 9])
  })

  it('replaceState no crea entrada', () => {
    let h = createHistory(0)
    h = replaceState(h, 1)
    expect(h.present).toBe(1)
    expect(canUndo(h)).toBe(false)
  })
})
