// Registro de atajos: capas, foco en cuadros de texto, modificadores, repetición y teclado español.
import { describe, expect, it, vi } from 'vitest'
import { activeLayers, comboOf, createShortcutRegistry, LAYER_PRIORITY, listShortcuts, type KeyInput, type Shortcut } from './shortcuts'

function key(k: string, extra: Partial<KeyInput> = {}): KeyInput {
  return { key: k, code: '', ctrl: false, alt: false, meta: false, shift: false, repeat: false, focus: 'other', ...extra }
}

function shortcut(id: string, keys: string[], extra: Partial<Shortcut> = {}): Shortcut & { run: ReturnType<typeof vi.fn> } {
  return { id, keys, label: id, description: id, run: vi.fn(), ...extra } as Shortcut & { run: ReturnType<typeof vi.fn> }
}

function ran(decision: ReturnType<ReturnType<typeof createShortcutRegistry>['resolve']>): string | null {
  return decision.action === 'run' ? decision.shortcut.id : null
}

describe('nombre de la tecla', () => {
  it('normaliza espacio, letras y combinaciones', () => {
    expect(comboOf(key(' '))).toBe('Space')
    expect(comboOf(key('E', { shift: true }))).toBe('e')
    expect(comboOf(key('Escape'))).toBe('Escape')
    expect(comboOf(key('z', { ctrl: true, code: 'KeyZ' }))).toBe('Ctrl+z')
    expect(comboOf(key('Z', { ctrl: true, shift: true, code: 'KeyZ' }))).toBe('Ctrl+Shift+z')
  })

  it('con Ctrl usa la posición si la letra no es latina', () => {
    expect(comboOf(key('с', { ctrl: true, code: 'KeyC' }))).toBe('Ctrl+c')
  })

  it('Alt, AltGr (Ctrl+Alt) y la tecla Windows nunca son atajos', () => {
    expect(comboOf(key('e', { alt: true }))).toBeNull()
    expect(comboOf(key('€', { ctrl: true, alt: true, code: 'KeyE' }))).toBeNull()
    expect(comboOf(key('d', { meta: true }))).toBeNull()
  })

  it('las teclas de un teclado español: ñ, números y tildes muertas no se confunden', () => {
    expect(comboOf(key('ñ'))).toBe('ñ')
    expect(comboOf(key('1', { code: 'Digit1' }))).toBe('1')
    expect(comboOf(key('1', { code: 'Numpad1' }))).toBe('1')
    expect(comboOf(key('Dead', { code: 'Quote' }))).toBe('Dead')
  })
})

