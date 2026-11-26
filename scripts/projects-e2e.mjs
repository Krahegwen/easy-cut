// Prueba de extremo a extremo de los ficheros y los proyectos, en la app Tauri real por CDP y con los botones
// de verdad: el autoguardado de antes pasa a la lista sin perderse; la lista de Inicio (crear dos, abrir,
// cambiar el nombre, duplicar, borrar con su pregunta y «Deshacer», reiniciar la app y que sigan, y deshacer
// después de reiniciar); «De mi ordenador» (lo traído, sus usos y las tres acciones; una imagen no puede ser
// trozo); y volver a enlazar originales movidos (uno que no cuadra, con su aviso, y varios de la misma carpeta
// a la vez, también un sonido de una pista). Capturas proj-*.png en test-output/screenshots/.
//
// PowerShell (con Rust/cargo en el PATH, la app cerrada y los ficheros de `pnpm test:ffmpeg` en test-output):
//   node scripts/projects-e2e.mjs
// Con la app ya abierta a mano: --no-launch (sin la parte de reiniciar).
//
// Trabaja con copias en una carpeta temporal (los originales de test-output no se mueven) y la borra al acabar;
// deja la lista de vídeos de la app de desarrollo vacía. Sale con 1 si algo falla.

import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
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

const media = {
  horizontal: resolve(opts.media, 'src-horizontal-1080p30.mp4'),
  vertical: resolve(opts.media, 'src-vertical-1080x1920-60.mp4'),
  noAudio: resolve(opts.media, 'src-no-audio-720p30.mp4'),
  voice: resolve(opts.media, 'src-voice-silence.m4a'),
  image: resolve('library', 'dist', 'marco-dorado.png'),
}
for (const p of Object.values(media)) if (!existsSync(p)) throw new Error(`Falta ${p}: ejecuta pnpm test:ffmpeg (y node scripts/build-library.mjs para la imagen)`)

// Carpeta temporal con nombres con espacios y tildes: «antes» (donde estaban) y «después» (donde se movieron).
const work = join(tmpdir(), `easy-cut e2e proyectos ${process.pid}`)
const before = join(work, 'Vídeos de antes')
const after = join(work, 'Vídeos movidos')
mkdirSync(before, { recursive: true })
mkdirSync(after, { recursive: true })
const moving = {
  main: join(before, 'boda.mp4'),
  second: join(before, 'banquete sin sonido.mp4'),
  voice: join(before, 'discurso.m4a'),
}
copyFileSync(media.horizontal, moving.main)
copyFileSync(media.noAudio, moving.second)
copyFileSync(media.voice, moving.voice)
const pngCopy = join(work, 'marco.png')
copyFileSync(media.image, pngCopy)

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

async function connect() {
  app = await connectToApp(port, { timeoutMs: 240_000 })
  await app.waitFor('return !!window.__easyCut?.store', { timeoutMs: 60_000, what: 'store de la app (modo desarrollo)' })
  await app.setViewport(1280, 800)
}

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

const S = (expr, args = {}) => app.evaluate(`const store = window.__easyCut.store; const tracks = window.__easyCut.tracks; const domain = window.__easyCut.domain; ${expr}`, args)
const queuePick = (paths) => app.evaluate('window.__easyCut.queuePickedVideos(args.p); return true', { p: paths })
const clipPaths = () => S('return store.project.value.clips.map((c) => c.sourcePath)')
const screen = () => S('return store.screen.value')
const cards = () => app.evaluate('return [...document.querySelectorAll("[data-testid=project-card]")].map((c) => ({ id: c.dataset.projectId, name: c.querySelector("[data-testid=project-name]")?.innerText ?? "", meta: c.querySelector("[data-testid=project-meta]")?.innerText ?? "", when: c.querySelector("[data-testid=project-when]")?.innerText ?? "" }))')
const card = (id) => `[data-testid=project-card][data-project-id="${id}"]`

async function waitScreen(name, timeoutMs = 20_000) {
  await app.waitFor('return window.__easyCut.store.screen.value === args.name', { args: { name }, timeoutMs, what: `pantalla ${name}` })
  await sleep(250)
}

