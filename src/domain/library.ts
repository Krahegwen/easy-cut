// Biblioteca de sonidos y efectos: el catálogo (library/catalog.json), su validación, la búsqueda, los
// valores de serie de cada elemento y los créditos de lo que pide atribución.
//
// Los ficheros no van en el repo ni en el instalador: se publican como assets de una release de GitHub
// (library-v1) y la app los descarga cuando hacen falta (src-tauri/src/library.rs), comprobando su SHA-256.

import type { Project, TrackKind } from './project'
import { allItems, type ItemDefaults } from './tracks'

/** Licencias admitidas: solo material que se puede redistribuir. `own` = hecho por el proyecto (se publica CC0). */
export const LIBRARY_LICENSES = ['own', 'CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0'] as const
export type LibraryLicense = (typeof LIBRARY_LICENSES)[number]

/** Hosts desde los que se descarga (las releases de GitHub redirigen a sus servidores de ficheros). */
export const LIBRARY_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'] as const

/** Iconos de las categorías (nombres de AppIcon). */
export type LibraryIcon = 'party' | 'clap' | 'bell' | 'music' | 'fire' | 'light' | 'snow' | 'heart' | 'star' | 'frame' | 'whoosh'

export interface LibraryCategory {
  id: string
  kind: TrackKind
  name: string
  icon: LibraryIcon
}

export interface LibraryFile {
  file: string
  sha256: string
  bytes: number
}

export interface LibraryAsset extends LibraryFile {
  id: string
  kind: TrackKind
  /** Nombre en castellano. */
  name: string
  category: string
  tags: string[]
  /** 0 en una imagen fija. */
  durationMs: number
  format: 'm4a' | 'mp4' | 'webm' | 'png'
  width?: number
  height?: number
  hasAudio: boolean
  hasAlpha?: boolean
  still?: boolean
  /** Vista previa pequeña (efectos): un vídeo corto y ligero que se repite en la tarjeta. */
  preview?: LibraryFile
  defaults: ItemDefaults
  license: LibraryLicense
  author: string
  sourceUrl: string
  /** Texto exacto de créditos si la licencia lo pide (CC BY); null si no. */
  attribution: string | null
}

export interface LibraryCatalog {
  schema: 1
  /** Sube con cada tanda nueva: un catálogo descargado solo sustituye al empaquetado si es más nuevo. */
  revision: number
  /** De dónde se descargan los ficheros (termina en «/»). */
  baseUrl: string
  /** Licencia con la que el proyecto publica lo suyo (`own`). */
  ownLicense: string
  categories: LibraryCategory[]
  assets: LibraryAsset[]
}

const SHA256 = /^[0-9a-f]{64}$/
/** Nombres de fichero seguros: minúsculas, números, guion, punto y guion bajo (nada de rutas). */
export const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,90}$/
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,60}$/
const FORMATS = ['m4a', 'mp4', 'webm', 'png'] as const
const ICONS: readonly LibraryIcon[] = ['party', 'clap', 'bell', 'music', 'fire', 'light', 'snow', 'heart', 'star', 'frame', 'whoosh']
/** Tamaño máximo de un fichero de la biblioteca (para no descargar algo absurdo). */
export const MAX_LIBRARY_FILE_BYTES = 200 * 1024 * 1024

/** ¿Es una URL de descarga permitida? (https y uno de los hosts de las releases de GitHub). */
export function isAllowedLibraryUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (LIBRARY_HOSTS as readonly string[]).includes(u.hostname) && u.username === '' && u.password === ''
  } catch {
    return false
  }
}

export function libraryFileUrl(catalog: Pick<LibraryCatalog, 'baseUrl'>, file: string): string {
  return `${catalog.baseUrl}${encodeURIComponent(file)}`
}

