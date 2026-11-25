// Prueba de humo de la app de escritorio por CDP (depuración remota de WebView2).
// Ejecuta en la página las funciones del bridge con vídeos reales y comprueba los resultados.
//
// 1. Arrancar la app con depuración remota (PowerShell, cada línea por separado):
//      $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=4853 --mute-audio'
//      pnpm tauri dev
// 2. En otra consola (con los clips de test-output/, que genera `pnpm test:ffmpeg`):
//      node scripts/webview-smoke.mjs --big "C:\ruta\a\un vídeo grande.mp4" --hevc "C:\ruta\a\un hevc.mp4"
//
// Requiere Node ≥ 22 (WebSocket global). Sale con código 1 si falla alguna comprobación.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: '4853' },
    media: { type: 'string', default: resolve('test-output') },
    big: { type: 'string' },
    hevc: { type: 'string' },
    'skip-clipboard': { type: 'boolean', default: false },
  },
})

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && /localhost:4850|tauri\.localhost/.test(t.url))
  if (!page) throw new Error(`No hay ninguna página de la app en el puerto ${port}: ${JSON.stringify(list)}`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, ko) => {
    ws.onopen = ok
    ws.onerror = ko
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((ok) => {
      id += 1
      pending.set(id, ok)
      ws.send(JSON.stringify({ id, method, params }))
    })
  /** Evalúa un cuerpo de función async en la página y devuelve su valor (JSON). */
  async function evaluate(body, args = {}) {
    const expression = `(async (args) => { ${body} })(${JSON.stringify(args)})`
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.error) throw new Error(res.error.message)
    if (res.result.exceptionDetails) {
      const ex = res.result.exceptionDetails
      throw new Error(ex.exception?.description ?? ex.text)
    }
    return res.result.result.value
  }
  return { evaluate, close: () => ws.close(), url: page.url }
}

function countFfmpegProcesses() {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq ffmpeg.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  return out.split('\n').filter((l) => l.toLowerCase().includes('ffmpeg.exe')).length
}

const media = {
  horizontal: resolve(opts.media, 'src-horizontal-1080p30.mp4'),
  vertical: resolve(opts.media, 'src-vertical-1080x1920-60.mp4'),
  silence: resolve(opts.media, 'src-silence-middle-720p30.mp4'),
  noAudio: resolve(opts.media, 'src-no-audio-720p30.mp4'),
  rotated: resolve(opts.media, 'src-rotated-90.mp4'),
}
for (const p of Object.values(media)) {
  if (!existsSync(p)) throw new Error(`Falta ${p}: ejecuta pnpm test:ffmpeg`)
}

const page = await connect(opts.port)
console.log(`Conectado a ${page.url}`)
const E = page.evaluate

// Espera a que la página exponga el bridge.
for (let i = 0; i < 50; i++) {
  if (await E('return !!window.__easyCut')) break
  await new Promise((r) => setTimeout(r, 200))
}

// --- probe
{
  const info = await E('return await window.__easyCut.bridge.probe(args.p)', { p: media.rotated })
  check('probe (vídeo girado)', info.width === 720 && info.height === 1280 && info.hasAudio, `${info.width}x${info.height} rot ${info.rotation}`)
  const err = await E('try { await window.__easyCut.bridge.probe(args.p); return "sin error" } catch (e) { return e.name + ": " + e.message }', {
    p: resolve(opts.media, 'no-existe.mp4'),
  })
  check('probe de un fichero inexistente da ProbeError', err.startsWith('ProbeError'), err)
}

// --- exists
{
  const yes = await E('return await window.__easyCut.bridge.exists(args.p)', { p: media.horizontal })
  const no = await E('return await window.__easyCut.bridge.exists(args.p)', { p: media.horizontal + '.borrado' })
  check('exists', yes === true && no === false)
}

// --- miniaturas (y caché)
{
  const body = `
    const t0 = performance.now()
    const thumbs = await window.__easyCut.bridge.thumbnails({ path: args.p, timesMs: [500, 2500, 5000, 7500, 9500], height: 90 }).result
    const ms = performance.now() - t0
    const loaded = await Promise.all(thumbs.map(async (t) => {
      const img = new Image(); img.src = t.url; await img.decode(); return [img.naturalWidth, img.naturalHeight]
    }))
    return { ms, thumbs, loaded }`
  const first = await E(body, { p: media.horizontal })
  const okSizes = first.loaded.every(([w, h]) => w === 160 && h === 90)
  check('miniaturas generadas y cargadas en <img>', first.thumbs.length === 5 && okSizes, `${Math.round(first.ms)} ms, ${JSON.stringify(first.loaded[0])}, ${first.thumbs[0].url}`)
  const second = await E(body, { p: media.horizontal })
  check('miniaturas desde la caché', second.ms < first.ms, `${Math.round(second.ms)} ms`)
  const cancelled = await E(`
    const job = window.__easyCut.bridge.thumbnails({ path: args.p, timesMs: Array.from({length: 30}, (_, i) => 100 + i * 250), height: 72 })
    setTimeout(() => job.cancel(), 50)
    try { await job.result; return 'terminó' } catch (e) { return e.name }`, { p: media.vertical })
  check('miniaturas cancelables', cancelled === 'CancelledError', cancelled)
}

