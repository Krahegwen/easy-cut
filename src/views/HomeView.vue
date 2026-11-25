<script setup lang="ts">
// Inicio: hacer un vídeo nuevo (principal), seguir con el que quedó sin terminar o grabarse leyendo.
import AppIcon from '../components/AppIcon.vue'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import { formatDuration } from '../domain'
import { askConfirm } from '../lib/confirm'
import { useShortcuts } from '../lib/use-shortcuts'
import { store } from '../store'

async function newVideo() {
  if (store.autosave.value) {
    const ok = await askConfirm({
      title: '¿Empezar un vídeo nuevo?',
      message: 'El vídeo sin terminar se perderá. Tus vídeos originales no se tocan.',
      confirmLabel: 'Sí, empezar uno nuevo',
      cancelLabel: 'No, volver',
      danger: true,
    })
    if (!ok) return
  }
  store.startNewProject()
  store.go('pick')
}

function resume() {
  void store.resumeAutosave()
}

// Intro = lo destacado: «Hacer un vídeo nuevo» (si hay uno a medias, pregunta antes de perderlo).
useShortcuts({
  id: 'home',
  title: 'Inicio',
  shortcuts: () => [{ id: 'new-video', keys: ['Enter'], label: 'Intro', description: '«Hacer un vídeo nuevo»', run: () => void newVideo() }],
})
</script>

<template>
  <main class="screen home" data-testid="home-view">
    <KeysButton floating />
    <div class="content">
      <header class="hero">
        <span class="logo" aria-hidden="true"><AppIcon name="film" :size="34" /></span>
        <h1>Tus vídeos, fáciles de montar</h1>
        <p class="muted">Junta tus vídeos, quita lo que sobra y guárdalo listo para mandar.</p>
      </header>

      <div class="actions">
        <button class="btn primary huge" type="button" data-testid="new-video" @click="newVideo">
          <AppIcon name="plus" :size="30" />
          Hacer un vídeo nuevo
          <KeyHint k="Intro" />
        </button>

        <section v-if="store.autosave.value" class="resume card" data-testid="resume-card">
          <div class="resume-text">
            <h2>Tienes un vídeo sin terminar</h2>
            <p class="muted">
              {{ store.autosave.value.clipCount }} {{ store.autosave.value.clipCount === 1 ? 'trozo' : 'trozos' }} · dura
              {{ formatDuration(store.autosave.value.durationMs) }}
            </p>
          </div>
          <button class="btn large" type="button" data-testid="resume" @click="resume">
            <AppIcon name="arrow-right" />
            Seguir con este vídeo
          </button>
        </section>

        <button class="btn large secondary" type="button" data-testid="teleprompter" @click="store.go('teleprompter')">
          <AppIcon name="mic" />
          Grabarme leyendo un texto
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.home {
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  background:
    radial-gradient(1200px 500px at 50% -10%, #e6eef4 0%, transparent 70%),
    var(--bg);
}
.content {
  width: min(680px, calc(100% - 48px));
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: 40px 0;
}
.hero {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.logo {
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  border-radius: 20px;
  background: var(--accent);
  color: #fff;
  box-shadow: var(--shadow);
}
.hero h1 {
  font-size: 36px;
  font-weight: 700;
}
.hero p {
  font-size: 19px;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.huge {
  min-height: 84px;
  font-size: 24px;
  border-radius: 18px;
  gap: 14px;
}
.resume {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 22px;
  border-left: 6px solid var(--accent);
}
.resume-text {
  flex: 1;
  min-width: 0;
}
.resume h2 {
  font-size: 21px;
  margin-bottom: 4px;
}
.secondary {
  align-self: center;
  border-color: var(--border);
  background: transparent;
}
</style>
