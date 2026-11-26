// Prueba de extremo a extremo de los atajos de teclado en la app Tauri real, por CDP, con eventos de teclado
// de verdad (Input.dispatchKeyEvent), no llamando a las funciones: cada atajo del mapa en su pantalla, que no
// actúan escribiendo en el texto del teleprompter, que el espacio con un botón enfocado no hace dos cosas,
// Esc en los diálogos (nunca lo destructivo), Esc reproduciendo vuelve a 0, Supr + deshacer, Ctrl+C / Ctrl+V
// de un trozo, pegar ficheros copiados en el Explorador (Set-Clipboard -Path), el panel «Teclas» (F1 / Esc)
// y que cada tecla dibujada corresponde a un atajo que vale ahora y se ve entera (también a 1100x700).
// Deja capturas keys-*.png en test-output/screenshots/.
//
// PowerShell (con Rust/cargo en el PATH, la app cerrada y los clips de `pnpm test:ffmpeg`):
//   node scripts/shortcuts-e2e.mjs
// Con la app ya abierta a mano (con --use-fake-device-for-media-stream para la cámara): --no-launch.
//
// Usa la cámara y el micrófono falsos de WebView2. Al acabar borra lo que ha guardado y grabado, deja el
// portapapeles como estaba (sin los ficheros de prueba) y cierra la app que haya arrancado. Sale con 1 si falla algo.

import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
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
  vertical: resolve(opts.media, 'src-vertical-1080x1920-60.mp4'),
  silence: resolve(opts.media, 'src-silence-middle-720p30.mp4'),
  noAudio: resolve(opts.media, 'src-no-audio-720p30.mp4'),
}
for (const p of Object.values(media)) if (!existsSync(p)) throw new Error(`Falta ${p}: ejecuta pnpm test:ffmpeg`)

// Ficheros para pegar desde el Explorador: uno con tildes, eñe y espacios en el nombre, y uno que no es vídeo.
const pasteVideo = resolve(opts.media, 'e2e-pegar vídeo de María ñ.mp4')
const pasteVideo2 = resolve(opts.media, 'e2e-pegar otro sonido ñ.mp4')
const pasteText = resolve(opts.media, 'e2e-pegar nota.txt')
copyFileSync(media.noAudio, pasteVideo)
copyFileSync(media.horizontal, pasteVideo2)
writeFileSync(pasteText, 'no es un vídeo')
const testFiles = [pasteVideo, pasteVideo2, pasteText]

const outputFolder = join(homedir(), 'Videos', 'Mis montajes (pruebas)')
const recordingsFolder = join(outputFolder, 'Grabaciones')
const outputBefore = new Set(existsSync(outputFolder) ? readdirSync(outputFolder) : [])
const recordingsBefore = new Set(existsSync(recordingsFolder) ? readdirSync(recordingsFolder) : [])

// ------------------------------------------------------------------ portapapeles de Windows (PowerShell)

