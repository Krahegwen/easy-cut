// Genera la biblioteca en library/dist/ y escribe library/catalog.json (SHA-256, bytes, duración):
// - la tanda propia (efectos y sonidos hechos por el proyecto);
// - la tanda de terceros (CC0), preparada desde sus originales según library/third-party.json
//   (scripts/library-import.mjs: tramo, recorte de silencios, fundidos, volumen igualado, M4A);
// - library/dist/catalog.json (copia del catálogo) y library/dist/CREDITS.md, para subirlos con los ficheros.
//
// Reproducible: cada elemento propio sale de una semilla fija y de fórmulas; no hay nada aleatorio sin semilla.
// Los efectos se dibujan en JavaScript (partículas con mezcla aditiva sobre negro, y sprites del Particle Pack
// de Kenney, CC0) y se pasan como fotogramas en bruto a ffmpeg; los que repiten son periódicos (el último
// fotograma enlaza con el primero). Los sonidos propios se sintetizan muestra a muestra. Todos los sonidos
// pasan por el mismo nivelado. Sin dependencias: Node ≥ 22 y ffmpeg en el PATH.
//
// PowerShell, desde la raíz del repo:
//   node scripts/build-library.mjs
// Solo algunos (por id): node scripts/build-library.mjs --only nieve,ding
// Solo la tanda de terceros (lo propio se queda como está): --import-only
// Con hojas de contacto y espectrogramas para revisarlos: --review (en library/dist/review/)

import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { expandSelection, importAsset, levelAndEncode, readSelection, writeWavChannels } from './library-import.mjs'
import { loadParticleSprites, PARTICLE_PACK } from './library-particles.mjs'

const { values: opts } = parseArgs({
  options: {
    only: { type: 'string', default: '' },
    review: { type: 'boolean', default: false },
    'import-only': { type: 'boolean', default: false },
  },
})
const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'library', 'dist')
const REVIEW = join(DIST, 'review')
const CATALOG = join(ROOT, 'library', 'catalog.json')
mkdirSync(DIST, { recursive: true })
if (opts.review) mkdirSync(REVIEW, { recursive: true })
const only = new Set(opts.only.split(',').map((s) => s.trim()).filter(Boolean))

const FPS = 30
const W = 1920
const H = 1080
const SR = 48_000
const AUTHOR = 'Proyecto Easy Cut'
const SOURCE = 'https://github.com/Krahegwen/easy-cut/blob/main/scripts/build-library.mjs'

// ------------------------------------------------------------------------------------------------ utilidades

/** Generador pseudoaleatorio con semilla (mulberry32): mismos números en cada ejecución. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const TAU = Math.PI * 2
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const mix = (a, b, t) => a + (b - a) * t
const smooth = (t) => t * t * (3 - 2 * t)
const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255]

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function ffmpeg(args, input) {
  return new Promise((ok, ko) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'], windowsHide: true })
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('error', ko)
    child.on('close', (code) => (code === 0 ? ok() : ko(new Error(`ffmpeg ${code}: ${err}`))))
    if (input) input(child.stdin)
  })
}

/** Escribe en el stdin de ffmpeg respetando la contrapresión. */
async function writeAll(stream, buf) {
  if (!stream.write(buf)) await new Promise((r) => stream.once('drain', r))
}

// ------------------------------------------------------------------------------------------------ lienzo

/** Lienzo en coma flotante (RGB, o RGBA premultiplicado) donde se suman partículas. */
class Canvas {
  constructor(w, h, alpha = false) {
    this.w = w
    this.h = h
    this.alpha = alpha
    this.c = alpha ? 4 : 3
    this.buf = new Float32Array(w * h * this.c)
  }
  clear() {
    this.buf.fill(0)
  }
  /** Mancha gaussiana suave (luz): suma color · intensidad · exp(−d²/2σ²). */
  glow(x, y, sigma, color, intensity = 1) {
    const r = Math.ceil(sigma * 3)
    const x0 = Math.max(0, Math.floor(x - r))
    const x1 = Math.min(this.w - 1, Math.ceil(x + r))
    const y0 = Math.max(0, Math.floor(y - r))
    const y1 = Math.min(this.h - 1, Math.ceil(y + r))
    const k = -1 / (2 * sigma * sigma)
    const { buf, w, c } = this
    for (let yy = y0; yy <= y1; yy++) {
      const dy = yy - y
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - x
        const g = Math.exp((dx * dx + dy * dy) * k) * intensity
        if (g < 0.002) continue
        const i = (yy * w + xx) * c
        buf[i] += color[0] * g
        buf[i + 1] += color[1] * g
        buf[i + 2] += color[2] * g
        if (c === 4) buf[i + 3] += g
      }
    }
  }
  /** Rectángulo girado y relleno con borde suavizado (confeti). `sx` escala el ancho (giro en 3D). */
  rect(cx, cy, w, h, angle, color, intensity = 1) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const hw = Math.max(0.3, w / 2)
    const hh = Math.max(0.3, h / 2)
    const R = Math.ceil(Math.hypot(hw, hh)) + 2
    const { buf, c } = this
    for (let yy = Math.max(0, Math.floor(cy - R)); yy <= Math.min(this.h - 1, Math.ceil(cy + R)); yy++) {
      for (let xx = Math.max(0, Math.floor(cx - R)); xx <= Math.min(this.w - 1, Math.ceil(cx + R)); xx++) {
        const dx = xx - cx
        const dy = yy - cy
        const u = Math.abs(dx * cos + dy * sin)
        const v = Math.abs(-dx * sin + dy * cos)
        const cov = clamp(hw + 0.5 - u, 0, 1) * clamp(hh + 0.5 - v, 0, 1)
        if (cov <= 0) continue
        const g = cov * intensity
        const i = (yy * this.w + xx) * c
        if (c === 4) {
          // «Encima» (premultiplicado): el confeti es opaco.
          const keep = 1 - cov
          buf[i] = buf[i] * keep + color[0] * g
          buf[i + 1] = buf[i + 1] * keep + color[1] * g
          buf[i + 2] = buf[i + 2] * keep + color[2] * g
          buf[i + 3] = buf[i + 3] * keep + cov
        } else {
          buf[i] += color[0] * g
          buf[i + 1] += color[1] * g
          buf[i + 2] += color[2] * g
        }
      }
    }
  }
  /** Trazo recto con grosor y extremos suaves (lluvia, estelas). */
  line(x0, y0, x1, y1, width, color, intensity = 1) {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1
    const ux = (x1 - x0) / len
    const uy = (y1 - y0) / len
    const pad = width + 2
    const { buf, c } = this
    for (let yy = Math.max(0, Math.floor(Math.min(y0, y1) - pad)); yy <= Math.min(this.h - 1, Math.ceil(Math.max(y0, y1) + pad)); yy++) {
      for (let xx = Math.max(0, Math.floor(Math.min(x0, x1) - pad)); xx <= Math.min(this.w - 1, Math.ceil(Math.max(x0, x1) + pad)); xx++) {
        const px = xx - x0
        const py = yy - y0
        const along = px * ux + py * uy
        if (along < -width || along > len + width) continue
        const across = Math.abs(-px * uy + py * ux)
        const a = clamp(width / 2 + 0.5 - across, 0, 1)
        if (a <= 0) continue
        // Más brillante en la cabeza (al final del trazo).
        const t = clamp(along / len, 0, 1)
        const g = a * intensity * (0.25 + 0.75 * t)
        const i = (yy * this.w + xx) * c
        buf[i] += color[0] * g
        buf[i + 1] += color[1] * g
        buf[i + 2] += color[2] * g
        if (c === 4) buf[i + 3] += g
      }
    }
  }
  /** Sprite precalculado (alfa de 0 a 1) en color, sumado o «encima». */
  sprite(spr, cx, cy, color, intensity = 1, over = false) {
    const ox = Math.round(cx - spr.w / 2)
    const oy = Math.round(cy - spr.h / 2)
    const { buf, c } = this
    for (let sy = 0; sy < spr.h; sy++) {
      const yy = oy + sy
      if (yy < 0 || yy >= this.h) continue
      for (let sx = 0; sx < spr.w; sx++) {
        const xx = ox + sx
        if (xx < 0 || xx >= this.w) continue
        const a = spr.a[sy * spr.w + sx] * intensity
        if (a <= 0.001) continue
        const i = (yy * this.w + xx) * c
        if (over) {
          const keep = 1 - a
          buf[i] = buf[i] * keep + color[0] * a
          buf[i + 1] = buf[i + 1] * keep + color[1] * a
          buf[i + 2] = buf[i + 2] * keep + color[2] * a
          if (c === 4) buf[i + 3] = buf[i + 3] * keep + a
        } else {
          buf[i] += color[0] * a
          buf[i + 1] += color[1] * a
          buf[i + 2] += color[2] * a
          if (c === 4) buf[i + 3] += a
        }
      }
    }
  }
  /** Fotograma en bytes: RGB24 (con un poco de compresión de las luces) o RGBA sin premultiplicar. */
  bytes() {
    const n = this.w * this.h
    const out = Buffer.allocUnsafe(n * this.c)
    const { buf, c } = this
    for (let p = 0; p < n; p++) {
      const i = p * c
      if (c === 4) {
        const a = Math.min(1, buf[i + 3])
        const inv = a > 0.0001 ? 1 / Math.max(a, buf[i + 3]) : 0
        out[i] = Math.round(clamp(buf[i] * inv, 0, 1) * 255)
        out[i + 1] = Math.round(clamp(buf[i + 1] * inv, 0, 1) * 255)
        out[i + 2] = Math.round(clamp(buf[i + 2] * inv, 0, 1) * 255)
        out[i + 3] = Math.round(a * 255)
      } else {
        // Curva suave para que las luces sumadas no se quemen de golpe.
        for (let k = 0; k < 3; k++) {
          const v = buf[i + k]
          out[i + k] = Math.round(clamp(v < 0.8 ? v : 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) * 5)), 0, 1) * 255)
        }
      }
    }
    return out
  }
}