describe('capas', () => {
  it('la de arriba manda; si no tiene la tecla, se busca debajo', () => {
    const r = createShortcutRegistry()
    const screenPlay = shortcut('play', ['Space'])
    const screenBack = shortcut('back', ['Escape'])
    const toastClose = shortcut('toast', ['Escape'])
    r.add({ id: 'screen', title: '', priority: LAYER_PRIORITY.screen, modal: false, active: () => true, shortcuts: () => [screenPlay, screenBack] })
    r.add({ id: 'toast', title: '', priority: LAYER_PRIORITY.toast, modal: false, active: () => true, shortcuts: () => [toastClose] })
    expect(ran(r.resolve(key('Escape')))).toBe('toast')
    expect(ran(r.resolve(key(' ')))).toBe('play')
  })

  it('con un diálogo abierto solo valen los suyos', () => {
    const r = createShortcutRegistry()
    let open = true
    r.add({ id: 'screen', title: '', priority: LAYER_PRIORITY.screen, modal: false, active: () => true, shortcuts: () => [shortcut('play', ['Space']), shortcut('del', ['Delete'])] })
    r.add({ id: 'dialog', title: '', priority: LAYER_PRIORITY.dialog, modal: true, active: () => open, shortcuts: () => [shortcut('cancel', ['Escape'])] })
    expect(ran(r.resolve(key('Escape')))).toBe('cancel')
    expect(ran(r.resolve(key('Delete')))).toBeNull()
    // Espacio no llega a la pantalla ni hace scroll.
    expect(r.resolve(key(' '))).toEqual({ action: 'none', preventDefault: true })
    open = false
    expect(ran(r.resolve(key('Delete')))).toBe('del')
  })

  it('la prioridad ordena aunque la pantalla se registre después del diálogo', () => {
    const r = createShortcutRegistry()
    r.add({ id: 'dialog', title: '', priority: LAYER_PRIORITY.dialog, modal: true, active: () => true, shortcuts: () => [shortcut('cancel', ['Escape'])] })
    r.add({ id: 'screen', title: '', priority: LAYER_PRIORITY.screen, modal: false, active: () => true, shortcuts: () => [shortcut('back', ['Escape'])] })
    expect(ran(r.resolve(key('Escape')))).toBe('cancel')
    expect(activeLayers(r.layers()).map((l) => l.id)).toEqual(['dialog'])
  })

  it('a igual prioridad, la última en llegar va encima; al quitarla vuelve la anterior', () => {
    const r = createShortcutRegistry()
    r.add({ id: 'a', title: '', priority: 0, modal: false, active: () => true, shortcuts: () => [shortcut('a', ['Space'])] })
    const remove = r.add({ id: 'b', title: '', priority: 0, modal: false, active: () => true, shortcuts: () => [shortcut('b', ['Space'])] })
    expect(ran(r.resolve(key(' ')))).toBe('b')
    remove()
    expect(ran(r.resolve(key(' ')))).toBe('a')
  })

  it('un atajo desactivado deja pasar al siguiente, y si no hay, no hace nada (pero se come la tecla)', () => {
    const r = createShortcutRegistry()
    r.add({ id: 'screen', title: '', priority: 0, modal: false, active: () => true, shortcuts: () => [shortcut('back', ['Escape'])] })
    r.add({ id: 'top', title: '', priority: 10, modal: false, active: () => true, shortcuts: () => [shortcut('stop', ['Escape'], { enabled: false }), shortcut('cut', ['p'], { enabled: false })] })
    expect(ran(r.resolve(key('Escape')))).toBe('back')
    expect(r.resolve(key('p'))).toEqual({ action: 'none', preventDefault: true })
  })

  it('el panel lista los de las capas activas, sin los ocultos ni su propia capa', () => {
    const r = createShortcutRegistry()
    r.add({ id: 'screen', title: 'Pantalla', priority: 0, modal: false, active: () => true, shortcuts: () => [shortcut('redo', ['Ctrl+y']), shortcut('redo2', ['Ctrl+Shift+z'], { hidden: true })] })
    r.add({ id: 'panel', title: 'Panel', priority: LAYER_PRIORITY.panel, modal: true, active: () => true, shortcuts: () => [shortcut('close', ['Escape'])] })
    const groups = listShortcuts(r.layers(), { exclude: 'panel' })
    expect(groups.map((g) => [g.layer.id, g.shortcuts.map((s) => s.id)])).toEqual([['screen', ['redo']]])
  })
})

describe('mientras se escribe', () => {
  function registry() {
    const r = createShortcutRegistry()
    r.add({
      id: 'screen',
      title: '',
      priority: 0,
      modal: false,
      active: () => true,
      shortcuts: () => [
        shortcut('play', ['Space']),
        shortcut('start', ['e']),
        shortcut('back', ['Escape']),
        shortcut('undo', ['Ctrl+z']),
        shortcut('paste', ['Ctrl+v']),
        shortcut('help', ['F1'], { inText: true }),
      ],
    })
    return r
  }

  it('las letras, el espacio y las combinaciones son del texto', () => {
    const r = registry()
    for (const k of [key('e'), key(' '), key('t'), key('z', { ctrl: true, code: 'KeyZ' }), key('v', { ctrl: true, code: 'KeyV' })]) {
      expect(r.resolve({ ...k, focus: 'text' })).toEqual({ action: 'none', preventDefault: false })
    }
  })

  it('Esc saca el foco del cuadro de texto (no vuelve atrás)', () => {
    expect(registry().resolve(key('Escape', { focus: 'text' }))).toEqual({ action: 'blur' })
  })

  it('F1 sí vale escribiendo', () => {
    expect(ran(registry().resolve(key('F1', { focus: 'text' })))).toBe('help')
  })
})

