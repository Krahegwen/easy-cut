<script setup lang="ts">
// Elegir vídeos: con la ventana de Windows o soltándolos aquí.
import AppIcon from '../components/AppIcon.vue'
import { pickAndAddVideos } from '../lib/add-videos'
import { store } from '../store'

defineProps<{ hovering: boolean }>()
</script>

<template>
  <main class="screen pick">
    <header class="topbar">
      <button class="btn quiet" type="button" data-testid="back-home" @click="store.go('home')">
        <AppIcon name="back" />
        Volver
      </button>
      <h1>Elige tus vídeos</h1>
    </header>
    <div class="body">
      <div class="drop" :class="{ hovering }">
        <span class="drop-icon"><AppIcon name="upload" :size="44" /></span>
        <h2>Suelta aquí tus vídeos</h2>
        <p class="muted">o</p>
        <button class="btn primary large" type="button" data-testid="pick-videos" @click="pickAndAddVideos">
          <AppIcon name="folder" />
          Elegir vídeos del ordenador
        </button>
        <p class="hint muted">Puedes elegir varios a la vez. Saldrán en el orden en que los elijas, y luego podrás cambiarlo.</p>
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
</style>