// --- silencios
{
  const s = await E('return await window.__easyCut.bridge.detectSilences(args.p, { startMs: 0, endMs: 12000 }, { minSilenceMs: 500 }).result', {
    p: media.silence,
  })
  const ok = s.length === 1 && Math.abs(s[0].startMs - 4000) < 80 && Math.abs(s[0].endMs - 7000) < 80
  check('detectSilences', ok, JSON.stringify(s))
  const partial = await E('return await window.__easyCut.bridge.detectSilences(args.p, { startMs: 2000, endMs: 10000 }).result', { p: media.silence })
  check('detectSilences en un rango', partial.length === 1 && Math.abs(partial[0].startMs - 4000) < 80, JSON.stringify(partial))
  const none = await E('return await window.__easyCut.bridge.detectSilences(args.p, { startMs: 0, endMs: 6000 }).result', { p: media.noAudio })
  check('detectSilences sin pista de audio', Array.isArray(none) && none.length === 0)
}

// --- encoders
{
  const r = await E('const t0 = performance.now(); const r = await window.__easyCut.bridge.probeEncoders(); return { r, ms: performance.now() - t0 }')
  const again = await E('const t0 = performance.now(); await window.__easyCut.bridge.probeEncoders(); return performance.now() - t0')
  check('probeEncoders', r.r.libx264 === true, `${JSON.stringify(r.r)} en ${Math.round(r.ms)} ms; segunda vez ${Math.round(again)} ms`)
}

// --- vídeo: reproducción y seek con el protocolo asset
const videoBody = `
  const v = document.createElement('video')
  v.muted = true; v.preload = 'auto'
  document.body.appendChild(v)
  const once = (ev) => new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('timeout ' + ev)), 20000)
    v.addEventListener(ev, () => { clearTimeout(t); ok() }, { once: true })
    v.addEventListener('error', () => { clearTimeout(t); ko(new Error('video.error ' + (v.error && v.error.code) + ' ' + (v.error && v.error.message))) }, { once: true })
  })
  try {
    v.src = window.__easyCut.bridge.mediaUrl(args.p)
    await once('loadedmetadata')
    const out = { duration: v.duration, w: v.videoWidth, h: v.videoHeight, seeks: [] }
    for (const f of args.fractions) {
      const target = v.duration * f
      const t0 = performance.now()
      v.currentTime = target
      await once('seeked')
      out.seeks.push({ target, got: v.currentTime, ms: Math.round(performance.now() - t0), readyState: v.readyState })
    }
    await v.play(); await new Promise((r) => setTimeout(r, 700)); out.playedTo = v.currentTime; v.pause()
    return out
  } catch (e) { return { error: String(e.message || e) } }
  finally { v.removeAttribute('src'); v.load(); v.remove() }`

async function checkVideo(name, path, expectSeconds) {
  const r = await E(videoBody, { p: path, fractions: [0.9, 0.25, 0.75, 0.05] })
  if (r.error) return check(name, false, r.error)
  const seeksOk = r.seeks.every((s) => Math.abs(s.got - s.target) < 0.5 && s.readyState >= 1)
  const durOk = expectSeconds === undefined || Math.abs(r.duration - expectSeconds) < 0.5
  check(name, seeksOk && durOk && r.w > 0, `duración ${r.duration.toFixed(2)} s, ${r.w}x${r.h}, seeks ${r.seeks.map((s) => `${s.got.toFixed(1)}s/${s.ms}ms`).join(' ')}, reproducido hasta ${r.playedTo?.toFixed(2)}`)
  return r
}

