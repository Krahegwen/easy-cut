// Medida: lo que cuesta la pestaña «Efectos» de la biblioteca (las vistas previas de 480×270 de las tarjetas)
// mientras el vídeo se reproduce en la vista previa. En la app Tauri real por CDP, con la biblioteca cerrada,
// con la pestaña «Efectos» abierta («Todo») y con el ratón encima de la primera tarjeta, sin y con Emulation.setCPUThrottlingRate (×4 por defecto, para
// parecerse a un PC modesto; ojo: solo frena el hilo principal del renderer, no la GPU ni la decodificación).
//
// Por cada caso, `--runs` veces (3) y en orden alterno: CPU de los procesos de WebView2 (renderer, GPU y
// navegador, por SystemInfo.getProcessInfo: % de un núcleo), ocupación del hilo principal (Performance.getMetrics,
// TaskDuration), fotogramas pintados por segundo (requestAnimationFrame), fotogramas perdidos del vídeo de la vista
// previa (getVideoPlaybackQuality) y uso de la GPU de los procesos de WebView2 (contadores de Windows
// «\GPU Engine(*)\Utilization Percentage», 3D y decodificación de vídeo). Da la mediana y el rango (mín–máx).
//
// PowerShell (con la app cerrada, cargo en el PATH, los ficheros de `pnpm test:ffmpeg` y la biblioteca generada):
//   node scripts/library-perf.mjs
// Opciones: --runs 3 --seconds 6 --throttle 4 --json test-output/library-perf.json --no-launch
// Escribe el resultado en JSON (por defecto test-output/library-perf.json). Sale con 1 si no ha podido medir.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { appTestEnv, APP_LAUNCH_OPTIONS, connectToApp, sleep } from './cdp.mjs'

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: '4853' },
    media: { type: 'string', default: resolve('test-output') },
    runs: { type: 'string', default: '3' },
    seconds: { type: 'string', default: '6' },
    throttle: { type: 'string', default: '4' },
    json: { type: 'string', default: resolve('test-output', 'library-perf.json') },
    label: { type: 'string', default: '' },
    'no-launch': { type: 'boolean', default: false },
    ...APP_LAUNCH_OPTIONS,
  },
})
const port = Number(opts.port)
const runs = Number(opts.runs)
const seconds = Number(opts.seconds)
const throttles = [1, Number(opts.throttle)]
const launch = !opts['no-launch']
const horizontal = resolve(opts.media, 'src-horizontal-1080p30.mp4')
if (!existsSync(horizontal)) throw new Error(`Falta ${horizontal}: ejecuta pnpm test:ffmpeg`)

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
  const env = { ...process.env, ...appTestEnv(port, { withSound: opts['with-sound'], foreground: opts.foreground }), PATH: `${join(homedir(), '.cargo', 'bin')};${process.env.PATH}` }
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
  for (let i = 0; i < 40 && (await cdpReachable()); i++) await sleep(250)
}

