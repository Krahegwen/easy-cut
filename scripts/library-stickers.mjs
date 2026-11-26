// Pegatinas de la biblioteca: dibujos pequeños con transparencia para poner encima del vídeo (estrella, flecha,
// bocadillo, pulgar arriba…). Hechas por el proyecto (licencia `own`, se publican CC0), sin material de terceros.
//
// Cada pegatina es una lista de capas definidas con funciones de distancia con signo (SDF) en un espacio de
// diseño de 100×100 (y hacia abajo): así el borde sale suavizado sin supermuestreo, y el contorno blanco de
// pegatina y la sombra salen de la misma silueta (la unión de las capas). El contorno blanco y una sombra suave
// hacen que se vean igual de bien sobre un vídeo claro que sobre uno oscuro.
//
// Las animadas (WebM VP9 con alfa) mueven la misma pegatina con una transformación periódica (el último
// fotograma enlaza con el primero).

const TAU = Math.PI * 2
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const mixN = (a, b, t) => a + (b - a) * t
const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255]

// ------------------------------------------------------------------ distancias con signo (unidades de diseño)

const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r

/** Elipse (distancia aproximada, la de Íñigo Quílez: vale para dibujar y para el contorno). */
const ellipse = (cx, cy, rx, ry, rot = 0) => {
  const c = Math.cos(-rot)
  const s = Math.sin(-rot)
  return (x, y) => {
    const dx = x - cx
    const dy = y - cy
    const u = dx * c - dy * s
    const v = dx * s + dy * c
    const k0 = Math.hypot(u / rx, v / ry)
    const k1 = Math.hypot(u / (rx * rx), v / (ry * ry))
    return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry)
  }
}

function segDist(x, y, ax, ay, bx, by) {
  const ex = bx - ax
  const ey = by - ay
  const t = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1)
  return Math.hypot(x - ax - ex * t, y - ay - ey * t)
}

/** Trazo con grosor `r` (medio ancho) y extremos redondos por una lista de puntos. */
const stroke = (pts, r) => (x, y) => {
  let d = Infinity
  for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
  return d - r
}

const roundBox = (x0, y0, x1, y1, r) => {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hx = (x1 - x0) / 2 - r
  const hy = (y1 - y0) / 2 - r
  return (x, y) => {
    const qx = Math.abs(x - cx) - hx
    const qy = Math.abs(y - cy) - hy
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
}

/** Polígono (distancia exacta), con las esquinas redondeadas `round` (crece eso hacia fuera). */
const polygon = (pts, round = 0) => (x, y) => {
  let d = Infinity
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    d = Math.min(d, segDist(x, y, xi, yi, xj, yj))
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return (inside ? -d : d) - round
}

const union = (...fs) => (x, y) => {
  let d = Infinity
  for (const f of fs) d = Math.min(d, f(x, y))
  return d
}
/** Unión suave (las juntas se redondean `k`). */
const smoothUnion = (k, a, b) => (x, y) => {
  const da = a(x, y)
  const db = b(x, y)
  const h = clamp(0.5 + (0.5 * (db - da)) / k, 0, 1)
  return mixN(db, da, h) - k * h * (1 - h)
}
/** Mueve y gira una forma (para reutilizar la flecha en cuatro direcciones). */
const transform = (f, { rot = 0, flipX = false, cx = 50, cy = 50 } = {}) => {
  const c = Math.cos(-rot)
  const s = Math.sin(-rot)
  return (x, y) => {
    let dx = x - cx
    const dy = y - cy
    if (flipX) dx = -dx
    return f(cx + dx * c - dy * s, cy + dx * s + dy * c)
  }
}

/** Estrella de `n` puntas (la primera hacia arriba). */
function starPoints(cx, cy, R, r, n = 5, rot = -Math.PI / 2) {
  const pts = []
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n
    const rr = i % 2 ? r : R
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
  }
  return pts
}

// ------------------------------------------------------------------ rellenos

