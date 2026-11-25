// Prueba de extremo a extremo de «Imagen» (qué se ve mientras suena un trozo) y «Solo el sonido», en la app
// Tauri real por CDP y con los botones de verdad: añadir un fichero de sonido, la pestaña «Imagen» con sus tres
// opciones, elegir el vídeo de encima (por el gancho de desarrollo en vez del diálogo), «Empieza en…», esquina
// y tamaño, partir un trozo con vídeo encima, deshacer/rehacer, reproducir la vista previa midiendo que el vídeo
// de encima va sincronizado, guardar «Para WhatsApp» y «Solo el sonido» y comprobarlos con ffprobe, un vídeo de
// encima que desaparece y la barra de duración a 1100 px. Capturas pic-*.png en test-output/screenshots/.
//
// PowerShell (con Rust/cargo en el PATH, la app cerrada y los ficheros de `pnpm test:ffmpeg` en test-output):
//   node scripts/picture-e2e.mjs
// Con la app ya abierta a mano: --no-launch.
//
// Borra al acabar lo que ha guardado en Vídeos\Mis montajes (pruebas) y cierra la app. Sale con 1 si algo falla.

import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { connectToApp, sleep } from './cdp.mjs'

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: '4853' },
    media: { type: 'string', default: resolve('test-output') },
    shots: { type: 'string', default: resolve('test-output', 'screenshots') },
    'no-launch': { type: 'boolean', default: false },
    'keep-open': { type: 'boolean', default: false },
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
  voice: resolve(opts.media, 'src-voice-silence.m4a'),
  coverShort: resolve(opts.media, 'src-cover-short-2s.mp4'),
  coverLong: resolve(opts.media, 'src-cover-long-25fps.mp4'),
}
for (const p of Object.values(media)) if (!existsSync(p)) throw new Error(`Falta ${p}: ejecuta pnpm test:ffmpeg`)
// Copia del vídeo de encima corto que se borra a mitad de prueba («No encuentro el vídeo de encima»).
const doomedCover = resolve(opts.media, 'e2e-encima-se-borrara.mp4')

const outputFolder = join(homedir(), 'Videos', 'Mis montajes (pruebas)')
const filesBefore = new Set(existsSync(outputFolder) ? readdirSync(outputFolder) : [])

function ffprobe(path) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels,duration', '-of', 'json', path], { encoding: 'utf8' })
  return JSON.parse(out)
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
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
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
  await sleep(400)
  await app.screenshot(join(opts.shots, name))
}

async function noErrorDialog(where) {
  const msg = await app.text('[data-testid=error-message]')
  if (msg) {
    const details = await app.evaluate('return window.__easyCut.store.error.value?.details ?? ""')
    throw new Error(`Error en pantalla (${where}): ${msg}\n${details}`)
  }
}

const S = (expr, args = {}) => app.evaluate(`const store = window.__easyCut.store; const domain = window.__easyCut.domain; ${expr}`, args)
const clips = () => S('return store.project.value.clips.map((c) => ({ id: c.id, path: c.sourcePath, picture: c.picture }))')
const selected = () => S('const c = store.selectedClip.value; return c ? { id: c.id, path: c.sourcePath, picture: c.picture, segments: c.segments.length, out: domain.clipOutputMs(c) } : null')
const queuePick = (paths) => app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: paths })
const playerData = () =>
  app.evaluate(`const p = document.querySelector("[data-testid=player]"); const d = p.dataset;
    return { ms: Number(d.currentMs), dur: Number(d.durationMs), clip: Number(d.clipIndex), playing: d.playing === "1", picture: d.picture,
      cover: d.coverMs === '' ? null : Number(d.coverMs), expected: d.coverExpectedMs === '' ? null : Number(d.coverExpectedMs) }`)

async function waitScreen(testid, timeoutMs = 20_000) {
  await app.waitFor(`return !!document.querySelector('[data-testid=${testid}]')`, { timeoutMs, what: `pantalla ${testid}` })
  await sleep(200)
}

async function openClip(index) {
  await app.click(`[data-testid=clip-card-${index + 1}]`)
  await app.click('[data-testid=fix-clip]')
  await waitScreen('clip-editor')
}

async function closeClip() {
  await app.click('[data-testid=clip-done]')
  await waitScreen('editor')
}

