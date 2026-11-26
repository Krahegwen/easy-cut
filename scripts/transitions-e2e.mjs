// Prueba de extremo a extremo de las transiciones entre trozos, en la app Tauri real por CDP y con los botones y las
// teclas de verdad (en el modo de pruebas: sin sonido y sin quitar el foco):
//
// - Poner un fundido con el botón de la junta (el desplegable: siete tipos dibujados, tres duraciones, lo que acorta
//   el vídeo dicho en vivo, «Poner» con su aviso y «Deshacer») y otra transición con U desde el trozo elegido y las
//   teclas del desplegable (5, →, Intro); a negro con el interruptor «Montar sobre el anterior» (M) y Esc, que lo
//   deja como estaba.
// - La geometría de los bloques (el que entra montado sobre el anterior, el paso rayado), el indicador y el nombre
//   accesible; arrastrar el borde del paso con su texto en vivo, y deshacer.
// - «Probar» (de 2 s antes a 2 s después, y se para), reproducir a través del paso midiendo la deriva del que entra
//   (< 150 ms) y los fotogramas perdidos (getVideoPlaybackQuality), a 1×, a 2× y a pantalla completa.
// - Mover un trozo con su entrada, partir dentro del paso (no deja y lo dice), quitar pausas que encoge el paso (el
//   aviso y su «Deshacer»), guardar «Para WhatsApp» y medir con ffprobe la duración y el color a mitad del paso.
// - Cada tecla dibujada es un atajo que vale; capturas trans-*.png a 1280×800 y 1100×700.
//
// PowerShell (con Rust/cargo en el PATH y la app cerrada):
//   node scripts/transitions-e2e.mjs
// Con la app ya abierta a mano: --no-launch. Borra al acabar lo que ha guardado. Sale con 1 si algo falla.

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

// Tres trozos de color liso de 6 s (rojo, azul y verde, cada uno con su tono y una franja blanca que se mueve, para
// que haya imagen que decodificar).
const own = resolve(opts.media, 'transitions-e2e')
mkdirSync(own, { recursive: true })
const COLORS = { Rojo: [200, 50, 50], Azul: [50, 50, 200], Verde: [40, 190, 70] }
const files = {}
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
for (const [name, rgb] of Object.entries(COLORS)) {
  const path = join(own, `Trozo ${name} (e2e).mp4`)
  files[name] = path
  if (existsSync(path)) continue
  const hex = `0x${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  const hz = { Rojo: 330, Azul: 550, Verde: 880 }[name]
  ff(['-f', 'lavfi', '-i', `color=c=${hex}:size=1280x720:rate=30:duration=6`, '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=6`, '-vf', `drawbox=x='mod(t*200,1180)':y=40:w=100:h=40:color=white:t=fill,scale=out_color_matrix=bt709:out_range=tv`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-b:a', '192k', '-shortest', path])
}

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

const S = (expr, args = {}) => app.evaluate(`const store = window.__easyCut.store; const tracks = window.__easyCut.tracks; const domain = window.__easyCut.domain; ${expr}`, args)
const queuePick = (paths) => app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: paths })
const pxPerSec = () => app.evaluate('return Number(document.querySelector("[data-testid=tracks-view]")?.dataset.pxPerSec ?? 0)')
const entries = () => S('return store.project.value.clips.map((c) => c.entry)')
const timeline = () => S('const t = domain.clipTimeline(store.project.value); return { starts: t.starts, overlaps: t.overlaps, total: t.totalMs }')
const picker = () => app.evaluate('const p = document.querySelector("[data-testid=transition-picker]"); return p ? { draft: p.dataset.draft, summary: p.querySelector("[data-testid=transition-summary]").textContent } : null')
const toast = () => app.text('[data-testid=toast]')

/** Lleva la línea a `ms` pulsando en la regla de las pistas (como con el ratón). */
async function seekTo(ms) {
  await app.evaluate(`const s = document.querySelector('[data-testid=tracks-scroller]'); const px = Number(document.querySelector('[data-testid=tracks-view]').dataset.pxPerSec);
    const header = document.querySelector('.corner').getBoundingClientRect().width; const want = args.ms / 1000 * px;
    if (want < s.scrollLeft || want > s.scrollLeft + s.clientWidth - header - 30) s.scrollLeft = Math.max(0, want - 100); return true`, { ms })
  const r = await app.evaluate('const r = document.querySelector("[data-testid=tracks-ruler]").getBoundingClientRect(); return { l: r.left, y: r.top + r.height / 2 }')
  const px = await pxPerSec()
  await app.clickAt(r.l + (ms / 1000) * px, r.y)
  await sleep(450)
}

