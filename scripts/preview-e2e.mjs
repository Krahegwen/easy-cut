// Prueba de extremo a extremo de la vista previa de «Tu vídeo», en la app Tauri real por CDP y con los botones y
// las teclas de verdad (en el modo de pruebas: sin sonido y sin quitar el foco):
//
// - Pantalla completa: entrar con el botón y con F; se ve lo mismo (los mismos sonidos y efectos montados, el
//   mismo encuadre relativo del vídeo de encima y de los efectos, la misma forma del marco); los controles
//   (reproducir/pausa, posición, salir) se ven y se pulsan; Espacio, ← →, Inicio/Fin valen dentro; Esc y F salen
//   sin parar la reproducción ni irse a Inicio; F1 sale para enseñar la lista de teclas; cada tecla dibujada
//   dentro es un atajo que vale.
// - «Repasar más rápido» a 1,5× y 2×: el reloj del montaje avanza a ese ritmo (±5 %), el <video> del trozo va
//   a su velocidad por la de repaso (un trozo a 2× repasado a 2× va a 4×), el vídeo de encima y los sonidos y
//   efectos de las pistas van al mismo factor y siguen sincronizados (data-sync, data-cover-ms /
//   data-cover-expected-ms), el aviso «Repasando a 2× · el vídeo guardado no cambia» se ve, el proyecto no
//   cambia (ni la velocidad de los trozos ni el historial), y al ir a Guardar y volver está otra vez a 1×.
//
// Capturas preview-*.png en test-output/screenshots/.
//
// PowerShell (con Rust/cargo en el PATH, la app cerrada y los ficheros de `pnpm test:ffmpeg` en test-output):
//   node scripts/preview-e2e.mjs
// Con la app ya abierta a mano: --no-launch. No guarda ningún vídeo. Sale con 1 si algo falla.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
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
  coverLong: resolve(opts.media, 'src-cover-long-25fps.mp4'),
}
for (const p of Object.values(media)) if (!existsSync(p)) throw new Error(`Falta ${p}: ejecuta pnpm test:ffmpeg`)

// Ficheros «del ordenador» para las pistas: un sonido y un vídeo como efecto, de 8 s.
const own = resolve(opts.media, 'preview-e2e')
mkdirSync(own, { recursive: true })
const music = join(own, 'Música de repaso.m4a')
const effect = join(own, 'Efecto de repaso.mp4')
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
if (!existsSync(music)) ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:a', 'aac', '-b:a', '128k', music])
if (!existsSync(effect)) ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', effect])

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

const playerData = () =>
  app.evaluate(`const p = document.querySelector("[data-testid=player]"); const d = p.dataset;
    return { ms: Number(d.currentMs), dur: Number(d.durationMs), clip: Number(d.clipIndex), playing: d.playing === "1", picture: d.picture,
      fullscreen: d.fullscreen === "1", rate: Number(d.reviewRate),
      cover: d.coverMs === '' ? null : Number(d.coverMs), expected: d.coverExpectedMs === '' ? null : Number(d.coverExpectedMs) }`)

const screen = () => S('return store.screen.value')

/** Lleva la vista previa a `ms` (parada) y espera a que se coloque. */
async function seekPaused(ms) {
  if ((await playerData()).playing) await app.key(' ')
  // Pulsando en la barra de posición, como lo haría alguien con el ratón.
  const bar = await app.center('[data-testid=position-bar] .track')
  const dur = (await playerData()).dur
  const left = bar.x - bar.w / 2
  await app.clickAt(left + (bar.w * ms) / dur, bar.y)
  await sleep(600)
}

