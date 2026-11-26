<script setup lang="ts">
// El dibujito de cada transición: dos trozos (el que sale, claro; el que entra, en el color de acento) y cómo se
// pasa de uno a otro. «cut» es el corte seco.
import type { TransitionKind } from '../domain'

defineProps<{ kind: TransitionKind | 'cut' }>()
</script>

<template>
  <svg class="t-icon" viewBox="0 0 48 28" width="48" height="28" aria-hidden="true">
    <template v-if="kind === 'cut'">
      <rect x="2" y="4" width="21" height="20" rx="2" class="a" />
      <rect x="25" y="4" width="21" height="20" rx="2" class="b" />
    </template>
    <template v-else-if="kind === 'dissolve'">
      <rect x="2" y="4" width="28" height="20" rx="2" class="a" />
      <rect x="18" y="4" width="28" height="20" rx="2" class="b soft" />
    </template>
    <template v-else-if="kind === 'dip-black' || kind === 'dip-white'">
      <rect x="2" y="4" width="16" height="20" rx="2" class="a" />
      <rect x="18" y="4" width="12" height="20" :class="kind === 'dip-black' ? 'black' : 'white'" />
      <rect x="30" y="4" width="16" height="20" rx="2" class="b" />
    </template>
    <template v-else-if="kind === 'cover'">
      <rect x="2" y="4" width="34" height="20" rx="2" class="a" />
      <rect x="20" y="4" width="26" height="20" rx="2" class="b" />
      <path d="M31 14h-8m3-3-3 3 3 3" class="arrow" />
    </template>
    <template v-else-if="kind === 'push'">
      <rect x="0" y="4" width="22" height="20" rx="2" class="a" />
      <rect x="24" y="4" width="24" height="20" rx="2" class="b" />
      <path d="M20 14h-9m3-3-3 3 3 3M44 14h-9m3-3-3 3 3 3" class="arrow" />
    </template>
    <template v-else>
      <rect x="2" y="4" width="28" height="20" rx="2" class="a" />
      <rect x="9" y="9" width="14" height="10" rx="1" class="a-in" />
      <path d="M5 7l4 4M27 7l-4 4M5 21l4-4M27 21l-4-4" class="arrow" />
      <rect x="32" y="4" width="14" height="20" rx="2" class="b soft" />
    </template>
  </svg>
</template>

<style scoped>
.t-icon {
  flex: none;
}
.a {
  fill: color-mix(in srgb, currentColor 22%, transparent);
  stroke: currentColor;
  stroke-width: 1.5;
}
.a-in {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-dasharray: 2 1.5;
}
.b {
  fill: var(--accent);
  stroke: var(--accent);
  stroke-width: 1.5;
}
.b.soft {
  fill-opacity: 0.55;
}
.black {
  fill: #111;
}
.white {
  fill: #fff;
  stroke: currentColor;
  stroke-width: 1;
}
.arrow {
  fill: none;
  stroke: #fff;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