/** Sprite de corazón (forma implícita, con borde suave). */
function heartSprite(size) {
  const w = Math.ceil(size)
  const h = Math.ceil(size)
  const a = new Float32Array(w * h)
  const ss = 3
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / w - 0.5) * 2.6
          const v = -((y + (sy + 0.5) / ss) / h - 0.55) * 2.6
          const f = (u * u + v * v - 1) ** 3 - u * u * v ** 3
          if (f <= 0) hit++
        }
      }
      a[y * w + x] = hit / (ss * ss)
    }
  }
  return { w, h, a }
}

/** Sprite de destello: cruz fina de cuatro puntas con el centro brillante. */
function starSprite(size) {
  const w = Math.ceil(size) | 1
  const a = new Float32Array(w * w)
  const c = (w - 1) / 2
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - c) / c
      const dy = (y - c) / c
      const r = Math.hypot(dx, dy)
      const rays = Math.exp(-Math.abs(dx) * 40) * Math.exp(-Math.abs(dy) * 2.2) + Math.exp(-Math.abs(dy) * 40) * Math.exp(-Math.abs(dx) * 2.2)
      const diag = 0.35 * (Math.exp(-Math.abs(dx - dy) * 30) + Math.exp(-Math.abs(dx + dy) * 30)) * Math.exp(-r * 4)
      const core = Math.exp(-r * r * 60)
      a[y * w + x] = clamp(rays * 0.9 + diag + core, 0, 1.5)
    }
  }
  return { w, h: w, a }
}

// ------------------------------------------------------------------------------------------------ efectos

/**
 * Renderiza `frames` fotogramas y los codifica. RGB → H.264 (con un halo suave añadido con ffmpeg); RGBA →
 * WebM VP9 con transparencia. `scale` < 1 dibuja a menos resolución (luces suaves) y ffmpeg amplía.
 */
