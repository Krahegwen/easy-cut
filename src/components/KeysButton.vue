<script setup lang="ts">
// Botón pequeño «Teclas» (o F1): abre el panel con los atajos de la pantalla en la que se está.
import { openKeysPanel } from '../lib/use-shortcuts'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

withDefaults(defineProps<{ dark?: boolean; floating?: boolean }>(), { dark: false, floating: false })
</script>

<template>
  <button
    class="btn quiet keys-button"
    :class="{ dark, floating }"
    type="button"
    title="Ver las teclas de esta pantalla"
    data-testid="keys-button"
    @click="openKeysPanel"
  >
    <AppIcon name="keyboard" :size="22" />
    Teclas
    <KeyHint k="F1" />
  </button>
</template>

<style scoped>
.keys-button {
  min-height: 40px;
  padding: 0 10px;
  gap: 7px;
  font-size: 15px;
  color: var(--text-muted);
}
.keys-button.floating {
  position: fixed;
  top: 14px;
  right: 16px;
  z-index: 20;
}
.keys-button.dark {
  color: #d8d5cd;
}
.keys-button.dark:hover:not(:disabled) {
  background: #2d333d !important;
}
</style>
