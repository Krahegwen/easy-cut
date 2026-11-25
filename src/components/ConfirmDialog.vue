<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { confirmRequest } from '../lib/confirm'
import AppIcon from './AppIcon.vue'

const confirmButton = ref<HTMLButtonElement | null>(null)
watch(confirmRequest, async (r) => {
  if (r) {
    await nextTick()
    confirmButton.value?.focus()
  }
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') confirmRequest.value?.resolve(false)
}
</script>

<template>
  <div v-if="confirmRequest" class="overlay" role="presentation" @keydown="onKey">
    <div class="dialog card" role="alertdialog" aria-modal="true" :aria-label="confirmRequest.title" data-testid="confirm-dialog">
      <h2>{{ confirmRequest.title }}</h2>
      <p v-if="confirmRequest.message" class="message">{{ confirmRequest.message }}</p>
      <div class="actions">
        <button class="btn" type="button" @click="confirmRequest.resolve(false)">
          <AppIcon name="back" />
          {{ confirmRequest.cancelLabel ?? 'No, volver' }}
        </button>
        <button
          ref="confirmButton"
          class="btn"
          :class="confirmRequest.danger ? 'danger-solid' : 'primary'"
          type="button"
          data-testid="confirm-ok"
          @click="confirmRequest.resolve(true)"
        >
          <AppIcon name="check" />
          {{ confirmRequest.confirmLabel }}
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
  width: min(560px, 100%);
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
