// Limpieza de la caché: qué se protege (lo de todos los vídeos de la lista, el abierto y lo de la biblioteca).
import { describe, expect, it } from 'vitest'
import { addClip, cacheProtection, createClip, createItem, createProject, insertItem, libraryCacheName, libraryCacheNames, serializeProject, syncMediaPool } from '../domain'
import { fakeMedia } from '../domain/test-helpers'
import { createCacheCleaner } from './cache'
import { createEditorStore } from './editor'
import { createLibraryStore } from './library'
import { createFakeBridge, mediaSet } from './test-helpers'

const H = 'C:\\v\\horizontal.mp4'
const V = 'C:\\v\\vertical.mp4'

describe('limpieza de la caché', () => {
  it('protege los ficheros (también los de «De mi ordenador») y lo de la biblioteca de cada vídeo', () => {
    let p = syncMediaPool(addClip(createProject(), createClip(fakeMedia({ path: H }), 'a')))
    p = syncMediaPool(addClip(p, createClip(fakeMedia({ path: V }), 'b')))
    p = { ...p, clips: p.clips.slice(0, 1) }
    const res = insertItem(p, createItem({ id: 'i', kind: 'sound', source: { type: 'library', assetId: 'ding' }, name: 'Ding', sourceDurationMs: 1000, still: false, hasAudio: true }), 'sound', 0, { id: 't' })
    expect(res.ok).toBe(true)
    const other = addClip(createProject(), createClip(fakeMedia({ path: 'D:\\otro.mp4' }), 'c'))
    const prot = cacheProtection([res.ok ? res.project : p, other])
    expect(prot.sources.sort()).toEqual(['C:\\v\\horizontal.mp4', 'C:\\v\\vertical.mp4', 'D:\\otro.mp4'])
    expect(prot.assetIds).toEqual(['ding'])
    expect(libraryCacheName({ file: 'ding.m4a', sha256: '0123456789abcdef'.repeat(4) })).toBe('0123456789abcdef-ding.m4a')
  })

  it('junta lo de la lista y lo abierto, y no limpia si algún vídeo no se puede leer', async () => {
    const { bridge, state } = createFakeBridge({ media: mediaSet() })
    const editor = createEditorStore(bridge, { autosaveDelayMs: 10_000 })
    const library = createLibraryStore(bridge, editor.setMedia)
    const cleaner = createCacheCleaner(bridge, editor, library)
    state.projects.x = { json: serializeProject(addClip(createProject(), createClip(fakeMedia({ path: 'D:\\lista.mp4' }), 'a'))), modifiedMs: 1 }
    await editor.addClipsFromPaths([H])
    const ding = library.catalog.value.assets[0]!
    await cleaner.run()
    expect(state.cleanups).toHaveLength(1)
    expect(state.cleanups[0]!.sources.sort()).toEqual([H, 'D:\\lista.mp4'])
    expect(libraryCacheNames(library.catalog.value, [ding.id])[0]).toBe(libraryCacheName(ding))
    state.projects.roto = { json: '{', modifiedMs: 2 }
    expect(await cleaner.run()).toBeNull()
    expect(state.cleanups).toHaveLength(1)
  })
})
