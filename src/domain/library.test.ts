import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assetDefaults,
  chooseCatalog,
  creditsText,
  foldText,
  isAllowedLibraryUrl,
  libraryCredits,
  libraryFileUrl,
  projectCredits,
  searchLibrary,
  validateCatalog,
  type LibraryAsset,
  type LibraryCatalog,
} from './library'
import { addClip, createClip, createProject } from './project'
import { fakeMedia } from './test-helpers'
import { createItem, insertItem, setTrackMuted } from './tracks'

const repoCatalog = JSON.parse(readFileSync(resolve(__dirname, '../../library/catalog.json'), 'utf8')) as unknown

function asset(extra: Partial<LibraryAsset> = {}): LibraryAsset {
  return {
    id: 'aplausos-cc',
    kind: 'sound',
    name: 'Aplausos fuertes',
    category: 'aplausos',
    tags: ['público'],
    durationMs: 3000,
    format: 'm4a',
    hasAudio: true,
    file: 'aplausos-cc.m4a',
    sha256: 'a'.repeat(64),
    bytes: 1000,
    defaults: { volume: 1 },
    license: 'CC-BY-4.0',
    author: 'Alguien',
    sourceUrl: 'https://example.org/aplausos',
    attribution: '«Aplausos» de Alguien (CC BY 4.0)',
    ...extra,
  }
}

function catalog(assets: LibraryAsset[], revision = 5): LibraryCatalog {
  return {
    schema: 1,
    revision,
    baseUrl: 'https://github.com/Krahegwen/easy-cut/releases/download/library-v1/',
    ownLicense: 'CC0-1.0',
    categories: [
      { id: 'aplausos', kind: 'sound', name: 'Aplausos y risas', icon: 'clap' },
      { id: 'luz', kind: 'effect', name: 'Luz', icon: 'light' },
    ],
    assets,
  }
}

describe('el catálogo del repo (library/catalog.json)', () => {
  it('cumple el esquema: ids, ficheros, hashes, licencias, fuentes y categorías', () => {
    const { catalog: c, errors } = validateCatalog(repoCatalog)
    expect(errors).toEqual([])
    expect(c).not.toBeNull()
    expect(c!.assets.length).toBeGreaterThan(0)
  })

  it('todo lo propio va con licencia «own», sin atribución, y el proyecto lo publica CC0', () => {
    const c = repoCatalog as LibraryCatalog
    expect(c.ownLicense).toBe('CC0-1.0')
    for (const a of c.assets) if (a.license === 'own') expect(a.attribution).toBeNull()
    // Los efectos traen vista previa; los que repiten, su duración en pantalla.
    for (const a of c.assets.filter((x) => x.kind === 'effect')) expect(a.preview).toBeDefined()
  })
})

describe('validar', () => {
  it('acepta un catálogo bueno', () => {
    expect(validateCatalog(catalog([asset()])).errors).toEqual([])
  })

  it('rechaza lo que no se puede redistribuir o no dice de dónde sale', () => {
    const errs = (a: Partial<LibraryAsset>) => validateCatalog(catalog([asset(a)])).errors.join(' | ')
    expect(errs({ license: 'GPL-3.0' as never })).toMatch(/licencia no admitida/)
    expect(errs({ attribution: null })).toMatch(/pide atribución/)
    expect(errs({ license: 'CC0-1.0' })).toMatch(/attribution tiene que ser null/)
    expect(errs({ sourceUrl: '' })).toMatch(/fuente/)
    expect(errs({ author: ' ' })).toMatch(/autor/)
  })

  it('rechaza nombres de fichero peligrosos, hashes malos y repetidos', () => {
    const errs = (a: Partial<LibraryAsset>) => validateCatalog(catalog([asset(a)])).errors.join(' | ')
    expect(errs({ file: '../../evil.m4a' })).toMatch(/nombre de fichero/)
    expect(errs({ file: 'C:\\x.m4a' })).toMatch(/nombre de fichero/)
    expect(errs({ sha256: 'xyz' })).toMatch(/sha256/)
    expect(errs({ bytes: 0 })).toMatch(/bytes/)
    expect(errs({ file: 'aplausos-cc.mp4' })).toMatch(/extensión/)
    expect(errs({ category: 'luz' })).toMatch(/otro tipo/)
    expect(errs({ category: 'nada' })).toMatch(/categoría desconocida/)
    expect(validateCatalog(catalog([asset(), asset()])).errors.join()).toMatch(/id repetido/)
    expect(validateCatalog({ ...catalog([]), baseUrl: 'https://evil.example/' }).errors.join()).toMatch(/baseUrl/)
    expect(validateCatalog('nada').catalog).toBeNull()
  })

  it('un catálogo descargado solo vale si es válido y más nuevo', () => {
    const bundled = catalog([asset()], 5)
    expect(chooseCatalog(bundled, null)).toBe(bundled)
    expect(chooseCatalog(bundled, { ...catalog([asset()], 4) })).toBe(bundled)
    expect(chooseCatalog(bundled, { ...catalog([asset({ file: '../x' })], 9) })).toBe(bundled)
    expect(chooseCatalog(bundled, catalog([asset()], 6)).revision).toBe(6)
  })
})

