import { describe, expect, it } from 'vitest'
import {
  cellContentLayout,
  cellRects,
  cellSourceFromInfo,
  cellTimeAt,
  changeLayout,
  clearCell,
  collageNaturalMs,
  collagePaths,
  COLLAGE_LAYOUTS,
  createCollage,
  emptyCells,
  gapPixels,
  heardCell,
  LAST_FRAME_MS,
  layoutById,
  layoutHasChoice,
  layoutsFor,
  normalizeCollage,
  relinkCollage,
  setCell,
  setCellFit,
  setCellFraming,
  setCellStart,
  setHeardCell,
  suggestLayout,
  swapCells,
  type CellRect,
} from './collage'
import { mediaUsage, relinkMedia, relinkProblem } from './media-pool'
import { addClip, createClip, createProject, parseProject, serializeProject, usedMediaPaths, type CollageCellSource, type Project } from './project'
import { fakeAudio, fakeMedia } from './test-helpers'
import {
  collageDurationFor,
  createCollageItem,
  duplicateItem,
  findItem,
  insertItem,
  resolveTracks,
  setItemRepeat,
  splitItem,
  trackFilePaths,
  trimItemEnd,
  trimItemStart,
  updateCollage,
} from './tracks'

const src = (path: string, durationMs: number, width = 1920, height = 1080, hasAudio = true): CollageCellSource => ({ path, durationMs, still: false, hasAudio, width, height })

function overlap(a: CellRect, b: CellRect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
}

describe('plantillas', () => {
  it('de 2 a 4 huecos; con 4, solo los cuatro cuadrantes (no se pregunta)', () => {
    expect(layoutsFor(2).map((l) => l.id)).toEqual(['side-by-side', 'stacked'])
    expect(layoutsFor(3)).toHaveLength(6)
    expect(layoutsFor(4).map((l) => l.id)).toEqual(['quadrants'])
    expect(layoutHasChoice(2)).toBe(true)
    expect(layoutHasChoice(3)).toBe(true)
    expect(layoutHasChoice(4)).toBe(false)
    expect(layoutsFor(5)).toEqual([])
  })

  it('cada plantilla cubre el collage entero sin solapes', () => {
    for (const layout of COLLAGE_LAYOUTS) {
      expect(layout.cells).toHaveLength(layout.count)
      const rects = cellRects(layout, 1920, 1080, 'none', true)
      const area = rects.reduce((a, r) => a + r.width * r.height, 0)
      expect(area, layout.id).toBe(1920 * 1080)
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!), `${layout.id} ${i}-${j}`).toBe(false)
    }
  })

  it('con separación, píxeles pares, la raya solo entre huecos y los bordes del collage llenos', () => {
    const g = gapPixels('dark', 1920, 1080, true)
    expect(g).toBe(8)
    expect(gapPixels('none', 1920, 1080, true)).toBe(0)
    expect(gapPixels('white', 1280, 720, true)).toBe(4)
    for (const layout of COLLAGE_LAYOUTS) {
      const rects = cellRects(layout, 1920, 1080, 'dark', true)
      for (const r of rects) for (const v of [r.left, r.top, r.width, r.height]) expect(v % 2, layout.id).toBe(0)
      // Lo que toca el borde lo toca de verdad.
      expect(Math.min(...rects.map((r) => r.left))).toBe(0)
      expect(Math.min(...rects.map((r) => r.top))).toBe(0)
      expect(Math.max(...rects.map((r) => r.left + r.width))).toBe(1920)
      expect(Math.max(...rects.map((r) => r.top + r.height))).toBe(1080)
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!)).toBe(false)
    }
    // Uno al lado del otro: la raya en el centro, de g píxeles.
    const [a, b] = cellRects(layoutById('side-by-side')!, 1920, 1080, 'dark', true)
    expect(a).toEqual({ left: 0, top: 0, width: 956, height: 1080 })
    expect(b).toEqual({ left: 964, top: 0, width: 956, height: 1080 })
  })

  it('en la vista previa, los mismos huecos en proporción', () => {
    const big = cellRects(layoutById('big-left')!, 1920, 1080, 'dark', true)
    const small = cellRects(layoutById('big-left')!, 640, 360, 'dark')
    big.forEach((r, i) => {
      expect(small[i]!.left * 3).toBeCloseTo(r.left, -1)
      expect(small[i]!.width * 3).toBeCloseTo(r.width, -1)
    })
  })
})