const solid = (c) => {
  const v = hex(c)
  return () => v
}
/** Degradado vertical de `top` (en y0) a `bottom` (en y1). */
const vgrad = (top, bottom, y0 = 0, y1 = 100) => {
  const a = hex(top)
  const b = hex(bottom)
  return (_x, y) => {
    const t = clamp((y - y0) / (y1 - y0), 0, 1)
    return [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)]
  }
}

/** Capa: forma, relleno y opacidad. `detail`: va dentro de la silueta (no cuenta para el contorno). */
const layer = (sdf, fill, { alpha = 1, detail = false } = {}) => ({ sdf, fill, alpha, detail })
const shine = (cx, cy, rx, ry, rot = -0.5, alpha = 0.45) => layer(ellipse(cx, cy, rx, ry, rot), solid('#ffffff'), { alpha, detail: true })

// ------------------------------------------------------------------ las pegatinas

function arrowShape() {
  // Hacia la derecha; las demás direcciones, girándola.
  return smoothUnion(2.5, roundBox(8, 39, 60, 61, 5), polygon([[50, 17], [92, 50], [50, 83]], 3.5))
}

function heartShape(cx = 50, cy = 50, s = 1) {
  const p = (x, y) => [cx + (x - 50) * s, cy + (y - 50) * s]
  return smoothUnion(3 * s, union(circle(...p(31, 36), 22 * s), circle(...p(69, 36), 22 * s)), polygon([p(12, 44), p(88, 44), p(50, 88)], 2 * s))
}

function bubbleShape() {
  return smoothUnion(4, ellipse(50, 43, 45, 32), polygon([[22, 60], [42, 68], [12, 92]], 1.5))
}

const DARK = '#1f2933'

function rays(cx, cy, r0, r1, angles, w) {
  return union(...angles.map((deg) => {
    const a = (deg * Math.PI) / 180
    return stroke([[cx + Math.cos(a) * r0, cy + Math.sin(a) * r0], [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]], w)
  }))
}

/** Círculo hecho a mano: una vuelta y un poco más, con el radio cambiando poco a poco. */
function handCircle() {
  const pts = []
  const turns = 1.12
  const n = 90
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const a = -2.6 + t * TAU * turns
    const rx = mixN(44, 41, t)
    const ry = mixN(30, 33.5, t)
    const rot = -0.12
    const x = Math.cos(a) * rx
    const y = Math.sin(a) * ry
    pts.push([50 + x * Math.cos(rot) - y * Math.sin(rot), 50 + x * Math.sin(rot) + y * Math.cos(rot)])
  }
  return stroke(pts, 3.4)
}

function questionArc() {
  const pts = []
  // Arco de la interrogación: de la izquierda, por arriba, hasta bajar por la derecha; y el palo hacia el centro.
  for (let i = 0; i <= 40; i++) {
    const a = mixN(-Math.PI * 1.05, Math.PI * 0.32, i / 40)
    pts.push([50 + Math.cos(a) * 20, 32 + Math.sin(a) * 19])
  }
  pts.push([51, 58], [51, 64])
  return stroke(pts, 8)
}

const arrowFill = vgrad('#ff8a4c', '#e5390b', 15, 85)

const STILL = (x, y, scale = 0.25) => ({ durationMs: 3000, look: { mix: 'normal', fit: 'contain', box: { x, y, scale } } })