/** Que el vídeo abierto esté guardado tal como está (el autoguardado lleva una espera). */
async function waitSaved() {
  await app.waitFor(
    'const s = window.__easyCut.store; const d = window.__easyCut.domain; return !!s.projectId.value && (await window.__easyCut.bridge.readProject(s.projectId.value)) === d.serializeProject(s.project.value, { name: s.projectName.value })',
    { timeoutMs: 8000, what: 'vídeo guardado y al día' },
  )
}

async function newVideoWith(paths) {
  await app.click('[data-testid=new-video]')
  await waitScreen('pick')
  await queuePick(paths)
  await app.click('[data-testid=pick-videos]')
  await waitScreen('editor', 30_000)
  await app.waitFor('return !document.querySelector("[data-testid=preparing]")', { timeoutMs: 30_000 })
  await noErrorDialog('añadir vídeos')
  await waitSaved()
  return S('return store.projectId.value')
}

async function goHome() {
  await app.click('[data-testid=go-home]')
  await waitScreen('home')
}

/** Escribe en un cuadro de texto como si se tecleara (valor + evento input) y pulsa Intro. */
async function typeAndEnter(selector, value) {
  await app.evaluate('const el = document.querySelector(args.s); el.value = args.v; el.dispatchEvent(new Event("input", { bubbles: true })); return true', { s: selector, v: value })
  await app.key('Enter')
  await sleep(300)
}

/** El diseño de Inicio a este tamaño: nada se sale por la derecha y lo principal se ve. */
async function homeLayout() {
  return app.evaluate(`const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const nv = r('[data-testid=new-video]'), list = r('[data-testid=project-list]');
    const tools = [...document.querySelectorAll('[data-testid=project-card] .tools')].every((t) => t.scrollWidth <= t.clientWidth + 1);
    const names = [...document.querySelectorAll('[data-testid=project-name]')].every((n) => n.getBoundingClientRect().right <= innerWidth);
    return { overflow: document.documentElement.scrollWidth - innerWidth, newVisible: !!nv && nv.top >= 0 && nv.bottom <= innerHeight, listTop: list ? Math.round(list.top) : null, tools, names }`)
}

// ================================================================== prueba

