<script setup lang="ts">
// Cabecera de una fila de la vista de pistas (columna fija a la izquierda): su nombre (se cambia pulsándolo),
// «Silenciar» (sonido y fila «Vídeo») u «Ocultar» (efectos), con el estado bien visible, «Escuchar solo esta»
// (las de sonido y la fila «Vídeo») y «Quitar pista». Todo cabe en el alto de su fila (lo comprueban las e2e).
import { computed, nextTick, ref } from 'vue'
import { isSoloSound, type Track } from '../../domain'
import { store, tracks } from '../../store'
import AppIcon from '../AppIcon.vue'

const props = defineProps<{ track?: Track; main?: boolean; onTop?: boolean }>()

const off = computed(() => (props.main ? store.project.value.mainMuted : props.track?.kind === 'sound' ? props.track.muted : !!props.track?.hidden))
const isSound = computed(() => props.main || props.track?.kind === 'sound')
const toggleLabel = computed(() => (isSound.value ? (off.value ? 'Silenciada' : 'Silenciar') : off.value ? 'Oculta' : 'Ocultar'))
const toggleTitle = computed(() =>
  isSound.value ? (off.value ? 'No se oye: pulsa para que vuelva a sonar' : 'Que no se oiga esta fila') : off.value ? 'No se ve: pulsa para que vuelva a verse' : 'Que no se vea esta fila',
)

/** La fila de sonido a la que se refiere (la fila «Vídeo» o una pista de sonido). */
const soundRow = computed(() => (props.main ? 'main' : props.track?.kind === 'sound' ? props.track.id : null))
/** «Solo esta» tiene sentido si hay alguna otra fila que suene (o pueda sonar). */
const canSolo = computed(() => soundRow.value !== null && (!props.main || store.project.value.tracks.some((t) => t.kind === 'sound')))
const solo = computed(() => soundRow.value !== null && isSoloSound(store.project.value, soundRow.value))
const soloTitle = computed(() => (solo.value ? 'Solo se oye esta fila: pulsa para que vuelva a sonar todo' : 'Escuchar solo esta fila (silencia las demás)'))

function toggle() {
  if (props.main) tracks.setMainMuted(!store.project.value.mainMuted)
  else if (props.track?.kind === 'sound') tracks.setTrackMuted(props.track.id, !props.track.muted)
  else if (props.track) tracks.setTrackHidden(props.track.id, !props.track.hidden)
}

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)
async function startRename() {
  if (!props.track) return
  draft.value = props.track.name
  editing.value = true
  await nextTick()
  input.value?.select()
}
function finishRename(save: boolean) {
  if (!editing.value) return
  editing.value = false
  if (save && props.track && draft.value.trim() !== '') tracks.renameTrack(props.track.id, draft.value)
}
</script>

<template>
  <div class="track-header" :class="{ main, off, effect: track?.kind === 'effect' }" :data-testid="main ? 'main-header' : 'track-header'" :data-track-id="track?.id">
    <div class="name-line">
      <AppIcon :name="main ? 'film' : track?.kind === 'sound' ? 'sound' : 'light'" :size="18" />
      <input
        v-if="editing"
        ref="input"
        v-model="draft"
        class="rename"
        maxlength="40"
        aria-label="Nombre de la pista"
        data-testid="track-rename-input"
        @keydown.enter.prevent="finishRename(true)"
        @keydown.esc.prevent.stop="finishRename(false)"
        @blur="finishRename(true)"
      />
      <span v-else-if="main" class="name">Vídeo</span>
      <button v-else class="name as-button" type="button" title="Cambiar el nombre" data-testid="track-name" @click="startRename">{{ track?.name }}</button>
      <span v-if="onTop" class="on-top" title="Lo de esta fila se ve por encima de lo de las de debajo">encima</span>
    </div>
    <div class="actions">
      <button
        class="mini"
        :class="{ on: off }"
        type="button"
        :aria-pressed="off"
        :title="toggleTitle"
        :aria-label="toggleLabel"
        :data-testid="main ? 'main-mute' : 'track-toggle'"
        @click="toggle"
      >
        <AppIcon :name="isSound ? (off ? 'mute' : 'sound') : off ? 'eye-off' : 'eye'" :size="18" />
        <span class="txt">{{ toggleLabel }}</span>
      </button>
      <button
        v-if="soundRow !== null && canSolo"
        class="mini solo"
        :class="{ on: solo }"
        type="button"
        :aria-pressed="solo"
        aria-label="Escuchar solo esta"
        :title="soloTitle"
        :data-testid="main ? 'main-solo' : 'track-solo'"
        @click="tracks.toggleSolo(soundRow!)"
      >
        <AppIcon name="headphones" :size="18" />
      </button>
      <button v-if="track" class="mini remove" type="button" aria-label="Quitar pista" title="Quitar pista" data-testid="track-remove" @click="tracks.removeTrack(track.id)">
        <AppIcon name="trash" :size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.track-header {
  position: sticky;
  left: 0;
  z-index: 6;
  box-sizing: border-box;
  height: var(--row);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 2px 8px 2px 10px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  min-width: 0;
  /* Por si acaso: nada se sale de su fila (se dibuja encima de la siguiente). */
  overflow: hidden;
  container-type: inline-size;
}
.track-header.main {
  height: var(--video-row);
  background: #e6ebf0;
}
.track-header.off {
  background: var(--surface-sunken);
}
.name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 19px;
  color: #3c8f9b;
}
.effect .name-line {
  color: #7b56b0;
}
.main .name-line {
  color: var(--accent);
}
.name {
  font-weight: 650;
  font-size: 15px;
  line-height: 19px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.as-button {
  border: none;
  background: none;
  padding: 0;
  cursor: text;
  text-align: left;
}
.as-button:hover {
  text-decoration: underline dotted;
}
.rename {
  flex: 1;
  min-width: 0;
  height: 19px;
  font: inherit;
  font-size: 14px;
  padding: 0 6px;
  border: 1.5px solid var(--accent);
  border-radius: 6px;
}
.on-top {
  flex: none;
  padding: 0 6px;
  border-radius: 6px;
  background: #ece3f7;
  color: #6b3fa0;
  font-size: 12px;
  line-height: 17px;
  font-weight: 650;
}
.actions {
  display: flex;
  gap: 4px;
  min-width: 0;
}
.mini {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  height: 24px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.mini:hover {
  border-color: var(--text-muted);
}
.mini.on {
  background: var(--warn-soft);
  border-color: var(--warn);
  color: var(--warn);
}
.mini.solo {
  padding: 0 5px;
  color: var(--text-muted);
}
.mini.solo.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-hover);
}
.mini.remove {
  margin-left: auto;
  padding: 0 5px;
  color: var(--text-muted);
}
.mini.remove:hover {
  color: var(--bad);
  border-color: var(--bad);
}
/* Cabecera estrecha: el botón de silenciar u ocultar se queda en icono (el estado sigue en su color). */
@container (max-width: 170px) {
  .mini .txt {
    display: none;
  }
}
@media (max-height: 860px) {
  .track-header {
    gap: 0;
  }
  .name-line {
    height: 17px;
  }
  .name {
    font-size: 14px;
    line-height: 17px;
  }
  .rename {
    height: 17px;
  }
  .mini {
    height: 22px;
  }
}
</style>
