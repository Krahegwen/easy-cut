// Prueba de extremo a extremo de «Solo recortar», en la app Tauri real por CDP y con los botones y las teclas de
// verdad: Inicio → «Solo recortar un vídeo» → elegir (con queuePickedVideos) un vídeo de «móvil» (fotograma
// clave cada 2 s, rotación de 90° y ubicación en los metadatos) → marcar con las teclas → «Rápido» (copia
// desde el fotograma clave anterior: lo dice con la cifra y lo enseña en la barra y al reproducir) y «Exacto»,
// los dos comprobados con ffprobe (duración, primer paquete clave, sin ubicación, rotación) → «¡Listo!» dice
// cómo se guardó → «Convertir en un vídeo normal» → aparece en «Tu vídeo» con el corte y en la lista. Y un
// ProRes, con el que «Rápido» no se ofrece. Capturas trim-*.png a 1280×800 y 1100×700.
//
// PowerShell (con Rust/cargo en el PATH, la app cerrada y los ficheros de `pnpm test:ffmpeg` en test-output):
//   node scripts/trim-e2e.mjs
// Con la app ya abierta a mano: --no-launch.
//
// Trabaja con una copia del vídeo en una carpeta temporal (con espacios y tildes) y la borra al acabar; borra
// lo que guarda en «Mis montajes (pruebas)» y deja la lista de vídeos de la app de desarrollo vacía. Sale con 1
// si algo falla.

import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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

const phone = resolve(opts.media, 'trim', 'src-trim-phone.mov')
const prores = resolve(opts.media, 'e2e-prores-pcm.mov')
for (const p of [phone]) if (!existsSync(p)) throw new Error(`Falta ${p}: ejecuta pnpm test:ffmpeg`)
const LOCATION = '+40.4168-003.7038'

const work = join(tmpdir(), `easy-cut e2e recortar ${process.pid}`)
mkdirSync(work, { recursive: true })
const source = join(work, 'toma del móvil.mov')
copyFileSync(phone, source)
const proresCopy = existsSync(prores) ? join(work, 'cámara prores.mov') : null
if (proresCopy) copyFileSync(prores, proresCopy)

const outputFolder = join(homedir(), 'Videos', 'Mis montajes (pruebas)')
const filesBefore = new Set(existsSync(outputFolder) ? readdirSync(outputFolder) : [])

// ------------------------------------------------------------------ ffprobe

function probeJson(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path], { encoding: 'utf8' }))
}
const rotationOf = (raw) => raw.streams.find((s) => s.codec_type === 'video')?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0
function firstVideoPacket(path) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', path], { encoding: 'utf8' })
  const [pts, flags] = out.trim().split(/\r?\n/)[0].split(',')
  return { pts: Number(pts), flags: flags ?? '' }
}
function decodeErrors(path) {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', path, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return ''
  } catch (e) {
    return String(e.stderr ?? e)
  }
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

const T = (expr, args = {}) => app.evaluate(`const store = window.__easyCut.store; const trim = window.__easyCut.trim; const saveFlow = window.__easyCut.saveFlow; ${expr}`, args)
const queuePick = (paths) => app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: paths })
const screen = () => T('return store.screen.value')
const range = () => T('return { ...trim.range.value }')
const playhead = () => T('return trim.playheadMs.value')

async function waitScreen(name, timeoutMs = 20_000) {
  await app.waitFor('return window.__easyCut.store.screen.value === args.name', { args: { name }, timeoutMs, what: `pantalla ${name}` })
  await sleep(250)
}

/** Que no se salga nada por los lados y que lo principal se vea entero. */
async function layout(selectors) {
  return app.evaluate(
    `const out = [];
     if (document.documentElement.scrollWidth > innerWidth + 1) out.push('la página se sale por la derecha');
     for (const s of args.s) {
       const el = document.querySelector(s);
       if (!el) { out.push(s + ': no está'); continue }
       const r = el.getBoundingClientRect();
       if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) out.push(s + ': fuera de la ventana');
       if (el.tagName === 'BUTTON' && el.scrollWidth > el.clientWidth + 1) out.push(s + ': texto cortado');
     }
     return out`,
    { s: selectors },
  )
}

