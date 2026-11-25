// Prueba de extremo a extremo de la interfaz en la app Tauri real, por CDP, pulsando los botones de verdad.
// Arranca la app (pnpm tauri dev con depuración remota en el 4853), recorre el flujo completo con los clips
// de test-output/ (`pnpm test:ffmpeg` los genera), guarda un vídeo y lo comprueba con ffprobe, cancela otro,
// cierra y vuelve a abrir la app, y saca capturas de cada pantalla en test-output/screenshots/.
//
// PowerShell (con Rust/cargo en el PATH):
//   node scripts/ui-e2e.mjs
// Con la app ya abierta a mano (sin reiniciarla al final):
//   node scripts/ui-e2e.mjs --no-launch
//
// Requiere Node ≥ 22. Sale con código 1 si falla alguna comprobación. Borra al acabar los vídeos que
// ha guardado en Vídeos\Mis montajes (pruebas) (la carpeta de la app de desarrollo) y cierra la app que
// haya arrancado.

import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
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

// Un ProRes con audio PCM: WebView2 lo «carga» sin imagen y la vista previa tiene que pedir el proxy.
const prores = resolve(opts.media, 'e2e-prores-pcm.mov')
if (!existsSync(prores)) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4',
    '-c:v', 'prores_ks', '-profile:v', '0', '-c:a', 'pcm_s16le', '-shortest', prores,
  ])
}
// Copia de un clip que se borra con la app cerrada, para ver que la tarjeta dice «No encuentro este vídeo».
const doomed = resolve(opts.media, 'e2e-se-borrara.mp4')

// La app de desarrollo guarda en su propia carpeta (commands.rs), no en la de la app instalada.
const outputFolder = join(homedir(), 'Videos', 'Mis montajes (pruebas)')
const filesBefore = new Set(existsSync(outputFolder) ? readdirSync(outputFolder) : [])

function ffmpegCount() {
  const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq ffmpeg.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  return out.split('\n').filter((l) => l.toLowerCase().includes('ffmpeg.exe')).length
}

function ffprobeDurationMs(path) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { encoding: 'utf8' })
  return Math.round(Number(out.trim()) * 1000)
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

function killAppExe() {
  try {
    execFileSync('taskkill', ['/IM', 'easy-cut.exe', '/F'], { stdio: 'ignore' })
  } catch {
    // Ya estaba cerrada.
  }
}

