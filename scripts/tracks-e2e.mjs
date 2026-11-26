// Prueba de extremo a extremo de las pistas de sonidos y efectos y de la biblioteca, en la app Tauri real por
// CDP y con los botones de verdad (en el modo de pruebas: sin sonido y sin quitar el foco). Añadir desde la
// biblioteca (origen local: library/dist) un sonido y un efecto con «Poner aquí» y desde el ordenador un sonido;
// mover, recortar, partir, duplicar, volumen, entrada suave, repetir, silenciar/ocultar pista y fila principal,
// quitar pista y deshacer; quitar pausas en un trozo anterior, reordenar un trozo y quitar el trozo ancla (lo
// pegado va con su trozo o se queda en su sitio); zoom; tarjetas/pistas; «Tamaño y sitio»; reproducir midiendo
// la sincronía; guardar «Para WhatsApp» y comprobarlo con ffprobe; créditos en «¡Listo!»; el buscador
// («aplauso», «palmas», sin tildes), cada categoría de sonidos con su contador y nombres legibles; un sonido de
// Freesound y uno de Kenney en un vídeo guardado, midiendo en el fichero dónde suenan; y el rendimiento con un
// montaje de 5 minutos, 20 trozos, 3 pistas y 30 elementos. Capturas tracks-*.png y lib-*.png (biblioteca por
// categorías y búsqueda, a 1280×800 y 1100×700) en test-output/screenshots/.
//
// PowerShell (con Rust/cargo en el PATH, la app cerrada, los ficheros de `pnpm test:ffmpeg` en test-output y
// la biblioteca generada con `node scripts/build-library.mjs`):
//   node scripts/tracks-e2e.mjs
// Con la app ya abierta a mano: --no-launch. Borra al acabar lo que ha guardado. Sale con 1 si algo falla.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
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

const media = {
  horizontal: resolve(opts.media, 'src-horizontal-1080p30.mp4'),
  silence: resolve(opts.media, 'src-silence-middle-720p30.mp4'),
}
for (const p of Object.values(media)) if (!existsSync(p)) throw new Error(`Falta ${p}: ejecuta pnpm test:ffmpeg`)
if (!existsSync(resolve('library', 'dist', 'ding.m4a'))) throw new Error('Falta la biblioteca local: ejecuta node scripts/build-library.mjs')

// Ficheros «del ordenador» para las pistas.
const own = resolve(opts.media, 'tracks-e2e')
mkdirSync(own, { recursive: true })
const music = join(own, 'Música de prueba.m4a')
const logo = join(own, 'logo.png')
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
if (!existsSync(music)) ff(['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=495:sample_rate=48000:duration=6', '-filter_complex', 'amix=inputs=2', '-c:a', 'aac', '-b:a', '128k', music])
if (!existsSync(logo)) ff(['-f', 'lavfi', '-i', 'color=c=0xe0b030:size=300x150', '-vf', "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(abs(X-150),130)*lt(abs(Y-75),55),255,0)'", '-frames:v', '1', logo])

const outputFolder = join(homedir(), 'Videos', 'Mis montajes (pruebas)')
const filesBefore = new Set(existsSync(outputFolder) ? readdirSync(outputFolder) : [])

function ffprobe(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,duration', '-of', 'json', path], { encoding: 'utf8' }))
}

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

const S = (expr, args = {}) =>
  app.evaluate(`const store = window.__easyCut.store; const tracks = window.__easyCut.tracks; const library = window.__easyCut.library; const domain = window.__easyCut.domain; ${expr}`, args)
const queuePick = (paths) => app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: paths })
/** Elementos de las pistas con su tiempo (los de la vista previa: clipOutputMs). */
const items = () =>
  S(`const p = store.project.value; return domain.resolveTracks(p).map((r) => ({ id: r.item.id, name: r.item.name, track: r.track.id, trackName: r.track.name, kind: r.track.kind, start: r.startMs, end: r.endMs, anchor: r.item.anchor, item: r.item }))`)
const clipStarts = () => S('const p = store.project.value; const s = domain.clipStartTimes(p); return p.clips.map((c, i) => ({ id: c.id, start: s[i], len: domain.clipOutputMs(c), path: c.sourcePath }))')
const playheadMs = () => S('return tracks.playheadMs.value')
const pxPerSec = () => app.evaluate('return Number(document.querySelector("[data-testid=tracks-view]")?.dataset.pxPerSec ?? 0)')

async function waitScreen(testid, timeoutMs = 20_000) {
  await app.waitFor(`return !!document.querySelector('[data-testid=${testid}]')`, { timeoutMs, what: `pantalla ${testid}` })
  await sleep(200)
}

/** Lleva el cabezal a `ms` pulsando en la regla de las pistas (o, sin pistas, con Inicio y →). */
async function seekTo(ms) {
  const hasRuler = await app.evaluate('return !!document.querySelector("[data-testid=tracks-ruler]")')
  if (!hasRuler) {
    await app.key('Home')
    for (let i = 0; i < Math.round(ms / 1000); i++) await app.key('ArrowRight')
    await sleep(300)
    return
  }
  // Que se vea ese instante (con zoom puede hacer falta desplazar).
  await app.evaluate(`const s = document.querySelector('[data-testid=tracks-scroller]'); const px = Number(document.querySelector('[data-testid=tracks-view]').dataset.pxPerSec);
    const header = document.querySelector('.corner').getBoundingClientRect().width; const want = args.ms / 1000 * px;
    if (want < s.scrollLeft || want > s.scrollLeft + s.clientWidth - header - 30) s.scrollLeft = Math.max(0, want - 100); return true`, { ms })
  const r = await app.evaluate('const r = document.querySelector("[data-testid=tracks-ruler]").getBoundingClientRect(); return { l: r.left, y: r.top + r.height / 2 }')
  const px = await pxPerSec()
  await app.clickAt(r.l + (ms / 1000) * px, r.y)
  await sleep(350)
}

/** Centro de un bloque de las pistas (lo desplaza a la vista si hace falta). */
async function blockCenter(itemId) {
  return app.center(`[data-testid=track-item][data-item-id="${itemId}"]`)
}

/** Esc hasta cerrar la biblioteca (el primero puede cerrar el aviso de «Puesto en…»). */
async function closeLibraryWithEsc() {
  for (let i = 0; i < 3 && (await app.evaluate('return !!document.querySelector("[data-testid=library-panel]")')); i++) {
    await app.key('Escape')
    await sleep(150)
  }
}

async function selectItem(itemId) {
  const c = await blockCenter(itemId)
  await app.clickAt(c.x, c.y)
  await sleep(200)
}

async function visibleKeyHintsAreShortcuts(where) {
  const res = await app.evaluate(`const active = window.__easyCut.shortcuts().filter((s) => s.enabled).map((s) => s.label);
    const drawn = [...document.querySelectorAll('[data-key-hint]')].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(k).visibility !== 'hidden' && !k.closest('button:disabled') }).map((k) => k.dataset.key);
    const missing = [...new Set(drawn.filter((d) => !active.includes(d)))];
    return { drawn: [...new Set(drawn)], missing }`)
  check(`Cada tecla dibujada vale (${where})`, res.missing.length === 0, res.missing.length ? `sin atajo: ${res.missing.join(', ')}` : res.drawn.join(' '))
}

/** Escribe en el buscador de la biblioteca (de golpe, como si se pegara). */
async function setSearch(text) {
  await app.evaluate('const i = document.querySelector("[data-testid=library-search]"); i.value = args.text; i.dispatchEvent(new Event("input")); return true', { text })
  await sleep(150)
}
const clearSearch = () => setSearch('')