async function filmstripAt(ms, sourceDurationMs) {
  const r = await app.evaluate('const r = document.querySelector("[data-testid=filmstrip]").getBoundingClientRect(); return { l: r.left, w: r.width, y: r.top + r.height * 0.75 }')
  await app.clickAt(r.l + (r.w * ms) / sourceDurationMs, r.y)
  await sleep(250)
}

/** Pulsa uno de los botones de pestaña de «Arreglar este trozo». */
const tab = (id) => app.click(`[data-testid=tab-${id}]`)

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

  const folder = await app.evaluate('return await window.__easyCut.bridge.getOutputFolder()')
  check('La app de desarrollo guarda en «Mis montajes (pruebas)»', folder.endsWith('\\Mis montajes (pruebas)'), folder)

  // --- Vídeos y, con «Añadir vídeos o sonidos», un fichero de sonido
  await app.click('[data-testid=new-video]')
  await waitScreen('pick-videos')
  await queuePick([media.horizontal, media.silence])
  await app.click('[data-testid=pick-videos]')
  await waitScreen('editor', 30_000)
  await app.waitFor('return !document.querySelector("[data-testid=preparing]")', { timeoutMs: 30_000 })
  check('El botón dice «Añadir vídeos o sonidos»', (await app.text('[data-testid=add-more]')) === 'Añadir vídeos o sonidos', await app.text('[data-testid=add-more]'))
  await queuePick([media.voice])
  await app.click('[data-testid=add-more]')
  await app.waitFor('return window.__easyCut.store.project.value.clips.length === 3', { timeoutMs: 20_000, what: 'sonido añadido' })
  await noErrorDialog('añadir el sonido')
  {
    const list = await clips()
    check('El M4A entra como trozo de «Solo se oye»', list[2].path === media.voice && list[2].picture.kind === 'none', JSON.stringify(list[2]))
    const kind = await app.evaluate('return document.querySelector("[data-testid=clip-card-3] .picture").dataset.picture')
    check('Su tarjeta es distinta: onda y «Solo se oye»', kind === 'sound' && (await app.text('[data-testid=clip-card-3]')).includes('Solo se oye'), kind)
    check('El vídeo dura 32 s (10 + 12 + 10)', (await app.text('[data-testid=duration-total]')) === 'El vídeo dura 32 s', await app.text('[data-testid=duration-total]'))
  }
  await app.click('[data-testid=clip-card-3]')
  await sleep(1200)
  check('La vista previa del sonido enseña «Solo se oye»', (await playerData()).picture === 'none' && !!(await app.text('[data-testid=preview-sound-only]')))
  await shot('pic-01-tu-video-con-sonido.png')

  // --- El sonido: forma de onda, quitar pausas e «Imagen»
  await openClip(2)
  {
    const wave = await app.waitFor('const i = document.querySelector("[data-testid=filmstrip-wave] img"); return i && i.complete && i.naturalWidth > 0 ? i.naturalWidth : null', { timeoutMs: 20_000, what: 'forma de onda' })
    check('«Cortar» enseña la forma de onda del sonido', !!wave, `${wave} px`)
    await shot('pic-02-cortar-sonido.png')
    await tab('pauses')
    await app.click('[data-testid=find-pauses]')
    await app.waitFor('return document.querySelector("[data-testid=pauses-found]") || document.querySelector("[data-testid=pauses-none]")', { timeoutMs: 30_000 })
    const found = await app.text('[data-testid=pauses-found]')
    check('«Quitar pausas» en un sonido: 1 pausa y lo que ahorra', !!found && found.startsWith('He encontrado 1 pausa') && found.includes('Quitarlas ahorra'), found ?? 'ninguna')
    const top = await app.text('[data-testid=clip-change]')
    check('Arriba, un solo «antes → después» del trozo', /^Este trozo: 10 s → \d s$/.test(top ?? ''), top)
    await shot('pic-03-quitar-pausas-sonido.png')
    await app.click('[data-testid=remove-pauses]')
    check('Y las quita', (await selected()).segments > 1)

    await tab('picture')
    check('Un sonido no ofrece «Se ve el vídeo»', !(await app.text('[data-testid=picture-own]')) && (await app.evaluate('return document.querySelector("[data-testid=picture-none]").getAttribute("aria-checked")')) === 'true')
    await shot('pic-04-imagen-sonido.png')
    copyFileSync(media.coverShort, doomedCover)
    await queuePick([doomedCover])
    await app.click('[data-testid=picture-cover]')
    await app.waitFor('return !!document.querySelector("[data-testid=cover-chosen]")', { timeoutMs: 20_000, what: 'vídeo de encima elegido' })
    await noErrorDialog('poner el vídeo de encima')
    const pic = (await selected()).picture
    check('«Poner otro vídeo encima» (diálogo de un solo vídeo)', pic.kind === 'cover' && pic.sourcePath === doomedCover && pic.startMs === 0, JSON.stringify(pic))
    check('Avisa de que dura menos y se quedará quieto', (await app.text('[data-testid=cover-short]')) === 'El vídeo de encima dura menos: al acabar se queda quieto en su última imagen.')
    await sleep(800)
    check('La vista previa enseña el vídeo de encima', (await playerData()).picture === 'cover' && (await app.evaluate('const v = document.querySelector("[data-testid=cover-video]"); return !!v && v.videoWidth > 0 && !v.classList.contains("hidden")')))
    await shot('pic-05-imagen-encima-corto.png')
    await app.click('[data-testid=cover-start-forward]')
    check('«Empieza en…» +1 s', (await selected()).picture.startMs === 1000 && (await app.text('[data-testid=cover-start-text]')).includes('0:01'), await app.text('[data-testid=cover-start-text]'))
    await app.key('z', { ctrl: true })
    check('Deshacer «Empieza en…»', (await selected()).picture.startMs === 0)
    await app.key('y', { ctrl: true })
    check('Rehacer «Empieza en…»', (await selected()).picture.startMs === 1000)
    // Arrastrar el asa de la tira de miniaturas hasta el principio.
    const r = await app.center('[data-testid=cover-start]')
    await app.drag({ x: r.x - r.w / 2 + 14 + (r.w - 28) * (1000 / 1500), y: r.y }, { x: r.x - r.w / 2 + 2, y: r.y }, 8)
    check('Arrastrar el asa de «Empieza en…» al principio', (await selected()).picture.startMs === 0, String((await selected()).picture.startMs))

    await tab('frame')
    check('«Encuadrar» explica que lo que se ve es el vídeo de encima', !!(await app.text('[data-testid=frame-nothing]')))
    await shot('pic-06-encuadrar-con-encima.png')
  }
  await closeClip()
  check('Tarjeta del sonido con vídeo encima: miniatura e indicador', (await app.evaluate('return document.querySelector("[data-testid=clip-card-3] .picture").dataset.picture')) === 'cover' && (await app.text('[data-testid=clip-card-3]')).includes('Vídeo encima'))

  // --- El vídeo horizontal: quitarle la imagen, otro vídeo encima, esquina y tamaño, y partirlo
  await openClip(0)
  {
    await tab('picture')
    await app.click('[data-testid=picture-none]')
    await sleep(500)
    check('«Solo se oye» en un vídeo: fondo liso en la vista previa', (await selected()).picture.kind === 'none' && (await playerData()).picture === 'none')
    await shot('pic-07-imagen-quitada.png')
    await queuePick([media.coverLong])
    await app.click('[data-testid=picture-cover]')
    await app.waitFor('return !!document.querySelector("[data-testid=cover-chosen]")', { timeoutMs: 20_000 })
    check('Un vídeo de encima más largo no avisa', !(await app.text('[data-testid=cover-short]')))
    await app.click('[data-testid=cover-start-forward]')
    await app.click('[data-testid=cover-fill]')
    await app.click('[data-testid=inset-toggle]')
    check('«Verme en una esquina» (abajo a la derecha, pequeño, por defecto)', JSON.stringify((await selected()).picture.inset) === '{"corner":"bottom-right","size":"small"}')
    await app.click('[data-testid=inset-top-left]')
    await app.click('[data-testid=inset-medium]')
    const pic = (await selected()).picture
    check('Esquina arriba a la izquierda y mediano; llena la pantalla', pic.inset.corner === 'top-left' && pic.inset.size === 'medium' && pic.framing.mode === 'fill' && pic.startMs === 1000, JSON.stringify(pic))
    await sleep(800)
    const inset = await app.evaluate(`const f = document.querySelector('[data-testid=preview-frame]').getBoundingClientRect();
      const v = [...document.querySelectorAll('[data-testid=player] video.inset')].find((e) => !e.classList.contains('hidden'));
      if (!v) return null; const r = v.getBoundingClientRect();
      return { left: (r.left - f.left) / f.width, top: (r.top - f.top) / f.height, width: r.width / f.width, playing: v.videoWidth > 0 }`)
    check('En la vista previa me veo arriba a la izquierda, a un 40 % del ancho', !!inset && inset.left < 0.06 && inset.top < 0.1 && Math.abs(inset.width - 0.4) < 0.02 && inset.playing, JSON.stringify(inset))
    await shot('pic-08-encima-y-esquina.png')
    await app.setViewport(1280, 800)

    // Partir a los 4 s: la segunda parte sigue el vídeo de encima donde iba.
    await tab('cut')
    await filmstripAt(4000, 10_000)
    await app.click('[data-testid=split-here]')
    const list = await clips()
    const [a, b] = [list[0].picture, list[1].picture]
    check('Partir un trozo con vídeo encima: la segunda parte sigue donde iba', list.length === 4 && b.kind === 'cover' && b.startMs - a.startMs >= 3800 && b.startMs - a.startMs <= 4200 && b.inset?.corner === 'top-left', `${a.startMs} → ${b.startMs}`)
    await app.click('[data-testid=undo]')
    check('Deshacer el partido', (await clips()).length === 3)
    await app.click('[data-testid=redo]')
    check('Rehacer el partido', (await clips()).length === 4)
  }
  await closeClip()
  await sleep(1200)
  {
    const kinds = await app.evaluate('return [...document.querySelectorAll("[data-testid^=clip-card-] .picture")].map((e) => e.dataset.picture)')
    check('Tarjetas: vídeo encima, vídeo encima, su vídeo, vídeo encima', JSON.stringify(kinds) === '["cover","cover","thumb","cover"]', kinds.join(','))
    await shot('pic-09-tira.png')
  }

  // --- Reproducir todo: el tiempo avanza y el vídeo de encima va sincronizado
  {
    await app.click('[data-testid=clip-card-1]')
    await sleep(500)
    const total = (await playerData()).dur
    await app.click('[data-testid=play-toggle]')
    const samples = []
    const t0 = Date.now()
    for (;;) {
      await sleep(200)
      const d = await playerData()
      samples.push({ ...d, t: Date.now() - t0 })
      if (!d.playing || Date.now() - t0 > total + 15_000) break
    }
    const last = samples[samples.length - 1]
    let backwards = 0
    for (let i = 1; i < samples.length; i++) if (samples[i].ms + 50 < samples[i - 1].ms) backwards++
    // Deriva: solo con el vídeo de encima moviéndose (no recién cambiado de trozo ni ya quieto al final).
    const drifts = []
    for (let i = 1; i < samples.length; i++) {
      const s = samples[i]
      const p = samples[i - 1]
      if (s.picture !== 'cover' || s.cover === null || s.expected === null || p.clip !== s.clip || !p.playing) continue
      if (s.expected - p.expected < 100) continue
      drifts.push(Math.abs(s.cover - s.expected))
    }
    drifts.sort((x, y) => x - y)
    const median = drifts[Math.floor(drifts.length / 2)] ?? -1
    const max = drifts[drifts.length - 1] ?? -1
    const clipsSeen = [...new Set(samples.map((s) => s.clip))]
    check('La vista previa recorre los 4 trozos hasta el final', !last.playing && Math.abs(last.ms - total) < 400 && clipsSeen.length === 4 && backwards === 0, `${clipsSeen.length} trozos, terminó en ${last.ms}/${total} ms, ${backwards} retrocesos, ${Date.now() - t0} ms de reloj`)
    check('El vídeo de encima va sincronizado (mediana ≤ 120 ms, máximo ≤ 300 ms)', drifts.length >= 10 && median <= 120 && max <= 300, `${drifts.length} medidas, mediana ${median} ms, máximo ${max} ms`)
    const frozen = samples.filter((s) => s.clip === 3 && s.expected !== null && s.expected >= 1990)
    check('El vídeo de encima corto se queda en su última imagen', frozen.length > 0 && frozen.every((s) => s.cover >= 1850), frozen.slice(0, 3).map((s) => `${s.cover}/${s.expected}`).join(' '))
  }

  // --- Guardar «Para WhatsApp» y «Solo el sonido»
  let videoPath = null
  let soundPath = null
  {
    const shownMs = Number(await app.evaluate('return document.querySelector("[data-testid=duration-bar]").dataset.durationMs'))
    await app.click('[data-testid=save-video]')
    await waitScreen('save-view')
    await sleep(500)
    check('«Solo el sonido» aparece debajo, más discreta', (await app.text('[data-testid=preset-sound]')).startsWith('Solo el sonido Un fichero de audio, sin imagen') && !(await app.evaluate('return document.querySelector("[data-testid=preset-sound]").classList.contains("featured")')), await app.text('[data-testid=preset-sound]'))
    await shot('pic-10-guardar.png')
    await app.click('[data-testid=preset-whatsapp]')
    await app.waitFor('return document.querySelector("[data-testid=done-view]") || document.querySelector("[data-testid=error-dialog]")', { timeoutMs: 180_000, what: 'fin del guardado' })
    await noErrorDialog('guardar el vídeo')
    videoPath = await S('return store.lastExport.value.path')
    const info = ffprobe(videoPath)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    const dur = Math.round(Number(info.format.duration) * 1000)
    const vd = Math.round(Number(v.duration) * 1000)
    const ad = Math.round(Number(a.duration) * 1000)
    console.log(`      ffprobe vídeo: ${JSON.stringify({ dur, vd, ad, w: v.width, h: v.height, fps: v.avg_frame_rate })}`)
    check('«Para WhatsApp»: 1280×720 a 30 fps, dura lo que decía (±0,3 s) y audio = vídeo', v.width === 1280 && v.height === 720 && v.avg_frame_rate === '30/1' && Math.abs(dur - shownMs) <= 300 && Math.abs(vd - ad) <= 45, `${dur} ms (interfaz ${shownMs}), vídeo ${vd} / audio ${ad}`)

    await app.click('[data-testid=save-another-way]')
    await waitScreen('save-view')
    await app.click('[data-testid=preset-sound]')
    await app.waitFor('return document.querySelector("[data-testid=done-view]") || document.querySelector("[data-testid=error-dialog]")', { timeoutMs: 60_000, what: 'fin del guardado del sonido' })
    await noErrorDialog('guardar el sonido')
    soundPath = await S('return store.lastExport.value.path')
    const s = ffprobe(soundPath)
    const sdur = Math.round(Number(s.format.duration) * 1000)
    const sa = s.streams.find((x) => x.codec_type === 'audio')
    console.log(`      ffprobe sonido: ${JSON.stringify({ sdur, codec: sa?.codec_name, rate: sa?.sample_rate, ch: sa?.channels, streams: s.streams.length })}`)
    check('«Solo el sonido»: «Sonido del … .m4a» en Mis montajes (pruebas)', /\\Mis montajes \(pruebas\)\\Sonido del .+?( \d+)?\.m4a$/.test(soundPath), soundPath)
    check('Sin vídeo, AAC 48 kHz estéreo y dura lo mismo (±0,1 s)', s.streams.length === 1 && sa.codec_name === 'aac' && sa.sample_rate === '48000' && sa.channels === 2 && Math.abs(sdur - shownMs) <= 100, `${sdur} ms (interfaz ${shownMs})`)
    check('«¡Listo!» dice «Escuchar»', (await app.text('[data-testid=open-video]')) === 'Escuchar' && (await app.text('[data-testid=done-view]')).includes('El sonido está guardado'))
    await shot('pic-11-listo-sonido.png')
    await app.click('[data-testid=back-to-editor]')
    await waitScreen('editor')
  }

  // --- Un montaje sin ninguna imagen destaca «Solo el sonido»
  {
    await S('store.apply((p) => p.clips.reduce((q, c) => domain.setPicture(q, c.id, { kind: "none" }), p)); return true')
    await app.click('[data-testid=save-video]')
    await waitScreen('save-view')
    check('Sin imagen: «Solo el sonido» destacada y avisos de fondo liso', !!(await app.text('[data-testid=save-sound-only-hint]')) && (await app.evaluate('return document.querySelector("[data-testid=preset-sound]").classList.contains("featured")')) && (await app.text('[data-testid=preset-whatsapp]')).includes('Saldrá con fondo liso'))
    await shot('pic-12-guardar-sin-imagen.png')
    await app.click('[data-testid=back-editor]')
    await waitScreen('editor')
    await app.click('[data-testid=undo]')
    check('Y se deshace en un paso', (await clips()).filter((c) => c.picture.kind === 'cover').length === 3)
  }

  // --- La duración máxima a medida no se corta a 1100 px
  {
    await app.click('[data-testid=target-button]')
    await app.click('[data-testid=target-custom]')
    // Sin máximo, «Otra…» empieza en 4 minutos: 4 − 2 min + 20 s = 2 minutos y 20 segundos.
    for (let i = 0; i < 2; i++) await app.click('[aria-label="Un minuto menos"]')
    for (let i = 0; i < 4; i++) await app.click('[aria-label="Cinco segundos más"]')
    await app.click('.popover .btn.primary')
    await app.setViewport(1100, 700)
    await sleep(500)
    const fits = () =>
      app.evaluate(`const bar = document.querySelector('[data-testid=duration-bar]').getBoundingClientRect();
        const m = document.querySelector('[data-testid=target-max]'); const r = m.getBoundingClientRect();
        const t = document.querySelector('[data-testid=target-text] .target-main'); const tr = t.getBoundingClientRect();
        const slot = document.querySelector('[data-testid=duration-bar] .slot')?.getBoundingClientRect();
        const limit = slot && slot.width > 0 ? slot.left : bar.right;
        return { text: m.innerText, main: t.innerText, inside: r.right <= limit + 0.5 && tr.right <= limit + 0.5 && r.width > 0,
          clipped: m.scrollWidth > m.clientWidth + 1 || t.scrollWidth > t.clientWidth + 1 || t.innerText.includes('…') }`)
    const f1 = await fits()
    check('«(máx. 2 min 20 s)» entero en «Tu vídeo» a 1100 px', f1.text === '(máx. 2 min 20 s)' && f1.inside && !f1.clipped, JSON.stringify(f1))
    await shot('pic-13-duracion-1100.png')
    await openClip(3)
    await tab('pauses')
    const f2 = await fits()
    check('Y en «Arreglar este trozo» a 1100 px', f2.text === '(máx. 2 min 20 s)' && f2.inside && !f2.clipped, JSON.stringify(f2))
    await tab('picture')
    await shot('pic-14-arreglar-imagen-1100.png')
    await closeClip()
    await app.setViewport(1280, 800)
  }

  // --- El vídeo de encima desaparece: aviso y «Quitar el vídeo de encima» sin perder el trozo
  {
    await app.waitFor('const b = window.__easyCut.bridge; const d = window.__easyCut.domain; return (await b.loadAutosave()) === d.serializeProject(window.__easyCut.store.project.value)', { timeoutMs: 5000, what: 'autoguardado al día' })
    await app.evaluate('location.reload(); return true')
    await sleep(400)
    unlinkSync(doomedCover)
    await sleep(1200)
    app.close()
    app = await connectToApp(port)
    await app.waitFor('return !!window.__easyCut?.store')
    await app.setViewport(1280, 800)
    await app.waitFor('return !!document.querySelector("[data-testid=resume-card]")', { timeoutMs: 10_000, what: 'vídeo sin terminar' })
    await app.click('[data-testid=resume]')
    await waitScreen('editor')
    const lost = await app.waitFor('const c = document.querySelector("[data-testid=clip-card-4]"); return c && c.innerText.includes("No encuentro el vídeo de encima") ? c.innerText : null', { timeoutMs: 10_000, what: 'tarjeta sin vídeo de encima' })
    check('La tarjeta dice «No encuentro el vídeo de encima»', !!lost)
    await app.click('[data-testid=clip-card-4]')
    check('El panel lo explica y ofrece quitarlo', !!(await app.text('[data-testid=cover-lost-panel]')) && !!(await app.text('[data-testid=remove-lost-cover]')))
    await shot('pic-15-encima-perdido.png')
    await app.click('[data-testid=save-video]')
    check('No deja guardar mientras falte', (await app.text('[data-testid=toast]'))?.startsWith('Antes de guardar, quita') && !!(await app.text('[data-testid=editor]')))
    await app.click('[data-testid=remove-lost-cover]')
    const c4 = (await clips())[3]
    check('«Quitar el vídeo de encima» deja el trozo (otra vez «Solo se oye»)', (await clips()).length === 4 && c4.picture.kind === 'none' && c4.path === media.voice)
  }
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? e.stack ?? e.message : String(e))
  try {
    await app?.screenshot(join(opts.shots, 'pic-zz-fallo.png'))
  } catch {
    // Sin captura.
  }
} finally {
  app?.close()
  if (existsSync(doomedCover)) {
    try {
      unlinkSync(doomedCover)
    } catch {
      // Se borra en la próxima.
    }
  }
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
