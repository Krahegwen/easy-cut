// Bridge falso para probar el store y la exportación sin Tauri ni ffmpeg (solo tests).
import type { MediaInfo } from '../domain/project'
import { CancelledError, joinWindowsPath, type NativeBridge, type ProcessResult, type RunningProcess } from '../native/bridge'
import { fakeMedia } from '../domain/test-helpers'

export interface FakeBridgeState {
  media: Record<string, MediaInfo>
  existing: Set<string>
  autosave: string | null
  files: Set<string>
  deleted: string[]
  ffmpegRuns: { args: readonly string[] }[]
  tempFiles: Record<string, string>
  /** Código de salida de cada ejecución de ffmpeg, en orden (por defecto 0). */
  ffmpegExitCodes: number[]
  /** Si es true, ffmpeg no termina hasta que se cancela. */
  ffmpegHangs: boolean
  encoders: Record<string, boolean>
  /** Portapapeles del sistema: secuencia y ficheros copiados en el Explorador. */
  clipboard: { sequence: number; paths: string[] }
  /** Ventana a pantalla completa del sistema (lo último pedido con setWindowFullscreen). */
  windowFullscreen: boolean
  /** Biblioteca: ficheros ya descargados (nombre → ruta) y descargas pedidas. */
  library: Record<string, string>
  libraryFetches: string[]
  /** Líneas añadidas al registro de guardados. */
  saveLog: string[]
  /** Si es true, escribir el registro falla. */
  saveLogFails: boolean
  /** Peso de los ficheros guardados (por defecto, 1 MB si existe). */
  fileSizes: Record<string, number>
  /** Vídeos en marcha guardados (id → JSON, cuándo y la copia anterior). */
  projects: Record<string, { json: string; modifiedMs: number; backup?: string }>
  /** Historiales de deshacer guardados. */
  histories: Record<string, string>
  /** Ids escritos, en orden. */
  writes: string[]
  /** Reloj de las escrituras (ms; sube 1 s en cada una). */
  clock: number
  /** Si es true, guardar un vídeo falla. */
  writeFails: boolean
  /** Si es true, leer la lista falla. */
  projectsFail: boolean
  /** Lo exportado a .easycut. */
  exported: { json: string; suggestedName?: string }[]
  /** Lo que devuelve «Abrir un fichero de proyecto». */
  projectFile: { path: string; json: string } | null
  /** Limpiezas de la caché pedidas. */
  cleanups: { sources: string[]; libraryFiles: string[]; force: boolean }[]
}