describe('el vídeo dentro de su hueco', () => {
  it('«Llenar» recorta (centrado y con desplazamiento); «Entero», con bandas', () => {
    const fill = cellContentLayout({ fit: 'fill', zoom: 1, offsetX: 0, offsetY: 0 }, 1920, 1080, 956, 1080, true)
    expect(fill.height).toBe(1080)
    expect(fill.width).toBe(1920)
    expect(fill.left).toBe(-482)
    const left = cellContentLayout({ fit: 'fill', zoom: 1, offsetX: -1, offsetY: 0 }, 1920, 1080, 956, 1080, true)
    expect(left.left).toBe(0)
    const right = cellContentLayout({ fit: 'fill', zoom: 1, offsetX: 1, offsetY: 0 }, 1920, 1080, 956, 1080, true)
    expect(right.left).toBe(956 - 1920)
    const whole = cellContentLayout({ fit: 'whole', zoom: 1, offsetX: 0, offsetY: 0 }, 1920, 1080, 956, 1080, true)
    expect(whole.width).toBe(956)
    expect(whole.height).toBe(538)
    expect(whole.top).toBe(272)
    expect(whole.left).toBe(0)
  })
})

describe('sugerir la distribución', () => {
  it('un vertical va al hueco alto', () => {
    const s = suggestLayout(3, [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1920, height: 1080 }], 1920, 1080)!
    expect(['big-left', 'big-right']).toContain(s.layoutId)
    const layout = layoutById(s.layoutId)!
    const tall = layout.cells.findIndex((c) => c.h === 1)
    expect(s.order[tall]).toBe(1)
  })

  it('en un marco vertical, dos horizontales van uno encima del otro', () => {
    const s = suggestLayout(2, [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }], 1080, 1920)!
    expect(s.layoutId).toBe('stacked')
    expect(s.order).toEqual([0, 1])
  })

  it('en un marco horizontal, dos verticales van uno al lado del otro', () => {
    expect(suggestLayout(2, [{ width: 1080, height: 1920 }, { width: 1080, height: 1920 }], 1920, 1080)!.layoutId).toBe('side-by-side')
  })

  it('sin tamaños conocidos, la primera del catálogo y en su orden', () => {
    expect(suggestLayout(3, [null, null, null], 1920, 1080)).toMatchObject({ layoutId: 'three-columns', order: [0, 1, 2] })
    expect(suggestLayout(4, [null, null, null, null], 1920, 1080)!.layoutId).toBe('quadrants')
  })
})

describe('operaciones con los huecos', () => {
  it('poner, vaciar, intercambiar, encuadre, comienzo', () => {
    let c = createCollage('big-left')
    expect(c.cells).toHaveLength(3)
    expect(c.gap).toBe('dark')
    expect(emptyCells(c)).toEqual([0, 1, 2])
    c = setCell(c, 0, src('a.mp4', 8000))
    c = setCell(c, 2, src('b.mp4', 3000, 1080, 1920))
    expect(emptyCells(c)).toEqual([1])
    expect(collagePaths(c)).toEqual(['a.mp4', 'b.mp4'])
    c = setCellFraming(c, 0, { offsetX: -0.5 })
    c = setCellStart(c, 0, 2000)
    const swapped = swapCells(c, 0, 2)
    expect(swapped.cells[2]!.source!.path).toBe('a.mp4')
    expect(swapped.cells[2]!.offsetX).toBe(-0.5)
    expect(swapped.cells[2]!.startMs).toBe(2000)
    expect(swapped.cells[0]!.source!.path).toBe('b.mp4')
    expect(swapCells(c, 0, 0)).toBe(c)
    expect(swapCells(c, 0, 5)).toBe(c)
    expect(clearCell(swapped, 0).cells[0]!.source).toBeNull()
    expect(setCellFit(c, 0, 'whole').cells[0]).toMatchObject({ fit: 'whole', offsetX: 0 })
    // No se empieza más allá del final.
    expect(setCellStart(c, 2, 9999).cells[2]!.startMs).toBe(3000 - LAST_FRAME_MS)
  })

  it('suena como mucho un hueco, y solo uno con sonido', () => {
    let c = createCollage('side-by-side')
    c = setCell(c, 0, src('a.mp4', 5000))
    c = setCell(c, 1, src('b.mp4', 5000, 1920, 1080, false))
    expect(heardCell(c)).toBeNull()
    c = setHeardCell(c, 0)
    expect(heardCell(c)).toBe(0)
    expect(c.cells.map((x) => x.volume)).toEqual([1, 0])
    expect(setHeardCell(c, 1)).toBe(c)
    expect(heardCell(setHeardCell(c, null))).toBeNull()
    // Intercambiar se lleva el sonido con su vídeo.
    expect(heardCell(swapCells(c, 0, 1))).toBe(1)
  })

  it('otra distribución del mismo número: los vídeos se quedan en su orden (o el de la sugerencia)', () => {
    let c = setCell(setCell(createCollage('three-columns'), 0, src('a.mp4', 1000)), 1, src('b.mp4', 1000))
    const d = changeLayout(c, 'big-top')
    expect(d.layoutId).toBe('big-top')
    expect(d.cells.map((x) => x.source?.path ?? null)).toEqual(['a.mp4', 'b.mp4', null])
    expect(changeLayout(c, 'quadrants')).toBe(c)
    c = changeLayout(c, 'big-left', [2, 0, 1])
    expect(c.cells.map((x) => x.source?.path ?? null)).toEqual([null, 'a.mp4', 'b.mp4'])
  })

  it('un sonido no vale para un hueco; una foto sí', () => {
    expect(cellSourceFromInfo(fakeAudio({ path: 's.m4a' }))).toBeNull()
    expect(cellSourceFromInfo(fakeMedia({ path: 'f.png', isStill: true, durationMs: 0 }))).toMatchObject({ still: true, durationMs: 0, hasAudio: false })
    expect(cellSourceFromInfo(fakeMedia({ path: 'v.mp4', durationMs: 4000 }))).toMatchObject({ still: false, durationMs: 4000 })
  })
})