/** Cada tecla dibujada es un atajo que vale ahora y se ve entera (como en shortcuts-e2e). */
async function checkHints(where) {
  const r = await app.evaluate(`
    const active = window.__easyCut.shortcuts();
    const hints = [...document.querySelectorAll('[data-key-hint]')].filter((h) => h.getClientRects().length > 0 && !h.closest('[data-keys-list]'));
    const problems = [];
    for (const h of hints) {
      const label = h.dataset.key;
      const btn = h.closest('button');
      const name = btn?.dataset.testid ?? '?';
      const matches = active.filter((s) => s.label === label);
      if (matches.length === 0) problems.push(label + ' en ' + name + ': no hay atajo');
      else if (btn && !btn.disabled && !matches.some((s) => s.enabled)) problems.push(label + ' en ' + name + ': el botón vale y el atajo no');
      const r = h.getBoundingClientRect();
      if (r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) problems.push(label + ' en ' + name + ': fuera de la ventana');
    }
    return { problems, labels: hints.map((h) => h.dataset.key) }`)
  check(`${where}: cada tecla dibujada es un atajo que vale`, r.problems.length === 0 && r.labels.length > 0, r.problems.join(' · ') || r.labels.join(' '))
}

async function waitDone() {
  await app.waitFor('const s = window.__easyCut.store.screen.value; return s === "done" || (s !== "saving" && !window.__easyCut.saveFlow.running.value)', { timeoutMs: 120_000, what: 'guardado terminado' })
  await noErrorDialog('guardar')
  await waitScreen('done')
}

const keyTimes = async (k, n) => {
  for (let i = 0; i < n; i++) await app.key(k)
}

// ================================================================== prueba