async function renderVideo({ out, seconds, draw, alpha = false, scale = 1, bloom = 0 }) {
  const w = Math.round(W * scale)
  const h = Math.round(H * scale)
  const canvas = new Canvas(w, h, alpha)
  const frames = Math.round(seconds * FPS)
  const vf = []
  if (scale !== 1) vf.push(`scale=${W}:${H}:flags=bicubic`)
  let filter
  if (bloom > 0 && !alpha) filter = `[0:v]${vf.length ? `${vf.join(',')},` : ''}format=gbrp,split[a][b];[b]scale=480:270:flags=area,gblur=sigma=${bloom},scale=${W}:${H}:flags=bicubic[g];[a][g]blend=all_mode=screen,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[o]`
  const common = ['-f', 'rawvideo', '-pix_fmt', alpha ? 'rgba' : 'rgb24', '-s', `${w}x${h}`, '-r', String(FPS), '-i', '-']
  const encode = alpha
    ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-auto-alt-ref', '0', '-deadline', 'good', '-cpu-used', '2']
    : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart']
  const graph = filter ? ['-filter_complex', filter, '-map', '[o]'] : ['-vf', [...vf, alpha ? 'format=yuva420p' : 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p'].join(',')]
  await ffmpeg([...common, ...graph, ...encode, '-an', out], async (stdin) => {
    for (let f = 0; f < frames; f++) {
      canvas.clear()
      draw(canvas, f / FPS, f, scale)
      await writeAll(stdin, canvas.bytes())
    }
    stdin.end()
  })
}

/** Vista previa pequeña y ligera (480×270) para la tarjeta de la biblioteca. */
async function makePreview(src, out, alpha) {
  if (alpha) await ffmpeg(['-c:v', 'libvpx-vp9', '-i', src, '-vf', 'scale=480:270:flags=area', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '38', '-auto-alt-ref', '0', '-an', out])
  else if (out.endsWith('.png')) await ffmpeg(['-i', src, '-vf', 'scale=480:270:flags=area', out])
  else await ffmpeg(['-i', src, '-vf', 'scale=480:270:flags=area', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out])
}

const PALETTE_PARTY = ['#ff4d6d', '#ffd23f', '#3bceac', '#4ea8de', '#b388eb', '#ff8c42', '#ffffff'].map(hex)

const EFFECTS = [
  {
    id: 'confeti',
    name: 'Confeti',
    category: 'fiesta',
    tags: ['fiesta', 'cumpleaños', 'celebración', 'colores'],
    seconds: 6,
    defaults: { repeat: true, durationMs: 6000, look: { mix: 'light' } },
    draw(cv, t, _f, s) {
      const r = rng(11)
      const T = 6
      for (let i = 0; i < 230; i++) {
        const x0 = r()
        const y0 = r()
        const k = 1 + Math.floor(r() * 2)
        const spin = (1 + Math.floor(r() * 3)) * (r() < 0.5 ? -1 : 1)
        const flip = 1 + Math.floor(r() * 4)
        const sway = 0.012 + r() * 0.03
        const swayK = 1 + Math.floor(r() * 3)
        const ph = r()
        const color = PALETTE_PARTY[Math.floor(r() * PALETTE_PARTY.length)]
        const size = (18 + r() * 22) * s
        const depth = 0.55 + r() * 0.45
        const u = (y0 + (k * t) / T) % 1
        const y = (u * 1.2 - 0.1) * cv.h
        const x = (x0 + sway * Math.sin(TAU * (swayK * t / T + ph))) * cv.w
        const angle = ph * TAU + (TAU * spin * t) / T
        const fl = Math.cos(TAU * (flip * t / T + ph))
        cv.rect(x, y, size * Math.max(0.15, Math.abs(fl)), size * 0.55, angle, color, depth * (0.75 + 0.25 * Math.abs(fl)))
      }
    },
    bloom: 3,
  },
  {
    id: 'chispas',
    name: 'Chispas que brillan',
    category: 'fuego-y-chispas',
    tags: ['destellos', 'brillo', 'magia', 'estrellas'],
    seconds: 6,
    defaults: { repeat: true, durationMs: 6000, look: { mix: 'light' } },
    draw(cv, t, _f, s) {
      const r = rng(23)
      const T = 6
      const sprites = [starSprite(60 * s), starSprite(90 * s), starSprite(130 * s)]
      const warm = [hex('#fff4d6'), hex('#ffe08a'), hex('#ffd1f0'), hex('#d9f2ff')]
      for (let i = 0; i < 70; i++) {
        const x = r() * cv.w
        const y = r() * cv.h
        const m = 1 + Math.floor(r() * 3)
        const ph = r()
        const spr = sprites[Math.floor(r() * sprites.length)]
        const color = warm[Math.floor(r() * warm.length)]
        const drift = 6 * s * Math.sin(TAU * (t / T + ph))
        const env = Math.max(0, Math.sin(TAU * (m * t / T + ph))) ** 3
        if (env < 0.01) continue
        cv.sprite(spr, x + drift, y - drift * 0.5, color, env * 1.1)
        cv.glow(x + drift, y - drift * 0.5, spr.w * 0.18, color, env * 0.35)
      }
    },
    bloom: 4,
  },
  {
    id: 'llamas',
    name: 'Llamas en la parte de abajo',
    category: 'fuego-y-chispas',
    description: 'Una franja de llamas estilizadas con chispas que suben desde el borde inferior.',
    tags: ['fuego', 'llamas', 'hoguera', 'calor', 'brasas', 'chispas', 'peligro'],
    seconds: 4,
    scale: 0.5,
    bloom: 3,
    needsParticles: true,
    thanks: PARTICLE_PACK.thanks,
    defaults: { repeat: true, durationMs: 8000, look: { mix: 'light' } },
    // Lenguas de fuego (sprites del Particle Pack) que nacen abajo, suben, cambian de amarillo a rojo y se
    // apagan; brasas pequeñas que suben más alto; un resplandor naranja en el borde. Todo con ciclos enteros
    // en los 4 s, así enlaza sin salto.
    draw: (P) => (cv, t, _f, s) => {
      const T = 4
      const r = rng(83)
      const hot = hex('#fff2c4')
      const orange = hex('#ff8a1e')
      const red = hex('#c8240a')
      const tint = (u) => (u < 0.45 ? hot.map((c, i) => mix(c, orange[i], u / 0.45)) : orange.map((c, i) => mix(c, red[i], (u - 0.45) / 0.55)))
      // Resplandor del borde, que respira un poco.
      for (let x = -40; x <= cv.w + 40; x += 36 * s) {
        const fl = 0.85 + 0.15 * Math.sin(TAU * (3 * t / T + x / cv.w * 2.7))
        cv.glow(x, cv.h + 30 * s, 110 * s, orange, 0.1 * fl)
      }
      const tongues = ['flame_05', 'flame_06']
      const bodies = ['flame_01', 'flame_02', 'flame_03', 'flame_04']
      // Cuerpo: manchas anchas y tenues, bajas.
      for (let i = 0; i < 46; i++) {
        const x0 = (r() * 1.1 - 0.05) * cv.w
        const k = 2 + Math.floor(r() * 2)
        const ph = r()
        const name = bodies[Math.floor(r() * bodies.length)]
        const big = (150 + r() * 120) * s
        const rise = (0.1 + r() * 0.08) * cv.h
        const u = (k * t / T + ph) % 1
        const size = big * (0.55 + 0.6 * Math.sin(Math.PI * u))
        const y = cv.h + size * 0.25 - u * rise
        const env = Math.sin(Math.PI * u) ** 0.9
        cv.sprite(P.get(name, size), x0 + 12 * s * Math.sin(TAU * (u + ph)), y, tint(Math.min(1, u * 0.8 + 0.25)), env * 0.33)
      }
      // Lenguas: más finas, más altas, más brillantes.
      for (let i = 0; i < 64; i++) {
        const x0 = (r() * 1.08 - 0.04) * cv.w
        const k = 2 + Math.floor(r() * 3)
        const ph = r()
        const name = tongues[Math.floor(r() * tongues.length)]
        const big = (170 + r() * 150) * s
        const rise = (0.16 + r() * 0.16) * cv.h
        const m = 3 + Math.floor(r() * 4)
        const u = (k * t / T + ph) % 1
        const size = big * (0.5 + 0.7 * Math.sin(Math.PI * Math.min(1, u * 1.3)))
        const y = cv.h + size * 0.2 - u * rise
        const sway = 16 * s * Math.sin(TAU * (2 * u + ph))
        const env = Math.sin(Math.PI * u) ** 0.8 * (0.85 + 0.15 * Math.sin(TAU * (m * t / T + ph)))
        cv.sprite(P.get(name, size), x0 + sway, y, tint(u), env * 0.62)
      }
      // Brasas: puntos pequeños que suben bastante y titilan.
      for (let i = 0; i < 70; i++) {
        const x0 = r() * cv.w
        const k = 1 + Math.floor(r() * 2)
        const ph = r()
        const u = (k * t / T + ph) % 1
        const y = cv.h * (1 - u * (0.35 + r() * 0.3))
        const x = x0 + 40 * s * Math.sin(TAU * (u * 1.5 + ph))
        const tw = 0.6 + 0.4 * Math.sin(TAU * ((4 + Math.floor(r() * 5)) * t / T + ph))
        const fade = Math.sin(Math.PI * u) ** 1.5
        cv.glow(x, y, (1.6 + r() * 1.6) * s * 2, tint(0.2 + u * 0.6), fade * tw * 0.9)
      }
    },
  },
  {
    id: 'fuegos-artificiales',
    name: 'Fuegos artificiales',
    category: 'fiesta',
    tags: ['fiesta', 'noche', 'celebración', 'año nuevo'],
    seconds: 8,
    defaults: { repeat: true, durationMs: 8000, look: { mix: 'light' } },
    draw(cv, t, _f, s) {
      const T = 8
      const bursts = [
        { at: 0.2, x: 0.3, y: 0.34, color: '#ffcf4d', n: 220, speed: 560 },
        { at: 1.6, x: 0.72, y: 0.3, color: '#ff5d8f', n: 200, speed: 520 },
        { at: 3.1, x: 0.5, y: 0.26, color: '#6fd3ff', n: 240, speed: 600 },
        { at: 4.6, x: 0.22, y: 0.4, color: '#b98cff', n: 190, speed: 500 },
        { at: 5.9, x: 0.8, y: 0.38, color: '#8dff9f', n: 210, speed: 540 },
        { at: 6.9, x: 0.45, y: 0.36, color: '#fff3c4', n: 180, speed: 520 },
      ]
      const life = 2.6
      const g = 180
      bursts.forEach((b, bi) => {
        const tau = (((t - b.at) % T) + T) % T
        if (tau > life) return
        const r = rng(100 + bi)
        const col = hex(b.color)
        const cx = b.x * cv.w
        const cy = b.y * cv.h
        // Destello inicial.
        if (tau < 0.25) cv.glow(cx, cy, 70 * s, col, (1 - tau / 0.25) * 0.9)
        for (let i = 0; i < b.n; i++) {
          const a = r() * TAU
          const sp = b.speed * (0.35 + 0.65 * Math.pow(r(), 0.45)) * s
          const vx = Math.cos(a) * sp
          const vy = Math.sin(a) * sp
          const twinkle = 0.7 + 0.3 * Math.sin(40 * tau + i)
          const fade = (1 - tau / life) ** 1.6
          // Frenado por el aire y gravedad.
          const drag = (1 - Math.exp(-1.6 * tau)) / 1.6
          const px = cx + vx * drag
          const py = cy + vy * drag + 0.5 * g * s * tau * tau
          const tail = Math.max(0, tau - 0.12)
          const drag2 = (1 - Math.exp(-1.6 * tail)) / 1.6
          const qx = cx + vx * drag2
          const qy = cy + vy * drag2 + 0.5 * g * s * tail * tail
          cv.line(qx, qy, px, py, 2.6 * s, col, fade * twinkle * 1.1)
          cv.glow(px, py, 4 * s, col, fade * twinkle * 1.1)
        }
      })
    },
    bloom: 5,
  },
  {
    id: 'nieve',
    name: 'Nieve',
    category: 'tiempo',
    tags: ['invierno', 'navidad', 'frío', 'copos'],
    seconds: 8,
    defaults: { repeat: true, durationMs: 8000, look: { mix: 'light' } },
    draw(cv, t, _f, s) {
      const r = rng(37)
      const T = 8
      for (let i = 0; i < 420; i++) {
        const depth = r()
        const x0 = r()
        const y0 = r()
        const k = depth < 0.5 ? 1 : 2
        const ph = r()
        const swayK = 1 + Math.floor(r() * 2)
        const size = (2 + depth * 7) * s
        const y = (((y0 + (k * t) / T) % 1) * 1.1 - 0.05) * cv.h
        const x = (x0 + (0.01 + depth * 0.02) * Math.sin(TAU * (swayK * t / T + ph))) * cv.w
        cv.glow(x, y, size * 0.6, [1, 1, 1], 0.35 + depth * 0.6)
      }
    },
    bloom: 2,
  },
  {
    id: 'lluvia',
    name: 'Lluvia',
    category: 'tiempo',
    tags: ['agua', 'tormenta', 'otoño', 'gris'],
    seconds: 4,
    defaults: { repeat: true, durationMs: 8000, look: { mix: 'light', opacity: 0.85 } },
    draw(cv, t, _f, s) {
      const r = rng(41)
      const T = 4
      const color = hex('#cfe3ff')
      for (let i = 0; i < 380; i++) {
        const depth = r()
        const x0 = r()
        const y0 = r()
        const k = 3 + Math.floor(depth * 4)
        const len = (40 + depth * 90) * s
        const u = (y0 + (k * t) / T) % 1
        const y = (u * 1.3 - 0.15) * cv.h
        const x = x0 * cv.w * 1.1 - 0.05 * cv.w + (y - cv.h / 2) * 0.12
        cv.line(x - len * 0.12, y - len, x, y, (1.6 + depth * 2.2) * s, color, 0.4 + depth * 0.6)
      }
    },
  },
  {
    id: 'luz-calida',
    name: 'Luz cálida',
    category: 'luz',
    tags: ['fuga de luz', 'atardecer', 'naranja', 'película'],
    seconds: 8,
    scale: 0.25,
    defaults: { repeat: true, durationMs: 8000, look: { mix: 'light', opacity: 0.9 } },
    draw: leak(['#ff7a1a', '#ffb347', '#ff3d2e', '#ffd27a'], 51),
  },
  {
    id: 'luz-rosa',
    name: 'Luz rosa',
    category: 'luz',
    tags: ['fuga de luz', 'romántico', 'rosa', 'morado'],
    seconds: 8,
    scale: 0.25,
    defaults: { repeat: true, durationMs: 8000, look: { mix: 'light', opacity: 0.9 } },
    draw: leak(['#ff4fa3', '#c86bff', '#ff8fb8', '#ffb0e0'], 52),
  },
  {
    id: 'luz-azul',
    name: 'Luz azul',
    category: 'luz',
    tags: ['fuga de luz', 'frío', 'azul', 'turquesa'],
    seconds: 8,
    scale: 0.25,
    defaults: { repeat: true, durationMs: 8000, look: { mix: 'light', opacity: 0.9 } },
    draw: leak(['#2f8cff', '#36e2d0', '#6a5cff', '#9fe7ff'], 53),
  },
  {
    id: 'brillo-que-cruza',
    name: 'Brillo que cruza',
    category: 'luz',
    tags: ['destello', 'barrido', 'transición', 'brillo'],
    seconds: 2.5,
    scale: 0.25,
    defaults: { repeat: false, look: { mix: 'light' } },
    draw(cv, t) {
      const T = 2.5
      const p = smooth(clamp(t / T, 0, 1))
      const center = mix(-0.4, 1.4, p)
      const width = 0.11
      const env = Math.sin(Math.PI * clamp(t / T, 0, 1)) ** 0.6
      const warm = hex('#fff1d0')
      const { buf, w, h } = cv
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // Banda diagonal: u es la posición a lo largo del barrido.
          const u = x / w + (y / h - 0.5) * 0.35
          const d = (u - center) / width
          const v = Math.exp(-d * d) * env + 0.25 * Math.exp(-(d * d) / 16) * env
          const i = (y * w + x) * 3
          buf[i] = warm[0] * v
          buf[i + 1] = warm[1] * v
          buf[i + 2] = warm[2] * v
        }
      }
    },
  },
  {
    id: 'flash',
    name: 'Flash',
    category: 'luz',
    tags: ['foto', 'destello', 'blanco', 'cambio'],
    seconds: 1,
    scale: 0.125,
    defaults: { repeat: false, look: { mix: 'light' } },
    draw(cv, t) {
      const v = t < 0.06 ? t / 0.06 : Math.exp(-(t - 0.06) * 5.5)
      cv.buf.fill(v)
    },
  },
  {
    id: 'corazones',
    name: 'Corazones flotando',
    category: 'amor',
    tags: ['amor', 'san valentín', 'boda', 'rojo'],
    seconds: 6,
    alpha: true,
    defaults: { repeat: true, durationMs: 6000, look: { mix: 'normal' } },
    draw(cv, t, _f, s) {
      const r = rng(61)
      const T = 6
      const colors = ['#ff2d55', '#ff5f7e', '#ff8fa3', '#e0115f', '#ffffff'].map(hex)
      const sizes = [36, 52, 72, 96].map((z) => heartSprite(z * s))
      const hearts = []
      for (let i = 0; i < 46; i++) {
        const depth = r()
        hearts.push({ depth, x0: r(), y0: r(), k: 1, ph: r(), swayK: 1 + Math.floor(r() * 2), spr: sizes[Math.min(3, Math.floor(depth * 4))], color: colors[Math.floor(r() * colors.length)] })
      }
      hearts.sort((a, b) => a.depth - b.depth)
      for (const hh of hearts) {
        const u = (hh.y0 + (hh.k * t) / T) % 1
        const y = (1.1 - u * 1.25) * cv.h
        const x = (hh.x0 + 0.03 * Math.sin(TAU * (hh.swayK * t / T + hh.ph))) * cv.w
        // Aparecen y desaparecen suaves arriba y abajo.
        const edge = clamp(Math.min(u / 0.12, (1 - u) / 0.18), 0, 1)
        const beat = 1 + 0.06 * Math.sin(TAU * (3 * t / T + hh.ph))
        cv.sprite(hh.spr, x, y, hh.color.map((c) => c * beat > 1 ? 1 : c), (0.55 + 0.45 * hh.depth) * edge, true)
      }
    },
  },
]

