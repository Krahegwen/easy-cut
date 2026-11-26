// Prueba de extremo a extremo de «aparecer, desaparecer y movimiento», en la app Tauri real por CDP y con los
// botones y las teclas de verdad (en el modo de pruebas: sin sonido y sin quitar el foco):
//
// - Aparecer y desaparecer: elegir forma y duración en un sonido, un efecto y un trozo con el desplegable
//   «Aparecer» (dibujito de cada curva y tres duraciones), y medir en la vista previa (parada, en instantes de la
//   curva) el volumen del <audio>, la transparencia del efecto y la capa negra y el volumen del trozo frente al
//   mismo cálculo del dominio; guardar «Para WhatsApp» y medir en el fichero el brillo y el sonido del trozo.
// - Movimiento («Tamaño y sitio» con marcas) y la esquina: ver más abajo (secciones B y C).
//
// Capturas motion-*.png a 1280×800 y 1100×700 en test-output/screenshots/.
//
// PowerShell (con Rust/cargo en el PATH, la app cerrada, los ficheros de `pnpm test:ffmpeg` en test-output y
// la biblioteca generada con `node scripts/build-library.mjs`):
//   node scripts/motion-e2e.mjs
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

const media = {
  horizontal: resolve(opts.media, 'src-horizontal-1080p30.mp4'),
  coverLong: resolve(opts.media, 'src-cover-long-25fps.mp4'),
}
for (const p of Object.values(media)) if (!existsSync(p)) throw new Error(`Falta ${p}: ejecuta pnpm test:ffmpeg`)
if (!existsSync(resolve('library', 'dist', 'pegatina-estrella.png'))) throw new Error('Falta la biblioteca local: ejecuta node scripts/build-library.mjs')

