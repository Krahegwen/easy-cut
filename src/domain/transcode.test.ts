import { describe, expect, it } from 'vitest'
import { BT709_SETPARAMS } from './ffmpeg-args'
import { fakeMedia } from './test-helpers'
import {
  buildPreviewProxyArgs,
  buildRecordingTranscodeArgs,
  chooseFastEncoder,
  proxyFps,
  proxyScaleFilter,
} from './transcode'

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

describe('proxy de vista previa', () => {
  it('lleva el lado corto a 540 sin agrandar y respetando la orientación', () => {
    expect(proxyScaleFilter({ width: 1920, height: 1080 })).toBe('scale=-2:540')
    expect(proxyScaleFilter({ width: 1080, height: 1920 })).toBe('scale=540:-2')
    expect(proxyScaleFilter({ width: 640, height: 360 })).toBe('scale=-2:360')
    expect(proxyScaleFilter({ width: 1080, height: 1080 })).toBe('scale=-2:540')
  })

  it('fps del original, con tope de 60', () => {
    expect(proxyFps({ fps: 29.97 })).toBe(29.97)
    expect(proxyFps({ fps: 120 })).toBe(60)
    expect(proxyFps({ fps: 0 })).toBe(30)
  })

  it('no recorta ni desplaza: un solo -i sin -ss ni -t, CFR y audio opcional en AAC', () => {
    const media = fakeMedia({ path: 'C:\\Vídeos\\móvil 1.mov', fps: 59.94, width: 1080, height: 1920 })
    const args = buildPreviewProxyArgs(media, 'C:\\cache\\p.mp4', 'libx264')
    expect(args).not.toContain('-ss')
    expect(args).not.toContain('-t')
    expect(valueAfter(args, '-i')).toBe(media.path)
    expect(valueAfter(args, '-vf')).toBe('scale=540:-2,fps=59.94,format=yuv420p')
    expect(valueAfter(args, '-fps_mode')).toBe('cfr')
    expect(valueAfter(args, '-c:v')).toBe('libx264')
    expect(valueAfter(args, '-preset')).toBe('veryfast')
    expect(valueAfter(args, '-g')).toBe('60')
    expect(args).toContain('0:a:0?')
    expect(valueAfter(args, '-c:a')).toBe('aac')
    expect(args.at(-1)).toBe('C:\\cache\\p.mp4')
  })

  it('HDR: tone mapping a BT.709 antes de escalar', () => {
    const media = fakeMedia({ path: 'hdr.mov', isHdr: true, colorTransfer: 'arib-std-b67', colorSpace: 'bt2020nc' })
    const vf = valueAfter(buildPreviewProxyArgs(media, 'o.mp4', 'h264_nvenc'), '-vf')!
    expect(vf.startsWith('zscale=tin=arib-std-b67')).toBe(true)
    expect(vf).toContain(`${BT709_SETPARAMS},scale=-2:540`)
  })

  it('NVENC rápido y con opciones de Pascal', () => {
    const args = buildPreviewProxyArgs(fakeMedia({ path: 'a.mp4' }), 'o.mp4', 'h264_nvenc')
    expect(valueAfter(args, '-c:v')).toBe('h264_nvenc')
    expect(valueAfter(args, '-preset')).toBe('p1')
    expect(valueAfter(args, '-bf')).toBe('0')
  })
})

describe('grabaciones', () => {
  it('WebM de MediaRecorder a MP4 H.264 + AAC a 30 fps CFR', () => {
    const args = buildRecordingTranscodeArgs('in.webm', 'out.mp4', 'libx264')
    expect(valueAfter(args, '-fflags')).toBe('+genpts')
    expect(valueAfter(args, '-vf')).toContain('fps=30')
    expect(valueAfter(args, '-fps_mode')).toBe('cfr')
    expect(valueAfter(args, '-r')).toBe('30')
    expect(valueAfter(args, '-c:a')).toBe('aac')
    expect(valueAfter(args, '-movflags')).toBe('+faststart')
    expect(args.at(-1)).toBe('out.mp4')
  })

  it('elige NVENC solo si pasó la prueba', () => {
    expect(chooseFastEncoder({ h264_nvenc: true })).toBe('h264_nvenc')
    expect(chooseFastEncoder({ h264_nvenc: false, h264_qsv: true })).toBe('libx264')
    expect(chooseFastEncoder({})).toBe('libx264')
  })
})