/** Conexión CDP al navegador (no a la página): para SystemInfo.getProcessInfo. */
async function connectBrowser() {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(webSocketDebuggerUrl)
  await new Promise((ok, ko) => {
    ws.onopen = ok
    ws.onerror = ko
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((ok, ko) => {
      id += 1
      pending.set(id, (m) => (m.error ? ko(new Error(`${method}: ${m.error.message}`)) : ok(m.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { send, close: () => ws.close() }
}

/** Uso medio de la GPU (por tipo de motor) de unos procesos, con los contadores de Windows, durante `n` segundos. */
function sampleGpu(pids, n) {
  const pattern = pids.map((p) => `pid_${p}_`).join('|')
  const script = [
    `$samples = Get-Counter -Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples ${n}`,
    `$out = foreach ($s in $samples) { $m = @{}; foreach ($c in $s.CounterSamples) { if ($c.InstanceName -match '${pattern}') { $t = ($c.InstanceName -split 'engtype_')[1]; $m[$t] = [double]($m[$t]) + $c.CookedValue } }; $m }`,
    '$out | ConvertTo-Json -Compress',
  ].join('; ')
  return new Promise((ok) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    let text = ''
    child.stdout.on('data', (d) => (text += d))
    child.on('close', () => {
      try {
        const parsed = JSON.parse(text.trim() || '[]')
        const list = Array.isArray(parsed) ? parsed : [parsed]
        const avg = (k) => list.reduce((s, m) => s + (Number(m?.[k]) || 0), 0) / Math.max(1, list.length)
        ok({ gpu3d: avg('3d'), gpuDecode: avg('videodecode'), samples: list.length })
      } catch {
        ok({ gpu3d: null, gpuDecode: null, samples: 0 })
      }
    })
  })
}

/** Casos: biblioteca cerrada, pestaña «Efectos» abierta y lo mismo con el ratón sobre la primera tarjeta. */
const STATES = ['cerrada', 'efectos', 'raton', 'todas']
const STATE_NAMES = { cerrada: 'cerrada', efectos: 'Efectos abierta', raton: 'Efectos, ratón encima de una', todas: 'Efectos, todas moviéndose' }

const median = (xs) => {
  const s = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b)
  if (!s.length) return null
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

// ------------------------------------------------------------------ medir

let app
let browser
const S = (expr, args = {}) => app.evaluate(`const store = window.__easyCut.store; const tracks = window.__easyCut.tracks; ${expr}`, args)

async function waitScreen(testid, timeoutMs = 30_000) {
  await app.waitFor(`return !!document.querySelector('[data-testid=${testid}]')`, { timeoutMs, what: `pantalla ${testid}` })
  await sleep(200)
}

async function setState(state) {
  const open = await app.evaluate('return !!document.querySelector("[data-testid=library-panel]")')
  if (state === 'cerrada') {
    if (open) await S('tracks.closeLibrary(); return true')
  } else {
    if (!open) await app.click('[data-testid=add-sounds-effects]')
    await waitScreen('library-panel')
    await app.click('[data-testid=library-tab-effects]')
    await app.waitFor('return [...document.querySelectorAll("[data-testid=library-asset] .preview video, [data-testid=library-asset] .preview img")].length >= 4', { timeoutMs: 30_000, what: 'vistas previas' })
  }
  await app.evaluate('document.activeElement?.blur(); return true')
  // Con el ratón encima de la primera tarjeta con vídeo (si las tarjetas solo se mueven al pasar el ratón).
  const pos = state === 'raton' ? await app.evaluate('const v = document.querySelector("[data-testid=library-asset] .preview video")?.closest(".preview"); if (!v) return null; v.scrollIntoView({ block: "nearest" }); const r = v.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }') : { x: 5, y: 5 }
  if (pos) await app.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none' })
  // Todas moviéndose a la vez (como antes de que se quedaran quietas), a mano, para compararlo en el mismo código;
  // en los demás casos, las que no tienen el ratón encima, quietas (por si venían de «todas»).
  if (state === 'todas') await app.evaluate('for (const v of document.querySelectorAll("[data-testid=library-asset] .preview video")) { v.loop = true; v.style.display = ""; void v.play() } for (const c of document.querySelectorAll("[data-testid=library-poster]")) c.style.display = "none"; return true')
  else await app.evaluate('for (const card of document.querySelectorAll("[data-testid=library-asset][data-moving=\'0\']")) { const v = card.querySelector(".preview video"); const c = card.querySelector(".preview canvas"); if (v) { v.pause(); if (c) { v.style.display = "none"; c.style.display = "" } } } return true')
  await sleep(1500)
}

async function processCpu() {
  const { processInfo } = await browser.send('SystemInfo.getProcessInfo')
  const by = {}
  for (const p of processInfo) by[p.type] = (by[p.type] ?? 0) + p.cpuTime
  return { by, pids: processInfo.map((p) => p.id) }
}

async function metrics() {
  const { metrics: list } = await app.send('Performance.getMetrics')
  return Object.fromEntries(list.map((m) => [m.name, m.value]))
}

async function videoQuality() {
  return app.evaluate(`let dropped = 0, total = 0;
    for (const v of document.querySelectorAll('[data-testid=preview-frame] > video.video:not(.cover)')) { const q = v.getVideoPlaybackQuality(); dropped += q.droppedVideoFrames; total += q.totalVideoFrames }
    const cards = [...document.querySelectorAll('[data-testid=library-asset] .preview video')];
    return { dropped, total, cardVideos: cards.length, cardPlaying: cards.filter((v) => !v.paused).length }`)
}

async function measureOnce(state, throttle) {
  await app.key('Home')
  await sleep(300)
  await app.key(' ')
  await app.waitFor('return document.querySelector("[data-testid=player]").dataset.playing === "1"', { timeoutMs: 15_000, what: 'reproduciendo' })
  await sleep(800)
  const { pids } = await processCpu()
  const gpu = sampleGpu(pids, seconds)
  await app.evaluate('window.__perfFrames = 0; const tick = () => { window.__perfFrames++; window.__perfRaf = requestAnimationFrame(tick) }; window.__perfRaf = requestAnimationFrame(tick); return true')
  const t0 = Date.now()
  const c0 = await processCpu()
  const m0 = await metrics()
  const q0 = await videoQuality()
  await sleep(seconds * 1000)
  const c1 = await processCpu()
  const m1 = await metrics()
  const q1 = await videoQuality()
  const frames = await app.evaluate('cancelAnimationFrame(window.__perfRaf); return window.__perfFrames')
  const wall = (Date.now() - t0) / 1000
  const g = await gpu
  const playing = await app.evaluate('return document.querySelector("[data-testid=player]").dataset.playing === "1"')
  await app.key(' ')
  const pct = (k) => (((c1.by[k] ?? 0) - (c0.by[k] ?? 0)) / wall) * 100
  return {
    state,
    throttle,
    playing,
    renderer: pct('renderer'),
    gpuProcess: pct('GPU'),
    browser: pct('browser'),
    mainThread: ((m1.TaskDuration - m0.TaskDuration) / wall) * 100,
    fps: frames / wall,
    dropped: q1.dropped - q0.dropped,
    decoded: q1.total - q0.total,
    gpu3d: g.gpu3d,
    gpuDecode: g.gpuDecode,
    cardVideos: q1.cardVideos,
    cardPlaying: q1.cardPlaying,
  }
}

const rows = []
let ok = false
try {
  await startApp()
  app = await connectToApp(port, { timeoutMs: 240_000 })
  await app.waitFor('return !!window.__easyCut?.store', { timeoutMs: 60_000, what: 'store de la app (modo desarrollo)' })
  await app.evaluate('await window.__easyCut.resetProjects(); location.reload(); return true')
  await sleep(1500)
  app.close()
  app = await connectToApp(port)
  await app.waitFor('return !!window.__easyCut?.store')
  await app.setViewport(1280, 800)
  await waitScreen('new-video')
  await app.click('[data-testid=new-video]')
  await waitScreen('pick-videos')
  await app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: [horizontal, horizontal, horizontal] })
  await app.click('[data-testid=pick-videos]')
  await waitScreen('editor')
  await app.waitFor('return !document.querySelector("[data-testid=preparing]") && window.__easyCut.store.project.value.clips.length === 3', { timeoutMs: 30_000 })
  await app.send('Performance.enable')
  browser = await connectBrowser()
  for (const throttle of throttles) {
    await app.send('Emulation.setCPUThrottlingRate', { rate: throttle })
    for (let r = 0; r < runs; r++) {
      for (const state of r % 2 ? [...STATES].reverse() : STATES) {
        await setState(state)
        const row = await measureOnce(state, throttle)
        rows.push(row)
        console.log(`×${throttle} ${state.padEnd(8)} renderer ${row.renderer.toFixed(1)} % · GPU (proceso) ${row.gpuProcess.toFixed(1)} % · hilo principal ${row.mainThread.toFixed(1)} % · ${row.fps.toFixed(1)} fps · perdidos ${row.dropped}/${row.decoded} · GPU 3D ${row.gpu3d?.toFixed(1) ?? '—'} % · decodificar ${row.gpuDecode?.toFixed(1) ?? '—'} % · tarjetas ${row.cardPlaying}/${row.cardVideos} moviéndose`)
      }
    }
  }
  await app.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  ok = true
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
} finally {
  browser?.close()
  app?.close()
  await stopApp()
}

const keys = ['renderer', 'gpuProcess', 'browser', 'mainThread', 'fps', 'dropped', 'gpu3d', 'gpuDecode', 'cardPlaying']
const summary = []
for (const throttle of throttles) {
  for (const state of STATES) {
    const sel = rows.filter((r) => r.throttle === throttle && r.state === state)
    if (!sel.length) continue
    const s = { throttle, state, n: sel.length }
    for (const k of keys) {
      const xs = sel.map((r) => r[k]).filter((x) => x !== null)
      s[k] = { median: median(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null }
    }
    summary.push(s)
  }
}
const f = (v, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d))
console.log(`\nMediana (mín–máx) de ${runs} medidas de ${seconds} s${opts.label ? ` — ${opts.label}` : ''}:`)
console.log('| CPU | Biblioteca | Renderer % | GPU (proceso) % | Hilo principal % | fps | Perdidos | GPU 3D % | GPU decodificar % | Tarjetas moviéndose |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const s of summary) {
  const c = (k, d) => `${f(s[k].median, d)} (${f(s[k].min, d)}–${f(s[k].max, d)})`
  console.log(`| ×${s.throttle} | ${STATE_NAMES[s.state]} | ${c('renderer')} | ${c('gpuProcess')} | ${c('mainThread')} | ${c('fps')} | ${c('dropped', 0)} | ${c('gpu3d')} | ${c('gpuDecode')} | ${c('cardPlaying', 0)} |`)
}
writeFileSync(opts.json, `${JSON.stringify({ label: opts.label, runs, seconds, rows, summary }, null, 1)}\n`)
console.log(`\nResultado en ${opts.json}`)
process.exit(ok ? 0 : 1)
