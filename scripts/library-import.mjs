// Tanda de terceros de la biblioteca: lee library/third-party.json, prepara cada sonido a partir de su original
// (library/sources/, ignorada por git) y devuelve sus entradas del catálogo. También el nivelado común, que usa
// la tanda propia.
//
// Para cada elemento: decodifica el tramo pedido (inMs/outMs) a 48 kHz en coma flotante, lo deja en mono si sus
// dos canales son iguales, recorta el silencio de cabeza y cola (salvo `trim: false`), pone microfundidos (o los
// pedidos) para que no haya clics, iguala el volumen y lo guarda en M4A (AAC 192 kbps, 48 kHz).
//
// Volumen: lo sostenido, a −16 LUFS integrados con el pico verdadero ≤ −1 dBTP (si para llegar hace falta
// limitar más de `maxLimitDb`, se queda más bajo); lo muy corto (<0,5 s, donde los LUFS integrados no valen),
// por pico, a −4 dBTP. Se mide el M4A ya codificado y, si el pico se pasa, se rehace con menos ganancia.
//
// Nada de lo que hay en library/sources/ se ejecuta: solo lo leen ffmpeg y ffprobe.

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const SR = 48_000

function run(cmd, args, { input = null, binary = false } = {}) {
  return new Promise((ok, ko) => {
    const child = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true })
    const out = []
    let err = ''
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', ko)
    child.on('close', (code) => {
      const stdout = Buffer.concat(out)
      if (code === 0) ok({ stdout: binary ? stdout : stdout.toString('utf8'), stderr: err })
      else ko(new Error(`${cmd} ${code}: ${err.slice(-2000)}`))
    })
    if (input) {
      child.stdin.end(input)
    }
  })
}

const dbToLin = (db) => 10 ** (db / 20)

/** Canales de un fichero (ffprobe). */
function probeChannels(path) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', path], { encoding: 'utf8' })
  return Number(out.trim()) || 1
}

export function probeDurationMs(path) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' })
  return Math.round(Number(out.trim()) * 1000)
}

/** Decodifica [inMs, outMs) a 48 kHz en coma flotante; devuelve los canales por separado (1 o 2). */
async function decode(path, inMs, outMs) {
  const srcCh = Math.min(2, probeChannels(path))
  const trim = []
  if (inMs != null || outMs != null) trim.push(`atrim=${inMs != null ? `start=${inMs / 1000}` : ''}${inMs != null && outMs != null ? ':' : ''}${outMs != null ? `end=${outMs / 1000}` : ''}`)
  const af = [...trim, `aresample=${SR}:resampler=soxr:precision=28`].join(',')
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', path, '-af', af, '-ac', String(srcCh), '-f', 'f32le', '-'], { binary: true })
  const all = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.byteLength / 4)
  const n = Math.floor(all.length / srcCh)
  const chans = Array.from({ length: srcCh }, () => new Float32Array(n))
  for (let i = 0; i < n; i++) for (let c = 0; c < srcCh; c++) chans[c][i] = all[i * srcCh + c]
  return chans
}

/**
 * ¿Son (casi) iguales los dos canales? Mono guardado como estéreo: la diferencia entre canales queda 30 dB por
 * debajo de su suma (los códecs con pérdida no los dejan idénticos al bit; las voces de Kenney quedan a −32 dB).
 */
function isDualMono(chans) {
  if (chans.length < 2) return false
  const [l, r] = chans
  let sum = 0
  let diff = 0
  for (let i = 0; i < l.length; i++) {
    sum += (l[i] + r[i]) ** 2
    diff += (l[i] - r[i]) ** 2
  }
  return sum > 0 && diff <= sum * 1e-3
}