export function requiresAttribution(asset: Pick<LibraryAsset, 'license'>): boolean {
  return asset.license.startsWith('CC-BY')
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkFile(f: unknown, where: string, errors: string[]): f is LibraryFile {
  if (!isObject(f)) {
    errors.push(`${where}: falta el fichero`)
    return false
  }
  let ok = true
  if (typeof f.file !== 'string' || !SAFE_FILE_NAME.test(f.file)) (errors.push(`${where}: nombre de fichero no válido (${String(f.file)})`), (ok = false))
  if (typeof f.sha256 !== 'string' || !SHA256.test(f.sha256)) (errors.push(`${where}: sha256 no válido`), (ok = false))
  if (typeof f.bytes !== 'number' || !Number.isInteger(f.bytes) || f.bytes <= 0 || f.bytes > MAX_LIBRARY_FILE_BYTES) (errors.push(`${where}: bytes no válido`), (ok = false))
  return ok
}

/**
 * Comprueba un catálogo entero. Devuelve el catálogo si no hay ningún error (un catálogo a medias no se usa:
 * mejor el empaquetado) y la lista de errores, en castellano, para el test y el registro.
 */
export function validateCatalog(raw: unknown): { catalog: LibraryCatalog | null; errors: string[] } {
  const errors: string[] = []
  if (!isObject(raw)) return { catalog: null, errors: ['el catálogo no es un objeto'] }
  if (raw.schema !== 1) errors.push('schema tiene que ser 1')
  if (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 1) errors.push('revision tiene que ser un entero ≥ 1')
  if (typeof raw.baseUrl !== 'string' || !raw.baseUrl.endsWith('/') || !isAllowedLibraryUrl(raw.baseUrl)) errors.push('baseUrl tiene que ser https de las releases de GitHub y acabar en /')
  if (typeof raw.ownLicense !== 'string' || raw.ownLicense === '') errors.push('falta ownLicense')
  const categories = Array.isArray(raw.categories) ? raw.categories : []
  if (!Array.isArray(raw.categories)) errors.push('faltan las categorías')
  const categoryKinds = new Map<string, TrackKind>()
  for (const c of categories) {
    if (!isObject(c) || typeof c.id !== 'string' || !SAFE_ID.test(c.id)) {
      errors.push(`categoría no válida: ${JSON.stringify(c)}`)
      continue
    }
    if (c.kind !== 'sound' && c.kind !== 'effect') errors.push(`categoría ${c.id}: kind no válido`)
    if (typeof c.name !== 'string' || c.name.trim() === '') errors.push(`categoría ${c.id}: sin nombre`)
    if (!ICONS.includes(c.icon as LibraryIcon)) errors.push(`categoría ${c.id}: icono desconocido (${String(c.icon)})`)
    if (categoryKinds.has(c.id)) errors.push(`categoría repetida: ${c.id}`)
    categoryKinds.set(c.id, c.kind as TrackKind)
  }
  const assets = Array.isArray(raw.assets) ? raw.assets : []
  if (!Array.isArray(raw.assets)) errors.push('faltan los elementos (assets)')
  const ids = new Set<string>()
  const files = new Set<string>()
  for (const a of assets) {
    if (!isObject(a) || typeof a.id !== 'string' || !SAFE_ID.test(a.id)) {
      errors.push(`elemento sin id válido: ${JSON.stringify(a).slice(0, 80)}`)
      continue
    }
    const w = `elemento ${a.id}`
    if (ids.has(a.id)) errors.push(`${w}: id repetido`)
    ids.add(a.id)
    if (a.kind !== 'sound' && a.kind !== 'effect') errors.push(`${w}: kind no válido`)
    if (typeof a.name !== 'string' || a.name.trim() === '') errors.push(`${w}: sin nombre`)
    if (typeof a.category !== 'string' || !categoryKinds.has(a.category)) errors.push(`${w}: categoría desconocida (${String(a.category)})`)
    else if (categoryKinds.get(a.category) !== a.kind) errors.push(`${w}: la categoría es de otro tipo`)
    if (!Array.isArray(a.tags) || a.tags.some((t) => typeof t !== 'string')) errors.push(`${w}: tags tiene que ser una lista de textos`)
    if (!FORMATS.includes(a.format as (typeof FORMATS)[number])) errors.push(`${w}: formato no admitido (${String(a.format)})`)
    const still = a.still === true
    if (still !== (a.format === 'png')) errors.push(`${w}: una imagen fija es png y al revés`)
    if (still && a.kind !== 'effect') errors.push(`${w}: una imagen fija solo puede ser un efecto`)
    if (typeof a.durationMs !== 'number' || !Number.isInteger(a.durationMs) || (still ? a.durationMs !== 0 : a.durationMs <= 0)) errors.push(`${w}: durationMs no válido`)
    if (a.kind === 'sound' && a.format !== 'm4a') errors.push(`${w}: un sonido va en m4a`)
    if (a.kind === 'effect' && (typeof a.width !== 'number' || typeof a.height !== 'number' || a.width <= 0 || a.height <= 0)) errors.push(`${w}: un efecto necesita width y height`)
    if (typeof a.hasAudio !== 'boolean') errors.push(`${w}: falta hasAudio`)
    if (checkFile(a, w, errors)) {
      if (files.has(a.file as string)) errors.push(`${w}: fichero repetido (${String(a.file)})`)
      files.add(a.file as string)
      const ext = (a.file as string).split('.').pop()
      if (ext !== a.format) errors.push(`${w}: la extensión no es la del formato`)
    }
    if (a.preview !== undefined && checkFile(a.preview, `${w} (vista previa)`, errors)) {
      const pf = (a.preview as LibraryFile).file
      if (files.has(pf)) errors.push(`${w}: fichero de vista previa repetido`)
      files.add(pf)
    }
    if (!isObject(a.defaults)) errors.push(`${w}: faltan los valores de serie (defaults)`)
    else {
      const d = a.defaults
      if (d.volume !== undefined && (typeof d.volume !== 'number' || d.volume < 0 || d.volume > 1.5)) errors.push(`${w}: volumen de serie fuera de 0–1,5`)
      if (d.repeat !== undefined && typeof d.repeat !== 'boolean') errors.push(`${w}: repeat tiene que ser sí o no`)
      if (d.look !== undefined) {
        if (a.kind !== 'effect') errors.push(`${w}: un sonido no tiene aspecto (look)`)
        else if (!isObject(d.look) || (d.look.mix !== undefined && d.look.mix !== 'normal' && d.look.mix !== 'light')) errors.push(`${w}: mezcla de serie no válida`)
      }
    }
    if (!LIBRARY_LICENSES.includes(a.license as LibraryLicense)) errors.push(`${w}: licencia no admitida (${String(a.license)})`)
    if (typeof a.author !== 'string' || a.author.trim() === '') errors.push(`${w}: falta el autor`)
    if (typeof a.sourceUrl !== 'string' || !/^https:\/\//.test(a.sourceUrl)) errors.push(`${w}: falta la fuente (sourceUrl https)`)
    const needs = typeof a.license === 'string' && a.license.startsWith('CC-BY')
    if (needs && (typeof a.attribution !== 'string' || a.attribution.trim() === '')) errors.push(`${w}: su licencia pide atribución y no la tiene`)
    if (!needs && a.attribution !== null) errors.push(`${w}: attribution tiene que ser null si la licencia no la pide`)
  }
  return { catalog: errors.length === 0 ? (raw as unknown as LibraryCatalog) : null, errors }
}

/** El catálogo que vale: el descargado si es válido y más nuevo que el empaquetado; si no, el empaquetado. */
export function chooseCatalog(bundled: LibraryCatalog, downloaded: unknown): LibraryCatalog {
  if (downloaded === null || downloaded === undefined) return bundled
  const { catalog } = validateCatalog(downloaded)
  return catalog && catalog.revision > bundled.revision ? catalog : bundled
}

// ---------------------------------------------------------------------------
// Buscar

/** Texto sin tildes y en minúsculas, para buscar «canción» escribiendo «cancion». */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Elementos de un tipo, de una categoría (o todas) que casan con lo buscado (nombre, categoría o etiquetas). */
export function searchLibrary(catalog: LibraryCatalog, kind: TrackKind, query: string, categoryId: string | null = null): LibraryAsset[] {
  const words = foldText(query).split(/\s+/).filter(Boolean)
  const categoryName = new Map(catalog.categories.map((c) => [c.id, c.name]))
  return catalog.assets.filter((a) => {
    if (a.kind !== kind) return false
    if (categoryId && a.category !== categoryId) return false
    if (words.length === 0) return true
    const hay = foldText([a.name, categoryName.get(a.category) ?? '', ...a.tags].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

export function findAsset(catalog: LibraryCatalog, assetId: string): LibraryAsset | null {
  return catalog.assets.find((a) => a.id === assetId) ?? null
}

/** Los valores de serie con los que entra un elemento de la biblioteca en una pista. */
export function assetDefaults(asset: LibraryAsset): ItemDefaults {
  return { ...asset.defaults, look: asset.defaults.look ? { ...asset.defaults.look, box: { ...asset.defaults.look.box } } : undefined }
}

// ---------------------------------------------------------------------------
// Créditos

export interface Credit {
  assetId: string
  name: string
  text: string
}

/** Créditos de lo que pide atribución, para un conjunto de elementos de la biblioteca. */
function creditsOf(catalog: LibraryCatalog, assetIds: Iterable<string>): Credit[] {
  const out: Credit[] = []
  const seen = new Set<string>()
  for (const id of assetIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const a = findAsset(catalog, id)
    if (a && requiresAttribution(a) && a.attribution) out.push({ assetId: a.id, name: a.name, text: a.attribution })
  }
  return out.sort((x, y) => x.name.localeCompare(y.name, 'es'))
}

/** Créditos de los elementos de la biblioteca que usa este vídeo (los de las pistas silenciadas u ocultas no). */
export function projectCredits(project: Project, catalog: LibraryCatalog): Credit[] {
  const used = project.tracks
    .filter((t) => !(t.kind === 'sound' ? t.muted : t.hidden))
    .flatMap((t) => t.items)
    .flatMap((i) => (i.source.type === 'library' ? [i.source.assetId] : []))
  return creditsOf(catalog, used)
}

/** Todos los créditos de la biblioteca (pantalla «Créditos de la biblioteca»). */
export function libraryCredits(catalog: LibraryCatalog): Credit[] {
  return creditsOf(
    catalog,
    catalog.assets.map((a) => a.id),
  )
}

/** Texto para pegar en la descripción del vídeo. */
export function creditsText(credits: readonly Credit[]): string {
  if (credits.length === 0) return ''
  return ['Créditos:', ...credits.map((c) => `- «${c.name}»: ${c.text}`)].join('\n')
}

/** ¿Usa el proyecto algo de la biblioteca? */
export function usesLibrary(project: Project): boolean {
  return allItems(project).some((i) => i.source.type === 'library')
}
