import { describe, expect, it } from 'vitest'
import { buildProbeArgs, parseFrameRate, parseProbeOutput, ProbeError } from './probe'

const video = (extra: Record<string, unknown> = {}) => ({
  codec_type: 'video',
  codec_name: 'h264',
  width: 1920,
  height: 1080,
  pix_fmt: 'yuv420p',
  avg_frame_rate: '30000/1001',
  r_frame_rate: '30000/1001',
  ...extra,
})
const audio = { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }

describe('ffprobe', () => {
  it('args', () => {
    expect(buildProbeArgs('C:\\Mis vídeos\\a b.mp4')).toEqual([
      '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', 'C:\\Mis vídeos\\a b.mp4',
    ])
  })

  it('fps', () => {
    expect(parseFrameRate('30000/1001')).toBe(29.97)
    expect(parseFrameRate('60/1')).toBe(60)
    expect(parseFrameRate('25')).toBe(25)
    expect(parseFrameRate('0/0')).toBeNull()
    expect(parseFrameRate(undefined)).toBeNull()
  })

  it('vídeo normal con audio', () => {
    const m = parseProbeOutput(
      JSON.stringify({ streams: [video(), audio], format: { duration: '12.345678', size: '1000' } }),
      'a.mp4',
    )
    expect(m).toMatchObject({
      path: 'a.mp4',
      durationMs: 12_346,
      width: 1920,
      height: 1080,
      rotation: 0,
      fps: 29.97,
      hasAudio: true,
      isHdr: false,
      videoCodec: 'h264',
      audioSampleRate: 48_000,
      audioChannels: 2,
      sizeBytes: 1000,
    })
  })

  it('rotación por matriz de visualización (móvil en vertical)', () => {
    const m = parseProbeOutput(
      {
        streams: [video({ side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] }), audio],
        format: { duration: '5' },
      },
      'p.mp4',
    )
    expect(m.rotation).toBe(90)
    expect([m.width, m.height, m.codedWidth, m.codedHeight]).toEqual([1080, 1920, 1920, 1080])
  })

  it('rotación por la etiqueta antigua rotate y valores 180/270', () => {
    const tag = parseProbeOutput({ streams: [video({ tags: { rotate: '90' } })], format: { duration: '5' } }, 't')
    expect(tag.rotation).toBe(90)
    const r180 = parseProbeOutput({ streams: [video({ side_data_list: [{ rotation: 180 }] })], format: { duration: '5' } }, 't')
    expect(r180.rotation).toBe(180)
    expect(r180.width).toBe(1920)
    const r270 = parseProbeOutput({ streams: [video({ side_data_list: [{ rotation: 90 }] })], format: { duration: '5' } }, 't')
    expect(r270.rotation).toBe(270)
    expect(r270.width).toBe(1080)
  })

  it('HDR PQ y HLG', () => {
    const pq = parseProbeOutput({ streams: [video({ color_transfer: 'smpte2084' })], format: { duration: '1' } }, 'x')
    const hlg = parseProbeOutput({ streams: [video({ color_transfer: 'arib-std-b67' })], format: { duration: '1' } }, 'x')
    const sdr = parseProbeOutput({ streams: [video({ color_transfer: 'bt709' })], format: { duration: '1' } }, 'x')
    expect([pq.isHdr, hlg.isHdr, sdr.isHdr]).toEqual([true, true, false])
  })

  it('sin pista de audio, fps de reserva y duración del stream', () => {
    const m = parseProbeOutput(
      { streams: [video({ avg_frame_rate: '0/0', r_frame_rate: '25/1', duration: '3.5' })], format: {} },
      'x',
    )
    expect(m.hasAudio).toBe(false)
    expect(m.audioCodec).toBeNull()
    expect(m.fps).toBe(25)
    expect(m.durationMs).toBe(3500)
  })

  it('ignora la carátula (attached_pic)', () => {
    const m = parseProbeOutput(
      {
        streams: [
          video({ codec_name: 'mjpeg', width: 300, height: 300, disposition: { attached_pic: 1 } }),
          video({ codec_name: 'hevc' }),
        ],
        format: { duration: '2' },
      },
      'x',
    )
    expect(m.videoCodec).toBe('hevc')
  })

  it('errores en castellano', () => {
    expect(() => parseProbeOutput('{{', 'x')).toThrow(ProbeError)
    expect(() => parseProbeOutput({ streams: [], format: { duration: '1' } }, 'x')).toThrow(/ni imagen ni sonido/)
    expect(() => parseProbeOutput({ streams: [video()], format: {} }, 'x')).toThrow(/cuánto dura/)
    expect(() => parseProbeOutput({ streams: [audio], format: {} }, 'x')).toThrow(/cuánto dura este sonido/)
  })

  it('un fichero de solo sonido (M4A, MP3 con carátula) entra sin imagen', () => {
    const m = parseProbeOutput({ streams: [audio], format: { duration: '3.25', size: '52000' } }, 'C:\\voz.m4a')
    expect(m.hasVideo).toBe(false)
    expect(m.hasAudio).toBe(true)
    expect([m.width, m.height, m.fps, m.durationMs]).toEqual([0, 0, 0, 3250])
    const coverArt = { codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, disposition: { attached_pic: 1 } }
    const mp3 = parseProbeOutput({ streams: [audio, coverArt], format: { duration: '10' } }, 'C:\\canción.mp3')
    expect(mp3.hasVideo).toBe(false)
    const withVideo = parseProbeOutput({ streams: [video(), audio], format: { duration: '1' } }, 'x')
    expect(withVideo.hasVideo).toBe(true)
  })
})
