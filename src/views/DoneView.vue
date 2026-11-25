<script setup lang="ts">
// «¡Listo!»: ver el vídeo, abrir la carpeta, copiarlo para WhatsApp, guardarlo de otra forma o hacer otro.
import { computed, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import { baseName, creditsText, formatDuration, projectCredits } from '../domain'
import { copyText } from '../lib/clipboard'
import { askConfirm } from '../lib/confirm'
import { useShortcuts } from '../lib/use-shortcuts'
import { library, store } from '../store'

const copied = ref(false)
/** Material de la biblioteca con autor que pide que se le nombre (para la descripción del vídeo). */
const credits = computed(() => projectCredits(store.project.value, library.catalog.value))
const creditsCopied = ref(false)
async function copyCredits() {
  creditsCopied.value = await copyText(creditsText(credits.value))
}
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

useShortcuts({
  id: 'done',
  title: '¡Listo!',
  shortcuts: () => [
    { id: 'open-video', keys: ['Enter'], label: 'Intro', description: sound.value ? '«Escuchar»' : '«Ver el vídeo»', run: open },
    { id: 'back', keys: ['Escape'], label: 'Esc', description: 'volver a tu vídeo', run: () => store.go('editor') },
  ],
})
</script>

<template>
  <main class="screen done" data-testid="done-view">
    <KeysButton floating />
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
          <KeyHint k="Intro" />
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
      <div v-if="credits.length" class="credits" data-testid="done-credits">
        <p><strong>Este vídeo usa material con autor:</strong> copia los créditos para ponerlos en la descripción.</p>
        <pre class="credits-text" data-testid="done-credits-text">{{ creditsText(credits) }}</pre>
        <button class="btn" type="button" data-testid="copy-credits" @click="copyCredits">
          <AppIcon :name="creditsCopied ? 'check' : 'copy'" />
          {{ creditsCopied ? 'Créditos copiados' : 'Copiar los créditos' }}
        </button>
      </div>
      <div class="secondary">
        <button class="btn" type="button" data-testid="save-another-way" @click="store.go('save')">
          <AppIcon name="save" />
          Guardarlo también de otra forma
        </button>
        <button class="btn" type="button" data-testid="back-to-editor" @click="store.go('editor')">
          <AppIcon name="back" />
          Volver a tu vídeo
          <KeyHint k="Esc" />
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
.credits {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--accent-soft);
  text-align: left;
  font-size: 16px;
}
.credits-text {
  margin: 0;
  width: 100%;
  max-height: 120px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface);
  font: inherit;
  font-size: 14px;
  white-space: pre-wrap;
  user-select: text;
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