await checkVideo('<video> con mediaUrl: carga y seek (clip corto)', media.horizontal, 10)
if (opts.big) {
  await checkVideo('<video> con mediaUrl: seek en vídeo grande (ruta con espacios y tildes)', opts.big)
  const range = await E(`
    const url = window.__easyCut.bridge.mediaUrl(args.p)
    const res = await fetch(url, { headers: { Range: 'bytes=500000000-500000999' } })
    const buf = await res.arrayBuffer()
    return { status: res.status, len: buf.byteLength, contentRange: res.headers.get('content-range') }`, { p: opts.big })
  check('range request al protocolo asset', range.status === 206 && range.len === 1000, JSON.stringify(range))
}

// --- proxy de vista previa
{
  const target = opts.hevc ?? media.vertical
  const original = await E(videoBody, { p: target, fractions: [0.5] })
  console.log(`      original ${target}: ${original.error ?? `se reproduce (${original.w}x${original.h})`}`)
  const p = await E(`
    const t0 = performance.now(); let updates = 0
    const path = await window.__easyCut.bridge.makePreviewProxy(args.p, () => updates++).result
    return { path, ms: performance.now() - t0, updates }`, { p: target })
  const srcInfo = await E('return await window.__easyCut.bridge.probe(args.p)', { p: target })
  const proxyInfo = await E('return await window.__easyCut.bridge.probe(args.p)', { p: p.path })
  const shortSide = Math.min(proxyInfo.width, proxyInfo.height)
  check(
    'makePreviewProxy genera H.264 540p con la misma duración',
    proxyInfo.videoCodec === 'h264' && shortSide === 540 && Math.abs(proxyInfo.durationMs - srcInfo.durationMs) < 100 && (srcInfo.hasAudio ? proxyInfo.audioCodec === 'aac' : true),
    `${proxyInfo.width}x${proxyInfo.height} ${proxyInfo.fps} fps ${proxyInfo.durationMs} ms (original ${srcInfo.durationMs} ms), ${Math.round(p.ms)} ms, ${p.updates} avisos de progreso`,
  )
  await checkVideo('<video> reproduce el proxy con seek', p.path, srcInfo.durationMs / 1000)
  const cached = await E('const t0 = performance.now(); await window.__easyCut.bridge.makePreviewProxy(args.p).result; return performance.now() - t0', { p: target })
  check('proxy desde la caché', cached < 1000, `${Math.round(cached)} ms`)
}

// --- exportación de un clip, progreso y comprobación con ffprobe
const exportBody = `
  const { bridge, domain } = window.__easyCut
  const media = await bridge.probe(args.p)
  let project = domain.createProject('16:9')
  project = domain.addClip(project, domain.createClip(media))
  const encoder = domain.chooseEncoder(await bridge.probeEncoders())
  const folder = await bridge.getOutputFolder()
  const name = domain.buildOutputFileName(new Date(), args.preset, await bridge.listFileNames(folder))
  const out = bridge.joinPath(folder, name)
  const cmd = domain.buildExportCommand(project, new Map([[media.path, media]]), args.preset, encoder, out)
  const parser = domain.createProgressParser(cmd.expectedDurationMs, Date.now())
  let last = null, updates = 0
  const job = bridge.runFfmpeg(cmd.args, (line) => { for (const u of parser.push(line + '\\n', Date.now())) { last = u; updates++ } })
  if (args.cancelAfterMs) setTimeout(() => job.cancel(), args.cancelAfterMs)
  try {
    const res = await job.result
    const info = res.exitCode === 0 ? await bridge.probe(out) : null
    return { out, encoder, exitCode: res.exitCode, updates, done: last && last.done, info, expected: cmd.expectedDurationMs, spec: cmd.spec, stderr: res.stderr.slice(-300) }
  } catch (e) { return { out, error: e.name, exists: await bridge.exists(out) } }`

let exported = null
{
  const r = await E(exportBody, { p: media.vertical, preset: 'whatsapp' })
  const ok =
    r.exitCode === 0 &&
    r.done === true &&
    r.info.width === r.spec.width &&
    r.info.height === r.spec.height &&
    Math.abs(r.info.durationMs - r.expected) < 60
  check('exportación de un clip con progreso', ok, `${r.encoder} → ${r.out} ${r.info?.width}x${r.info?.height} ${r.info?.durationMs} ms (esperado ${r.expected}), ${r.updates} avisos ${r.stderr ?? ''}`)
  exported = r.out
}

if (opts.big) {
  const before = countFfmpegProcesses()
  const r = await E(exportBody, { p: opts.big, preset: 'high', cancelAfterMs: 1500 })
  await new Promise((ok) => setTimeout(ok, 1000))
  const after = countFfmpegProcesses()
  check('cancelar una exportación mata ffmpeg', r.error === 'CancelledError' && after <= before, `${r.error}; ffmpeg antes ${before}, después ${after}`)
  if (r.out && (await E('return await window.__easyCut.bridge.exists(args.p)', { p: r.out }))) {
    console.log(`      (queda el fichero a medias ${r.out}: la UI deberá borrarlo; el bridge no borra en la carpeta del usuario)`)
  }
}

