import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assetDefaults,
  chooseCatalog,
  countByCategory,
  creditsText,
  findNameClashes,
  foldText,
  isAllowedLibraryUrl,
  libraryCredits,
  libraryFetchFailure,
  libraryFetchMessage,
  libraryFileUrl,
  librarySaveMessage,
  libraryThanks,
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
    verifiedOn: '2026-11-25',
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

  it('no hay dos elementos que se llamen igual o casi igual, ni nombres con número de serie', () => {
    const c = repoCatalog as LibraryCatalog
    expect(findNameClashes(c.assets)).toEqual([])
    const folded = c.assets.map((a) => foldText(a.name))
    expect(new Set(folded).size).toBe(folded.length)
    for (const a of c.assets) expect(a.name).not.toMatch(/\s\d+$/)
  })

  it('lo de terceros es CC0, dice de dónde sale, a quién se agradece y cuándo se comprobó', () => {
    const c = repoCatalog as LibraryCatalog
    const third = c.assets.filter((a) => a.license !== 'own')
    expect(third.length).toBeGreaterThan(80)
    for (const a of third) {
      expect(a.license).toBe('CC0-1.0')
      expect(a.attribution).toBeNull()
      expect(a.verifiedOn).toBe('2026-11-25')
      expect(a.sourceUrl).toMatch(/^https:\/\/(freesound\.org\/s\/\d+\/|kenney\.nl\/assets\/[a-z-]+)$/)
      expect(a.thanks).toMatch(/^".+" por .+ — https:\/\/.+ — CC0 1\.0$/)
      expect(a.thanks).toContain(a.sourceUrl)
      expect(a.thanks).toContain(a.author)
    }
  })

  it('cada sonido tiene descripción, canales y etiquetas para el buscador', () => {
    const c = repoCatalog as LibraryCatalog
    for (const a of c.assets.filter((x) => x.kind === 'sound')) {
      expect(a.description, a.id).toBeTruthy()
      expect([1, 2], a.id).toContain(a.channels)
      expect(a.tags.length, a.id).toBeGreaterThanOrEqual(4)
    }
  })

  it('las categorías de sonidos tienen un tamaño manejable', () => {
    const c = repoCatalog as LibraryCatalog
    const counts = countByCategory(c, 'sound', '')
    for (const cat of c.categories.filter((x) => x.kind === 'sound' && counts[x.id])) expect(counts[cat.id], cat.id).toBeLessThanOrEqual(30)
  })

  it('el buscador encuentra lo que alguien escribiría', () => {
    const c = repoCatalog as LibraryCatalog
    const ids = (q: string) => searchLibrary(c, 'sound', q).map((a) => a.id)
    for (const q of ['aplauso', 'palmas', 'APLÁUSOS', 'ovacion']) expect(ids(q), q).toEqual(expect.arrayContaining(['aplausos-auditorio', 'ovacion-teatro']))
    expect(ids('risa')).toEqual(expect.arrayContaining(['risas-ninos-teatro', 'risa-una-persona']))
    expect(ids('carcajada').length).toBeGreaterThan(0)
    expect(ids('trombon')).toContain('trombon-triste')
    expect(ids('campana')).toContain('campana-grave')
    expect(ids('redoble')).toContain('redoble-muy-corto')
    expect(ids('cohete').length).toBeGreaterThan(0)
    expect(ids('cuenta atras tres')).toEqual(['voz-hombre-3', 'voz-mujer-3'])
    // También por la descripción.
    expect(ids('doscientas')).toEqual(['aplausos-auditorio'])
  })
})

