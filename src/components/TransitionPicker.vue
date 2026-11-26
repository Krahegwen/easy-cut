<script setup lang="ts">
// «Cómo se pasa al trozo N»: el desplegable de la transición de entrada de un trozo. Cada tipo con su dibujito y su
// frase llana, tres duraciones, en a negro / a blanco si se monta sobre el anterior (acorta el vídeo) o no, y lo que
// acorta el vídeo dicho en vivo. Lo elegido se ve ya en la vista previa y en las pistas (provisional, sin entrar en
// el historial); «Probar» lo reproduce de 2 s antes a 2 s después; «Poner» lo deja (un paso de deshacer); «Corte
// seco» lo quita; Esc lo deja como estaba. Todas van «Al mismo ritmo» (no hay curva que elegir).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  clipTimeline,
  describeEntry,
  formatDuration,
  formatTransitionSeconds,
  isDip,
  makeEntry,
  setTransition,
  TRANSITION_DURATIONS,
  TRANSITION_KINDS,
  TRANSITION_LABELS,
  type ClipEntry,
  type TransitionKind,
} from '../domain'
import { FADE_LENGTH_LABELS, FADE_LENGTHS, type FadeLength } from '../domain'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { useShortcuts } from '../lib/use-shortcuts'
import { store } from '../store'
import AppIcon from './AppIcon.vue'
import KeyHint from './KeyHint.vue'
import TransitionIcon from './TransitionIcon.vue'

const props = defineProps<{ clipId: string }>()
const emit = defineEmits<{ close: []; try: [fromMs: number, toMs: number] }>()

const base = computed(() => store.history.value.present)
const index = computed(() => base.value.clips.findIndex((c) => c.id === props.clipId))
const draft = ref<ClipEntry | null>(base.value.clips[index.value]?.entry ?? null)

// Lo elegido se ve al momento (provisional): en la vista previa y en las pistas.
watch(
  draft,
  (entry) => {
    const id = props.clipId
    store.preview((p) => setTransition(p, id, entry))
  },
  { immediate: true },
)

/** El paso de verdad con lo elegido (ya limitado a lo que cabe) y lo que dura el vídeo con él y sin él. */
const live = computed(() => {
  const i = index.value
  const withIt = clipTimeline(store.project.value)
  const without = clipTimeline(setTransition(base.value, props.clipId, null))
  return { join: withIt.joins[i] ?? null, totalMs: withIt.totalMs, beforeMs: without.totalMs, start: withIt.starts[i] ?? 0 }
})

/** Lo que acortaría el vídeo montando a negro / a blanco sobre el anterior (para el interruptor). */
const overlapCut = computed(() => {
  const d = draft.value
  if (!d || !isDip(d.kind)) return 0
  const t = clipTimeline(setTransition(base.value, props.clipId, { ...d, overlap: true }))
  return t.overlaps[index.value] ?? 0
})

const lengthOf = (ms: number): FadeLength | null => FADE_LENGTHS.find((l) => TRANSITION_DURATIONS[l] === ms) ?? null

function pickKind(kind: TransitionKind | null) {
  if (!kind) {
    draft.value = null
    return
  }
  const d = draft.value
  // A negro / a blanco, de serie sin solape (la duración no cambia); si ya era uno de los dos, se queda como estaba.
  const overlap = isDip(kind) ? (d && isDip(d.kind) ? d.overlap : false) : true
  draft.value = makeEntry(kind, d?.durationMs ?? TRANSITION_DURATIONS.medium, overlap)
}

function pickLength(length: FadeLength) {
  const d = draft.value
  if (d) draft.value = makeEntry(d.kind, TRANSITION_DURATIONS[length], d.overlap)
}

function stepLength(dir: -1 | 1) {
  const d = draft.value
  if (!d) return
  const now = lengthOf(d.durationMs)
  const i = now ? FADE_LENGTHS.indexOf(now) : dir > 0 ? -1 : FADE_LENGTHS.length
  const next = FADE_LENGTHS[Math.min(FADE_LENGTHS.length - 1, Math.max(0, i + dir))]!
  pickLength(next)
}

function toggleOverlap() {
  const d = draft.value
  if (d && isDip(d.kind)) draft.value = makeEntry(d.kind, d.durationMs, !d.overlap)
}

