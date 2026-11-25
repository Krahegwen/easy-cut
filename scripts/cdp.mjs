// Cliente mínimo de CDP (depuración remota de WebView2) para las pruebas de la app: evaluar código,
// pulsar y arrastrar con eventos de ratón reales, teclas y capturas de pantalla. Requiere Node ≥ 22.

import { writeFileSync } from 'node:fs'

/**
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS para arrancar la app en las pruebas: depuración remota en `port`;
 * salvo `withSound` (opción --with-sound), --mute-audio para que no suene nada por los altavoces (solo quita
 * la salida: currentTime, MediaRecorder y el medidor del micrófono siguen igual); y que Chromium no frene la
 * ventana aunque esté tapada por otras (en las pruebas se abre detrás, sin foco).
 */
export function webviewArgs(port, { withSound = false, extra = [] } = {}) {
  const args = [
    `--remote-debugging-port=${port}`,
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    ...extra,
  ]
  if (!withSound) args.push('--mute-audio')
  return args.join(' ')
}

/**
 * Variables de entorno con las que las pruebas arrancan la app (`pnpm tauri dev`): los argumentos de WebView2
 * y, salvo `foreground` (opción --foreground, para verla trabajar), EASY_CUT_TEST=1, que en la compilación de
 * desarrollo abre la ventana detrás de las demás y sin quitar el foco (src-tauri/src/test_window.rs).
 */
export function appTestEnv(port, { withSound = false, foreground = false, extra = [] } = {}) {
  const env = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webviewArgs(port, { withSound, extra }) }
  if (!foreground) env.EASY_CUT_TEST = '1'
  return env
}

/** Las opciones comunes de los scripts que arrancan la app (para su parseArgs). */
export const APP_LAUNCH_OPTIONS = {
  'with-sound': { type: 'boolean', default: false },
  foreground: { type: 'boolean', default: false },
}

