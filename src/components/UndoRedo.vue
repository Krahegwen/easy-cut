<script setup lang="ts">
// Deshacer y rehacer (botones y Ctrl+Z / Ctrl+Y, que son las combinaciones de siempre). Solo en las
// pantallas que los enseñan: «Tu vídeo» y «Arreglar este trozo».
import { useShortcuts } from '../lib/use-shortcuts'
import { store } from '../store'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

useShortcuts({
  id: 'undo-redo',
  title: 'Deshacer',
  shortcuts: () => [
    { id: 'undo', keys: ['Ctrl+z'], label: 'Ctrl Z', description: 'deshacer lo último', run: () => store.undo(), enabled: store.undoable.value, repeat: true },
    { id: 'redo', keys: ['Ctrl+y', 'Ctrl+Shift+z'], label: 'Ctrl Y', description: 'rehacer', run: () => store.redo(), enabled: store.redoable.value, repeat: true },
  ],
})
</script>

<template>
  <div class="undo-redo" role="group" aria-label="Deshacer y rehacer">
    <button class="btn" type="button" :disabled="!store.undoable.value" data-testid="undo" @click="store.undo()">
      <AppIcon name="undo" />
      Deshacer
      <KeyHint k="Ctrl Z" />
    </button>
    <button class="btn" type="button" :disabled="!store.redoable.value" data-testid="redo" @click="store.redo()">
      <AppIcon name="redo" />
      Rehacer
      <KeyHint k="Ctrl Y" />
    </button>
  </div>
</template>

<style scoped>
.undo-redo {
  display: flex;
  gap: 8px;
}
@media (max-width: 1250px) {
  .btn {
    padding: 0 12px;
    gap: 7px;
  }
}
</style>
