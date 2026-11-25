<script setup lang="ts">
// Pregunta de confirmación. Esc = la opción de volver. Intro = la principal, salvo si es destructiva
// (danger): entonces Intro también es volver, y el foco empieza en «volver».
import { computed, nextTick, ref, watch } from 'vue'
import { confirmRequest } from '../lib/confirm'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { useShortcuts } from '../lib/use-shortcuts'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

const cancelButton = ref<HTMLButtonElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)
const danger = computed(() => !!confirmRequest.value?.danger)

watch(confirmRequest, async (r) => {
  if (r) {
    await nextTick()
    ;(r.danger ? cancelButton.value : confirmButton.value)?.focus()
  }
})

function answer(ok: boolean) {
  confirmRequest.value?.resolve(ok)
}

useShortcuts({
  id: 'confirm',
  title: 'Esta pregunta',
  priority: LAYER_PRIORITY.dialog,
  modal: true,
  active: () => !!confirmRequest.value,
  shortcuts: () => {
    const cancelLabel = confirmRequest.value?.cancelLabel ?? 'No, volver'
    const okLabel = confirmRequest.value?.confirmLabel ?? ''
    return [
      { id: 'confirm-cancel', keys: ['Escape'], label: 'Esc', description: `«${cancelLabel}»`, run: () => answer(false), inText: true },
      danger.value
        ? { id: 'confirm-enter', keys: ['Enter'], label: 'Intro', description: `«${cancelLabel}» (lo seguro)`, run: () => answer(false) }
        : { id: 'confirm-enter', keys: ['Enter'], label: 'Intro', description: `«${okLabel}»`, run: () => answer(true) },
    ]
  },
})
</script>

<template>
  <div v-if="confirmRequest" class="overlay" role="presentation">
    <div class="dialog card" role="alertdialog" aria-modal="true" :aria-label="confirmRequest.title" data-testid="confirm-dialog">
      <h2>{{ confirmRequest.title }}</h2>
      <p v-if="confirmRequest.message" class="message">{{ confirmRequest.message }}</p>
      <div class="actions">
        <button ref="cancelButton" class="btn" type="button" data-testid="confirm-cancel" @click="answer(false)">
          <AppIcon name="back" />
          {{ confirmRequest.cancelLabel ?? 'No, volver' }}
          <KeyHint k="Esc" />
          <KeyHint v-if="danger" k="Intro" />
        </button>
        <button
          ref="confirmButton"
          class="btn"
          :class="danger ? 'danger-solid' : 'primary'"
          type="button"
          data-testid="confirm-ok"
          @click="answer(true)"
        >
          <AppIcon name="check" />
          {{ confirmRequest.confirmLabel }}
          <KeyHint v-if="!danger" k="Intro" />
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
  z-index: 50;
  padding: 24px;
}
.dialog {
  width: min(600px, 100%);
  padding: 28px 28px 24px;
  box-shadow: var(--shadow-lg);
}
h2 {
  font-size: 24px;
  margin-bottom: 10px;
}
.message {
  color: var(--text-muted);
  font-size: 18px;
}
.actions {
  margin-top: 26px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.danger-solid {
  background: var(--bad);
  border-color: var(--bad);
  color: #fff;
}
.danger-solid:hover {
  background: #93201a !important;
  border-color: #93201a !important;
}
</style>
