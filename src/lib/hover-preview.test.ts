import { describe, expect, it } from 'vitest'
import { createHoverPreview, HOVER_DELAY_MS, HOVER_FETCH_MAX_BYTES, hoverSoundPlan, type HoverTimers } from './hover-preview'

/** Temporizadores de mentira: el tiempo solo avanza con `advance`. */
function fakeTimers() {
  let now = 0
  let next = 1
  const queue = new Map<number, { at: number; fn: () => void }>()
  const timers: HoverTimers = {
    setTimeout(fn, ms) {
      const id = next++
      queue.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(h) {
      queue.delete(h as number)
    },
  }
  function advance(ms: number) {
    const end = now + ms
    for (;;) {
      const due = [...queue.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      queue.delete(due[0])
      now = due[1].at
      due[1].fn()
    }
    now = end
  }
  return { timers, advance, pendingCount: () => queue.size }
}

function setup({ allowed = () => true }: { allowed?: (k: string) => boolean } = {}) {
  const t = fakeTimers()
  const log: string[] = []
  const signals = new Map<string, AbortSignal>()
  const hover = createHoverPreview<string>(
    {
      start(k, signal) {
        log.push(`start ${k}`)
        signals.set(k, signal)
      },
      stop(k) {
        log.push(`stop ${k}`)
      },
      allowed,
    },
    { timers: t.timers },
  )
  return { ...t, log, signals, hover }
}

describe('probar pasando el ratón por encima', () => {
  it('empieza tras el retardo y para al salir', () => {
    const { hover, advance, log } = setup()
    hover.enter('a')
    advance(HOVER_DELAY_MS - 1)
    expect(log).toEqual([])
    expect(hover.pending).toBe('a')
    advance(1)
    expect(log).toEqual(['start a'])
    expect(hover.active).toBe('a')
    hover.leave('a')
    expect(log).toEqual(['start a', 'stop a'])
    expect(hover.active).toBeNull()
  })

  it('cruzar la lista deprisa no hace sonar nada', () => {
    const { hover, advance, log, pendingCount } = setup()
    for (const k of ['a', 'b', 'c', 'd']) {
      hover.enter(k)
      advance(120)
      hover.leave(k)
    }
    advance(5000)
    expect(log).toEqual([])
    expect(pendingCount()).toBe(0)
  })

  it('uno solo a la vez: entrar en otra para la anterior (aunque no se haya salido de ella)', () => {
    const { hover, advance, log } = setup()
    hover.enter('a')
    advance(HOVER_DELAY_MS)
    hover.enter('b')
    expect(log).toEqual(['start a', 'stop a'])
    advance(HOVER_DELAY_MS)
    expect(log).toEqual(['start a', 'stop a', 'start b'])
    // Volver a entrar en la que suena no la reinicia.
    hover.enter('b')
    advance(HOVER_DELAY_MS * 3)
    expect(log).toEqual(['start a', 'stop a', 'start b'])
  })

  it('salir antes de que llegue el fichero aborta la prueba con «leave»', () => {
    const { hover, advance, signals } = setup()
    hover.enter('a')
    advance(HOVER_DELAY_MS)
    const s = signals.get('a')!
    expect(s.aborted).toBe(false)
    hover.leave('a')
    expect(s.aborted).toBe(true)
    expect(s.reason).toBe('leave')
  })

  it('pulsar el botón manda: no se para lo que suena por el botón ni se cancela su descarga, y no vuelve a empezar sola', () => {
    const { hover, advance, log, signals } = setup()
    hover.enter('a')
    advance(HOVER_DELAY_MS)
    hover.claim('a')
    expect(log).toEqual(['start a'])
    expect(signals.get('a')!.reason).toBe('claimed')
    expect(hover.active).toBeNull()
    // Seguir encima, o moverse dentro de la tarjeta, no la vuelve a lanzar.
    hover.enter('a')
    advance(HOVER_DELAY_MS * 2)
    expect(log).toEqual(['start a'])
    // Al salir y volver, sí.
    hover.leave('a')
    hover.enter('a')
    advance(HOVER_DELAY_MS)
    expect(log).toEqual(['start a', 'start a'])
  })

  it('pulsar antes de que acabe la espera la cancela', () => {
    const { hover, advance, log } = setup()
    hover.enter('a')
    advance(100)
    hover.claim('a')
    advance(HOVER_DELAY_MS)
    expect(log).toEqual([])
  })

  it('release lo corta todo; allowed puede impedirlo (p. ej. con el vídeo reproduciéndose)', () => {
    let ok = false
    const { hover, advance, log, signals } = setup({ allowed: () => ok })
    hover.enter('a')
    advance(HOVER_DELAY_MS)
    expect(log).toEqual([])
    ok = true
    hover.leave('a')
    hover.enter('a')
    advance(HOVER_DELAY_MS)
    expect(log).toEqual(['start a'])
    hover.release()
    expect(log).toEqual(['start a', 'stop a'])
    expect(signals.get('a')!.reason).toBe('released')
    hover.enter('b')
    hover.release()
    advance(HOVER_DELAY_MS)
    expect(log).toEqual(['start a', 'stop a'])
  })

  it('si empezar falla, no se queda como activo', async () => {
    const t = fakeTimers()
    const hover = createHoverPreview<string>({ start: () => Promise.reject(new Error('sin red')), stop: () => {} }, { timers: t.timers })
    hover.enter('a')
    t.advance(HOVER_DELAY_MS)
    expect(hover.active).toBe('a')
    await Promise.resolve()
    await Promise.resolve()
    expect(hover.active).toBeNull()
  })

  it('solo se trae al pasar por encima lo pequeño; lo descargado suena ya', () => {
    expect(hoverSoundPlan({ bytes: 10_000_000 }, true)).toBe('play')
    expect(hoverSoundPlan({ bytes: 80_000 }, false)).toBe('fetch')
    expect(hoverSoundPlan({ bytes: HOVER_FETCH_MAX_BYTES + 1 }, false)).toBe('skip')
  })
})
