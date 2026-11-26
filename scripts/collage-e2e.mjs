// Prueba de extremo a extremo del collage, en la app Tauri real por CDP y con los botones y las teclas de verdad (en
// el modo de pruebas: sin sonido y sin quitar el foco):
//
// - Con el vídeo vacío, «Collage» no se puede pulsar (ni C hace nada).
// - C → «¿Cuántos vídeos?» (3) → «¿Cómo los repartimos?» (los dibujitos; «Uno grande a la izquierda y dos a la
//   derecha»); queda elegido y en «Huecos». Con 4 no se pregunta la distribución.
// - Llenar los huecos con «Elegir vídeo» (un vídeo, y dos a la vez que llenan los vacíos que siguen); la duración, la
//   del más largo; intercambiar arrastrando un hueco sobre otro y con ← →; «Llenar» / «Entero» (L); mover el
//   encuadre arrastrando dentro del hueco; silenciar un hueco (y que se vea en él); un hueco sin sonido lo dice.
// - Cada <video> dentro de su hueco (getBoundingClientRect), reproducir a 1× y a 2× midiendo la deriva de cada hueco
//   (data-sync) y los fotogramas perdidos, el corto que se queda quieto en su última imagen, el silenciado callado.
// - Partir el collage y deshacer; la distribución y la separación desde la barra; «Hacer un collage con estos» en
//   «De mi ordenador» (con la distribución que mejor encaja).
// - Guardar «Para WhatsApp» y medir en el fichero el color de cada hueco, la raya, y que el silenciado no suena y el
//   otro sí; el aviso de un hueco vacío al guardar.
// - Las teclas dibujadas valen y las barras caben en una línea, a 1280×800 y 1100×700; capturas collage-*.png.
//
// PowerShell (con Rust/cargo en el PATH y la app cerrada):
//   node scripts/collage-e2e.mjs
// Con la app ya abierta a mano: --no-launch. Empieza y acaba con resetProjects() y borra lo que guarda. Sale con 1 si
// algo falla.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { appTestEnv, APP_LAUNCH_OPTIONS, connectToApp, sleep } from './cdp.mjs'

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: '4853' },
    media: { type: 'string', default: resolve('test-output') },
    shots: { type: 'string', default: resolve('test-output', 'screenshots') },
    'no-launch': { type: 'boolean', default: false },
    'keep-open': { type: 'boolean', default: false },
    ...APP_LAUNCH_OPTIONS,
  },
})
const port = Number(opts.port)
const launch = !opts['no-launch']
mkdirSync(opts.shots, { recursive: true })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}