describe('tiempos', () => {
  it('cada hueco corre desde su comienzo y se queda en su última imagen al acabarse', () => {
    const c = setCellStart(setCell(createCollage('side-by-side'), 0, src('a.mp4', 2000)), 0, 500).cells[0]!
    expect(cellTimeAt(c, 0)).toEqual({ ms: 500, frozen: false })
    expect(cellTimeAt(c, 1000)).toEqual({ ms: 1500, frozen: false })
    expect(cellTimeAt(c, 5000)).toEqual({ ms: 2000 - LAST_FRAME_MS, frozen: true })
    expect(cellTimeAt(createCollage('side-by-side').cells[0]!, 100)).toBeNull()
  })

  it('dura lo del vídeo más largo; sin vídeos, lo de serie', () => {
    let c = createCollage('side-by-side')
    expect(collageNaturalMs(c)).toBeNull()
    c = setCell(c, 0, src('a.mp4', 2000))
    c = setCell(c, 1, src('b.mp4', 6000))
    expect(collageNaturalMs(c)).toBe(6000)
    expect(collageNaturalMs(setCellStart(c, 1, 1000))).toBe(5000)
    expect(collageDurationFor(c)).toBe(6000)
    expect(collageDurationFor(c, 4000)).toBe(4000)
    expect(collageDurationFor(createCollage('stacked'))).toBe(5000)
  })
})

describe('leer un collage guardado', () => {
  it('lo que no se entiende se descarta', () => {
    expect(normalizeCollage(null)).toBeNull()
    expect(normalizeCollage({ layoutId: 'nada', cells: [] })).toBeNull()
    expect(normalizeCollage({ layoutId: 'side-by-side', cells: [{}] })).toBeNull()
    const c = normalizeCollage({ layoutId: 'side-by-side', gap: 'raro', cells: [{ source: { path: 'a.mp4', durationMs: 1000, hasAudio: true }, volume: 1 }, { source: { path: 'b.mp4', durationMs: 1000, hasAudio: true }, volume: 1, fit: 'whole' }] })!
    expect(c.gap).toBe('dark')
    // Dos que suenan: solo el primero.
    expect(c.cells.map((x) => x.volume)).toEqual([1, 0])
    expect(c.cells[1]!.fit).toBe('whole')
  })
})

// Tres trozos de 10 s: 0–10, 10–20, 20–30.
function base(): Project {
  let p = createProject()
  for (const id of ['a', 'b', 'c']) p = addClip(p, createClip(fakeMedia({ path: `${id}.mp4`, durationMs: 10_000 }), id))
  return p
}

function withCollage(atMs = 2000, durationMs?: number): Project {
  const collage = setCell(setCell(createCollage('side-by-side'), 0, src('v1.mp4', 4000)), 1, src('v2.mp4', 6000, 1080, 1920))
  const item = createCollageItem('col', collage)
  const res = insertItem(base(), durationMs ? { ...item, durationMs } : item, 'effect', atMs, { id: 'fx' })
  if (!res.ok) throw new Error('no cabe')
  return res.project
}

