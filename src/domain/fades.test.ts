// Aparecer y desaparecer con curva (versión 5): elementos de las pistas y trozos, y la migración de antes.
import { describe, expect, it } from 'vitest'
import { addClip, createClip, createProject, duplicateClip, parseProject, serializeProject, setClipFade, splitClip, type Project } from './project'
import { fakeMedia } from './test-helpers'
import { createItem, findItem, insertItem, itemFadeAt, setItemFade, splitItem } from './tracks'

function base(): Project {
  let p = createProject()
  p = addClip(p, createClip(fakeMedia({ path: 'a.mp4', durationMs: 10_000 }), 'a'))
  const item = createItem({ id: 's', kind: 'sound', source: { type: 'file', path: 's.m4a' }, name: 's', sourceDurationMs: 4000, hasAudio: true })
  const r = insertItem(p, item, 'sound', 1000, { id: 'tr' })
  if (!r.ok) throw new Error('no cabe')
  return r.project
}

describe('elementos: aparecer y desaparecer', () => {
  it('se elige la duración y la curva', () => {
    let p = setItemFade(base(), 's', 'in', { ms: 2000, easing: 'ease-in' })
    p = setItemFade(p, 's', 'out', { ms: 500, easing: 'smooth' })
    const s = findItem(p, 's')!.item
    expect([s.fadeInMs, s.fadeInEasing, s.fadeOutMs, s.fadeOutEasing]).toEqual([2000, 'ease-in', 500, 'smooth'])
    // A la mitad de «Empieza despacio» de 2 s, aún va por la cuarta parte del volumen.
    expect(itemFadeAt(s, 1000, 4000)).toBeCloseTo(0.25)
    // «De golpe» = duración 0.
    expect(findItem(setItemFade(p, 's', 'in', { ms: 0, easing: 'linear' }), 's')!.item.fadeInMs).toBe(0)
    // Lo mismo otra vez no cambia el proyecto (no deja un paso de deshacer vacío).
    expect(setItemFade(p, 's', 'out', { ms: 500, easing: 'smooth' })).toBe(p)
  })

  it('el interruptor de antes sigue valiendo (lineal, duración de su tipo)', () => {
    const s = findItem(setItemFade(base(), 's', 'in', true), 's')!.item
    expect([s.fadeInMs, s.fadeInEasing]).toEqual([1000, 'linear'])
  })

  it('al partir, cada mitad conserva su borde con su curva', () => {
    let p = setItemFade(base(), 's', 'in', { ms: 1000, easing: 'ease-out' })
    p = setItemFade(p, 's', 'out', { ms: 1000, easing: 'ease-in' })
    p = splitItem(p, 's', 3000, 's2')
    const a = findItem(p, 's')!.item
    const b = findItem(p, 's2')!.item
    expect([a.fadeInMs, a.fadeInEasing, a.fadeOutMs]).toEqual([1000, 'ease-out', 0])
    expect([b.fadeInMs, b.fadeOutMs, b.fadeOutEasing]).toEqual([0, 1000, 'ease-in'])
  })

  it('un proyecto de la versión 4 con «entrada suave» se lee igual (lineal, misma duración)', () => {
    const v4 = JSON.stringify({
      app: 'easy-cut',
      version: 4,
      project: {
        aspect: '16:9',
        clips: [{ id: 'a', sourcePath: 'a.mp4', sourceDurationMs: 5000, sourceHasVideo: true, segments: [{ startMs: 0, endMs: 5000 }], picture: { kind: 'own' } }],
        tracks: [{ id: 't', kind: 'effect', items: [{ id: 'fx', source: { type: 'library', assetId: 'x' }, sourceDurationMs: 3000, fadeInMs: 500, fadeOutMs: 500 }] }],
        media: [],
      },
    })
    const p = parseProject(v4)
    const fx = findItem(p, 'fx')!.item
    expect([fx.fadeInMs, fx.fadeInEasing, fx.fadeOutMs, fx.fadeOutEasing]).toEqual([500, 'linear', 500, 'linear'])
    expect(p.clips[0]).toMatchObject({ fadeInMs: 0, fadeOutMs: 0, fadeInEasing: 'linear', fadeOutEasing: 'linear' })
    // Curvas desconocidas: lineal.
    const raro = JSON.parse(v4)
    raro.version = 5
    raro.project.tracks[0].items[0].fadeInEasing = 'rebote'
    expect(findItem(parseProject(JSON.stringify(raro)), 'fx')!.item.fadeInEasing).toBe('linear')
  })
})

describe('trozos: aparecer y desaparecer', () => {
  it('se elige, se guarda y se lee', () => {
    let p = setClipFade(base(), 'a', 'in', { ms: 1000, easing: 'smooth' })
    p = setClipFade(p, 'a', 'out', { ms: 2000, easing: 'ease-out' })
    expect(p.clips[0]).toMatchObject({ fadeInMs: 1000, fadeInEasing: 'smooth', fadeOutMs: 2000, fadeOutEasing: 'ease-out' })
    const back = parseProject(serializeProject(p))
    expect(back.clips[0]).toMatchObject({ fadeInMs: 1000, fadeInEasing: 'smooth', fadeOutMs: 2000, fadeOutEasing: 'ease-out' })
    expect(setClipFade(p, 'a', 'in', { ms: 1000, easing: 'smooth' })).toBe(p)
  })

  it('al partir, la primera parte aparece y la segunda desaparece', () => {
    let p = setClipFade(base(), 'a', 'in', { ms: 1000, easing: 'smooth' })
    p = setClipFade(p, 'a', 'out', { ms: 1000, easing: 'ease-in' })
    p = splitClip(p, 'a', 4000, 'b')
    expect(p.clips[0]).toMatchObject({ fadeInMs: 1000, fadeOutMs: 0 })
    expect(p.clips[1]).toMatchObject({ fadeInMs: 0, fadeOutMs: 1000, fadeOutEasing: 'ease-in' })
  })

  it('copiar y pegar un trozo copia cómo aparece', () => {
    const p = setClipFade(base(), 'a', 'in', { ms: 2000, easing: 'ease-in' })
    expect(duplicateClip(p.clips[0]!, 'z')).toMatchObject({ fadeInMs: 2000, fadeInEasing: 'ease-in' })
  })
})
