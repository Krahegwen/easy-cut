<script setup lang="ts">
// El dibujito de una plantilla de collage: sus huecos, con la forma del vídeo, y el número de cada uno.
import { computed } from 'vue'
import { layoutById } from '../domain'

const props = withDefaults(defineProps<{ layoutId: string; aspect?: number; width?: number; numbers?: boolean }>(), { aspect: 16 / 9, width: 72, numbers: false })

const height = computed(() => Math.round(props.width / props.aspect))
const cells = computed(() => {
  const l = layoutById(props.layoutId)
  if (!l) return []
  const W = props.width
  const H = height.value
  const g = 2
  return l.cells.map((c, i) => ({
    i,
    x: c.x * W + (c.x > 0 ? g / 2 : 0),
    y: c.y * H + (c.y > 0 ? g / 2 : 0),
    w: c.w * W - (c.x > 0 ? g / 2 : 0) - (c.x + c.w < 0.999 ? g / 2 : 0),
    h: c.h * H - (c.y > 0 ? g / 2 : 0) - (c.y + c.h < 0.999 ? g / 2 : 0),
  }))
})
</script>

<template>
  <svg class="layout-icon" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" aria-hidden="true">
    <rect x="0" y="0" :width="width" :height="height" rx="4" class="frame" />
    <template v-for="c in cells" :key="c.i">
      <rect :x="c.x" :y="c.y" :width="c.w" :height="c.h" rx="2" class="cell" />
      <text v-if="numbers" :x="c.x + c.w / 2" :y="c.y + c.h / 2" class="num">{{ c.i + 1 }}</text>
    </template>
  </svg>
</template>

<style scoped>
.layout-icon {
  flex: none;
  display: block;
}
.frame {
  fill: #2a323b;
}
.cell {
  fill: #8fb3cc;
}
.num {
  fill: #1d2b36;
  font-size: 12px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
}
</style>
