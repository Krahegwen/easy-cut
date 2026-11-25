import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createUpdater, downloadFraction, type AvailableUpdate, type DownloadEvent, type UpdaterBackend, type UpdaterOptions } from './updater'

interface FakeUpdate extends AvailableUpdate {
  closed: number
  installed: number
  /** Termina la descarga (o la hace fallar) cuando lo diga la prueba. */
  finish: (error?: unknown) => void
  emit: (e: DownloadEvent) => void
}

function fakeUpdate(version: string): FakeUpdate {
  let resolve: (() => void) | null = null
  let reject: ((e: unknown) => void) | null = null
  let onEvent: ((e: DownloadEvent) => void) | null = null
  const u: FakeUpdate = {
    version,
    closed: 0,
    installed: 0,
    download(cb) {
      onEvent = cb
      return new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
    },
    async install() {
      u.installed += 1
    },
    async close() {
      u.closed += 1
    },
    finish(error) {
      if (error === undefined) resolve?.()
      else reject?.(error)
    },
    emit(e) {
      onEvent?.(e)
    },
  }
  return u
}

function setup(responses: (() => Promise<AvailableUpdate | null>)[], extra: Partial<UpdaterOptions> = {}) {
  const calls = { check: 0, relaunch: 0, beforeInstall: 0 }
  const log = vi.fn()
  const backend: UpdaterBackend = {
    check: () => {
      calls.check += 1
      const next = responses.shift()
      return next ? next() : Promise.resolve(null)
    },
    relaunch: async () => {
      calls.relaunch += 1
    },
  }
  // Reactivo, como en la app (la pantalla y el guardado son refs).
  const busy = ref(false)
  const updater = createUpdater({
    backend,
    beforeInstall: async () => {
      calls.beforeInstall += 1
    },
    busy: () => busy.value,
    firstCheckDelayMs: 5_000,
    intervalMs: 60 * 60 * 1000,
    log,
    ...extra,
  })
  return { updater, calls, log, setBusy: (b: boolean) => (busy.value = b) }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('actualizador', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('no comprueba al arrancar, sino unos segundos después, y avisa si hay versión nueva', async () => {
    const u = fakeUpdate('0.3.0')
    const { updater, calls } = setup([() => Promise.resolve(u)])
    updater.start()
    await flush()
    expect(calls.check).toBe(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls.check).toBe(1)
    expect(updater.available.value?.version).toBe('0.3.0')
    expect(updater.noticeVisible.value).toBe(true)
    // Ya se sabe que hay una: no se sigue preguntando.
    await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000)
    expect(calls.check).toBe(1)
  })

  it('sin versión nueva no enseña nada y vuelve a mirar como mucho una vez por intervalo', async () => {
    const { updater, calls } = setup([])
    updater.start()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls.check).toBe(1)
    expect(updater.noticeVisible.value).toBe(false)
    expect(updater.manualStatus.value).toBe('idle')
    await vi.advanceTimersByTimeAsync(59 * 60 * 1000)
    expect(calls.check).toBe(1)
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(calls.check).toBe(2)
  })

  it('un error de red en la comprobación automática es silencioso: solo un log, y se reintenta más tarde', async () => {
    const { updater, calls, log } = setup([() => Promise.reject(new Error('error sending request: dns error'))])
    updater.start()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls.check).toBe(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(updater.noticeVisible.value).toBe(false)
    expect(updater.dialog.value).toBeNull()
    expect(updater.manualStatus.value).toBe('idle')
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(calls.check).toBe(2)
  })

  it('«Buscar actualizaciones» responde: ya tienes la última, o no se ha podido comprobar', async () => {
    const { updater } = setup([() => Promise.resolve(null), () => Promise.reject(new Error('offline'))])
    const p = updater.checkNow()
    expect(updater.manualStatus.value).toBe('checking')
    await p
    expect(updater.manualStatus.value).toBe('up-to-date')
    await updater.checkNow()
    expect(updater.manualStatus.value).toBe('failed')
  })

  it('una comprobación a mano cuenta para el intervalo de las automáticas', async () => {
    const { updater, calls } = setup([])
    await updater.checkNow()
    updater.start()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls.check).toBe(1)
  })

  it('«Más tarde» oculta el aviso hasta el próximo arranque; «Buscar actualizaciones» lo vuelve a enseñar', async () => {
    const u = fakeUpdate('0.3.0')
    const { updater, calls } = setup([() => Promise.resolve(u)])
    updater.start()
    await vi.advanceTimersByTimeAsync(5_000)
    updater.later()
    expect(updater.noticeVisible.value).toBe(false)
    await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000)
    expect(updater.noticeVisible.value).toBe(false)
    await updater.checkNow()
    expect(calls.check).toBe(1)
    expect(updater.manualStatus.value).toBe('found')
    expect(updater.noticeVisible.value).toBe(true)
  })

  it('no se ofrece durante un guardado o una grabación, y «Actualizar ahora» no hace nada entonces', async () => {
    const u = fakeUpdate('0.3.0')
    const { updater, setBusy, calls } = setup([() => Promise.resolve(u)])
    setBusy(true)
    await updater.checkNow()
    expect(updater.available.value).toBe(u)
    expect(updater.noticeVisible.value).toBe(false)
    updater.askToUpdate()
    expect(updater.dialog.value).toBeNull()
    await updater.updateNow()
    expect(updater.dialog.value).toBeNull()
    expect(calls.beforeInstall).toBe(0)
    setBusy(false)
    expect(updater.noticeVisible.value).toBe(true)
  })

  it('actualizar: pregunta, guarda el autoguardado, descarga con progreso real, instala y reinicia', async () => {
    const u = fakeUpdate('0.3.0')
    const { updater, calls } = setup([() => Promise.resolve(u)])
    await updater.checkNow()
    updater.askToUpdate()
    expect(updater.dialog.value).toEqual({ phase: 'confirm', version: '0.3.0' })
    expect(updater.noticeVisible.value).toBe(false)
    const done = updater.updateNow()
    await flush()
    expect(calls.beforeInstall).toBe(1)
    expect(updater.dialog.value?.phase).toBe('downloading')
    expect(downloadFraction(updater.dialog.value)).toBeNull()
    u.emit({ kind: 'started', totalBytes: 1000 })
    u.emit({ kind: 'progress', chunkBytes: 250 })
    expect(downloadFraction(updater.dialog.value)).toBe(0.25)
    u.emit({ kind: 'progress', chunkBytes: 500 })
    expect(downloadFraction(updater.dialog.value)).toBe(0.75)
    u.emit({ kind: 'progress', chunkBytes: 250 })
    u.emit({ kind: 'finished' })
    expect(downloadFraction(updater.dialog.value)).toBe(1)
    u.finish()
    await done
    // El autoguardado se escribe otra vez justo antes de instalar.
    expect(calls.beforeInstall).toBe(2)
    expect(u.installed).toBe(1)
    expect(calls.relaunch).toBe(1)
    expect(updater.dialog.value?.phase).toBe('installing')
  })

  it('si la descarga o la firma fallan: el aviso en llano, no se instala y no se vuelve a ofrecer', async () => {
    const u = fakeUpdate('0.3.0')
    const { updater, calls, log } = setup([() => Promise.resolve(u)])
    await updater.checkNow()
    updater.askToUpdate()
    const done = updater.updateNow()
    await flush()
    u.finish(new Error('signature verification failed'))
    await done
    expect(u.installed).toBe(0)
    expect(calls.relaunch).toBe(0)
    expect(log).toHaveBeenCalled()
    const d = updater.dialog.value
    expect(d?.phase).toBe('failed')
    expect(d?.phase === 'failed' && d.details).toContain('signature verification failed')
    updater.closeDialog()
    expect(updater.dialog.value).toBeNull()
    expect(updater.noticeVisible.value).toBe(false)
    expect(u.closed).toBe(1)
  })

  it('«Cancelar» durante la descarga: se cierra el diálogo, no se instala aunque la descarga acabe', async () => {
    const u = fakeUpdate('0.3.0')
    const { updater, calls } = setup([() => Promise.resolve(u)])
    await updater.checkNow()
    updater.askToUpdate()
    const done = updater.updateNow()
    await flush()
    u.emit({ kind: 'started', totalBytes: 1000 })
    updater.closeDialog()
    expect(updater.dialog.value).toBeNull()
    // Los eventos que lleguen después no vuelven a abrir nada.
    u.emit({ kind: 'progress', chunkBytes: 500 })
    expect(updater.dialog.value).toBeNull()
    u.finish()
    await done
    expect(u.installed).toBe(0)
    expect(calls.relaunch).toBe(0)
    expect(updater.dialog.value).toBeNull()
    expect(updater.noticeVisible.value).toBe(false)
  })

  it('en la pregunta, Esc/«Más tarde» cierra y oculta el aviso', async () => {
    const u = fakeUpdate('0.3.0')
    const { updater } = setup([() => Promise.resolve(u)])
    await updater.checkNow()
    updater.askToUpdate()
    updater.closeDialog()
    expect(updater.dialog.value).toBeNull()
    expect(updater.noticeVisible.value).toBe(false)
  })

  it('instalando no se puede cerrar el diálogo', async () => {
    const u = fakeUpdate('0.3.0')
    u.install = () => new Promise<void>(() => {})
    const { updater } = setup([() => Promise.resolve(u)])
    await updater.checkNow()
    updater.askToUpdate()
    void updater.updateNow()
    await flush()
    u.finish()
    await flush()
    expect(updater.dialog.value?.phase).toBe('installing')
    updater.closeDialog()
    expect(updater.dialog.value?.phase).toBe('installing')
  })

  it('dos comprobaciones a la vez comparten la misma petición', async () => {
    let resolve: (v: null) => void = () => {}
    const { updater, calls } = setup([() => new Promise((r) => (resolve = r))])
    const a = updater.checkNow()
    const b = updater.checkNow()
    resolve(null)
    await Promise.all([a, b])
    expect(calls.check).toBe(1)
    expect(updater.manualStatus.value).toBe('up-to-date')
  })
})