/** Lo que se ve en la vista previa, relativo al marco: forma, vídeo de encima, efectos y sonidos montados. */
const layoutSnapshot = () =>
  app.evaluate(`const frame = document.querySelector('[data-testid=preview-frame]'); const f = frame.getBoundingClientRect();
    const rel = (el) => { const r = el.getBoundingClientRect(); return { x: (r.left - f.left) / f.width, y: (r.top - f.top) / f.height, w: r.width / f.width, h: r.height / f.height } };
    const cover = [...frame.querySelectorAll('[data-testid=cover-video]')].find((v) => !v.classList.contains('hidden') && getComputedStyle(v).display !== 'none');
    const effects = [...frame.querySelectorAll('[data-testid=track-effect]')].map((e) => ({ id: e.dataset.itemId, visible: getComputedStyle(e).visibility === 'visible', ...rel(e) }));
    const sounds = [...frame.querySelectorAll('[data-testid=track-sound]')].map((a) => a.dataset.itemId);
    return { frameW: f.width, frameH: f.height, aspect: f.width / f.height, cover: cover ? rel(cover) : null,
      effects, sounds, mounted: [...frame.querySelectorAll('[data-testid=track-layers] [data-item-id]')].map((e) => e.dataset.itemId).sort() }`)

function sameRect(a, b, tol = 0.015) {
  if (!a || !b) return a === b
  return ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= tol)
}

/** Cada tecla dibujada dentro del reproductor es un atajo que vale ahora. */
async function playerKeyHintsAreShortcuts(where) {
  const res = await app.evaluate(`const active = window.__easyCut.shortcuts().filter((s) => s.enabled).map((s) => s.label);
    const drawn = [...document.querySelectorAll('[data-testid=player] [data-key-hint]')].filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(k).visibility !== 'hidden' && !k.closest('button:disabled') }).map((k) => k.dataset.key);
    const missing = [...new Set(drawn.filter((d) => !active.includes(d)))];
    return { drawn: [...new Set(drawn)], missing }`)
  check(`Cada tecla dibujada en el reproductor vale (${where})`, res.missing.length === 0 && res.drawn.length > 0, res.missing.length ? `sin atajo: ${res.missing.join(', ')}` : res.drawn.join(' '))
}

/** ¿Se ve y se puede pulsar? (dentro de la ventana y no tapado por otra cosa). */
const reachable = (selector) =>
  app.evaluate(`const el = document.querySelector(args.s); if (!el) return false; const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (hit === el || el.contains(hit))`, { s: selector })

/**
 * Reproduce `wallMs` desde donde esté y mide en la página (sin la latencia de CDP) cuánto avanza el reloj del
 * montaje por cada ms de reloj de pared, y muestrea la sincronía de lo de encima y de las pistas.
 */
const measurePlayback = (wallMs, warmupMs = 500) =>
  app.evaluate(`const p = document.querySelector('[data-testid=player]');
    const read = () => ({ t: performance.now(), ms: Number(p.dataset.currentMs), clip: Number(p.dataset.clipIndex), playing: p.dataset.playing === '1' });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(args.warmup);
    const a = read();
    const samples = [];
    while (performance.now() - a.t < args.wall) {
      await sleep(120);
      const d = p.dataset;
      const layers = document.querySelector('[data-testid=track-layers]');
      const main = [...p.querySelectorAll('video.video:not(.cover)')].find((v) => !v.paused);
      const cover = [...p.querySelectorAll('[data-testid=cover-video]')].find((v) => !v.paused);
      samples.push({ ms: Number(d.currentMs), clip: Number(d.clipIndex),
        cover: d.coverMs === '' ? null : Number(d.coverMs), expected: d.coverExpectedMs === '' ? null : Number(d.coverExpectedMs),
        sync: layers ? JSON.parse(layers.dataset.sync || '{}') : {},
        mainRate: main ? main.playbackRate : null, coverRate: cover ? cover.playbackRate : null,
        itemRates: [...(layers?.querySelectorAll('audio, video') ?? [])].filter((e) => !e.paused).map((e) => ({ id: e.dataset.itemId ?? 'probar', rate: e.playbackRate })) });
    }
    const b = read();
    return { a, b, ratio: (b.ms - a.ms) / (b.t - a.t), samples }`, { wall: wallMs, warmup: warmupMs })

