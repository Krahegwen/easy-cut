<script setup lang="ts">
// Aviso de versión nueva, en Inicio y en «Tu vídeo». Discreto (no tapa nada ni interrumpe), pero se ve.
// «Más tarde» (o Esc) lo oculta hasta el próximo arranque; «Actualizar ahora» abre el diálogo de actualizar.
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { useShortcuts } from '../lib/use-shortcuts'
import { updater } from '../store'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

useShortcuts({
  id: 'update-notice',
  title: 'El aviso de la versión nueva',
  priority: LAYER_PRIORITY.overlay,
  active: () => updater.noticeVisible.value,
  shortcuts: () => [{ id: 'update-later', keys: ['Escape'], label: 'Esc', description: '«Más tarde» (no avisar hasta la próxima vez)', run: updater.later }],
})
</script>

<template>
  <section v-if="updater.noticeVisible.value" class="update-notice" :class="{ compact }" role="status" data-testid="update-notice">
    <p class="text">
      <AppIcon name="star" :size="22" />
      <span>Hay una versión nueva de Easy Cut ({{ updater.available.value?.version }})</span>
    </p>
    <div class="actions">
      <button class="btn primary" type="button" data-testid="update-now" @click="updater.askToUpdate()">
        <AppIcon name="save" />
        Actualizar ahora
      </button>
      <button class="btn quiet" type="button" data-testid="update-later" @click="updater.later()">
        Más tarde
        <KeyHint k="Esc" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.update-notice {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 14px 12px 18px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-lg);
  background: var(--accent-soft);
}
.text {
  flex: 1 1 260px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 600;
  color: var(--accent-hover);
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
/* En la columna de la derecha de «Tu vídeo»: uno debajo de otro. */
.compact {
  flex-direction: column;
  align-items: stretch;
  padding: 14px;
  gap: 10px;
}
.compact .text {
  flex: none;
  font-size: 16px;
  align-items: flex-start;
}
.compact .actions {
  flex-direction: column;
}
</style>