// --- autoguardado
{
  const r = await E(`
    const b = window.__easyCut.bridge
    await b.saveAutosave(JSON.stringify({ prueba: 'ñandú', n: 1 }))
    const loaded = await b.loadAutosave()
    await b.clearAutosave()
    return { loaded, after: await b.loadAutosave() }`)
  check('autoguardado: guardar, leer y borrar', r.loaded === JSON.stringify({ prueba: 'ñandú', n: 1 }) && r.after === null)
}

// --- carpetas
{
  const r = await E(`
    const b = window.__easyCut.bridge
    const folder = await b.getOutputFolder()
    return { folder, names: (await b.listFileNames(folder)).length, temp: await b.writeTempTextFile('filtro.txt', '[0:v]null[v]') }`)
  check('getOutputFolder / listFileNames / writeTempTextFile', /Mis montajes$/.test(r.folder) && r.temp.endsWith('filtro.txt'), JSON.stringify(r))
}

// --- portapapeles (CF_HDROP)
if (exported && !opts['skip-clipboard']) {
  await E('await window.__easyCut.bridge.copyFileToClipboard(args.p); return true', { p: exported })
  const got = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }) -join "|"'],
    { encoding: 'utf8' },
  ).trim()
  check('copyFileToClipboard deja el fichero en el portapapeles', got === exported, got)
}

// --- grabación: MediaRecorder (lienzo + oscilador, sin depender de una cámara) → saveRecording
{
  const r = await E(`
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
    const ctx = canvas.getContext('2d')
    let frame = 0
    const timer = setInterval(() => { ctx.fillStyle = 'hsl(' + (frame++ * 7 % 360) + ',70%,50%)'; ctx.fillRect(0, 0, 640, 360) }, 33)
    const audio = new AudioContext(); const osc = audio.createOscillator(); const dest = audio.createMediaStreamDestination()
    osc.connect(dest); osc.start()
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()])
    const rec = new MediaRecorder(stream); const chunks = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const stopped = new Promise((ok) => (rec.onstop = ok))
    rec.start(500); await new Promise((ok) => setTimeout(ok, 3000)); rec.stop(); await stopped
    clearInterval(timer); osc.stop(); await audio.close()
    const blob = new Blob(chunks, { type: rec.mimeType })
    const saved = await window.__easyCut.bridge.saveRecording(blob, 'Prueba: grabación.webm')
    const info = await window.__easyCut.bridge.probe(saved.path)
    return { mime: rec.mimeType, size: blob.size, saved, info }`)
  check(
    'saveRecording: WebM → MP4 H.264 + AAC con duración',
    r.saved.path.includes('\\Grabaciones\\') && r.saved.path.endsWith('.mp4') && r.info.videoCodec === 'h264' && r.info.audioCodec === 'aac' && r.saved.durationMs > 2000 && r.info.fps === 30,
    `${r.mime} ${r.size} B → ${r.saved.path} (${r.saved.durationMs} ms, ${r.info.fps} fps)`,
  )
}

// --- cámara y micrófono sin diálogo
{
  const r = await E(`
    const devices = await navigator.mediaDevices.enumerateDevices()
    const kinds = devices.map((d) => d.kind)
    const want = { video: kinds.includes('videoinput'), audio: kinds.includes('audioinput') }
    if (!want.video && !want.audio) return { devices: kinds, skipped: true }
    const t0 = performance.now()
    try {
      const s = await Promise.race([
        navigator.mediaDevices.getUserMedia(want),
        new Promise((_, ko) => setTimeout(() => ko(new Error('sin respuesta en 8 s (¿diálogo de permiso?)')), 8000)),
      ])
      const tracks = s.getTracks().map((t) => t.kind + ':' + t.readyState)
      s.getTracks().forEach((t) => t.stop())
      return { devices: kinds, tracks, ms: performance.now() - t0 }
    } catch (e) { return { devices: kinds, error: e.name + ': ' + e.message } }`)
  if (r.skipped) check('getUserMedia (no hay cámara ni micrófono en este PC: NO comprobado)', true, JSON.stringify(r.devices))
  else check('getUserMedia concedido sin diálogo', !r.error && r.tracks.length > 0, JSON.stringify(r))
}

page.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
process.exit(failed.length ? 1 : 0)
