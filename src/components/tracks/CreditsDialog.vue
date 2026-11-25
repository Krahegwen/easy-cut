<script setup lang="ts">
// «Créditos de la biblioteca»: quién ha hecho cada cosa que pide que se le nombre, y la nota de lo propio.
import { computed, ref } from 'vue'
import { creditsText, libraryCredits, libraryThanks } from '../../domain'
import { copyText } from '../../lib/clipboard'
import { LAYER_PRIORITY } from '../../lib/shortcuts'
import { useShortcuts } from '../../lib/use-shortcuts'
import { library } from '../../store'
import AppIcon from '../AppIcon.vue'
import KeyHint from '../KeyHint.vue'

const emit = defineEmits<{ close: [] }>()
const credits = computed(() => libraryCredits(library.catalog.value))
const own = computed(() => library.catalog.value.assets.filter((a) => a.license === 'own').length)
/** Lo de otras personas en dominio público: no hace falta nombrarlas, pero se les agradece aquí. */
const thanks = computed(() => libraryThanks(library.catalog.value))
const copied = ref(false)

async function copy() {
  copied.value = await copyText(creditsText(credits.value))
}

useShortcuts({
  id: 'library-credits',
  title: 'Créditos de la biblioteca',
  priority: LAYER_PRIORITY.dialog,
  modal: true,
  shortcuts: () => [{ id: 'credits-close', keys: ['Escape', 'Enter'], label: 'Esc', description: 'cerrar', run: () => emit('close') }],
})
</script>

<template>
  <div class="overlay" role="presentation" @click.self="emit('close')">
    <div class="dialog card" role="dialog" aria-modal="true" aria-label="Créditos de la biblioteca" data-testid="credits-dialog">
      <h2>Créditos de la biblioteca</h2>
      <p>
        {{ own }} de los sonidos y efectos los ha hecho el proyecto Easy Cut y se pueden usar libremente, sin nombrar a nadie
        (dominio público, CC0).
      </p>
      <template v-if="credits.length">
        <p>Estos son de otras personas y piden que se las nombre si se usan:</p>
        <ul class="list">
          <li v-for="c in credits" :key="c.assetId"><strong>{{ c.name }}</strong>: {{ c.text }}</li>
        </ul>
      </template>
      <p v-else class="muted">Por ahora no hay nada de otras personas que pida que se las nombre.</p>
      <template v-if="thanks.length">
        <h3>Gracias a</h3>
        <p>
          Estos {{ thanks.length }} los han hecho otras personas y los han regalado al dominio público (CC0): se pueden usar
          sin nombrar a nadie, pero aquí queda de dónde sale cada uno.
        </p>
        <ul class="list thanks" data-testid="credits-thanks">
          <li v-for="c in thanks" :key="c.assetId"><strong>{{ c.name }}</strong>: {{ c.text }}</li>
        </ul>
      </template>
      <div class="actions">
        <button v-if="credits.length" class="btn" type="button" @click="copy">
          <AppIcon :name="copied ? 'check' : 'copy'" />
          {{ copied ? 'Copiados' : 'Copiar los créditos' }}
        </button>
        <button class="btn primary" type="button" data-testid="credits-close" @click="emit('close')">
          <AppIcon name="check" />
          Entendido
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
  z-index: 50;
  padding: 24px;
}
.dialog {
  width: min(620px, 100%);
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px 26px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-lg);
  font-size: 16px;
}
h2 {
  font-size: 22px;
}
h3 {
  font-size: 18px;
  margin-top: 6px;
}
.thanks {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.list {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}
</style>