/** Fuga de luz: manchas grandes de color que se mueven en lazos cerrados (repite sin salto). */
function leak(colors, seed) {
  return (cv, t) => {
    const T = 8
    const r = rng(seed)
    const blobs = colors.map((c, i) => ({
      color: hex(c),
      ax: 0.06 + r() * 0.1,
      ay: 0.15 + r() * 0.25,
      // Pegadas a los bordes: la luz «entra» por un lado y el centro queda casi limpio.
      cx: i % 2 === 0 ? -0.05 + r() * 0.2 : 0.85 + r() * 0.2,
      cy: r(),
      kx: 1 + (i % 2),
      ky: 1 + ((i + 1) % 2),
      ph: r(),
      sigma: 0.11 + r() * 0.08,
      gain: 0.35 + r() * 0.3,
    }))
    const { buf, w, h } = cv
    const breathe = 0.82 + 0.18 * Math.sin(TAU * t / T)
    for (const b of blobs) {
      const x = (b.cx + b.ax * Math.sin(TAU * (b.kx * t / T + b.ph))) * w
      const y = (b.cy + b.ay * Math.cos(TAU * (b.ky * t / T + b.ph))) * h
      cv.glow(x, y, b.sigma * w, b.color, b.gain * breathe)
    }
    // Un velo de color en el borde de donde «entra» la luz.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const e = Math.exp(-((x / w) ** 2) * 14) * 0.18 * breathe
        const i = (y * w + x) * 3
        buf[i] += blobs[0].color[0] * e
        buf[i + 1] += blobs[0].color[1] * e
        buf[i + 2] += blobs[0].color[2] * e
      }
    }
  }
}