try {
  await startApp()
  await connect()
  console.log(`Conectado a ${app.url}`)

  // --- El autoguardado de antes (un solo vídeo a medias, versión 3) pasa a la lista sin perderse
  {
    await app.evaluate(
      `const b = window.__easyCut.bridge; const d = window.__easyCut.domain;
       await window.__easyCut.resetProjects();
       const info = await b.probe(args.h);
       let p = d.addClip(d.createProject(), d.createClip(info, 'antiguo'));
       const file = JSON.parse(d.serializeProject(p)); file.version = 3; delete file.project.media;
       await b.saveAutosave(JSON.stringify(file, null, 2));
       location.reload(); return true`,
      { h: media.horizontal },
    )
    await sleep(1500)
    app.close()
    await connect()
    await app.waitFor('return document.querySelectorAll("[data-testid=project-card]").length === 1', { timeoutMs: 15_000, what: 'el vídeo de antes en la lista' })
    const [migrated] = await cards()
    check('El vídeo a medias de antes aparece en la lista, con nombre y trozos', /^Vídeo del \d+ de [a-z]+$/.test(migrated.name) && migrated.meta.startsWith('1 trozo'), JSON.stringify(migrated))
    check('…y el autoguardado de antes se ha borrado (después de guardarlo en la lista)', (await app.evaluate('return await window.__easyCut.bridge.loadAutosave()')) === null)
    await app.click(`${card(migrated.id)} [data-testid=project-open]`)
    await waitScreen('editor')
    check('Se abre con su trozo', JSON.stringify(await clipPaths()) === JSON.stringify([media.horizontal]))
    await app.waitFor('return window.__easyCut.store.project.value.media[0]?.probed === true', { what: 'lista de ficheros medida al abrir' })
    check('Al abrirlo, la lista de ficheros del proyecto se completa con ffprobe', (await S('return store.project.value.media[0].width')) === 1920)
    await waitSaved()
    await goHome()
    await app.click(`${card(migrated.id)} [data-testid=project-delete]`)
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    await app.click('[data-testid=confirm-ok]')
    await app.waitFor('return document.querySelectorAll("[data-testid=project-card]").length === 0', { what: 'lista vacía' })
    check('Con la lista vacía, Inicio es como siempre', !(await app.text('[data-testid=project-list]')))
  }

  // --- Dos vídeos en marcha a la vez
  const idA = await newVideoWith([media.horizontal, media.vertical])
  await goHome()
  const idB = await newVideoWith([media.noAudio])
  await goHome()
  await app.waitFor('return document.querySelectorAll("[data-testid=project-card]").length === 2', { what: 'dos vídeos en la lista' })
  {
    const list = await cards()
    check('Los dos vídeos están en la lista, el último primero', list.map((c) => c.id).join() === [idB, idA].join(), JSON.stringify(list))
    check('Nombres por defecto distintos («… (2)»)', list[0].name === `${list[1].name} (2)`, list.map((c) => c.name).join(' | '))
    check('Cada tarjeta dice trozos, duración y cuándo se tocó', list[1].meta === '2 trozos · dura 18 s' && list[0].meta === '1 trozo · dura 6 s' && list.every((c) => c.when === 'Hace un momento'), JSON.stringify(list))
    await app.waitFor('return [...document.querySelectorAll("[data-testid=project-card] .thumb img")].length === 2', { timeoutMs: 15_000, what: 'miniaturas de la lista' })
    check('Cada tarjeta lleva su miniatura', true)
    for (const [w, h, name] of [[1280, 800, 'proj-01-inicio-lista-1280x800.png'], [1100, 700, 'proj-02-inicio-lista-1100x700.png']]) {
      await app.setViewport(w, h)
      await shot(name)
      const l = await homeLayout()
      check(`Inicio con lista a ${w}×${h}: nada se sale, «Hacer un vídeo nuevo» a la vista y los botones de cada tarjeta caben`, l.overflow <= 0 && l.newVisible && l.tools && l.names && l.listTop !== null && l.listTop < h, JSON.stringify(l))
    }
    await app.setViewport(1280, 800)
  }

  // Abrir, cambiar el nombre (Esc cancela), duplicar y borrar
  await app.click(`${card(idA)} [data-testid=project-open]`)
  await waitScreen('editor')
  check('Abrir el primero trae sus dos trozos', JSON.stringify(await clipPaths()) === JSON.stringify([media.horizontal, media.vertical]))
  await goHome()
  {
    await app.click(`${card(idA)} [data-testid=project-rename]`)
    await app.waitFor('return document.activeElement?.dataset.testid === "project-rename-input"', { what: 'cuadro del nombre' })
    await app.evaluate('const el = document.activeElement; el.value = "No vale"; el.dispatchEvent(new Event("input", { bubbles: true })); return true')
    await app.key('Escape')
    await sleep(300)
    check('Esc en el nombre lo deja como estaba', !(await app.text(card(idA))).includes('No vale'))
    await app.click(`${card(idA)} [data-testid=project-rename]`)
    await app.waitFor('return !!document.querySelector("[data-testid=project-rename-input]")')
    await typeAndEnter('[data-testid=project-rename-input]', '  Boda de Ana  ')
    await app.waitFor('return document.querySelector(args.s)?.querySelector("[data-testid=project-name]")?.innerText === "Boda de Ana"', { args: { s: card(idA) }, what: 'nombre nuevo' })
    const fileName = await app.evaluate('const j = await window.__easyCut.bridge.readProject(args.id); return JSON.parse(j).name', { id: idA })
    check('Cambiar el nombre: se ve y se guarda en el fichero', fileName === 'Boda de Ana', fileName)
    await shot('proj-03-inicio-nombre.png')
    await app.click(`${card(idA)} [data-testid=project-duplicate]`)
    await app.waitFor('return document.querySelectorAll("[data-testid=project-card]").length === 3', { what: 'la copia' })
    const copy = (await cards()).find((c) => c.name === 'Boda de Ana (copia)')
    check('Duplicar: «Boda de Ana (copia)» con lo mismo', !!copy && copy.meta === '2 trozos · dura 18 s', JSON.stringify(copy))
    await app.click(`${card(copy.id)} [data-testid=project-delete]`)
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    const question = await app.text('[data-testid=confirm-dialog]')
    check('Borrar pregunta, y dice que los originales no se tocan', question.includes('¿Borrar «Boda de Ana (copia)»?') && question.includes('Tus vídeos originales'), question)
    await app.key('Enter')
    check('Intro en esa pregunta es «No, volver»', (await cards()).length === 3)
    await app.click(`${card(copy.id)} [data-testid=project-delete]`)
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    await app.click('[data-testid=confirm-ok]')
    await app.waitFor('return document.querySelectorAll("[data-testid=project-card]").length === 2', { what: 'copia borrada' })
    check('Borrar no toca los originales', existsSync(media.horizontal) && existsSync(media.vertical))
    const toast = await app.text('[data-testid=toast]')
    check('Aviso de borrado con «Deshacer»', !!toast && toast.includes('borrado de la lista') && toast.includes('Deshacer'), toast ?? '')
    await app.click('[data-testid=toast-action]')
    await app.waitFor('return document.querySelectorAll("[data-testid=project-card]").length === 3', { what: 'copia recuperada' })
    check('«Deshacer» la vuelve a poner', (await cards()).some((c) => c.name === 'Boda de Ana (copia)'))
    await app.click(`${card(copy.id)} [data-testid=project-delete]`)
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    await app.click('[data-testid=confirm-ok]')
    await app.waitFor('return document.querySelectorAll("[data-testid=project-card]").length === 2')
  }

  // Reiniciar la app: siguen los dos, con su nombre, y deshacer sigue valiendo
  if (launch) {
    app.close()
    await stopApp()
    await startApp()
    await connect()
    await app.waitFor('return document.querySelectorAll("[data-testid=project-card]").length === 2', { timeoutMs: 15_000, what: 'la lista tras reiniciar' })
    const list = await cards()
    check('Tras reiniciar la app, siguen los dos con su nombre', list.some((c) => c.id === idA && c.name === 'Boda de Ana') && list.some((c) => c.id === idB), JSON.stringify(list))
    await app.click(`${card(idA)} [data-testid=project-open]`)
    await waitScreen('editor')
    check('Deshacer sobrevive a cerrar la app', (await S('return store.undoable.value')) === true)
    await app.key('z', { ctrl: true })
    check('…y deshace de verdad (lo último fue añadir los dos trozos)', (await clipPaths()).length === 0)
    await app.key('y', { ctrl: true })
    check('…y rehacer los vuelve a poner', (await clipPaths()).length === 2)
  } else {
    await app.click(`${card(idA)} [data-testid=project-open]`)
    await waitScreen('editor')
  }

  // --- «De mi ordenador»: lo ya traído, aunque se haya quitado, con sus usos y las tres acciones
  {
    await app.click('[data-testid=clip-block-2]')
    await app.key('Delete')
    check('Quitado el trozo del vídeo vertical', JSON.stringify(await clipPaths()) === JSON.stringify([media.horizontal]))
    await app.click('[data-testid=add-sounds-effects]')
    await app.waitFor('return !!document.querySelector("[data-testid=library-panel]")')
    await app.click('[data-testid=library-tab-computer]')
    await app.waitFor('return document.querySelectorAll("[data-testid=pool-item]").length === 2', { what: 'lista de lo traído' })
    const items = () => app.evaluate('return [...document.querySelectorAll("[data-testid=pool-item]")].map((e) => ({ path: e.dataset.path, kind: e.dataset.kind, uses: Number(e.dataset.uses), text: e.innerText.replace(/\\s+/g, " "), clip: !!e.querySelector("[data-testid=pool-as-clip]"), effect: !!e.querySelector("[data-testid=pool-as-effect]"), sound: !!e.querySelector("[data-testid=pool-as-sound]"), img: !!e.querySelector("img") }))')
    await app.waitFor('return [...document.querySelectorAll("[data-testid=pool-item]")].every((e) => !!e.querySelector("img"))', { timeoutMs: 15_000, what: 'miniaturas de lo traído' })
    let list = await items()
    check('Lista lo traído, aunque se haya quitado el trozo (lo último, primero)', list.map((i) => i.path).join() === [media.vertical, media.horizontal].join(), JSON.stringify(list.map((i) => i.path)))
    check('Con sus usos: «Ahora no se usa» y «Se usa 1 vez»', list[0].uses === 0 && list[0].text.includes('Ahora no se usa') && list[1].uses === 1 && list[1].text.includes('Se usa 1 vez'), list.map((i) => i.text).join(' | '))
    check('Con duración y miniatura', list[0].text.includes('Vídeo · 8 s') && list.every((i) => i.img), list.map((i) => i.text).join(' | '))
    check('Un vídeo con sonido: trozo, encima y sonido', list[1].clip && list[1].effect && list[1].sound)
    await shot('proj-04-de-mi-ordenador.png')
    // Las tres acciones
    await app.click(`[data-testid=pool-item][data-path="${media.vertical.replace(/\\/g, '\\\\')}"] [data-testid=pool-as-clip]`)
    await app.waitFor('return window.__easyCut.store.project.value.clips.length === 2', { what: 'trozo vuelto a poner' })
    check('«Trozo»: vuelve al final del vídeo', JSON.stringify(await clipPaths()) === JSON.stringify([media.horizontal, media.vertical]))
    await S('tracks.playheadMs.value = 1000; return true')
    const hSel = `[data-testid=pool-item][data-path="${media.horizontal.replace(/\\/g, '\\\\')}"]`
    await app.click(`${hSel} [data-testid=pool-as-effect]`)
    await app.waitFor('return window.__easyCut.store.project.value.tracks.some((t) => t.kind === "effect" && t.items.length > 0)', { what: 'efecto puesto' })
    await app.click(`${hSel} [data-testid=pool-as-sound]`)
    await app.waitFor('return window.__easyCut.store.project.value.tracks.some((t) => t.kind === "sound" && t.items.length > 0)', { what: 'sonido puesto' })
    list = await items()
    const h = list.find((i) => i.path === media.horizontal)
    check('«Encima» y «Sonido»: el mismo fichero se usa ya 3 veces', h.uses === 3 && h.text.includes('Se usa 3 veces'), h.text)
    const uses = await S('const u = domain.mediaUsage(store.project.value).get(args.h); return u', { h: media.horizontal })
    check('…una como trozo, otra como efecto y otra como sonido', uses.clips === 1 && uses.effects === 1 && uses.sounds === 1, JSON.stringify(uses))
    // Una imagen: solo «Encima»
    await queuePick([pngCopy])
    await app.click('[data-testid=library-pick-files]')
    await app.waitFor('return document.querySelectorAll("[data-testid=pool-item]").length === 3', { timeoutMs: 15_000, what: 'la imagen en la lista' })
    const img = (await items()).find((i) => i.kind === 'image')
    check('Una imagen: solo «Encima» (todavía no puede ser un trozo)', !!img && img.effect && !img.clip && !img.sound && img.text.includes('Imagen'), JSON.stringify(img))
    await shot('proj-05-de-mi-ordenador-acciones.png')
    await app.click('[data-testid=library-close]')
    await waitSaved()
    await goHome()
  }

  // --- Volver a enlazar: originales movidos a otra carpeta
  {
    await app.click(`${card(idB)} [data-testid=project-open]`)
    await waitScreen('editor')
    // Vídeo C, con tres ficheros de la misma carpeta (dos trozos y un sonido en una pista).
    await goHome()
    const idC = await newVideoWith([moving.main, moving.second])
    await S('tracks.playheadMs.value = 500; return true')
    await S('await tracks.addFiles([args.v], 500); return true', { v: moving.voice })
    await waitSaved()
    await goHome()
    for (const p of Object.values(moving)) renameSync(p, join(after, p.slice(before.length + 1)))
    await app.click(`${card(idC)} [data-testid=project-open]`)
    await waitScreen('editor')
    await app.waitFor('return window.__easyCut.store.missingPaths().length === 3', { timeoutMs: 15_000, what: 'los tres que faltan' })
    check('Al abrirlo, se sabe que faltan los tres movidos', true)
    // El sonido perdido de la pista se ve y ofrece «Buscarlo»
    const itemId = await S('return store.project.value.tracks.flatMap((t) => t.items)[0].id')
    await app.click(`[data-testid=track-item][data-item-id="${itemId}"]`)
    await app.waitFor('return !!document.querySelector("[data-testid=item-lost]")', { what: 'barra del sonido perdido' })
    check('Un sonido perdido de una pista dice «No encuentro…» y ofrece «Buscarlo»', (await app.text('[data-testid=item-lost]')).includes('No encuentro') && !!(await app.text('[data-testid=relink-item]')))
    await app.key('Escape')
    await app.click('[data-testid=clip-block-1]')
    await app.waitFor('return !!document.querySelector("[data-testid=relink-clip]")', { what: '«Buscarlo» del trozo' })
    // Uno que no cuadra: aviso antes de aceptarlo, explicando qué no coincide
    await queuePick([media.vertical])
    await app.click('[data-testid=relink-clip]')
    await app.waitFor('return !!document.querySelector("[data-testid=relink-dialog]")', { timeoutMs: 15_000, what: 'aviso de que no cuadra' })
    const warn = await app.text('[data-testid=relink-dialog]')
    check('Si no cuadra, avisa antes y dice qué no coincide (duración, tamaño)', warn.includes('no es igual que el de antes') && warn.includes('Dura 8 s y el de antes duraba 10 s') && warn.includes('1080 × 1920'), warn)
    await shot('proj-06-reenlazar-no-cuadra.png')
    await app.key('Escape')
    await sleep(300)
    check('Cancelar no cambia nada', (await clipPaths())[0] === moving.main && !(await app.text('[data-testid=relink-dialog]')))
    // El bueno, y los demás de la misma carpeta, de una vez
    await queuePick([join(after, 'boda.mp4')])
    await app.click('[data-testid=relink-clip]')
    await app.waitFor('return !!document.querySelector("[data-testid=relink-siblings]")', { timeoutMs: 15_000, what: 'los de la misma carpeta' })
    const offer = await app.text('[data-testid=relink-dialog]')
    const siblings = await app.evaluate('return [...document.querySelectorAll("[data-testid=relink-sibling] input")].map((i) => ({ path: i.dataset.path, checked: i.checked }))')
    check('Ofrece los otros dos que faltaban en esa carpeta, ya marcados', siblings.length === 2 && siblings.every((s) => s.checked) && offer.includes('banquete sin sonido.mp4') && offer.includes('discurso.m4a'), offer)
    await shot('proj-07-reenlazar-carpeta.png')
    await app.key('Enter')
    await app.waitFor('return window.__easyCut.store.missingPaths().length === 0', { timeoutMs: 10_000, what: 'todo encontrado' })
    const paths = await clipPaths()
    const voicePath = await S('return store.project.value.tracks.flatMap((t) => t.items)[0].source.path')
    check('Los tres apuntan a la carpeta nueva (trozos y sonido de la pista)', paths[0] === join(after, 'boda.mp4') && paths[1] === join(after, 'banquete sin sonido.mp4') && voicePath === join(after, 'discurso.m4a'), JSON.stringify([...paths, voicePath]))
    check('Aviso: «Encontrados 3 ficheros…»', ((await app.text('[data-testid=toast]')) ?? '').startsWith('Encontrados 3 ficheros'))
    check('Ya deja guardar (no falta nada)', (await S('return store.hasMissing.value')) === false)
    await app.key('z', { ctrl: true })
    check('Deshacer lo vuelve a dejar como estaba (un solo paso)', (await clipPaths())[0] === moving.main && (await S('return store.missingPaths().length')) === 3)
    await app.key('y', { ctrl: true })
    check('Rehacer', (await S('return store.missingPaths().length')) === 0)
    await noErrorDialog('volver a enlazar')
  }
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? e.stack ?? e.message : String(e))
  try {
    await app?.screenshot(join(opts.shots, 'proj-zz-fallo.png'))
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
  try {
    rmSync(work, { recursive: true, force: true })
  } catch (err) {
    console.log(`      no se ha podido borrar ${work}: ${err}`)
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
process.exit(failed.length ? 1 : 0)
