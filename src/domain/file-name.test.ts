import { describe, expect, it } from 'vitest'
import { baseName, buildOutputFileName, formatSpanishDate, isVideoPath } from './file-name'

const date = new Date(2026, 10, 25, 18, 30)

describe('nombre del fichero de salida', () => {
  it('fecha en castellano', () => {
    expect(formatSpanishDate(date)).toBe('25 de noviembre de 2026')
    expect(formatSpanishDate(new Date(2027, 0, 1))).toBe('1 de enero de 2027')
  })

  it('los tres presets', () => {
    expect(buildOutputFileName(date, 'whatsapp')).toBe('Vídeo del 25 de noviembre de 2026 (para WhatsApp).mp4')
    expect(buildOutputFileName(date, 'youtube')).toBe('Vídeo del 25 de noviembre de 2026 (para YouTube).mp4')
    expect(buildOutputFileName(date, 'high')).toBe('Vídeo del 25 de noviembre de 2026 (calidad alta).mp4')
  })

  it('sufijo 2, 3… si ya existe, sin distinguir mayúsculas', () => {
    const existing = [
      'vídeo del 25 de noviembre de 2026 (para whatsapp).mp4',
      'Vídeo del 25 de noviembre de 2026 (para WhatsApp) 2.mp4',
      'otro.mp4',
    ]
    expect(buildOutputFileName(date, 'whatsapp', existing)).toBe('Vídeo del 25 de noviembre de 2026 (para WhatsApp) 3.mp4')
    expect(buildOutputFileName(date, 'youtube', existing)).toBe('Vídeo del 25 de noviembre de 2026 (para YouTube).mp4')
  })

  it('tilde compuesta (NFD) cuenta como la misma', () => {
    const nfd = 'Vídeo del 25 de noviembre de 2026 (calidad alta).mp4'.normalize('NFD')
    expect(buildOutputFileName(date, 'high', [nfd])).toBe('Vídeo del 25 de noviembre de 2026 (calidad alta) 2.mp4')
  })
})

describe('vídeos por extensión y nombre del fichero', () => {
  it('isVideoPath', () => {
    expect(isVideoPath('C:\\a\\Toma 1.MP4')).toBe(true)
    expect(isVideoPath('C:\\a\\b.mov')).toBe(true)
    expect(isVideoPath('C:\\a\\foto.jpg')).toBe(false)
    expect(isVideoPath('C:\\a.b\\sin-extension')).toBe(false)
  })
  it('baseName', () => {
    expect(baseName('C:\\Users\\Ana\\Vídeos\\toma 1.mp4')).toBe('toma 1.mp4')
    expect(baseName('/tmp/x.mp4')).toBe('x.mp4')
    expect(baseName('x.mp4')).toBe('x.mp4')
  })
})