/** Las teclas dibujadas (dentro de `root`: con el desplegable abierto, que es modal, solo cuentan las suyas). */
async function visibleKeyHintsAreShortcuts(where, root = 'body') {
  const res = await app.evaluate(`const active = window.__easyCut.shortcuts().filter((s) => s.enabled).map((s) => s.label);
    const drawn = [...document.querySelector(args.root).querySelectorAll('[data-key-hint]')].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(k).visibility !== 'hidden' && !k.closest('button:disabled') }).map((k) => k.dataset.key);
    const missing = [...new Set(drawn.filter((d) => !active.includes(d)))];
    return { drawn: [...new Set(drawn)], missing }`, { root })
  check(`Cada tecla dibujada vale (${where})`, res.missing.length === 0, res.missing.length ? `sin atajo: ${res.missing.join(', ')}` : res.drawn.join(' '))
}

function ffprobe(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'format=duration:stream=codec_type,nb_read_frames', '-of', 'json', path], { encoding: 'utf8' }))
}
/** Color medio de un cuadrado de 16 px en (fx, fy) (fracciones del marco) del fotograma número `n`. */
function colorAtFrame(path, n, fx, fy) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vf', `select=eq(n\\,${n}),crop=16:16:iw*${fx}-8:ih*${fy}-8,scale=1:1:flags=area,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-'])
  return [...buf.subarray(0, 3)]
}
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
const mix = (a, b, k) => a.map((v, i) => v * (1 - k) + b[i] * k)

/**
 * Muestreo de la vista previa en cada fotograma (rAF) mientras suena: avance del paso, el que entra (real y esperado)
 * y los fotogramas perdidos de los <video> de los trozos. Se arranca antes de reproducir y se lee después.
 */