/** Deriva de lo de encima (solo con su vídeo moviéndose) y de cada elemento activo de las pistas. */
function drifts(samples) {
  const cover = []
  const items = {}
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]
    const prev = samples[i - 1]
    if (s.cover !== null && s.expected !== null && s.clip === prev.clip && prev.expected !== null && s.expected - prev.expected >= 60) cover.push(Math.abs(s.cover - s.expected))
    for (const [id, r] of Object.entries(s.sync)) {
      const before = prev.sync[id]
      // Solo lo que suena o se ve y ya avanzaba (no recién empezado ni recién recolocado).
      if (!r.active || r.actual === null || !before?.active || r.expected - before.expected < 60) continue
      ;(items[id] ??= []).push(Math.abs(r.actual - r.expected))
    }
  }
  const stats = (list) => {
    const sorted = [...list].sort((x, y) => x - y)
    return { n: sorted.length, median: sorted[Math.floor(sorted.length / 2)] ?? -1, max: sorted[sorted.length - 1] ?? -1 }
  }
  return { cover: stats(cover), items: Object.fromEntries(Object.entries(items).map(([id, l]) => [id, stats(l)])) }
}

const syncOk = (st) => st.n >= 3 && st.median <= 120 && st.max <= 300

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

  // --- Montaje: trozo 1 con otro vídeo encima (10 s), trozo 2 a 2× (12 s → 6 s), trozo 3 normal (10 s);
  // un sonido y un efecto «de mi ordenador» sobre el trozo 1 y otro sonido sobre los trozos 2 y 3.
  await app.click('[data-testid=new-video]')
  await waitScreen('pick-videos')
  await queuePick([media.horizontal, media.silence, media.horizontal])
  await app.click('[data-testid=pick-videos]')
  await waitScreen('editor', 30_000)
  await app.waitFor('return !document.querySelector("[data-testid=preparing]") && window.__easyCut.store.project.value.clips.length === 3', { timeoutMs: 30_000 })
  const setup = await S(
    `const info = await window.__easyCut.bridge.probe(args.cover);
     store.setMedia(info);
     let p = store.project.value;
     const [c0, c1] = p.clips;
     p = domain.setCover(p, c0.id, info, 0);
     p = domain.setSpeed(p, c1.id, 2);
     store.commit(p);
     return { speeds: store.project.value.clips.map((c) => c.speed), pictures: store.project.value.clips.map((c) => c.picture.kind), coverMs: info.durationMs }`,
    { cover: media.coverLong },
  )
  check('Montaje: el trozo 1 con vídeo encima y el trozo 2 a 2×', JSON.stringify(setup.speeds) === '[1,2,1]' && setup.pictures[0] === 'cover', JSON.stringify(setup))
  const placed = await S(
    `const a = await tracks.addFiles([args.music], 1000);
     const b = await tracks.addFiles([args.effect], 2000);
     const c = await tracks.addFiles([args.music], 10500);
     tracks.select(null);
     const list = domain.resolveTracks(store.project.value).map((r) => ({ id: r.item.id, kind: r.track.kind, start: r.startMs, end: r.shownEndMs }));
     return { added: a + b + c, list }`,
    { music, effect },
  )
  await noErrorDialog('poner en las pistas')
  const sound1 = placed.list.find((i) => i.kind === 'sound' && Math.abs(i.start - 1000) < 50)
  const fx = placed.list.find((i) => i.kind === 'effect')
  const sound2 = placed.list.find((i) => i.kind === 'sound' && Math.abs(i.start - 10_500) < 50)
  check('Pistas: un sonido a 1 s, un efecto a 2 s y otro sonido a 10,5 s', placed.added === 3 && !!sound1 && !!fx && !!sound2, JSON.stringify(placed.list))
  // Que el aviso de «Puesto en las pistas» no estorbe.
  await S('store.hideToast(); return true')

  // ================================================================ pantalla completa

  await seekPaused(4000)
  const before = await layoutSnapshot()
  check(
    'Parado a los 4 s: se ven el vídeo de encima, el efecto y el sonido montados',
    !!before.cover && before.mounted.includes(fx.id) && before.mounted.includes(sound1.id) && before.effects.some((e) => e.id === fx.id && e.visible),
    JSON.stringify(before),
  )
  check('El botón de pantalla completa está y se puede pulsar', await reachable('[data-testid=fullscreen-enter]'))
  await playerKeyHintsAreShortcuts('normal')
  await shot('preview-01-normal.png')

  // Entrar con el botón.
  await app.click('[data-testid=fullscreen-enter]')
  const entered = await app
    .waitFor('const p = document.querySelector("[data-testid=player]"); return document.fullscreenElement === p && p.dataset.fullscreen === "1"', { timeoutMs: 5000, what: 'pantalla completa' })
    .catch(() => false)
  check('El botón pone la vista previa a pantalla completa (Fullscreen API sobre el reproductor)', entered === true, await app.evaluate('return String(document.fullscreenElement?.dataset?.testid ?? null)'))
  await sleep(700)
  {
    const full = await layoutSnapshot()
    const view = await app.evaluate('const r = document.querySelector("[data-testid=player]").getBoundingClientRect(); return { w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }')
    check('Ocupa toda la ventana', Math.abs(view.w - view.iw) <= 2 && Math.abs(view.h - view.ih) <= 2, JSON.stringify(view))
    check('El marco es más grande y con la misma forma', full.frameW > before.frameW && Math.abs(full.aspect - before.aspect) < 0.01, `${Math.round(before.frameW)}×${Math.round(before.frameH)} → ${Math.round(full.frameW)}×${Math.round(full.frameH)}`)
    check('Los mismos sonidos y efectos montados', JSON.stringify(full.mounted) === JSON.stringify(before.mounted), `${before.mounted.join(',')} / ${full.mounted.join(',')}`)
    check('El vídeo de encima con el mismo encuadre relativo', sameRect(full.cover, before.cover), JSON.stringify({ antes: before.cover, ahora: full.cover }))
    const fxBefore = before.effects.find((e) => e.id === fx.id)
    const fxFull = full.effects.find((e) => e.id === fx.id)
    check('El efecto en el mismo sitio y tamaño relativos, y visible', !!fxFull?.visible && sameRect(fxFull, fxBefore), JSON.stringify({ antes: fxBefore, ahora: fxFull }))
    check('Sigue en el mismo instante', Math.abs((await playerData()).ms - 4000) < 300, String((await playerData()).ms))
    for (const [sel, what] of [
      ['[data-testid=play-toggle]', 'Reproducir/pausa'],
      ['[data-testid=position-bar]', 'la barra de posición'],
      ['[data-testid=fullscreen-exit]', '«Salir»'],
      ['[data-testid=review-rate]', '«Repasar más rápido»'],
    ]) {
      check(`A pantalla completa se ve y se puede pulsar ${what}`, await reachable(sel))
    }
    await playerKeyHintsAreShortcuts('pantalla completa')
    const layer = await app.evaluate('return window.__easyCut.shortcuts().filter((s) => s.enabled).map((s) => s.layer)')
    check('Solo valen las teclas de la pantalla completa (y nada de la pantalla de debajo)', layer.includes('preview-fullscreen') && !layer.includes('editor'), [...new Set(layer)].join(', '))
    await shot('preview-02-pantalla-completa.png')
  }

  // Los controles y las teclas dentro.
  await app.click('[data-testid=play-toggle]')
  await sleep(900)
  const playingFull = await playerData()
  check('Dentro, «Reproducir» reproduce', playingFull.playing && playingFull.ms > 4300, String(playingFull.ms))
  await app.key(' ')
  await sleep(250)
  const pausedFull = await playerData()
  check('Espacio para', !pausedFull.playing && pausedFull.fullscreen)
  await app.key('ArrowRight')
  await sleep(350)
  check('→ avanza 1 s', Math.abs((await playerData()).ms - (pausedFull.ms + 1000)) < 120, `${pausedFull.ms} → ${(await playerData()).ms}`)
  await app.key('ArrowLeft')
  await app.key('ArrowLeft')
  await sleep(350)
  check('← retrocede 1 s', Math.abs((await playerData()).ms - (pausedFull.ms - 1000)) < 120, `${pausedFull.ms} → ${(await playerData()).ms}`)
  await app.key('End')
  await sleep(350)
  check('Fin va al final', Math.abs((await playerData()).ms - (await playerData()).dur) < 120)
  await app.key('Home')
  await sleep(350)
  check('Inicio va al principio', (await playerData()).ms < 120)
  {
    // La barra de posición, pulsándola (no hace falta arrastrar).
    const bar = await app.center('[data-testid=position-bar] .track')
    const dur = (await playerData()).dur
    await app.clickAt(bar.x - bar.w / 2 + bar.w * (4000 / dur), bar.y)
    await sleep(500)
    check('Pulsar en la barra de posición salta ahí', Math.abs((await playerData()).ms - 4000) < 250, String((await playerData()).ms))
  }

  // Esc sale sin parar ni irse a Inicio (reproduciendo).
  await app.key(' ')
  await sleep(600)
  await app.key('Escape')
  await app.waitFor('return document.querySelector("[data-testid=player]").dataset.fullscreen === "0" && !document.fullscreenElement', { timeoutMs: 5000, what: 'salir con Esc' }).catch(() => false)
  await sleep(500)
  {
    const d = await playerData()
    check('Esc sale de la pantalla completa', !d.fullscreen)
    check('Sin parar la reproducción ni volver al principio', d.playing && d.ms > 4300, JSON.stringify({ playing: d.playing, ms: d.ms }))
    check('Y sin irse a Inicio', (await screen()) === 'editor')
    const after = await layoutSnapshot()
    check('Al volver, el marco vuelve a su tamaño', Math.abs(after.frameW - before.frameW) < 3, `${Math.round(after.frameW)} / ${Math.round(before.frameW)}`)
  }
  await app.key(' ')
  await sleep(300)

  // Con F entra y con F sale.
  await app.key('f')
  const fIn = await app.waitFor('return document.querySelector("[data-testid=player]").dataset.fullscreen === "1"', { timeoutMs: 5000, what: 'entrar con F' }).catch(() => false)
  check('F pone la pantalla completa', fIn === true)
  await sleep(400)
  await app.key('f')
  const fOut = await app.waitFor('return document.querySelector("[data-testid=player]").dataset.fullscreen === "0"', { timeoutMs: 5000, what: 'salir con F' }).catch(() => false)
  check('Y F la quita', fOut === true && (await screen()) === 'editor')
  await sleep(500)

  // El botón «Salir».
  await app.key('f')
  await app.waitFor('return document.querySelector("[data-testid=player]").dataset.fullscreen === "1"', { timeoutMs: 5000 }).catch(() => false)
  await sleep(400)
  await app.click('[data-testid=fullscreen-exit]')
  check('«Salir» la quita', (await app.waitFor('return document.querySelector("[data-testid=player]").dataset.fullscreen === "0"', { timeoutMs: 5000 }).catch(() => false)) === true)
  await sleep(500)

  // F1 dentro: sale para que se vea la lista de teclas.
  await app.key('f')
  await app.waitFor('return document.querySelector("[data-testid=player]").dataset.fullscreen === "1"', { timeoutMs: 5000 }).catch(() => false)
  await sleep(400)
  await app.key('F1')
  const keysShown = await app.waitFor('return !!document.querySelector("[data-testid=keys-panel]") && document.querySelector("[data-testid=player]").dataset.fullscreen === "0"', { timeoutMs: 5000, what: 'F1 a pantalla completa' }).catch(() => false)
  check('F1 a pantalla completa sale de ella y enseña la lista de teclas', keysShown === true)
  await shot('preview-03-f1.png')
  await app.key('Escape')
  await sleep(500)
  check('Esc cierra la lista y se sigue en «Tu vídeo»', !(await app.evaluate('return !!document.querySelector("[data-testid=keys-panel]")')) && (await screen()) === 'editor')

  // En «Tamaño y sitio» la F es del efecto: el botón no dibuja la F (y la tecla no pone la pantalla completa).
  {
    // El efecto, más pequeño y fuera del centro, para que se note lo que hace F.
    await S('tracks.select(args.id); tracks.setLook(args.id, { box: { x: 0.3, y: 0.3, scale: 0.5 } }); tracks.boxEditing.value = true; return true', { id: fx.id })
    await sleep(300)
    const hint = await app.evaluate('return !!document.querySelector("[data-testid=fullscreen-enter] [data-key-hint]")')
    check('En «Tamaño y sitio» el botón de pantalla completa no dibuja la F', !hint)
    await app.key('f')
    await sleep(400)
    const box = await S('return domain.resolveTracks(store.project.value).find((r) => r.item.id === args.id)?.item.look.box', { id: fx.id })
    check('Y F hace lo suyo (el efecto a pantalla completa), no la vista previa', (await playerData()).fullscreen === false && box?.scale === 1 && box?.x === 0.5, JSON.stringify(box))
    await app.key('Escape')
    await S('tracks.select(null); store.hideToast(); return true')
    await sleep(300)
  }

  // ================================================================ repasar más rápido

  const pastBefore = await S('return store.history.value.past.length')
  const reviewText = await app.evaluate('return document.querySelector("[data-testid=review-rate]")?.textContent.replace(/\\s+/g, " ").trim() ?? null')
  check('«Repasar más rápido» se llama así y ofrece 1×, 1,5× y 2×', reviewText === 'Repasar más rápido 1× 1,5× 2×', reviewText ?? '(no está)')
  check('A 1280×800 el nombre «Repasar más rápido» se ve', await reachable('[data-testid=review-rate] .review-label'))
  check('A 1× no hay aviso', !(await app.evaluate('return !!document.querySelector("[data-testid=review-notice]")')))

  for (const rate of [1.5, 2]) {
    await seekPaused(2500)
    await app.click(`[data-testid="review-rate-${rate}"]`)
    await sleep(200)
    const label = rate === 1.5 ? '1,5×' : '2×'
    const notice = await app.text('[data-testid=review-notice]')
    check(`A ${label}: el aviso se ve`, notice === `Repasando a ${label} · el vídeo guardado no cambia` && (await reachable('[data-testid=review-notice]')), notice ?? '(ninguno)')
    check(`A ${label}: el botón queda marcado`, (await app.evaluate(`return document.querySelector('[data-testid="review-rate-${rate}"]').getAttribute('aria-pressed')`)) === 'true' && (await playerData()).rate === rate)
    // Trozo 1 (normal, con vídeo encima, el sonido y el efecto): de 2,5 s a unos 7 s del montaje.
    await app.key(' ')
    const m = await measurePlayback(rate === 2 ? 2000 : 2500)
    await app.key(' ')
    const d = drifts(m.samples)
    const inClip0 = m.samples.filter((s) => s.clip === 0)
    check(`A ${label}: el reloj del montaje avanza a ${label} (±5 %)`, Math.abs(m.ratio - rate) <= rate * 0.05 && m.b.clip === 0, `${m.ratio.toFixed(3)} (${m.a.ms} → ${m.b.ms} ms en ${Math.round(m.b.t - m.a.t)} ms)`)
    check(`A ${label}: el trozo normal suena a ${label} y el vídeo de encima también`, inClip0.length > 0 && inClip0.every((s) => s.mainRate === rate && (s.coverRate === null || s.coverRate === rate)), JSON.stringify(inClip0.slice(0, 2).map((s) => [s.mainRate, s.coverRate])))
    check(`A ${label}: el vídeo de encima va sincronizado (mediana ≤ 120 ms, máximo ≤ 300 ms)`, syncOk(d.cover), JSON.stringify(d.cover))
    const itemRates = m.samples.flatMap((s) => s.itemRates).filter((r) => r.id !== 'probar')
    check(`A ${label}: los sonidos y efectos de las pistas van al mismo factor`, itemRates.length > 0 && itemRates.every((r) => r.rate === rate), JSON.stringify([...new Set(itemRates.map((r) => `${r.id}:${r.rate}`))]))
    check(`A ${label}: el sonido va sincronizado (data-sync)`, !!d.items[sound1.id] && syncOk(d.items[sound1.id]), JSON.stringify(d.items[sound1.id] ?? null))
    check(`A ${label}: el efecto va sincronizado (data-sync)`, !!d.items[fx.id] && syncOk(d.items[fx.id]), JSON.stringify(d.items[fx.id] ?? null))
    if (rate === 2) await shot('preview-04-repasar-2x.png')

    // Trozo 2 (a 2×) con el segundo sonido: el <video> va a 2 × el factor; el reloj, al factor.
    await seekPaused(11_000)
    await app.key(' ')
    const m2 = await measurePlayback(rate === 2 ? 1400 : 1800, 400)
    await app.key(' ')
    const d2 = drifts(m2.samples)
    const inClip1 = m2.samples.filter((s) => s.clip === 1)
    check(`A ${label}, en el trozo a 2×: el reloj avanza a ${label} (±5 %)`, Math.abs(m2.ratio - rate) <= rate * 0.05 && m2.b.clip === 1, `${m2.ratio.toFixed(3)} (${m2.a.ms} → ${m2.b.ms} ms)`)
    check(`A ${label}, en el trozo a 2×: su vídeo va a ${2 * rate}×`, inClip1.length > 0 && inClip1.every((s) => s.mainRate === 2 * rate), JSON.stringify([...new Set(inClip1.map((s) => s.mainRate))]))
    check(`A ${label}, en el trozo a 2×: el sonido de la pista va a ${label} y sincronizado`, !!d2.items[sound2.id] && syncOk(d2.items[sound2.id]) && m2.samples.flatMap((s) => s.itemRates).filter((r) => r.id === sound2.id).every((r) => r.rate === rate), JSON.stringify(d2.items[sound2.id] ?? null))
  }

  // A pantalla completa y repasando a la vez: el aviso también se ve ahí.
  await app.key('f')
  await app.waitFor('return document.querySelector("[data-testid=player]").dataset.fullscreen === "1"', { timeoutMs: 5000 }).catch(() => false)
  await sleep(500)
  check('A pantalla completa, el aviso de repaso también se ve', await reachable('[data-testid=review-notice]'))
  await shot('preview-05-pantalla-completa-2x.png')
  await app.key('Escape')
  await sleep(600)

  // El vídeo que se guarda no cambia: ni la velocidad de los trozos ni el historial.
  check('Repasar no cambia el proyecto (velocidades) ni deja pasos de deshacer', JSON.stringify(await S('return store.project.value.clips.map((c) => c.speed)')) === '[1,2,1]' && (await S('return store.history.value.past.length')) === pastBefore)
  check('Ni se guarda en el autoguardado', !(await S('return JSON.stringify(store.project.value).includes("review")')))

  // Al ir a Guardar y volver, otra vez a 1×.
  await app.click('[data-testid=save-video]')
  await waitScreen('save-view')
  await shot('preview-06-guardar.png')
  await app.click('[data-testid=back-editor]')
  await waitScreen('editor')
  await sleep(400)
  check('Al ir a Guardar y volver, la vista previa está otra vez a 1× y sin aviso', (await playerData()).rate === 1 && !(await app.evaluate('return !!document.querySelector("[data-testid=review-notice]")')) && (await app.evaluate('return document.querySelector(\'[data-testid="review-rate-1"]\').getAttribute("aria-pressed")')) === 'true')
  {
    await seekPaused(2500)
    await app.key(' ')
    const m = await measurePlayback(1500)
    await app.key(' ')
    check('Y el reloj vuelve a ir a 1× (±5 %)', Math.abs(m.ratio - 1) <= 0.05, m.ratio.toFixed(3))
  }

  // A 1100×700 los controles caben.
  await app.setViewport(1100, 700)
  await sleep(500)
  {
    const fit = await app.evaluate(`const c = document.querySelector('[data-testid=player] .controls'); const r = c.getBoundingClientRect();
      const kids = [...c.children].map((k) => k.getBoundingClientRect()); const bar = document.querySelector('[data-testid=position-bar]').getBoundingClientRect();
      return { overflow: kids.some((k) => k.right > r.right + 1), bar: bar.width }`)
    check('A 1100×700, los controles caben y la barra de posición se puede usar', !fit.overflow && fit.bar >= 120, JSON.stringify(fit))
    await shot('preview-07-1100.png')
  }
  await app.setViewport(1280, 800)
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? e.stack ?? e.message : String(e))
  try {
    await app?.screenshot(join(opts.shots, 'preview-zz-fallo.png'))
  } catch {
    // Sin captura.
  }
} finally {
  app?.close()
  if (!opts['keep-open']) await stopApp()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
process.exit(failed.length ? 1 : 0)
