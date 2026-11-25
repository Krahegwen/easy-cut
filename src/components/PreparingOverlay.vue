<script setup lang="ts">
// «Preparando tus vídeos…» mientras se leen, y la lista de los que no se han podido abrir.
import { computed, ref } from 'vue'
import { dismissFailures, failedVideos } from '../lib/add-videos'
import { copyText } from '../lib/clipboard'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { useShortcuts } from '../lib/use-shortcuts'
import { store } from '../store'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

// Mientras se preparan los vídeos no vale ninguna tecla de la pantalla de debajo.
useShortcuts({ id: 'preparing', title: 'Preparando', priority: LAYER_PRIORITY.preparing, modal: true, active: () => store.isPreparing.value, shortcuts: () => [] })
useShortcuts({
  id: 'failed-videos',
  title: 'Este aviso',
  priority: LAYER_PRIORITY.dialog,
  modal: true,
  active: () => !store.isPreparing.value && failedVideos.value.length > 0,
  shortcuts: () => [{ id: 'failed-close', keys: ['Enter', 'Escape'], label: 'Intro', description: '«Seguir»', run: close }],
})

const done = computed(() => store.preparing.value.filter((i) => i.status !== 'pending').length)
const total = computed(() => store.preparing.value.length)
const copied = ref(false)

async function copy() {
  const text = failedVideos.value.map((f) => `${f.path}\n${f.details ?? ''}`).join('\n\n')
  copied.value = await copyText(text)
}
function close() {
  copied.value = false
  dismissFailures()
}
</script>

<template>
  <div v-if="store.isPreparing.value" class="overlay" data-testid="preparing">
    <div class="dialog card">
      <div class="head">
        <span class="spinner big" />
        <h2>Preparando tus vídeos…</h2>
      </div>
      <p class="muted">{{ done }} de {{ total }}</p>
      <div class="bar"><div class="fill" :style="{ width: `${total ? (done / total) * 100 : 0}%` }" /></div>
    </div>
  </div>
  <div v-else-if="failedVideos.length > 0" class="overlay" data-testid="failed-videos">
    <div class="dialog card">
      <div class="head">
        <span class="badge"><AppIcon name="warning" :size="26" /></span>
        <h2>{{ failedVideos.length === 1 ? 'Un vídeo no se ha podido abrir' : `${failedVideos.length} vídeos no se han podido abrir` }}</h2>
      </div>
      <p class="muted">Puede que no sean vídeos o que estén dañados. Los demás sí están en tu vídeo.</p>
      <ul class="list">
        <li v-for="f in failedVideos" :key="f.path">
          <AppIcon name="film" :size="20" />
          <span>{{ f.name }}</span>
        </li>
      </ul>
      <div class="actions">
        <button class="btn" type="button" @click="copy">
          <AppIcon :name="copied ? 'check' : 'copy'" />
          {{ copied ? 'Detalles copiados' : 'Copiar detalles' }}
        </button>
        <button class="btn primary" type="button" data-testid="failed-close" @click="close">
          <AppIcon name="check" />
          Seguir
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
  z-index: 55;
  padding: 24px;
}
.dialog {
  width: min(560px, 100%);
  padding: 28px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
}
h2 {
  font-size: 23px;
}
.spinner.big {
  width: 30px;
  height: 30px;
  color: var(--accent);
}
.bar {
  height: 12px;
  border-radius: 6px;
  background: var(--surface-sunken);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}
.badge {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--warn-soft);
  color: var(--warn);
}
.list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
}
</style>
