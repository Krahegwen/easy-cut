// Copiar y pegar trozos: duplicar sin compartir nada, insertar detrás y prioridad del portapapeles.
import { describe, expect, it } from 'vitest'
import { projectDurationMs } from './durations'
import { isMediaPath } from './file-name'
import { canPaste, choosePasteSource } from './paste'
import {
  addClip,
  applyKeepSegments,
  clipOutputMs,
  createClip,
  createProject,
  duplicateClip,
  insertClipAfter,
  rotateClip,
  setCover,
  setFraming,
  setInOut,
  setMuted,
  setSpeed,
  type Project,
} from './project'
import { fakeMedia } from './test-helpers'

const a = fakeMedia({ path: 'C:\\Vídeos\\cumpleaños.mp4', durationMs: 10_000 })
const cover = fakeMedia({ path: 'C:\\Vídeos\\paisaje.mp4', durationMs: 6_000 })

function threeClips(): Project {
  let p = createProject()
  p = addClip(p, createClip(a, 'a'))
  p = addClip(p, createClip(a, 'b'))
  p = addClip(p, createClip(a, 'c'))
  return p
}

describe('duplicar un trozo', () => {
  it('copia todos sus ajustes con otro id y sin compartir objetos', () => {
    let p = addClip(createProject(), createClip(a, 'a'))
    p = setInOut(p, 'a', { inMs: 1000, outMs: 9000 })
    p = applyKeepSegments(p, 'a', [
      { startMs: 1000, endMs: 4000 },
      { startMs: 5000, endMs: 9000 },
    ])
    p = setSpeed(p, 'a', 2)
    p = setMuted(p, 'a', true)
    p = rotateClip(p, 'a', 1)
    p = setFraming(p, 'a', { mode: 'fill', zoom: 1.5, offsetX: 0.2 })
    p = setCover(p, 'a', cover, 1000)
    const original = p.clips[0]!
    const copy = duplicateClip(original, 'nuevo')

    expect(copy.id).toBe('nuevo')
    const { id: _a, ...restOriginal } = original
    const { id: _b, ...restCopy } = copy
    expect(restCopy).toEqual(restOriginal)
    expect(clipOutputMs(copy)).toBe(clipOutputMs(original))
    // Nada compartido: cambiar la copia no toca el original.
    expect(copy.segments).not.toBe(original.segments)
    expect(copy.segments[0]).not.toBe(original.segments[0])
    expect(copy.framing).not.toBe(original.framing)
    expect(copy.picture).not.toBe(original.picture)
    if (copy.picture.kind === 'cover' && original.picture.kind === 'cover') {
      expect(copy.picture.framing).not.toBe(original.picture.framing)
    }
  })

  it('genera un id nuevo si no se da', () => {
    const c = createClip(a, 'a')
    expect(duplicateClip(c).id).not.toBe('a')
  })
})

describe('insertar detrás de un trozo', () => {
  it('va justo después del indicado', () => {
    const p = threeClips()
    const copy = duplicateClip(p.clips[0]!, 'a2')
    const next = insertClipAfter(p, 'a', copy)
    expect(next.clips.map((c) => c.id)).toEqual(['a', 'a2', 'b', 'c'])
    expect(projectDurationMs(next)).toBe(projectDurationMs(p) + clipOutputMs(copy))
    // Inmutable.
    expect(p.clips.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('detrás del último, sin trozo elegido o con uno que ya no está, al final', () => {
    const p = threeClips()
    const copy = duplicateClip(p.clips[1]!, 'x')
    expect(insertClipAfter(p, 'c', copy).clips.map((c) => c.id)).toEqual(['a', 'b', 'c', 'x'])
    expect(insertClipAfter(p, null, copy).clips.map((c) => c.id)).toEqual(['a', 'b', 'c', 'x'])
    expect(insertClipAfter(p, 'borrado', copy).clips.map((c) => c.id)).toEqual(['a', 'b', 'c', 'x'])
    expect(insertClipAfter(createProject(), null, copy).clips.map((c) => c.id)).toEqual(['x'])
  })
})

describe('qué se pega', () => {
  const files = (sequence: number, ...paths: string[]) => ({ sequence, paths })

  it('sin nada copiado no hay nada que pegar', () => {
    expect(choosePasteSource(null, null, isMediaPath)).toEqual({ kind: 'nothing' })
    expect(choosePasteSource(null, files(5), isMediaPath)).toEqual({ kind: 'nothing' })
    expect(canPaste(null, files(5), isMediaPath)).toBe(false)
  })

  it('solo el trozo copiado: el trozo', () => {
    expect(choosePasteSource({ sequence: 7 }, files(7), isMediaPath)).toEqual({ kind: 'clip' })
    expect(choosePasteSource({ sequence: 7 }, null, isMediaPath)).toEqual({ kind: 'clip' })
    expect(canPaste({ sequence: 7 }, null, isMediaPath)).toBe(true)
  })

  it('solo ficheros del Explorador: los que son vídeos o sonidos', () => {
    const s = choosePasteSource(null, files(3, 'C:\\Vídeos\\ña.mp4', 'C:\\doc.txt', 'C:\\voz.m4a'), isMediaPath)
    expect(s).toEqual({ kind: 'files', paths: ['C:\\Vídeos\\ña.mp4', 'C:\\voz.m4a'] })
  })

  it('ficheros copiados después del trozo: mandan los ficheros', () => {
    expect(choosePasteSource({ sequence: 7 }, files(9, 'C:\\a.mp4'), isMediaPath)).toEqual({ kind: 'files', paths: ['C:\\a.mp4'] })
  })

  it('ficheros viejos que ya estaban al copiar el trozo: manda el trozo', () => {
    // El portapapeles no ha cambiado desde que se copió el trozo (misma secuencia).
    expect(choosePasteSource({ sequence: 9 }, files(9, 'C:\\a.mp4'), isMediaPath)).toEqual({ kind: 'clip' })
  })

  it('sin secuencia conocida (fuera de Windows), los ficheros se tienen por más nuevos', () => {
    expect(choosePasteSource({ sequence: null }, files(1, 'C:\\a.mp4'), isMediaPath).kind).toBe('files')
  })

  it('ficheros más nuevos que no son vídeos: se avisa, no se pega el trozo viejo', () => {
    const s = choosePasteSource({ sequence: 2 }, files(4, 'C:\\carta.docx'), isMediaPath)
    expect(s).toEqual({ kind: 'not-media', paths: ['C:\\carta.docx'] })
    expect(canPaste({ sequence: 2 }, files(4, 'C:\\carta.docx'), isMediaPath)).toBe(false)
  })
})