export async function connectToApp(port, { timeoutMs = 120_000, focusEmulation = true } = {}) {
  const deadline = Date.now() + timeoutMs
  let page = null
  while (!page) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && /localhost:4850|tauri\.localhost/.test(t.url)) ?? null
    } catch {
      page = null
    }
    if (!page) {
      if (Date.now() > deadline) throw new Error(`No hay ninguna página de la app en el puerto ${port}`)
      await sleep(500)
    }
  }
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
    new Promise((ok, ko) => {
      id += 1
      pending.set(id, (msg) => (msg.error ? ko(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })

  /** Evalúa un cuerpo de función async en la página y devuelve su valor (JSON). */
  async function evaluate(body, args = {}) {
    const expression = `(async (args) => { ${body} })(${JSON.stringify(args)})`
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) {
      const ex = res.exceptionDetails
      throw new Error(ex.exception?.description ?? ex.text)
    }
    return res.result.value
  }

  /** Espera a que una expresión (cuerpo de función) devuelva algo verdadero. */
  async function waitFor(body, { timeoutMs = 15_000, args = {}, what = body } = {}) {
    const end = Date.now() + timeoutMs
    for (;;) {
      let v
      try {
        v = await evaluate(body, args)
      } catch {
        v = null
      }
      if (v) return v
      if (Date.now() > end) throw new Error(`Tiempo agotado esperando: ${what}`)
      await sleep(120)
    }
  }

  /** Centro de un elemento visible (lanza si no está). */
  async function center(selector) {
    const r = await evaluate(
      `const el = document.querySelector(args.s); if (!el) return null;
       el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
       const r = el.getBoundingClientRect();
       const x = r.left + r.width / 2, y = r.top + r.height / 2;
       const hit = document.elementFromPoint(x, y);
       const covered = hit && hit !== el && !el.contains(hit) ? (hit.closest('[data-testid]')?.dataset.testid ?? hit.tagName) : null;
       return { x, y, w: r.width, h: r.height, disabled: !!el.disabled, covered }`,
      { s: selector },
    )
    if (!r) throw new Error(`No encuentro ${selector}`)
    return r
  }

  async function mouse(type, x, y, buttons = 0) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 })
  }

  async function clickAt(x, y) {
    await mouse('mouseMoved', x, y)
    await mouse('mousePressed', x, y, 1)
    await mouse('mouseReleased', x, y, 0)
  }

  /** Pulsa un elemento como lo haría el ratón (falla si está desactivado). */
  async function click(selector) {
    const c = await center(selector)
    if (c.disabled) throw new Error(`${selector} está desactivado`)
    if (c.covered) throw new Error(`${selector} está tapado por ${c.covered}`)
    await clickAt(c.x, c.y)
    await sleep(60)
  }

  async function drag(from, to, steps = 12) {
    await mouse('mouseMoved', from.x, from.y)
    await mouse('mousePressed', from.x, from.y, 1)
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps
      const y = from.y + ((to.y - from.y) * i) / steps
      await mouse('mouseMoved', x, y, 1)
      await sleep(16)
    }
    await mouse('mouseReleased', to.x, to.y, 0)
    await sleep(80)
  }

  /** Códigos de las teclas especiales (code y código virtual de Windows). */
  const SPECIAL = {
    ' ': ['Space', 32],
    ArrowLeft: ['ArrowLeft', 37],
    ArrowUp: ['ArrowUp', 38],
    ArrowRight: ['ArrowRight', 39],
    ArrowDown: ['ArrowDown', 40],
    Escape: ['Escape', 27],
    Enter: ['Enter', 13],
    Tab: ['Tab', 9],
    Delete: ['Delete', 46],
    Backspace: ['Backspace', 8],
    Home: ['Home', 36],
    End: ['End', 35],
    PageUp: ['PageUp', 33],
    PageDown: ['PageDown', 34],
    F1: ['F1', 112],
  }

  /** Código de una tecla: las especiales, las letras (KeyE) y los números de la fila de arriba (Digit1). */
  function keyCodes(keyName) {
    if (SPECIAL[keyName]) return SPECIAL[keyName]
    if (/^[a-zA-Z]$/.test(keyName)) return [`Key${keyName.toUpperCase()}`, keyName.toUpperCase().charCodeAt(0)]
    if (/^[0-9]$/.test(keyName)) return [`Digit${keyName}`, keyName.charCodeAt(0)]
    return [keyName, 0]
  }

  /**
   * Pulsa una tecla con Input.dispatchKeyEvent (eventos de teclado reales). Las que escriben llevan su texto,
   * así que en un cuadro de texto se escriben de verdad. Con `repeat`, el keyDown llega como autorrepetición.
   * Con `hold`, solo el keyDown (para soltarla luego con keyUp).
   */
  async function key(keyName, { ctrl = false, shift = false, repeat = false, hold = false, up = false } = {}) {
    const [code, keyCode] = keyCodes(keyName)
    const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0)
    const base = { key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers }
    const printable = keyName.length === 1 && !ctrl
    const text = keyName === 'Enter' && !ctrl ? '\r' : printable ? keyName : undefined
    if (!up) await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text, unmodifiedText: text, autoRepeat: repeat })
    if (!hold) await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(60)
  }

  async function setViewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await sleep(250)
  }

  async function screenshot(path) {
    const res = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(res.data, 'base64'))
  }

  async function text(selector) {
    return evaluate('const el = document.querySelector(args.s); return el ? el.innerText.replace(/\\s+/g, " ").trim() : null', { s: selector })
  }

  await send('Runtime.enable')
  // La página se comporta como si la ventana tuviera el foco aunque no lo tenga (en las pruebas está detrás):
  // foco de elementos, eventos focus/blur y :focus-visible no dependen de la ventana activa del sistema.
  if (focusEmulation) await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  return { send, evaluate, waitFor, click, clickAt, center, drag, key, setViewport, screenshot, text, close: () => ws.close(), url: page.url }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
