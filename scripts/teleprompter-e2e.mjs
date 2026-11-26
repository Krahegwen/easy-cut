// Prueba de extremo a extremo del teleprompter en la app Tauri real, por CDP: escribir el texto, comprobar
// palabras, duración y ritmo (con y sin duración máxima), ensayar midiendo el avance real del texto,
// preparar la cámara, grabar ~12 s con una pausa de ~3 s, revisar, usar la grabación y comprobar el MP4
// con ffprobe; también «Repetir», salir a mitad de grabación y que no quede la cámara encendida.
//
// PowerShell (con Rust/cargo en el PATH y la app cerrada):
//   node scripts/teleprompter-e2e.mjs
// Con la cámara y el micrófono falsos de WebView2 (y entonces con capturas tp-*.png en test-output/screenshots):
//   node scripts/teleprompter-e2e.mjs --fake-media
// Con la app ya abierta a mano: --no-launch. Sin capturas: --no-shots.
//
// Sin --fake-media se usan la cámara y el micrófono de verdad y NO se hacen capturas (saldría la habitación).
// Borra al acabar las grabaciones que ha hecho y cierra la app que haya arrancado. Sale con 1 si algo falla.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { appTestEnv, APP_LAUNCH_OPTIONS, connectToApp, sleep } from './cdp.mjs'

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: '4853' },
    shots: { type: 'string', default: resolve('test-output', 'screenshots') },
    'fake-media': { type: 'boolean', default: false },
    'no-launch': { type: 'boolean', default: false },
    'no-shots': { type: 'boolean', default: false },
    'keep-open': { type: 'boolean', default: false },
    ...APP_LAUNCH_OPTIONS,
  },
})
const port = Number(opts.port)
const launch = !opts['no-launch']
const fake = opts['fake-media']
// Con la cámara de verdad no se hacen capturas: saldría quien esté delante.
const takeShots = fake && !opts['no-shots']
mkdirSync(opts.shots, { recursive: true })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}

// La app de desarrollo guarda en su propia carpeta (commands.rs), no en la de la app instalada.
const recordingsFolder = join(homedir(), 'Videos', 'Mis montajes (pruebas)', 'Grabaciones')
const recordingsBefore = new Set(existsSync(recordingsFolder) ? readdirSync(recordingsFolder) : [])
const tempFiles = new Set()

function ffprobeJson(path) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,duration,avg_frame_rate,width,height', '-of', 'json', path], { encoding: 'utf8' })
  return JSON.parse(out)
}

// ------------------------------------------------------------------ texto de prueba: 320 palabras en 4 párrafos

const POOL = (
  'Hoy os quiero contar cómo preparamos el huerto del colegio durante todo el curso con los alumnos de quinto ' +
  'primero limpiamos la tierra quitamos las piedras y pusimos abono natural que trajeron las familias después ' +
  'elegimos qué plantar tomates lechugas habas y unas cuantas flores para atraer a las abejas cada semana un grupo ' +
  'se encargaba de regar y de apuntar en el cuaderno cuánto había crecido cada planta y si había alguna plaga'
).split(' ')
function paragraph(offset, n) {
  const words = Array.from({ length: n }, (_, i) => POOL[(offset + i) % POOL.length])
  words[0] = words[0][0].toUpperCase() + words[0].slice(1)
  // Unas comas y un punto final, para que parezca un texto de verdad.
  return words.map((w, i) => (i === n - 1 ? `${w}.` : i % 13 === 12 ? `${w},` : w)).join(' ')
}
const SCRIPT = [paragraph(0, 80), paragraph(17, 80), paragraph(33, 80), paragraph(51, 80)].join('\n\n')

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
  const env = { ...process.env, ...appTestEnv(port, { withSound: opts['with-sound'], foreground: opts.foreground, extra: fake ? ['--use-fake-device-for-media-stream'] : [] }), PATH: `${join(homedir(), '.cargo', 'bin')};${process.env.PATH}` }
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
  if (!takeShots) return
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

async function waitStep(step, timeoutMs = 20_000) {
  await app.waitFor('const v = document.querySelector("[data-testid=teleprompter-view]"); return v && v.dataset.step === args.s', { args: { s: step }, timeoutMs, what: `paso ${step}` })
  await sleep(150)
}

async function waitScreen(testid, timeoutMs = 20_000) {
  await app.waitFor(`return !!document.querySelector('[data-testid=${testid}]')`, { timeoutMs, what: `pantalla ${testid}` })
  await sleep(200)
}

const prompter = () => app.evaluate('const r = document.querySelector("[data-testid=prompter-run]"); if (!r || !r.prompterState) return null; const t = document.querySelector("[data-testid=prompter-text]").style.transform; return { ...r.prompterState, transform: t }')
const liveTracks = () => app.evaluate('return window.__easyCut.liveTracks()')

async function waitRunning(timeoutMs = 10_000) {
  await app.waitFor('const r = document.querySelector("[data-testid=prompter-run]"); return r && r.dataset.phase === "running"', { timeoutMs, what: 'texto en marcha' })
}

/** Elige una duración máxima con el control (null = sin límite; {m, s} = «Otra…»). */
async function chooseTarget(value) {
  await app.click('[data-testid=target-button]')
  if (value === null) await app.click('[data-testid=target-none]')
  else if (typeof value === 'number') await app.click(`[data-testid=target-${value}]`)
  else {
    await app.click('[data-testid=target-custom]')
    // Se parte de lo que hubiera; se ajusta con los botones como lo haría una persona.
    const cur = await app.evaluate('return [...document.querySelectorAll(".popover .value strong")].map((e) => Number(e.innerText))')
    for (let i = cur[0]; i < value.m; i++) await app.click('[aria-label="Un minuto más"]')
    for (let i = cur[0]; i > value.m; i--) await app.click('[aria-label="Un minuto menos"]')
    for (let i = cur[1]; i < value.s; i += 5) await app.click('[aria-label="Cinco segundos más"]')
    for (let i = cur[1]; i > value.s; i -= 5) await app.click('[aria-label="Cinco segundos menos"]')
    await app.click('.popover .btn.primary')
  }
  await sleep(150)
}

async function confirmDialog(ok = true) {
  await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")', { what: 'pregunta de confirmación' })
  const text = await app.text('[data-testid=confirm-dialog]')
  await app.click(ok ? '[data-testid=confirm-ok]' : '[data-testid=confirm-cancel]')
  await sleep(200)
  return text
}