describe('el collage en las pistas', () => {
  it('es una pieza de una pista de efectos que dura lo del vídeo más largo', () => {
    const p = withCollage()
    const r = resolveTracks(p).find((x) => x.item.id === 'col')!
    expect(r.track.kind).toBe('effect')
    expect(r.startMs).toBe(2000)
    expect(r.endMs).toBe(8000)
    expect(r.item.name).toBe('Collage de 2')
    expect(r.item.look!.mix).toBe('normal')
  })

  it('recortar por delante y partir hacen avanzar por dónde va (sin vueltas)', () => {
    let p = withCollage()
    p = trimItemStart(p, 'col', 3000)
    const item = findItem(p, 'col')!.item
    expect(item.phaseMs).toBe(1000)
    expect(item.durationMs).toBe(5000)
    // No se alarga por delante de su principio.
    p = trimItemStart(p, 'col', 0)
    expect(findItem(p, 'col')!.item.phaseMs).toBe(0)
    expect(resolveTracks(p).find((x) => x.item.id === 'col')!.startMs).toBe(2000)
    const split = splitItem(p, 'col', 5000, 'col2')
    expect(findItem(split, 'col')!.item.durationMs).toBe(3000)
    expect(findItem(split, 'col2')!.item.phaseMs).toBe(3000)
    expect(findItem(split, 'col2')!.item.collage).toEqual(findItem(split, 'col')!.item.collage)
  })

  it('se recorta por detrás libremente, no repite y se duplica con sus huecos', () => {
    let p = withCollage()
    p = trimItemEnd(p, 'col', 12_000)
    expect(findItem(p, 'col')!.item.durationMs).toBe(10_000)
    expect(setItemRepeat(p, 'col', true)).toBe(p)
    const d = duplicateItem(p, 'col', 'copy', { id: 'fx2' })
    expect(d.ok).toBe(true)
    if (d.ok) expect(findItem(d.project, 'copy')!.item.collage).toEqual(findItem(p, 'col')!.item.collage)
  })

  it('poner un vídeo más largo lo alarga mientras dura lo de serie; recortado a mano, no', () => {
    let p = withCollage()
    const longer = src('v3.mp4', 9000)
    const q = updateCollage(p, 'col', (c) => setCell(c, 0, longer))
    expect(findItem(q, 'col')!.item.durationMs).toBe(9000)
    p = trimItemEnd(p, 'col', 6000)
    const r = updateCollage(p, 'col', (c) => setCell(c, 0, longer))
    expect(findItem(r, 'col')!.item.durationMs).toBe(4000)
  })

  it('sus ficheros cuentan en la lista, los usos y volver a enlazar', () => {
    const p = withCollage()
    expect(usedMediaPaths(p)).toEqual(expect.arrayContaining(['v1.mp4', 'v2.mp4']))
    expect(trackFilePaths(p)).toEqual(['v1.mp4', 'v2.mp4'])
    expect(mediaUsage(p).get('v2.mp4')).toEqual({ clips: 0, covers: 0, sounds: 0, effects: 0, collages: 1 })
    expect(relinkProblem(mediaUsage(p).get('v2.mp4')!, fakeAudio({ path: 's.m4a' }))).toMatch(/hueco del collage/)
    const moved = relinkMedia(p, 'v2.mp4', fakeMedia({ path: 'D:\\nuevo\\v2.mp4', durationMs: 6000, width: 1080, height: 1920 }))
    const cells = findItem(moved, 'col')!.item.collage!.cells
    expect(cells[1]!.source!.path).toBe('D:\\nuevo\\v2.mp4')
    expect(relinkCollage(cells[0] ? findItem(moved, 'col')!.item.collage! : createCollage('stacked'), 'nada.mp4', fakeMedia({ path: 'x.mp4' }))).toBe(findItem(moved, 'col')!.item.collage)
  })
})

describe('guardar y leer (versión 7)', () => {
  it('ida y vuelta de un collage', () => {
    let p = withCollage()
    p = updateCollage(p, 'col', (c) => setHeardCell(setCellFraming(c, 1, { offsetY: 0.5 }), 0))
    const q = parseProject(serializeProject(p))
    expect(q.version).toBe(7)
    expect(findItem(q, 'col')!.item).toEqual(findItem(p, 'col')!.item)
  })

  it('un proyecto de la versión 6 se lee sin collages', () => {
    const p = base()
    const json = JSON.parse(serializeProject(p))
    json.version = 6
    const q = parseProject(JSON.stringify(json))
    expect(q.version).toBe(7)
    expect(q.tracks).toEqual([])
    expect(q.clips).toEqual(p.clips)
  })

  it('un collage dañado se descarta sin perder el proyecto', () => {
    const p = withCollage()
    const json = JSON.parse(serializeProject(p))
    json.project.tracks[0].items[0].collage.layoutId = 'no-existe'
    const q = parseProject(JSON.stringify(json))
    expect(q.clips).toHaveLength(3)
    expect(q.tracks[0]!.items).toEqual([])
  })
})
