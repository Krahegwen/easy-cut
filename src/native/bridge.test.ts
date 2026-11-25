import { describe, expect, it } from 'vitest'
import { joinWindowsPath } from './bridge'

describe('joinWindowsPath', () => {
  it('une con una sola barra invertida', () => {
    expect(joinWindowsPath('C:\\Users\\Ana\\Videos', 'Mis montajes', 'a.mp4')).toBe('C:\\Users\\Ana\\Videos\\Mis montajes\\a.mp4')
    expect(joinWindowsPath('C:\\', 'a.mp4')).toBe('C:\\a.mp4')
    expect(joinWindowsPath('D:\\Vídeos\\', '\\Grabaciones\\', 'toma 1.mp4')).toBe('D:\\Vídeos\\Grabaciones\\toma 1.mp4')
    expect(joinWindowsPath('C:/x/', 'y')).toBe('C:\\x\\y')
    expect(joinWindowsPath('', 'a', '')).toBe('a')
  })
})