describe('nombres', () => {
  it('detecta nombres iguales, casi iguales y con número de serie', () => {
    const a = (id: string, name: string) => ({ id, name })
    expect(findNameClashes([a('x', 'Aplausos de un auditorio'), a('y', 'Risa de una persona')])).toEqual([])
    expect(findNameClashes([a('x', 'Campanita'), a('y', 'campanita')]).join()).toMatch(/casi iguales/)
    expect(findNameClashes([a('x', '«¡Bien!» de un grupo'), a('y', 'Bien de un grupo')]).join()).toMatch(/casi iguales/)
    expect(findNameClashes([a('x', 'Zas seco y corto'), a('y', 'Zas seco y cortos')]).join()).toMatch(/casi iguales/)
    expect(findNameClashes([a('x', 'Aplausos 2')]).join()).toMatch(/número de serie/)
    expect(findNameClashes([a('x', 'Jingle nº 7')]).join()).toMatch(/número de serie/)
    expect(findNameClashes([a('x', 'Voz de hombre: "Two" (cuenta atrás, 2)'), a('y', 'Voz de hombre: "Ten" (cuenta atrás, 10)')])).toEqual([])
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

  it('lo CC0 de terceros sale en «Créditos de la biblioteca» como agradecimiento, nunca en los del vídeo', () => {
    const cc0 = asset({ id: 'ovacion', file: 'ovacion.m4a', name: 'Ovación', license: 'CC0-1.0', attribution: null, thanks: '"Applause" por Alguien — https://freesound.org/s/1/ — CC0 1.0', verifiedOn: '2026-11-25' })
    const c = catalog([asset(), cc0])
    let p = addClip(createProject(), createClip(fakeMedia({ path: 'a.mp4' }), 'a'))
    const r = insertItem(p, createItem({ id: 'i', kind: 'sound', source: { type: 'library', assetId: 'ovacion' }, name: 'Ovación', sourceDurationMs: 1000, hasAudio: true }), 'sound', 0, { id: 't' })
    if (r.ok) p = r.project
    expect(projectCredits(p, c)).toEqual([])
    expect(libraryCredits(c).map((x) => x.assetId)).toEqual(['aplausos-cc'])
    expect(libraryThanks(c)).toEqual([{ assetId: 'ovacion', name: 'Ovación', text: cc0.thanks }])
  })
})

describe('campos nuevos del esquema', () => {
  const errs = (a: Partial<LibraryAsset>) => validateCatalog(catalog([asset(a)])).errors.join(' | ')

  it('descripción de una línea, canales 1 o 2', () => {
    expect(errs({ description: 'Unas doscientas personas aplaudiendo.', channels: 1 })).toBe('')
    expect(errs({ description: '' })).toMatch(/descripción/)
    expect(errs({ description: 'dos\nlíneas' })).toMatch(/descripción/)
    expect(errs({ description: 'x'.repeat(200) })).toMatch(/descripción/)
    expect(errs({ channels: 3 as never })).toMatch(/channels/)
  })

  it('lo de terceros necesita agradecimiento y fecha de comprobación', () => {
    const cc0 = { license: 'CC0-1.0' as const, attribution: null }
    expect(errs(cc0)).toMatch(/thanks/)
    expect(errs({ ...cc0, verifiedOn: undefined })).toMatch(/verifiedOn/)
    expect(errs({ verifiedOn: undefined })).toMatch(/verifiedOn/)
    expect(errs({ ...cc0, thanks: '"X" por Y — https://x.org — CC0 1.0', verifiedOn: '25/11/2026' })).toMatch(/verifiedOn/)
    expect(errs({ ...cc0, thanks: '"X" por Y — https://x.org — CC0 1.0', verifiedOn: '2026-11-25' })).toBe('')
    // Lo propio no lo necesita.
    expect(errs({ license: 'own', attribution: null })).toBe('')
  })

  it('rechaza dos nombres casi iguales dentro del catálogo', () => {
    const e = validateCatalog(catalog([asset(), asset({ id: 'otro', file: 'otro.m4a', name: 'Aplausos fuertes.' })])).errors.join()
    expect(e).toMatch(/casi iguales/)
  })

  it('cuenta por categoría con lo que se busca', () => {
    const c = catalog([asset(), asset({ id: 'b', file: 'b.m4a', name: 'Risa', tags: ['carcajada'] })])
    expect(countByCategory(c, 'sound', '')).toEqual({ aplausos: 2 })
    expect(countByCategory(c, 'sound', 'carcajada')).toEqual({ aplausos: 1 })
    expect(countByCategory(c, 'effect', '')).toEqual({})
  })
})

describe('errores al traer un fichero', () => {
  it('distingue sin conexión, no disponible (404) y descarga que no coincide', () => {
    expect(libraryFetchFailure(new Error('offline: No hay conexión con el servidor de la biblioteca (dns).'))).toBe('offline')
    expect(libraryFetchFailure(new Error('missing: Este elemento de la biblioteca no está disponible (404 Not Found).'))).toBe('missing')
    expect(libraryFetchFailure('mismatch: El fichero descargado no es el que dice el catálogo (SHA-256).')).toBe('mismatch')
    expect(libraryFetchFailure(new Error('algo raro'))).toBe('other')
    expect(libraryFetchFailure(null)).toBe('other')
  })

  it('con un mensaje llano distinto para cada caso', () => {
    const offline = libraryFetchMessage('Campana grave', new Error('offline: x'))
    const missing = libraryFetchMessage('Campana grave', new Error('missing: x'))
    const mismatch = libraryFetchMessage('Campana grave', new Error('mismatch: x'))
    const other = libraryFetchMessage('Campana grave', new Error('x'))
    expect(offline).toMatch(/conexión/)
    expect(missing).toMatch(/todavía no está disponible/)
    expect(missing).not.toMatch(/conexión/)
    expect(mismatch).toMatch(/se ha descargado mal/)
    expect(mismatch).not.toMatch(/conexión/)
    expect(new Set([offline, missing, mismatch, other]).size).toBe(4)
    for (const m of [offline, missing, mismatch, other]) expect(m).toContain('«Campana grave»')
    // Al guardar.
    expect(librarySaveMessage(new Error('offline: x'))).toMatch(/conexión/)
    expect(librarySaveMessage(new Error('missing: x'))).toMatch(/todavía no está disponible/)
    expect(librarySaveMessage(new Error('mismatch: x'))).toMatch(/descargado mal/)
  })
})