try {
  await startApp()
  app = await connectToApp(port, { timeoutMs: 240_000 })
  await app.waitFor('return !!window.__easyCut?.store', { timeoutMs: 60_000, what: 'store de la app (modo desarrollo)' })
  await app.evaluate('await window.__easyCut.resetProjects(); return true')
  await app.setViewport(1280, 800)
  console.log(`Conectado a ${app.url}`)

  // --- Inicio: el tercer botón, discreto
  {
    await waitScreen('home')
    const label = await app.text('[data-testid=trim-only]')
    check('Inicio tiene «Solo recortar un vídeo»', label === 'Solo recortar un vídeo', label)
    const problems = await layout(['[data-testid=new-video]', '[data-testid=teleprompter]', '[data-testid=trim-only]'])
    check('Inicio a 1280×800: nada se sale ni se corta', problems.length === 0, problems.join(' · '))
    await shot('trim-01-inicio.png')
  }

  // --- Elegir: se abre con el vídeo entero marcado
  {
    await queuePick([source])
    await app.click('[data-testid=trim-only]')
    await waitScreen('trim')
    await app.waitFor('const v = document.querySelector("[data-testid=trim-video]"); return v && v.readyState >= 2 && v.videoWidth > 0', { timeoutMs: 20_000, what: 'vista previa cargada' })
    const r = await range()
    check('Se abre con el vídeo entero marcado', r.inMs === 0 && Math.abs(r.outMs - 12_000) < 100, JSON.stringify(r))
    check('El nombre del fichero arriba', (await app.text('[data-testid=trim-file]')) === 'toma del móvil.mov')
    check('Al principio, «Rápido» ya es exacto', ((await app.text('[data-testid=trim-copy-note]')) ?? '').includes('justo donde has marcado'))
    const portrait = await app.evaluate('const v = document.querySelector("[data-testid=trim-video]"); return v.videoHeight > v.videoWidth')
    check('La vista previa sale derecha (en vertical)', portrait === true)
  }

  // --- Marcar con las teclas: → 5 veces, E; → 4 veces, T
  {
    await keyTimes('ArrowRight', 5)
    check('→ avanza 1 s cada vez', Math.abs((await playhead()) - 5_000) < 50, String(await playhead()))
    await app.key('e')
    await keyTimes('ArrowRight', 4)
    await app.key('t')
    const r = await range()
    check('E y T marcan el principio y el final en la línea', r.inMs === 5_000 && r.outMs === 9_000, JSON.stringify(r))
    await app.waitFor('return window.__easyCut.trim.keyframe.value.status === "ready"', { timeoutMs: 10_000, what: 'fotograma clave' })
    const note = (await app.text('[data-testid=trim-copy-note]')) ?? ''
    check('«Rápido» dice la cifra real: «Empezará 1,0 s antes, en 0:04»', note.startsWith('Empezará 1,0 s antes, en 0:04'), note)
    const early = await app.evaluate('const e = document.querySelector("[data-testid=trim-early]"); const k = document.querySelector("[data-testid=trim-kept]"); if (!e || !k) return null; const a = e.getBoundingClientRect(), b = k.getBoundingClientRect(); return { touches: Math.abs(a.right - b.left) < 1.5, width: a.width }')
    check('La barra enseña, rayado, lo que «Rápido» añade por delante', !!early && early.touches && early.width > 10, JSON.stringify(early))
    check('«Durará 5 s» con «Rápido»', ((await app.text('[data-testid=trim-result]')) ?? '').includes('5 s'), await app.text('[data-testid=trim-result]'))
    check('Inicio / Fin van al principio y al final', await (async () => {
      await app.key('End')
      const end = await playhead()
      await app.key('Home')
      return Math.abs(end - 12_000) < 100 && (await playhead()) === 0
    })())
    await checkHints('Solo recortar')
    let problems = await layout(['[data-testid=trim-save]', '[data-testid=trim-convert]', '[data-testid=trim-mode-copy]', '[data-testid=trim-mode-exact]', '[data-testid=trim-bar]', '[data-testid=trim-end-here]', '[data-testid=trim-start-here]'])
    check('A 1280×800 se ve todo', problems.length === 0, problems.join(' · '))
    await shot('trim-02-marcado.png')
    await app.setViewport(1100, 700)
    problems = await layout(['[data-testid=trim-save]', '[data-testid=trim-convert]', '[data-testid=trim-mode-copy]', '[data-testid=trim-mode-exact]', '[data-testid=trim-bar]', '[data-testid=trim-end-here]', '[data-testid=trim-start-here]'])
    check('A 1100×700 se ve todo', problems.length === 0, problems.join(' · '))
    await shot('trim-03-marcado-1100.png')
    await app.setViewport(1280, 800)
  }

  // --- Reproducir: lo que se guardará con «Rápido» (desde el fotograma clave) y Esc para y vuelve ahí
  {
    await app.key(' ')
    await sleep(700)
    const at = await playhead()
    const playing = await app.evaluate('return !document.querySelector("[data-testid=trim-video]").paused')
    check('Espacio reproduce desde donde empezará «Rápido» (0:04)', playing && at >= 4_000 && at < 5_200, `${at} ms`)
    await app.key('Escape')
    await sleep(200)
    const paused = await app.evaluate('return document.querySelector("[data-testid=trim-video]").paused')
    check('Esc para y vuelve al principio de lo que se guarda', paused && (await playhead()) === 4_000 && (await screen()) === 'trim', String(await playhead()))
  }

  // --- Guardar «Rápido» (G): copia sin recodificar
  let rapidoPath = null
  {
    const t0 = Date.now()
    await app.key('g')
    await waitDone()
    const wall = Date.now() - t0
    const summary = (await app.text('[data-testid=done-save-summary]')) ?? ''
    check('«¡Listo!» lo dice en llano: «Guardado en … sin recodificar»', /^Guardado en .+ sin recodificar$/.test(summary), summary)
    rapidoPath = await T('return store.lastExport.value?.path ?? null')
    check('Nombre «toma del móvil (recortado).mp4» en Mis montajes (pruebas)', !!rapidoPath && rapidoPath.endsWith('\\Mis montajes (pruebas)\\toma del móvil (recortado).mp4'), rapidoPath)
    const raw = probeJson(rapidoPath)
    const dur = Number(raw.format.duration)
    check('«Rápido» dura desde el fotograma clave (0:04) hasta el final (0:09): 5 s', Math.abs(dur - 5) < 0.1, `${dur} s`)
    const first = firstVideoPacket(rapidoPath)
    check('El primer paquete de vídeo es clave (se ve desde el principio)', first.flags.includes('K') && Math.abs(first.pts) < 0.05, JSON.stringify(first))
    check('Se decodifica entero sin errores', decodeErrors(rapidoPath) === '')
    check('Sin la ubicación del móvil', !readFileSync(rapidoPath).includes(LOCATION) && !Object.keys(raw.format.tags ?? {}).some((k) => /location/i.test(k)))
    check('Con la rotación del original (90°)', rotationOf(raw) === rotationOf(probeJson(source)), String(rotationOf(raw)))
    const log = await T('return saveFlow.lastLog.value')
    check('En el registro: copiado sin recodificar, desde «Solo recortar»', log?.method === 'copy' && log?.tool === 'trim' && log?.usedEncoder === null && log?.result === 'ok', JSON.stringify(log))
    console.log(`      «Rápido»: ${wall} ms desde pulsar G hasta «¡Listo!» (ffmpeg ${log?.encodeMs} ms)`)
    await checkHints('¡Listo! (desde Solo recortar)')
    await shot('trim-04-listo-rapido.png')
  }

  // --- Esc vuelve a recortar; «Exacto» (2, Intro)
  {
    await app.key('Escape')
    await waitScreen('trim')
    check('Esc en «¡Listo!» vuelve a «Solo recortar» con lo marcado', JSON.stringify(await range()) === JSON.stringify({ inMs: 5_000, outMs: 9_000 }))
    await app.key('2')
    check('2 elige «Exacto»', (await T('return trim.effectiveMode.value')) === 'exact')
    check('«Durará 4 s» con «Exacto»', ((await app.text('[data-testid=trim-result]')) ?? '').includes('4 s'), await app.text('[data-testid=trim-result]'))
    await shot('trim-05-exacto.png')
    const t0 = Date.now()
    await app.key('Enter')
    await waitDone()
    const wall = Date.now() - t0
    const summary = (await app.text('[data-testid=done-save-summary]')) ?? ''
    check('«¡Listo!» dice con qué se recodificó', /^Guardado en .+ con /.test(summary), summary)
    const path = await T('return store.lastExport.value?.path ?? null')
    check('Segundo nombre sin sobrescribir: «… (recortado) 2.mp4»', !!path && path.endsWith('toma del móvil (recortado) 2.mp4'), path)
    const raw = probeJson(path)
    const dur = Number(raw.format.duration)
    check('«Exacto» dura justo lo marcado: 4 s', Math.abs(dur - 4) < 0.05, `${dur} s`)
    const v = raw.streams.find((s) => s.codec_type === 'video')
    check('«Exacto» ya sale derecho (vertical, sin rotación que aplicar)', rotationOf(raw) === 0 && v.height > v.width, `${v.width}x${v.height} rot ${rotationOf(raw)}`)
    check('«Exacto» sin la ubicación', !readFileSync(path).includes(LOCATION))
    const log = await T('return saveFlow.lastLog.value')
    check('En el registro: recodificado desde «Solo recortar»', log?.method === 'encode' && log?.tool === 'trim' && log?.target === 'high', JSON.stringify({ method: log?.method, tool: log?.tool, used: log?.usedEncoder }))
    console.log(`      «Exacto»: ${wall} ms desde pulsar Intro hasta «¡Listo!» (ffmpeg ${log?.encodeMs} ms, ${log?.usedEncoder})`)
    await shot('trim-06-listo-exacto.png')
  }

  // --- «Convertir en un vídeo normal»: a «Tu vídeo», con el corte, y a la lista
  {
    await app.click('[data-testid=back-to-trim]')
    await waitScreen('trim')
    await app.click('[data-testid=trim-convert]')
    await waitScreen('editor')
    const clips = await T('return store.project.value.clips.map((c) => ({ path: c.sourcePath, io: window.__easyCut.domain.clipInOut(c) }))')
    check('En «Tu vídeo» hay un trozo con el corte hecho (0:05 → 0:09)', clips.length === 1 && clips[0].path === source && clips[0].io.startMs === 5_000 && clips[0].io.endMs === 9_000, JSON.stringify(clips))
    check('Forma vertical (la del vídeo)', (await T('return store.project.value.aspect')) === '9:16')
    await app.waitFor('const s = window.__easyCut.store; return !!s.projectId.value && s.projects.value.some((p) => p.id === s.projectId.value)', { timeoutMs: 8_000, what: 'en la lista' })
    check('Ya está en la lista de vídeos en marcha', true)
    await noErrorDialog('convertir')
    await shot('trim-07-tu-video.png')
    await app.click('[data-testid=go-home]')
    await waitScreen('home')
    let problems = await layout(['[data-testid=new-video]', '[data-testid=teleprompter]', '[data-testid=trim-only]'])
    check('Inicio con la lista a 1280×800: los tres botones se ven enteros', problems.length === 0, problems.join(' · '))
    await shot('trim-08-inicio-lista.png')
    await app.setViewport(1100, 700)
    problems = await layout(['[data-testid=new-video]', '[data-testid=teleprompter]', '[data-testid=trim-only]'])
    check('Inicio con la lista a 1100×700: los tres botones se ven enteros', problems.length === 0, problems.join(' · '))
    await shot('trim-09-inicio-lista-1100.png')
    await app.setViewport(1280, 800)
    const cards = await app.evaluate('return document.querySelectorAll("[data-testid=project-card]").length')
    check('Una tarjeta en «Tus vídeos en marcha»', cards === 1, String(cards))
  }

  // --- Un ProRes: «Rápido» no se ofrece y dice por qué; Esc vuelve a Inicio
  if (proresCopy) {
    await queuePick([proresCopy])
    await app.click('[data-testid=trim-only]')
    await waitScreen('trim')
    const disabled = await app.evaluate('return document.querySelector("[data-testid=trim-mode-copy]").disabled')
    const note = (await app.text('[data-testid=trim-copy-note]')) ?? ''
    check('Con un ProRes, «Rápido» no se ofrece y lo explica', disabled && note.includes('ProRes') && (await T('return trim.effectiveMode.value')) === 'exact', note)
    await checkHints('Solo recortar (ProRes)')
    await shot('trim-10-prores.png')
    await app.key('Escape')
    await waitScreen('home')
    check('Esc (sin reproducir) vuelve a Inicio', true)
  } else {
    console.log('      (sin test-output/e2e-prores-pcm.mov: se salta lo del ProRes)')
  }
  await noErrorDialog('final')
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? e.stack ?? e.message : String(e))
  try {
    await app?.screenshot(join(opts.shots, 'trim-zz-fallo.png'))
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
  if (existsSync(outputFolder)) {
    for (const name of readdirSync(outputFolder)) {
      if (filesBefore.has(name) || !/\(recortado\)/.test(name)) continue
      try {
        unlinkSync(join(outputFolder, name))
      } catch (err) {
        console.log(`      no se ha podido borrar ${name}: ${err}`)
      }
    }
  }
  try {
    rmSync(work, { recursive: true, force: true })
  } catch (err) {
    console.log(`      no se ha podido borrar ${work}: ${err}`)
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
process.exit(failed.length ? 1 : 0)
