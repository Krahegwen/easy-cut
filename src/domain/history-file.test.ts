import { describe, expect, it } from 'vitest'
import { createHistory, pushState, undo } from './history'
import { parseHistoryFile, SAVED_HISTORY_STEPS, serializeHistoryFile } from './history-file'
import { addClip, createClip, createProject, setSpeed, syncMediaPool, type Project } from './project'
import { fakeMedia } from './test-helpers'

const v = fakeMedia({ path: 'C:\\v.mp4' })

function steps(n: number) {
  let h = createHistory<Project>(createProject())
  let p = syncMediaPool(addClip(createProject(), createClip(v, 'a')), { [v.path]: v })
  h = pushState(h, p)
  for (let i = 0; i < n; i++) {
    p = setSpeed(p, 'a', i % 2 === 0 ? 2 : 1)
    h = pushState(h, p)
  }
  return h
}

describe('historial de deshacer guardado', () => {
  it('ida y vuelta: los mismos pasos de deshacer y de rehacer', () => {
    const h = undo(steps(3))
    const back = parseHistoryFile(serializeHistoryFile(h), h.present)!
    expect(back.past).toEqual(h.past)
    expect(back.future).toEqual(h.future)
    expect(back.present).toBe(h.present)
  })

  it('solo vale para el proyecto de ahora', () => {
    const h = steps(2)
    const other = setSpeed(h.present, 'a', 4)
    expect(parseHistoryFile(serializeHistoryFile(h), other)).toBeNull()
    expect(parseHistoryFile(null, h.present)).toBeNull()
    expect(parseHistoryFile('{roto', h.present)).toBeNull()
    expect(parseHistoryFile('{"kind":"otra"}', h.present)).toBeNull()
  })

  it('guarda los pasos más cercanos', () => {
    const h = steps(SAVED_HISTORY_STEPS + 10)
    const back = parseHistoryFile(serializeHistoryFile(h), h.present)!
    expect(back.past).toHaveLength(SAVED_HISTORY_STEPS)
    expect(back.past[back.past.length - 1]).toEqual(h.past[h.past.length - 1])
  })

  it('un paso dañado corta el historial ahí (deshacer nunca se salta un paso)', () => {
    const h = steps(3)
    const file = JSON.parse(serializeHistoryFile(h))
    file.past[1] = '{roto'
    const back = parseHistoryFile(JSON.stringify(file), h.present)!
    expect(back.past).toHaveLength(h.past.length - 2)
  })
})
