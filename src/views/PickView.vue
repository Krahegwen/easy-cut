<script setup lang="ts">
// Elegir vídeos: con la ventana de Windows o soltándolos aquí.
import AppIcon from '../components/AppIcon.vue'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import { pasteFromClipboard, pickAndAddVideos } from '../lib/add-videos'
import { useShortcuts } from '../lib/use-shortcuts'
import { store } from '../store'

defineProps<{ hovering: boolean }>()

useShortcuts({
  id: 'pick',
  title: 'Elige tus vídeos',
  shortcuts: () => [
    { id: 'pick-videos', keys: ['Enter'], label: 'Intro', description: '«Elegir vídeos del ordenador»', run: () => void pickAndAddVideos() },
    { id: 'paste-files', keys: ['Ctrl+v'], label: 'Ctrl V', description: 'pegar los vídeos copiados en el Explorador', run: () => void pasteFromClipboard({ clips: false }) },
    { id: 'back', keys: ['Escape'], label: 'Esc', description: 'volver a Inicio', run: () => store.go('home') },
  ],
})
</script>

<template>
  <main class="screen pick" data-testid="pick-view">
    <header class="topbar">
      <button class="btn quiet" type="button" data-testid="back-home" @click="store.go('home')">
        <AppIcon name="back" />
        Volver
        <KeyHint k="Esc" />
      </button>
      <h1>Elige tus vídeos</h1>
      <span class="spacer" />
      <KeysButton />
    </header>
    <div class="body">
      <div class="drop" :class="{ hovering }">
        <span class="drop-icon"><AppIcon name="upload" :size="44" /></span>
        <h2>Suelta aquí tus vídeos</h2>
        <p class="muted">o</p>
        <button class="btn primary large" type="button" data-testid="pick-videos" @click="pickAndAddVideos">
          <AppIcon name="folder" />
          Elegir vídeos del ordenador
          <KeyHint k="Intro" />
        </button>
        <p class="hint muted">Puedes elegir varios a la vez, y también sonidos (como una grabación de voz). Saldrán en el orden en que los elijas, y luego podrás cambiarlo.</p>
        <p class="hint muted paste-hint">También puedes copiarlos en el Explorador y pegarlos aquí con <KeyHint k="Ctrl V" /></p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.body {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 32px;
}
.drop {
  width: min(760px, 100%);
  min-height: 380px;
  border: 3px dashed var(--border-strong);
  border-radius: 24px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 40px;
  text-align: center;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}
.drop.hovering {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.drop-icon {
  color: var(--accent);
}
.drop h2 {
  font-size: 28px;
}
.hint {
  max-width: 460px;
  margin-top: 6px;
}
.paste-hint {
  margin-top: 0;
  color: var(--text-muted);
}
</style>
