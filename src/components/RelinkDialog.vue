<script setup lang="ts">
// «Buscarlo»: el fichero elegido para sustituir a uno que falta no cuadra con el de antes (dura distinto, otro
// tamaño de imagen, sin sonido…), o hay más que faltaban en la misma carpeta y están en la nueva. Se explica en
// llano y se puede aceptar igualmente (se puede deshacer). Intro = usarlo; Esc = cancelar.
import { computed, nextTick, ref, watch } from 'vue'
import { baseName } from '../domain'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { useShortcuts } from '../lib/use-shortcuts'
import { store } from '../store'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'

const offer = computed(() => store.relinkOffer.value)
const mismatched = computed(() => (offer.value?.main.mismatches.length ?? 0) > 0)
/** Los de la misma carpeta marcados (de serie, los que cuadran). */
const chosen = ref<string[]>([])
const useButton = ref<HTMLButtonElement | null>(null)

watch(offer, async (o) => {
  chosen.value = o ? o.siblings.filter((s) => s.mismatches.length === 0).map((s) => s.oldPath) : []
  if (o) {
    await nextTick()
    useButton.value?.focus()
  }
})

const total = computed(() => 1 + chosen.value.length)

function accept() {
  store.answerRelink(true, chosen.value)
}
function cancel() {
  store.answerRelink(false)
}
function another() {
  const old = offer.value?.main.oldPath
  store.answerRelink(false)
  if (old) void store.relink(old)
}

function where(uses: number): string {
  return uses <= 1 ? 'se usa en 1 sitio' : `se usa en ${uses} sitios`
}

useShortcuts({
  id: 'relink',
  title: 'Buscar un fichero',
  priority: LAYER_PRIORITY.dialog,
  modal: true,
  active: () => !!offer.value,
  shortcuts: () => [
    { id: 'relink-cancel', keys: ['Escape'], label: 'Esc', description: '«Cancelar»', run: cancel, inText: true },
    { id: 'relink-accept', keys: ['Enter'], label: 'Intro', description: mismatched.value ? '«Usarlo igualmente»' : '«Usarlos»', run: accept },
  ],
})
</script>

<template>
  <div v-if="offer" class="overlay" role="presentation">
    <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="relink-title" data-testid="relink-dialog">
      <h2 id="relink-title">
        <AppIcon :name="mismatched ? 'warning' : 'check'" />
        {{ mismatched ? `«${baseName(offer.main.newPath)}» no es igual que el de antes` : `He encontrado «${baseName(offer.main.newPath)}»` }}
      </h2>
      <p class="message">
        Lo has elegido para sustituir a «{{ baseName(offer.main.oldPath) }}», que {{ where(offer.main.uses) }}<template v-if="offer.main.uses > 1"> (se arreglan todos a la vez)</template>.
      </p>
      <ul v-if="mismatched" class="mismatches" data-testid="relink-mismatches">
        <li v-for="m in offer.main.mismatches" :key="m">{{ m }}</li>
      </ul>
      <p v-if="mismatched" class="muted">
        Si es el mismo vídeo guardado de otra manera, puedes usarlo igualmente: lo que no quepa se ajusta y se puede deshacer.
      </p>

      <section v-if="offer.siblings.length" class="siblings" data-testid="relink-siblings">
        <h3>También faltaban {{ offer.siblings.length === 1 ? 'este, que está' : 'estos, que están' }} en esa misma carpeta:</h3>
        <label v-for="s in offer.siblings" :key="s.oldPath" class="sibling" data-testid="relink-sibling">
          <input v-model="chosen" type="checkbox" :value="s.oldPath" :data-path="s.oldPath" />
          <span>
            <strong>{{ baseName(s.newPath) }}</strong>
            <span v-if="s.mismatches.length" class="warn-text"> · no es igual que el de antes: {{ s.mismatches.join(' ').toLowerCase() }}</span>
          </span>
        </label>
      </section>

      <div class="actions">
        <button class="btn" type="button" data-testid="relink-cancel" @click="cancel">
          <AppIcon name="back" />
          Cancelar
          <KeyHint k="Esc" />
        </button>
        <button class="btn" type="button" data-testid="relink-another" @click="another">
          <AppIcon name="folder" />
          Elegir otro
        </button>
        <button ref="useButton" class="btn primary" type="button" data-testid="relink-accept" @click="accept">
          <AppIcon name="check" />
          {{ mismatched ? 'Usarlo igualmente' : total > 1 ? `Usar los ${total}` : 'Usarlo' }}
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
  z-index: 60;
}
.dialog {
  width: min(620px, calc(100vw - 40px));
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 24px 26px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 21px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.message {
  font-size: 17px;
  overflow-wrap: anywhere;
}
.mismatches {
  margin: 0;
  padding: 10px 14px 10px 30px;
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--text);
  font-size: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.siblings {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}
.siblings h3 {
  font-size: 16px;
}
.sibling {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 16px;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.sibling input {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  flex: none;
}
.warn-text {
  color: var(--warn);
}
.actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}
</style>
