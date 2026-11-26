import { describe, expect, it } from 'vitest'
import { addClip, createClip, createProject, setCover } from './project'
import {
  cleanProjectName,
  defaultProjectName,
  describeTouched,
  duplicateProjectName,
  projectHasContent,
  sortProjectSummaries,
  summarizeProject,
  uniqueProjectName,
} from './projects'
import { fakeAudio, fakeMedia } from './test-helpers'
import { addTrack, createItem, createTrack, insertItem } from './tracks'

describe('nombres de los vídeos en marcha', () => {
  const nov26 = new Date(2026, 10, 26, 10, 30)

  it('por defecto, «Vídeo del 26 de noviembre», con «(2)» si se repite', () => {
    expect(defaultProjectName(nov26, [])).toBe('Vídeo del 26 de noviembre')
    expect(defaultProjectName(nov26, ['Boda', 'vídeo del 26 de NOVIEMBRE'])).toBe('Vídeo del 26 de noviembre (2)')
    expect(defaultProjectName(nov26, ['Vídeo del 26 de noviembre', 'Vídeo del 26 de noviembre (2)'])).toBe('Vídeo del 26 de noviembre (3)')
    expect(defaultProjectName(new Date(2027, 0, 1), [])).toBe('Vídeo del 1 de enero')
  })

  it('sin repetir, también con espacios de más', () => {
    expect(uniqueProjectName('Boda', ['  boda ', 'Boda (2)'])).toBe('Boda (3)')
    expect(uniqueProjectName('Boda', [])).toBe('Boda')
  })

  it('la copia al duplicar', () => {
    expect(duplicateProjectName('Boda', [])).toBe('Boda (copia)')
    expect(duplicateProjectName('Boda', ['Boda (copia)'])).toBe('Boda (copia 2)')
    expect(duplicateProjectName('Boda (copia)', ['Boda (copia)', 'Boda (copia 2)'])).toBe('Boda (copia 3)')
  })

  it('el nombre escrito a mano se limpia; vacío no vale', () => {
    expect(cleanProjectName('  Cumple   de  Ana \n')).toBe('Cumple de Ana')
    expect(cleanProjectName('   ')).toBeNull()
    expect(cleanProjectName('x'.repeat(200))).toHaveLength(80)
  })
})

describe('resumen de cada vídeo', () => {
  const v = fakeMedia({ path: 'C:\\v.mp4', durationMs: 10_000 })
  const s = fakeAudio({ path: 'C:\\voz.m4a', durationMs: 5000 })

  it('trozos, duración y la miniatura del primer trozo con imagen', () => {
    let p = addClip(createProject(), createClip(s, 'voz'))
    p = addClip(p, { ...createClip(v, 'b'), segments: [{ startMs: 2000, endMs: 8000 }] })
    expect(summarizeProject('id1', 'Boda', p, 123)).toEqual({ id: 'id1', name: 'Boda', clipCount: 2, durationMs: 11_000, modifiedMs: 123, thumb: { path: 'C:\\v.mp4', timeMs: 2000 } })
  })

  it('un sonido con vídeo encima: la miniatura sale del de encima; solo sonido, sin miniatura', () => {
    const p = addClip(createProject(), createClip(s, 'voz'))
    expect(summarizeProject('x', 'x', p, 0).thumb).toBeNull()
    const q = setCover(p, 'voz', { path: 'C:\\encima.mp4', durationMs: 9000 })
    expect(summarizeProject('x', 'x', q, 0).thumb).toEqual({ path: 'C:\\encima.mp4', timeMs: 0 })
  })

  it('lo más reciente primero', () => {
    const p = createProject()
    const list = [summarizeProject('a', 'A', p, 10), summarizeProject('b', 'B', p, 30), summarizeProject('c', 'C', p, 20)]
    expect(sortProjectSummaries(list).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('¿tiene algo? (uno vacío no se guarda)', () => {
    expect(projectHasContent(createProject())).toBe(false)
    expect(projectHasContent(addClip(createProject(), createClip(v)))).toBe(true)
    const t = addTrack(createProject(), createTrack('sound', 't', 'Sonidos'))
    expect(projectHasContent(t)).toBe(false)
    const res = insertItem(addClip(createProject(), createClip(v, 'a')), createItem({ id: 'i', kind: 'sound', source: { type: 'library', assetId: 'x' }, name: 'x', sourceDurationMs: 1000, still: false, hasAudio: true }), 'sound', 0, { id: 't' })
    expect(res.ok && projectHasContent({ ...res.project, clips: [] })).toBe(true)
  })
})

describe('cuándo se tocó', () => {
  const now = new Date(2026, 10, 26, 10, 30).getTime()
  it('en llano', () => {
    expect(describeTouched(now - 20_000, now)).toBe('Hace un momento')
    expect(describeTouched(now - 60_000, now)).toBe('Hace 1 minuto')
    expect(describeTouched(now - 25 * 60_000, now)).toBe('Hace 25 minutos')
    expect(describeTouched(new Date(2026, 10, 26, 8, 5).getTime(), now)).toBe('Hoy a las 8:05')
    expect(describeTouched(new Date(2026, 10, 25, 18, 5).getTime(), now)).toBe('Ayer a las 18:05')
    expect(describeTouched(new Date(2026, 10, 3, 9, 0).getTime(), now)).toBe('El 3 de noviembre')
    expect(describeTouched(new Date(2025, 11, 31, 9, 0).getTime(), now)).toBe('El 31 de diciembre de 2025')
  })
})
