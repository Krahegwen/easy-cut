<script setup lang="ts">
// Hueco del teleprompter con grabación (lo rellena otra tarea). Para añadir la grabación como trozo
// al vídeo, usar store.addClipsFromPaths([ruta]) y luego store.go('editor').
import AppIcon from '../components/AppIcon.vue'
import { store } from '../store'
</script>

<template>
  <main class="screen teleprompter" data-testid="teleprompter-view">
    <header class="topbar">
      <button class="btn quiet" type="button" data-testid="back-home" @click="store.go('home')">
        <AppIcon name="back" />
        Volver
      </button>
      <h1>Grabarme leyendo un texto</h1>
    </header>
    <div class="body">
      <div class="card soon">
        <span class="icon"><AppIcon name="mic" :size="40" /></span>
        <h2>Próximamente</h2>
        <p class="muted">Aquí podrás escribir o pegar tu texto y grabarte leyéndolo mientras pasa por la pantalla.</p>
        <button class="btn primary large" type="button" @click="store.go('home')">
          <AppIcon name="back" />
          Volver al inicio
        </button>
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
.soon {
  width: min(560px, 100%);
  padding: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
}
.icon {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent);
}
h2 {
  font-size: 28px;
}
.soon p {
  font-size: 18px;
  max-width: 420px;
}
</style>
