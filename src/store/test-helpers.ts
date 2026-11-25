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
    openFile: async () => {},
    revealInFolder: async () => {},
    copyFileToClipboard: async () => {},
    saveAutosave: async (json) => {
      state.autosave = json
    },
    loadAutosave: async () => state.autosave,
    clearAutosave: async () => {
      state.autosave = null
    },
    saveProject: async () => null,
    loadProject: async () => null,
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
