<script setup lang="ts">
// Panel «Teclas»: lo que hace cada tecla en la pantalla actual, en llano. Se abre con F1 o el botón «Teclas»
// y se cierra con Esc (o F1 otra vez).
import { computed } from 'vue'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { closeKeysPanel, keysPanelOpen, panelGroups, useShortcuts } from '../lib/use-shortcuts'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

useShortcuts({
  id: 'keys-panel',
  title: 'Esta lista',
  priority: LAYER_PRIORITY.panel,
  modal: true,
  active: () => keysPanelOpen.value,
  shortcuts: () => [
    { id: 'keys-close', keys: ['Escape', 'F1'], label: 'Esc', description: 'cerrar esta lista', run: closeKeysPanel, inText: true },
  ],
})

const groups = computed(() => (keysPanelOpen.value ? panelGroups() : []))

/** Los de la pantalla primero; «En toda la app» al final. */
const sorted = computed(() => [...groups.value].sort((a, b) => b.layer.priority - a.layer.priority))
</script>

<template>
  <div v-if="keysPanelOpen" class="overlay" data-testid="keys-panel" @click.self="closeKeysPanel">
    <div class="dialog card" role="dialog" aria-modal="true" aria-label="Teclas de esta pantalla">
      <div class="head">
        <AppIcon name="keyboard" :size="28" />
        <h2>Teclas de esta pantalla</h2>
      </div>
      <p class="intro muted">Pulsa una tecla en lugar del botón. No hace falta apretar otra a la vez (salvo Ctrl en las de copiar, pegar y deshacer).</p>
      <div class="groups" data-keys-list>
        <section v-for="g in sorted" :key="g.layer.id" class="group">
          <h3>{{ g.layer.title }}</h3>
          <ul>
            <li v-for="s in g.shortcuts" :key="s.id" :class="{ off: s.enabled === false }" :data-shortcut="s.id">
              <span class="keys"><KeyHint :k="s.label" /></span>
              <span class="what">{{ s.description }}<span v-if="s.enabled === false" class="now-not"> (ahora no)</span></span>
            </li>
          </ul>
        </section>
      </div>
      <div class="actions">
        <button class="btn primary" type="button" data-testid="keys-close" @click="closeKeysPanel">
          <AppIcon name="check" />
          Cerrar
          <KeyHint k="Esc" />
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
  z-index: 60;
  padding: 24px;
}
.dialog {
  width: min(720px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px 26px 20px;
  box-shadow: var(--shadow-lg);
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--accent);
}
.head h2 {
  font-size: 24px;
  color: var(--text);
}
.intro {
  font-size: 16px;
}
.groups {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.group h3 {
  font-size: 15px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-soft);
  margin-bottom: 6px;
}
/* Dos columnas que se leen de arriba abajo (como una lista), no a saltos de una a otra. */
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  columns: 2;
  column-gap: 20px;
}
li {
  break-inside: avoid;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  font-size: 16px;
}
li.off {
  opacity: 0.55;
}
.keys {
  flex: none;
  min-width: 64px;
  display: flex;
  justify-content: flex-end;
}
.keys :deep(.key-hint) {
  height: 24px;
  font-size: 13.5px;
  color: var(--text);
}
.what::first-letter {
  text-transform: uppercase;
}
.now-not {
  color: var(--text-soft);
}
.actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}
@media (max-height: 760px) {
  .dialog {
    padding: 18px 22px 16px;
    gap: 8px;
  }
  li {
    min-height: 28px;
    font-size: 15px;
  }
}
</style>