describe('descargas', () => {
  it('solo https de las releases de GitHub', () => {
    expect(isAllowedLibraryUrl('https://github.com/Krahegwen/easy-cut/releases/download/library-v1/a.mp4')).toBe(true)
    expect(isAllowedLibraryUrl('https://objects.githubusercontent.com/x')).toBe(true)
    expect(isAllowedLibraryUrl('http://github.com/x')).toBe(false)
    expect(isAllowedLibraryUrl('https://github.com.evil.example/x')).toBe(false)
    expect(isAllowedLibraryUrl('https://u:p@github.com/x')).toBe(false)
    expect(isAllowedLibraryUrl('no es una url')).toBe(false)
    expect(libraryFileUrl(catalog([]), 'luz rosa.mp4')).toBe('https://github.com/Krahegwen/easy-cut/releases/download/library-v1/luz%20rosa.mp4')
  })
})

describe('buscar', () => {
  it('por nombre, categoría o etiquetas, sin tildes ni mayúsculas', () => {
    const c = catalog([asset(), asset({ id: 'luz', kind: 'effect', name: 'Luz cálida', category: 'luz', format: 'mp4', file: 'luz.mp4', width: 1920, height: 1080, tags: ['atardecer'], license: 'own', attribution: null })])
    expect(foldText('  Canción ÁNIMO ')).toBe('cancion animo')
    expect(searchLibrary(c, 'sound', '').map((a) => a.id)).toEqual(['aplausos-cc'])
    expect(searchLibrary(c, 'effect', 'calida').map((a) => a.id)).toEqual(['luz'])
    expect(searchLibrary(c, 'effect', 'ATARDECER').map((a) => a.id)).toEqual(['luz'])
    expect(searchLibrary(c, 'sound', 'risas').map((a) => a.id)).toEqual(['aplausos-cc'])
    expect(searchLibrary(c, 'sound', 'nada')).toEqual([])
    expect(searchLibrary(c, 'effect', '', 'aplausos')).toEqual([])
  })

  it('los valores de serie se copian (no se comparten)', () => {
    const a = asset({ kind: 'effect', defaults: { look: { mix: 'light', box: { scale: 0.5 } } } })
    const d = assetDefaults(a)
    d.look!.box!.scale = 2
    expect(a.defaults.look!.box!.scale).toBe(0.5)
  })
})

describe('créditos', () => {
  it('solo lo que pide atribución, sin repetir y sin lo silenciado', () => {
    const c = catalog([asset(), asset({ id: 'propio', file: 'propio.m4a', license: 'own', attribution: null })])
    let p = addClip(createProject(), createClip(fakeMedia({ path: 'a.mp4' }), 'a'))
    const lib = (id: string, assetId: string) => createItem({ id, kind: 'sound', source: { type: 'library', assetId }, name: assetId, sourceDurationMs: 1000, hasAudio: true })
    const put = (item: ReturnType<typeof lib>, at: number) => {
      const r = insertItem(p, item, 'sound', at, { id: `t-${item.id}` })
      if (r.ok) p = r.project
    }
    put(lib('x1', 'aplausos-cc'), 0)
    put(lib('x2', 'aplausos-cc'), 3000)
    put(lib('x3', 'propio'), 5000)
    const credits = projectCredits(p, c)
    expect(credits).toEqual([{ assetId: 'aplausos-cc', name: 'Aplausos fuertes', text: '«Aplausos» de Alguien (CC BY 4.0)' }])
    expect(creditsText(credits)).toBe('Créditos:\n- «Aplausos fuertes»: «Aplausos» de Alguien (CC BY 4.0)')
    const muted = setTrackMuted(p, p.tracks[0]!.id, true)
    expect(projectCredits(muted, c)).toEqual([])
    expect(libraryCredits(c)).toHaveLength(1)
    expect(creditsText([])).toBe('')
  })
})
