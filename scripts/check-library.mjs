// Comprueba que library/dist/ está lista para subir a la release library-v1: cada fichero del catálogo (y su
// vista previa) está, con el tamaño y el SHA-256 que dice el catálogo; dist/catalog.json es igual que
// library/catalog.json; está CREDITS.md; y no sobra nada (lo que sobra no se subiría a ningún sitio útil).
// Dice cuántos ficheros y cuánto ocupan. Sale con código 1 si algo no cuadra.
//
// PowerShell, desde la raíz del repo:
//   pnpm library:check

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'library', 'dist')
const catalogText = readFileSync(join(ROOT, 'library', 'catalog.json'), 'utf8')
const catalog = JSON.parse(catalogText)
const problems = []

if (!existsSync(DIST)) {
  console.error('No existe library/dist/: genera la biblioteca con «node scripts/build-library.mjs».')
  process.exit(1)
}

const expected = new Map()
for (const a of catalog.assets) {
  expected.set(a.file, { sha256: a.sha256, bytes: a.bytes, id: a.id })
  if (a.preview) expected.set(a.preview.file, { ...a.preview, id: `${a.id} (vista previa)` })
}

let bytes = 0
for (const [file, want] of expected) {
  const path = join(DIST, file)
  if (!existsSync(path)) {
    problems.push(`falta ${file} (${want.id})`)
    continue
  }
  const size = statSync(path).size
  bytes += size
  if (size !== want.bytes) problems.push(`${file}: ocupa ${size} bytes y el catálogo dice ${want.bytes}`)
  const sha = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (sha !== want.sha256) problems.push(`${file}: el SHA-256 no es el del catálogo`)
}

const distCatalog = join(DIST, 'catalog.json')
if (!existsSync(distCatalog)) problems.push('falta dist/catalog.json')
// Sin contar los finales de línea: git puede dejar el del repo con CRLF en Windows (autocrlf).
else if (readFileSync(distCatalog, 'utf8').replaceAll('\r\n', '\n') !== catalogText.replaceAll('\r\n', '\n')) problems.push('dist/catalog.json no es igual que library/catalog.json')
const credits = join(DIST, 'CREDITS.md')
if (!existsSync(credits)) problems.push('falta dist/CREDITS.md')
else {
  const text = readFileSync(credits, 'utf8')
  for (const a of catalog.assets.filter((x) => x.thanks || x.attribution)) {
    if (!text.includes(a.thanks ?? a.attribution)) problems.push(`CREDITS.md no nombra ${a.id}`)
  }
}

const extra = readdirSync(DIST, { withFileTypes: true })
  .filter((f) => f.isFile() && !expected.has(f.name) && f.name !== 'catalog.json' && f.name !== 'CREDITS.md')
  .map((f) => f.name)
for (const f of extra) problems.push(`sobra ${f} (no está en el catálogo)`)

const files = expected.size + 2
bytes += existsSync(distCatalog) ? statSync(distCatalog).size : 0
bytes += existsSync(credits) ? statSync(credits).size : 0
if (problems.length) {
  console.error(`library/dist/ no está lista (${problems.length} problemas):`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`library/dist/ lista para subir: ${files} ficheros, ${(bytes / 1024 / 1024).toFixed(1)} MB (${bytes} bytes), revisión ${catalog.revision} del catálogo.`)