async function stopApp() {
  if (!launch) return
  killAppExe()
  // tauri dev termina al cerrarse la app; por si acaso, se mata el árbol (Vite incluido).
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

async function noErrorDialog(where) {
  const msg = await app.text('[data-testid=error-message]')
  if (msg) {
    const details = await app.evaluate('return window.__easyCut.store.error.value?.details ?? ""')
    throw new Error(`Error en pantalla (${where}): ${msg}\n${details}`)
  }
}

const S = (expr) => app.evaluate(`const store = window.__easyCut.store; ${expr}`)
const clipIds = () => S('return store.project.value.clips.map((c) => c.id)')
const clipPaths = () => S('return store.project.value.clips.map((c) => c.sourcePath)')
const durationMs = () => app.evaluate('return Number(document.querySelector("[data-testid=duration-bar]").dataset.durationMs)')
const playerData = () => app.evaluate('const p = document.querySelector("[data-testid=player]"); return { ms: Number(p.dataset.currentMs), dur: Number(p.dataset.durationMs), clip: Number(p.dataset.clipIndex), playing: p.dataset.playing === "1", src: Number(p.dataset.sourceMs) }')

async function waitScreen(testid, timeoutMs = 20_000) {
  await app.waitFor(`return !!document.querySelector('[data-testid=${testid}]')`, { timeoutMs, what: `pantalla ${testid}` })
  await sleep(200)
}

async function selectClipByPath(path) {
  const paths = await clipPaths()
  const i = paths.indexOf(path)
  if (i < 0) throw new Error(`No hay trozo de ${path}`)
  await app.click(`[data-testid=clip-card-${i + 1}]`)
  return i
}

/** Pulsa en la tira de miniaturas en el instante `ms` del original. */
async function filmstripAt(ms, sourceDurationMs) {
  const r = await app.evaluate('const r = document.querySelector("[data-testid=filmstrip]").getBoundingClientRect(); return { l: r.left, w: r.width, y: r.top + r.height * 0.75 }')
  await app.clickAt(r.l + (r.w * ms) / sourceDurationMs, r.y)
  await sleep(250)
}

async function openClipEditor(path) {
  await selectClipByPath(path)
  await app.click('[data-testid=fix-clip]')
  await waitScreen('clip-editor')
}

async function closeClipEditor() {
  await app.click('[data-testid=clip-done]')
  await waitScreen('editor')
}

// ================================================================== prueba

try {
  await startApp()
  app = await connectToApp(port, { timeoutMs: 240_000 })
  console.log(`Conectado a ${app.url}`)
  await app.waitFor('return !!window.__easyCut?.store', { timeoutMs: 60_000, what: 'store de la app (modo desarrollo)' })
  // Punto de partida limpio: sin autoguardado.
  await app.evaluate('await window.__easyCut.bridge.clearAutosave(); location.reload(); return true')
  await sleep(1500)
  app.close()
  app = await connectToApp(port)
  await app.waitFor('return !!window.__easyCut?.store')
  await app.setViewport(1280, 800)

  // --- Inicio
  await waitScreen('new-video')
  check('Inicio sin vídeo a medias no ofrece seguir', !(await app.text('[data-testid=resume-card]')))
  await shot('01-inicio.png')

  // --- Teleprompter (su prueba completa es scripts/teleprompter-e2e.mjs)
  await app.click('[data-testid=teleprompter]')
  await waitScreen('teleprompter-view')
  check('«Grabarme leyendo un texto» lleva a escribir el texto', !!(await app.center('[data-testid=script-input]')))
  await app.click('[data-testid=back-home]')
  await waitScreen('new-video')

  // --- Elegir vídeos
  await app.click('[data-testid=new-video]')
  await waitScreen('pick-videos')
  await shot('03-elegir-videos.png')
  const picked = [media.horizontal, media.vertical, media.silence, media.noAudio]
  await app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: picked })
  await app.click('[data-testid=pick-videos]')
  await waitScreen('editor', 30_000)
  await app.waitFor('return !document.querySelector("[data-testid=preparing]")', { timeoutMs: 30_000 })
  await noErrorDialog('añadir vídeos')
  check('Los 4 vídeos entran en el orden elegido', JSON.stringify(await clipPaths()) === JSON.stringify(picked))
  check('Forma por defecto: la de la mayoría (horizontal)', (await S('return store.project.value.aspect')) === '16:9')
  check('Barra de duración: «El vídeo dura 36 s»', (await app.text('[data-testid=duration-total]')) === 'El vídeo dura 36 s', await app.text('[data-testid=duration-total]'))
  const cardDurations = await app.evaluate('return [...document.querySelectorAll("[data-testid=clip-duration]")].map((e) => e.innerText)')
  check('Cada tarjeta lleva su duración', JSON.stringify(cardDurations) === JSON.stringify(['10 s', '8 s', '12 s', '6 s']), cardDurations.join(', '))
  await sleep(1200) // miniaturas
  await shot('04-tu-video.png')

  // --- Reordenar arrastrando y con botones
  {
    const before = await clipIds()
    const c4 = await app.center('[data-testid=clip-card-4]')
    const c1 = await app.center('[data-testid=clip-card-1]')
    await app.drag({ x: c4.x, y: c4.y }, { x: c1.x - c1.w * 0.4, y: c1.y }, 20)
    const after = await clipIds()
    check('Arrastrar la tarjeta 4 al principio', after[0] === before[3] && after[1] === before[0], after.map((id) => before.indexOf(id) + 1).join(','))
    // Ahora está seleccionada (es la 1): «Mover después» tres veces la devuelve al final.
    for (let i = 0; i < 3; i++) await app.click('[data-testid=move-after]')
    check('«Mover después» la devuelve a su sitio', JSON.stringify(await clipIds()) === JSON.stringify(before))
    await app.click('[data-testid=move-before]')
    check('«Mover antes»', (await clipIds())[2] === before[3])
    await app.click('[data-testid=undo]')
    check('Deshacer «Mover antes»', JSON.stringify(await clipIds()) === JSON.stringify(before))
  }

  // --- «Añadir más vídeos» con uno que WebView2 no sabe enseñar: proxy de vista previa
  {
    const before = await clipIds()
    await app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: [prores] })
    await app.click('[data-testid=add-more]')
    await app.waitFor('return window.__easyCut.store.project.value.clips.length === args.n', { args: { n: before.length + 1 }, timeoutMs: 20_000, what: 'trozo ProRes añadido' })
    await app.click(`[data-testid=clip-card-${before.length + 1}]`)
    const proxied = await app.waitFor(
      `const p = window.__easyCut.store.proxyStatus.value[args.p];
       const v = [...document.querySelectorAll('[data-testid=player] video')].find((e) => !e.classList.contains('hidden'));
       return p === 'ready' && v && v.videoWidth > 0 && v.src.includes('asset') ? { w: v.videoWidth, h: v.videoHeight } : null`,
      { args: { p: prores }, timeoutMs: 90_000, what: 'proxy de vista previa del ProRes' },
    )
    check('Un vídeo que el visor no sabe enseñar se ve con el proxy', !!proxied, JSON.stringify(proxied))
    await app.click('[data-testid=remove-clip]')
    check('Y se quita sin preguntar', JSON.stringify(await clipIds()) === JSON.stringify(before))
    await app.click('[data-testid=clip-card-1]')
  }

  // --- Espacio = reproducir / pausa
  {
    await app.key(' ')
    await sleep(700)
    const playing = (await playerData()).playing
    await app.key(' ')
    await sleep(200)
    check('Espacio reproduce y pausa', playing && !(await playerData()).playing)
  }

  // --- Cortar (asas y «Termina aquí») y quitar pausas en el trozo con silencio
  await openClipEditor(media.silence)
  {
    const fs = await app.evaluate('const r = document.querySelector("[data-testid=filmstrip]").getBoundingClientRect(); return { l: r.left, w: r.width }')
    const h = await app.center('[data-testid=handle-in]')
    // El asa del principio se agarra por su centro; se suelta en el segundo 1 del original (12 s).
    const offset = h.x - fs.l
    await app.drag({ x: h.x, y: h.y }, { x: fs.l + (fs.w * 1000) / 12_000 + offset, y: h.y }, 10)
    const inMs = await app.evaluate('return Number(document.querySelector("[data-testid=filmstrip]").dataset.inMs)')
    check('Arrastrar el asa de inicio', Math.abs(inMs - 1000) < 400, `${inMs} ms`)
    const clipChange = await app.text('[data-testid=clip-change]')
    check('«Este trozo: 12 s → 11 s» al arrastrar', clipChange === 'Este trozo: 12 s → 11 s', clipChange)
    check('«Vídeo completo: 36 s → 35 s»', (await app.text('[data-testid=project-change]')) === 'Vídeo completo: 36 s → 35 s', await app.text('[data-testid=project-change]'))
    await filmstripAt(10_000, 12_000)
    await app.click('[data-testid=step-forward]')
    const ph = await app.evaluate('return Number(document.querySelector("[data-testid=filmstrip]").dataset.playheadMs)')
    check('«1 segundo adelante» mueve la imagen', Math.abs(ph - 11_000) < 300, `${ph} ms`)
    await app.click('[data-testid=end-here]')
    const outMs = await app.evaluate('return Number(document.querySelector("[data-testid=filmstrip]").dataset.outMs)')
    check('«Termina aquí»', Math.abs(outMs - 11_000) < 300, `${outMs} ms`)
    await shot('05-cortar.png')

    await app.click('[data-testid=tab-pauses]')
    await app.click('[data-testid=find-pauses]')
    await app.waitFor('return document.querySelector("[data-testid=pauses-found]") || document.querySelector("[data-testid=pauses-none]")', { timeoutMs: 30_000 })
    const found = await app.text('[data-testid=pauses-found]')
    check('Buscar pausas: «He encontrado 1 pausa» y lo que ahorra (el antes → después va arriba)', !!found && found.startsWith('He encontrado 1 pausa') && found.includes('Quitarlas ahorra'), found ?? 'sin pausas')
    const marks = await app.evaluate('return document.querySelectorAll("[data-testid=pause-mark]").length')
    check('Las pausas se pintan sobre la tira', marks >= 1, `${marks}`)
    const previewDur = (await playerData()).dur
    check('La vista previa ya va sin las pausas', previewDur < 9_000, `${previewDur} ms`)
    await shot('06-quitar-pausas.png')
    await app.click('[data-testid=level-many]')
    await app.click('[data-testid=level-normal]')
    await app.click('[data-testid=remove-pauses]')
    const segs = await S('return store.selectedClip.value.segments.length')
    check('«Quitar las pausas» aplica', segs > 1 && !!(await app.text('[data-testid=pauses-applied]')), `${segs} rangos`)
    await noErrorDialog('quitar pausas')
  }
  await closeClipEditor()

  // --- Partir dos veces el horizontal
  await openClipEditor(media.horizontal)
  {
    const n0 = (await clipIds()).length
    await filmstripAt(6000, 10_000)
    await app.click('[data-testid=split-here]')
    const toast = await app.text('[data-testid=toast]')
    check('Partir: aviso «Trozo partido en dos»', !!toast && toast.includes('Trozo partido en dos'), toast ?? '')
    await filmstripAt(3000, 10_000)
    await app.click('[data-testid=split-here]')
    const n2 = (await clipIds()).length
    check('Partir dos veces: dos trozos nuevos en la tira', n2 === n0 + 2, `${n0} → ${n2}`)
    const io = await S('const c = store.selectedClip.value; return [c.segments[0].startMs, c.segments[c.segments.length - 1].endMs]')
    check('Tras partir se queda en la primera parte', io[0] === 0 && Math.abs(io[1] - 3000) < 100, JSON.stringify(io))

    // Velocidad
    await app.click('[data-testid=tab-speed]')
    await app.click('[data-testid=speed-2]')
    check('Velocidad «Más rápido»: el trozo pasa a durar 2 s', (await app.text('[data-testid=clip-change]')) === 'Este trozo: 10 s → 2 s', await app.text('[data-testid=clip-change]'))
    await app.click('[data-testid=speed-4]')
    check('Aviso en «Muy rápido»', !!(await app.text('[data-testid=speed-warning]')))
    await shot('07-velocidad.png')
    await app.click('[data-testid=speed-2]')

    // Sonido
    await app.click('[data-testid=tab-sound]')
    await app.click('[data-testid=sound-off]')
    check('Sin sonido', (await S('return store.selectedClip.value.muted')) === true)
    await shot('08-sonido.png')
  }
  await closeClipEditor()
  {
    const badges = await app.text('[data-testid=clip-strip]')
    check('Las tarjetas indican lo aplicado', badges.includes('Rápido') && badges.includes('Sin sonido') && badges.includes('Sin pausas'), badges)
  }

  // --- Girar y encuadrar el vertical
  await openClipEditor(media.vertical)
  {
    await app.click('[data-testid=tab-frame]')
    check('Vertical en vídeo horizontal: ofrece «Que se vea entero» / «Que llene la pantalla»', !!(await app.center('[data-testid=mode-fill]')))
    await app.click('[data-testid=rotate-right]')
    check('Girar a la derecha', (await S('return store.selectedClip.value.quarterTurns')) === 1)
    await app.click('[data-testid=rotate-left]')
    check('Girar a la izquierda', (await S('return store.selectedClip.value.quarterTurns')) === 0)
    await app.click('[data-testid=mode-fill]')
    await app.click('[data-testid=zoom-in]')
    const f = await app.center('[data-testid=preview-frame]')
    await app.drag({ x: f.x, y: f.y }, { x: f.x + 40, y: f.y + 60 }, 10)
    const framing = await S('return store.selectedClip.value.framing')
    check('Encuadrar: llenar, acercar y arrastrar', framing.mode === 'fill' && framing.zoom === 1.25 && framing.offsetY < 0, JSON.stringify(framing))
    await shot('09-encuadrar.png')
    await app.click('[data-testid=center]')
    check('Centrar', (await S('return store.selectedClip.value.framing.offsetY')) === 0)
  }
  await closeClipEditor()

  // --- Forma
  await app.click('[data-testid=shape-vertical]')
  check('Cambiar la forma a vertical', (await S('return store.project.value.aspect')) === '9:16')
  await shot('10-forma-vertical.png')
  await app.click('[data-testid=shape-horizontal]')
  check('Volver a horizontal', (await S('return store.project.value.aspect')) === '16:9')

  // --- Duración máxima: te quedan / te sobran
  {
    const total = await durationMs()
    await app.click('[data-testid=target-button]')
    await app.click('[data-testid=target-1]')
    const left = await app.text('[data-testid=target-text]')
    const expectedLeft = Math.round((60_000 - total) / 1000)
    check('Máximo 1 minuto: «Te quedan …» en verde', left.startsWith(`Te quedan ${expectedLeft} segundos`) && !(await app.evaluate('return document.querySelector("[data-testid=duration-bar]").classList.contains("over")')), left)
    // Otra duración: 10 s (menos de lo que dura) → te sobran.
    await app.click('[data-testid=target-button]')
    await app.click('[data-testid=target-custom]')
    await app.click('[aria-label="Un minuto menos"]')
    for (let i = 0; i < 2; i++) await app.click('[aria-label="Cinco segundos más"]')
    await app.click('.popover .btn.primary')
    const over = await app.text('[data-testid=target-text]')
    const expectedOver = Math.round((total - 10_000) / 1000)
    check('Máximo 10 s: «Te sobran …» en rojo', over.startsWith(`Te sobran ${expectedOver} segundos`) && (await app.evaluate('return document.querySelector("[data-testid=duration-bar]").classList.contains("over")')), over)
    await shot('11-te-sobran.png')

    // Deshacer / rehacer con teclado y con botones.
    await app.key('z', { ctrl: true })
    check('Ctrl+Z deshace (vuelve a 1 minuto)', (await app.text('[data-testid=target-text]')).startsWith('Te quedan'))
    await app.key('y', { ctrl: true })
    check('Ctrl+Y rehace (10 s otra vez)', (await app.text('[data-testid=target-text]')).startsWith('Te sobran'))
    await app.click('[data-testid=undo]')
    check('Botón Deshacer', (await app.text('[data-testid=target-text]')).startsWith('Te quedan'))
    await app.click('[data-testid=redo]')
    await app.click('[data-testid=undo]')
    check('Botón Rehacer y otra vez Deshacer', (await S('return store.project.value.targetDurationMs')) === 60_000)
  }

  // --- Quitar un trozo con «Deshacer» del aviso
  {
    const n = (await clipIds()).length
    await app.click('[data-testid=clip-card-2]')
    await app.click('[data-testid=remove-clip]')
    const toast = await app.text('[data-testid=toast]')
    check('Quitar del vídeo avisa', (await clipIds()).length === n - 1 && toast.includes('Trozo quitado. El original sigue en tu ordenador.'), toast)
    await shot('12-trozo-quitado.png')
    await app.click('[data-testid=toast-action]')
    check('«Deshacer» del aviso lo recupera', (await clipIds()).length === n)
  }

  // --- Reproducir la vista previa completa
  {
    await app.click('[data-testid=clip-card-1]')
    const total = await durationMs()
    await app.click('[data-testid=play-toggle]')
    const samples = []
    const t0 = Date.now()
    for (;;) {
      await sleep(250)
      const d = await playerData()
      samples.push(d)
      if (!d.playing || Date.now() - t0 > total + 15_000) break
    }
    const last = samples[samples.length - 1]
    const clipsSeen = [...new Set(samples.map((s) => s.clip))]
    const nClips = (await clipIds()).length
    let backwards = 0
    for (let i = 1; i < samples.length; i++) if (samples[i].ms + 50 < samples[i - 1].ms) backwards++
    const wall = Date.now() - t0
    check(
      'La vista previa recorre todo el vídeo saltando de trozo en trozo',
      !last.playing && Math.abs(last.ms - total) < 400 && clipsSeen.length === nClips && backwards === 0,
      `${clipsSeen.length}/${nClips} trozos, terminó en ${last.ms}/${total} ms, ${backwards} retrocesos, ${wall} ms de reloj`,
    )
    check('Y tarda lo que dura (±2 s)', Math.abs(wall - total) < 2500, `${wall} ms para ${total} ms`)
  }

  // --- Guardar «Para WhatsApp»
  let exportedPath = null
  {
    const shownMs = await durationMs()
    await app.click('[data-testid=save-video]')
    await waitScreen('save-view')
    await sleep(500)
    const cards = await app.text('[data-testid=preset-whatsapp]')
    check('Tarjeta «Para WhatsApp» con tamaño y tiempo', /Tamaño: pequeño · (unos \d+ MB|menos de 1 MB)/.test(cards) && cards.includes('tardará'), cards)
    await shot('13-guardar.png')
    await app.click('[data-testid=preset-whatsapp]')
    await waitScreen('saving-view')
    await shot('14-guardando.png')
    await app.waitFor('return document.querySelector("[data-testid=done-view]") || document.querySelector("[data-testid=error-dialog]")', { timeoutMs: 180_000, what: 'fin del guardado' })
    await noErrorDialog('guardar')
    exportedPath = await S('return store.lastExport.value.path')
    const probed = ffprobeDurationMs(exportedPath)
    check('El vídeo guardado existe y dura lo que decía la interfaz (±0,3 s)', existsSync(exportedPath) && Math.abs(probed - shownMs) <= 300, `${exportedPath}: ${probed} ms (interfaz ${shownMs} ms)`)
    check('Nombre «Vídeo del … (para WhatsApp).mp4» en Mis montajes (pruebas)', /\\Mis montajes \(pruebas\)\\Vídeo del .+ \(para WhatsApp\)( \d+)?\.mp4$/.test(exportedPath), exportedPath)
    await shot('15-listo.png')
    await app.click('[data-testid=copy-whatsapp]')
    // Copiar lanza un PowerShell (Set-Clipboard): según lo ocupado que esté el PC tarda más de 300 ms.
    await app.waitFor('return !!document.querySelector("[data-testid=copied-hint]") || !!document.querySelector("[data-testid=error-dialog]")', { timeoutMs: 10_000, what: 'copiado' }).catch(() => {})
    check('«Copiar para pegarlo en WhatsApp» explica el Ctrl+V', (await app.text('[data-testid=copied-hint]')) === 'Ahora ve a WhatsApp y pulsa Ctrl+V')
    await shot('16-listo-copiado.png')
    await noErrorDialog('copiar')
  }

  // --- Cancelar otra exportación
  {
    const ffBefore = ffmpegCount()
    const namesBefore = new Set(readdirSync(outputFolder))
    await app.click('[data-testid=save-another-way]')
    await waitScreen('save-view')
    await app.click('[data-testid=preset-high]')
    await waitScreen('saving-view')
    // Se cancela con ffmpeg ya escribiendo el fichero (progreso > 0).
    await app.waitFor('const t = document.querySelector("[data-testid=saving-percent]"); return t && t.innerText !== "0 %"', { timeoutMs: 30_000, what: 'progreso del guardado' })
    const partial = readdirSync(outputFolder).filter((n) => !namesBefore.has(n))
    check('Al cancelar había un vídeo a medias y ffmpeg trabajando', partial.length === 1 && ffmpegCount() >= 1, partial.join(', '))
    await app.click('[data-testid=cancel-saving]')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    await shot('17-cancelar-confirmacion.png')
    await app.click('[data-testid=confirm-ok]')
    await waitScreen('save-view', 20_000)
    await sleep(1500)
    const namesAfter = readdirSync(outputFolder).filter((n) => !namesBefore.has(n))
    const ff = ffmpegCount()
    const toast = await app.text('[data-testid=toast]')
    check('Cancelar: no queda el vídeo a medias', namesAfter.length === 0, namesAfter.join(', ') || 'nada nuevo')
    check('Cancelar: no queda ningún ffmpeg', ff <= ffBefore && ff === 0, `antes ${ffBefore}, después ${ff}`)
    check('Cancelar: aviso', !!toast && toast.startsWith('No se ha guardado'), toast ?? '')
    await app.click('[data-testid=back-editor]')
    await waitScreen('editor')
  }

  // --- Capturas a otros tamaños
  await app.setViewport(1920, 1080)
  await shot('18-tu-video-1920x1080.png')
  await app.setViewport(1100, 700)
  await shot('19-tu-video-1100x700.png')
  await app.click('[data-testid=fix-clip]')
  await waitScreen('clip-editor')
  await shot('20-arreglar-1100x700.png')
  await closeClipEditor()
  await app.setViewport(1280, 800)

  // --- Cerrar y volver a abrir: ofrece seguir (y un original que ha desaparecido mientras tanto)
  {
    copyFileSync(media.noAudio, doomed)
    const nBefore = (await clipIds()).length
    await app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: [doomed] })
    await app.click('[data-testid=add-more]')
    await app.waitFor('return window.__easyCut.store.project.value.clips.length === args.n', { args: { n: nBefore + 1 }, timeoutMs: 20_000, what: 'trozo que se borrará' })
    const ids = await clipIds()
    const total = await durationMs()
    // Que el autoguardado esté al día antes de cerrar.
    await app.waitFor('const b = window.__easyCut.bridge; const d = window.__easyCut.domain; return (await b.loadAutosave()) === d.serializeProject(window.__easyCut.store.project.value)', { timeoutMs: 5000, what: 'autoguardado al día' })
    if (launch) {
      app.close()
      await stopApp()
      unlinkSync(doomed)
      await startApp()
      app = await connectToApp(port, { timeoutMs: 240_000 })
      await app.waitFor('return !!window.__easyCut?.store', { timeoutMs: 60_000 })
    } else {
      await app.evaluate('location.reload(); return true')
      await sleep(300)
      unlinkSync(doomed)
      await sleep(1200)
      app.close()
      app = await connectToApp(port)
      await app.waitFor('return !!window.__easyCut?.store')
    }
    await app.setViewport(1280, 800)
    await app.waitFor('return !!document.querySelector("[data-testid=resume-card]")', { timeoutMs: 10_000, what: 'tarjeta de vídeo sin terminar' })
    const card = await app.text('[data-testid=resume-card]')
    const n = ids.length
    check(`Al volver a abrir ofrece seguir («${n} trozos»)`, card.includes(`${n} trozos`) && card.includes('Seguir con este vídeo'), card)
    await shot('21-inicio-seguir.png')
    await app.click('[data-testid=new-video]')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    check('Empezar otro con uno a medias pide confirmación', (await app.text('[data-testid=confirm-dialog]')).includes('Tus vídeos originales no se tocan'))
    await shot('22-confirmar-nuevo.png')
    await app.key('Escape')
    await app.click('[data-testid=resume]')
    await waitScreen('editor')
    check('Seguir con el vídeo recupera los trozos y la duración', JSON.stringify(await clipIds()) === JSON.stringify(ids) && (await durationMs()) === total)
    await sleep(1500)
    check('Al seguir no se pone a reproducir solo', !(await playerData()).playing)

    const lost = await app.waitFor('const c = document.querySelector(`[data-testid=clip-card-${args.n}]`); return c && c.innerText.includes("No encuentro este vídeo") ? c.innerText : null', { args: { n: ids.length }, timeoutMs: 10_000, what: 'tarjeta «No encuentro este vídeo»' })
    check('La tarjeta del original borrado dice «No encuentro este vídeo»', !!lost)
    await app.click(`[data-testid=clip-card-${ids.length}]`)
    await shot('23-no-encuentro.png')
    await app.click('[data-testid=save-video]')
    check('Con un original perdido no deja guardar y lo explica', (await app.text('[data-testid=toast]'))?.startsWith('Antes de guardar, quita') && !!(await app.text('[data-testid=editor]')))
    await app.click('[data-testid=remove-clip]')
    check('«Quitarlo del vídeo»', (await clipIds()).length === ids.length - 1)
  }
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? e.stack ?? e.message : String(e))
  try {
    await app?.screenshot(join(opts.shots, 'zz-fallo.png'))
  } catch {
    // Sin captura.
  }
} finally {
  app?.close()
  if (existsSync(doomed)) unlinkSync(doomed)
  if (!opts['keep-open']) await stopApp()
  // Limpieza: los vídeos que ha guardado la prueba.
  if (existsSync(outputFolder)) {
    for (const name of readdirSync(outputFolder)) {
      if (!filesBefore.has(name) && name.endsWith('.mp4')) {
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