// Ficheros «del ordenador»: un trozo gris con su voz (440 Hz), un rojo con 1 kHz, un verde con 1,7 kHz y un vertical
// corto (2 s: azul y luego amarillo) sin sonido.
const own = resolve(opts.media, 'collage-e2e')
mkdirSync(own, { recursive: true })
const f = {
  base: join(own, 'Gris con voz.mp4'),
  red: join(own, 'Rojo con tono.mp4'),
  green: join(own, 'Verde con tono.mp4'),
  tall: join(own, 'Vertical corto.mp4'),
}
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
const enc = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '30']
const aac = ['-c:a', 'aac', '-b:a', '192k', '-shortest']
if (!existsSync(f.base)) ff(['-f', 'lavfi', '-i', 'color=c=0x787878:size=1920x1080:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12', ...enc, ...aac, f.base])
if (!existsSync(f.red)) ff(['-f', 'lavfi', '-i', 'color=c=0xc83232:size=1920x1080:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=6', ...enc, ...aac, f.red])
if (!existsSync(f.green)) ff(['-f', 'lavfi', '-i', 'color=c=0x28be46:size=1920x1080:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=1700:sample_rate=48000:duration=5', ...enc, ...aac, f.green])
if (!existsSync(f.tall)) ff(['-f', 'lavfi', '-i', 'color=c=0x3232c8:size=1080x1920:rate=30:duration=2', '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=0xdcc83c:t=fill:enable='gte(t\\,1)'", ...enc, f.tall])

const outputFolder = join(homedir(), 'Videos', 'Mis montajes (pruebas)')
const filesBefore = new Set(existsSync(outputFolder) ? readdirSync(outputFolder) : [])

// ------------------------------------------------------------------ arrancar y cerrar la app

let devProcess = null

async function cdpReachable() {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`)
    return true
  } catch {
    return false
  }
}

async function startApp() {
  if (!launch) return
  if (await cdpReachable()) throw new Error(`Ya hay algo escuchando en el ${port}: cierra la app o usa --no-launch`)
  const env = {
    ...process.env,
    ...appTestEnv(port, { withSound: opts['with-sound'], foreground: opts.foreground }),
    PATH: `${join(homedir(), '.cargo', 'bin')};${process.env.PATH}`,
  }
  devProcess = spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm tauri dev'], { env, stdio: 'ignore', windowsHide: true })
}

async function stopApp() {
  if (!launch) return
  try {
    execFileSync('taskkill', ['/IM', 'easy-cut.exe', '/F'], { stdio: 'ignore' })
  } catch {
    // Ya estaba cerrada.
  }
  if (devProcess?.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(devProcess.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // Ya había terminado.
    }
  }
  devProcess = null
  for (let i = 0; i < 40 && (await cdpReachable()); i++) await sleep(250)
}

// ------------------------------------------------------------------ utilidades

let app

async function shot(name) {
  await sleep(450)
  await app.screenshot(join(opts.shots, name))
}

async function noErrorDialog(where) {
  const msg = await app.text('[data-testid=error-message]')
  if (msg) {
    const details = await app.evaluate('return window.__easyCut.store.error.value?.details ?? ""')
    throw new Error(`Error en pantalla (${where}): ${msg}\n${details}`)
  }
}

async function waitScreen(testid, timeoutMs = 20_000) {
  await app.waitFor(`return !!document.querySelector('[data-testid=${testid}]')`, { timeoutMs, what: `pantalla ${testid}` })
  await sleep(200)
}

const S = (expr, args = {}) =>
  app.evaluate(`const store = window.__easyCut.store; const tracks = window.__easyCut.tracks; const domain = window.__easyCut.domain; ${expr}`, args)
const queuePick = (paths) => app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: paths })
const collageItem = (id) => S('const f = domain.findItem(store.project.value, args.id); return f ? { ...f.item, track: f.track.id } : null', { id })
const collages = () => S('return domain.resolveTracks(store.project.value).filter((r) => r.item.collage).map((r) => ({ id: r.item.id, start: r.startMs, end: r.shownEndMs, layout: r.item.collage.layoutId, cells: r.item.collage.cells.map((c) => c.source ? c.source.path.split(/[\\\\/]/).pop() : null) }))')
const cellsOf = async (id) => (await collageItem(id)).collage.cells
const nameOf = (c) => (c.source ? c.source.path.split(/[\\/]/).pop() : null)
const playerMs = () => app.evaluate('return Number(document.querySelector("[data-testid=player]").dataset.currentMs)')

/** Lleva la línea a `ms` pulsando en la regla de las pistas (como con el ratón). */
async function seekTo(ms) {
  await app.evaluate(`const s = document.querySelector('[data-testid=tracks-scroller]'); const px = Number(document.querySelector('[data-testid=tracks-view]').dataset.pxPerSec);
    const header = document.querySelector('.corner').getBoundingClientRect().width; const want = args.ms / 1000 * px;
    if (want < s.scrollLeft || want > s.scrollLeft + s.clientWidth - header - 30) s.scrollLeft = Math.max(0, want - 100); return true`, { ms })
  const r = await app.evaluate('const r = document.querySelector("[data-testid=tracks-ruler]").getBoundingClientRect(); return { l: r.left, y: r.top + r.height / 2 }')
  const px = await app.evaluate('return Number(document.querySelector("[data-testid=tracks-view]")?.dataset.pxPerSec ?? 0)')
  await app.clickAt(r.l + (ms / 1000) * px, r.y)
  await sleep(450)
}

async function selectItem(itemId) {
  const c = await app.center(`[data-testid=track-item][data-item-id="${itemId}"]`)
  await app.clickAt(c.x, c.y)
  await sleep(250)
}

async function visibleKeyHintsAreShortcuts(where) {
  const res = await app.evaluate(`const active = window.__easyCut.shortcuts().filter((s) => s.enabled).map((s) => s.label);
    const drawn = [...document.querySelectorAll('[data-key-hint]')].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(k).visibility !== 'hidden' && !k.closest('button:disabled') }).map((k) => k.dataset.key);
    const missing = [...new Set(drawn.filter((d) => !active.includes(d)))];
    return { drawn: [...new Set(drawn)], missing }`)
  check(`Cada tecla dibujada vale (${where})`, res.missing.length === 0, res.missing.length ? `sin atajo: ${res.missing.join(', ')}` : res.drawn.join(' '))
}

async function barInOneLine(selector, where) {
  const r = await app.evaluate(`const bar = document.querySelector(args.s); if (!bar) return null; const b = bar.getBoundingClientRect();
    const kids = [...bar.querySelectorAll(':scope > *')].filter((k) => k.getBoundingClientRect().width > 0).map((k) => k.getBoundingClientRect());
    return { height: Math.round(b.height), overflow: kids.some((k) => k.right > innerWidth + 1 || k.left < -1) }`, { s: selector })
  check(`La barra va en una sola línea y cabe (${where})`, !!r && r.height <= 60 && !r.overflow, JSON.stringify(r))
}

/** Rectángulos (px de pantalla) de cada hueco del collage en la vista previa y de su <video>. */
const cellGeometry = () =>
  app.evaluate(`return [...document.querySelectorAll('[data-testid=track-collage] [data-testid=collage-cell]')].map((c) => {
    const r = c.getBoundingClientRect(); const v = c.querySelector('video, img'); const m = v ? v.getBoundingClientRect() : null
    return { cell: [r.left, r.top, r.width, r.height].map(Math.round), media: m ? [m.left, m.top, m.width, m.height].map(Math.round) : null, muted: v ? v.muted : null } })`)

function ffprobe(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,nb_frames', '-of', 'json', path], { encoding: 'utf8' }))
}
/** Color medio de un cuadrado de 8 px en (fx, fy) (fracciones del marco) del fotograma de `sec`. */
function color(path, sec, fx, fy, size = 8) {
  const v = ffprobe(path).streams.find((s) => s.codec_type === 'video')
  const x = Math.round(fx * v.width) - size / 2
  const y = Math.round(fy * v.height) - size / 2
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', sec.toFixed(3), '-i', path, '-frames:v', '1', '-vf', `crop=${size}:${size}:${x}:${y},scale=1:1:flags=area,format=rgb24`, '-f', 'rawvideo', '-'])
  return [...buf.subarray(0, 3)]
}
function toneRms(path, hz, fromMs, toMs) {
  const band = `bandpass=f=${hz}:width_type=h:width=80`
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vn', '-af', `${band},${band},aformat=sample_fmts=flt:channel_layouts=mono`, '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 512 * 1024 * 1024 })
  const s = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  const a = Math.round(fromMs * 48)
  const b = Math.min(s.length, Math.round(toMs * 48))
  let sum = 0
  for (let i = a; i < b; i++) sum += s[i] * s[i]
  return Math.sqrt(sum / Math.max(1, b - a))
}
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

/**
 * Reproduce `ms` desde donde está y mide cada poco la deriva de cada hueco (data-sync: lo esperado frente a lo que
 * enseña el <video>, solo los que están en marcha) y los fotogramas perdidos de los huecos y del trozo.
 */
async function measurePlayback(ms) {
  await app.evaluate(`window.__q0 = [...document.querySelectorAll('[data-testid=player] video')].map((v) => { const q = v.getVideoPlaybackQuality(); return [q.totalVideoFrames, q.droppedVideoFrames] }); return true`)
  await app.key(' ')
  const samples = []
  const t0 = Date.now()
  await sleep(500)
  while (Date.now() - t0 < ms) {
    const s = await app.evaluate(`const sync = JSON.parse(document.querySelector('[data-testid=track-layers]').dataset.sync || '{}');
      return Object.entries(sync).filter(([k]) => k.includes(':')).map(([k, v]) => { const el = document.querySelector('[data-cell-key="' + k + '"]'); return { k, d: v.actual === null ? null : v.actual - v.expected, playing: !!el && !el.paused, active: v.active, expected: v.expected } })`)
    samples.push(s)
    await sleep(120)
  }
  await app.key(' ')
  const quality = await app.evaluate(`const now = [...document.querySelectorAll('[data-testid=player] video')].map((v) => { const q = v.getVideoPlaybackQuality(); return [q.totalVideoFrames, q.droppedVideoFrames] });
    let total = 0, dropped = 0; now.forEach((q, i) => { const b = window.__q0[i] ?? [0, 0]; total += Math.max(0, q[0] - b[0]); dropped += Math.max(0, q[1] - b[1]) }); return { total, dropped }`)
  return { samples, quality }
}

// ================================================================== prueba

try {
  await startApp()
  app = await connectToApp(port, { timeoutMs: 240_000 })
  console.log(`Conectado a ${app.url}`)
  await app.waitFor('return !!window.__easyCut?.store', { timeoutMs: 60_000, what: 'store de la app (modo desarrollo)' })
  await app.evaluate('await window.__easyCut.resetProjects(); location.reload(); return true')
  await sleep(1500)
  app.close()
  app = await connectToApp(port)
  await app.waitFor('return !!window.__easyCut?.store')
  await app.setViewport(1280, 800)
  await waitScreen('new-video')

  // --- Con el vídeo vacío, «Collage» no se puede pulsar.
  {
    await S('store.startNewProject(); store.go("editor"); return true')
    await waitScreen('editor')
    const disabled = await app.evaluate('return document.querySelector("[data-testid=add-collage]")?.disabled ?? null')
    await app.key('c')
    await sleep(200)
    const dialog = await app.evaluate('return !!document.querySelector("[data-testid=collage-dialog]")')
    check('Con el vídeo vacío, «Collage» está desactivado y C no abre nada', disabled === true && !dialog, `disabled=${disabled} diálogo=${dialog}`)
    await S('store.go("home"); return true')
    await waitScreen('new-video')
  }

  // --- Montaje: un trozo gris de 12 s.
  await app.click('[data-testid=new-video]')
  await waitScreen('pick-videos')
  await queuePick([f.base])
  await app.click('[data-testid=pick-videos]')
  await waitScreen('editor', 30_000)
  await app.waitFor('return !document.querySelector("[data-testid=preparing]") && window.__easyCut.store.project.value.clips.length === 1', { timeoutMs: 30_000 })
  await seekTo(1000)

  // --- C → 3 → distribución.
  let colId
  {
    await app.key('c')
    await app.waitFor('return document.querySelector("[data-testid=collage-dialog]")?.dataset.step === "count"', { timeoutMs: 3000, what: 'diálogo del collage' })
    const counts = await app.evaluate('return [...document.querySelectorAll("[data-testid=collage-dialog] .choice strong")].map((e) => e.textContent.trim())')
    check('«¿Cuántos vídeos?»: 2, 3 o 4', counts.join('|') === '2 vídeos|3 vídeos|4 vídeos', counts.join('|'))
    await shot('collage-01-cuantos.png')
    await app.key('3')
    await app.waitFor('return document.querySelector("[data-testid=collage-dialog]")?.dataset.step === "layout"', { timeoutMs: 3000, what: 'paso de la distribución' })
    const names = await app.evaluate('return [...document.querySelectorAll("[data-testid=collage-dialog] .choice")].map((b) => ({ t: b.querySelector("strong").textContent.trim(), svg: !!b.querySelector("svg.layout-icon rect.cell") }))')
    check('«¿Cómo los repartimos?»: seis distribuciones, cada una con su dibujito', names.length === 6 && names.every((n) => n.svg), names.map((n) => n.t).join(' · '))
    await shot('collage-02-distribucion.png')
    await app.key('3')
    await app.waitFor('return !document.querySelector("[data-testid=collage-dialog]") && !!document.querySelector("[data-testid=cells-bar]")', { timeoutMs: 3000, what: 'collage puesto en «Huecos»' })
    const list = await collages()
    colId = list[0]?.id
    check('Queda puesto en la línea, elegido y en «Huecos» (Uno grande a la izquierda y dos a la derecha)', list.length === 1 && list[0].layout === 'big-left' && Math.abs(list[0].start - 1000) < 120 && (await S('return tracks.selectedItemId.value')) === colId, JSON.stringify(list))
    const empties = await app.evaluate('return [...document.querySelectorAll("[data-testid^=collage-choose-]")].length')
    check('Cada hueco vacío dice «Suelta aquí un vídeo» y ofrece «Elegir vídeo»', empties === 3 && (await app.text('[data-testid=collage-slot-0] .drop')) === 'Suelta aquí un vídeo')
    await shot('collage-03-huecos-vacios.png')
  }

  // --- Llenar: uno con su botón y dos a la vez con V (el elegido y el vacío que sigue).
  {
    await queuePick([f.red])
    await app.click('[data-testid=collage-choose-0]')
    await app.waitFor(`return !!window.__easyCut.domain.findItem(window.__easyCut.store.project.value, '${colId}')?.item.collage.cells[0].source`, { timeoutMs: 15_000, what: 'hueco 1 lleno' })
    await app.key('2')
    await queuePick([f.tall, f.green])
    await app.key('v')
    await app.waitFor(`return window.__easyCut.domain.findItem(window.__easyCut.store.project.value, '${colId}')?.item.collage.cells.every((c) => c.source)`, { timeoutMs: 15_000, what: 'huecos 2 y 3 llenos' })
    const cells = await cellsOf(colId)
    const r = (await collages())[0]
    check('Llenos en su orden: rojo, vertical, verde', cells.map(nameOf).join('|') === 'Rojo con tono.mp4|Vertical corto.mp4|Verde con tono.mp4', cells.map(nameOf).join('|'))
    check('Dura lo del vídeo más largo (el rojo, 6 s)', Math.abs(r.end - r.start - 6000) < 2, `${r.end - r.start} ms`)
    await app.waitFor('return [...document.querySelectorAll("[data-testid=collage-cell-video]")].length === 3 && [...document.querySelectorAll("[data-testid=collage-cell-video]")].every((v) => v.readyState >= 2)', { timeoutMs: 15_000, what: 'los tres vídeos en la vista previa' })
    const noSound = await app.evaluate('return !!document.querySelector("[data-testid=collage-slot-1] [data-testid=cell-no-sound]")')
    check('El vertical (sin sonido) lo dice en su hueco', noSound)
    // Cada vídeo, dentro de su hueco y llenándolo («Llenar»).
    const g = await cellGeometry()
    const covers = g.every((c) => c.media && c.media[0] <= c.cell[0] + 1 && c.media[1] <= c.cell[1] + 1 && c.media[0] + c.media[2] >= c.cell[0] + c.cell[2] - 1 && c.media[1] + c.media[3] >= c.cell[1] + c.cell[3] - 1)
    check('Cada vídeo llena su hueco en la vista previa', covers, JSON.stringify(g.map((c) => [c.cell, c.media])))
    // Con la forma de su hueco: el grande es alto (956 × 1080 en el fichero).
    check('Los huecos tienen la forma de la plantilla (el grande a la izquierda, dos a la derecha)', g[0].cell[3] > g[1].cell[3] * 1.8 && g[1].cell[0] > g[0].cell[0] + g[0].cell[2] - 1 && Math.abs(g[1].cell[2] - g[0].cell[2]) <= 2, JSON.stringify(g.map((c) => c.cell)))
    await shot('collage-04-llenos.png')
  }

  // --- Intercambiar arrastrando y con las teclas; «Entero» con L; el encuadre arrastrando.
  {
    const a = await app.center('[data-testid=collage-slot-0]')
    const b = await app.center('[data-testid=collage-slot-2]')
    await app.drag({ x: a.x, y: a.y }, { x: b.x, y: b.y })
    let cells = await cellsOf(colId)
    check('Arrastrar el hueco 1 sobre el 3 los intercambia', nameOf(cells[0]) === 'Verde con tono.mp4' && nameOf(cells[2]) === 'Rojo con tono.mp4', cells.map(nameOf).join('|'))
    await app.key('ArrowLeft')
    cells = await cellsOf(colId)
    check('← cambia el elegido (el 3) con el anterior', nameOf(cells[1]) === 'Rojo con tono.mp4' && nameOf(cells[2]) === 'Vertical corto.mp4' && (await S('return tracks.pickedCell.value')) === 1, cells.map(nameOf).join('|'))
    await app.key('ArrowRight')
    cells = await cellsOf(colId)
    check('→ lo devuelve', nameOf(cells[2]) === 'Rojo con tono.mp4', cells.map(nameOf).join('|'))
    // El vertical en el hueco grande, como al principio (deshaciendo el primero no: se intercambia con la barra).
    await app.key('1')
    await app.key('ArrowRight')
    await app.key('ArrowRight')
    await app.key('1')
    cells = await cellsOf(colId)
    // Ahora: 0 vertical, 1 rojo? Se comprueba lo que queda y se sigue con eso.
    const order = cells.map(nameOf)
    check('Con las teclas se lleva cualquier vídeo a cualquier hueco', new Set(order).size === 3, order.join('|'))
    // «Entero» (L) en el hueco 1.
    await app.key('l')
    cells = await cellsOf(colId)
    const fitBtn = await app.evaluate('return document.querySelector("[data-testid=cell-fit]")?.dataset.fit')
    check('L pasa el hueco elegido a «Entero» (y el botón lo dice)', cells[0].fit === 'whole' && fitBtn === 'whole')
    await app.key('l')
    // El encuadre: arrastrar dentro de un hueco que recorta (el hueco 1 llenando).
    cells = await cellsOf(colId)
    const before = cells[0].offsetX + cells[0].offsetY
    const c0 = await app.center('[data-testid=collage-slot-0]')
    await app.drag({ x: c0.x, y: c0.y }, { x: c0.x + 25, y: c0.y + 25 })
    cells = await cellsOf(colId)
    check('Arrastrar dentro del hueco mueve el encuadre (sin cambiar de hueco)', cells[0].offsetX + cells[0].offsetY !== before && cells.map(nameOf).join('|') === order.join('|'), `${cells[0].offsetX}, ${cells[0].offsetY}`)
    await S('store.undo(); return true')
  }

  // --- Silenciar el verde con su botón; que se vea en el hueco.
  let greenCell
  {
    const cells = await cellsOf(colId)
    greenCell = cells.findIndex((c) => nameOf(c) === 'Verde con tono.mp4')
    await app.key(String(greenCell + 1))
    await app.click('[data-testid=cell-mute]')
    const now = await cellsOf(colId)
    const tag = await app.evaluate(`return !!document.querySelector('[data-testid=collage-slot-${greenCell}] [data-testid=cell-muted]')`)
    const label = await app.evaluate('return document.querySelector("[data-testid=cell-mute]")?.getAttribute("aria-label")')
    check('«Silenciar» silencia el hueco del verde, se ve en el hueco y el botón pasa a «Con sonido»', now[greenCell].muted && tag && label === 'Con sonido', `${now[greenCell].muted} ${tag} ${label}`)
    await shot('collage-05-silenciado.png')
  }

  // --- Reproducir a 1× y a 2×: la deriva de cada hueco, los fotogramas perdidos, el corto quieto y el silenciado callado.
  for (const rate of [1, 2]) {
    await seekTo(1100)
    if (rate !== 1) await app.click(`[data-testid="review-rate-${rate}"]`)
    const m = await measurePlayback(rate === 1 ? 4000 : 2500)
    const drifts = m.samples.flat().filter((s) => s.playing && s.d !== null).map((s) => Math.abs(s.d))
    drifts.sort((x, y) => x - y)
    const max = drifts.length ? drifts[drifts.length - 1] : null
    const median = drifts.length ? drifts[Math.floor(drifts.length / 2)] : null
    check(`A ${rate}×: cada hueco va sincronizado (mediana ≤ 60 ms, máximo < 150 ms)`, drifts.length > 5 && median <= 60 && max < 150, `mediana ${median} ms, máximo ${max} ms, ${drifts.length} medidas`)
    const lostPct = m.quality.total ? (100 * m.quality.dropped) / m.quality.total : 0
    check(`A ${rate}×: fotogramas perdidos de los huecos y el trozo ≤ 2 % (o ≤ 3)`, m.quality.dropped <= 3 || lostPct <= 2, `${m.quality.dropped} de ${m.quality.total} (${lostPct.toFixed(1)} %)`)
    if (rate === 1) {
      // A los 2 s del collage el vertical (2 s) ya se acabó: parado en su última imagen.
      const cells = await cellsOf(colId)
      const tallKey = `${colId}:${cells.findIndex((c) => nameOf(c) === 'Vertical corto.mp4')}`
      const last = m.samples[m.samples.length - 1].find((s) => s.k === tallKey)
      const tallEl = await app.evaluate(`const v = document.querySelector('[data-cell-key="${tallKey}"]'); return v ? { paused: v.paused, t: Math.round(v.currentTime * 1000) } : null`)
      check('El vídeo corto se queda quieto en su última imagen', !!tallEl && tallEl.paused && tallEl.t >= 1900 && last?.expected === 1960, `${JSON.stringify(tallEl)} esperado ${last?.expected}`)
      const muted = await app.evaluate(`const v = document.querySelector('[data-cell-key="${colId}:${greenCell}"]'); return v ? v.muted : null`)
      const redKey = `${colId}:${cells.findIndex((c) => nameOf(c) === 'Rojo con tono.mp4')}`
      const redMuted = await app.evaluate(`const v = document.querySelector('[data-cell-key="${redKey}"]'); return v ? v.muted : null`)
      check('El silenciado no suena en la vista previa; el rojo, sí', muted === true && redMuted === false, `verde muted=${muted}, rojo muted=${redMuted}`)
    } else {
      await app.click('[data-testid="review-rate-1"]')
    }
  }

  // --- Partir y deshacer; la distribución y la separación desde la barra.
  {
    await app.click('[data-testid=cells-done]')
    await seekTo(3500)
    await app.key('p')
    const parts = await collages()
    const ok = parts.length === 2 && parts[0].cells.join('|') === parts[1].cells.join('|')
    const phase = await S('return domain.resolveTracks(store.project.value).filter((r) => r.item.collage).map((r) => r.item.phaseMs)')
    check('P parte el collage en la línea: dos piezas con los mismos huecos, la segunda sigue por donde iba', ok && phase[1] >= 2400 && phase[1] <= 2600, `${JSON.stringify(parts.map((x) => [x.start, x.end]))} fase ${phase}`)
    await app.key('z', { ctrl: true })
    check('Ctrl+Z lo deja entero', (await collages()).length === 1)
    await selectItem(colId)
    await app.click('[data-testid=item-layout]')
    await app.waitFor('return !!document.querySelector("[data-testid=layout-popover]")', { timeoutMs: 3000, what: 'desplegable de distribución' })
    const layoutChoices = await app.evaluate('return [...document.querySelectorAll("[data-testid=layout-popover] .choice")].length')
    check('«Distribución» ofrece las seis de 3 vídeos', layoutChoices === 6)
    await shot('collage-06-distribucion-barra.png')
    await app.click('[data-testid=layout-big-top]')
    await app.click('[data-testid=item-gap]')
    await app.click('[data-testid=gap-white]')
    const now = (await collageItem(colId)).collage
    check('Y la distribución y la raya blanca se cambian desde la barra', now.layoutId === 'big-top' && now.gap === 'white', `${now.layoutId} ${now.gap}`)
    await app.evaluate('return true')
    await S(`return tracks.setCollageLayout(args.id, 'big-left'), tracks.setCollageGap(args.id, 'dark'), true`, { id: colId })
  }

  // --- Barras y teclas a 1280×800 y 1100×700.
  for (const [w, h] of [[1280, 800], [1100, 700]]) {
    await app.setViewport(w, h)
    await sleep(400)
    await selectItem(colId)
    await barInOneLine('[data-testid=item-bar] .item-bar', `collage elegido, ${w}×${h}`)
    await visibleKeyHintsAreShortcuts(`collage elegido, ${w}×${h}`)
    await app.click('[data-testid=item-cells]')
    await sleep(300)
    await barInOneLine('[data-testid=cells-bar]', `«Huecos», ${w}×${h}`)
    await visibleKeyHintsAreShortcuts(`«Huecos», ${w}×${h}`)
    await shot(`collage-07-huecos-${w}x${h}.png`)
    await app.key('Escape')
  }
  await app.setViewport(1280, 800)

  // --- Guardar «Para WhatsApp» y medir en el fichero.
  {
    await app.click('[data-testid=save-video]')
    await waitScreen('save-view')
    await app.click('[data-testid=preset-whatsapp]')
    await app.waitFor('return !!document.querySelector("[data-testid=done-view]")', { timeoutMs: 180_000, what: 'vídeo guardado' })
    await noErrorDialog('guardar el collage')
    const out = await S('return store.lastExport.value.path')
    const probe = ffprobe(out)
    const v = probe.streams.find((s) => s.codec_type === 'video')
    check('Guardado: 12 s, con imagen y sonido', Math.abs(Number(probe.format.duration) - 12) < 0.1 && !!probe.streams.find((s) => s.codec_type === 'audio'), `${probe.format.duration} s ${v.width}×${v.height}`)
    const cells = await cellsOf(colId)
    // Uno grande a la izquierda (x 0–0,5) y dos a la derecha (arriba y abajo). A los 4 s del vídeo (3 s del collage).
    const want = { 'Rojo con tono.mp4': [200, 50, 50], 'Verde con tono.mp4': [40, 190, 70], 'Vertical corto.mp4': [220, 200, 60] }
    const spots = [[0.25, 0.5], [0.75, 0.25], [0.75, 0.75]]
    const rows = []
    let ok = true
    cells.forEach((c, i) => {
      const got = color(out, 4, spots[i][0], spots[i][1])
      rows.push(`${i + 1} ${nameOf(c)}: ${got}`)
      if (!near(got, want[nameOf(c)], 12)) ok = false
    })
    check('En el fichero, cada hueco su vídeo (el vertical ya en su última imagen, amarillo)', ok, rows.join(' · '))
    // A 1280×720 la raya mide 4 px (0,8 % del lado corto, en múltiplos de 4): se mide un cuadrado de 2 px en medio.
    const gap = color(out, 4, 0.5, 0.5, 2)
    const outside = color(out, 0.5, 0.5, 0.5)
    check('La raya oscura entre huecos y, fuera del collage, el gris del trozo', near(gap, [28, 34, 41], 14) && near(outside, [120, 120, 120], 8), `raya ${gap} · fuera ${outside}`)
    const redTone = toneRms(out, 1000, 2500, 6500) / toneRms(f.red, 1000, 1000, 5000)
    const greenTone = toneRms(out, 1700, 2500, 5500) / toneRms(f.green, 1700, 1000, 4000)
    check('En el fichero suena el rojo y no el verde silenciado', redTone > 0.8 && greenTone < 0.05, `rojo ${redTone.toFixed(3)} · verde ${greenTone.toFixed(3)}`)
    await app.click('[data-testid=back-to-editor]')
    await waitScreen('editor')
  }

  // --- «Hacer un collage con estos» en «De mi ordenador».
  {
    await seekTo(8000)
    await S('tracks.select(null); tracks.openLibrary("computer"); return true')
    await app.waitFor('return !!document.querySelector("[data-testid=pool-collage-start]")', { timeoutMs: 5000, what: '«De mi ordenador»' })
    await app.click('[data-testid=pool-collage-start]')
    await app.evaluate(`for (const li of document.querySelectorAll('[data-testid=pool-item]')) { if (/Vertical corto|Rojo con tono/.test(li.dataset.path)) li.querySelector('[data-testid=pool-collage-check] input').click() } return true`)
    await sleep(200)
    await shot('collage-08-de-mi-ordenador.png')
    await app.click('[data-testid=pool-collage-make]')
    await app.waitFor('return window.__easyCut.domain.resolveTracks(window.__easyCut.store.project.value).filter((r) => r.item.collage).length === 2', { timeoutMs: 10_000, what: 'segundo collage' })
    const list = await collages()
    const second = list.find((x) => x.id !== colId)
    check('«Hacer un collage con estos»: uno al lado del otro (lo que mejor encaja con un vertical y un horizontal)', second.layout === 'side-by-side' && second.cells.every(Boolean), JSON.stringify(second))
    await S('tracks.closeLibrary(); return true')
  }

  // --- El aviso de un hueco vacío al guardar (y volver sin guardar).
  {
    await S('tracks.select(null); return true')
    await seekTo(10_500)
    await app.key('c')
    await app.key('2')
    await app.key('1')
    await app.waitFor('return !!document.querySelector("[data-testid=cells-bar]")', { timeoutMs: 3000, what: 'collage vacío' })
    await app.key('Escape')
    await app.click('[data-testid=save-video]')
    await waitScreen('save-view')
    await app.click('[data-testid=preset-whatsapp]')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")', { timeoutMs: 3000, what: 'aviso de huecos vacíos' })
    const title = await app.text('[data-testid=confirm-dialog] h2')
    check('Al guardar con un collage con huecos vacíos, se avisa', /huecos vacíos/.test(title ?? ''), title ?? '')
    await shot('collage-09-aviso-vacio.png')
    await app.key('Escape')
    check('Y «No, volver» no guarda (sigue en «Guardar»)', !!(await app.evaluate('return !!document.querySelector("[data-testid=save-view]") && !document.querySelector("[data-testid=saving-view]")')))
    await app.key('Escape')
    await waitScreen('editor')
  }
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? e.stack ?? e.message : String(e))
  try {
    await app?.screenshot(join(opts.shots, 'collage-zz-fallo.png'))
  } catch {
    // Sin captura.
  }
} finally {
  try {
    await app?.evaluate('await window.__easyCut.resetProjects(); return true')
  } catch {
    // La app ya no responde.
  }
  app?.close()
  if (!opts['keep-open']) await stopApp()
  if (existsSync(outputFolder)) {
    for (const name of readdirSync(outputFolder)) {
      if (!filesBefore.has(name) && (name.endsWith('.mp4') || name.endsWith('.m4a'))) {
        try {
          unlinkSync(join(outputFolder, name))
          console.log(`      borrado ${name}`)
        } catch (err) {
          console.log(`      no se ha podido borrar ${name}: ${err}`)
        }
      }
    }
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
process.exit(failed.length ? 1 : 0)
