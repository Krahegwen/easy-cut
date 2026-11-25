<script setup lang="ts">
import { store } from '../store'
import AppIcon from './AppIcon.vue'

function run() {
  const t = store.toast.value
  store.hideToast()
  t?.action?.()
}
</script>

<template>
  <Transition name="toast">
    <div v-if="store.toast.value" class="toast" :class="`on-${store.screen.value}`" role="status" data-testid="toast">
      <span class="text">{{ store.toast.value.message }}</span>
      <button v-if="store.toast.value.actionLabel" class="btn action" type="button" data-testid="toast-action" @click="run">
        <AppIcon name="undo" />
        {{ store.toast.value.actionLabel }}
      </button>
      <button class="btn quiet close" type="button" aria-label="Cerrar el aviso" @click="store.hideToast()">
        <AppIcon name="close" />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  /* Sobre la parte de arriba de la vista previa: no tapa la duración ni la tira de trozos. */
  top: 168px;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 10px 10px 22px;
  background: #1f262e;
  color: #fff;
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  max-width: calc(100vw - 48px);
  font-size: 18px;
}
/* Centrado sobre la columna de la vista previa (la de la derecha son los controles). */
.toast.on-editor {
  left: calc((100vw - 296px) / 2);
  max-width: calc(100vw - 360px);
}
.toast.on-clip {
  top: 236px;
  left: calc((100vw - 456px) / 2);
  max-width: calc(100vw - 520px);
}
@media (max-width: 1250px) {
  .toast.on-editor {
    left: calc((100vw - 266px) / 2);
    max-width: calc(100vw - 330px);
  }
  .toast.on-clip {
    left: calc((100vw - 396px) / 2);
    max-width: calc(100vw - 460px);
  }
}
@media (max-height: 760px) {
  .toast.on-editor {
    top: 130px;
  }
  .toast.on-clip {
    top: 186px;
  }
}
.toast.on-home,
.toast.on-save,
.toast.on-done,
.toast.on-pick {
  top: auto;
  bottom: 28px;
}
.action {
  background: transparent;
  color: #fff;
  border-color: rgb(255 255 255 / 0.5);
}
.action:hover {
  background: rgb(255 255 255 / 0.12) !important;
  border-color: #fff !important;
}
.close {
  color: #fff;
  padding: 0 12px;
}
.close:hover {
  background: rgb(255 255 255 / 0.12) !important;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -12px);
}
</style>