async function startSampler() {
  await app.evaluate(`window.__samples = []; const pl = document.querySelector('[data-testid=player]');
    const dropped = () => [...document.querySelectorAll('[data-testid=clip-layer] video')].reduce((s, v) => s + (v.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0), 0);
    window.__droppedStart = dropped();
    const loop = () => { const d = pl.dataset; window.__samples.push({ ms: Number(d.currentMs), p: d.joinProgress, inc: d.incomingMs, exp: d.incomingExpectedMs, playing: d.playing, rate: d.reviewRate, dropped: dropped() - window.__droppedStart });
      if (window.__samples.length < 2000 && (d.playing === '1' || window.__samples.length < 30)) requestAnimationFrame(loop) };
    requestAnimationFrame(loop); return true`)
}
async function readSampler() {
  return app.evaluate('return window.__samples')
}
function driftOf(samples) {
  const inPaso = samples.filter((s) => s.p !== '' && s.inc !== '' && s.exp !== '')
  const drifts = inPaso.map((s) => Math.abs(Number(s.inc) - Number(s.exp)))
  return { n: inPaso.length, max: drifts.length ? Math.max(...drifts) : null, dropped: samples.length ? samples[samples.length - 1].dropped : 0 }
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

  // --- Montaje: rojo, azul y verde (6 s cada uno), sin transiciones.
  await app.click('[data-testid=new-video]')
  await waitScreen('pick-videos')
  await queuePick([files.Rojo, files.Azul, files.Verde])
  await app.click('[data-testid=pick-videos]')
  await waitScreen('editor', 30_000)
  await app.waitFor('return window.__easyCut.store.project.value.clips.length === 3', { timeoutMs: 30_000 })
  await sleep(800)
  {
    const t = await timeline()
    const joins = await app.evaluate('return document.querySelectorAll("[data-testid^=join-btn-]").length')
    const zones = await app.evaluate('return document.querySelectorAll("[data-testid=join-zone]").length')
    check('Sin transiciones: 18 s, dos juntas con su botón y ningún paso', t.total === 18000 && joins === 2 && zones === 0, `${t.total} ms, ${joins} botones, ${zones} pasos`)
  }

  // ============================================================ A. Poner un fundido con el botón de la junta
  {
    await app.click('[data-testid=join-btn-2]')
    await app.waitFor('return !!document.querySelector("[data-testid=transition-picker]")', { timeoutMs: 3000, what: 'desplegable de la transición' })
    const kinds = await app.evaluate('return [...document.querySelectorAll("[data-testid^=transition-kind-]")].map((b) => ({ id: b.dataset.testid.slice(16), svg: !!b.querySelector("svg.t-icon"), t: b.querySelector("strong").textContent, key: b.querySelector("[data-key-hint]")?.dataset.key, on: b.classList.contains("on") }))')
    check('Siete tipos, cada uno con su dibujito, su nombre llano y su tecla (1–7); de serie, corte seco', kinds.length === 7 && kinds.every((k) => k.svg) && kinds.map((k) => k.key).join('') === '1234567' && kinds.find((k) => k.on)?.id === 'cut', kinds.map((k) => `${k.key} ${k.t}`).join(', '))
    const lengths = await app.evaluate('return [...document.querySelectorAll("[data-testid^=transition-len-]")].map((b) => b.textContent.replace(/\\s+/g, " ").trim())')
    check('Tres duraciones que dicen los segundos', lengths.join(' | ') === 'Corta 0,5 s | Media 1 s | Larga 2 s', lengths.join(' | '))
    await visibleKeyHintsAreShortcuts('desplegable de la transición', '[data-testid=transition-picker]')
    await app.click('[data-testid=transition-kind-dissolve]')
    await sleep(250)
    const pk = await picker()
    check('Al elegir «Fundido» dice en vivo cuánto se acorta el vídeo', pk.draft === 'dissolve:1000:1' && /se acorta 1 s \(de 18 s a 17 s\)/.test(pk.summary), pk.summary)
    const zone = await app.evaluate('const z = document.querySelector("[data-testid=join-zone]"); return z ? { from: Number(z.dataset.fromMs), to: Number(z.dataset.toMs) } : null')
    check('Lo elegido ya se ve en las pistas (el paso, rayado) antes de ponerlo', zone?.from === 5000 && zone?.to === 6000, JSON.stringify(zone))
    await shot('trans-01-desplegable.png')
    await app.click('[data-testid=transition-put]')
    await sleep(300)
    const t = await timeline()
    const msg = await toast()
    check('«Poner»: fundido de 1 s, el vídeo dura 17 s y lo dice con «Deshacer»', (await entries())[1]?.kind === 'dissolve' && t.total === 17000 && /Fundido de 1 s del trozo 1 al 2: el vídeo dura ahora 17 s \(1 s menos\)/.test(msg ?? ''), msg ?? '')
    check('El desplegable se cierra', !(await picker()))
  }

  // --- Geometría de los bloques: el que entra, montado sobre el anterior; el paso rayado; indicador y nombre.
  {
    const px = await pxPerSec()
    const g = await app.evaluate(`const host = document.querySelector('[data-testid=video-row]').getBoundingClientRect();
      const b = (n) => document.querySelector('[data-testid=clip-block-' + n + ']').getBoundingClientRect();
      const z = document.querySelector('[data-testid=join-zone]').getBoundingClientRect();
      return { b1: { l: b(1).left - host.left, w: b(1).width }, b2: { l: b(2).left - host.left, w: b(2).width }, b3: { l: b(3).left - host.left }, z: { l: z.left - host.left, w: z.width },
        label: document.querySelector('[data-testid=clip-block-2]').getAttribute('aria-label'), badges: document.querySelector('[data-testid=clip-block-2]').dataset.badges }`)
    const x = (ms) => (ms / 1000) * px
    const ok = Math.abs(g.b2.l - g.b1.l - x(5000)) <= 2 && Math.abs(g.b1.w - x(6000)) <= 2 && Math.abs(g.z.l - g.b2.l) <= 2 && Math.abs(g.z.w - x(1000)) <= 2 && Math.abs(g.b3.l - g.b1.l - x(11000)) <= 2
    check('El trozo 2 empieza montado sobre el 1 (1 s) y el paso rayado cubre justo lo compartido', ok, JSON.stringify(g))
    check('Indicador y nombre accesible del trozo que entra', g.badges.split(' ').includes('entry') && /entra con fundido de 1 s/.test(g.label), `${g.badges} · ${g.label}`)
    await shot('trans-02-pistas.png')
  }

  // ============================================================ B. Con U desde el trozo elegido, y las teclas del desplegable
  {
    await app.click('[data-testid=clip-block-2]')
    await sleep(300)
    const u = await app.evaluate('return document.querySelector("[data-testid=join-btn-3] [data-key-hint]")?.dataset.key ?? null')
    check('La junta que sigue al trozo elegido lleva la U dibujada', u === 'U')
    await visibleKeyHintsAreShortcuts('Tu vídeo, con un trozo elegido')
    await app.key('u')
    await app.waitFor('return !!document.querySelector("[data-testid=transition-picker]")', { timeoutMs: 3000, what: 'desplegable con U' })
    const title = await app.text('[data-testid=transition-picker] h3')
    await app.key('5')
    await app.key('ArrowRight')
    await app.key('ArrowRight')
    const pk = await picker()
    check('U abre «Cómo se pasa al trozo 3»; 5 elige «Empujar» y → alarga hasta «Larga»', title === 'Cómo se pasa al trozo 3' && pk.draft === 'push:2000:1', `${title} · ${pk.draft}`)
    await app.key('Enter')
    await sleep(300)
    const e = await entries()
    check('Intro lo pone (empujar de 2 s)', e[2]?.kind === 'push' && e[2]?.durationMs === 2000 && !(await picker()), JSON.stringify(e[2]))

    // A negro: de serie sin solape; M monta sobre el anterior y dice cuánto acorta; Esc lo deja como estaba.
    await app.key('u')
    await app.waitFor('return !!document.querySelector("[data-testid=transition-picker]")', { timeoutMs: 3000 })
    await app.key('2')
    await sleep(150)
    const off = await picker()
    const label = await app.text('[data-testid=transition-overlap]')
    await app.key('m')
    await sleep(150)
    const on = await picker()
    check('A negro: de serie la duración no cambia; el interruptor (M) dice cuánto acortaría y lo monta', off.draft === 'dip-black:2000:0' && /no cambia/.test(off.summary) && /acorta el vídeo 2 s/.test(label ?? '') && on.draft === 'dip-black:2000:1' && /se acorta 2 s/.test(on.summary), `${off.summary} · ${label} · ${on.summary}`)
    await shot('trans-03-a-negro.png')
    await app.key('Escape')
    await sleep(200)
    check('Esc lo deja como estaba (empujar de 2 s)', (await entries())[2]?.kind === 'push' && !(await picker()) && (await timeline()).total === 15000)
  }

  // ============================================================ C. Arrastrar el borde del paso
  {
    const px = await pxPerSec()
    const edge = await app.center('[data-testid=join-edge-2]')
    const from = { x: edge.x, y: edge.y }
    const to = { x: edge.x - (500 / 1000) * px, y: edge.y }
    await app.evaluate('return true')
    // Arrastre a mano para leer el texto en vivo antes de soltar.
    await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 })
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 10; i++) {
      await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * i) / 10, y: from.y, button: 'left', buttons: 1 })
      await sleep(20)
    }
    const live = await app.text('[data-testid=join-live]')
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(300)
    const e = (await entries())[1]
    check('Tirar del borde del paso a la izquierda monta más, con su texto en vivo', e?.durationMs === 1500 && /^Paso al trozo 2: 1 s → 1,5 s · Vídeo: /.test(live ?? ''), `${live} · ${JSON.stringify(e)}`)
    await app.key('z', { ctrl: true })
    await sleep(200)
    check('Un paso de deshacer lo deja en 1 s', (await entries())[1]?.durationMs === 1000)
  }

  // ============================================================ D. «Probar» y reproducir a través del paso
  {
    await app.click('[data-testid=join-btn-2]')
    await app.waitFor('return !!document.querySelector("[data-testid=transition-picker]")', { timeoutMs: 3000 })
    await startSampler()
    await app.click('[data-testid=transition-try]')
    await sleep(500)
    await app.waitFor('return document.querySelector("[data-testid=player]").dataset.playing === "0"', { timeoutMs: 15_000, what: 'que «Probar» acabe' })
    const s = await readSampler()
    const first = s.find((x) => x.playing === '1')
    const last = s[s.length - 1]
    const d = driftOf(s)
    check('«Probar» reproduce de 2 s antes a 2 s después del paso y se para', !!first && Math.abs(first.ms - 3000) < 300 && Math.abs(last.ms - 8000) < 200 && d.n > 10, `de ${first?.ms} a ${last.ms}, ${d.n} muestras en el paso`)
    await app.key('Escape')
    await sleep(200)
    check('Esc cierra el desplegable', !(await picker()))
  }

  const playThrough = async (label) => {
    await seekTo(3500)
    await startSampler()
    await app.key(' ')
    await sleep(500)
    await app.waitFor('return Number(document.querySelector("[data-testid=player]").dataset.currentMs) > 7000', { timeoutMs: 15_000, what: 'pasar el paso' })
    await app.key(' ')
    await sleep(200)
    const s = await readSampler()
    const d = driftOf(s)
    const progress = s.filter((x) => x.p !== '').map((x) => Number(x.p))
    check(`Reproduciendo a través del paso (${label}): el que entra va a menos de 150 ms del reloj; fotogramas perdidos`, d.n > 5 && d.max !== null && d.max < 150 && Math.min(...progress) < 0.2 && Math.max(...progress) > 0.8 && d.dropped <= 6, `deriva máx. ${d.max} ms en ${d.n} muestras, perdidos ${d.dropped}`)
    return d
  }
  const measures = {}
  measures['1×'] = await playThrough('1×')
  await app.click('[data-testid=review-rate-2]')
  measures['2×'] = await playThrough('2×')
  await app.click('[data-testid=review-rate-1]')
  {
    await app.click('[data-testid=fullscreen-enter]')
    await sleep(400)
    // A pantalla completa, la línea se lleva con Inicio y →.
    await app.key('Home')
    for (let i = 0; i < 3; i++) await app.key('ArrowRight')
    await sleep(300)
    await startSampler()
    await app.key(' ')
    await sleep(500)
    await app.waitFor('return Number(document.querySelector("[data-testid=player]").dataset.currentMs) > 7000', { timeoutMs: 15_000, what: 'pasar el paso a pantalla completa' })
    await app.key(' ')
    await sleep(200)
    const d = driftOf(await readSampler())
    measures['pantalla completa'] = d
    check('A pantalla completa, igual: el que entra a menos de 150 ms', d.n > 5 && d.max !== null && d.max < 150 && d.dropped <= 6, `deriva máx. ${d.max} ms en ${d.n} muestras, perdidos ${d.dropped}`)
    await app.key('Escape')
    await sleep(300)
  }
  console.log(`      deriva y fotogramas perdidos: ${JSON.stringify(measures)}`)

  // Vista previa parada a mitad del empuje (trozo 2 → 3): las dos capas desplazadas.
  {
    const t = await timeline()
    await seekTo(t.starts[2] + 1000)
    await sleep(500)
    const layers = await app.evaluate('return [...document.querySelectorAll("[data-testid=clip-layer]")].map((l) => ({ role: l.dataset.layerRole, tr: l.style.transform }))')
    const p = await app.evaluate('return document.querySelector("[data-testid=player]").dataset.joinProgress')
    check('En pausa a mitad del empuje: el que sale y el que entra, medio ancho a cada lado', Math.abs(Number(p) - 0.5) < 0.05 && layers.some((l) => l.role === 'out' && /translateX\(-/.test(l.tr)) && layers.some((l) => l.role === 'in' && /translateX\(\d/.test(l.tr)), `${p} ${JSON.stringify(layers)}`)
    await shot('trans-04-empujar-vista-previa.png')
  }

  // ============================================================ E. Mover, partir, quitar pausas
  {
    await app.click('[data-testid=clip-block-2]')
    await sleep(250)
    await app.click('[data-testid=move-after]')
    await sleep(300)
    const order = await S('return store.project.value.clips.map((c) => ({ path: c.sourcePath.split("\\\\").pop(), entry: c.entry && c.entry.kind }))')
    check('Al mover el trozo azul detrás del verde, se lleva su entrada (fundido) y el verde la suya (empujar)', order.map((o) => `${o.path.includes('Rojo') ? 'R' : o.path.includes('Azul') ? 'A' : 'V'}:${o.entry}`).join(' ') === 'R:null V:push A:dissolve', JSON.stringify(order))
    await app.key('z', { ctrl: true })
    await sleep(200)
    check('Deshacer lo deja como estaba', (await S('return store.project.value.clips.map((c) => c.entry && c.entry.kind).join(",")')) === ',dissolve,push')
  }
  {
    // Partir dentro del paso: no se puede y se dice.
    await app.click('[data-testid=clip-block-2]')
    await sleep(250)
    await seekTo(5400)
    await app.key('p')
    await sleep(250)
    const n = await S('return store.project.value.clips.length')
    const msg = await toast()
    check('P dentro del paso no parte y lo dice en llano', n === 3 && (msg ?? '').startsWith('Aquí no se puede partir: es el paso de un trozo a otro.'), msg ?? '')
  }
  {
    // Quitar pausas en el azul de modo que su primer rango dura 0,6 s: el paso encoge y se avisa con «Deshacer».
    await S('const b = store.project.value.clips[1].id; store.apply((p) => domain.applyKeepSegments(p, b, [{ startMs: 0, endMs: 600 }, { startMs: 1200, endMs: 6000 }])); return true')
    await sleep(250)
    const msg = await toast()
    const ov = (await timeline()).overlaps[1]
    check('Quitar pausas que encoge el paso lo dice', ov === 600 && (msg ?? '').startsWith('El paso al trozo 2 ahora dura 0,6 s (antes 1 s): no cabe más.'), `${ov} · ${msg}`)
    await app.click('[data-testid=toast-action]')
    await sleep(250)
    check('Su «Deshacer» lo deja como estaba', (await timeline()).overlaps[1] === 1000)
  }

  // ============================================================ F. A 1100 × 700: el desplegable cabe
  {
    await app.setViewport(1100, 700)
    await sleep(400)
    await app.click('[data-testid=join-btn-2]')
    await app.waitFor('return !!document.querySelector("[data-testid=transition-picker]")', { timeoutMs: 3000 })
    const r = await app.evaluate('const r = document.querySelector("[data-testid=transition-picker]").getBoundingClientRect(); const put = document.querySelector("[data-testid=transition-put]").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, putB: put.bottom, w: innerWidth, h: innerHeight }')
    check('A 1100 × 700 el desplegable cabe entero en la ventana', r.l >= 0 && r.t >= 0 && r.r <= r.w && r.b <= r.h && r.putB <= r.h, JSON.stringify(r))
    await visibleKeyHintsAreShortcuts('desplegable a 1100 × 700', '[data-testid=transition-picker]')
    await shot('trans-05-desplegable-1100.png')
    await app.key('Escape')
    await sleep(200)
    await shot('trans-06-pistas-1100.png')
    await app.setViewport(1280, 800)
    await sleep(300)
  }

  // ============================================================ G. Guardar «Para WhatsApp» y medir
  {
    await app.click('[data-testid=save-video]')
    await waitScreen('save-view')
    await app.click('[data-testid=preset-whatsapp]')
    await app.waitFor('return !!document.querySelector("[data-testid=done-view]")', { timeoutMs: 180_000, what: 'vídeo guardado' })
    await noErrorDialog('guardar con transiciones')
    const out = await S('return store.lastExport.value.path')
    const expected = await S('return domain.exportedProjectDurationMs(store.project.value, 30)')
    const probe = ffprobe(out)
    const v = probe.streams.find((s) => s.codec_type === 'video')
    const durMs = Number(probe.format.duration) * 1000
    check('El fichero dura lo que dice el modelo y tiene los fotogramas exactos', Math.abs(durMs - expected) <= 50 && Number(v.nb_read_frames) === Math.round((expected * 30) / 1000), `${Math.round(durMs)} ms / ${expected} ms, ${v.nb_read_frames} fotogramas`)
    // A mitad del fundido (fotograma 150 + 15), la media del rojo y el azul; a mitad del empujar, uno a cada lado.
    const mid = colorAtFrame(out, 165, 0.5, 0.6)
    const want = mix(COLORS.Rojo, COLORS.Azul, 0.5)
    const pushStart = Math.round(((await timeline()).starts[2] * 30) / 1000)
    const left = colorAtFrame(out, pushStart + 30, 0.25, 0.6)
    const right = colorAtFrame(out, pushStart + 30, 0.75, 0.6)
    check('En el fichero: la media a mitad del fundido y el empujar con un color a cada lado', near(mid, want, 10) && near(left, COLORS.Azul, 10) && near(right, COLORS.Verde, 10), `${mid} / ${want.map(Math.round)} · ${left} · ${right}`)
    await shot('trans-07-listo.png')
    await app.click('[data-testid=back-to-editor]')
    await waitScreen('editor')
  }
} catch (err) {
  check('La prueba llega al final sin errores', false, err instanceof Error ? err.stack ?? err.message : String(err))
  try {
    await app?.screenshot(join(opts.shots, 'trans-zz-fallo.png'))
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
