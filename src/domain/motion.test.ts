import { describe, expect, it } from 'vitest'
import {
  afadeCurve,
  ease,
  easeExpr,
  easingPoints,
  fadeGainAt,
  fadeGainExpr,
  fadeLengthOf,
  MOTION_EASINGS,
  num,
  valueAt,
  valueExpr,
  type Fades,
  type MotionEasing,
  type TimedValue,
} from './motion'

/** Evalúa una expresión de ffmpeg sencilla (las que se generan aquí) en JavaScript, para compararla. */
function evalFfExpr(expr: string, t: number): number {
  const js = expr
    .replace(/PI/g, 'Math.PI')
    .replace(/\bcos\(/g, 'Math.cos(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bclip\(/g, '__clip(')
    .replace(/\bif\(/g, '__if(')
    .replace(/\blt\(/g, '__lt(')
    .replace(/\bgte\(/g, '__gte(')
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    't',
    '__clip',
    '__if',
    '__lt',
    '__gte',
    `return ${js}`,
  ) as (t: number, c: unknown, i: unknown, l: unknown, g: unknown) => number
  return fn(
    t,
    (x: number, a: number, b: number) => Math.min(b, Math.max(a, x)),
    (c: number, a: number, b: number) => (c ? a : b),
    (a: number, b: number) => (a < b ? 1 : 0),
    (a: number, b: number) => (a >= b ? 1 : 0),
  )
}

describe('curvas', () => {
  it('van de 0 a 1 y tienen la forma que dicen', () => {
    for (const e of MOTION_EASINGS) {
      expect(ease(e, 0)).toBe(0)
      expect(ease(e, 1)).toBe(1)
    }
    expect(ease('linear', 0.25)).toBeCloseTo(0.25)
    // «Empieza despacio»: a la mitad del camino aún va por la cuarta parte.
    expect(ease('ease-in', 0.5)).toBeCloseTo(0.25)
    // «Acaba despacio»: a la mitad ya va por las tres cuartas partes.
    expect(ease('ease-out', 0.5)).toBeCloseTo(0.75)
    // «Suave»: simétrica, despacio en los dos extremos.
    expect(ease('smooth', 0.5)).toBeCloseTo(0.5)
    expect(ease('smooth', 0.1)).toBeLessThan(0.1)
    expect(ease('smooth', 0.9)).toBeGreaterThan(0.9)
    // «De golpe»: quieto hasta llegar.
    expect(ease('step', 0.99)).toBe(0)
  })

  it('se sujetan fuera de 0..1', () => {
    expect(ease('ease-out', -1)).toBe(0)
    expect(ease('ease-in', 2)).toBe(1)
    expect(ease('linear', Number.NaN)).toBe(0)
  })

  it('dan los puntos del dibujito', () => {
    const pts = easingPoints('ease-in', 4)
    expect(pts).toHaveLength(5)
    expect(pts[2]).toEqual({ x: 0.5, y: 0.25 })
    expect(easingPoints('step')).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])
  })

  it('las tres duraciones', () => {
    expect(fadeLengthOf(500)).toBe('short')
    expect(fadeLengthOf(1000)).toBe('medium')
    expect(fadeLengthOf(2000)).toBe('long')
    expect(fadeLengthOf(750)).toBeNull()
  })
})

describe('aparecer y desaparecer', () => {
  const f: Fades = { fadeInMs: 1000, fadeOutMs: 2000, fadeInEasing: 'ease-in', fadeOutEasing: 'ease-out' }

  it('sube con la curva de entrada y baja con la de salida', () => {
    expect(fadeGainAt(f, 0, 10_000)).toBe(0)
    expect(fadeGainAt(f, 500, 10_000)).toBeCloseTo(0.25)
    expect(fadeGainAt(f, 1000, 10_000)).toBe(1)
    expect(fadeGainAt(f, 5000, 10_000)).toBe(1)
    // Salida «Acaba despacio»: a la mitad de la salida ya ha bajado tres cuartas partes.
    expect(fadeGainAt(f, 9000, 10_000)).toBeCloseTo(0.25)
    expect(fadeGainAt(f, 10_000, 10_000)).toBe(0)
  })

  it('lineal es la de siempre (lo de antes no cambia)', () => {
    const lin: Fades = { fadeInMs: 1000, fadeOutMs: 1000, fadeInEasing: 'linear', fadeOutEasing: 'linear' }
    expect(fadeGainAt(lin, 250, 4000)).toBeCloseTo(0.25)
    expect(fadeGainAt(lin, 3500, 4000)).toBeCloseTo(0.5)
  })

  it('si no caben, se reparten', () => {
    expect(fadeGainAt(f, 300, 900)).toBeCloseTo(1 - ease('ease-out', 0))
  })

  it('la expresión de ffmpeg da lo mismo que la vista previa', () => {
    const expr = fadeGainExpr(f, 10_000)!
    for (const ms of [0, 200, 500, 999, 1000, 4000, 8000, 8500, 9000, 9900, 10_000]) {
      expect(evalFfExpr(expr, ms / 1000)).toBeCloseTo(fadeGainAt(f, ms, 10_000), 6)
    }
    for (const e of ['smooth', 'linear'] as const) {
      const g: Fades = { fadeInMs: 500, fadeOutMs: 500, fadeInEasing: e, fadeOutEasing: e }
      const x = fadeGainExpr(g, 3000)!
      for (const ms of [0, 100, 250, 2600, 2900]) expect(evalFfExpr(x, ms / 1000)).toBeCloseTo(fadeGainAt(g, ms, 3000), 6)
    }
    expect(fadeGainExpr({ fadeInMs: 0, fadeOutMs: 0, fadeInEasing: 'linear', fadeOutEasing: 'linear' }, 3000)).toBeNull()
  })

  it('curvas de afade: la de salida es la gemela', () => {
    expect(afadeCurve('linear', 'in')).toBe('tri')
    expect(afadeCurve('smooth', 'out')).toBe('hsin')
    expect(afadeCurve('ease-in', 'in')).toBe('qua')
    expect(afadeCurve('ease-in', 'out')).toBe('ipar')
    expect(afadeCurve('ease-out', 'out')).toBe('qua')
  })
})

describe('valores con marcas', () => {
  const pts: TimedValue[] = [
    { atMs: 1000, value: 0.2, easing: 'linear' },
    { atMs: 3000, value: 0.8, easing: 'smooth' },
    { atMs: 4000, value: 0.5, easing: 'step' },
  ]

  it('antes de la primera y después de la última, quieto', () => {
    expect(valueAt(pts, 0)).toBe(0.2)
    expect(valueAt(pts, 5000)).toBe(0.5)
    expect(valueAt([], 10)).toBe(0)
  })

  it('viaja con la curva de la marca de llegada', () => {
    expect(valueAt(pts, 2000)).toBeCloseTo(0.5)
    expect(valueAt(pts, 1500)).toBeCloseTo(0.2 + 0.6 * ease('smooth', 0.25))
    // «De golpe»: quieto hasta la marca y salta.
    expect(valueAt(pts, 3999)).toBeCloseTo(0.8)
    expect(valueAt(pts, 4000)).toBeCloseTo(0.5)
  })

  it('la expresión de ffmpeg da lo mismo', () => {
    const expr = valueExpr(pts)
    for (const ms of [0, 999, 1000, 1500, 2000, 2999, 3000, 3500, 3999, 4000, 6000]) {
      expect(evalFfExpr(expr, ms / 1000)).toBeCloseTo(valueAt(pts, ms), 6)
    }
    // Con el reloj corrido (el efecto empieza 2 s después en el tramo).
    const shifted = valueExpr(pts, 't', 2000)
    expect(evalFfExpr(shifted, 4.0)).toBeCloseTo(valueAt(pts, 2000), 6)
  })

  it('todas las curvas por ffmpeg', () => {
    for (const e of MOTION_EASINGS as readonly MotionEasing[]) {
      const two: TimedValue[] = [
        { atMs: 0, value: 10, easing: 'linear' },
        { atMs: 1000, value: 110, easing: e },
      ]
      const x = valueExpr(two)
      for (const ms of [0, 100, 400, 700, 999, 1000]) expect(evalFfExpr(x, ms / 1000)).toBeCloseTo(valueAt(two, ms), 6)
    }
  })

  it('números sin notación científica', () => {
    expect(num(0.0000001)).toBe('0')
    expect(num(1e-5)).toBe('0.00001')
    expect(num(-0.5)).toBe('-0.5')
    expect(num(12)).toBe('12')
    expect(easeExpr('ease-in', 'p')).toBe('(p*p)')
  })
})
