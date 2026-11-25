import { describe, expect, it } from 'vitest'
import { clipMatchesAspect, closestAspect, computeFramingLayout, dominantAspect, fitAspect, panOffset } from './layout'
import { createClip, rotateClip, setFraming, addClip, createProject, type Clip } from './project'
import { fakeMedia } from './test-helpers'

const horizontal = fakeMedia({ path: 'h.mp4', width: 1920, height: 1080 })
const vertical = fakeMedia({ path: 'v.mp4', width: 1080, height: 1920 })

function clipWith(change: (p: ReturnType<typeof createProject>) => ReturnType<typeof createProject>, media = horizontal): Clip {
  const p = change(addClip(createProject(), createClip(media, 'c')))
  return p.clips[0]!
}

describe('formas', () => {
  it('forma más cercana', () => {
    expect(closestAspect(1920, 1080)).toBe('16:9')
    expect(closestAspect(1440, 1080)).toBe('16:9') // 4:3 cuenta como horizontal
    expect(closestAspect(1080, 1920)).toBe('9:16')
    expect(closestAspect(1080, 1080)).toBe('1:1')
    expect(closestAspect(1100, 1000)).toBe('1:1')
    expect(closestAspect(0, 0)).toBe('16:9')
  })

  it('la de la mayoría; empate, la del primero', () => {
    expect(dominantAspect([])).toBe('16:9')
    expect(dominantAspect([vertical, horizontal, vertical])).toBe('9:16')
    expect(dominantAspect([vertical, horizontal])).toBe('9:16')
    expect(dominantAspect([horizontal, vertical])).toBe('16:9')
  })

  it('¿coincide el trozo con la forma del vídeo? (con giro)', () => {
    const c = clipWith((p) => p)
    expect(clipMatchesAspect(c, horizontal, '16:9')).toBe(true)
    expect(clipMatchesAspect(c, horizontal, '9:16')).toBe(false)
    const turned = clipWith((p) => rotateClip(p, 'c', 1))
    expect(clipMatchesAspect(turned, horizontal, '9:16')).toBe(true)
  })

  it('rectángulo que cabe', () => {
    expect(fitAspect('16:9', 1600, 1600)).toEqual({ width: 1600, height: 900 })
    expect(fitAspect('9:16', 1600, 800)).toEqual({ width: 450, height: 800 })
    expect(fitAspect('1:1', 0, 100)).toEqual({ width: 0, height: 0 })
  })
})

describe('encuadre en la vista previa', () => {
  it('horizontal en marco horizontal: lo llena sin fondo', () => {
    const l = computeFramingLayout(clipWith((p) => p), horizontal, 640, 360)
    expect(l).toMatchObject({ left: 0, top: 0, width: 640, height: 360, showsBackground: false, canPanX: false })
  })

  it('vertical en marco horizontal, «que se vea entero»: centrado con fondo', () => {
    const l = computeFramingLayout(clipWith((p) => p, vertical), vertical, 640, 360)
    expect(l.height).toBeCloseTo(360)
    expect(l.width).toBeCloseTo(202.5)
    expect(l.left).toBeCloseTo((640 - 202.5) / 2)
    expect(l.showsBackground).toBe(true)
  })

  it('«que llene la pantalla»: se sale y se puede mover en vertical', () => {
    const c = clipWith((p) => setFraming(p, 'c', { mode: 'fill', offsetY: -1 }), vertical)
    const l = computeFramingLayout(c, vertical, 640, 360)
    expect(l.width).toBeCloseTo(640)
    expect(l.height).toBeCloseTo(640 * (1920 / 1080))
    expect(l.top).toBe(-0) // pegado arriba
    expect(l.canPanY).toBe(true)
    expect(l.showsBackground).toBe(false)
    const bottom = computeFramingLayout(clipWith((p) => setFraming(p, 'c', { mode: 'fill', offsetY: 1 }), vertical), vertical, 640, 360)
    expect(bottom.top + bottom.height).toBeCloseTo(360)
  })

  it('girado: el elemento lleva ancho y alto cambiados', () => {
    const c = clipWith((p) => rotateClip(p, 'c', 1))
    const l = computeFramingLayout(c, horizontal, 360, 640)
    expect(l.rotationDeg).toBe(90)
    expect(l.width).toBeCloseTo(360)
    expect(l.height).toBeCloseTo(640)
    expect(l.elementWidth).toBeCloseTo(640)
    expect(l.elementHeight).toBeCloseTo(360)
  })

  it('zoom: se sale por los dos lados y arrastrar cambia el desplazamiento', () => {
    const c = clipWith((p) => setFraming(p, 'c', { zoom: 2 }))
    const l = computeFramingLayout(c, horizontal, 640, 360)
    expect(l.width).toBeCloseTo(1280)
    expect(l.left).toBeCloseTo(-320)
    expect(l.canPanX && l.canPanY).toBe(true)
    // Arrastrar 320 px a la derecha enseña el borde izquierdo (offset −1).
    expect(panOffset(l, 640, 360, { offsetX: 0, offsetY: 0 }, 320, 0)).toEqual({ offsetX: -1, offsetY: 0 })
    expect(panOffset(l, 640, 360, { offsetX: 0, offsetY: 0 }, -10_000, 90)).toEqual({ offsetX: 1, offsetY: -0.5 })
    // Sin imagen sobrante no se mueve.
    const fit = computeFramingLayout(clipWith((p) => p), horizontal, 640, 360)
    expect(panOffset(fit, 640, 360, { offsetX: 0.2, offsetY: 0 }, 50, 50)).toEqual({ offsetX: 0.2, offsetY: 0 })
  })
})
