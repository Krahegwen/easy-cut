<script setup lang="ts">
// Diálogo de actualizar: la pregunta (Easy Cut se cerrará un momento), la descarga con su barra de progreso
// (Cancelar), «Instalando…» y, si algo falla, el aviso en llano con «Copiar detalles».
import { computed, nextTick, ref, watch } from 'vue'
import { copyText } from '../lib/clipboard'
import { LAYER_PRIORITY, type Shortcut } from '../lib/shortcuts'
import { downloadFraction, UPDATE_FAILED_MESSAGE } from '../lib/updater'
import { useShortcuts } from '../lib/use-shortcuts'
import { updater } from '../store'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

const dialog = updater.dialog
const fraction = computed(() => downloadFraction(dialog.value))
const percent = computed(() => (fraction.value === null ? null : Math.floor(fraction.value * 100)))
const copied = ref(false)
const mainButton = ref<HTMLButtonElement | null>(null)

watch(
  () => dialog.value?.phase,
  async (phase) => {
    copied.value = false
    if (phase === 'confirm' || phase === 'failed') {
      await nextTick()
      mainButton.value?.focus()
    }
  },
)

async function copy() {
  const d = dialog.value
  if (d?.phase !== 'failed') return
  copied.value = await copyText(`${UPDATE_FAILED_MESSAGE}\n\n${d.details}`)
}

useShortcuts({
  id: 'update-dialog',
  title: 'Actualizar',
  priority: LAYER_PRIORITY.dialog,
  modal: true,
  active: () => !!dialog.value,
  shortcuts: (): Shortcut[] => {
    const phase = dialog.value?.phase
    if (phase === 'confirm') {
      return [
        { id: 'update-confirm', keys: ['Enter'], label: 'Intro', description: '«Actualizar ahora»', run: () => void updater.updateNow() },
        { id: 'update-cancel', keys: ['Escape'], label: 'Esc', description: '«Más tarde»', run: updater.closeDialog, inText: true },
      ]
    }
    if (phase === 'downloading') {
      return [{ id: 'update-cancel', keys: ['Escape'], label: 'Esc', description: '«Cancelar» la descarga', run: updater.closeDialog, inText: true }]
    }
    if (phase === 'failed') {
      return [{ id: 'update-close', keys: ['Enter', 'Escape'], label: 'Intro', description: '«Entendido»', run: updater.closeDialog, inText: true }]
    }
    return []
  },
})
</script>

<template>
  <div v-if="dialog" class="overlay" role="presentation">
    <div class="dialog card" role="alertdialog" aria-modal="true" aria-label="Actualizar Easy Cut" data-testid="update-dialog" :data-phase="dialog.phase">
      <template v-if="dialog.phase === 'confirm'">
        <h2>Actualizar a la versión {{ dialog.version }}</h2>
        <p class="message">Se descarga, se instala y Easy Cut se vuelve a abrir sola en un momento. Tu vídeo a medias se queda guardado.</p>
        <div class="actions">
          <button class="btn" type="button" data-testid="update-dialog-later" @click="updater.closeDialog()">
            <AppIcon name="back" />
            Más tarde
            <KeyHint k="Esc" />
          </button>
          <button ref="mainButton" class="btn primary" type="button" data-testid="update-dialog-confirm" @click="updater.updateNow()">
            <AppIcon name="save" />
            Actualizar ahora
            <KeyHint k="Intro" />
          </button>
        </div>
      </template>

      <template v-else-if="dialog.phase === 'downloading' || dialog.phase === 'installing'">
        <h2>{{ dialog.phase === 'downloading' ? 'Descargando la actualización…' : 'Instalando la actualización…' }}</h2>
        <div
          class="bar"
          :class="{ indeterminate: dialog.phase === 'installing' || fraction === null }"
          role="progressbar"
          aria-label="Descarga de la actualización"
          :aria-valuenow="percent ?? undefined"
          aria-valuemin="0"
          aria-valuemax="100"
          data-testid="update-progress"
          :data-percent="percent ?? ''"
        >
          <span class="fill" :style="fraction === null || dialog.phase === 'installing' ? undefined : { width: `${fraction * 100}%` }" />
        </div>
        <p class="message">
          <template v-if="dialog.phase === 'downloading'">
            {{ percent === null ? 'Un momento…' : `${percent} %` }}
          </template>
          <template v-else>Easy Cut se cerrará y se volverá a abrir sola en unos segundos.</template>
        </p>
        <div v-if="dialog.phase === 'downloading'" class="actions">
          <button class="btn" type="button" data-testid="update-dialog-cancel" @click="updater.closeDialog()">
            <AppIcon name="close" />
            Cancelar
            <KeyHint k="Esc" />
          </button>
        </div>
      </template>

      <template v-else-if="dialog.phase === 'failed'">
        <div class="head">
          <span class="badge"><AppIcon name="warning" :size="28" /></span>
          <h2>No se ha podido actualizar</h2>
        </div>
        <p class="message strong" data-testid="update-failed-message">{{ UPDATE_FAILED_MESSAGE }}</p>
        <div class="actions">
          <button class="btn" type="button" data-testid="update-copy-details" @click="copy">
            <AppIcon :name="copied ? 'check' : 'copy'" />
            {{ copied ? 'Detalles copiados' : 'Copiar detalles' }}
          </button>
          <button ref="mainButton" class="btn primary" type="button" data-testid="update-dialog-close" @click="updater.closeDialog()">
            <AppIcon name="check" />
            Entendido
            <KeyHint k="Intro" />
          </button>
        </div>
      </template>
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
  z-index: 55;
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
.message.strong {
  color: var(--text);
  font-weight: 600;
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 4px;
}
.head h2 {
  margin-bottom: 0;
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
.bar {
  position: relative;
  height: 14px;
  margin: 14px 0 10px;
  border-radius: 7px;
  background: var(--accent-soft);
  overflow: hidden;
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  border-radius: 7px;
  background: var(--accent);
  transition: width 0.2s linear;
}
/* Sin tamaño conocido (o instalando): una franja que va y viene. */
.bar.indeterminate .fill {
  width: 35%;
  animation: slide 1.3s ease-in-out infinite;
}
@keyframes slide {
  0% {
    left: -35%;
  }
  100% {
    left: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bar.indeterminate .fill {
    animation: none;
    left: 0;
    width: 100%;
    opacity: 0.5;
  }
}
.actions {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