/** Imágenes fijas (PNG con transparencia), dibujadas en RGBA. */
const STILLS = [
  {
    id: 'vineta',
    name: 'Viñeta (bordes oscuros)',
    category: 'marcos',
    tags: ['bordes', 'oscuro', 'cine', 'antiguo'],
    defaults: { durationMs: null, look: { mix: 'normal', fit: 'cover', opacity: 0.85 } },
    draw(buf, w, h) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = (x / w - 0.5) * 2
          const dy = (y / h - 0.5) * 2
          const d = Math.sqrt(dx * dx * 0.85 + dy * dy)
          const a = smooth(clamp((d - 0.55) / 0.85, 0, 1)) * 0.92
          const i = (y * w + x) * 4
          buf[i] = 0
          buf[i + 1] = 0
          buf[i + 2] = 0
          buf[i + 3] = Math.round(a * 255)
        }
      }
    },
  },
  {
    id: 'marco-dorado',
    name: 'Marco dorado',
    category: 'marcos',
    tags: ['borde', 'oro', 'elegante', 'foto'],
    defaults: { durationMs: null, look: { mix: 'normal', fit: 'cover' } },
    draw(buf, w, h) {
      const m = Math.round(h * 0.035)
      const inner = Math.round(h * 0.012)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = Math.min(x, y, w - 1 - x, h - 1 - y)
          const i = (y * w + x) * 4
          if (d > m + inner + 2) {
            buf[i + 3] = 0
            continue
          }
          // Banda dorada con brillo que cambia a lo largo del borde, y un filete fino por dentro.
          const along = (x + y) / (w + h)
          const shine = 0.75 + 0.25 * Math.sin(along * TAU * 3)
          const bevel = d < m ? 0.8 + 0.2 * Math.cos((d / m) * Math.PI) : 1
          const line = d > m + 2 && d <= m + inner ? 1 : 0
          const a = d < m ? 1 : line ? 0.95 : clamp(1 - (d - m - inner), 0, 1) * 0.6
          const k = d < m ? shine * bevel : 1
          buf[i] = Math.round(clamp(232 * k, 0, 255))
          buf[i + 1] = Math.round(clamp(186 * k, 0, 255))
          buf[i + 2] = Math.round(clamp(92 * k, 0, 255))
          buf[i + 3] = Math.round(a * 255)
        }
      }
    },
  },
]

// ------------------------------------------------------------------------------------------------ sonidos

// Los WAV intermedios los escribe writeWavChannels (scripts/library-import.mjs), en mono o estéreo.

const buffer = (seconds) => new Float32Array(Math.round(seconds * SR))
const note = (n) => 440 * 2 ** ((n - 69) / 12)

/** Suma una nota de campana / marimba: parciales con su propio decaimiento. */
function addTone(buf, start, freq, { partials, attack = 0.002, gain = 0.5, length }) {
  const s0 = Math.round(start * SR)
  const len = Math.min(buf.length - s0, Math.round(length * SR))
  for (const [ratio, amp, decay] of partials) {
    const w = (TAU * freq * ratio) / SR
    for (let i = 0; i < len; i++) {
      const t = i / SR
      const env = Math.min(1, t / attack) * Math.exp(-t * decay)
      buf[s0 + i] += Math.sin(w * i) * amp * env * gain
    }
  }
}