/** «Probar»: de 2 s antes del paso a 2 s después. */
function tryIt() {
  const j = live.value.join
  const s = live.value.start
  if (j) emit('try', (j.overlap ? s : s - j.tail) - 2000, (j.overlap ? s + j.overlapUnits : s + j.head) + 2000)
  else emit('try', s - 2000, s + 2000)
}

let done = false
function put() {
  const i = index.value
  const d = draft.value
  const before = live.value.beforeMs
  const after = live.value.totalMs
  done = true
  store.commitPreview()
  emit('close')
  if (!d) {
    store.showToast(`Del trozo ${i} al ${i + 1}: corte seco.`, { label: 'Deshacer', run: store.undo })
    return
  }
  const what = describeEntry(d, live.value.join?.duration)
  const len = after < before - 1 ? `el vídeo dura ahora ${formatDuration(after)} (${formatTransitionSeconds(before - after)} menos)` : 'el vídeo dura lo mismo'
  store.showToast(`${what} del trozo ${i} al ${i + 1}: ${len}.`, { label: 'Deshacer', run: store.undo })
}

function cut() {
  draft.value = null
  put()
}

function close() {
  done = true
  store.cancelPreview()
  emit('close')
}

onBeforeUnmount(() => {
  if (!done) store.cancelPreview()
})

defineExpose({ close, put })

const kindKeys = TRANSITION_KINDS.map((k, i) => ({ kind: k, key: String(i + 1) }))

useShortcuts({
  id: 'transition-picker',
  title: 'Cómo se pasa al siguiente trozo',
  priority: LAYER_PRIORITY.popover,
  modal: true,
  active: () => true,
  shortcuts: () => [
    ...kindKeys.map(({ kind, key }) => ({ id: `transition-${kind}`, keys: [key], label: key, description: `«${TRANSITION_LABELS[kind].label}»`, run: () => pickKind(kind) })),
    { id: 'transition-cut-pick', keys: ['7'], label: '7', description: '«Corte seco»', run: () => pickKind(null) },
    { id: 'transition-shorter', keys: ['ArrowLeft'], label: '←', description: 'más corto', run: () => stepLength(-1), enabled: !!draft.value },
    { id: 'transition-longer', keys: ['ArrowRight'], label: '→', description: 'más largo', run: () => stepLength(1), enabled: !!draft.value },
    { id: 'transition-overlap', keys: ['m'], label: 'M', description: 'montar sobre el anterior o no (a negro y a blanco)', run: toggleOverlap, enabled: !!draft.value && isDip(draft.value.kind) },
    { id: 'transition-try', keys: ['Space'], label: 'Espacio', description: '«Probar» (de 2 s antes a 2 s después)', run: tryIt },
    { id: 'transition-put', keys: ['Enter'], label: 'Intro', description: '«Poner»', run: put },
    { id: 'transition-cut', keys: ['Delete'], label: 'Supr', description: '«Corte seco» (quitar la transición)', run: cut },
    { id: 'transition-close', keys: ['Escape'], label: 'Esc', description: 'cerrar sin cambiar nada', run: close },
  ],
})

const summary = computed(() => {
  const d = draft.value
  const j = live.value.join
  if (!d) return 'Un trozo justo detrás del otro, sin transición. La duración del vídeo no cambia.'
  if (!j) return 'Aquí no cabe: los trozos son demasiado cortos. Se quedará en corte seco.'
  const shrunk = j.shrunk ? ` Solo cabe ${formatTransitionSeconds(j.duration)} (has pedido ${formatTransitionSeconds(d.durationMs)}).` : ''
  if (!j.overlap) return `El trozo ${index.value} se va ${d.kind === 'dip-white' ? 'a blanco' : 'a negro'} y el ${index.value + 1} sale de ahí. La duración del vídeo no cambia.${shrunk}`
  return `El trozo ${index.value + 1} se monta sobre el anterior: el vídeo se acorta ${formatTransitionSeconds(live.value.beforeMs - live.value.totalMs)} (de ${formatDuration(live.value.beforeMs)} a ${formatDuration(live.value.totalMs)}).${shrunk}`
})
</script>

