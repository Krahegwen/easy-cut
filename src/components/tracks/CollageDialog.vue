<script setup lang="ts">
// «Collage»: cuántos vídeos (2, 3 o 4) y, si ese número tiene más de un reparto, cómo se reparten (los dibujitos de
// cada plantilla). Con 4 son siempre los cuatro cuadrantes: no se pregunta. El collage se pone donde está la línea,
// queda elegido y en «Huecos» para ir poniendo los vídeos.
import { computed, ref } from 'vue'
import { ASPECT_VALUES, COLLAGE_COUNTS, layoutHasChoice, layoutsFor } from '../../domain'
import { LAYER_PRIORITY } from '../../lib/shortcuts'
import { useShortcuts } from '../../lib/use-shortcuts'
import { store, tracks } from '../../store'
import AppIcon from '../AppIcon.vue'
import KeyHint from '../KeyHint.vue'
import LayoutIcon from '../LayoutIcon.vue'

const emit = defineEmits<{ close: [] }>()

const count = ref<number | null>(null)
const choices = computed(() => (count.value ? layoutsFor(count.value) : []))
const aspect = computed(() => ASPECT_VALUES[store.project.value.aspect])

function pickCount(n: number) {
  if (!layoutHasChoice(n)) {
    create(layoutsFor(n)[0]!.id)
    return
  }
  count.value = n
}

function create(layoutId: string) {
  emit('close')
  tracks.createCollage(layoutId, tracks.playheadMs.value)
}

function close() {
  emit('close')
}

useShortcuts({
  id: 'collage-dialog',
  title: 'Hacer un collage',
  priority: LAYER_PRIORITY.dialog,
  modal: true,
  active: () => true,
  shortcuts: () => [
    ...(count.value === null
      ? COLLAGE_COUNTS.map((n) => ({ id: `collage-count-${n}`, keys: [String(n)], label: String(n), description: `${n} vídeos`, run: () => pickCount(n) }))
      : choices.value.map((l, i) => ({ id: `collage-layout-${i + 1}`, keys: [String(i + 1)], label: String(i + 1), description: `«${l.name}»`, run: () => create(l.id) }))),
    ...(count.value !== null ? [{ id: 'collage-back', keys: ['Backspace'], label: '⌫', description: 'volver a «¿Cuántos vídeos?»', run: () => (count.value = null) }] : []),
    { id: 'collage-close', keys: ['Escape'], label: 'Esc', description: 'cancelar', run: close },
  ],
})
</script>

<template>
  <div class="overlay" role="presentation" @pointerdown.self="close">
    <div class="dialog card" role="dialog" aria-modal="true" aria-label="Hacer un collage" data-testid="collage-dialog" :data-step="count === null ? 'count' : 'layout'">
      <header>
        <h2>{{ count === null ? '¿Cuántos vídeos van en el collage?' : '¿Cómo los repartimos?' }}</h2>
        <button class="close" type="button" aria-label="Cancelar" data-testid="collage-cancel" @click="close">
          <AppIcon name="close" :size="20" />
          <KeyHint k="Esc" />
        </button>
      </header>
      <p class="muted lead">
        {{ count === null ? 'Se verán a la vez, cada uno en su hueco, donde está la línea. Luego pones los vídeos en los huecos.' : `${count} vídeos a la vez. Elige cómo se reparten (luego se puede cambiar).` }}
      </p>

      <div v-if="count === null" class="counts">
        <button v-for="n in COLLAGE_COUNTS" :key="n" class="choice" type="button" :data-testid="`collage-count-${n}`" @click="pickCount(n)">
          <LayoutIcon :layout-id="layoutsFor(n)[0]!.id" :aspect="aspect" :width="120" />
          <strong>{{ n }} vídeos</strong>
          <span v-if="!layoutHasChoice(n)" class="muted small">En cuatro cuadrantes</span>
          <KeyHint :k="String(n)" />
        </button>
      </div>

      <div v-else class="layouts" :class="`n${choices.length}`">
        <button v-for="(l, i) in choices" :key="l.id" class="choice" type="button" :data-testid="`collage-layout-${l.id}`" @click="create(l.id)">
          <LayoutIcon :layout-id="l.id" :aspect="aspect" :width="120" numbers />
          <strong>{{ l.name }}</strong>
          <KeyHint :k="String(i + 1)" />
        </button>
      </div>

      <footer v-if="count !== null">
        <button class="btn quiet" type="button" data-testid="collage-back" @click="count = null">
          <AppIcon name="back" />
          Otro número
          <KeyHint k="⌫" />
        </button>
      </footer>
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
  z-index: 50;
  padding: 24px;
}
.dialog {
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 22px 24px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
header {
  display: flex;
  align-items: center;
  gap: 10px;
}
h2 {
  flex: 1;
  font-size: 22px;
}
.lead {
  margin: 0;
  font-size: 16px;
}
.close {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.counts,
.layouts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.layouts.n2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 10px 10px;
  border-radius: 12px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  text-align: center;
  font-size: 15px;
}
.choice:hover,
.choice:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.choice strong {
  font-size: 16px;
  line-height: 1.2;
}
.small {
  font-size: 13px;
}
footer {
  display: flex;
}
</style>