/** Recorta el silencio de cabeza y cola: umbral 45 dB por debajo del pico (y nunca por debajo de −60 dBFS). */
function trimSilence(chans, { preMs = 6, postMs = 40 } = {}) {
  const n = chans[0].length
  let peak = 0
  for (const c of chans) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i]))
  const thr = Math.max(peak * dbToLin(-45), dbToLin(-60))
  const loud = (i) => chans.some((c) => Math.abs(c[i]) > thr)
  let a = 0
  while (a < n && !loud(a)) a++
  let b = n - 1
  while (b > a && !loud(b)) b--
  const start = Math.max(0, a - Math.round((preMs / 1000) * SR))
  const end = Math.min(n, b + 1 + Math.round((postMs / 1000) * SR))
  return chans.map((c) => c.slice(start, end))
}

/** Fundidos de entrada y salida (curvas seno², sin clics). */
function applyFades(chans, fadeInMs, fadeOutMs) {
  const n = chans[0].length
  const fi = Math.min(n, Math.round((fadeInMs / 1000) * SR))
  const fo = Math.min(n, Math.round((fadeOutMs / 1000) * SR))
  for (const c of chans) {
    for (let i = 0; i < fi; i++) c[i] *= Math.sin((Math.PI / 2) * (i / fi)) ** 2
    for (let i = 0; i < fo; i++) c[n - 1 - i] *= Math.sin((Math.PI / 2) * (i / fo)) ** 2
  }
  return chans
}

/** WAV en coma flotante de 32 bits con 1 o 2 canales. */
export function writeWavChannels(path, chans) {
  const ch = chans.length
  const n = chans[0].length
  const data = Buffer.alloc(n * 4 * ch)
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) data.writeFloatLE(chans[c][i], (i * ch + c) * 4)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(3, 20)
  header.writeUInt16LE(ch, 22)
  header.writeUInt32LE(SR, 24)
  header.writeUInt32LE(SR * 4 * ch, 28)
  header.writeUInt16LE(4 * ch, 32)
  header.writeUInt16LE(32, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([header, data]))
}

/** Sonoridad integrada (LUFS, null si es demasiado corto para medirla) y pico verdadero (dBTP). */
export async function measure(path) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'])
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1])
  const tp = Number(/Peak:\s+(-?[\d.inf]+) dBFS/.exec(summary)?.[1])
  return { lufs: Number.isFinite(lufs) && lufs > -69 ? lufs : null, tp: Number.isFinite(tp) ? tp : -120 }
}

const ENCODE = ['-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-movflags', '+faststart']

/**
 * Iguala el volumen de un WAV y lo guarda en M4A. Devuelve lo medido en el M4A final.
 * `level`: { lufs, truePeakDb, peakDb, maxLimitDb }.
 */
export async function levelAndEncode(wav, out, level, { maxLimitDb = level.maxLimitDb, mode = 'auto' } = {}) {
  const src = await measure(wav)
  const durMs = probeDurationMs(wav)
  const byPeak = mode === 'peak' || (mode === 'auto' && (src.lufs === null || durMs < 500))
  // Margen extra para el pico verdadero tras el AAC (que suele subir unas décimas).
  const ceiling = level.truePeakDb - 0.5
  let gain
  let limit = false
  if (byPeak) {
    gain = level.peakDb - src.tp
    // Que un golpe corto no quede más fuerte que lo sostenido.
    if (src.lufs !== null && src.lufs + gain > level.lufs + 2) gain = level.lufs + 2 - src.lufs
  } else {
    const wanted = level.lufs - src.lufs
    const free = ceiling - src.tp
    if (wanted <= free) gain = wanted
    else {
      gain = Math.min(wanted, free + maxLimitDb)
      limit = gain > free + 0.05
    }
  }
  let result = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const af = [`volume=${gain.toFixed(3)}dB`]
    if (limit) af.push(`alimiter=limit=${dbToLin(ceiling).toFixed(4)}:attack=1:release=60:level=0:latency=1:asc=1`)
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-af', af.join(','), ...ENCODE, out])
    result = await measure(out)
    if (result.tp <= level.truePeakDb) break
    gain -= result.tp - level.truePeakDb + 0.15
  }
  return { ...result, gainDb: +gain.toFixed(2), limited: limit, byPeak, sourceLufs: src.lufs, sourceTp: src.tp }
}

