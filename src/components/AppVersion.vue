<script setup lang="ts">
// Pie de Inicio: la versión instalada y «Buscar actualizaciones» (solo en la app instalada), con la respuesta
// en llano. Si hay una nueva, sale el aviso de siempre.
import { computed } from 'vue'
import { appVersion, updater, updaterEnabled } from '../store'

const status = computed(() => {
  switch (updater.manualStatus.value) {
    case 'checking':
      return 'Buscando…'
    case 'up-to-date':
      return 'Ya tienes la última versión'
    case 'failed':
      return 'No se ha podido comprobar ahora. Mira si hay internet y vuelve a probar.'
    default:
      return ''
  }
})
</script>

<template>
  <footer class="app-version" data-testid="app-version">
    <span data-testid="app-version-text">Versión {{ appVersion }}</span>
    <template v-if="updaterEnabled">
      <span aria-hidden="true">·</span>
      <button
        class="link"
        type="button"
        data-testid="check-updates"
        :disabled="updater.manualStatus.value === 'checking' || !!updater.dialog.value"
        @click="updater.checkNow()"
      >
        Buscar actualizaciones
      </button>
      <span v-if="status" class="status" role="status" data-testid="check-updates-status">{{ status }}</span>
    </template>
  </footer>
</template>

<style scoped>
.app-version {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 15px;
  color: var(--text-soft);
}
.link {
  border: 0;
  background: none;
  padding: 4px 2px;
  font: inherit;
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.link:hover:not(:disabled) {
  color: var(--accent-hover);
}
.link:disabled {
  color: var(--text-soft);
  cursor: default;
}
.status {
  color: var(--text-muted);
}
</style>