<template>
  <div class="transition-picker card" role="dialog" :aria-label="`Cómo se pasa al trozo ${index + 1}`" data-testid="transition-picker" :data-draft="draft ? `${draft.kind}:${draft.durationMs}:${draft.overlap ? 1 : 0}` : 'cut'">
    <header>
      <h3>Cómo se pasa al trozo {{ index + 1 }}</h3>
      <button class="close" type="button" aria-label="Cerrar sin cambiar nada" data-testid="transition-close" @click="close">
        <AppIcon name="close" :size="20" />
        <KeyHint k="Esc" />
      </button>
    </header>
    <div class="kinds" role="radiogroup" aria-label="Tipo de transición">
      <button
        v-for="{ kind, key } in kindKeys"
        :key="kind"
        class="kind"
        :class="{ on: draft?.kind === kind }"
        type="button"
        role="radio"
        :aria-checked="draft?.kind === kind"
        :data-testid="`transition-kind-${kind}`"
        @click="pickKind(kind)"
      >
        <TransitionIcon :kind="kind" />
        <span class="text">
          <strong>{{ TRANSITION_LABELS[kind].label }}</strong>
          <span>{{ TRANSITION_LABELS[kind].hint }}</span>
        </span>
        <KeyHint :k="key" />
      </button>
      <button class="kind" :class="{ on: !draft }" type="button" role="radio" :aria-checked="!draft" data-testid="transition-kind-cut" @click="pickKind(null)">
        <TransitionIcon kind="cut" />
        <span class="text">
          <strong>Corte seco</strong>
          <span>Un trozo justo detrás del otro</span>
        </span>
        <KeyHint k="7" />
      </button>
    </div>
    <div class="row">
      <div class="lengths" role="radiogroup" aria-label="Cuánto dura">
        <button
          v-for="l in FADE_LENGTHS"
          :key="l"
          class="length"
          :class="{ on: !!draft && lengthOf(draft.durationMs) === l }"
          type="button"
          role="radio"
          :aria-checked="!!draft && lengthOf(draft.durationMs) === l"
          :disabled="!draft"
          :data-testid="`transition-len-${l}`"
          @click="pickLength(l)"
        >
          {{ FADE_LENGTH_LABELS[l] }} <span class="secs">{{ formatTransitionSeconds(TRANSITION_DURATIONS[l]) }}</span>
        </button>
        <span v-if="draft" class="arrows"><KeyHint k="←" /><KeyHint k="→" /></span>
      </div>
      <label v-if="draft && isDip(draft.kind)" class="overlap" data-testid="transition-overlap">
        <input type="checkbox" :checked="draft.overlap" @change="toggleOverlap" />
        <span>Montar sobre el anterior <span class="muted">(acorta el vídeo {{ formatTransitionSeconds(overlapCut) }})</span></span>
        <KeyHint k="M" />
      </label>
    </div>
    <p class="summary" role="status" data-testid="transition-summary">{{ summary }}</p>
    <footer>
      <button class="btn" type="button" data-testid="transition-try" @click="tryIt">
        <AppIcon name="play" />
        Probar
        <KeyHint k="Espacio" />
      </button>
      <span class="spacer" />
      <button class="btn" type="button" data-testid="transition-cut" @click="cut">
        <AppIcon name="scissors" />
        Corte seco
        <KeyHint k="Supr" />
      </button>
      <button class="btn primary" type="button" data-testid="transition-put" @click="put">
        <AppIcon name="check" />
        Poner
        <KeyHint k="Intro" />
      </button>
    </footer>
  </div>
</template>

<style scoped>
.transition-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  box-shadow: var(--shadow-lg);
}
header {
  display: flex;
  align-items: center;
  gap: 10px;
}
h3 {
  flex: 1;
  font-size: 18px;
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
.close:hover {
  background: var(--surface-2, rgb(0 0 0 / 0.05));
}
.kinds {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.kind {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 5px 10px;
  border-radius: 10px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
}
.kind .text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--text);
}
.kind strong {
  font-size: 15px;
}
.kind .text span {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.2;
}
.kind.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
  color: var(--accent);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
}
.lengths {
  display: flex;
  align-items: center;
  gap: 5px;
}
.length {
  min-height: 44px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.length .secs {
  font-weight: 400;
  color: var(--text-muted);
}
.length.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.length:disabled {
  opacity: 0.45;
  cursor: default;
}
.arrows {
  display: inline-flex;
  gap: 3px;
}
.overlap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 15px;
  cursor: pointer;
}
.overlap input {
  width: 20px;
  height: 20px;
}
.summary {
  margin: 0;
  font-size: 15px;
  line-height: 1.35;
}
footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.spacer {
  flex: 1;
}
</style>