// ------------------------------------------------------------------------------------------------ selección

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Expande la selección: cada `voice` da dos elementos (voz de hombre y de mujer). */
export function expandSelection(sel) {
  const out = []
  for (const e of sel.assets) {
    if (e.own) {
      out.push({ own: e.own })
      continue
    }
    if (e.voice) {
      const en = e.en ?? capitalize(e.voice.replace(/_/g, ' '))
      for (const [folder, who, whoName, tag] of [
        ['Male', 'hombre', 'Un hombre', ['hombre', 'masculina', 'chico']],
        ['Female', 'mujer', 'Una mujer', ['mujer', 'femenina', 'chica']],
      ]) {
        const countdown = e.category === 'cuenta-atras'
        out.push({
          id: `voz-${who}-${e.voice.replace(/_/g, '-')}`,
          name: `Voz de ${who}: "${en}" (${e.es})`,
          category: e.category,
          description: countdown ? `${whoName} dice «${en}» en inglés: ${e.es}.` : `${whoName} dice «${en}» en inglés (${e.es}).`,
          tags: [...e.tags, en.toLowerCase().replace(/!/g, ''), ...tag],
          from: { pack: 'voiceover-pack', file: `${folder}/${e.voice}.ogg` },
        })
      }
      continue
    }
    out.push(e)
  }
  return out
}

/** Ficha de origen: autor, página, título original y texto de agradecimiento. */
export function sourceInfo(sel, e) {
  const pack = sel.packs[e.from.pack]
  if (!pack) throw new Error(`${e.id}: paquete desconocido ${e.from.pack}`)
  if (e.from.pack === 'freesound') {
    const url = `https://freesound.org/s/${e.from.id}/`
    return { path: join(pack.dir, e.from.file), author: e.from.author, url, title: e.from.title }
  }
  const title = `${pack.title}: ${e.from.file.split('/').pop().replace(/\.[^.]+$/, '')}`
  return { path: join(pack.dir, e.from.file), author: pack.author, url: pack.url, title }
}

export function thanksText(info) {
  return `"${info.title}" por ${info.author} — ${info.url} — CC0 1.0`
}

/**
 * Prepara un elemento de terceros: tramo, mono, recorte, fundidos, nivel y M4A. Devuelve su entrada del catálogo
 * (sin el orden) y lo medido.
 */
export async function importAsset(root, dist, sel, e, fileEntry) {
  const info = sourceInfo(sel, e)
  const src = join(root, info.path)
  if (!existsSync(src)) throw new Error(`${e.id}: falta el original ${info.path} (ver library/README.md)`)
  let chans = await decode(src, e.inMs, e.outMs)
  if (chans.length === 2 && isDualMono(chans)) chans = [chans[0]]
  if (e.trim !== false) chans = trimSilence(chans)
  applyFades(chans, e.fadeInMs ?? 4, e.fadeOutMs ?? 25)
  const wav = join(dist, `${e.id}.import.wav`)
  writeWavChannels(wav, chans)
  const out = join(dist, `${e.id}.m4a`)
  const m = await levelAndEncode(wav, out, sel.level, { maxLimitDb: e.maxLimitDb ?? sel.level.maxLimitDb, mode: e.levelMode ?? 'auto' })
  rmSync(wav)
  const tags = [...new Set([...(e.tags ?? []), ...(sel.categoryTags[e.category] ?? [])])]
  const entry = {
    id: e.id,
    kind: 'sound',
    name: e.name,
    category: e.category,
    description: e.description,
    tags,
    durationMs: probeDurationMs(out),
    format: 'm4a',
    hasAudio: true,
    channels: chans.length,
    ...fileEntry(out),
    defaults: { volume: 1 },
    license: sel.license,
    author: info.author,
    sourceUrl: info.url,
    attribution: null,
    thanks: thanksText(info),
    verifiedOn: sel.verifiedOn,
  }
  return { entry, measured: m }
}

export function readSelection(root) {
  return JSON.parse(readFileSync(join(root, 'library', 'third-party.json'), 'utf8'))
}
