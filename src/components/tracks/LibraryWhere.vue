<script setup lang="ts">
// «Poner aquí lo pone donde está la línea: 0:12», en su propio componente: el instante cambia en cada fotograma
// mientras se reproduce y, dentro de LibraryPanel, obligaba a volver a pintar toda la biblioteca a cada
// fotograma (medido con scripts/library-perf.mjs: el hilo principal pasaba del 17 % al 55–70 %).
import { formatClock } from '../../domain'
import { tracks } from '../../store'
</script>

<template>
  <span class="where muted" data-testid="library-where">«Poner aquí» lo pone donde está la línea: {{ formatClock(tracks.playheadMs.value) }}</span>
</template>

<style scoped>
.where {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