export const STICKERS = [
  {
    id: 'pegatina-estrella',
    name: 'Estrella dorada',
    description: 'Pegatina de una estrella amarilla con borde blanco, para destacar algo',
    tags: ['pegatina', 'estrella', 'destacar', 'premio', 'oro'],
    defaults: STILL(0.8, 0.28),
    layers: () => [
      layer(polygon(starPoints(50, 54, 47, 20), 2.5), vgrad('#ffe45c', '#f59f00', 8, 92)),
      layer(polygon(starPoints(46, 48, 22, 9.5), 1), solid('#fff3b0'), { alpha: 0.5, detail: true }),
    ],
  },
  {
    id: 'pegatina-corazon',
    name: 'Corazón rojo',
    description: 'Pegatina de un corazón rojo brillante, para lo que te encanta',
    tags: ['pegatina', 'corazón', 'amor', 'me gusta', 'rojo'],
    defaults: STILL(0.8, 0.28),
    layers: () => [layer(heartShape(), vgrad('#ff5470', '#d1002c', 14, 88)), shine(30, 30, 8, 4.8)],
  },
  {
    id: 'pegatina-flecha-derecha',
    name: 'Flecha hacia la derecha',
    description: 'Flecha naranja que señala a la derecha: ponla a la izquierda de lo que quieres enseñar',
    tags: ['pegatina', 'flecha', 'señalar', 'mira', 'derecha'],
    defaults: STILL(0.3, 0.5),
    layers: () => [layer(arrowShape(), arrowFill)],
  },
  {
    id: 'pegatina-flecha-izquierda',
    name: 'Flecha hacia la izquierda',
    description: 'Flecha naranja que señala a la izquierda: ponla a la derecha de lo que quieres enseñar',
    tags: ['pegatina', 'flecha', 'señalar', 'mira', 'izquierda'],
    defaults: STILL(0.7, 0.5),
    layers: () => [layer(transform(arrowShape(), { flipX: true }), arrowFill)],
  },
  {
    id: 'pegatina-flecha-abajo',
    name: 'Flecha hacia abajo',
    description: 'Flecha naranja que señala hacia abajo: ponla encima de lo que quieres enseñar',
    tags: ['pegatina', 'flecha', 'señalar', 'mira', 'abajo'],
    defaults: STILL(0.5, 0.22),
    layers: () => [layer(transform(arrowShape(), { rot: Math.PI / 2 }), arrowFill)],
  },
  {
    id: 'pegatina-flecha-rebota',
    name: 'Flecha que rebota hacia abajo',
    description: 'Flecha naranja animada que bota señalando hacia abajo (se repite sin saltos)',
    tags: ['pegatina', 'flecha', 'señalar', 'mira', 'abajo', 'animada', 'movimiento'],
    defaults: { repeat: true, durationMs: 3000, look: { mix: 'normal', fit: 'contain', box: { x: 0.5, y: 0.22, scale: 0.25 } } },
    animated: { seconds: 1 },
    // Bota: parábola de 0 a 0 en cada vuelta (arriba a mitad), con un poco de margen por arriba.
    motion: (t) => ({ dy: -11 * (1 - (2 * t - 1) ** 2), s: 1 }),
    layers: () => [layer(roundedArrowDown(), arrowFill)],
  },
  {
    id: 'pegatina-bocadillo-puntos',
    name: 'Bocadillo con puntos suspensivos',
    description: 'Bocadillo de cómic blanco con tres puntos, como si alguien estuviera pensando o escribiendo',
    tags: ['pegatina', 'bocadillo', 'cómic', 'pensar', 'hablar', 'puntos'],
    defaults: STILL(0.72, 0.26),
    layers: () => [
      layer(bubbleShape(), solid(DARK)),
      layer((x, y) => bubbleShape()(x, y) + 2.6, solid('#ffffff'), { detail: true }),
      layer(union(circle(30, 43, 6.2), circle(50, 43, 6.2), circle(70, 43, 6.2)), solid(DARK), { detail: true }),
    ],
  },
  {
    id: 'pegatina-bocadillo-exclamacion',
    name: 'Bocadillo con exclamación',
    description: 'Bocadillo de cómic blanco con un «!» rojo, para una sorpresa o un aviso',
    tags: ['pegatina', 'bocadillo', 'cómic', 'sorpresa', 'aviso', 'exclamación'],
    defaults: STILL(0.72, 0.26),
    layers: () => [
      layer(bubbleShape(), solid(DARK)),
      layer((x, y) => bubbleShape()(x, y) + 2.6, solid('#ffffff'), { detail: true }),
      layer(union(polygon([[44, 20], [56, 20], [53.5, 50], [46.5, 50]], 2.5), circle(50, 60.5, 5.8)), solid('#e03131'), { detail: true }),
    ],
  },
  {
    id: 'pegatina-pulgar-arriba',
    name: 'Pulgar arriba (me gusta)',
    description: 'Mano amarilla con el pulgar hacia arriba: «me gusta», «bien hecho»',
    tags: ['pegatina', 'pulgar', 'me gusta', 'bien', 'ok', 'mano', 'like'],
    defaults: STILL(0.8, 0.7),
    layers: () => [
      layer(roundBox(8, 46, 30, 94, 4), vgrad('#4dabf7', '#1c7ed6', 46, 94)),
      layer(smoothUnion(5, roundBox(26, 44, 84, 94, 11), stroke([[42, 50], [50, 10]], 10)), vgrad('#ffd43b', '#f59f00', 8, 94)),
      layer(union(stroke([[60, 57], [84, 57]], 1.4), stroke([[60, 69.5], [84, 69.5]], 1.4), stroke([[60, 82], [84, 82]], 1.4)), solid('#c77700'), { detail: true }),
      layer(stroke([[38, 47], [55, 47]], 1.4), solid('#c77700'), { detail: true }),
      shine(46, 20, 3, 6.5, 0.2, 0.4),
    ],
  },
  {
    id: 'pegatina-exclamacion',
    name: 'Signo de exclamación rojo',
    description: 'Un «!» rojo grande, para avisar de algo importante',
    tags: ['pegatina', 'exclamación', 'aviso', 'importante', 'atención'],
    defaults: STILL(0.82, 0.3),
    layers: () => [layer(union(polygon([[38, 8], [62, 8], [56, 63], [44, 63]], 4), circle(50, 84, 10.5)), vgrad('#ff5c4d', '#c81e14', 4, 95))],
  },
  {
    id: 'pegatina-interrogacion',
    name: 'Signo de interrogación azul',
    description: 'Un «?» azul grande, para una pregunta o una duda',
    tags: ['pegatina', 'interrogación', 'pregunta', 'duda', 'qué'],
    defaults: STILL(0.82, 0.3),
    layers: () => [layer(union(questionArc(), circle(51, 84, 9.5)), vgrad('#5c7cfa', '#3b5bdb', 4, 95))],
  },
  {
    id: 'pegatina-bien',
    name: 'Bien (marca verde)',
    description: 'Círculo verde con una marca blanca: correcto, hecho, sí',
    tags: ['pegatina', 'bien', 'correcto', 'hecho', 'sí', 'check', 'vale'],
    defaults: STILL(0.8, 0.28),
    layers: () => [layer(circle(50, 50, 46), vgrad('#40d76b', '#1f9d48', 4, 96)), layer(stroke([[27, 52], [43, 68], [74, 35]], 6.8), solid('#ffffff'), { detail: true })],
  },
  {
    id: 'pegatina-mal',
    name: 'Mal (equis roja)',
    description: 'Círculo rojo con una equis blanca: incorrecto, no, error',
    tags: ['pegatina', 'mal', 'incorrecto', 'no', 'error', 'equis'],
    defaults: STILL(0.8, 0.28),
    layers: () => [
      layer(circle(50, 50, 46), vgrad('#ff5a4f', '#d70015', 4, 96)),
      layer(union(stroke([[33, 33], [67, 67]], 6.8), stroke([[67, 33], [33, 67]], 6.8)), solid('#ffffff'), { detail: true }),
    ],
  },
  {
    id: 'pegatina-circulo',
    name: 'Círculo rojo para señalar',
    description: 'Un círculo rojo como hecho a mano, para rodear lo que quieres que se vea',
    tags: ['pegatina', 'círculo', 'rodear', 'señalar', 'marcar', 'aquí'],
    defaults: STILL(0.62, 0.45, 0.32),
    layers: () => [layer(handCircle(), solid('#ff2d2d'))],
  },
  {
    id: 'pegatina-destellos',
    name: 'Destellos amarillos',
    description: 'Tres destellos de cuatro puntas, para que algo brille',
    tags: ['pegatina', 'destellos', 'brillo', 'nuevo', 'limpio', 'magia'],
    defaults: STILL(0.78, 0.28),
    layers: () => {
      const fill = vgrad('#fff176', '#ffb300', 6, 94)
      return [layer(union(polygon(starPoints(40, 58, 36, 7.5, 4), 1.5), polygon(starPoints(78, 22, 17, 3.8, 4), 1), polygon(starPoints(80, 80, 13, 3, 4), 1)), fill)]
    },
  },
  {
    id: 'pegatina-corona',
    name: 'Corona dorada',
    description: 'Corona de oro con joyas, para el rey o la reina de la casa',
    tags: ['pegatina', 'corona', 'rey', 'reina', 'campeón', 'oro'],
    defaults: STILL(0.5, 0.2),
    layers: () => [
      layer(union(polygon([[10, 82], [10, 36], [30, 56], [50, 24], [70, 56], [90, 36], [90, 82]], 2.5), circle(10, 31, 6.5), circle(50, 19, 6.5), circle(90, 31, 6.5)), vgrad('#ffe066', '#f08c00', 14, 85)),
      layer(roundBox(10, 70, 90, 84, 2.5), solid('#e67700'), { alpha: 0.55, detail: true }),
      layer(circle(30, 77, 4.2), solid('#e03131'), { detail: true }),
      layer(circle(50, 77, 4.2), solid('#1c7ed6'), { detail: true }),
      layer(circle(70, 77, 4.2), solid('#2f9e44'), { detail: true }),
    ],
  },
  {
    id: 'pegatina-bombilla',
    name: 'Bombilla encendida (idea)',
    description: 'Bombilla amarilla encendida: «¡tengo una idea!»',
    tags: ['pegatina', 'bombilla', 'idea', 'luz', 'pensar', 'truco'],
    defaults: STILL(0.8, 0.28),
    layers: () => [
      layer(rays(50, 42, 33, 43, [-90, -45, -135, -5, -175], 2.6), solid('#ffc400')),
      layer(smoothUnion(4, circle(50, 42, 25), polygon([[39, 58], [61, 58], [59, 72], [41, 72]])), vgrad('#fff59d', '#ffd60a', 16, 72)),
      layer(roundBox(39, 70, 61, 90, 4), vgrad('#adb5bd', '#6c757d', 70, 90)),
      layer(union(stroke([[41, 76.5], [59, 76.5]], 1.1), stroke([[41, 82.5], [59, 82.5]], 1.1)), solid('#495057'), { detail: true }),
      shine(41, 33, 5, 8, 0.5, 0.55),
    ],
  },
  {
    id: 'pegatina-notas',
    name: 'Notas musicales',
    description: 'Dos corcheas moradas unidas, para cuando suena música',
    tags: ['pegatina', 'música', 'notas', 'canción', 'bailar', 'cantar'],
    defaults: STILL(0.8, 0.28),
    layers: () => [
      layer(
        union(ellipse(29, 77, 13, 9.5, -0.35), ellipse(71, 69, 13, 9.5, -0.35), stroke([[39.5, 74], [39.5, 22]], 3.8), stroke([[81.5, 66], [81.5, 13]], 3.8), polygon([[36, 16], [85, 6], [85, 19], [36, 29]], 1)),
        vgrad('#845ef7', '#5f3dc4', 6, 88),
      ),
    ],
  },
  {
    id: 'pegatina-globo',
    name: 'Globo rojo',
    description: 'Un globo rojo con su cordel, para cumpleaños y fiestas',
    tags: ['pegatina', 'globo', 'cumpleaños', 'fiesta', 'celebración'],
    defaults: STILL(0.82, 0.32),
    layers: () => [
      layer(stroke(Array.from({ length: 25 }, (_, i) => [50 + 2.6 * Math.sin((i / 24) * TAU * 1.1), 76 + (i / 24) * 22]), 1.3), solid('#495057')),
      layer(smoothUnion(2, ellipse(50, 38, 30, 35), polygon([[45, 76], [55, 76], [50, 70]], 1.5)), vgrad('#ff5c5c', '#c92a2a', 4, 78)),
      shine(38, 24, 6, 10, 0.5, 0.45),
    ],
  },
  {
    id: 'pegatina-corazon-late',
    name: 'Corazón que late',
    description: 'Corazón rojo animado que late dos veces por segundo (se repite sin saltos)',
    tags: ['pegatina', 'corazón', 'amor', 'me gusta', 'animada', 'movimiento', 'latido'],
    defaults: { repeat: true, durationMs: 3000, look: { mix: 'normal', fit: 'contain', box: { x: 0.8, y: 0.28, scale: 0.25 } } },
    animated: { seconds: 1 },
    // Latido doble («pum-pum») y reposo; a t = 0 y t = 1 está en reposo, así enlaza.
    motion: (t) => ({ dy: 0, s: 0.92 + 0.1 * Math.exp(-(((t - 0.16) / 0.07) ** 2)) + 0.07 * Math.exp(-(((t - 0.4) / 0.07) ** 2)) }),
    layers: () => [layer(heartShape(), vgrad('#ff5470', '#d1002c', 14, 88)), shine(30, 30, 8, 4.8)],
  },
]