/** Los nombres de las tarjetas de la biblioteca se leen enteros o, si no caben, se cortan con «…» y el título los da enteros. */
async function namesAreReadable(where) {
  const res = await app.evaluate(`return [...document.querySelectorAll('[data-testid=library-asset]')].map((card) => {
      const el = card.querySelector('.asset-name'); const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      const listen = card.querySelector('.listen');
      return { id: card.dataset.assetId, text: el.textContent.trim(), cut, ellipsis: getComputedStyle(el).textOverflow === 'ellipsis' || getComputedStyle(el).webkitLineClamp !== 'none', title: el.title, aria: listen?.getAttribute('aria-label') ?? '' } })`)
  const bad = res.filter((r) => r.cut && !(r.ellipsis && r.title === r.text) || (r.aria && !r.aria.includes(r.text)))
  const cut = res.filter((r) => r.cut)
  check(`Nombres de la biblioteca enteros o con «…» y el título completo (${where})`, res.length > 0 && bad.length === 0, bad.length ? bad.map((b) => b.id).join(', ') : `${res.length} tarjetas, ${cut.length} cortadas con «…»${cut.length ? ` (${cut.slice(0, 4).map((c) => c.text).join(' | ')}${cut.length > 4 ? '…' : ''})` : ''}`)
}

/** Elige una categoría de la biblioteca en su desplegable (null = «Todo»), como al elegirla con el ratón. */
async function selectCategory(id) {
  await app.evaluate('const s = document.querySelector("[data-testid=library-category]"); const i = [...s.options].findIndex((o) => o.dataset.category === (args.id ?? "")); if (i < 0) throw new Error("no está la categoría " + args.id); s.selectedIndex = i; s.dispatchEvent(new Event("change")); return true', { id })
  await sleep(200)
}

/** Captura de la biblioteca de sonidos con cada categoría (lib-<categoría>-<ancho>.png), comprobando los nombres. */
async function libraryCategoryShots(size) {
  const cats = await S('return library.categories.value.filter((c) => c.kind === "sound").map((c) => c.id)')
  const counts = []
  for (const id of cats) {
    await selectCategory(id)
    const n = await app.evaluate('return document.querySelectorAll("[data-testid=library-asset]").length')
    const label = await app.evaluate('const s = document.querySelector("[data-testid=library-category]"); return s.options[s.selectedIndex].textContent.trim()')
    counts.push(`${id} ${n}`)
    if (!label.endsWith(`(${n})`)) check(`El contador de «${id}» dice lo que hay`, false, `«${label}» y ${n} tarjetas`)
    await app.evaluate('const g = document.querySelector("[data-testid=library-grid]"); g.scrollTop = 0; return true')
    await shot(`lib-${id}-${size}.png`)
    await namesAreReadable(`«${id}» a ${size}`)
  }
  await selectCategory(null)
  check(`Cada categoría de sonidos se elige y su contador cuadra (${size})`, cats.length >= 10, counts.join(' · '))
}

/** Nada cortado ni tapado en la vista de pistas, la barra del elemento y la biblioteca. */
async function layoutIsClean(where) {
  const res = await app.evaluate(`const bad = [];
    const sel = '[data-testid=item-bar] .btn, [data-testid=fx-panel] .btn, [data-testid=fx-panel] .seg, [data-testid=tracks-view] .zbtn, [data-testid=track-header] .mini, [data-testid=main-header] .mini, [data-testid=library-panel] .btn, [data-testid=library-panel] .tab, [data-testid=clip-panel] .btn';
    // Lo que está fuera de la vista dentro de una lista que se desplaza no cuenta (no está cortado: se desplaza).
    const clippedByScroll = (el, r) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll') { const pr = p.getBoundingClientRect(); return r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5 } } return false };
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect(); if (r.width === 0 || clippedByScroll(el, r)) continue;
      if (el.scrollWidth > el.clientWidth + 1) bad.push('cortado: ' + el.innerText.trim());
      if (r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5) bad.push('fuera de la ventana: ' + el.innerText.trim());
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const STICKY = '.video-row, [data-testid=main-header], [data-testid=add-track-row], [data-testid=tracks-view] .corner, [data-testid=tracks-ruler]';
      const underSticky = hit && !el.closest(STICKY) && !!hit.closest(STICKY);
      if (hit && hit !== el && !el.contains(hit) && !hit.closest('.popover') && !underSticky) bad.push('tapado: ' + el.innerText.trim() + ' por ' + (hit.dataset?.testid ?? hit.className ?? hit.tagName));
    }
    const player = document.querySelector('[data-testid=preview-frame]').getBoundingClientRect();
    return { bad, preview: Math.round(player.width) + 'x' + Math.round(player.height) }`)
  check(`Nada cortado ni tapado (${where})`, res.bad.length === 0, res.bad.length ? res.bad.join(' | ') : `vista previa ${res.preview}`)
  return res
}

/**
 * Los botones de la cabecera de cada fila caben en su fila (no se salen por abajo ni pisan la siguiente): se
 * mide con getBoundingClientRect de cada botón dentro de su cabecera, y la cabecera, del alto de su fila.
 */
async function headersFit(where) {
  const res = await app.evaluate(`const bad = []; let n = 0;
    for (const h of document.querySelectorAll('[data-testid=track-header], [data-testid=main-header]')) {
      const hr = h.getBoundingClientRect(); if (hr.height === 0) continue; n++;
      const row = h.dataset.trackId ? document.querySelector('[data-testid=track-row][data-track-id="' + h.dataset.trackId + '"]') : document.querySelector('[data-testid=video-row]');
      const rr = row.getBoundingClientRect();
      if (Math.abs(rr.top - hr.top) > 0.5 || Math.abs(rr.bottom - hr.bottom) > 0.5) bad.push((h.dataset.trackId ?? 'vídeo') + ': cabecera ' + Math.round(hr.height) + ' px, fila ' + Math.round(rr.height) + ' px');
      for (const b of h.querySelectorAll('button, input, .name-line')) {
        const r = b.getBoundingClientRect(); if (r.width === 0) continue;
        if (r.top < hr.top - 0.5 || r.bottom > hr.bottom - 0.5 || r.left < hr.left - 0.5 || r.right > hr.right + 0.5) bad.push((h.dataset.trackId ?? 'vídeo') + ' ' + (b.dataset.testid ?? b.className) + ': ' + [r.top, r.bottom].map(Math.round).join('–') + ' fuera de ' + [hr.top, hr.bottom].map(Math.round).join('–'));
      }
    }
    return { n, bad }`)
  check(`Los botones de cada cabecera caben en su fila (${where})`, res.n > 0 && res.bad.length === 0, res.bad.length ? res.bad.slice(0, 6).join(' | ') : `${res.n} filas`)
}

/** headersFit a varios tamaños de ventana (vuelve a 1280×800). */
async function headersFitAtSizes(where) {
  for (const [w, h] of [[1280, 800], [1100, 700], [1920, 1080], [2000, 1100], [2400, 1300]]) {
    await app.setViewport(w, h)
    await sleep(250)
    // Con muchas filas, recorrerlas todas (la fila «Vídeo» y el pie se quedan fijos).
    const sc = await app.evaluate('const s = document.querySelector("[data-testid=tracks-scroller]"); return { h: s.scrollHeight, c: s.clientHeight }')
    for (let y = 0; y <= Math.max(0, sc.h - sc.c); y += Math.max(40, sc.c - 60)) {
      await app.evaluate('document.querySelector("[data-testid=tracks-scroller]").scrollTop = args.y; return true', { y })
      await sleep(80)
      await headersFit(`${where}, ${w}×${h}${sc.h > sc.c ? `, desplazado ${y} px` : ''}`)
    }
    await app.evaluate('document.querySelector("[data-testid=tracks-scroller]").scrollTop = 0; return true')
  }
  await app.setViewport(1280, 800)
  await sleep(250)
}

// ================================================================== prueba

