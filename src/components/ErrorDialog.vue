<script setup lang="ts">
// Error en lenguaje llano, con «Copiar detalles» para quien tenga que ayudar.
import { ref } from 'vue'
import { copyText } from '../lib/clipboard'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { useShortcuts } from '../lib/use-shortcuts'
import { store } from '../store'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

useShortcuts({
  id: 'error',
  title: 'Este aviso',
  priority: LAYER_PRIORITY.error,
  modal: true,
  active: () => !!store.error.value,
  shortcuts: () => [
    { id: 'error-close', keys: ['Enter', 'Escape'], label: 'Intro', description: '«Entendido»', run: close, inText: true },
  ],
})

const copied = ref(false)

async function copy() {
  const e = store.error.value
  if (!e) return
  copied.value = await copyText(`${e.message}\n\n${e.details}`)
}

function close() {
  copied.value = false
  store.clearError()
}
</script>

<template>
  <div v-if="store.error.value" class="overlay">
    <div class="dialog card" role="alertdialog" aria-modal="true" data-testid="error-dialog">
      <div class="head">
        <span class="badge"><AppIcon name="warning" :size="28" /></span>
        <h2>Algo no ha salido bien</h2>
      </div>
      <p class="message" data-testid="error-message">{{ store.error.value.message }}</p>
      <p class="hint">Tus vídeos originales no se han tocado. Si vuelve a pasar, pulsa «Copiar detalles» y pégalo en un mensaje a quien te ayude.</p>
      <div class="actions">
        <button class="btn" type="button" @click="copy">
          <AppIcon :name="copied ? 'check' : 'copy'" />
          {{ copied ? 'Detalles copiados' : 'Copiar detalles' }}
        </button>
        <button class="btn primary" type="button" data-testid="error-close" @click="close">
          <AppIcon name="check" />
          Entendido
          <KeyHint k="Intro" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgb(20 24 30 / 0.45);
  display: grid;
  place-items: center;
  z-index: 60;
  padding: 24px;
}
.dialog {
  width: min(600px, 100%);
  padding: 28px;
  box-shadow: var(--shadow-lg);
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}
.badge {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--bad-soft);
  color: var(--bad);
}
h2 {
  font-size: 24px;
}
.message {
  font-size: 19px;
  font-weight: 600;
}
.hint {
  margin-top: 10px;
  color: var(--text-muted);
}
.actions {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
