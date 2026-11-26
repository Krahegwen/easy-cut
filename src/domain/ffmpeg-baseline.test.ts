// Sin collages, los argumentos de ffmpeg son los de antes del collage: las instantáneas de este fichero se sacaron
// con el código de la versión 6 (antes del Paquete 7) y no deben cambiar. Solo usa lo que ya existía entonces.
import { describe, expect, it } from 'vitest'
import { buildExportCommand, buildSoundExportCommand } from './ffmpeg-args'
import { addClip, createClip, createProject, setTransition, type MediaInfo, type Project, type TrackItem } from './project'
import { fakeAudio, fakeMedia } from './test-helpers'
import { createItem, insertItem, setItemFade, updateEffectLook, type NewItem } from './tracks'
import { addMark, setBoxAt } from './keyframes'
import { makeEntry } from './transitions'

const hd = fakeMedia({ path: 'C:\\v\\a.mp4', durationMs: 10_000 })
const hd2 = fakeMedia({ path: 'C:\\v\\b.mp4', durationMs: 8000 })
const music = fakeAudio({ path: 'C:\\s\\musica.mp3', durationMs: 4000 })
const sparks = fakeMedia({ path: 'C:\\fx\\chispas.mp4', durationMs: 6000, hasAudio: false })
const logo = fakeMedia({ path: 'C:\\fx\\logo.png', durationMs: 0, hasAudio: false, videoCodec: 'png', width: 400, height: 200, isStill: true, hasAlpha: true })
const media: Record<string, MediaInfo> = Object.fromEntries([hd, hd2, music, sparks, logo].map((m) => [m.path, m]))

function item(id: string, kind: 'sound' | 'effect', m: MediaInfo, extra: Partial<NewItem> = {}): TrackItem {
  return createItem({ id, kind, source: { type: 'file', path: m.path }, name: id, sourceDurationMs: m.durationMs, still: m.isStill, hasAudio: m.hasAudio, ...extra })
}

function put(p: Project, it: TrackItem, kind: 'sound' | 'effect', at: number, trackId: string): Project {
  const r = insertItem(p, it, kind, at, { id: trackId })
  if (!r.ok) throw new Error('no cabe')
  return r.project
}

function twoClips(): Project {
  return addClip(addClip(createProject(), createClip(hd, 'a')), createClip(hd2, 'b'))
}

function withTracks(): Project {
  let p = put(twoClips(), item('music', 'sound', music, { defaults: { repeat: true, durationMs: null, volume: 0.5 } }), 'sound', 0, 'mus')
  p = setItemFade(p, 'music', 'in', true)
  p = put(p, item('sparks', 'effect', sparks, { defaults: { look: { mix: 'light' } } }), 'effect', 2000, 'fx1')
  p = put(p, item('logo', 'effect', logo, { defaults: { look: { box: { scale: 0.3, x: 0.8, y: 0.2 } } } }), 'effect', 3000, 'fx2')
  // Una pegatina que se mueve (dos marcas).
  p = updateEffectLook(p, 'logo', (l) => setBoxAt(addMark(l, 0), 2000, { x: 0.2 }))
  return p
}

describe('sin collages, ffmpeg recibe lo mismo que antes', () => {
  it('dos trozos', () => {
    const cmd = buildExportCommand(twoClips(), media, 'whatsapp', 'libx264', 'o.mp4')
    expect(cmd.args).toMatchSnapshot()
    expect(cmd.filterComplex).toMatchSnapshot()
  })

  it('con sonidos, un efecto «como luz» y una pegatina que se mueve', () => {
    const cmd = buildExportCommand(withTracks(), media, 'youtube', 'h264_nvenc', 'o.mp4')
    expect(cmd.args).toMatchSnapshot()
    expect(cmd.filterComplex).toMatchSnapshot()
  })

  it('con un fundido entre los trozos', () => {
    const p = setTransition(withTracks(), 'b', makeEntry('dissolve', 1000))
    expect(buildExportCommand(p, media, 'high', 'libx264', 'o.mp4').filterComplex).toMatchSnapshot()
  })

  it('«Solo el sonido»', () => {
    const cmd = buildSoundExportCommand(withTracks(), media, 'o.m4a')
    expect(cmd.args).toMatchSnapshot()
    expect(cmd.filterComplex).toMatchSnapshot()
  })
})