describe('modificadores y repetición', () => {
  it('una letra con Ctrl o Alt no dispara el atajo de la letra', () => {
    const r = createShortcutRegistry()
    r.add({ id: 's', title: '', priority: 0, modal: false, active: () => true, shortcuts: () => [shortcut('cut', ['p']), shortcut('save', ['g'])] })
    expect(r.resolve(key('p', { ctrl: true, code: 'KeyP' }))).toEqual({ action: 'none', preventDefault: false })
    expect(r.resolve(key('g', { alt: true }))).toEqual({ action: 'none', preventDefault: false })
  })

  it('dejar pulsado no repite lo peligroso, pero sí las flechas', () => {
    const r = createShortcutRegistry()
    r.add({ id: 's', title: '', priority: 0, modal: false, active: () => true, shortcuts: () => [shortcut('remove', ['Delete']), shortcut('back1s', ['ArrowLeft'], { repeat: true })] })
    expect(ran(r.resolve(key('Delete')))).toBe('remove')
    expect(r.resolve(key('Delete', { repeat: true }))).toEqual({ action: 'none', preventDefault: true })
    expect(ran(r.resolve(key('ArrowLeft', { repeat: true })))).toBe('back1s')
  })
})

describe('foco en botones y deslizadores', () => {
  function registry(withEnter = true) {
    const r = createShortcutRegistry()
    r.add({
      id: 's',
      title: '',
      priority: 0,
      modal: false,
      active: () => true,
      shortcuts: () => [shortcut('play', ['Space']), shortcut('back1s', ['ArrowLeft'], { repeat: true }), ...(withEnter ? [shortcut('main', ['Enter'])] : [])],
    })
    return r
  }

  it('espacio con un botón enfocado es el atajo (y no se pulsa el botón)', () => {
    for (const focus of ['button-keyboard', 'button-mouse'] as const) {
      expect(ran(registry().resolve(key(' ', { focus })))).toBe('play')
    }
  })

  it('Intro en un botón al que se llegó con Tab lo pulsa; si se tocó con el ratón, no se repite', () => {
    expect(registry().resolve(key('Enter', { focus: 'button-keyboard' }))).toEqual({ action: 'none', preventDefault: false })
    expect(ran(registry().resolve(key('Enter', { focus: 'button-mouse' })))).toBe('main')
    expect(registry(false).resolve(key('Enter', { focus: 'button-mouse' }))).toEqual({ action: 'none', preventDefault: true })
    expect(registry(false).resolve(key(' ', { focus: 'button-keyboard' }))).toEqual({ action: 'run', shortcut: expect.objectContaining({ id: 'play' }), layer: expect.anything() })
  })

  it('en un diálogo, Intro es la opción del diálogo aunque haya un botón enfocado con Tab', () => {
    const r = createShortcutRegistry()
    r.add({ id: 'd', title: '', priority: LAYER_PRIORITY.dialog, modal: true, active: () => true, shortcuts: () => [shortcut('safe', ['Enter'])] })
    expect(ran(r.resolve(key('Enter', { focus: 'button-keyboard' })))).toBe('safe')
  })

  it('en un deslizador las flechas son suyas, el espacio no', () => {
    expect(registry().resolve(key('ArrowLeft', { focus: 'range' }))).toEqual({ action: 'none', preventDefault: false })
    expect(ran(registry().resolve(key(' ', { focus: 'range' })))).toBe('play')
  })

  it('espacio sin atajo no desplaza la pantalla', () => {
    const r = createShortcutRegistry()
    expect(r.resolve(key(' '))).toEqual({ action: 'none', preventDefault: true })
  })
})
