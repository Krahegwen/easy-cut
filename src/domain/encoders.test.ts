import { describe, expect, it } from 'vitest'
import { buildEncoderProbeArgs, chooseEncoder, encoderFallbackChain, encoderVideoArgs } from './encoders'
import type { OutputSpec } from './output'

const spec: OutputSpec = {
  preset: 'youtube',
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitrateKbps: 8000,
  maxBitrateKbps: 12_000,
  bufferKbps: 24_000,
  audioBitrateKbps: 384,
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

describe('parámetros del encoder', () => {
  it('libx264 con CRF y tope', () => {
    const a = encoderVideoArgs('libx264', spec)
    expect(opt(a, '-c:v')).toBe('libx264')
    expect(opt(a, '-crf')).toBe('20')
    expect(opt(a, '-maxrate')).toBe('12000k')
    expect(opt(a, '-bufsize')).toBe('24000k')
    expect(opt(a, '-g')).toBe('60')
  })

  it('NVENC conservador para Pascal', () => {
    const a = encoderVideoArgs('h264_nvenc', spec)
    expect(opt(a, '-rc')).toBe('vbr')
    expect(opt(a, '-cq')).toBe('21')
    expect(opt(a, '-b_ref_mode')).toBe('disabled')
    expect(opt(a, '-preset')).toBe('p5')
    expect(a).not.toContain('-temporal-aq')
    expect(a).not.toContain('-rc-lookahead')
  })

  it('QSV y AMF', () => {
    expect(opt(encoderVideoArgs('h264_qsv', spec), '-pix_fmt')).toBe('nv12')
    expect(opt(encoderVideoArgs('h264_amf', spec), '-rc')).toBe('vbr_peak')
  })

  it('prueba mínima: 1 s de lavfi a -f null', () => {
    const a = buildEncoderProbeArgs('h264_nvenc')
    expect(opt(a, '-f')).toBe('lavfi')
    expect(opt(a, '-i')).toMatch(/duration=1$/)
    expect(a.slice(-3)).toEqual(['-f', 'null', '-'])
    expect(opt(a, '-c:v')).toBe('h264_nvenc')
  })
})

describe('elección', () => {
  it('prefiere NVENC, luego QSV, luego AMF, y si no libx264', () => {
    expect(chooseEncoder({ h264_nvenc: true, h264_qsv: true })).toBe('h264_nvenc')
    expect(chooseEncoder({ h264_nvenc: false, h264_qsv: true })).toBe('h264_qsv')
    expect(chooseEncoder({ h264_amf: true })).toBe('h264_amf')
    expect(chooseEncoder({})).toBe('libx264')
  })

  it('respeta la preferencia solo si funciona', () => {
    expect(chooseEncoder({ h264_nvenc: true, h264_amf: true }, 'h264_amf')).toBe('h264_amf')
    expect(chooseEncoder({ h264_nvenc: true }, 'h264_qsv')).toBe('h264_nvenc')
    expect(chooseEncoder({ h264_nvenc: true }, 'libx264')).toBe('libx264')
  })

  it('cadena de reintentos termina siempre en libx264', () => {
    expect(encoderFallbackChain({ h264_nvenc: true, h264_qsv: true })).toEqual(['h264_nvenc', 'h264_qsv', 'libx264'])
    expect(encoderFallbackChain({})).toEqual(['libx264'])
  })
})