export function createFakeBridge(initial: Partial<FakeBridgeState> = {}): { bridge: NativeBridge; state: FakeBridgeState } {
  const state: FakeBridgeState = {
    media: {},
    existing: new Set(),
    autosave: null,
    files: new Set(),
    deleted: [],
    ffmpegRuns: [],
    tempFiles: {},
    ffmpegExitCodes: [],
    ffmpegHangs: false,
    encoders: { h264_nvenc: true, libx264: true },
    clipboard: { sequence: 1, paths: [] },
    windowFullscreen: false,
    library: {},
    libraryFetches: [],
    saveLog: [],
    saveLogFails: false,
    fileSizes: {},
    projects: {},
    histories: {},
    writes: [],
    clock: 1_800_000_000_000,
    writeFails: false,
    projectsFail: false,
    exported: [],
    projectFile: null,
    cleanups: [],
    ...initial,
  }
  for (const p of Object.keys(state.media)) state.existing.add(p)

  const done = <T>(value: T): RunningProcess<T> => ({ result: Promise.resolve(value), cancel() {} })

  const bridge: NativeBridge = {
    pickVideos: async () => [],
    probe: async (path) => {
      const m = state.media[path]
      if (!m || !state.existing.has(path)) throw new Error(`No se ha podido leer el vídeo: ${path}`)
      return m
    },
    exists: async (path) => state.existing.has(path),
    mediaUrl: (path) => `asset://${path}`,
    makePreviewProxy: (path) => done(`${path}.proxy.mp4`),
    runFfmpeg(args, onLine) {
      state.ffmpegRuns.push({ args })
      const out = args[args.length - 1]!
      state.files.add(out)
      let cancel: () => void = () => {}
      const result = new Promise<ProcessResult>((resolve, reject) => {
        cancel = () => reject(new CancelledError())
        if (state.ffmpegHangs) return
        const code = state.ffmpegExitCodes.shift() ?? 0
        setTimeout(() => {
          onLine('out_time_us=1000000')
          onLine('progress=end')
          resolve({ exitCode: code, stderr: code === 0 ? '' : 'Error al abrir el encoder' })
        }, 0)
      })
      return { result, cancel: () => cancel() }
    },
    writeTempTextFile: async (name, contents) => {
      const path = `C:\\tmp\\${name}`
      state.tempFiles[path] = contents
      return path
    },
    detectSilences: () => done([]),
    thumbnails: (req) => done(req.timesMs.map((timeMs) => ({ timeMs, url: `thumb://${req.path}@${timeMs}`, width: 160, height: req.height }))),
    waveform: (req) => done({ timeMs: 0, url: `wave://${req.path}`, width: req.width, height: req.height }),
    probeEncoders: async () => state.encoders,
    getOutputFolder: async () => 'C:\\Users\\Ana\\Videos\\Mis montajes',
    pickOutputFolder: async () => null,
    listFileNames: async () => [...state.files].map((f) => f.split('\\').pop()!),
    joinPath: (...parts) => joinWindowsPath(...parts),
    deletePartialOutput: async (path) => {
      state.deleted.push(path)
      state.files.delete(path)
    },
    outputFileSize: async (path) => (state.files.has(path) ? state.fileSizes[path] ?? 1_000_000 : null),
    appendSaveLog: async (line) => {
      if (state.saveLogFails) throw new Error('disco lleno')
      state.saveLog.push(line)
    },
    openFile: async () => {},
    revealInFolder: async () => {},
    copyFileToClipboard: async () => {},
    clipboardSequence: async () => state.clipboard.sequence,
    clipboardFiles: async () => ({ sequence: state.clipboard.sequence, paths: [...state.clipboard.paths] }),
    setWindowFullscreen: async (on) => {
      state.windowFullscreen = on
      return true
    },
    saveAutosave: async (json) => {
      state.autosave = json
    },
    loadAutosave: async () => state.autosave,
    clearAutosave: async () => {
      state.autosave = null
    },
    listProjects: async () => {
      if (state.projectsFail) throw new Error('no se puede leer la carpeta')
      return Object.entries(state.projects).map(([id, p]) => ({ id, json: p.json, modifiedMs: p.modifiedMs, hasBackup: !!p.backup }))
    },
    readProject: async (id) => state.projects[id]?.json ?? null,
    writeProject: async (id, json) => {
      if (state.writeFails) throw new Error('disco lleno')
      state.clock += 1000
      const before = state.projects[id]
      state.projects[id] = { json, modifiedMs: state.clock, backup: before ? before.json : undefined }
      state.writes.push(id)
    },
    deleteProject: async (id) => {
      delete state.projects[id]
      delete state.histories[id]
    },
    restoreProjectBackup: async (id) => {
      const p = state.projects[id]
      if (!p?.backup) throw new Error('No hay copia anterior de este vídeo')
      state.clock += 1000
      state.projects[id] = { json: p.backup, modifiedMs: state.clock, backup: p.json }
      delete state.histories[id]
      return p.backup
    },
    readProjectHistory: async (id) => state.histories[id] ?? null,
    writeProjectHistory: async (id, json) => {
      state.histories[id] = json
    },
    cleanCache: async (sources, libraryFiles, force) => {
      state.cleanups.push({ sources: [...sources], libraryFiles: [...libraryFiles], force: !!force })
      return { ran: true, deleted: 0, freedBytes: 0, keptBytes: 0 }
    },
    saveProject: async (json, path, suggestedName) => {
      state.exported.push({ json, suggestedName })
      return path ?? `C:\\Users\\Ana\\Videos\\Mis montajes\\${suggestedName ?? 'Proyecto'}.easycut`
    },
    loadProject: async () => state.projectFile,
    saveRecording: async () => ({ path: '', durationMs: 0, kind: 'video' }),
    beginRecording: async (_name, _ext, kind = 'video') => ({
      tempPath: 'C:\\tmp\\rec.mp4',
      append: async () => {},
      save: async () => ({ path: '', durationMs: 0, kind }),
      discard: async () => {},
    }),
    deleteRecording: async (path) => {
      state.deleted.push(path)
    },
    libraryStatus: async (files) => files.map((f) => state.library[f.file] ?? null),
    libraryFetch: (ref) => {
      state.libraryFetches.push(ref.file)
      const path = `C:\\cache\\library\\${ref.file}`
      state.library[ref.file] = path
      state.existing.add(path)
      return done(path)
    },
    libraryCatalog: async () => null,
    onFilesDropped: () => () => {},
  }
  return { bridge, state }
}

export function mediaSet(): Record<string, MediaInfo> {
  return {
    'C:\\v\\horizontal.mp4': fakeMedia({ path: 'C:\\v\\horizontal.mp4', durationMs: 10_000 }),
    'C:\\v\\vertical.mp4': fakeMedia({ path: 'C:\\v\\vertical.mp4', durationMs: 8_000, width: 1080, height: 1920 }),
    'C:\\v\\vertical2.mp4': fakeMedia({ path: 'C:\\v\\vertical2.mp4', durationMs: 5_000, width: 720, height: 1280 }),
  }
}