try {
  await startApp()
  app = await connectToApp(port, { timeoutMs: 240_000 })
  console.log(`Conectado a ${app.url}`)
  await app.waitFor('return !!window.__easyCut?.store', { timeoutMs: 60_000, what: 'store de la app (modo desarrollo)' })
  await app.evaluate('await window.__easyCut.bridge.clearAutosave(); location.reload(); return true')
  await sleep(1500)
  app.close()
  app = await connectToApp(port)
  await app.waitFor('return !!window.__easyCut?.store')
  await app.setViewport(1280, 800)
  await waitScreen('new-video')

  // --- Tres trozos: horizontal (10 s), con pausas (12 s) y otro horizontal (10 s)
  await app.click('[data-testid=new-video]')
  await waitScreen('pick-videos')
  await queuePick([media.horizontal, media.silence, media.horizontal])
  await app.click('[data-testid=pick-videos]')
  await waitScreen('editor', 30_000)
  await app.waitFor('return !document.querySelector("[data-testid=preparing]") && window.__easyCut.store.project.value.clips.length === 3', { timeoutMs: 30_000 })
  check(
    'Sin pistas, «Tu vídeo» abre ya en la vista de pistas: solo la fila «Vídeo» con sus 3 trozos',
    (await app.evaluate('return !!document.querySelector("[data-testid=tracks-view]") && !document.querySelector("[data-testid=clip-strip]") && document.querySelectorAll("[data-testid=track-row]").length === 0 && document.querySelectorAll("[data-testid^=clip-block-]").length === 3')) === true,
  )
  check('En la columna derecha, «Añadir sonidos y efectos»', (await app.text('[data-testid=add-sounds-effects]')) === 'Añadir sonidos y efectos')
  check('Sin conmutador tarjetas / pistas ni atajo V', !(await app.evaluate('return !!document.querySelector("[data-testid=view-cards], [data-testid=view-tracks]") || window.__easyCut.shortcuts().some((s) => s.keys.includes("v"))')))
  await shot('tracks-00-sin-pistas.png')
  await visibleKeyHintsAreShortcuts('«Tu vídeo» sin pistas')

  // --- Biblioteca: sonidos (escuchar y «Poner aquí»)
  await app.click('[data-testid=add-sounds-effects]')
  await waitScreen('library-panel')
  const soundCount = await app.evaluate('return document.querySelectorAll("[data-testid=library-asset]").length')
  check('La biblioteca enseña los sonidos', soundCount >= 6, `${soundCount} sonidos`)
  await app.click('[data-testid=library-listen-ding]')
  const listening = await app.waitFor('const a = document.querySelector("[data-testid=library-panel] audio"); return a && !a.paused && a.currentTime > 0 ? a.currentTime : null', { timeoutMs: 10_000, what: 'probar un sonido' })
  check('Al pulsar su tarjeta, el sonido suena (para probarlo antes de poner)', listening > 0, `${listening} s`)
  await app.click('[data-testid=library-listen-ding]')
  {
    const applause = ['aplausos-auditorio', 'ovacion-teatro', 'ovacion-teatro-larga', 'aplausos-gimnasio']
    const shown = () => app.evaluate('return [...document.querySelectorAll("[data-testid=library-asset]")].map((a) => a.dataset.assetId)')
    const inApplause = (ids) => S('return args.ids.every((id) => library.asset(id)?.category === "aplausos-y-vitores")', { ids })
    for (const word of ['aplauso', 'palmas']) {
      await app.click('[data-testid=library-search]')
      for (const ch of word) await app.key(ch)
      const found = await shown()
      check(`El buscador encuentra los aplausos escribiendo «${word}»`, applause.every((id) => found.includes(id)) && (await inApplause(found)), found.join(', '))
      await clearSearch()
    }
    await setSearch('ÁPLAUSO')
    const upper = await shown()
    check('Y sin mirar tildes ni mayúsculas («ÁPLAUSO»)', applause.every((id) => upper.includes(id)), upper.join(', '))
    await setSearch('aplauso')
    await shot('lib-busqueda-aplauso-1280.png')
    await namesAreReadable('búsqueda «aplauso» a 1280×800')
    await clearSearch()
    await app.evaluate('document.activeElement?.blur(); return true')
  }
  await libraryCategoryShots('1280')
  await shot('tracks-01-biblioteca-sonidos.png')

  await seekTo(12_000)
  check('El cabezal está a los 12 s', Math.abs((await playheadMs()) - 12_000) < 50, String(await playheadMs()))
  await app.click('[data-testid=library-put-ding]')
  await app.waitFor('return window.__easyCut.store.project.value.tracks.length === 1', { timeoutMs: 20_000, what: 'ding puesto' })
  await noErrorDialog('poner el ding')
  {
    const list = await items()
    const ding = list[0]
    check('«Poner aquí»: en la línea, en una pista de sonido nueva', ding.kind === 'sound' && Math.abs(ding.start - 12_000) < 50 && ding.trackName === 'Sonidos', JSON.stringify({ start: ding.start, track: ding.trackName }))
    const c = await clipStarts()
    check('Y pegado al trozo de debajo (el 2, a 2 s de su principio)', ding.anchor.clipId === c[1].id && Math.abs(ding.anchor.offsetMs - 2000) < 50, JSON.stringify(ding.anchor))
    check('Al poner lo primero, aparece su pista debajo de la fila «Vídeo»', (await app.evaluate('const v = document.querySelector("[data-testid=video-row]").getBoundingClientRect(); const rows = [...document.querySelectorAll("[data-testid=track-row]")]; return rows.length === 1 && rows[0].getBoundingClientRect().top >= v.bottom - 1')) === true)
    check('Y queda elegido (su barra sale al cerrar la biblioteca)', (await S('return tracks.selectedItemId.value')) === ding.id && !(await app.text('[data-testid=item-bar]')))
  }

  // --- Biblioteca: efectos (probar sobre mi vídeo y «Poner aquí»)
  await app.click('[data-testid=library-tab-effects]')
  await app.waitFor('return [...document.querySelectorAll("[data-testid=library-asset] video")].filter((v) => v.readyState >= 2).length >= 4', { timeoutMs: 30_000, what: 'vistas previas de los efectos' })
  check('Los efectos se ven en su tarjeta (vídeo en bucle)', true)
  await app.click('[data-testid=library-try-chispas]')
  const trying = await app.waitFor('const v = document.querySelector("[data-testid=trying-effect]"); return v && v.readyState >= 2 && !v.paused ? getComputedStyle(v).mixBlendMode : null', { timeoutMs: 15_000, what: 'probar sobre mi vídeo' })
  check('«Probar sobre mi vídeo»: se ve en la vista previa, como luz', trying === 'screen', trying)
  await shot('tracks-02-biblioteca-efectos.png')
  await app.click('[data-testid=library-try-chispas]')
  check('Y otra vez lo quita', !(await app.evaluate('return !!document.querySelector("[data-testid=trying-effect]")')))
  await seekTo(25_000)
  await app.click('[data-testid=library-put-luz-calida]')
  await app.waitFor('return window.__easyCut.store.project.value.tracks.some((t) => t.kind === "effect")', { timeoutMs: 20_000, what: 'efecto puesto' })
  {
    const fx = (await items()).find((i) => i.kind === 'effect')
    const c = await clipStarts()
    check('Efecto puesto a los 25 s, pegado al trozo 3 (+3 s)', Math.abs(fx.start - 25_000) < 50 && fx.anchor.clipId === c[2].id && Math.abs(fx.anchor.offsetMs - 3000) < 50, JSON.stringify(fx.anchor))
    check('Con los valores de la biblioteca: como luz, repite', fx.item.look.mix === 'light' && fx.item.repeat, JSON.stringify(fx.item.look))
  }

  // --- De mi ordenador: un sonido
  await app.click('[data-testid=library-tab-computer]')
  await seekTo(12_000)
  await queuePick([music])
  await app.click('[data-testid=library-pick-files]')
  await app.waitFor('return window.__easyCut.store.project.value.tracks.filter((t) => t.kind === "sound").length === 2', { timeoutMs: 20_000, what: 'sonido del ordenador puesto' })
  await noErrorDialog('poner un sonido del ordenador')
  {
    const m = (await items()).find((i) => i.name === 'Música de prueba')
    check('«De mi ordenador»: el sonido entra en la línea y, como pisaría al «ding», en otra pista', !!m && Math.abs(m.start - 12_000) < 50 && m.trackName === 'Sonidos 2', JSON.stringify({ start: m?.start, track: m?.trackName }))
  }
  // Esc cierra primero el aviso abierto («Puesto en…») y después la biblioteca.
  await closeLibraryWithEsc()
  check('Esc cierra la biblioteca', !(await app.evaluate('return !!document.querySelector("[data-testid=library-panel]")')))
  await sleep(500)
  await shot('tracks-03-pistas.png')
  await layoutIsClean('pistas a 1280×800')
  await visibleKeyHintsAreShortcuts('pistas con un elemento elegido')

  const musicId = (await items()).find((i) => i.name === 'Música de prueba').id
  const dingId = (await items()).find((i) => i.item.source.assetId === 'ding').id
  const fxId = (await items()).find((i) => i.kind === 'effect').id

  // --- Mover arrastrando (con imán) y con «A la línea»
  await selectItem(musicId)
  await shot('tracks-04-elemento-elegido.png')
  {
    const px = await pxPerSec()
    const c = await blockCenter(musicId)
    const before = (await items()).find((i) => i.id === musicId).start
    await app.drag({ x: c.x, y: c.y }, { x: c.x + px * 3.3, y: c.y }, 14)
    const after = (await items()).find((i) => i.id === musicId).start
    check('Arrastrar mueve el sonido (+3,3 s)', Math.abs(after - before - 3300) < (1000 * 10) / px + 50, `${before} → ${after}`)
    await app.key('z', { ctrl: true })
    check('Y el arrastre se deshace en un paso', (await items()).find((i) => i.id === musicId).start === before)
    // Imán: soltar cerca del principio del trozo 3 (22 s) lo pega ahí.
    const c3 = (await clipStarts())[2].start
    const c2 = await blockCenter(musicId)
    await app.drag({ x: c2.x, y: c2.y }, { x: c2.x + ((c3 - before) / 1000) * px + 5, y: c2.y }, 14)
    const snapped = (await items()).find((i) => i.id === musicId).start
    check('Imán: se pega al principio del trozo 3', snapped === c3, `${snapped} (trozo 3 en ${c3})`)
    await seekTo(14_000)
    await app.key('m')
    check('«A la línea» (M) sin arrastrar', Math.abs((await items()).find((i) => i.id === musicId).start - 14_000) < 60)
  }

  // --- Recortar por el asa y con T
  {
    const px = await pxPerSec()
    const before = (await items()).find((i) => i.id === musicId)
    const h = await app.center(`[data-testid=track-item][data-item-id="${musicId}"] [data-testid=item-handle-end]`)
    await app.drag({ x: h.x, y: h.y }, { x: h.x - px * 1.5, y: h.y }, 10)
    const after = (await items()).find((i) => i.id === musicId)
    check('El asa del final recorta (−1,5 s)', Math.abs(after.end - before.end + 1500) < (1000 * 10) / px + 50 && after.start === before.start, `${before.end} → ${after.end}`)
    await seekTo(17_000)
    await app.key('t')
    check('«Que termine en la línea» (T)', Math.abs((await items()).find((i) => i.id === musicId).end - 17_000) < 60)
  }

  // --- Partir, duplicar, volumen, entrada suave, repetir
  {
    await seekTo(15_500)
    await app.click('[data-testid=item-split]')
    const parts = (await items()).filter((i) => i.name === 'Música de prueba')
    check('«Partir» en la línea: dos partes', parts.length === 2 && parts.some((p) => Math.abs(p.end - 15_500) < 60), parts.map((p) => `${p.start}–${p.end}`).join(', '))
    await app.key('z', { ctrl: true })
    await selectItem(musicId)
    await app.key('d')
    const copies = (await items()).filter((i) => i.name === 'Música de prueba')
    check('«Duplicar» (D): una copia justo detrás', copies.length === 2 && copies[1].start === copies[0].end, copies.map((p) => `${p.start}–${p.end}`).join(', '))
    await app.key('z', { ctrl: true })
    await selectItem(musicId)
    await app.click('[data-testid=item-volume]')
    await shot('tracks-04b-volumen.png')
    await app.evaluate('const s = document.querySelector("[data-testid=volume-slider]"); s.value = "50"; s.dispatchEvent(new Event("input")); s.dispatchEvent(new Event("change")); return true')
    check('Volumen al 50 %', (await items()).find((i) => i.id === musicId).item.volume === 0.5)
    await app.key('Escape')
    await app.click('[data-testid=item-fade-in]')
    check('«Entrada suave»: un segundo', (await items()).find((i) => i.id === musicId).item.fadeInMs === 1000)
    await app.click('[data-testid=item-repeat]')
    const rep = (await items()).find((i) => i.id === musicId)
    check('«Repetir»: hasta el final del vídeo', rep.item.repeat && rep.item.durationMs === null && rep.end === (await S('return store.durationMs.value')), `${rep.start}–${rep.end}`)
  }

  // --- Silenciar / ocultar pistas y la fila principal; quitar pista y deshacer
  {
    const musicTrack = (await items()).find((i) => i.id === musicId).track
    await seekTo(20_000)
    const mounted = () => app.evaluate('return [...document.querySelectorAll("[data-testid=track-sound]")].map((a) => a.dataset.itemId)')
    check('Antes de silenciar, su <audio> está montado en la vista previa', (await mounted()).includes(musicId), (await mounted()).join(','))
    await app.click(`[data-testid=track-header][data-track-id="${musicTrack}"] [data-testid=track-toggle]`)
    check('«Silenciar» la pista: muted y la fila atenuada', (await S('return store.project.value.tracks.find((t) => t.id === args.t).muted', { t: musicTrack })) && (await app.evaluate('return document.querySelector(`[data-testid=track-row][data-track-id="${args.t}"]`).classList.contains("off")', { t: musicTrack })))
    await sleep(400)
    check('Y deja de sonar al momento (se desmonta de la vista previa)', !(await mounted()).includes(musicId))
    await shot('tracks-05-pista-silenciada.png')
    await app.click(`[data-testid=track-header][data-track-id="${musicTrack}"] [data-testid=track-toggle]`)
    const fxTrack = (await items()).find((i) => i.id === fxId).track
    await app.click(`[data-testid=track-header][data-track-id="${fxTrack}"] [data-testid=track-toggle]`)
    check('«Ocultar» la pista de efectos', await S('return store.project.value.tracks.find((t) => t.id === args.t).hidden', { t: fxTrack }))
    await app.click(`[data-testid=track-header][data-track-id="${fxTrack}"] [data-testid=track-toggle]`)
    await app.click('[data-testid=main-mute]')
    await sleep(300)
    const mainMuted = await app.evaluate('const p = document.querySelector("[data-testid=player]"); const v = [...document.querySelectorAll("[data-testid=preview-frame] video:not([data-testid])")]; return { attr: p.dataset.mainMuted, allMuted: v.every((x) => x.muted) }')
    check('«Silenciar» la fila «Vídeo»: mainMuted y los vídeos de los trozos callados', mainMuted.attr === '1' && mainMuted.allMuted, JSON.stringify(mainMuted))
    await app.click('[data-testid=main-mute]')
    await app.click(`[data-testid=track-header][data-track-id="${musicTrack}"] [data-testid=track-remove]`)
    await waitScreen('confirm-dialog')
    check('Quitar una pista con cosas pregunta antes', (await app.text('[data-testid=confirm-dialog]')).includes('¿Quitar la pista'))
    await app.click('[data-testid=confirm-ok]')
    check('Pista quitada', !(await S('return store.project.value.tracks.some((t) => t.id === args.t)', { t: musicTrack })))
    await app.key('z', { ctrl: true })
    check('Deshacer la recupera con lo que tenía', (await items()).some((i) => i.id === musicId))
  }

  // --- Cabeceras: los botones caben en su fila (con dos o tres filas y a varios tamaños, también ~2000 px)
  await headersFitAtSizes(`${(await S('return store.project.value.tracks.length'))} pistas`)

  // --- Escuchar solo una pista (y la fila «Vídeo») de un toque
  {
    const musicTrack = (await items()).find((i) => i.id === musicId).track
    const sel = `[data-testid=track-header][data-track-id="${musicTrack}"] [data-testid=track-solo]`
    await app.click(sel)
    const state = () => S('const p = store.project.value; return { main: p.mainMuted, sounds: p.tracks.filter((t) => t.kind === "sound").map((t) => [t.id, t.muted]) }')
    const solo = await state()
    check('«Escuchar solo esta»: suena solo esa pista (la fila «Vídeo» y las demás, silenciadas)', solo.main && solo.sounds.every(([id, m]) => (id === musicTrack ? !m : m)), JSON.stringify(solo))
    check('El botón se ve encendido y las demás filas, atenuadas', (await app.evaluate(`return document.querySelector(args.sel).getAttribute('aria-pressed') === 'true' && document.querySelector('[data-testid=video-row]').classList.contains('off')`, { sel })) === true)
    await shot('tracks-05b-solo-una-pista.png')
    await app.click(sel)
    const all = await state()
    check('Otra vez: vuelve a sonar todo', !all.main && all.sounds.every(([, m]) => !m), JSON.stringify(all))
    await app.click('[data-testid=main-solo]')
    const main = await state()
    check('«Escuchar solo esta» en la fila «Vídeo»: calla las pistas de sonido', !main.main && main.sounds.every(([, m]) => m), JSON.stringify(main))
    await app.key('z', { ctrl: true })
  }

  // --- Pistas nuevas a mano (sin límite) y pasar un sonido de una a otra
  {
    const n0 = await S('return store.project.value.tracks.length')
    const sounds0 = await S('return store.project.value.tracks.filter((t) => t.kind === "sound").length')
    await app.click('[data-testid=add-sound-track]')
    const added = await S('const t = store.project.value.tracks.at(-1); return { kind: t.kind, name: t.name, items: t.items.length }')
    check('«Pista de sonido» añade una pista vacía debajo de las de sonido', added.kind === 'sound' && added.items === 0 && added.name === `Sonidos ${sounds0 + 1}`, JSON.stringify(added))
    await app.click('[data-testid=add-effect-track]')
    const top = await S('const t = store.project.value.tracks[0]; return { kind: t.kind, items: t.items.length }')
    check('«Pista de efectos» añade una pista de efectos encima de las demás', top.kind === 'effect' && top.items === 0, JSON.stringify(top))
    check('El pie explica cómo pasar algo de una pista a otra', (await app.text('[data-testid=add-track-row]')).includes('arrástralo hasta ella'))
    // Pasar el «ding» a la pista nueva arrastrándolo hacia abajo (con la vista previa pequeña, que se vean las dos).
    await app.click('[data-testid=split-small]')
    const newTrack = await S('return store.project.value.tracks.at(-1).id')
    const row = await app.center(`[data-testid=track-row][data-track-id="${newTrack}"]`)
    const d = await blockCenter(dingId)
    check('La pista nueva y el «ding» se ven a la vez', Math.abs(row.y - (await app.center(`[data-testid=track-row][data-track-id="${newTrack}"]`)).y) < 1, `${row.y}`)
    await app.drag({ x: d.x, y: d.y }, { x: d.x, y: row.y }, 12)
    const moved = (await items()).find((i) => i.id === dingId)
    check('Arrastrar un sonido hasta la pista nueva lo pasa a ella (en el mismo instante)', moved.track === newTrack, `${moved.track} (${moved.start} ms)`)
    await app.key('z', { ctrl: true })
    // Y muchas más: no hay tope (antes, 4 de sonido y 3 de efectos).
    for (let i = 0; i < 5; i++) await app.click('[data-testid=add-sound-track]')
    for (let i = 0; i < 3; i++) await app.click('[data-testid=add-effect-track]')
    const n = await S('return store.project.value.tracks.length')
    check('Sin límite de pistas: 12 o más', n === n0 + 10 && n >= 12, `${n0} → ${n}`)
    const scroll = await app.evaluate('const s = document.querySelector("[data-testid=tracks-scroller]"); return { h: s.scrollHeight, c: s.clientHeight }')
    check('Con muchas filas, la zona de pistas se desplaza hacia abajo', scroll.h > scroll.c + 100, JSON.stringify(scroll))
    await app.evaluate('const s = document.querySelector("[data-testid=tracks-scroller]"); s.scrollTop = s.scrollHeight; return true')
    await sleep(200)
    const fixed = await app.evaluate(`const s = document.querySelector('[data-testid=tracks-scroller]').getBoundingClientRect();
      const v = document.querySelector('[data-testid=video-row]').getBoundingClientRect(); const a = document.querySelector('[data-testid=add-track-row]').getBoundingClientRect();
      return v.top >= s.top - 0.5 && v.bottom <= s.bottom + 0.5 && a.bottom <= s.bottom + 0.5 && a.top >= s.top`)
    check('Desplazando, la fila «Vídeo» y el pie se quedan a la vista', fixed === true)
    await shot('tracks-18-muchas-pistas.png')
    await headersFitAtSizes(`${n} pistas`)
    await app.setViewport(1100, 700)
    await shot('tracks-19-muchas-pistas-1100.png')
    await app.setViewport(2000, 1100)
    await shot('tracks-20-muchas-pistas-2000.png')
    await app.setViewport(1280, 800)
    for (let i = 0; i < 10; i++) await app.key('z', { ctrl: true })
    check('Deshacer quita las pistas añadidas', (await S('return store.project.value.tracks.length')) === n0)
    await app.click('[data-testid=split-medium]')
  }

  // --- Quitar pausas en un trozo anterior: lo de después conserva su sitio respecto a su trozo
  {
    const before = (await items()).find((i) => i.id === fxId)
    const c3before = (await clipStarts())[2].start
    await app.click('[data-testid=clip-block-2]')
    await app.click('[data-testid=fix-clip]')
    await waitScreen('clip-editor')
    await app.click('[data-testid=tab-pauses]')
    await app.click('[data-testid=find-pauses]')
    await app.waitFor('return document.querySelector("[data-testid=pauses-found]")', { timeoutMs: 30_000, what: 'pausas encontradas' })
    await app.click('[data-testid=remove-pauses]')
    await app.click('[data-testid=clip-done]')
    await waitScreen('editor')
    const after = (await items()).find((i) => i.id === fxId)
    const c3after = (await clipStarts())[2].start
    check('Quitar pausas en el trozo 2 adelanta el trozo 3 y su efecto lo mismo', c3after < c3before - 1500 && after.start - c3after === before.start - c3before, `trozo 3: ${c3before} → ${c3after}; efecto a +${after.start - c3after} ms`)
  }

  // --- Reordenar un trozo: lo pegado va con él
  {
    const ding0 = (await items()).find((i) => i.id === dingId)
    const sil = (await clipStarts())[1]
    const b = await app.center('[data-testid=clip-block-2]')
    const end = await app.center('[data-testid=clip-block-3]')
    await app.drag({ x: b.x, y: b.y }, { x: end.x + end.w / 2 - 4, y: end.y }, 16)
    const order = await clipStarts()
    const moved = order.findIndex((c) => c.id === sil.id)
    const ding1 = (await items()).find((i) => i.id === dingId)
    check('Arrastrar el trozo 2 al final en la fila «Vídeo»', moved === 2, order.map((c) => c.id.slice(0, 4)).join(' '))
    check('Y su «ding» va con él (misma distancia a su principio)', ding1.start - order[2].start === ding0.start - sil.start, `${ding0.start} → ${ding1.start}`)
    await shot('tracks-08-reordenado.png')
  }

  // --- Quitar el trozo ancla: lo pegado se queda en el mismo sitio del vídeo
  {
    const fx0 = (await items()).find((i) => i.id === fxId)
    const anchorIndex = (await clipStarts()).findIndex((c) => c.id === fx0.anchor.clipId)
    await app.click(`[data-testid=clip-block-${anchorIndex + 1}]`)
    await app.click('[data-testid=remove-clip]')
    const toast = await app.text('[data-testid=toast]')
    const fx1 = (await items()).find((i) => i.id === fxId)
    check('Al quitar su trozo, el efecto se queda en el mismo sitio del vídeo', !!fx1 && fx1.start === Math.min(fx0.start, (await S('return store.durationMs.value'))), `${fx0.start} → ${fx1?.start}`)
    check('Y lo avisa', (toast ?? '').includes('1 efecto estaba pegado a este trozo: se queda en el mismo sitio del vídeo'), toast)
    await app.key('z', { ctrl: true })
    check('Deshacer lo deja todo como estaba (en un paso)', (await clipStarts()).length === 3 && (await items()).find((i) => i.id === fxId).anchor.clipId === fx0.anchor.clipId)
  }

  // --- Zoom
  {
    const fit = await pxPerSec()
    await app.click('[data-testid=zoom-in]')
    await app.click('[data-testid=zoom-in]')
    const zoomed = await pxPerSec()
    check('«Acercar» amplía las pistas', zoomed > fit * 1.5, `${fit} → ${zoomed} px/s`)
    await app.key('-')
    check('«−» aleja', (await pxPerSec()) < zoomed)
    await app.click('[data-testid=zoom-fit]')
    check('«Ver todo» vuelve a que quepa todo', Math.abs((await pxPerSec()) - fit) < 0.01, String(await pxPerSec()))
  }

  // --- «Tamaño y sitio» de un efecto (logo PNG del ordenador)
  {
    await seekTo(2000)
    await app.click('[data-testid=add-sounds-effects]')
    await app.click('[data-testid=library-tab-computer]')
    await queuePick([logo])
    await app.click('[data-testid=library-pick-files]')
    await app.waitFor('return window.__easyCut.store.project.value.tracks.flatMap((t) => t.items).some((i) => i.still)', { timeoutMs: 20_000, what: 'logo puesto' })
    await closeLibraryWithEsc()
    const logoItem = (await items()).find((i) => i.item.still)
    check('Una imagen del ordenador entra como efecto (imagen fija, 4 s)', logoItem.kind === 'effect' && logoItem.end - logoItem.start === 4000, `${logoItem.start}–${logoItem.end}`)
    await seekTo(3000)
    await app.click('[data-testid=item-box]')
    await waitScreen('box-editor')
    const box0 = (await items()).find((i) => i.id === logoItem.id).item.look.box
    const b = await app.center('[data-testid=box-editor]')
    await app.drag({ x: b.x, y: b.y }, { x: b.x + 120, y: b.y + 60 }, 10)
    const box1 = (await items()).find((i) => i.id === logoItem.id).item.look.box
    check('Arrastrar el recuadro lo mueve', box1.x > box0.x + 0.05 && box1.y > box0.y + 0.05, `${JSON.stringify(box0)} → ${JSON.stringify(box1)}`)
    const h = await app.center('[data-testid=box-handle-br]')
    await app.drag({ x: h.x, y: h.y }, { x: h.x - 60, y: h.y - 30 }, 10)
    const box2 = (await items()).find((i) => i.id === logoItem.id).item.look.box
    check('Tirar de una esquina lo hace más pequeño', box2.scale < box1.scale, `${box1.scale} → ${box2.scale}`)
    await shot('tracks-06-tamano-y-sitio.png')
    await visibleKeyHintsAreShortcuts('«Tamaño y sitio»')
    await app.click('[data-testid=box-fullscreen]')
    const box3 = (await items()).find((i) => i.id === logoItem.id).item.look.box
    check('«Pantalla completa» lo vuelve a centrar y a tamaño 1', box3.x === 0.5 && box3.y === 0.5 && box3.scale === 1)
    await app.key('z', { ctrl: true })
    await app.key('Escape')
    check('Esc deja «Tamaño y sitio» (el elemento sigue elegido)', !(await app.evaluate('return !!document.querySelector("[data-testid=box-editor]")')) && !!(await app.text('[data-testid=item-bar]')))
    await app.click('[data-testid=item-mix]')
    await shot('tracks-06b-como-se-mezcla.png')
    await app.click('[data-testid=mix-light]')
    check('«Cómo se mezcla» → «Como luz»', (await items()).find((i) => i.id === logoItem.id).item.look.mix === 'light')
    await app.key('z', { ctrl: true })
    await layoutIsClean('barra de un efecto')
    await visibleKeyHintsAreShortcuts('barra de un efecto')
  }

  // --- Indicadores en la fila «Vídeo» (lo que decían las tarjetas)
  {
    const labels = await app.evaluate('return [...document.querySelectorAll("[data-testid^=clip-block-]")].filter((b) => b.dataset.badges.split(" ").includes("attached")).map((b) => b.getAttribute("aria-label"))')
    check('Cada trozo de la fila «Vídeo» dice cuántos sonidos/efectos lleva pegados', labels.length >= 2 && labels.every((b) => /lleva pegado .*(sonido|efecto)/.test(b)), labels.join(' | '))
    const pauses = await app.evaluate('return [...document.querySelectorAll("[data-testid^=clip-block-]")].some((b) => b.dataset.badges.split(" ").includes("pauses") && !!b.querySelector(".b-pauses"))')
    check('Y el que tiene las pausas quitadas lo enseña', pauses)
    await shot('tracks-07-fila-video-indicadores.png')
  }

  // --- Recortar el principio del trozo ancla desde la fila «Vídeo»: lo pegado sigue a su imagen
  {
    const ding0 = (await items()).find((i) => i.id === dingId)
    const anchor = (await clipStarts()).findIndex((c) => c.id === ding0.anchor.clipId)
    const c0 = (await clipStarts())[anchor]
    const past0 = await S('return store.history.value.past.length')
    const px = await pxPerSec()
    const h = await app.center(`[data-testid=clip-block-${anchor + 1}] [data-testid=clip-handle-start]`)
    await app.drag({ x: h.x, y: h.y }, { x: h.x + px * 1, y: h.y }, 10)
    const ding1 = (await items()).find((i) => i.id === dingId)
    const c1 = (await clipStarts())[anchor]
    const cut = c0.start + (await S('return window.__easyCut.domain.clipOutputMs(store.project.value.clips[args.i])', { i: anchor })) // fin nuevo
    check('Recortar 1 s por delante el trozo del «ding»: el «ding» se adelanta lo mismo (sigue sobre su imagen)', c1.start === c0.start && Math.abs(ding0.start - ding1.start - 1000) < (1000 * 10) / px + 60 && ding1.anchor.clipId === ding0.anchor.clipId, `${ding0.start} → ${ding1.start} (trozo hasta ${cut})`)
    check('En un solo paso de deshacer', (await S('return store.history.value.past.length')) === past0 + 1)
    await app.key('z', { ctrl: true })
    check('Y al deshacer vuelve a su sitio', (await items()).find((i) => i.id === dingId).start === ding0.start)
  }

  // --- Reproducir: los sonidos y los efectos van sincronizados con el montaje
  {
    const ding = (await items()).find((i) => i.id === dingId)
    await seekTo(Math.max(0, ding.start - 1200))
    await app.key(' ')
    await sleep(2000)
    const sync = JSON.parse(await app.evaluate('return document.querySelector("[data-testid=track-layers]").dataset.sync'))
    const player = await app.evaluate('const d = document.querySelector("[data-testid=player]").dataset; return { ms: Number(d.currentMs), playing: d.playing }')
    const s = sync[dingId]
    const actual = await app.evaluate(`const a = document.querySelector('[data-testid=track-sound][data-item-id="${dingId}"]'); return a ? { t: a.currentTime * 1000, paused: a.paused } : null`)
    const expected = player.ms - ding.start
    check('Reproduciendo, el «ding» suena en su sitio (±150 ms del reloj del montaje)', !!actual && !actual.paused && Math.abs(actual.t - expected) < 150, `esperado ${Math.round(expected)} ms, real ${Math.round(actual?.t ?? -1)} ms; ${JSON.stringify(s)}`)
    await app.key(' ')
    const fx = (await items()).find((i) => i.id === fxId)
    await seekTo(fx.start + 500)
    await app.key(' ')
    await sleep(1500)
    const fxEl = await app.evaluate(`const v = document.querySelector('[data-testid=track-effect][data-item-id="${fxId}"]'); const p = document.querySelector('[data-testid=player]').dataset;
      return v ? { t: v.currentTime * 1000, paused: v.paused, vis: getComputedStyle(v).visibility, blend: getComputedStyle(v).mixBlendMode, ms: Number(p.currentMs) } : null`)
    const fxExpected = fxEl ? (fxEl.ms - fx.start) % 8000 : -1
    check('Y el efecto se ve, como luz, sincronizado', !!fxEl && !fxEl.paused && fxEl.vis === 'visible' && fxEl.blend === 'screen' && Math.abs(fxEl.t - fxExpected) < 150, JSON.stringify({ ...fxEl, fxExpected }))
    await app.key(' ')
  }

  // --- WebM VP9 con transparencia (corazones) en WebView2, en mezcla normal
  {
    await seekTo(4000)
    await app.click('[data-testid=add-sounds-effects]')
    await app.click('[data-testid=library-tab-effects]')
    await selectCategory('amor')
    await app.click('[data-testid=library-put-corazones]')
    await app.waitFor('return window.__easyCut.store.project.value.tracks.flatMap((t) => t.items).some((i) => i.source.assetId === "corazones")', { timeoutMs: 20_000, what: 'corazones puestos' })
    await closeLibraryWithEsc()
    const hearts = (await items()).find((i) => i.item.source.assetId === 'corazones')
    await seekTo(hearts.start + 1500)
    const v = await app.waitFor(`const v = document.querySelector('[data-testid=track-effect][data-item-id="${hearts.id}"]'); return v && v.readyState >= 2 && v.videoWidth > 0 ? { w: v.videoWidth, blend: getComputedStyle(v).mixBlendMode, vis: getComputedStyle(v).visibility } : null`, { timeoutMs: 15_000, what: 'corazones en la vista previa' })
    check('WebView2 reproduce el WebM VP9 con alfa (mezcla normal)', v.w === 1920 && v.blend === 'normal' && v.vis === 'visible', JSON.stringify(v))
    await shot('tracks-17-corazones-alfa.png')
    await app.key('Delete')
    check('Supr quita el efecto elegido', !(await items()).some((i) => i.id === hearts.id))
  }

  // --- Capturas a 1100×700
  {
    await app.setViewport(1100, 700)
    await sleep(600)
    await selectItem(musicId)
    await shot('tracks-11-pistas-1100.png')
    await layoutIsClean('pistas a 1100×700')
    await app.click('[data-testid=add-sounds-effects]')
    await app.click('[data-testid=library-tab-sounds]')
    await shot('tracks-12-biblioteca-sonidos-1100.png')
    await layoutIsClean('biblioteca a 1100×700')
    await libraryCategoryShots('1100')
    await setSearch('aplauso')
    await shot('lib-busqueda-aplauso-1100.png')
    await namesAreReadable('búsqueda «aplauso» a 1100×700')
    await clearSearch()
    await app.click('[data-testid=library-tab-effects]')
    await sleep(1200)
    await shot('tracks-13-biblioteca-efectos-1100.png')
    await closeLibraryWithEsc()
    const fxTrack = (await items()).find((i) => i.id === fxId).track
    await app.click(`[data-testid=track-header][data-track-id="${fxTrack}"] [data-testid=track-toggle]`)
    await shot('tracks-14-pista-oculta-1100.png')
    await app.click(`[data-testid=track-header][data-track-id="${fxTrack}"] [data-testid=track-toggle]`)
    const logoId = (await items()).find((i) => i.item.still).id
    await selectItem(logoId)
    await seekTo((await items()).find((i) => i.id === logoId).start + 500)
    await app.click('[data-testid=item-box]')
    await shot('tracks-15-tamano-y-sitio-1100.png')
    await layoutIsClean('«Tamaño y sitio» a 1100×700')
    await app.click('[data-testid=box-done]')
    await app.key('Escape')
    await shot('tracks-16-fila-video-1100.png')
    await layoutIsClean('fila «Vídeo» con un trozo elegido a 1100×700')
    await visibleKeyHintsAreShortcuts('fila «Vídeo» con un trozo elegido a 1100×700')
    await app.setViewport(1280, 800)
    await sleep(400)
  }

  // --- Guardar «Para WhatsApp» con pistas, y créditos en «¡Listo!»
  {
    // Para probar los créditos sin material de terceros: el «ding» pasa a pedir atribución en el catálogo cargado.
    await S(`const c = library.catalog.value; library.catalog.value = { ...c, assets: c.assets.map((a) => a.id === 'ding' ? { ...a, license: 'CC-BY-4.0', attribution: '«Ding» de Prueba (CC BY 4.0)' } : a) }; return true`)
    await app.click('[data-testid=save-video]')
    await waitScreen('save-view')
    await app.click('[data-testid=preset-whatsapp]')
    await app.waitFor('return !!document.querySelector("[data-testid=done-view]")', { timeoutMs: 180_000, what: 'vídeo guardado' })
    await noErrorDialog('guardar')
    const out = await S('return store.lastExport.value.path')
    const info = ffprobe(out)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    const dur = await S('return store.durationMs.value')
    check('Guardado «Para WhatsApp»: H.264 + AAC, duración y A/V como el montaje', v?.codec_name === 'h264' && a?.codec_name === 'aac' && Math.abs(Number(info.format.duration) * 1000 - dur) < 120 && Math.abs(Number(v.duration) - Number(a.duration)) < 0.05, `${info.format.duration} s (montaje ${dur} ms)`)
    const credits = await app.text('[data-testid=done-credits]')
    check('«¡Listo!» avisa de los créditos', (credits ?? '').includes('Este vídeo usa material con autor') && (await app.text('[data-testid=done-credits-text]')).includes('«Ding» de Prueba (CC BY 4.0)'), credits)
    await shot('tracks-09-listo-creditos.png')
    await app.click('[data-testid=copy-credits]')
    const copiedLabel = await app.text('[data-testid=copy-credits]')
    check('«Copiar los créditos»', copiedLabel === 'Créditos copiados', copiedLabel)
    await app.click('[data-testid=back-to-editor]')
    await waitScreen('editor')
    await S('library.catalog.value = window.__easyCut.domain.validateCatalog(library.catalog.value).catalog ?? library.catalog.value; return true')
  }

  // --- Un sonido de Freesound y uno de Kenney en un vídeo guardado, medidos en el fichero
  {
    await S(`const d = domain; let p = d.createProject('16:9'); p = d.addClip(p, d.createClip(store.media.value[args.h], 'tp-c1'));
      store.commit(d.setMainMuted(p, true)); return true`, { h: media.horizontal })
    await sleep(600)
    await seekTo(2000)
    await app.click('[data-testid=add-sounds-effects]')
    await waitScreen('library-panel')
    await app.click('[data-testid=library-tab-sounds]')
    await setSearch('recepcion')
    await app.click('[data-testid=library-put-campanita-recepcion]')
    await app.waitFor('return window.__easyCut.store.project.value.tracks.flatMap((t) => t.items).some((i) => i.source.assetId === "campanita-recepcion")', { timeoutMs: 20_000, what: 'campanita de Freesound puesta' })
    await noErrorDialog('poner la campanita de Freesound')
    await clearSearch()
    await seekTo(6000)
    await selectCategory('cuenta-atras')
    await app.click('[data-testid=library-put-voz-mujer-3]')
    await app.waitFor('return window.__easyCut.store.project.value.tracks.flatMap((t) => t.items).some((i) => i.source.assetId === "voz-mujer-3")', { timeoutMs: 20_000, what: 'voz de Kenney puesta' })
    await noErrorDialog('poner la voz de Kenney')
    await closeLibraryWithEsc()
    const placed = Object.fromEntries((await items()).map((i) => [i.item.source.assetId, i.start]))
    check('Freesound a los 2 s y Kenney a los 6 s', Math.abs(placed['campanita-recepcion'] - 2000) < 50 && Math.abs(placed['voz-mujer-3'] - 6000) < 50, JSON.stringify(placed))
    await app.click('[data-testid=save-video]')
    await waitScreen('save-view')
    await app.click('[data-testid=preset-whatsapp]')
    await app.waitFor('return !!document.querySelector("[data-testid=done-view]")', { timeoutMs: 180_000, what: 'vídeo con terceros guardado' })
    await noErrorDialog('guardar con terceros')
    const out = await S('return store.lastExport.value.path')
    // Dónde suena algo en el fichero (el sonido de los trozos está silenciado: solo suenan los dos de la biblioteca).
    const errLog = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', out, '-vn', '-af', 'silencedetect=n=-50dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? ''
    const ends = [...errLog.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000))
    const starts = [...errLog.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000))
    const onsets = ends.slice(0, 2)
    check('En el fichero, la campanita (Freesound) empieza a sonar a los 2 s y la voz (Kenney) a los 6 s (±40 ms)', onsets.length === 2 && Math.abs(onsets[0] - placed['campanita-recepcion']) <= 40 && Math.abs(onsets[1] - placed['voz-mujer-3']) <= 40, `suena desde ${onsets.join(' y ')} ms; silencios desde ${starts.join(', ')} ms`)
    const credits = await app.text('[data-testid=done-credits]')
    check('Lo CC0 no pide créditos en «¡Listo!»', !credits, credits ?? '')
    await app.click('[data-testid=back-to-editor]')
    await waitScreen('editor')
  }

  // --- Rendimiento: 5 minutos, 20 trozos, 12 pistas (8 de sonido y 4 de efectos) y 48 elementos
  {
    const res = await S(`
      const d = domain; let p = d.createProject('16:9');
      const m = store.media.value[args.h];
      for (let i = 0; i < 20; i++) { const c = d.createClip(m, 'perf-c' + i); p = d.addClip(p, c); p = d.setInOut(p, 'perf-c' + i, { inMs: 0, outMs: 10000 }); }
      p = { ...p, clips: p.clips.map((c, i) => i < 10 ? { ...c, segments: [{ startMs: 0, endMs: 10000 }], speed: 0.5 } : c) };
      const music = store.media.value[args.music];
      let n = 0;
      const put = (kind, src, info, at, extra) => { const it = d.createItem({ id: 'perf-i' + (n++), kind, source: src, name: 'Prueba ' + n, sourceDurationMs: info.durationMs, still: info.isStill, hasAudio: info.hasAudio, defaults: extra }); const r = d.insertItem(p, it, kind, at, { id: 'perf-t' + n }); if (r.ok) p = r.project; };
      // Ocho sonidos a la vez (cada uno pisa a los anteriores: 8 pistas) cada 50 s, y cuatro efectos a la vez.
      for (let k = 0; k < 4; k++) for (let j = 0; j < 8; j++) put('sound', { type: 'file', path: args.music }, music, k * 50000 + j * 300, {});
      for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) put('effect', { type: 'library', assetId: 'chispas' }, { durationMs: 6000, hasAudio: false }, k * 50000 + 1000 + j * 300, { look: { mix: 'light', opacity: 0.6 } });
      store.commit(p);
      return { clips: p.clips.length, tracks: p.tracks.length, sounds: p.tracks.filter((t) => t.kind === 'sound').length, items: p.tracks.reduce((s, t) => s + t.items.length, 0), duration: d.projectDurationMs(p) }`, { h: media.horizontal, music })
    await sleep(800)
    check('Montaje con muchas pistas', res.clips === 20 && res.tracks === 12 && res.sounds === 8 && res.items === 48 && res.duration >= 300_000, JSON.stringify(res))
    await headersFitAtSizes('12 pistas')
    // La vista previa aguanta: reproducir donde suenan los 8 a la vez y se ven los 4 efectos.
    await app.key('Home')
    await seekTo(50_000)
    await app.key(' ')
    await sleep(3000)
    const play = await app.evaluate(`const p = document.querySelector('[data-testid=player]').dataset; const sync = JSON.parse(document.querySelector('[data-testid=track-layers]').dataset.sync);
      const sounds = [...document.querySelectorAll('[data-testid=track-sound]')].filter((a) => !a.paused).length; const fx = [...document.querySelectorAll('[data-testid=track-effect]')].filter((v) => !v.paused && v.readyState >= 2).length;
      return { ms: Number(p.currentMs), playing: p.playing === '1', sounds, fx, sync: Object.keys(sync).length }`)
    await app.key(' ')
    check('Reproduciendo con 8 sonidos y 4 efectos a la vez: el reloj avanza, suenan y se ven', play.playing && play.ms > 51_500 && play.ms < 54_500 && play.sounds >= 8 && play.fx >= 4, JSON.stringify(play))
    await shot('tracks-21-rendimiento-12-pistas.png')
  }

  // --- Rendimiento: 5 minutos, 20 trozos, 3 pistas y 30 elementos
  {
    const res = await S(`
      const d = domain; let p = d.createProject('16:9');
      const m = store.media.value[args.h];
      for (let i = 0; i < 20; i++) { const c = d.createClip(m, 'perf-c' + i); p = d.addClip(p, c); p = d.setInOut(p, 'perf-c' + i, { inMs: 0, outMs: 10000 }); }
      // 20 × 10 s = 200 s; 10 más de 10 s cortados en dos tramos para llegar a 5 minutos.
      for (let i = 20; i < 20; i++) {}
      p = { ...p, clips: p.clips.map((c, i) => i < 10 ? { ...c, segments: [{ startMs: 0, endMs: 10000 }], speed: 0.5 } : c) };
      const music = store.media.value[args.music];
      let n = 0;
      const put = (kind, src, info, at, extra) => { const it = d.createItem({ id: 'perf-i' + (n++), kind, source: src, name: 'Prueba ' + n, sourceDurationMs: info.durationMs, still: info.isStill, hasAudio: info.hasAudio, defaults: extra }); const r = d.insertItem(p, it, kind, at, { id: 'perf-t' + n }); if (r.ok) p = r.project; };
      // Dos pistas de sonido (los de la segunda pisan a los de la primera) y una de efectos: 30 elementos.
      for (let k = 0; k < 10; k++) put('sound', { type: 'file', path: args.music }, music, k * 29000, {});
      for (let k = 0; k < 10; k++) put('sound', { type: 'file', path: args.music }, music, k * 29000 + 2000, {});
      for (let k = 0; k < 10; k++) put('effect', { type: 'library', assetId: 'chispas' }, { durationMs: 6000, hasAudio: false }, k * 29500 + 3000, { look: { mix: 'light' } });
      store.commit(p);
      return { clips: p.clips.length, tracks: p.tracks.length, items: p.tracks.reduce((s, t) => s + t.items.length, 0), duration: d.projectDurationMs(p) }`, { h: media.horizontal, music })
    await sleep(800)
    check('Montaje de rendimiento', res.clips === 20 && res.tracks === 3 && res.items === 30 && res.duration >= 300_000, JSON.stringify(res))
    await app.key('Home')
    await app.click('[data-testid=zoom-in]')
    await app.click('[data-testid=zoom-in]')
    await sleep(400)
    const first = await app.evaluate('return [...document.querySelectorAll("[data-testid=track-item]")].map((e) => e.dataset.itemId).find((id) => id.startsWith("perf-i0"))')
    const c = await blockCenter(first)
    const t0 = Date.now()
    const steps = 30
    await app.drag({ x: c.x, y: c.y }, { x: c.x + 150, y: c.y }, steps)
    const wall = Date.now() - t0
    const render = await app.evaluate('return Number(document.querySelector("[data-testid=tracks-view]").dataset.dragRenderMs)')
    const perStep = await app.evaluate(`const t0 = performance.now(); for (let i = 0; i < 20; i++) { window.__easyCut.tracks.previewMove(args.id, 2000 + i * 100) } window.__easyCut.store.cancelPreview(); return (performance.now() - t0) / 20`, { id: first })
    check('Arrastrar con 20 trozos, 3+ pistas y 30 elementos va con soltura', render < 40 && perStep < 16, `último paso dibujado en ${render} ms; mover (modelo) ${perStep.toFixed(2)} ms por paso; ${steps} pasos de ratón en ${wall} ms`)
    console.log(`      rendimiento: dibujar un paso del arrastre ${render} ms; recalcular el modelo ${perStep.toFixed(2)} ms`)
    await shot('tracks-10-rendimiento-5-minutos.png')
  }
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? e.stack ?? e.message : String(e))
  try {
    await app?.screenshot(join(opts.shots, 'tracks-zz-fallo.png'))
  } catch {
    // Sin captura.
  }
} finally {
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