/** Ruido blanco filtrado con un paso banda de segundo orden (frecuencia y Q pueden cambiar con el tiempo). */
function bandNoise(n, r, freqAt, q = 2) {
  const out = new Float32Array(n)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < n; i++) {
    const f = freqAt(i / SR)
    const w0 = (TAU * f) / SR
    const alpha = Math.sin(w0) / (2 * q)
    const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha
    const x = r() * 2 - 1
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

/** Pico de varias señales (sin «...», que con cientos de miles de muestras desborda la pila). */
function peakOf(...signals) {
  let m = 0
  for (const s of signals) for (let i = 0; i < s.length; i++) m = Math.max(m, Math.abs(s[i]))
  return m
}

function normalize(buf, peak = 0.89) {
  let m = 0
  for (const v of buf) m = Math.max(m, Math.abs(v))
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m
  return buf
}

/** Fundido muy corto al final para que no haga clic. */
function tailFade(buf, ms = 15) {
  const n = Math.round((ms / 1000) * SR)
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n
  return buf
}

const SOUNDS = [
  {
    id: 'ding',
    name: 'Ding claro de campanita',
    category: 'campanas',
    description: 'Una campanita aguda y limpia que se apaga despacio.',
    tags: ['campana', 'aviso', 'notificación', 'ding', 'campanita', 'claro'],
    synth() {
      const b = buffer(1.8)
      addTone(b, 0.005, note(88), { length: 1.79, gain: 0.5, partials: [[1, 1, 2.6], [2.76, 0.42, 4.5], [5.4, 0.2, 7], [8.93, 0.1, 11]] })
      addTone(b, 0.005, note(76), { length: 1.79, gain: 0.25, partials: [[1, 1, 2.2], [3.01, 0.2, 5]] })
      return normalize(tailFade(b))
    },
  },
  {
    id: 'acierto',
    name: 'Acierto de marimba (dos notas)',
    category: 'aciertos',
    description: 'Dos notas de marimba que suben, cortas y alegres.',
    tags: ['correcto', 'bien', 'premio', 'positivo', 'marimba', 'acierto'],
    synth() {
      const b = buffer(0.9)
      const mar = [[1, 1, 7], [4, 0.25, 18], [10, 0.08, 30]]
      addTone(b, 0.0, note(79), { length: 0.9, gain: 0.5, partials: mar })
      addTone(b, 0.11, note(84), { length: 0.78, gain: 0.55, partials: mar })
      addTone(b, 0.11, note(91), { length: 0.78, gain: 0.18, partials: [[1, 1, 6]] })
      return normalize(tailFade(b))
    },
  },
  {
    id: 'error',
    name: 'Error de dos pitidos graves',
    category: 'fallos',
    description: 'Dos pitidos electrónicos graves, el segundo más bajo.',
    tags: ['fallo', 'mal', 'incorrecto', 'negativo', 'pitido', 'error'],
    synth() {
      const b = buffer(0.62)
      const tone = (start, freq, len) => {
        const s0 = Math.round(start * SR)
        for (let i = 0; i < Math.round(len * SR); i++) {
          const t = i / SR
          const env = Math.min(1, t / 0.01) * Math.min(1, (len - t) / 0.04)
          let v = 0
          for (let h = 1; h <= 15; h += 2) v += Math.sin(TAU * freq * h * t) / (h * h * 0.6 + 0.4)
          b[s0 + i] += v * env * 0.4
        }
      }
      tone(0, note(55), 0.22)
      tone(0.25, note(50), 0.36)
      // Onda casi cuadrada: suena mucho más fuerte que un seno con el mismo pico.
      return normalize(tailFade(b), 0.42)
    },
  },
  {
    id: 'pop',
    name: 'Pop de burbuja',
    category: 'transiciones',
    description: 'Un «pop» redondo y blando, como una burbuja que revienta.',
    tags: ['burbuja', 'aparecer', 'corto', 'globo', 'pop'],
    synth() {
      const b = buffer(0.22)
      const r = rng(7)
      let phase = 0
      for (let i = 0; i < b.length; i++) {
        const t = i / SR
        const f = 220 + 900 * Math.exp(-t * 45)
        phase += (TAU * f) / SR
        const env = Math.min(1, t / 0.0015) * Math.exp(-t * 28)
        b[i] = Math.sin(phase) * env + (r() * 2 - 1) * Math.exp(-t * 400) * 0.35
      }
      return normalize(tailFade(b, 8))
    },
  },
  {
    id: 'whoosh',
    name: 'Zas que cruza de lado a lado',
    category: 'transiciones',
    description: 'Un soplo de aire de casi un segundo que pasa de izquierda a derecha.',
    tags: ['transición', 'aire', 'rápido', 'swoosh', 'zas', 'whoosh', 'cruzar'],
    stereo: true,
    synth() {
      const len = 0.9
      const n = Math.round(len * SR)
      const noise = bandNoise(n, rng(17), (t) => 300 * Math.pow(2600 / 300, Math.sin((Math.PI * t) / len) ** 1.5), 1.6)
      const L = new Float32Array(n)
      const R = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        const t = i / SR
        const env = Math.sin((Math.PI * t) / len) ** 2.2
        const pan = t / len
        L[i] = noise[i] * env * Math.cos((pan * Math.PI) / 2)
        R[i] = noise[i] * env * Math.sin((pan * Math.PI) / 2)
      }
      const m = peakOf(L, R)
      for (let i = 0; i < n; i++) {
        L[i] *= 0.85 / m
        R[i] *= 0.85 / m
      }
      return [L, R]
    },
  },
  {
    id: 'redoble',
    name: 'Redoble largo con platillo final',
    category: 'redobles',
    description: 'Un redoble de caja que va creciendo y acaba en golpe de platillo.',
    tags: ['tambor', 'suspense', 'anuncio', 'tachán', 'platillo', 'redoble', 'largo'],
    synth() {
      const b = buffer(3.6)
      const r = rng(29)
      // Golpes de caja cada vez más seguidos y más fuertes, y al final golpe con platillo.
      let t = 0
      while (t < 2.2) {
        const gap = mix(0.075, 0.045, t / 2.2)
        const amp = 0.35 + 0.5 * (t / 2.2) + (r() - 0.5) * 0.1
        const s0 = Math.round(t * SR)
        const hit = bandNoise(Math.round(0.09 * SR), r, () => 1900, 0.9)
        for (let i = 0; i < hit.length && s0 + i < b.length; i++) {
          const tt = i / SR
          b[s0 + i] += (hit[i] * 0.8 + Math.sin(TAU * 190 * tt) * 0.5) * Math.exp(-tt * 38) * amp
        }
        t += gap
      }
      const s1 = Math.round(2.3 * SR)
      const crash = bandNoise(b.length - s1, r, (tt) => 6000 - 2500 * Math.min(1, tt), 0.7)
      const boom = bandNoise(Math.round(0.25 * SR), r, () => 1500, 0.8)
      for (let i = 0; i < b.length - s1; i++) {
        const tt = i / SR
        b[s1 + i] += crash[i] * Math.exp(-tt * 2.2) * 1.4 + Math.sin(TAU * 95 * tt) * Math.exp(-tt * 9) * 0.9
        if (i < boom.length) b[s1 + i] += boom[i] * Math.exp(-tt * 20) * 1.2
      }
      return normalize(tailFade(b, 60))
    },
  },
  {
    id: 'tic-tac',
    name: 'Tic tac de reloj',
    category: 'redobles',
    description: 'Un reloj que hace tic tac; se repite sin salto todo lo que haga falta.',
    tags: ['reloj', 'tiempo', 'espera', 'cuenta atrás', 'tic tac', 'nervios'],
    repeat: true,
    synth() {
      // Dos segundos que repiten sin salto: tic (agudo) y tac (más grave) cada medio segundo.
      const b = buffer(2)
      const r = rng(5)
      for (let k = 0; k < 4; k++) {
        const s0 = Math.round(k * 0.5 * SR)
        const f = k % 2 === 0 ? 3100 : 2300
        const click = bandNoise(Math.round(0.035 * SR), r, () => f, 6)
        for (let i = 0; i < click.length; i++) {
          const t = i / SR
          b[s0 + i] += click[i] * Math.exp(-t * 220) * 1.6 + Math.sin(TAU * f * 0.5 * t) * Math.exp(-t * 160) * 0.25
        }
      }
      return normalize(b, 0.7)
    },
  },
]