function assetToPath(url) {
  const m = /^https?:\/\/asset\.localhost\/(.+)$/.exec(url)
  return m ? decodeURIComponent(m[1]) : null
}

async function waitCameraReady() {
  return app.waitFor(
    'const v = document.querySelector("[data-testid=camera-preview]"); if (document.querySelector("[data-testid=camera-problem]")) return { problem: document.querySelector("[data-testid=camera-problem]").innerText }; return v && v.videoWidth > 0 ? { w: v.videoWidth, h: v.videoHeight, mirrored: getComputedStyle(v).transform } : null',
    { timeoutMs: 20_000, what: 'imagen de la cámara' },
  )
}

// ================================================================== prueba

try {
  await startApp()
  app = await connectToApp(port, { timeoutMs: 300_000 })
  console.log(`Conectado a ${app.url} (${fake ? 'cámara falsa' : 'cámara de verdad'})`)
  await app.waitFor('return !!window.__easyCut?.store', { timeoutMs: 60_000, what: 'store de la app (modo desarrollo)' })
  // Punto de partida limpio: sin autoguardado ni texto recordado.
  await app.evaluate('await window.__easyCut.bridge.clearAutosave(); localStorage.removeItem("easy-cut:teleprompter"); location.reload(); return true')
  await sleep(1500)
  app.close()
  app = await connectToApp(port)
  await app.waitFor('return !!window.__easyCut?.store')
  await app.setViewport(1280, 800)

  // --- 1. El texto
  await waitScreen('teleprompter')
  await app.click('[data-testid=teleprompter]')
  await waitStep('script')
  check('Sin texto: «Todavía no hay texto» y no deja seguir', (await app.text('[data-testid=script-length]')) === 'Todavía no hay texto' && (await app.center('[data-testid=go-camera]')).disabled)
  await shot('tp-01-texto-vacio.png')

  await app.click('[data-testid=script-input]')
  await app.send('Input.insertText', { text: SCRIPT })
  await sleep(300)
  const parsed = await app.evaluate('const s = window.__easyCut.domain.parseScript(args.t); return { words: s.words, pauses: s.pauses }', { t: SCRIPT })
  check('El texto de prueba tiene 320 palabras en 4 párrafos', parsed.words === 320 && parsed.pauses === 3, JSON.stringify(parsed))
  {
    const t = await app.text('[data-testid=script-length]')
    check('«320 palabras · leyéndolo a ritmo normal dura unos 2 min 20 s»', t === '320 palabras · leyéndolo a ritmo normal dura unos 2 min 20 s', t)
    check('Sin duración máxima no hay consejo de ritmo', !(await app.text('[data-testid=fit-advice]')))
    check('Sin duración máxima, «Ajustado al tiempo» está desactivado', (await app.center('[data-testid=pace-fit]')).disabled)
  }
  await shot('tp-02-texto.png')

  // Despacio / Rápido / ajuste fino
  await app.click('[data-testid=pace-slow]')
  check('«Despacio»: 115 palabras por minuto', (await app.text('[data-testid=pace-wpm]')) === '115 palabras por minuto' && (await app.text('[data-testid=script-length]')).includes('leyéndolo despacio dura unos 2 min 50 s'), await app.text('[data-testid=script-length]'))
  await app.click('[data-testid=pace-fast]')
  check('«Rápido»: 165 palabras por minuto', (await app.text('[data-testid=pace-wpm]')) === '165 palabras por minuto')
  await app.click('[data-testid=pace-normal]')
  await app.click('[data-testid=pace-faster]')
  check('«Un poco más rápido»: 145', (await app.text('[data-testid=pace-wpm]')) === '145 palabras por minuto' && (await app.text('[data-testid=script-length]')).includes('a tu ritmo'))
  await app.click('[data-testid=pace-slower]')
  check('«Un poco más lento» vuelve a 140', (await app.text('[data-testid=pace-wpm]')) === '140 palabras por minuto')

  // Con duración máxima: los cuatro casos
  await chooseTarget(5)
  check('5 minutos: te sobra tiempo', (await app.text('[data-testid=fit-title]')) === 'Te sobra tiempo: aunque leas despacio, cabe de sobra en 5 minutos', await app.text('[data-testid=fit-title]'))
  await chooseTarget(2)
  {
    const title = await app.text('[data-testid=fit-title]')
    const hint = await app.text('[data-testid=fit-hint]')
    check('2 minutos: «un poco rápido» y cuántas palabras quitar', title === 'Para que quepa en 2 minutos tienes que leer un poco rápido' && hint === 'Si quitas unas 30 palabras, podrás leer a ritmo cómodo.', `${title} / ${hint}`)
  }
  await chooseTarget(1)
  {
    const title = await app.text('[data-testid=fit-title]')
    check('1 minuto: «No da tiempo: te sobran unas 180 palabras»', title === 'No da tiempo: te sobran unas 180 palabras', title)
    check('1 minuto: «Ajustado al tiempo» no se ofrece (saldría demasiado rápido)', (await app.center('[data-testid=pace-fit]')).disabled && (await app.text('[data-testid=pace-fit]')).includes('demasiado rápido'))
  }
  await shot('tp-03-no-da-tiempo.png')
  await chooseTarget({ m: 2, s: 20 })
  {
    const title = await app.text('[data-testid=fit-title]')
    check('2 min 20 s: «tienes que leer a ritmo cómodo»', title === 'Para que quepa en 2 minutos y 20 segundos tienes que leer a ritmo cómodo', title)
    await app.click('[data-testid=pace-fit]')
    const wpm = await app.text('[data-testid=pace-wpm]')
    check('«Ajustado al tiempo»: el ritmo justo (140)', wpm === '140 palabras por minuto' && (await app.text('[data-testid=script-length]')).includes('leyéndolo ajustado al tiempo dura unos 2 min 20 s'), `${wpm} · ${await app.text('[data-testid=script-length]')}`)
  }
  await app.click('[data-testid=font-larger]')
  await app.click('[data-testid=font-smaller]')
  await shot('tp-04-texto-con-duracion.png')

  // --- Ensayar: el texto avanza al ritmo previsto
  await app.click('[data-testid=rehearse]')
  await waitStep('rehearse')
  await sleep(1200)
  await shot('tp-05-ensayo-cuenta-atras.png')
  await waitRunning()
  await sleep(1500)
  {
    const a = await prompter()
    await sleep(4000)
    const b = await prompter()
    const rate = ((b.units - a.units) / (b.at - a.at)) * 60_000
    check('Ensayo: el texto avanza a 140 palabras por minuto (±3 %)', Math.abs(rate - 140) / 140 < 0.03, `${rate.toFixed(1)} palabras por minuto`)
    const ya = Number(/translate3d\(0px, (-?[\d.]+)px/.exec(a.transform)?.[1])
    const yb = Number(/translate3d\(0px, (-?[\d.]+)px/.exec(b.transform)?.[1])
    check('Y se ve subir (translateY de un único bloque)', yb < ya - 20, `${ya} → ${yb} px`)
    check('Cronómetro del ensayo', Math.abs(b.elapsedMs - (b.at - a.at) - a.elapsedMs) < 80, `${a.elapsedMs} → ${b.elapsedMs} ms`)
    await shot('tp-06-ensayo.png')
    // Atajos: flechas y espacio
    await app.key('ArrowDown')
    const faster = (await prompter()).wpm
    await app.key('ArrowUp')
    const back = (await prompter()).wpm
    check('Flecha abajo / arriba: más rápido / más despacio', faster === 145 && back === 140, `${faster} → ${back}`)
    await app.key(' ')
    const p1 = await prompter()
    await sleep(1000)
    const p2 = await prompter()
    check('Espacio pausa el texto y el cronómetro', p2.phase === 'paused' && p2.units === p1.units && p2.elapsedMs === p1.elapsedMs)
    await shot('tp-07-ensayo-pausa.png')
    await app.key(' ')
    await sleep(300)
    const before = (await prompter()).units
    await app.key('ArrowLeft')
    const after = (await prompter()).units
    check('Flecha izquierda: retrocede un poco', after < before - 3, `${before.toFixed(1)} → ${after.toFixed(1)}`)
  }
  await app.click('[data-testid=run-finish]')
  await waitStep('script')
  check('Al terminar el ensayo dice cuánto ha durado', /^Último ensayo: \d+ s$/.test((await app.text('[data-testid=last-rehearsal]')) ?? ''), await app.text('[data-testid=last-rehearsal]'))

  // --- Palabra a palabra: el texto se pinta por donde debería ir la lectura (ya leído, la de ahora, por leer).
  // Con un texto largo (750 palabras, unos 5 minutos): sigue al avance, al ritmo elegido y al cambiarlo, se para
  // en pausa, ← retrocede y vuelve a dejar por leer lo retrocedido, y sin saltos. Al acabar deja el texto de
  // prueba como estaba (lo que viene después lo necesita).
  {
    const LONG_SCRIPT = Array.from({ length: 10 }, (_, i) => paragraph(i * 7, 75)).join('\n\n')
    const setScript = async (t) => {
      await app.click('[data-testid=script-input]')
      await app.evaluate('const ta = document.querySelector("[data-testid=script-input]"); ta.focus(); ta.select(); return true')
      await app.send('Input.insertText', { text: t })
      await sleep(300)
    }
    // Estado de las palabras pintadas: el atributo, las clases y lo que dice el dominio con el mismo avance.
    const words = () =>
      app.evaluate(`const b = document.querySelector('[data-testid=prompter-text]'); const r = document.querySelector('[data-testid=prompter-run]');
        const spans = b.querySelectorAll('[data-u]'); const d = window.__easyCut.domain;
        const c = d.wordCursorAt(d.flattenTokens(d.parseScript(args.t)), r.prompterState.units);
        const cur = Number(b.dataset.currentWord); const read = Number(b.dataset.wordsRead);
        const readOk = [...spans].every((s, i) => s.classList.contains('w-read') === (i < read && i !== cur));
        const curOk = b.querySelectorAll('.w-current').length === (cur >= 0 ? 1 : 0) && (cur < 0 || spans[cur].classList.contains('w-current'));
        return { cur, read, n: spans.length, domainOk: c.read === read && c.current === cur, classesOk: readOk && curOk, phase: r.prompterState.phase, units: r.prompterState.units }`, { t: LONG_SCRIPT })
    // Muestrea en la página cada fotograma durante `ms`: avance, palabra pintada, saltos del texto y tareas largas.
    const sample = (ms) =>
      app.evaluate(`const b = document.querySelector('[data-testid=prompter-text]'); const r = document.querySelector('[data-testid=prompter-run]');
        const spans = b.querySelectorAll('[data-u]'); const d = window.__easyCut.domain; const toks = d.flattenTokens(d.parseScript(args.t));
        const uOf = () => { const i = Number(b.dataset.wordsRead); return i < spans.length ? Number(spans[i].dataset.u) : NaN };
        const yOf = () => Number(/translate3d\\(0px, (-?[\\d.]+)px/.exec(b.style.transform)?.[1]);
        let longTasks = 0; let po = null;
        try { po = new PerformanceObserver((l) => (longTasks += l.getEntries().length)); po.observe({ type: 'longtask' }) } catch { po = null }
        const out = { frames: 0, maxGap: 0, maxJumpPx: 0, maxStep: 0, backwards: 0, mismatches: 0 };
        const s0 = { ...r.prompterState, u: uOf() };
        let last = performance.now(); let lastRead = Number(b.dataset.wordsRead); let lastY = yOf();
        await new Promise((done) => {
          const end = last + args.ms;
          const f = (now) => {
            out.frames++; out.maxGap = Math.max(out.maxGap, now - last); last = now;
            const read = Number(b.dataset.wordsRead);
            out.maxStep = Math.max(out.maxStep, read - lastRead); if (read < lastRead) out.backwards++; lastRead = read;
            const c = d.wordCursorAt(toks, r.prompterState.units);
            if (c.read !== read || String(c.current) !== b.dataset.currentWord) out.mismatches++;
            const y = yOf(); out.maxJumpPx = Math.max(out.maxJumpPx, Math.abs(y - lastY)); lastY = y;
            if (now < end) requestAnimationFrame(f); else done();
          };
          requestAnimationFrame(f);
        });
        po?.disconnect();
        const s1 = { ...r.prompterState, u: uOf() };
        return { ...out, maxGap: Math.round(out.maxGap), maxJumpPx: Math.round(out.maxJumpPx * 10) / 10, longTasks: po ? longTasks : null, du: s1.u - s0.u, dUnits: s1.units - s0.units, dt: s1.at - s0.at, wpm: s1.wpm, phase: s1.phase }`, { t: LONG_SCRIPT, ms })
    const rateOf = (s) => (s.dUnits / s.dt) * 60_000

    await setScript(LONG_SCRIPT)
    const longParsed = await app.evaluate('const s = window.__easyCut.domain.parseScript(args.t); return { words: s.words, pauses: s.pauses }', { t: LONG_SCRIPT })
    check('Palabra a palabra: texto largo de 750 palabras en 10 párrafos', longParsed.words === 750 && longParsed.pauses === 9, JSON.stringify(longParsed))
    await app.click('[data-testid=rehearse]')
    await waitStep('rehearse')
    {
      const w = await words()
      check('Palabra a palabra: en la cuenta atrás ya está marcada la primera palabra', w.phase === 'countdown' && w.cur === 0 && w.read === 0 && w.n === 750 && w.classesOk, JSON.stringify(w))
    }
    await waitRunning()
    await sleep(800)
    {
      const s = await sample(4000)
      const expected = (s.wpm * s.dt) / 60_000
      check('Palabra a palabra: la palabra pintada es la que dice el dominio en cada fotograma', s.mismatches === 0 && s.backwards === 0, JSON.stringify(s))
      // La palabra pintada va como mucho 1 palabra por detrás o 2 por delante del avance (pausa de párrafo).
      check('Palabra a palabra: avanza al ritmo elegido (140 palabras por minuto)', s.wpm === 140 && Math.abs(rateOf(s) - 140) / 140 < 0.03 && Math.abs(s.du - expected) < 3, `${s.du} palabras en ${Math.round(s.dt)} ms (esperadas ${expected.toFixed(1)}), avance a ${rateOf(s).toFixed(1)} por minuto`)
      check('Palabra a palabra: de una en una, sin saltarse ninguna', s.maxStep <= 1, `máximo ${s.maxStep} por fotograma`)
      check('Palabra a palabra: con 750 palabras, sin saltos (fotogramas seguidos y sin tareas largas)', s.frames >= 100 && s.maxGap < 120 && s.maxJumpPx < 20 && (s.longTasks ?? 0) === 0, `${s.frames} fotogramas en 4 s, hueco máximo ${s.maxGap} ms, salto máximo del texto ${s.maxJumpPx} px, tareas largas ${s.longTasks ?? 'sin medir'}`)
      await shot('tp-24-palabra-a-palabra.png')
    }
    // Más rápido (↓ cuatro veces: 160) y vuelta a 140
    for (let i = 0; i < 4; i++) await app.key('ArrowDown')
    {
      const s = await sample(3000)
      const expected = (s.wpm * s.dt) / 60_000
      check('Palabra a palabra: al cambiar el ritmo sigue al nuevo (160 palabras por minuto)', s.wpm === 160 && Math.abs(rateOf(s) - 160) / 160 < 0.03 && Math.abs(s.du - expected) < 3 && s.mismatches === 0, `${s.du} palabras en ${Math.round(s.dt)} ms (esperadas ${expected.toFixed(1)})`)
    }
    for (let i = 0; i < 4; i++) await app.key('ArrowUp')
    // En pausa no avanza (y se ven los tres estados)
    await app.key(' ')
    {
      const a = await words()
      await sleep(1200)
      const b = await words()
      check('Palabra a palabra: en pausa no avanza', b.phase === 'paused' && a.cur === b.cur && a.read === b.read && b.domainOk && b.classesOk, `${JSON.stringify(a)} → ${JSON.stringify(b)}`)
      const look = await app.evaluate(`const b = document.querySelector('[data-testid=prompter-text]'); const spans = b.querySelectorAll('[data-u]');
        const i = Number(b.dataset.currentWord) >= 0 ? Number(b.dataset.currentWord) : Number(b.dataset.wordsRead);
        const st = (s) => { const c = getComputedStyle(s); return { color: c.color, line: c.textDecorationLine } };
        return { read: st(spans[i - 1]), current: st(spans[i]), ahead: st(spans[i + 1]), onCurrent: Number(b.dataset.currentWord) >= 0 }`)
      const colors = new Set([look.read.color, look.current.color, look.ahead.color])
      check(
        'Palabra a palabra: ya leído, la de ahora y por leer se distinguen (color, y la de ahora subrayada)',
        colors.size === 3 && (!look.onCurrent || look.current.line.includes('underline')) && !look.ahead.line.includes('underline') && !look.read.line.includes('underline'),
        JSON.stringify(look),
      )
      await shot('tp-25-palabra-a-palabra-pausa.png')
    }
    await app.key(' ')
    await sleep(1500)
    // ← retrocede: la palabra vuelve atrás y lo retrocedido vuelve a estar por leer
    {
      const before = await words()
      await app.key('ArrowLeft')
      const after = await words()
      check('Palabra a palabra: ← vuelve atrás y deja por leer lo retrocedido', after.read < before.read && after.cur === after.read && after.domainOk && after.classesOk, `${before.read} → ${after.read} (palabra ${before.cur} → ${after.cur})`)
      await sleep(1000)
      const later = await words()
      check('Palabra a palabra: y sigue desde ahí', later.read > after.read && later.phase === 'running' && later.domainOk && later.classesOk, `${after.read} → ${later.read}`)
    }
    await app.key('Escape')
    await waitStep('script')
    await setScript(SCRIPT)
    check('Palabra a palabra: el texto de prueba vuelve a estar como antes', (await app.evaluate('return document.querySelector("[data-testid=script-input]").value')) === SCRIPT && (await app.text('[data-testid=pace-wpm]')) === '140 palabras por minuto', await app.text('[data-testid=pace-wpm]'))
  }

  // --- 2. Preparar la cámara
  await app.click('[data-testid=go-camera]')
  await waitStep('camera')
  const cam = await waitCameraReady()
  check('La cámara se ve (espejada en pantalla)', !!cam.w && cam.mirrored.startsWith('matrix(-1'), JSON.stringify(cam))
  await sleep(3500)
  const level = await app.text('[data-testid=mic-level]')
  check('Medidor del micrófono con frase llana', ['Se te oye bien', 'Di algo para probar el micrófono', 'No se oye nada: comprueba el micrófono'].includes(level) || level.startsWith('Se te oye muy bajo'), level)
  const trackInfo = await app.evaluate('return window.__easyCut.liveTracks()')
  console.log(`      pistas: ${JSON.stringify(trackInfo)}`)
  const settings = await app.evaluate('const v = document.querySelector("[data-testid=camera-preview]"); const s = v.srcObject.getVideoTracks()[0].getSettings(); const a = v.srcObject.getAudioTracks()[0].getSettings(); return { w: s.width, h: s.height, fps: s.frameRate, echo: a.echoCancellation, noise: a.noiseSuppression, agc: a.autoGainControl }')
  console.log(`      ajustes: ${JSON.stringify(settings)}`)
  await shot('tp-08-camara.png')

  // --- 3. Grabar ~12 s con una pausa de ~3 s
  await app.click('[data-testid=start-recording]')
  await waitStep('record')
  await sleep(1300)
  await shot('tp-09-grabar-cuenta-atras.png')
  await waitRunning()
  const wallStart = Date.now()
  await sleep(2500)
  await shot('tp-10-grabando.png')
  await app.setViewport(1920, 1080)
  await sleep(2300)
  await shot('tp-11-grabando-1920x1080.png')
  await app.setViewport(1280, 800)
  const beforePause = await prompter()
  const pauseStart = Date.now()
  await app.key(' ')
  await sleep(3000)
  const inPause = await prompter()
  check('Pausa: no cuenta tiempo grabado', inPause.phase === 'paused' && Math.abs(inPause.elapsedMs - beforePause.elapsedMs) < 200, `${beforePause.elapsedMs} → ${inPause.elapsedMs} ms`)
  await shot('tp-12-grabando-pausa.png')
  await app.key(' ')
  const pausedWall = Date.now() - pauseStart
  // Unos 12 s grabados en total: lo que falte tras las capturas.
  await sleep(Math.max(3000, 12_000 - (Date.now() - wallStart - pausedWall)))
  const status = await app.text('[data-testid=run-status]')
  check('Siempre visible: tiempo grabado, lo que queda y si vas bien', /Quedan/.test(status) && /(Vas bien|por detrás)/.test(status), status)
  const lastState = await prompter()
  const wallEnd = Date.now()
  await app.click('[data-testid=run-finish]')
  await waitStep('review', 30_000)
  const recordedMs = lastState.elapsedMs
  const expectedMs = wallEnd - wallStart - pausedWall
  check('Tiempo grabado = reloj menos la pausa (≈ 12 s, ±0,3 s)', Math.abs(recordedMs - expectedMs) < 300 && Math.abs(recordedMs - 12_000) < 1500, `${recordedMs} ms (reloj sin pausa ${expectedMs} ms, pausa ${pausedWall} ms)`)
  check('Al revisar ya no está la cámara encendida', (await liveTracks()).length === 0, JSON.stringify(await liveTracks()))

  // --- 4. Revisar
  const review = await app.waitFor('const v = document.querySelector("[data-testid=review-video]"); return v && v.readyState >= 1 ? { src: v.src, dur: v.duration } : null', { timeoutMs: 15_000, what: 'vídeo de revisión' })
  const tempPath = assetToPath(review.src)
  if (tempPath) tempFiles.add(tempPath)
  console.log(`      temporal: ${tempPath} (${review.dur} s en el visor)`)
  await app.click('[data-testid=review-play]')
  await sleep(1500)
  const playing = await app.evaluate('const v = document.querySelector("[data-testid=review-video]"); return { t: v.currentTime, w: v.videoWidth, paused: v.paused }')
  check('La grabación se puede ver antes de decidir', playing.t > 0.5 && playing.w > 0 && !playing.paused, JSON.stringify(playing))
  await app.click('[data-testid=review-play]')
  await shot('tp-13-revisar.png')

  // --- Usar esta grabación
  await app.click('[data-testid=use-recording]')
  try {
    await app.waitFor('return !!document.querySelector("[data-testid=recording-saving]")', { timeoutMs: 3000 })
    await shot('tp-14-preparando.png')
  } catch {
    // Ha ido demasiado rápido para verlo.
  }
  await waitScreen('editor', 120_000)
  await noErrorDialog('usar la grabación')
  const clip = await app.evaluate('const s = window.__easyCut.store; const c = s.selectedClip.value; return c ? { path: c.sourcePath, ms: window.__easyCut.domain.clipOutputMs(c), id: c.id, n: s.project.value.clips.length, target: s.project.value.targetDurationMs, offer: s.recordingOffer.value } : null')
  check('La grabación entra como trozo elegido en «Tu vídeo»', !!clip && clip.n === 1 && clip.offer === clip.id, JSON.stringify(clip))
  check('La duración máxima elegida pasa al vídeo', clip?.target === 140_000, String(clip?.target))
  check('Está en Vídeos\\Mis montajes\\Grabaciones', !!clip && clip.path.toLowerCase().startsWith(recordingsFolder.toLowerCase()) && existsSync(clip.path), clip?.path)
  check('El temporal se ha borrado', !!tempPath && !existsSync(tempPath), tempPath ?? '')
  {
    const info = ffprobeJson(clip.path)
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    const dur = Math.round(Number(info.format.duration) * 1000)
    const vd = Math.round(Number(v?.duration) * 1000)
    const ad = Math.round(Number(a?.duration) * 1000)
    console.log(`      ffprobe: ${JSON.stringify({ dur, v: v && { c: v.codec_name, d: vd, fps: v.avg_frame_rate, w: v.width, h: v.height }, a: a && { c: a.codec_name, d: ad } })}`)
    check('El MP4 dura lo grabado sin la pausa (±0,7 s)', Math.abs(dur - recordedMs) <= 700, `${dur} ms (grabado ${recordedMs} ms)`)
    check('Vídeo H.264 y audio AAC', v?.codec_name === 'h264' && a?.codec_name === 'aac', `${v?.codec_name} + ${a?.codec_name}`)
    check('Audio y vídeo duran lo mismo (±0,2 s)', Math.abs(vd - ad) <= 200, `vídeo ${vd} ms, audio ${ad} ms`)
    check('El trozo dura lo mismo que el fichero', Math.abs(clip.ms - dur) <= 100, `${clip.ms} ms`)
    const card = await app.text('[data-testid=clip-duration]')
    check('La tarjeta del trozo dice esa duración', card === `${Math.round(dur / 1000)} s`, card)
  }
  check('Al salir del teleprompter no queda ninguna pista de cámara ni micrófono', (await liveTracks()).length === 0)
  check('«Tu vídeo» ofrece «Quitar las pausas de esta grabación»', !!(await app.text('[data-testid=recording-offer]')))
  await sleep(800)
  await shot('tp-15-tu-video-con-la-grabacion.png')

  await app.click('[data-testid=offer-remove-pauses]')
  await waitScreen('clip-editor')
  check('Lleva a «Arreglar este trozo» en «Quitar pausas»', (await app.evaluate('return document.querySelector("[data-testid=tab-pauses]").getAttribute("aria-selected")')) === 'true')
  await app.waitFor('return document.querySelector("[data-testid=pauses-searching]") || document.querySelector("[data-testid=pauses-found]") || document.querySelector("[data-testid=pauses-none]")', { timeoutMs: 5000, what: 'búsqueda de pausas lanzada' })
  check('Con la búsqueda de pausas ya lanzada', true)
  await app.waitFor('return document.querySelector("[data-testid=pauses-found]") || document.querySelector("[data-testid=pauses-none]")', { timeoutMs: 60_000, what: 'fin de la búsqueda de pausas' })
  await noErrorDialog('quitar pausas')
  await shot('tp-16-quitar-pausas-de-la-grabacion.png')
  await app.click('[data-testid=clip-done]')
  await waitScreen('editor')

  // --- Desde «Tu vídeo»: «Grabarme», el texto sigue ahí y «Volver» regresa a «Tu vídeo»
  await app.click('[data-testid=record-more]')
  await waitStep('script')
  check('«Grabarme» desde «Tu vídeo» recuerda el texto', (await app.evaluate('return document.querySelector("[data-testid=script-input]").value')) === SCRIPT)
  check('Y usa la duración máxima del vídeo', (await app.text('[data-testid=target-button]')) === 'Duración máxima: 2 minutos y 20 segundos', await app.text('[data-testid=target-button]'))

  // «Repetir» borra la grabación
  await app.click('[data-testid=go-camera]')
  await waitStep('camera')
  await waitCameraReady()
  await app.click('[data-testid=start-recording]')
  await waitStep('record')
  await waitRunning()
  await sleep(2000)
  await app.click('[data-testid=run-finish]')
  await waitStep('review', 30_000)
  {
    const src = await app.waitFor('const v = document.querySelector("[data-testid=review-video]"); return v && v.src', { what: 'vídeo de revisión' })
    const temp = assetToPath(src)
    if (temp) tempFiles.add(temp)
    await app.click('[data-testid=retake]')
    await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
    await shot('tp-17-repetir-confirmacion.png')
    const text = await confirmDialog(true)
    await waitStep('camera')
    await sleep(500)
    check('«Repetir» pregunta y borra la grabación', text.includes('Borrar esta grabación') && !!temp && !existsSync(temp), temp ?? '')
  }

  // Salir a mitad de grabación pide confirmación
  await waitCameraReady()
  await app.click('[data-testid=start-recording]')
  await waitStep('record')
  await waitRunning()
  await sleep(1500)
  await app.click('[data-testid=run-leave]')
  await app.waitFor('return !!document.querySelector("[data-testid=confirm-dialog]")')
  check('Salir mientras se graba pausa y pide confirmación', (await prompter()).phase === 'paused')
  await shot('tp-18-dejar-de-grabar.png')
  await confirmDialog(true)
  await waitStep('camera')
  await app.click('[data-testid=back-home]')
  await waitStep('script')
  check('Volver al texto apaga la cámara', (await liveTracks()).length === 0)
  await app.click('[data-testid=back-home]')
  await waitScreen('editor')
  check('«Volver» regresa a «Tu vídeo»', true)
  check('Fuera del teleprompter no queda ninguna pista encendida', (await liveTracks()).length === 0, JSON.stringify(await liveTracks()))

  // --- Grabar solo la voz: sin cámara en ningún momento, M4A en Grabaciones, no entra en el montaje
  {
    const clipsBefore = await app.evaluate('return window.__easyCut.store.project.value.clips.length')
    await app.click('[data-testid=record-more]')
    await waitStep('script')
    await app.click('[data-testid=go-camera]')
    await waitStep('camera')
    await waitCameraReady()
    await app.click('[data-testid=kind-audio]')
    await app.waitFor('return !!document.querySelector("[data-testid=voice-only]")', { timeoutMs: 15_000, what: 'modo solo la voz' })
    const tracks = await liveTracks()
    check('Solo la voz: no se pide la cámara (solo hay pista de micrófono)', tracks.length === 1 && tracks[0].kind === 'audio', JSON.stringify(tracks))
    check('Solo la voz: no hay selector de cámara pero sí medidor', !(await app.text('[aria-label=Cámara]')) && !!(await app.text('[data-testid=mic-level]')))
    await sleep(1500)
    await shot('tp-20-solo-voz-preparar.png')
    await app.click('[data-testid=start-recording]')
    await waitStep('record')
    await waitRunning()
    const vStart = Date.now()
    check('Solo la voz: la pantalla de grabar no muestra la cámara', !(await app.evaluate('return !!document.querySelector("[data-testid=prompter-run] .camera")')))
    check('Solo la voz: sigue sin pedirse la cámara al grabar', (await liveTracks()).every((t) => t.kind === 'audio'))
    await sleep(2500)
    await shot('tp-21-grabando-solo-voz.png')
    const vPauseStart = Date.now()
    await app.key(' ')
    await sleep(2000)
    await app.key(' ')
    const vPaused = Date.now() - vPauseStart
    await sleep(Math.max(1500, 6000 - (Date.now() - vStart - vPaused)))
    const vState = await prompter()
    const vStatus = await app.text('[data-testid=run-status]')
    check('Solo la voz: tiempos y «vas bien» igual que con vídeo', /Quedan/.test(vStatus) && /(Vas bien|por detrás)/.test(vStatus), vStatus)
    await app.click('[data-testid=run-finish]')
    await waitStep('review', 60_000)
    await noErrorDialog('guardar la voz')
    const audioSrc = await app.waitFor('const a = document.querySelector("[data-testid=review-audio]"); return a && a.src', { what: 'audio de revisión' })
    const voicePath = assetToPath(audioSrc)
    check('Se guarda como M4A en Vídeos\\Mis montajes\\Grabaciones', !!voicePath && voicePath.toLowerCase().startsWith(recordingsFolder.toLowerCase()) && voicePath.endsWith('.m4a') && existsSync(voicePath), voicePath ?? '')
    const info = ffprobeJson(voicePath)
    const a = info.streams.find((s) => s.codec_type === 'audio')
    const hasVideo = info.streams.some((s) => s.codec_type === 'video')
    const dur = Math.round(Number(info.format.duration) * 1000)
    const rate = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'default=nw=1:nk=1', voicePath], { encoding: 'utf8' }).trim()
    console.log(`      ffprobe voz: ${JSON.stringify({ dur, codec: a?.codec_name, rate, streams: info.streams.length })}`)
    check('Sin pista de vídeo, AAC a 48 kHz', !hasVideo && a?.codec_name === 'aac' && rate === '48000', `${info.streams.map((s) => s.codec_type).join(', ')} · ${a?.codec_name} · ${rate} Hz`)
    check('Dura lo grabado sin la pausa (±0,7 s)', Math.abs(dur - vState.elapsedMs) <= 700, `${dur} ms (grabado ${vState.elapsedMs} ms, pausa ${vPaused} ms)`)
    await app.click('[data-testid=review-play]')
    await sleep(1200)
    const heard = await app.evaluate('const a = document.querySelector("[data-testid=review-audio]"); return { t: a.currentTime, paused: a.paused }')
    check('Se puede escuchar en «Revisar»', heard.t > 0.3 && !heard.paused, JSON.stringify(heard))
    await app.click('[data-testid=review-play]')
    check(
      'Acciones: «Usar esta grabación», «Repetir» y «Guardarla sin usarla»',
      (await app.text('[data-testid=use-recording]')) === 'Usar esta grabación' && !!(await app.text('[data-testid=retake]')) && (await app.text('[data-testid=keep-recording]')) === 'Guardarla sin usarla',
    )
    await shot('tp-22-revisar-solo-voz.png')
    await shot('pic-tp-revisar-solo-voz.png')
    check('Revisar la voz no la mete aún en el montaje', (await app.evaluate('return window.__easyCut.store.project.value.clips.length')) === clipsBefore)
    // Repetir: borra el M4A y vuelve a preparar, en modo voz
    await app.click('[data-testid=retake]')
    await confirmDialog(true)
    await waitStep('camera')
    await sleep(500)
    check('«Repetir» borra la voz grabada', !existsSync(voicePath), voicePath)
    await app.waitFor('return !!document.querySelector("[data-testid=voice-only]")', { timeoutMs: 15_000, what: 'modo solo la voz otra vez' })
    check('Recuerda el modo «Grabar solo la voz»', (await app.evaluate('return document.querySelector("[data-testid=kind-audio]").getAttribute("aria-checked")')) === 'true')
    // Otra corta y «Guardarla sin usarla»: se queda guardada
    await app.click('[data-testid=start-recording]')
    await waitStep('record')
    await waitRunning()
    await sleep(1500)
    await app.click('[data-testid=run-finish]')
    await waitStep('review', 60_000)
    const keptSrc = await app.waitFor('const a = document.querySelector("[data-testid=review-audio]"); return a && a.src', { what: 'audio de revisión' })
    const keptPath = assetToPath(keptSrc)
    await app.click('[data-testid=keep-recording]')
    await waitStep('script')
    const toast = await app.text('[data-testid=toast]')
    check('«Guardarla sin usarla» la deja guardada y lo dice', !!keptPath && existsSync(keptPath) && !!toast && toast.includes('Grabaciones'), toast ?? '')
    check('Y no queda el micrófono encendido', (await liveTracks()).length === 0)
    check('Y no entra en el montaje', (await app.evaluate('return window.__easyCut.store.project.value.clips.length')) === clipsBefore)

    // Otra de ~8 s y «Usar esta grabación»: entra como trozo de solo sonido y se le pueden quitar las pausas.
    // El micrófono falso no deja silencios: se guarda el stream para apagar su pista 2,5 s a mitad (eso sí graba silencio).
    await app.evaluate(`const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => { const s = await orig(c); window.__e2eStream = s; return s }; return true`)
    await app.click('[data-testid=go-camera]')
    await waitStep('camera')
    await app.waitFor('return !!document.querySelector("[data-testid=voice-only]")', { timeoutMs: 15_000, what: 'modo solo la voz' })
    await app.waitFor('const b = document.querySelector("[data-testid=start-recording]"); return b && !b.disabled', { timeoutMs: 15_000, what: 'micrófono listo' })
    await app.click('[data-testid=start-recording]')
    await waitStep('record')
    await waitRunning()
    await sleep(3000)
    const muted = await app.evaluate('const t = window.__e2eStream?.getAudioTracks() ?? []; t.forEach((x) => (x.enabled = false)); return t.length')
    await sleep(2500)
    await app.evaluate('(window.__e2eStream?.getAudioTracks() ?? []).forEach((x) => (x.enabled = true)); return true')
    check('Se ha callado el micrófono 2,5 s a mitad de la grabación', muted >= 1, `${muted} pistas`)
    await sleep(3000)
    await app.click('[data-testid=run-finish]')
    await waitStep('review', 60_000)
    const usedSrc = await app.waitFor('const a = document.querySelector("[data-testid=review-audio]"); return a && a.src', { what: 'audio de revisión' })
    const usedPath = assetToPath(usedSrc)
    await app.click('[data-testid=use-recording]')
    await waitScreen('editor', 60_000)
    await noErrorDialog('usar la voz')
    const voiceClip = await app.evaluate(`const s = window.__easyCut.store; const c = s.selectedClip.value;
      return c ? { path: c.sourcePath, picture: c.picture.kind, hasVideo: c.sourceHasVideo, n: s.project.value.clips.length, offer: s.recordingOffer.value === c.id, index: s.selectedIndex.value } : null`)
    check('«Usar esta grabación» la mete como trozo de solo sonido', !!voiceClip && voiceClip.n === clipsBefore + 1 && voiceClip.picture === 'none' && voiceClip.hasVideo === false && voiceClip.path === usedPath, JSON.stringify(voiceClip))
    check('La tarjeta del trozo dice «Solo se oye»', (await app.evaluate(`return document.querySelector('[data-testid=clip-card-${voiceClip.index + 1}] .picture').dataset.picture`)) === 'sound')
    check('Y ofrece quitarle las pausas', !!voiceClip.offer && !!(await app.text('[data-testid=recording-offer]')))
    await sleep(600)
    await shot('pic-tp-voz-en-el-montaje.png')
    await app.click('[data-testid=offer-remove-pauses]')
    await waitScreen('clip-editor')
    await app.waitFor('return document.querySelector("[data-testid=pauses-found]") || document.querySelector("[data-testid=pauses-none]")', { timeoutMs: 60_000, what: 'fin de la búsqueda de pausas en la voz' })
    await noErrorDialog('quitar pausas de la voz')
    const voiceFound = await app.text('[data-testid=pauses-found]')
    check('«Quitar pausas» encuentra la pausa de la voz', !!voiceFound, voiceFound ?? (await app.text('[data-testid=pauses-none]')))
    if (voiceFound) {
      await app.click('[data-testid=remove-pauses]')
      const segs = await app.evaluate('return window.__easyCut.store.selectedClip.value.segments.length')
      check('Y las quita', segs > 1, `${segs} rangos`)
    }
    const wave = await app.waitFor('const i = document.querySelector("[data-testid=filmstrip-wave] img"); return i && i.complete && i.naturalWidth > 0 ? i.naturalWidth : null', { timeoutMs: 20_000, what: 'forma de onda de la voz' })
    check('La tira enseña la forma de onda de la voz', !!wave, `${wave} px`)
    await shot('pic-tp-quitar-pausas-voz.png')
    await app.click('[data-testid=clip-done]')
    await waitScreen('editor')
  }

  // El texto sobrevive a recargar la app
  await app.evaluate('location.reload(); return true')
  await sleep(1500)
  app.close()
  app = await connectToApp(port)
  await app.waitFor('return !!window.__easyCut?.store')
  await app.setViewport(1280, 800)
  await waitScreen('teleprompter')
  await app.click('[data-testid=teleprompter]')
  await waitStep('script')
  check('El texto sigue ahí tras recargar', (await app.evaluate('return document.querySelector("[data-testid=script-input]").value')) === SCRIPT)
  check('Y el modo «solo la voz» también', (await app.evaluate('return JSON.parse(localStorage.getItem("easy-cut:teleprompter")).kind')) === 'audio')

  // Cámara ocupada: ofrece grabar solo la voz en vez de quedarse bloqueado (se simula el fallo)
  await app.evaluate(`const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => (c && c.video ? Promise.reject(new DOMException('ocupada', 'NotReadableError')) : orig(c)); return true`)
  await app.click('[data-testid=go-camera]')
  await waitStep('camera')
  await app.waitFor('return !!document.querySelector("[data-testid=voice-only]")', { timeoutMs: 15_000, what: 'modo solo la voz recordado' })
  await app.click('[data-testid=kind-video]')
  await app.waitFor('return !!document.querySelector("[data-testid=camera-problem]")', { what: 'aviso de cámara ocupada' })
  const busy = await app.text('[data-testid=camera-problem]')
  check('Cámara ocupada: lo explica y ofrece «Grabar solo la voz»', busy.includes('La cámara está ocupada') && !!(await app.text('[data-testid=switch-to-voice]')), busy)
  await shot('tp-23-camara-ocupada.png')
  await app.click('[data-testid=switch-to-voice]')
  await app.waitFor('return !!document.querySelector("[data-testid=voice-only]")', { timeoutMs: 15_000, what: 'paso a solo la voz' })
  check('«Grabar solo la voz» desde el aviso deja grabar', !(await app.center('[data-testid=start-recording]')).disabled)
  await app.click('[data-testid=back-home]')
  await waitStep('script')

  // Sin ningún dispositivo: mensaje llano y cómo arreglarlo (aquí la voz no serviría)
  await app.evaluate(`navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('sin dispositivos', 'NotFoundError'));
    navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]); return true`)
  await app.click('[data-testid=go-camera]')
  await waitStep('camera')
  await app.click('[data-testid=kind-video]')
  await app.waitFor('const p = document.querySelector("[data-testid=camera-problem]"); return p && p.innerText.includes("ni cámara")', { what: 'aviso sin cámara' })
  const problem = await app.text('[data-testid=camera-problem]')
  check('Sin cámara: qué pasa y cómo arreglarlo', problem.includes('No encuentro ni cámara ni micrófono') && problem.includes('Probar otra vez'), problem)
  check('Sin cámara no deja empezar a grabar', (await app.center('[data-testid=start-recording]')).disabled)
  await shot('tp-19-sin-camara.png')
  await app.evaluate('location.reload(); return true')
  await sleep(1500)
  app.close()
  app = await connectToApp(port)
  await app.waitFor('return !!window.__easyCut?.store')
} catch (e) {
  check('La prueba ha llegado al final', false, e instanceof Error ? e.stack ?? e.message : String(e))
  try {
    if (takeShots) await app?.screenshot(join(opts.shots, 'tp-zz-fallo.png'))
  } catch {
    // Sin captura.
  }
} finally {
  app?.close()
  if (!opts['keep-open']) await stopApp()
  // Limpieza: las grabaciones de la prueba y los temporales que hayan quedado.
  if (existsSync(recordingsFolder)) {
    for (const name of readdirSync(recordingsFolder)) {
      if (recordingsBefore.has(name)) continue
      try {
        unlinkSync(join(recordingsFolder, name))
        console.log(`      borrado ${name}`)
      } catch (err) {
        console.log(`      no se ha podido borrar ${name}: ${err}`)
      }
    }
  }
  for (const t of tempFiles) {
    if (existsSync(t)) {
      try {
        unlinkSync(t)
        console.log(`      borrado el temporal ${t}`)
      } catch {
        // Lo borrará la app.
      }
    }
  }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
process.exit(failed.length ? 1 : 0)
