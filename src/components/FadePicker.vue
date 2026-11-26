<script setup lang="ts">
// «Aparecer y desaparecer»: cómo entra y cómo sale algo (un sonido, un efecto o un trozo). Para cada lado, la
// forma (con su dibujito) en palabras llanas —«De golpe», «Suave», «Empieza despacio», «Acaba despacio», «Al
// mismo ritmo»— y tres duraciones con sus segundos. Lo mismo para todo; solo cambia la frase de qué le pasa.
import { computed } from 'vue'
import { EASING_LABELS, EASINGS, FADE_DURATIONS, FADE_LENGTH_LABELS, FADE_LENGTHS, fadeLengthOf, type Easing, type FadeLength, type Fades } from '../domain'
import CurveIcon from './CurveIcon.vue'

export type FadeSubject = 'sound' | 'effect' | 'light' | 'clip'

const props = defineProps<{ fades: Fades; subject: FadeSubject }>()
const emit = defineEmits<{ change: [which: 'in' | 'out', fade: { ms: number; easing: Easing }] }>()

const WHAT: Record<FadeSubject, { in: string; out: string }> = {
  sound: { in: 'El volumen sube desde el silencio.', out: 'El volumen baja hasta el silencio.' },
  effect: { in: 'Se va haciendo visible.', out: 'Se va haciendo transparente hasta desaparecer.' },
  light: { in: 'La luz se enciende poco a poco.', out: 'La luz se apaga poco a poco.' },
  clip: { in: 'La imagen sale del negro y el sonido, del silencio.', out: 'La imagen se va a negro y el sonido, al silencio.' },
}

function seconds(ms: number): string {
  const s = ms / 1000
  return `${Number.isInteger(s) ? s : s.toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`
}

const sides = computed(() =>
  (['in', 'out'] as const).map((which) => {
    const ms = which === 'in' ? props.fades.fadeInMs : props.fades.fadeOutMs
    const easing = which === 'in' ? props.fades.fadeInEasing : props.fades.fadeOutEasing
    return { which, ms, easing, length: fadeLengthOf(ms), title: which === 'in' ? 'Al aparecer' : 'Al desaparecer', what: WHAT[props.subject][which] }
  }),
)

function pickShape(which: 'in' | 'out', easing: Easing | 'none') {
  const side = sides.value.find((s) => s.which === which)!
  if (easing === 'none') emit('change', which, { ms: 0, easing: side.easing })
  // Al elegir una forma estando «De golpe», la duración del medio.
  else emit('change', which, { ms: side.ms > 0 ? side.ms : FADE_DURATIONS.medium, easing })
}

function pickLength(which: 'in' | 'out', length: FadeLength) {
  const side = sides.value.find((s) => s.which === which)!
  emit('change', which, { ms: FADE_DURATIONS[length], easing: side.easing })
}
</script>

<template>
  <div class="fade-picker" data-testid="fade-picker">
    <section v-for="side in sides" :key="side.which" class="side" :data-testid="`fade-${side.which}`">
      <h3>{{ side.title }}</h3>
      <p class="what">{{ side.what }}</p>
      <div class="shapes" role="radiogroup" :aria-label="`${side.title}: cómo`">
        <button
          class="shape"
          :class="{ on: side.ms === 0 }"
          type="button"
          role="radio"
          :aria-checked="side.ms === 0"
          :data-testid="`fade-${side.which}-none`"
          @click="pickShape(side.which, 'none')"
        >
          <CurveIcon easing="none" :falling="side.which === 'out'" />
          <span class="text">
            <strong>De golpe</strong>
            <span>{{ side.which === 'in' ? 'Aparece' : 'Desaparece' }} de una vez</span>
          </span>
        </button>
        <button
          v-for="e in EASINGS"
          :key="e"
          class="shape"
          :class="{ on: side.ms > 0 && side.easing === e }"
          type="button"
          role="radio"
          :aria-checked="side.ms > 0 && side.easing === e"
          :data-testid="`fade-${side.which}-${e}`"
          @click="pickShape(side.which, e)"
        >
          <CurveIcon :easing="e" :falling="side.which === 'out'" />
          <span class="text">
            <strong>{{ EASING_LABELS[e].label }}</strong>
            <span>{{ EASING_LABELS[e].hint }}</span>
          </span>
        </button>
      </div>
      <div class="lengths" role="radiogroup" :aria-label="`${side.title}: cuánto dura`">
        <button
          v-for="l in FADE_LENGTHS"
          :key="l"
          class="length"
          :class="{ on: side.ms > 0 && side.length === l }"
          type="button"
          role="radio"
          :aria-checked="side.ms > 0 && side.length === l"
          :disabled="side.ms === 0"
          :data-testid="`fade-${side.which}-len-${l}`"
          @click="pickLength(side.which, l)"
        >
          {{ FADE_LENGTH_LABELS[l] }} <span class="secs">{{ seconds(FADE_DURATIONS[l]) }}</span>
        </button>
      </div>
      <p v-if="side.ms > 0 && !side.length" class="other muted" :data-testid="`fade-${side.which}-other`">Ahora dura {{ seconds(side.ms) }}.</p>
    </section>
  </div>
</template>

<style scoped>
.fade-picker {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
h3 {
  font-size: 17px;
}
.what {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.3;
  margin: 0;
}
.shapes {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.shape {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  min-height: 44px;
  border-radius: 10px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
}
.shape .text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--text);
}
.shape strong {
  font-size: 15px;
}
.shape .text span {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.2;
}
.shape.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
  color: var(--accent);
}
.lengths {
  display: flex;
  gap: 5px;
}
.length {
  flex: 1;
  min-height: 44px;
  padding: 0 6px;
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
.other {
  font-size: 13px;
  margin: 0;
}
</style>