// ------------------------------------------------------------------------------------------------ catálogo

// Categorías en el orden en que se enseñan. Las de sonidos, de lo más usado a lo menos.
const CATEGORIES = [
  { id: 'aplausos-y-vitores', kind: 'sound', name: 'Aplausos y vítores', icon: 'clap' },
  { id: 'risas', kind: 'sound', name: 'Risas', icon: 'laugh' },
  { id: 'felicitaciones', kind: 'sound', name: 'Felicitaciones y fanfarrias', icon: 'star' },
  { id: 'aciertos', kind: 'sound', name: 'Aciertos', icon: 'check' },
  { id: 'fallos', kind: 'sound', name: 'Fallos y errores', icon: 'cross' },
  { id: 'campanas', kind: 'sound', name: 'Campanas y avisos', icon: 'bell' },
  { id: 'redobles', kind: 'sound', name: 'Redobles y suspense', icon: 'drum' },
  { id: 'transiciones', kind: 'sound', name: 'Transiciones (zas, pop)', icon: 'whoosh' },
  { id: 'fuegos-y-fiesta', kind: 'sound', name: 'Fuegos artificiales y fiesta', icon: 'party' },
  { id: 'voces', kind: 'sound', name: 'Voces en inglés', icon: 'voice' },
  { id: 'cuenta-atras', kind: 'sound', name: 'Cuenta atrás', icon: 'countdown' },
  { id: 'objetos', kind: 'sound', name: 'Clics y objetos', icon: 'objects' },
  { id: 'musica', kind: 'sound', name: 'Música', icon: 'music' },
  { id: 'fiesta', kind: 'effect', name: 'Fiesta', icon: 'party' },
  { id: 'fuego-y-chispas', kind: 'effect', name: 'Fuego y chispas', icon: 'fire' },
  { id: 'luz', kind: 'effect', name: 'Luz', icon: 'light' },
  { id: 'tiempo', kind: 'effect', name: 'Tiempo', icon: 'snow' },
  { id: 'amor', kind: 'effect', name: 'Amor', icon: 'heart' },
  { id: 'marcos', kind: 'effect', name: 'Marcos', icon: 'frame' },
]

function fileEntry(path) {
  return { file: path.split(/[\\/]/).pop(), sha256: sha256(path), bytes: statSync(path).size }
}

function probeDurationMs(path) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' })
  return Math.round(Number(out.trim()) * 1000)
}

const old = existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, 'utf8')) : null
const keep = new Map((old?.assets ?? []).map((a) => [a.id, a]))
const assets = []
const selection = readSelection(ROOT)
const report = []

function baseEntry(def, kind) {
  return {
    id: def.id,
    kind,
    name: def.name,
    category: def.category,
    ...(def.description ? { description: def.description } : {}),
    tags: def.tags,
    license: 'own',
    author: AUTHOR,
    sourceUrl: SOURCE,
    attribution: null,
  }
}

/** Lo propio que no se rehace se queda con su fichero, pero con el nombre, la categoría y las etiquetas de ahora. */
function kept(def, kind) {
  const k = keep.get(def.id)
  return k ? { ...k, ...baseEntry(def, kind) } : null
}

const skipOwn = (id) => opts['import-only'] || (only.size > 0 && !only.has(id))

async function review(path, id, alpha) {
  if (!opts.review) return
  const tile = join(REVIEW, `${id}.png`)
  const dec = alpha ? ['-c:v', 'libvpx-vp9'] : []
  // Hoja de contacto: 8 fotogramas repartidos, sobre gris medio para ver cómo queda encima de algo.
  await ffmpeg([...dec, '-i', path, '-vf', `fps=8/${Math.max(0.5, probeDurationMs(path) / 1000)},scale=480:-2,tile=4x2:padding=4:color=gray`, '-frames:v', '1', tile])
}

async function reviewSound(out, id) {
  if (!opts.review) return
  await ffmpeg(['-i', out, '-lavfi', 'showspectrumpic=s=800x300:legend=1:scale=log', join(REVIEW, `${id}-espectro.png`)])
  await ffmpeg(['-i', out, '-lavfi', 'showwavespic=s=800x200:split_channels=1', '-frames:v', '1', join(REVIEW, `${id}-onda.png`)])
}

const particles = loadParticleSprites(ROOT)

for (const def of EFFECTS) {
  if (def.needsParticles && !particles) {
    // Sin los sprites del Particle Pack (library/sources/kenney/particle-pack) no se puede rehacer.
    const k = kept(def, 'effect')
    if (k) assets.push(k)
    else console.warn(`efecto ${def.id}: faltan los sprites del Particle Pack; no se genera`)
    continue
  }
  if (skipOwn(def.id)) {
    const k = kept(def, 'effect')
    if (k) assets.push(k)
    continue
  }
  const t0 = Date.now()
  const ext = def.alpha ? 'webm' : 'mp4'
  const out = join(DIST, `${def.id}.${ext}`)
  await renderVideo({ out, seconds: def.seconds, draw: def.needsParticles ? def.draw(particles) : def.draw, alpha: def.alpha, scale: def.scale ?? 1, bloom: def.bloom ?? 0 })
  const preview = join(DIST, `${def.id}.preview.${ext}`)
  await makePreview(out, preview, def.alpha)
  await review(out, def.id, def.alpha)
  assets.push({
    ...baseEntry(def, 'effect'),
    durationMs: Math.round(def.seconds * 1000),
    format: ext,
    width: W,
    height: H,
    hasAudio: false,
    ...(def.alpha ? { hasAlpha: true } : {}),
    ...fileEntry(out),
    preview: fileEntry(preview),
    defaults: def.defaults,
    ...(def.thanks ? { thanks: def.thanks } : {}),
  })
  console.log(`efecto ${def.id}: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(statSync(out).size / 1e6).toFixed(2)} MB`)
}

for (const def of STILLS) {
  if (skipOwn(def.id)) {
    const k = kept(def, 'effect')
    if (k) assets.push(k)
    continue
  }
  const buf = Buffer.alloc(W * H * 4)
  def.draw(buf, W, H)
  const out = join(DIST, `${def.id}.png`)
  await ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', '-frames:v', '1', '-compression_level', '9', out], async (stdin) => {
    await writeAll(stdin, buf)
    stdin.end()
  })
  const preview = join(DIST, `${def.id}.preview.png`)
  await makePreview(out, preview, false)
  assets.push({
    ...baseEntry(def, 'effect'),
    durationMs: 0,
    format: 'png',
    width: W,
    height: H,
    hasAudio: false,
    hasAlpha: true,
    still: true,
    ...fileEntry(out),
    preview: fileEntry(preview),
    defaults: def.defaults,
  })
  console.log(`imagen ${def.id}: ${(statSync(out).size / 1e6).toFixed(2)} MB`)
}

