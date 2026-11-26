import { describe, expect, it } from 'vitest'
import { DEFAULT_SPLIT, fractionFor, LIBRARY_MIN_BOTTOM_PX, LIBRARY_TOP_PX, loadSplit, MIN_BOTTOM_PX, MIN_TOP_PX, nearestPreset, saveSplit, SPLIT_PRESETS, topHeightPx } from './preview-split'

describe('reparto entre vista previa y pistas', () => {
  it('respeta los mínimos de los dos lados', () => {
    expect(topHeightPx(0.5, 600)).toBe(300)
    expect(topHeightPx(0.05, 600)).toBe(MIN_TOP_PX)
    expect(topHeightPx(0.95, 600)).toBe(600 - MIN_BOTTOM_PX)
    // Si no caben los dos mínimos, a partes iguales.
    expect(topHeightPx(0.8, 300)).toBe(150)
  })

  it('con la biblioteca abierta, arriba crece hasta lo cómodo si cabe', () => {
    expect(topHeightPx(SPLIT_PRESETS.small, 900, { library: true })).toBe(LIBRARY_TOP_PX)
    // En una ventana baja, lo que deje el mínimo de las pistas.
    expect(topHeightPx(SPLIT_PRESETS.small, 590, { library: true })).toBe(590 - LIBRARY_MIN_BOTTOM_PX)
    // Si ya era más grande, no se encoge.
    expect(topHeightPx(0.8, 1000, { library: true })).toBe(800)
  })

  it('arrastrar da una fracción dentro de los límites; los tamaños fijos se reconocen', () => {
    expect(fractionFor(300, 600)).toBe(0.5)
    expect(fractionFor(10, 600)).toBeCloseTo(MIN_TOP_PX / 600)
    expect(fractionFor(590, 600)).toBeCloseTo((600 - MIN_BOTTOM_PX) / 600)
    expect(fractionFor(100, 0)).toBe(DEFAULT_SPLIT)
    expect(nearestPreset(0.5)).toBe('medium')
    expect(nearestPreset(0.645)).toBe('large')
    expect(nearestPreset(0.43)).toBeNull()
  })

  it('se recuerda, y si no se puede leer o está dañado, el de serie', () => {
    const data = new Map<string, string>()
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
    expect(loadSplit(storage)).toBe(DEFAULT_SPLIT)
    saveSplit(0.4123, storage)
    expect(loadSplit(storage)).toBe(0.412)
    data.set('easy-cut.preview-split', 'basura')
    expect(loadSplit(storage)).toBe(DEFAULT_SPLIT)
    const broken = {
      getItem: () => {
        throw new Error('sin acceso')
      },
      setItem: () => {
        throw new Error('sin cuota')
      },
    }
    expect(loadSplit(broken)).toBe(DEFAULT_SPLIT)
    expect(() => saveSplit(0.3, broken)).not.toThrow()
    expect(loadSplit(null)).toBe(DEFAULT_SPLIT)
  })
})
