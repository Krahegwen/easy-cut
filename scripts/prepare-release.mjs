// Prepara lo que se publica en una release de GitHub a partir del instalador ya compilado y firmado
// (pnpm build-release): el instalador renombrado sin espacios, su .sig, latest.json (lo que lee el
// actualizador de la app) y las notas de la release. Lo usa .github/workflows/release.yml y se puede
// ejecutar igual en local.
//
//   node scripts/prepare-release.mjs --check-tag v0.2.0     solo comprueba que la etiqueta y las versiones coinciden
//   node scripts/prepare-release.mjs [--tag v0.2.0] [--base-url URL] [--out carpeta]
//
// Por defecto la URL del instalador es la de la release de esa etiqueta en GitHub
// (https://github.com/Krahegwen/easy-cut/releases/download/v<versión>/…); --base-url la cambia (solo para
// probar el actualizador en local). Sale con código 1 y un mensaje claro si algo no cuadra.

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO = 'Krahegwen/easy-cut'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const { values: opts } = parseArgs({
  options: {
    tag: { type: 'string' },
    'check-tag': { type: 'string' },
    'base-url': { type: 'string' },
    out: { type: 'string', default: join(root, 'src-tauri', 'target', 'release-assets') },
  },
})

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

/** Las tres versiones (package.json, Cargo.toml y tauri.conf.json) tienen que ser la misma. */
function readVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const cargo = readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8')
  const cargoVersion = /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(cargo)?.[1]
  const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  const confVersion = conf.version === '../package.json' ? pkg.version : conf.version
  if (!pkg.version) fail('package.json no tiene "version".')
  if (cargoVersion !== pkg.version) fail(`La versión de src-tauri/Cargo.toml (${cargoVersion}) no es la de package.json (${pkg.version}).`)
  if (confVersion !== pkg.version) fail(`La versión de src-tauri/tauri.conf.json (${confVersion}) no es la de package.json (${pkg.version}).`)
  return pkg.version
}

function checkTag(tag, version) {
  if (tag !== `v${version}`) {
    fail(`La etiqueta «${tag}» no coincide con la versión del código (${version}): tendría que ser «v${version}». Sube la versión (package.json y src-tauri/Cargo.toml) o etiqueta el commit correcto.`)
  }
}

const version = readVersion()

if (opts['check-tag'] !== undefined) {
  checkTag(opts['check-tag'], version)
  console.log(`La etiqueta ${opts['check-tag']} coincide con la versión ${version}.`)
  process.exit(0)
}

const tag = opts.tag ?? `v${version}`
checkTag(tag, version)

// El instalador que deja Tauri («Easy Cut_0.2.0_x64-setup.exe») y su firma.
const nsisDir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
const installerName = `Easy Cut_${version}_x64-setup.exe`
const installer = join(nsisDir, installerName)
const signature = `${installer}.sig`
if (!existsSync(installer)) {
  const found = existsSync(nsisDir) ? readdirSync(nsisDir).join(', ') : '(no existe la carpeta)'
  fail(`No está el instalador ${installerName} en ${nsisDir}. Hay: ${found}. Compila antes con pnpm build-release.`)
}
if (!existsSync(signature)) fail(`No está la firma ${installerName}.sig: ¿se compiló sin TAURI_SIGNING_PRIVATE_KEY?`)

// Sin espacios en el nombre del asset: así la URL de latest.json es exactamente la del fichero subido.
const assetName = `Easy-Cut_${version}_x64-setup.exe`
const baseUrl = (opts['base-url'] ?? `https://github.com/${REPO}/releases/download/${tag}`).replace(/\/+$/, '')

const out = resolve(opts.out)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
copyFileSync(installer, join(out, assetName))
copyFileSync(signature, join(out, `${assetName}.sig`))

const sigText = readFileSync(signature, 'utf8').trim()
const sha256 = createHash('sha256').update(readFileSync(installer)).digest('hex')

// Novedades: la sección de esta versión en CHANGELOG.md («## [0.2.0] - fecha» hasta la siguiente «## »).
function changelogSection(v) {
  const file = join(root, 'CHANGELOG.md')
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const escaped = v.replace(/\./g, '\\.')
  const m = new RegExp(`^## \\[?${escaped}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(text)
  return m ? m[1].trim() : null
}
const news = changelogSection(version)
if (!news) fail(`CHANGELOG.md no tiene una sección «## [${version}]». Añádela con las novedades antes de publicar.`)

const ffmpeg = JSON.parse(readFileSync(join(root, 'scripts', 'ffmpeg-build.json'), 'utf8'))

const latest = {
  version,
  notes: news,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms: {
    'windows-x86_64': {
      signature: sigText,
      url: `${baseUrl}/${assetName}`,
    },
  },
}
writeFileSync(join(out, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`)

const notes = `## Novedades

${news}

## Instalar

1. Descarga **${assetName}** (aquí abajo, en «Assets») y ábrelo.
2. Se instala para tu usuario, sin pedir permisos de administrador. Si ya tenías Easy Cut, se actualiza y tus vídeos a medias se conservan.
3. El instalador no está firmado, así que Windows puede mostrar el aviso de SmartScreen la primera vez: pulsa «Más información» y luego «Ejecutar de todas formas».

Requiere Windows 10 u 11 de 64 bits. A partir de esta versión, Easy Cut avisa sola cuando hay una versión nueva y se actualiza con un botón.

SHA-256 del instalador:

\`\`\`
${sha256}  ${assetName}
\`\`\`

## Programas de terceros

El instalador incluye, sin modificar, \`ffmpeg.exe\` y \`ffprobe.exe\`, que no forman parte del código de Easy Cut y tienen su propia licencia:

- Versión: FFmpeg **${ffmpeg.version}** (rama \`${ffmpeg.branch}\`), compilación \`${ffmpeg.variant}\` de [FFmpeg-Builds](${ffmpeg.builder}) (${ffmpeg.release}).
- Licencia: **${ffmpeg.licenseName}** (${ffmpeg.licenseUrl}).
- Código fuente: ${ffmpeg.source}, commit \`${ffmpeg.commit}\`.
- Compilación usada: ${ffmpeg.url} (SHA-256 \`${ffmpeg.sha256}\`).

Más detalle en [THIRD-PARTY.md](https://github.com/${REPO}/blob/${tag}/THIRD-PARTY.md).
`
writeFileSync(join(out, 'release-notes.md'), notes)

console.log(`Versión ${version} (${tag})`)
console.log(`  ${join(out, assetName)}  (${sha256})`)
console.log(`  ${join(out, `${assetName}.sig`)}`)
console.log(`  ${join(out, 'latest.json')}  -> ${latest.platforms['windows-x86_64'].url}`)
console.log(`  ${join(out, 'release-notes.md')}`)