for (const def of SOUNDS) {
  if (skipOwn(def.id)) {
    const k = kept(def, 'sound')
    if (k) assets.push(k)
    continue
  }
  const made = def.synth()
  const stereo = Array.isArray(made)
  const wav = join(DIST, `${def.id}.wav`)
  writeWavChannels(wav, stereo ? made : [made])
  let src = wav
  if (def.reverb) {
    // Un poco de sala a los que lo piden (eco corto y suave).
    src = join(DIST, `${def.id}.reverb.wav`)
    await ffmpeg(['-i', wav, '-af', 'aecho=0.8:0.6:37|61|89:0.22|0.16|0.1', '-c:a', 'pcm_f32le', src])
  }
  const out = join(DIST, `${def.id}.m4a`)
  // El mismo nivelado que la tanda de terceros, para que todo suene parecido de fuerte.
  const m = await levelAndEncode(src, out, selection.level)
  await reviewSound(out, def.id)
  rmSync(wav)
  if (src !== wav) rmSync(src)
  assets.push({
    ...baseEntry(def, 'sound'),
    durationMs: probeDurationMs(out),
    format: 'm4a',
    hasAudio: true,
    channels: stereo ? 2 : 1,
    ...fileEntry(out),
    defaults: def.repeat ? { repeat: true, durationMs: 8000, volume: 1 } : { volume: 1 },
  })
  report.push({ id: def.id, name: def.name, source: 'propio', ...m, durationMs: probeDurationMs(out) })
  console.log(`sonido ${def.id}: ${probeDurationMs(out)} ms, ${m.lufs ?? '—'} LUFS, ${m.tp} dBTP`)
}

// ------------------------------------------------------------------------------------------------ terceros

const thirdParty = expandSelection(selection)
const thirdIds = new Set()
for (const e of thirdParty) {
  if (e.own) continue
  if (thirdIds.has(e.id)) throw new Error(`id repetido en third-party.json: ${e.id}`)
  thirdIds.add(e.id)
  if (only.size && !only.has(e.id)) {
    if (keep.has(e.id)) assets.push(keep.get(e.id))
    continue
  }
  const { entry, measured } = await importAsset(ROOT, DIST, selection, e, fileEntry)
  await reviewSound(join(DIST, entry.file), entry.id)
  assets.push(entry)
  report.push({ id: e.id, name: e.name, source: entry.sourceUrl, author: entry.author, ...measured, durationMs: entry.durationMs })
  console.log(`importado ${e.id}: ${entry.durationMs} ms, ${entry.channels} canal(es), ${measured.lufs ?? '—'} LUFS, ${measured.tp} dBTP${measured.limited ? ' (limitado)' : ''}${measured.byPeak ? ' (por pico)' : ''}`)
}

// ------------------------------------------------------------------------------------------------ orden y salida

// Efectos en el orden del script; sonidos por categoría y, dentro, en el orden de third-party.json (los propios
// donde los coloca su marca `own`; si no tienen, al final de su categoría).
const effectOrder = [...EFFECTS, ...STILLS].map((d) => d.id)
const soundOrder = thirdParty.map((e) => e.own ?? e.id)
const catIndex = new Map(CATEGORIES.map((c, i) => [c.id, i]))
const rank = (a) => (a.kind === 'effect' ? effectOrder.indexOf(a.id) : soundOrder.includes(a.id) ? soundOrder.indexOf(a.id) : 10_000)
assets.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'effect' ? -1 : 1) || (a.kind === 'sound' ? catIndex.get(a.category) - catIndex.get(b.category) : 0) || rank(a) - rank(b))

const withoutRevision = (c) => JSON.stringify({ ...c, revision: 0 })
const draft = {
  schema: 1,
  revision: old?.revision ?? 1,
  baseUrl: 'https://github.com/Krahegwen/easy-cut/releases/download/library-v1/',
  ownLicense: 'CC0-1.0',
  categories: CATEGORIES,
  assets,
}
// La revisión sube solo si algo ha cambiado (así las apps instaladas cogen el catálogo nuevo de la release).
const catalog = old && withoutRevision(old) === withoutRevision(draft) ? draft : { ...draft, revision: (old?.revision ?? 0) + 1 }
const catalogText = `${JSON.stringify(catalog, null, 2)}\n`
writeFileSync(CATALOG, catalogText)
writeFileSync(join(DIST, 'catalog.json'), catalogText)
writeFileSync(join(DIST, 'CREDITS.md'), creditsMarkdown(catalog))

// Lo que ya no está en el catálogo sobra en dist/ (no se sube).
if (!only.size) {
  const wanted = new Set(['catalog.json', 'CREDITS.md', ...assets.flatMap((a) => [a.file, ...(a.preview ? [a.preview.file] : [])])])
  for (const f of readdirSync(DIST, { withFileTypes: true })) {
    if (f.isFile() && !wanted.has(f.name)) {
      rmSync(join(DIST, f.name))
      console.log(`quitado de dist/: ${f.name}`)
    }
  }
}
if (report.length) {
  mkdirSync(REVIEW, { recursive: true })
  writeFileSync(join(REVIEW, 'sound-levels.json'), `${JSON.stringify(report, null, 1)}\n`)
}
console.log(`Catálogo: ${assets.length} elementos (revisión ${catalog.revision}) en ${CATALOG}`)

/** Créditos de la biblioteca para subirlos con los ficheros (library/dist/CREDITS.md). */
function creditsMarkdown(c) {
  const lines = [
    '# Créditos de la biblioteca de Easy Cut',
    '',
    'Todo lo que hay en esta biblioteca se puede usar libremente en tus vídeos, también comerciales, sin nombrar a nadie.',
    '',
    `## Hecho por el proyecto Easy Cut (${c.assets.filter((a) => a.license === 'own').length} elementos)`,
    '',
    `Generado con \`scripts/build-library.mjs\` y publicado bajo ${c.ownLicense} (dominio público).`,
    '',
  ]
  const needs = c.assets.filter((a) => a.attribution)
  if (needs.length) {
    lines.push('## Piden que se nombre a su autor', '')
    for (const a of needs) lines.push(`- **${a.name}**: ${a.attribution}`)
    lines.push('')
  }
  const thanks = c.assets.filter((a) => !a.attribution && a.thanks)
  if (thanks.length) {
    lines.push(`## De otras personas, en dominio público (CC0 1.0) — gracias (${thanks.length} elementos)`, '')
    lines.push('No hace falta nombrarlas, pero aquí queda de dónde sale cada cosa:', '')
    for (const cat of c.categories) {
      const inCat = thanks.filter((a) => a.category === cat.id)
      if (!inCat.length) continue
      lines.push(`### ${cat.name}`, '')
      for (const a of inCat) lines.push(`- **${a.name}**: ${a.thanks}`)
      lines.push('')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

