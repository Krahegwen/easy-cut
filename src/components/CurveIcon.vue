<script setup lang="ts">
// El dibujito de una curva («Suave», «Empieza despacio»…): cómo sube (o baja, con `falling`) con el tiempo.
// Mismos puntos que usa el dominio para calcularla (easingPoints), así el dibujo es la curva de verdad.
import { computed } from 'vue'
import { easingPoints, type MotionEasing } from '../domain'

const props = withDefaults(defineProps<{ easing: MotionEasing | 'none'; falling?: boolean; size?: number }>(), { falling: false, size: 40 })

const W = 40
const H = 28
const PAD = 4

const path = computed(() => {
  // «De golpe» al aparecer o desaparecer: un escalón al principio.
  const pts = props.easing === 'none' ? [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] : easingPoints(props.easing)
  return pts
    .map((p, i) => {
      const y = props.falling ? 1 - p.y : p.y
      const px = PAD + p.x * (W - PAD * 2)
      const py = H - PAD - y * (H - PAD * 2)
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`
    })
    .join(' ')
})
</script>

<template>
  <svg class="curve" :width="size" :height="(size * H) / W" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true" focusable="false">
    <line :x1="PAD" :y1="H - PAD" :x2="W - PAD" :y2="H - PAD" class="axis" />
    <path :d="path" class="line" />
  </svg>
</template>

<style scoped>
.curve {
  flex: none;
  display: block;
}
.axis {
  stroke: currentColor;
  stroke-opacity: 0.25;
  stroke-width: 1.5;
}
.line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
