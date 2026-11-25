<script setup lang="ts">
// «¡Listo!»: ver el vídeo, abrir la carpeta, copiarlo para WhatsApp, guardarlo de otra forma o hacer otro.
import { computed, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { baseName, formatDuration } from '../domain'
import { askConfirm } from '../lib/confirm'
import { store } from '../store'

const copied = ref(false)
/** Se ha guardado «Solo el sonido» (M4A): los textos hablan de sonido, no de vídeo. */
const sound = computed(() => store.lastExport.value?.target === 'sound')

async function run(what: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (e) {
    store.showError(what, e)
  }
}

function open() {
  const p = store.lastExport.value?.path
  if (p) void run(sound.value ? 'No he podido abrir el sonido.' : 'No he podido abrir el vídeo.', () => store.bridge.openFile(p))
}
function reveal() {
  const p = store.lastExport.value?.path
  if (p) void run('No he podido abrir la carpeta.', () => store.bridge.revealInFolder(p))
}
async function copy() {
  const p = store.lastExport.value?.path
  if (!p) return
  try {
    await store.bridge.copyFileToClipboard(p)
    copied.value = true
  } catch (e) {
    store.showError(sound.value ? 'No he podido copiar el sonido.' : 'No he podido copiar el vídeo.', e)
  }
}

async function another() {
  const ok = await askConfirm({
    title: '¿Hacer otro vídeo?',
    message: 'Este ya está guardado en «Mis montajes». Tus vídeos originales no se tocan.',
    confirmLabel: 'Sí, hacer otro',
    cancelLabel: 'No, volver',
  })
  if (!ok) return
  store.startNewProject()
  store.go('pick')
}
</script>

<template>
  <main class="screen done" data-testid="done-view">
    <div class="box card">
      <span class="ok"><AppIcon name="check" :size="44" /></span>
      <h1>¡Listo!</h1>
      <p class="where">{{ sound ? 'El sonido está guardado en «Mis montajes»' : 'Tu vídeo está guardado en «Mis montajes»' }}</p>
      <p v-if="store.lastExport.value" class="file muted" data-testid="done-file">
        {{ baseName(store.lastExport.value.path) }} · dura {{ formatDuration(store.lastExport.value.durationMs) }}
      </p>
      <div class="grid">
        <button class="btn primary large" type="button" data-testid="open-video" @click="open">
          <AppIcon :name="sound ? 'sound' : 'play'" />
          {{ sound ? 'Escuchar' : 'Ver el vídeo' }}
        </button>
        <button class="btn large" type="button" data-testid="open-folder" @click="reveal">
          <AppIcon name="folder" />
          Abrir la carpeta
        </button>
        <button class="btn large wide" type="button" data-testid="copy-whatsapp" @click="copy">
          <AppIcon :name="copied ? 'check' : 'copy'" />
          {{ copied ? 'Copiado' : 'Copiar para pegarlo en WhatsApp' }}
        </button>
      </div>
      <p v-if="copied" class="copied" data-testid="copied-hint">Ahora ve a WhatsApp y pulsa Ctrl+V</p>
      <div class="secondary">
        <button class="btn" type="button" data-testid="save-another-way" @click="store.go('save')">
          <AppIcon name="save" />
          Guardarlo también de otra forma
        </button>
        <button class="btn" type="button" data-testid="back-to-editor" @click="store.go('editor')">
          <AppIcon name="back" />
          Volver a tu vídeo
        </button>
        <button class="btn" type="button" data-testid="another-video" @click="another">
          <AppIcon name="plus" />
          Hacer otro vídeo
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.done {
  align-items: center;
  justify-content: center;
  overflow-y: auto;
}
.box {
  width: min(760px, calc(100% - 48px));
  padding: 40px 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}
.ok {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--good-soft);
  color: var(--good);
}
h1 {
  font-size: 38px;
}
.where {
  font-size: 21px;
}
.file {
  overflow-wrap: anywhere;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
  margin-top: 14px;
}
.wide {
  grid-column: 1 / -1;
}
.copied {
  font-size: 19px;
  font-weight: 650;
  color: var(--good);
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--good-soft);
}
.secondary {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  width: 100%;
}
</style>
