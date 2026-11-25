// Sprites del Particle Pack de Kenney (CC0, https://kenney.nl/assets/particle-pack) para los efectos de la
// biblioteca. Se leen las PNG «Black background» (luz blanca sobre negro: el brillo hace de intensidad) con
// ffmpeg, en gris, y se escalan en JavaScript a cada tamaño que haga falta (con caché).
// Si la carpeta no está (library/sources/ no se versiona), devuelve null y los efectos que los usan no se rehacen.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 256

export const PARTICLE_PACK = {
  url: 'https://kenney.nl/assets/particle-pack',
  thanks: '"Particle Pack" por Kenney — https://kenney.nl/assets/particle-pack — CC0 1.0',
}

export function loadParticleSprites(root) {
  const dir = join(root, 'library', 'sources', 'kenney', 'particle-pack', 'PNG (Black background)')
  if (!existsSync(dir)) return null
  const raw = new Map()
  const cache = new Map()

  function base(name) {
    if (raw.has(name)) return raw.get(name)
    const path = join(dir, `${name}.png`)
    if (!existsSync(path)) throw new Error(`falta el sprite ${name}.png del Particle Pack`)
    const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vf', `scale=${BASE}:${BASE}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 })
    const a = new Float32Array(BASE * BASE)
    for (let i = 0; i < a.length; i++) a[i] = buf[i] / 255
    raw.set(name, a)
    return a
  }

  /** Sprite `name` escalado a `size` px (lado), como { w, h, a } con a de 0 a 1. Tamaños redondeados a 2 px. */
  function get(name, size) {
    const s = Math.max(2, Math.round(size / 2) * 2)
    const key = `${name}@${s}`
    if (cache.has(key)) return cache.get(key)
    const src = base(name)
    const a = new Float32Array(s * s)
    const k = BASE / s
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        // Media de la caja que cubre el píxel de destino (reducir sin dientes).
        const x0 = Math.floor(x * k)
        const y0 = Math.floor(y * k)
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) * k))
        const y1 = Math.max(y0 + 1, Math.floor((y + 1) * k))
        let sum = 0
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += src[yy * BASE + xx]
        a[y * s + x] = sum / ((x1 - x0) * (y1 - y0))
      }
    }
    const spr = { w: s, h: s, a }
    cache.set(key, spr)
    return spr
  }

  return { get }
}
