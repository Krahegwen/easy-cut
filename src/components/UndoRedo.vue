<script setup lang="ts">
import { store } from '../store'
import AppIcon from './AppIcon.vue'
</script>

<template>
  <div class="undo-redo" role="group" aria-label="Deshacer y rehacer">
    <button class="btn" type="button" :disabled="!store.undoable.value" title="Ctrl+Z" data-testid="undo" @click="store.undo()">
      <AppIcon name="undo" />
      Deshacer
    </button>
    <button class="btn" type="button" :disabled="!store.redoable.value" title="Ctrl+Y" data-testid="redo" @click="store.redo()">
      <AppIcon name="redo" />
      Rehacer
    </button>
  </div>
</template>

<style scoped>
.undo-redo {
  display: flex;
  gap: 8px;
}
</style>