// Ficheros «del ordenador»: un trozo gris con un tono (para medir su brillo y su sonido), un sonido y un efecto.
const own = resolve(opts.media, 'motion-e2e')
mkdirSync(own, { recursive: true })
const grey = join(own, 'Trozo gris con tono.mp4')
const tone = join(own, 'Tono de prueba.m4a')
const square = join(own, 'Cuadrado rojo.png')
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
if (!existsSync(grey)) ff(['-f', 'lavfi', '-i', 'color=c=0xc8c8c8:size=1920x1080:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=10', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest', grey])
if (!existsSync(tone)) ff(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=6', '-c:a', 'aac', '-b:a', '192k', tone])
if (!existsSync(square)) ff(['-f', 'lavfi', '-i', 'color=c=red:size=200x200', '-frames:v', '1', square])

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
  app.evaluate(`const store = window.__easyCut.store; const tracks = window.__easyCut.tracks; const library = window.__easyCut.library; const domain = window.__easyCut.domain; ${expr}`, args)
const queuePick = (paths) => app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: paths })
const items = () =>
  S(`const p = store.project.value; return domain.resolveTracks(p).map((r) => ({ id: r.item.id, kind: r.track.kind, track: r.track.id, start: r.startMs, end: r.shownEndMs, item: r.item }))`)
const pxPerSec = () => app.evaluate('return Number(document.querySelector("[data-testid=tracks-view]")?.dataset.pxPerSec ?? 0)')
const playerMs = () => app.evaluate('return Number(document.querySelector("[data-testid=player]").dataset.currentMs)')

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

/** La barra del elemento elegido (o la del trozo) va en una sola línea y no se sale. */
async function barInOneLine(selector, where) {
  const r = await app.evaluate(`const bar = document.querySelector(args.s); if (!bar) return null; const b = bar.getBoundingClientRect();
    const kids = [...bar.querySelectorAll(':scope > *')].filter((k) => k.getBoundingClientRect().width > 0).map((k) => k.getBoundingClientRect());
    const tops = new Set(kids.map((k) => Math.round(k.top + k.height / 2)));
    return { height: Math.round(b.height), rows: Math.max(...kids.map((k) => k.bottom)) - Math.min(...kids.map((k) => k.top)), overflow: kids.some((k) => k.right > innerWidth + 1 || k.left < -1), centers: [...tops].length }`, { s: selector })
  check(`La barra va en una sola línea y cabe (${where})`, !!r && r.height <= 60 && !r.overflow, JSON.stringify(r))
}

function ffprobe(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,duration', '-of', 'json', path], { encoding: 'utf8' }))
}
/** Color medio de un cuadrado de 16 px en (fx, fy) (fracciones del marco) del fotograma de `sec`. */
function color(path, sec, fx, fy) {
  const v = ffprobe(path).streams.find((s) => s.codec_type === 'video')
  const x = Math.round(fx * v.width) - 8
  const y = Math.round(fy * v.height) - 8
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', sec.toFixed(3), '-i', path, '-frames:v', '1', '-vf', `crop=16:16:${x}:${y},scale=1:1:flags=area,format=rgb24`, '-f', 'rawvideo', '-'])
  return [...buf.subarray(0, 3)]
}
/** Amplitud RMS (lineal) del tono de `hz` en [fromMs, toMs). */
function toneRms(path, hz, fromMs, toMs) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vn', '-af', `bandpass=f=${hz}:width_type=h:width=60,aformat=sample_fmts=flt:channel_layouts=mono`, '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 512 * 1024 * 1024 })
  const s = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  const a = Math.round(fromMs * 48)
  const b = Math.min(s.length, Math.round(toMs * 48))
  let sum = 0
  for (let i = a; i < b; i++) sum += s[i] * s[i]
  return Math.sqrt(sum / Math.max(1, b - a))
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

  // --- Montaje: el trozo gris con tono (10 s) y un vídeo horizontal (10 s); un sonido y un efecto en las pistas.
  await app.click('[data-testid=new-video]')
  await waitScreen('pick-videos')
  await queuePick([grey, media.horizontal])
  await app.click('[data-testid=pick-videos]')
  await waitScreen('editor', 30_000)
  await app.waitFor('return !document.querySelector("[data-testid=preparing]") && window.__easyCut.store.project.value.clips.length === 2', { timeoutMs: 30_000 })
  const placed = await S(
    `const a = await tracks.addFiles([args.tone], 12000);
     const b = await tracks.addFiles([args.square], 13000);
     tracks.select(null);
     return { added: a + b }`,
    { tone, square },
  )
  await noErrorDialog('poner en las pistas')
  const list = await items()
  const soundId = list.find((i) => i.kind === 'sound').id
  const fxId = list.find((i) => i.kind === 'effect').id
  check('Montaje: dos trozos, un sonido a los 12 s y un efecto a los 13 s', placed.added === 2 && !!soundId && !!fxId, JSON.stringify(list.map((i) => `${i.kind} ${i.start}–${i.end}`)))

  // ============================================================ A. Aparecer y desaparecer

  // --- Un sonido: «Empieza despacio», larga (2 s), y al desaparecer «Suave», corta (0,5 s).
  {
    await selectItem(soundId)
    await app.click('[data-testid=item-fades]')
    await app.waitFor('return !!document.querySelector("[data-testid=fades-popover]")', { timeoutMs: 3000, what: 'desplegable de aparecer' })
    const disabled = await app.evaluate('return document.querySelector("[data-testid=fade-in-len-medium]").disabled')
    check('Estando «De golpe», las duraciones no se pueden elegir', disabled === true)
    await app.click('[data-testid=fade-in-ease-in]')
    await app.click('[data-testid=fade-in-len-long]')
    await app.click('[data-testid=fade-out-smooth]')
    await app.click('[data-testid=fade-out-len-short]')
    const it = (await items()).find((i) => i.id === soundId).item
    check('Sonido: aparece «Empieza despacio» en 2 s y desaparece «Suave» en 0,5 s', it.fadeInMs === 2000 && it.fadeInEasing === 'ease-in' && it.fadeOutMs === 500 && it.fadeOutEasing === 'smooth', JSON.stringify([it.fadeInMs, it.fadeInEasing, it.fadeOutMs, it.fadeOutEasing]))
    const drawn = await app.evaluate('return [...document.querySelectorAll("[data-testid=fades-popover] .shape")].map((b) => ({ curve: !!b.querySelector("svg.curve path"), on: b.classList.contains("on"), t: b.querySelector("strong").textContent }))')
    check('Cada forma lleva su dibujito y su nombre llano; están marcadas las elegidas', drawn.length === 10 && drawn.every((d) => d.curve) && drawn.filter((d) => d.on).map((d) => d.t).join('|') === 'Empieza despacio|Suave', drawn.map((d) => d.t).join(', '))
    const lengths = await app.evaluate('return [...document.querySelectorAll("[data-testid=fade-in] .length")].map((b) => b.textContent.replace(/\\s+/g, " ").trim())')
    check('Tres duraciones que dicen los segundos', lengths.join(' | ') === 'Corta 0,5 s | Media 1 s | Larga 2 s', lengths.join(' | '))
    await shot('motion-01-aparecer-sonido.png')
    await app.key('Escape')
    check('Esc cierra el desplegable (y no deja de elegir el sonido)', !(await app.evaluate('return !!document.querySelector("[data-testid=fades-popover]")')) && (await S('return tracks.selectedItemId.value')) === soundId)
    // En la vista previa, parada: el volumen del <audio> en tres instantes de la entrada, frente al dominio.
    const rows = []
    let ok = true
    for (const local of [500, 1000, 1500]) {
      await seekTo(12_000 + local)
      const got = await app.waitFor(`const a = document.querySelector('[data-testid=track-sound][data-item-id="${soundId}"]'); return a && a.readyState >= 1 ? a.volume : null`, { timeoutMs: 5000, what: 'audio del sonido' })
      const at = await playerMs()
      const want = await S('const r = domain.resolveTracks(store.project.value).find((x) => x.item.id === args.id); return r.item.volume * domain.fadeGainAt(r.item, args.t - r.startMs, r.shownEndMs - r.startMs)', { id: soundId, t: at })
      rows.push(`${at - 12_000} ms: ${got.toFixed(3)} / ${want.toFixed(3)}`)
      if (Math.abs(got - want) > 0.01) ok = false
    }
    check('Vista previa: el volumen sigue la curva elegida (como al guardar)', ok, rows.join(' · '))
  }

  // --- Un efecto: aparece «Acaba despacio» media (1 s).
  {
    await selectItem(fxId)
    await app.click('[data-testid=item-fades]')
    await app.click('[data-testid=fade-in-ease-out]')
    const it = (await items()).find((i) => i.id === fxId).item
    check('Efecto: al elegir una forma, entra con la duración del medio (1 s)', it.fadeInMs === 1000 && it.fadeInEasing === 'ease-out', `${it.fadeInMs} ${it.fadeInEasing}`)
    const text = await app.text('[data-testid=fade-in] .what')
    check('Y dice qué le pasa a un efecto («Se va haciendo visible»)', text.includes('visible'), text)
    await app.key('Escape')
    await seekTo(13_500)
    const at = await playerMs()
    const got = await app.waitFor(`const e = document.querySelector('[data-testid=track-effect][data-item-id="${fxId}"]'); return e && e.complete ? Number(getComputedStyle(e).opacity) : null`, { timeoutMs: 5000, what: 'efecto en la vista previa' })
    const want = await S('const r = domain.resolveTracks(store.project.value).find((x) => x.item.id === args.id); return r.item.look.opacity * domain.fadeGainAt(r.item, args.t - r.startMs, r.shownEndMs - r.startMs)', { id: fxId, t: at })
    check('Vista previa: la transparencia del efecto sigue la curva', Math.abs(got - want) < 0.01, `a los ${at - 13_000} ms: ${got.toFixed(3)} / ${want.toFixed(3)}`)
    await app.key('Escape')
  }

  // --- Un trozo: aparece «Suave» larga (2 s) desde negro y desaparece «Acaba despacio» media (1 s).
  {
    const c = await app.center('[data-testid=clip-block-1]')
    await app.clickAt(c.x, c.y)
    await sleep(300)
    await app.click('[data-testid=clip-fades]')
    await app.waitFor('return !!document.querySelector("[data-testid=clip-fades-popover]")', { timeoutMs: 3000, what: 'desplegable del trozo' })
    await app.click('[data-testid=fade-in-smooth]')
    await app.click('[data-testid=fade-in-len-long]')
    await app.click('[data-testid=fade-out-ease-out]')
    const clip = await S('return store.project.value.clips[0]')
    check('Trozo: aparece «Suave» en 2 s y desaparece «Acaba despacio» en 1 s', clip.fadeInMs === 2000 && clip.fadeInEasing === 'smooth' && clip.fadeOutMs === 1000 && clip.fadeOutEasing === 'ease-out', JSON.stringify([clip.fadeInMs, clip.fadeInEasing, clip.fadeOutMs, clip.fadeOutEasing]))
    const what = await app.text('[data-testid=clip-fades-popover] [data-testid=fade-in] .what')
    check('Y dice que la imagen sale del negro y el sonido del silencio', what.includes('negro') && what.includes('silencio'), what)
    await shot('motion-02-aparecer-trozo.png')
    await app.key('Escape')
    const badges = await app.evaluate('return document.querySelector("[data-testid=clip-block-1]").dataset.badges')
    check('El trozo lo indica en la fila «Vídeo»', badges.includes('fades'), badges)
    const rows = []
    let ok = true
    for (const t of [500, 1000, 1500, 9500]) {
      await seekTo(t)
      const at = await playerMs()
      const d = await app.evaluate(`const p = document.querySelector('[data-testid=player]'); const o = document.querySelector('[data-testid=clip-fade]');
        const v = [...p.querySelectorAll('video.video:not(.cover)')].find((x) => !x.classList.contains('hidden'));
        return { fade: Number(p.dataset.clipFade), overlay: o ? Number(getComputedStyle(o).opacity) : 0, volume: v ? v.volume : null }`)
      const want = await S('const c = store.project.value.clips[0]; return domain.fadeGainAt(c, args.t, domain.clipOutputMs(c))', { t: at })
      rows.push(`${at} ms: ${d.fade.toFixed(3)} / ${want.toFixed(3)} (negro ${d.overlay.toFixed(3)}, volumen ${d.volume?.toFixed(3)})`)
      if (Math.abs(d.fade - want) > 0.01 || Math.abs(d.overlay - (1 - want)) > 0.01 || Math.abs((d.volume ?? -1) - want) > 0.01) ok = false
    }
    check('Vista previa: la capa negra y el volumen del trozo siguen la curva', ok, rows.join(' · '))
  }

  // --- Barras en una línea y teclas, a 1280×800 y a 1100×700.
  for (const [w, h] of [[1280, 800], [1100, 700]]) {
    await app.setViewport(w, h)
    await sleep(400)
    await selectItem(soundId)
    await barInOneLine('[data-testid=item-bar] .item-bar', `sonido elegido, ${w}×${h}`)
    await app.click('[data-testid=item-fades]')
    const pop = await app.evaluate('const r = document.querySelector("[data-testid=fades-popover]").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, iw: innerWidth, ih: innerHeight }')
    check(`El desplegable cabe en la ventana (${w}×${h})`, pop.l >= 0 && pop.t >= 0 && pop.r <= pop.iw && pop.b <= pop.ih, JSON.stringify(pop))
    await shot(`motion-03-aparecer-${w}.png`)
    await app.key('Escape')
    await visibleKeyHintsAreShortcuts(`sonido elegido, ${w}×${h}`)
    await app.key('Escape')
    const c = await app.center('[data-testid=clip-block-1]')
    await app.clickAt(c.x, c.y)
    await sleep(300)
    await barInOneLine('[data-testid=clip-panel]', `trozo elegido, ${w}×${h}`)
    await app.click('[data-testid=clip-fades]')
    const cpop = await app.evaluate('const r = document.querySelector("[data-testid=clip-fades-popover]").getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, iw: innerWidth, ih: innerHeight }')
    check(`El desplegable del trozo cabe en la ventana (${w}×${h})`, cpop.l >= 0 && cpop.t >= 0 && cpop.r <= cpop.iw && cpop.b <= cpop.ih, JSON.stringify(cpop))
    await shot(`motion-04-aparecer-trozo-${w}.png`)
    await app.key('Escape')
  }
  await app.setViewport(1280, 800)

  // --- Guardar «Para WhatsApp» y medir en el fichero el brillo y el sonido del trozo que aparece.
  {
    await app.click('[data-testid=save-video]')
    await waitScreen('save-view')
    await app.click('[data-testid=preset-whatsapp]')
    await app.waitFor('return !!document.querySelector("[data-testid=done-view]")', { timeoutMs: 180_000, what: 'vídeo guardado' })
    await noErrorDialog('guardar con curvas')
    const out = await S('return store.lastExport.value.path')
    const steady = color(out, 5, 0.5, 0.5)[0]
    const toneSteady = toneRms(out, 330, 4500, 5500)
    const clip = await S('return store.project.value.clips[0]')
    const rows = []
    let ok = true
    for (const t of [500, 1000, 1500]) {
      const frame = (Math.floor((t * 30) / 1000) * 1000) / 30
      const g = await S('const c = store.project.value.clips[0]; return domain.fadeGainAt(c, args.t, domain.clipOutputMs(c))', { t: frame })
      const c = color(out, t / 1000, 0.5, 0.5)[0]
      const a = toneRms(out, 330, t - 10, t + 10) / toneSteady
      const ga = await S('const c = store.project.value.clips[0]; return domain.fadeGainAt(c, args.t, domain.clipOutputMs(c))', { t })
      rows.push(`${t} ms: brillo ${c}/${Math.round(steady * g)} · sonido ${a.toFixed(3)}/${ga.toFixed(3)}`)
      if (Math.abs(c - steady * g) > 5 || Math.abs(a - ga) > 0.05) ok = false
    }
    check('En el fichero: el trozo sale del negro y del silencio con la misma curva que la vista previa', ok && clip.fadeInEasing === 'smooth', rows.join(' · '))
    await app.click('[data-testid=back-to-editor]')
    await waitScreen('editor')
  }
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? e.stack ?? e.message : String(e))
  try {
    await app?.screenshot(join(opts.shots, 'motion-zz-fallo.png'))
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