function powershell(script, env = {}) {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`],
    { env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true },
  ).trim()
}

function setClipboardFiles(paths) {
  // Las rutas van por variable de entorno (UTF-16 de Windows): las tildes llegan intactas.
  powershell("Set-Clipboard -LiteralPath ($env:EC_FILES -split '\\|')", { EC_FILES: paths.join('|') })
}

function readClipboardState() {
  const json = powershell(
    "$f = @(Get-Clipboard -Format FileDropList -ErrorAction SilentlyContinue | Where-Object { $_ } | ForEach-Object { $_.FullName }); $t = Get-Clipboard -Raw -ErrorAction SilentlyContinue; ConvertTo-Json -Compress @{ files = $f; text = $t }",
  )
  try {
    const v = JSON.parse(json || '{}')
    const files = (Array.isArray(v.files) ? v.files : [v.files]).filter((x) => typeof x === 'string' && x !== '')
    return { files, text: typeof v.text === 'string' && v.text !== '' ? v.text : null }
  } catch {
    return { files: [], text: null }
  }
}

/** Si el portapapeles tiene aún ficheros de la prueba, deja lo que había antes (y si no, no lo toca). */
function restoreClipboard(saved) {
  const now = readClipboardState()
  if (!now.files.some((f) => testFiles.some((t) => t.toLowerCase() === f.toLowerCase()))) return
  powershell('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()')
  if (saved.files.length > 0) setClipboardFiles(saved.files)
  else if (saved.text) powershell('Set-Clipboard -Value $env:EC_TEXT', { EC_TEXT: saved.text })
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
  const env = { ...process.env, ...appTestEnv(port, { withSound: opts['with-sound'], foreground: opts.foreground, extra: ['--use-fake-device-for-media-stream'] }), PATH: `${join(homedir(), '.cargo', 'bin')};${process.env.PATH}` }
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

// ------------------------------------------------------------------ utilidades sobre la página

let app

async function shot(name) {
  await sleep(350)
  await app.screenshot(join(opts.shots, name))
}

const store = (expr) => app.evaluate(`const s = window.__easyCut.store; return ${expr}`)
const screen = () => store('s.screen.value')
const clips = () => store('s.project.value.clips.map((c) => ({ id: c.id, path: c.sourcePath, json: JSON.stringify({ ...c, id: undefined }) }))')
const selectedIndex = () => store('s.selectedIndex.value')
const total = () => store('window.__easyCut.domain.projectDurationMs(s.project.value)')
const toast = () => store('s.toast.value?.message ?? null')
const playerData = () =>
  app.evaluate('const p = document.querySelector("[data-testid=player]"); return { ms: Number(p.dataset.currentMs), dur: Number(p.dataset.durationMs), clip: Number(p.dataset.clipIndex), playing: p.dataset.playing === "1", src: Number(p.dataset.sourceMs) }')
const filmstrip = () =>
  app.evaluate('const f = document.querySelector("[data-testid=filmstrip]"); return f ? { in: Number(f.dataset.inMs), out: Number(f.dataset.outMs), head: Number(f.dataset.playheadMs) } : null')
const dialogOpen = () => app.evaluate('return !!document.querySelector("[data-testid=confirm-dialog]")')
const panelOpen = () => app.evaluate('return !!document.querySelector("[data-testid=keys-panel]")')
const tpStep = () => app.evaluate('return document.querySelector("[data-testid=teleprompter-view]")?.dataset.step ?? null')
const prompter = () => app.evaluate('const r = document.querySelector("[data-testid=prompter-run]"); return r ? { ...r.prompterState } : null')

async function waitScreen(name, timeoutMs = 20_000) {
  await app.waitFor('return window.__easyCut.store.screen.value === args.name', { args: { name }, timeoutMs, what: `pantalla ${name}` })
}
async function waitStep(step, timeoutMs = 20_000) {
  await app.waitFor('return document.querySelector("[data-testid=teleprompter-view]")?.dataset.step === args.step', { args: { step }, timeoutMs, what: `paso ${step}` })
}
async function blur() {
  await app.evaluate('document.activeElement?.blur?.(); return true')
}

/** Una tecla real; devuelve después de que la interfaz haya tenido tiempo de reaccionar. */
async function press(k, options = {}) {
  await app.key(k, options)
  await sleep(120)
}

/**
 * Recorre las teclas dibujadas (KeyHint) visibles y las contrasta con el registro de atajos: cada una tiene un
 * atajo con ese nombre en las capas activas (y activo si su botón lo está), se ve entera y no corta su botón.
 */
async function checkHints(where) {
  const r = await app.evaluate(`
    const active = window.__easyCut.shortcuts();
    // Visibles y sin nada encima (con un diálogo abierto, las de la pantalla de debajo no cuentan).
    const uncovered = (h) => { const r = h.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (top === h || h.contains(top) || top.contains(h) || (h.closest('button') && h.closest('button').contains(top))) };
    const hints = [...document.querySelectorAll('[data-key-hint]')].filter((h) => h.getClientRects().length > 0 && !h.closest('[data-keys-list]') && uncovered(h));
    const problems = [];
    const labels = [];
    for (const h of hints) {
      const label = h.dataset.key;
      const btn = h.closest('button');
      const name = btn?.dataset.testid ?? btn?.innerText ?? '?';
      labels.push(label);
      const matches = active.filter((s) => s.label === label);
      if (matches.length === 0) problems.push(label + ' en ' + name + ': no hay atajo');
      else if (btn && !btn.disabled && !matches.some((s) => s.enabled)) problems.push(label + ' en ' + name + ': el botón vale y el atajo no');
      const r = h.getBoundingClientRect();
      if (r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.top < -0.5) problems.push(label + ' en ' + name + ': fuera de la ventana');
      if (btn) {
        const b = btn.getBoundingClientRect();
        if (r.right > b.right + 0.5 || r.left < b.left - 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) problems.push(label + ' en ' + name + ': se sale de su botón');
        if (btn.scrollWidth > btn.clientWidth + 1) problems.push(name + ': texto cortado');
      }
    }
    return { problems, labels }`)
  check(`${where}: cada tecla dibujada es un atajo que vale y se ve entera`, r.problems.length === 0 && r.labels.length > 0, r.problems.join(' · ') || r.labels.join(' '))
  return r.labels
}

// ------------------------------------------------------------------ la prueba

const savedClipboard = readClipboardState()

try {
  await startApp()
  app = await connectToApp(port, { timeoutMs: 300_000 })
  await app.waitFor('return !!window.__easyCut?.store', { timeoutMs: 60_000, what: 'store de la app (modo desarrollo)' })
  // Punto de partida limpio: sin autoguardado ni texto del teleprompter.
  await app.evaluate('await window.__easyCut.resetProjects(); localStorage.removeItem("easy-cut:teleprompter"); location.reload(); return true')
  await sleep(1500)
  app.close()
  app = await connectToApp(port)
  await app.waitFor('return !!window.__easyCut?.store')
  await app.setViewport(1280, 800)
  await waitScreen('home')

  // --- Inicio y el panel «Teclas»
  await checkHints('Inicio')
  await shot('keys-01-inicio.png')
  await press('F1')
  check('F1 abre el panel «Teclas»', await panelOpen())
  const panelText = await app.text('[data-testid=keys-panel]')
  check('El panel lo dice en llano («Intro» → «Hacer un vídeo nuevo»; F1)', panelText.includes('Hacer un vídeo nuevo') && panelText.toLowerCase().includes('ver esta lista de teclas'), panelText)
  await checkHints('Panel «Teclas»')
  await shot('keys-02-panel-teclas.png')
  await press('Enter')
  check('Con el panel abierto, Intro no hace lo de debajo', (await screen()) === 'home' && (await panelOpen()))
  await press('Escape')
  check('Esc cierra el panel', !(await panelOpen()) && (await screen()) === 'home')
  await app.click('[data-testid=keys-button]')
  check('El botón «Teclas» abre el panel', await panelOpen())
  await press('F1')
  check('F1 otra vez lo cierra', !(await panelOpen()))

  // Intro = «Hacer un vídeo nuevo»
  await press('Enter')
  await waitScreen('pick')
  check('Inicio: Intro → «Elige tus vídeos»', true)
  await checkHints('Elige tus vídeos')
  await shot('keys-03-elegir.png')
  await press('Escape')
  await waitScreen('home')
  check('Elige tus vídeos: Esc → Inicio', true)
  await press('Enter')
  await waitScreen('pick')

  // --- Pegar ficheros copiados en el Explorador (Ctrl+V en «Elige tus vídeos»)
  setClipboardFiles([pasteVideo])
  {
    const t = await app.evaluate('const t0 = performance.now(); const r = await window.__easyCut.bridge.clipboardFiles(); return { ms: performance.now() - t0, paths: r.paths }')
    check('Leer los ficheros del portapapeles es rápido y respeta las tildes', t.ms < 100 && t.paths.length === 1 && t.paths[0].toLowerCase() === pasteVideo.toLowerCase(), `${t.ms.toFixed(1)} ms · ${t.paths.join(', ')}`)
  }
  await press('v', { ctrl: true })
  await waitScreen('editor', 30_000)
  {
    const c = await clips()
    check('Ctrl+V con un vídeo copiado en el Explorador lo añade como trozo', c.length === 1 && c[0].path.toLowerCase() === pasteVideo.toLowerCase(), c.map((x) => x.path).join(', '))
  }
  // Dos trozos más para tener material (con el gancho de desarrollo, como soltarlos).
  await app.evaluate('await window.__easyCut.store.addClipsFromPaths(args.p); return true', { p: [media.horizontal, media.silence] })
  await app.waitFor('return !document.querySelector("[data-testid=preparing]")', { timeoutMs: 30_000 })
  await sleep(1200)

  // --- «Tu vídeo»
  await checkHints('Tu vídeo (1280x800)')
  await shot('keys-04-tu-video.png')
  await app.setViewport(1100, 700)
  await checkHints('Tu vídeo (1100x700)')
  await shot('keys-05-tu-video-1100.png')
  await app.setViewport(1280, 800)
  await press('F1')
  {
    const t = (await app.text('[data-testid=keys-panel]')) ?? ''
    check('El panel de «Tu vídeo» lista sus teclas en llano', ['Reproducir o parar', 'Quitar el trozo elegido', 'Copiar el trozo elegido', 'Guardar el vídeo', 'Deshacer lo último'].every((x) => t.toLowerCase().includes(x.toLowerCase())), t)
  }
  await shot('keys-04b-panel-tu-video.png')
  await press('Escape')

  // Espacio
  await blur()
  await press(' ')
  await sleep(600)
  check('Espacio reproduce', (await playerData()).playing)
  await press(' ')
  check('Espacio para', !(await playerData()).playing)

  // Espacio con el botón de reproducir pulsado con el ratón: una sola cosa
  await app.click('[data-testid=play-toggle]')
  await sleep(500)
  const afterClick = (await playerData()).playing
  await press(' ')
  await sleep(200)
  check('Espacio con el botón «Reproducir» recién pulsado (foco del ratón) solo para, no lo vuelve a pulsar', afterClick && !(await playerData()).playing)

  // Espacio con un botón enfocado con Tab («Inicio»): reproduce y no pulsa el botón
  await blur()
  await press('Tab')
  const focused = await app.evaluate('const a = document.activeElement; return { id: a?.dataset?.testid ?? a?.tagName, visible: a?.matches(":focus-visible") }')
  await press(' ')
  await sleep(300)
  check('Espacio con «Inicio» enfocado con Tab: reproduce y no va a Inicio', focused.visible && (await screen()) === 'editor' && (await playerData()).playing, JSON.stringify(focused))
  await press(' ')
  await blur()

  // Esc reproduciendo: para y vuelve al principio
  {
    await press('End')
    const end = await playerData()
    check('Fin: al final', Math.abs(end.ms - end.dur) <= 60, `${end.ms} / ${end.dur}`)
    await press('Home')
    check('Inicio: al principio', (await playerData()).ms <= 30)
    await press('ArrowRight')
    await press('ArrowRight')
    const two = (await playerData()).ms
    await press('ArrowLeft')
    const one = (await playerData()).ms
    check('Flechas: 1 segundo adelante y atrás', Math.abs(two - 2000) <= 60 && Math.abs(one - 1000) <= 60, `${two} → ${one}`)
    await press('ArrowRight', { repeat: true })
    check('Las flechas se repiten al dejarlas pulsadas', Math.abs((await playerData()).ms - 2000) <= 60)
    await press(' ')
    await sleep(900)
    const before = await playerData()
    await press('Escape')
    await sleep(200)
    const after = await playerData()
    check('Esc reproduciendo: para y vuelve al segundo 0 (sin salir)', before.playing && !after.playing && after.ms <= 30 && (await screen()) === 'editor', `${before.ms} → ${after.ms}`)
  }

  // RePág / AvPág
  await store('s.select(s.project.value.clips[0].id)')
  await press('PageDown')
  const down = await selectedIndex()
  await press('PageDown')
  const down2 = await selectedIndex()
  await press('PageUp')
  check('AvPág / RePág: trozo siguiente / anterior', down === 1 && down2 === 2 && (await selectedIndex()) === 1, `${down}, ${down2}, ${await selectedIndex()}`)

  // E / T / P sobre el trozo elegido (sin sonido ni efecto elegido), en la línea; V ya no es nada
  {
    const lengths = () => store('s.project.value.clips.map((c) => window.__easyCut.domain.clipOutputMs(c))')
    const inOf = () => store('window.__easyCut.domain.clipInOut(s.project.value.clips[0]).startMs')
    await store('s.select(s.project.value.clips[0].id)')
    await blur()
    await press('Home')
    await press('ArrowRight')
    await press('ArrowRight')
    const before = await lengths()
    await press('p', { repeat: true })
    check('P dejado pulsado no parte el trozo', (await lengths()).length === before.length)
    await press('p')
    const split = await lengths()
    check('P: parte el trozo elegido en la línea (2 s)', split.length === before.length + 1 && Math.abs(split[0] - 2000) <= 60 && ((await toast()) ?? '').includes('partido'), `${split.join(', ')} · ${await toast()}`)
    await checkHints('Tu vídeo tras partir un trozo')
    await press('z', { ctrl: true })
    await press('t')
    check('T: el trozo elegido termina en la línea', Math.abs((await lengths())[0] - 2000) <= 60, String((await lengths())[0]))
    await press('z', { ctrl: true })
    await press('e')
    check('E: el trozo elegido empieza en la línea', Math.abs((await inOf()) - 2000) <= 60, String(await inOf()))
    await press('z', { ctrl: true })
    check('Y Ctrl+Z lo deja como estaba', JSON.stringify(await lengths()) === JSON.stringify(before))
    await press('End')
    check('Con la línea fuera del trozo, E / T / P no hacen nada', (await store('window.__easyCut.shortcuts().filter((x) => ["clip-trim-start", "clip-trim-end", "clip-split"].includes(x.id)).every((x) => !x.enabled)')) === true)
    const n = (await lengths()).length
    await press('v')
    check('V ya no cambia nada (no hay tarjetas)', (await lengths()).length === n && !(await store('window.__easyCut.shortcuts().some((x) => x.keys.includes("v"))')))
    await press('Home')
    // Como lo dejó AvPág / RePág: elegido el trozo 2.
    await store('s.select(s.project.value.clips[1].id)')
  }

  // Supr + deshacer; Supr dejado pulsado no quita más
  {
    const before = await clips()
    await press('Delete', { repeat: true })
    check('Supr dejado pulsado (repetición) no quita nada', (await clips()).length === before.length)
    await press('Delete')
    const after = await clips()
    check('Supr quita el trozo elegido con el aviso de «Deshacer»', after.length === before.length - 1 && !after.some((c) => c.id === before[1].id) && (await toast())?.startsWith('Trozo quitado'), await toast())
    await checkHints('Tu vídeo con aviso')
    await press('z', { ctrl: true })
    check('Ctrl+Z lo devuelve', (await clips()).map((c) => c.id).join() === before.map((c) => c.id).join())
    await press('y', { ctrl: true })
    check('Ctrl+Y lo vuelve a quitar', (await clips()).length === before.length - 1)
    await press('z', { ctrl: true })
  }

  // Esc con un aviso abierto: cierra el aviso, no sale
  await store("s.showToast('Aviso de prueba')")
  await press('Escape')
  check('Esc con un aviso: lo cierra y se queda en «Tu vídeo»', !(await toast()) && (await screen()) === 'editor')

  // Ctrl+C / Ctrl+V de un trozo (con ficheros viejos en el portapapeles: gana el trozo copiado después)
  {
    await store('s.select(s.project.value.clips[1].id)')
    const id = await store('s.selectedClipId.value')
    await app.evaluate(
      `const s = window.__easyCut.store, d = window.__easyCut.domain, id = args.id;
       s.apply((p) => d.setMuted(d.setSpeed(d.setInOut(p, id, { inMs: 1000, outMs: 7000 }), id, 2), id, true)); return true`,
      { id },
    )
    const before = await clips()
    const totalBefore = await total()
    const original = before.find((c) => c.id === id)
    const clipMs = await store(`window.__easyCut.domain.clipOutputMs(s.project.value.clips[1])`)
    await press('c', { ctrl: true })
    check('Ctrl+C: «Trozo copiado»', (await toast()) === 'Trozo copiado', await toast())
    const undoSteps = await store('s.history.value.past.length')
    await press('v', { ctrl: true })
    await sleep(300)
    const after = await clips()
    const pasted = after[2]
    check('Ctrl+V pega el trozo justo después del elegido', after.length === before.length + 1 && after[1].id === id && pasted.id !== id, after.map((c) => c.id.slice(0, 4)).join(' '))
    check('Con todos sus ajustes (cortes, velocidad, sonido…)', pasted.json === original.json)
    check('Duración total: antes + el trozo', (await total()) === totalBefore + clipMs, `${totalBefore} + ${clipMs} = ${await total()}`)
    check('Y queda elegido', (await store('s.selectedClipId.value')) === pasted.id)
    check('Un solo paso de deshacer', (await store('s.history.value.past.length')) === undoSteps + 1)
    await press('z', { ctrl: true })
    check('Ctrl+Z quita el pegado y deja la duración como estaba', (await clips()).length === before.length && (await total()) === totalBefore)

    // Botones visibles para lo mismo
    await app.click('[data-testid=copy-clip]')
    await app.waitFor('return !document.querySelector("[data-testid=paste-clip]").disabled', { what: '«Pegar» activo' })
    await app.click('[data-testid=paste-clip]')
    await sleep(300)
    check('Los botones «Copiar» y «Pegar» hacen lo mismo', (await clips()).length === before.length + 1)
    await press('z', { ctrl: true })
  }

  // Ficheros copiados después en el Explorador: ganan al trozo copiado
  {
    const before = await clips()
    setClipboardFiles([pasteVideo2])
    await press('v', { ctrl: true })
    await app.waitFor('return window.__easyCut.store.project.value.clips.length === args.n', { args: { n: before.length + 1 }, timeoutMs: 30_000, what: 'trozo pegado del Explorador' })
    const after = await clips()
    check('Ctrl+V con ficheros copiados después: entran esos (al final), no el trozo', after[after.length - 1].path.toLowerCase() === pasteVideo2.toLowerCase())
    await press('z', { ctrl: true })
    setClipboardFiles([pasteText])
    await press('v', { ctrl: true })
    await sleep(300)
    check('Ctrl+V con un fichero que no es vídeo: lo explica y no añade nada', (await clips()).length === before.length && ((await toast()) ?? '').includes('no parece un vídeo'), await toast())
    await press('Escape')
  }

  // Duración máxima: Esc cierra el desplegable sin salir
  await app.click('[data-testid=target-button]')
  await press('Escape')
  check('Esc cierra «Duración máxima» y se queda en «Tu vídeo»', !(await app.evaluate('return !!document.querySelector(".popover")')) && (await screen()) === 'editor')

  // Esc sin nada abierto: a Inicio, con el vídeo en la lista; borrarlo pregunta y Esc / Intro no lo borran
  {
    const n = (await clips()).length
    const id = await store('s.projectId.value')
    await blur()
    await press('Escape')
    await waitScreen('home')
    const cardSel = `[data-testid=project-card][data-project-id="${id}"]`
    await app.waitFor('return !!document.querySelector(args.s)', { args: { s: cardSel }, what: 'el vídeo en la lista de Inicio' })
    check('Esc en «Tu vídeo»: a Inicio, con el vídeo en la lista', !!(await app.text(cardSel)))
    await app.click(`${cardSel} [data-testid=project-delete]`)
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")', { what: 'pregunta de borrar el vídeo' })
    await checkHints('Pregunta (destructiva)')
    await shot('keys-06-pregunta.png')
    await press('Escape')
    check('Esc en la pregunta: la cierra sin borrar el vídeo', !(await dialogOpen()) && !!(await app.text(cardSel)) && (await clips()).length === n)
    await app.click(`${cardSel} [data-testid=project-delete]`)
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    await press('Enter')
    check('Intro en una pregunta destructiva es «No, volver» (no borra)', !(await dialogOpen()) && !!(await app.text(cardSel)) && (await screen()) === 'home')
    await press('Enter')
    await waitScreen('pick')
    check('Intro en Inicio: «Hacer un vídeo nuevo», sin preguntar', !(await dialogOpen()))
    await press('Escape')
    await waitScreen('home')
    await app.click(`${cardSel} [data-testid=project-open]`)
    await waitScreen('editor')
    check('Abrirlo desde la lista vuelve con todo', (await clips()).length === n)
  }

  // --- «Arreglar este trozo»
  await store('s.select(s.project.value.clips[1].id)')
  await blur()
  await press('a')
  await waitScreen('clip')
  check('A: «Arreglar este trozo»', true)
  await sleep(800)
  await checkHints('Arreglar este trozo (1280x800)')
  await shot('keys-07-arreglar.png')
  await app.setViewport(1100, 700)
  await checkHints('Arreglar este trozo (1100x700)')
  await shot('keys-08-arreglar-1100.png')
  await app.setViewport(1280, 800)
  {
    const tabs = ['cut', 'pauses', 'frame', 'picture', 'speed', 'sound']
    const selected = []
    for (let i = 0; i < tabs.length; i++) {
      await press(String(i + 1))
      selected.push(await app.evaluate('return document.querySelector(`[data-testid=tab-${args.t}]`)?.getAttribute("aria-selected")', { t: tabs[i] }))
    }
    check('1–6: las pestañas en su orden', selected.every((v) => v === 'true'), selected.join(' '))
    await press('2')
    const f0 = await filmstrip()
    await press('e')
    check('E no hace nada fuera de «Cortar»', (await filmstrip()).in === f0.in)
    await press('1')
    await press('Home')
    const start = await filmstrip()
    await press('ArrowRight')
    await press('ArrowRight')
    const h2 = await filmstrip()
    check('Flecha derecha: 1 segundo adelante (dos veces)', h2.head - start.head === 2000, `${start.head} → ${h2.head}`)
    await press('e')
    const e = await filmstrip()
    check('E: «Empieza aquí»', e.in === h2.head, `${e.in}`)
    await press('ArrowRight')
    await press('ArrowRight')
    await press('t')
    const t = await filmstrip()
    check('T: «Termina aquí»', t.out === e.in + 2000, `${t.in}–${t.out}`)
    await press('ArrowLeft')
    const n = (await clips()).length
    await press('p', { repeat: true })
    check('P dejado pulsado no parte', (await clips()).length === n)
    await press('p')
    check('P: «Partir aquí»', (await clips()).length === n + 1 && ((await toast()) ?? '').includes('partido'), await toast())
    await press('z', { ctrl: true })
    check('Ctrl+Z deshace el partir', (await clips()).length === n)
    await press('End')
    check('Fin: al final del trozo', (await filmstrip()).head === (await filmstrip()).out)
    await press('Home')
    check('Inicio: al principio del trozo', (await filmstrip()).head === (await filmstrip()).in)
    await store('s.hideToast()')
    await blur()
    await press(' ')
    await sleep(800)
    const playing = await playerData()
    await press('Escape')
    await sleep(200)
    const stopped = await playerData()
    const fs1 = await filmstrip()
    check('Esc reproduciendo: para y vuelve al principio del trozo, sin salir', playing.playing && !stopped.playing && fs1.head === fs1.in && (await screen()) === 'clip', `${playing.src} → ${fs1.head}`)
    await press('l')
    await waitScreen('editor')
    check('L: «Listo»', true)
    await press('a')
    await waitScreen('clip')
    await blur()
    await press('Enter')
    await waitScreen('editor')
    check('Intro: «Listo»', true)
    await press('a')
    await waitScreen('clip')
    await press('Escape')
    await waitScreen('editor')
    check('Esc sin reproducir: vuelve a «Tu vídeo» (los cambios se quedan)', true)
  }

  // --- Guardar (1–4), Guardando (Esc = Cancelar con su pregunta) y ¡Listo!
  // Un vídeo largo (unos 3 minutos) para que dé tiempo a probar la pregunta mientras se guarda.
  await app.evaluate('await window.__easyCut.store.addClipsFromPaths(args.p); return true', { p: Array(14).fill(media.horizontal) })
  await app.waitFor('return !document.querySelector("[data-testid=preparing]")', { timeoutMs: 30_000 })
  {
    const done = (await clips()).length
    await blur()
    await press('g')
    await waitScreen('save')
    check('G: «Guardar el vídeo»', true)
    await checkHints('Guardar')
    await shot('keys-09-guardar.png')
    await press('Escape')
    await waitScreen('editor')
    check('Guardar: Esc → «Tu vídeo»', true)
    await press('g')
    await waitScreen('save')
    await press('1')
    await waitScreen('saving')
    check('1: «Para WhatsApp» empieza a guardar', (await app.evaluate('return window.__easyCut.saveFlow.preset.value')) === 'whatsapp')
    await checkHints('Guardando')
    await shot('keys-10-guardando.png')
    await press('Escape')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")', { what: 'pregunta de cancelar' })
    await shot('keys-11-guardando-pregunta.png')
    await press('Escape')
    check('Esc en «¿Dejar de guardar?»: sigue guardando', !(await dialogOpen()) && (await screen()) === 'saving')
    await press('Escape')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    await press('Enter')
    check('Intro en «¿Dejar de guardar?» es «No, seguir guardando»', !(await dialogOpen()) && (await screen()) === 'saving')
    await press('Escape')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    await app.click('[data-testid=confirm-ok]')
    await waitScreen('save', 30_000)
    check('«Sí, dejar de guardar» (con el ratón) cancela', true)
    await press('4')
    await app.waitFor('const s = window.__easyCut.store.screen.value; return s === "done" || !!document.querySelector("[data-testid=error-dialog]")', { timeoutMs: 120_000, what: 'fin de «Solo el sonido»' })
    check('4: «Solo el sonido» guarda', (await screen()) === 'done')
    await checkHints('¡Listo!')
    await shot('keys-12-listo.png')
    await press('Escape')
    await waitScreen('editor')
    check('¡Listo!: Esc → «Tu vídeo»', (await clips()).length === done)
    await press('z', { ctrl: true })
  }

  // --- Teleprompter: el texto (nada de atajos de letra escribiendo)
  await app.click('[data-testid=record-more]')
  await waitStep('script')
  await checkHints('Teleprompter: el texto')
  {
    await app.click('[data-testid=script-input]')
    const n = (await clips()).length
    await press('a', { ctrl: true })
    await press('Backspace')
    for (const k of ['e', ' ', 't', ' ', 'p', ' ']) await press(k)
    const value = await app.evaluate('return document.querySelector("[data-testid=script-input]").value')
    check('Escribiendo «e t p» y espacios: se escriben y no pasa nada más', value === 'e t p ' && (await tpStep()) === 'script' && !(await toast()) && (await clips()).length === n, JSON.stringify(value))
    await press('v', { ctrl: true })
    check('Ctrl+V en el texto no pega trozos', (await clips()).length === n)
    await press('F1')
    check('F1 vale también escribiendo', await panelOpen())
    await shot('keys-13-panel-teleprompter.png')
    await press('Escape')
    const stillFocused = await app.evaluate('return document.activeElement?.dataset?.testid === "script-input"')
    check('Esc cierra el panel', !(await panelOpen()) && stillFocused)
    await press('Escape')
    check('Esc en el texto: solo sale del cuadro (no vuelve atrás)', (await tpStep()) === 'script' && !(await app.evaluate('return document.activeElement?.dataset?.testid === "script-input"')))
    await shot('keys-14-teleprompter-texto.png')
  }

  // Ensayo corto: Intro termina cuando ya ha pasado el texto
  await app.click('[data-testid=rehearse]')
  await waitStep('rehearse')
  await app.waitFor('return document.querySelector("[data-testid=prompter-run]")?.prompterState?.phase === "running"', { timeoutMs: 10_000 })
  await press('Enter')
  check('Intro antes de acabar el texto no termina', (await tpStep()) === 'rehearse')
  await app.waitFor('return !!document.querySelector("[data-testid=run-finish] [data-key-hint]")', { timeoutMs: 15_000, what: 'texto acabado (Intro)' })
  await checkHints('Ensayo terminado')
  await press('Enter')
  await waitStep('script')
  check('Intro con el texto acabado: «Terminar el ensayo»', !!(await app.text('[data-testid=last-rehearsal]')))

  // Ensayo largo: espacio, flechas y Esc
  {
    await app.click('[data-testid=script-input]')
    await press('a', { ctrl: true })
    await app.send('Input.insertText', { text: 'Hola a todos. '.repeat(60) })
    await blur()
    await app.click('[data-testid=rehearse]')
    await waitStep('rehearse')
    await app.waitFor('return document.querySelector("[data-testid=prompter-run]")?.prompterState?.phase === "running"', { timeoutMs: 10_000 })
    await sleep(1500)
    await checkHints('Ensayando')
    await shot('keys-15-ensayando.png')
    const w0 = (await prompter()).wpm
    await press('ArrowDown')
    const w1 = (await prompter()).wpm
    await press('ArrowUp')
    check('Flecha abajo / arriba: más rápido / más despacio', w1 > w0 && (await prompter()).wpm === w0, `${w0} → ${w1}`)
    await press(' ')
    check('Espacio: pausa', (await prompter()).phase === 'paused')
    await press(' ')
    check('Espacio: sigue', (await prompter()).phase === 'running')
    await sleep(800)
    const u0 = (await prompter()).units
    await press('ArrowLeft')
    check('Flecha izquierda: retrocede un poco', (await prompter()).units < u0 - 2)
    await press('Escape')
    await waitStep('script')
    check('Esc en el ensayo: deja de ensayar', true)
  }

  // Grabar (cámara falsa): Intro empieza; Esc pregunta y nunca borra por Intro
  {
    await app.click('[data-testid=script-input]')
    await press('a', { ctrl: true })
    await app.send('Input.insertText', { text: 'Uno dos tres cuatro' })
    await blur()
    await app.click('[data-testid=go-camera]')
    await waitStep('camera')
    await app.waitFor('return !document.querySelector("[data-testid=start-recording]").disabled', { timeoutMs: 20_000, what: 'cámara lista' })
    await checkHints('Prepara la cámara')
    await shot('keys-16-camara.png')
    await press('Enter')
    await waitStep('record')
    check('Intro: «Empezar a grabar»', true)
    await app.waitFor('return document.querySelector("[data-testid=prompter-run]")?.prompterState?.phase === "running"', { timeoutMs: 10_000 })
    await press('Escape')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")', { what: '«¿Dejar de grabar?»' })
    check('Esc grabando: pausa y pregunta', (await prompter()).phase === 'paused')
    await press('Enter')
    check('Intro en «¿Dejar de grabar?» es «No, seguir aquí»', !(await dialogOpen()) && (await tpStep()) === 'record')
    await press('Escape')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    await press('Escape')
    check('Esc en «¿Dejar de grabar?» la cierra y sigue grabando (en pausa)', !(await dialogOpen()) && (await tpStep()) === 'record')
    await press(' ')
    check('Espacio: sigue grabando', (await prompter()).phase === 'running')
    await app.waitFor('return !!document.querySelector("[data-testid=run-finish] [data-key-hint]")', { timeoutMs: 15_000, what: 'texto acabado' })
    await checkHints('Grabando (pantalla oscura)')
    await shot('keys-17-grabando.png')
    await press('Enter')
    await waitStep('review', 60_000)
    check('Intro con el texto acabado: «Terminar»', true)
    await sleep(800)
    await checkHints('Mira cómo ha quedado')
    await shot('keys-18-revisar.png')
    await press(' ')
    await sleep(700)
    const playing = await app.evaluate('const v = document.querySelector("[data-testid=review-video]"); return { paused: v.paused, t: v.currentTime }')
    await press('Escape')
    await sleep(200)
    const stopped = await app.evaluate('const v = document.querySelector("[data-testid=review-video]"); return { paused: v.paused, t: v.currentTime }')
    check('Revisar: Espacio la ve; Esc para y vuelve al principio', !playing.paused && stopped.paused && stopped.t === 0 && (await tpStep()) === 'review', `${playing.t} → ${stopped.t}`)
    await press('Escape')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")', { what: '«¿Salir sin usar la grabación?»' })
    await press('Enter')
    check('Intro en «¿Salir sin usar la grabación?» no la borra', !(await dialogOpen()) && (await tpStep()) === 'review')
    const n = (await clips()).length
    await press('Enter')
    await waitScreen('editor', 60_000)
    await app.waitFor('return window.__easyCut.store.project.value.clips.length === args.n', { args: { n: n + 1 }, timeoutMs: 30_000, what: 'grabación añadida' })
    check('Intro en revisar: «Usar esta grabación»', true)
  }

  // Con todo hecho: el aviso de «Grabación añadida» y que no queda nada encendido
  check('No queda la cámara encendida', (await app.evaluate('return window.__easyCut.liveTracks().length')) === 0)
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? (e.stack ?? e.message) : String(e))
  try {
    await app?.screenshot(join(opts.shots, 'keys-zz-fallo.png'))
  } catch {
    // Sin captura.
  }
} finally {
  try {
    if (app) await app.evaluate('await window.__easyCut.resetProjects(); return true')
  } catch {
    // La app ya no responde.
  }
  app?.close()
  if (!opts['keep-open']) await stopApp()
  // Limpieza: lo guardado y grabado por la prueba, los ficheros de pegar y el portapapeles como estaba.
  for (const [folder, before] of [
    [outputFolder, outputBefore],
    [recordingsFolder, recordingsBefore],
  ]) {
    if (!existsSync(folder)) continue
    for (const name of readdirSync(folder)) {
      if (before.has(name) || !/\.(mp4|m4a)$/i.test(name)) continue
      try {
        unlinkSync(join(folder, name))
        console.log(`      borrado ${name}`)
      } catch (err) {
        console.log(`      no se ha podido borrar ${name}: ${err}`)
      }
    }
  }
  try {
    restoreClipboard(savedClipboard)
    const now = readClipboardState()
    check('El portapapeles queda sin los ficheros de prueba', !now.files.some((f) => testFiles.some((t) => t.toLowerCase() === f.toLowerCase())), now.files.join(', '))
  } catch (err) {
    check('El portapapeles queda sin los ficheros de prueba', false, String(err))
  }
  for (const f of testFiles) {
    try {
      if (existsSync(f)) unlinkSync(f)
    } catch {
      // Se queda en test-output/, que no se commitea.
    }
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
process.exit(failed.length ? 1 : 0)
