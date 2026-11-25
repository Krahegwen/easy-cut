// Utilidades compartidas por los tests del dominio (no se usa en producción).
import type { MediaInfo } from './project'

export function fakeMedia(overrides: Partial<MediaInfo> & { path: string }): MediaInfo {
  return {
    durationMs: 10_000,
    hasVideo: true,
    width: 1920,
    height: 1080,
    codedWidth: 1920,
    codedHeight: 1080,
    rotation: 0,
    fps: 30,
    hasAudio: true,
    isHdr: false,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    colorTransfer: 'bt709',
    colorPrimaries: 'bt709',
    colorSpace: 'bt709',
    audioCodec: 'aac',
    audioSampleRate: 48_000,
    audioChannels: 2,
    sizeBytes: null,
    ...overrides,
  }
}

/** Un fichero de solo sonido (M4A, MP3…), como lo devuelve parseProbeOutput. */
export function fakeAudio(overrides: Partial<MediaInfo> & { path: string }): MediaInfo {
  return fakeMedia({
    hasVideo: false,
    width: 0,
    height: 0,
    codedWidth: 0,
    codedHeight: 0,
    fps: 0,
    videoCodec: 'ninguno',
    pixelFormat: null,
    colorTransfer: null,
    colorPrimaries: null,
    colorSpace: null,
    ...overrides,
  })
}