function roundedArrowDown() {
  // La flecha hacia abajo un poco más baja, para que al botar no se salga por arriba.
  const down = transform(arrowShape(), { rot: Math.PI / 2 })
  return (x, y) => down(x, y - 3)
}

// ------------------------------------------------------------------ dibujar

/** Grosor del contorno blanco y de la sombra, en unidades de diseño. */
const BORDER = 3.4
const SHADOW_DY = 1.8
const SHADOW_SOFT = 4.5
const SHADOW_ALPHA = 0.38

/**
 * Un fotograma de la pegatina en RGBA (sin premultiplicar), de `size`×`size`. `t` (0..1) es el momento de la
 * vuelta en las animadas.
 */
export function renderSticker(def, size, t = 0) {
  const layers = def.layers()
  const base = layers.filter((l) => !l.detail)
  const m = def.motion ? def.motion(t) : { dy: 0, s: 1 }
  // Margen para el contorno, la sombra y lo que se mueva: el diseño de 0 a 100 cabe dentro.
  const margin = BORDER + SHADOW_SOFT + SHADOW_DY + 1
  const k = size / (100 + 2 * margin)
  const out = Buffer.alloc(size * size * 4)
  const at = (x, y) => [50 + (x - 50) / m.s, 50 + (y - 50 - m.dy) / m.s]
  const sil = (x, y) => {
    const [u, v] = at(x, y)
    let d = Infinity
    for (const l of base) d = Math.min(d, l.sdf(u, v))
    return d * m.s
  }
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / k - margin
      const y = (py + 0.5) / k - margin
      const d = sil(x, y)
      // Premultiplicado: sombra, contorno blanco y capas, por orden.
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      const over = (cr, cg, cb, ca) => {
        r = cr * ca + r * (1 - ca)
        g = cg * ca + g * (1 - ca)
        b = cb * ca + b * (1 - ca)
        a = ca + a * (1 - ca)
      }
      const ds = sil(x, y - SHADOW_DY)
      if (ds - BORDER < SHADOW_SOFT) {
        const q = clamp(1 - (ds - BORDER) / SHADOW_SOFT, 0, 1)
        over(0, 0, 0, SHADOW_ALPHA * q * q * (3 - 2 * q))
      }
      if (d - BORDER < 2 / k) {
        const cov = clamp(0.5 - (d - BORDER) * k, 0, 1)
        if (cov > 0) {
          over(1, 1, 1, cov)
          // Un filo gris muy fino por fuera del blanco: se distingue también sobre un vídeo blanco.
          const edge = clamp(1 - Math.abs((d - BORDER) * k + 0.5) / 1.3, 0, 1) * 0.22
          if (edge > 0) over(0.35, 0.38, 0.42, edge)
        }
        if (d < 1 / k) {
          const [u, v] = at(x, y)
          for (const l of layers) {
            const c = clamp(0.5 - l.sdf(u, v) * m.s * k, 0, 1) * l.alpha
            if (c <= 0) continue
            const col = l.fill(u, v)
            over(col[0], col[1], col[2], c)
          }
        }
      }
      const i = (py * size + px) * 4
      const inv = a > 0.0001 ? 1 / a : 0
      out[i] = Math.round(clamp(r * inv, 0, 1) * 255)
      out[i + 1] = Math.round(clamp(g * inv, 0, 1) * 255)
      out[i + 2] = Math.round(clamp(b * inv, 0, 1) * 255)
      out[i + 3] = Math.round(clamp(a, 0, 1) * 255)
    }
  }
  return out
}
