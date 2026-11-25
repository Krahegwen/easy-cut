<script setup lang="ts">
// Cabecera de una fila de la vista de pistas (columna fija a la izquierda): su nombre (se cambia pulsándolo),
// «Silenciar» (sonido y fila «Vídeo») u «Ocultar» (efectos), con el estado bien visible, y «Quitar pista».
import { computed, nextTick, ref } from 'vue'
import type { Track } from '../../domain'
import { store, tracks } from '../../store'
import AppIcon from '../AppIcon.vue'

const props = defineProps<{ track?: Track; main?: boolean; onTop?: boolean }>()

const off = computed(() => (props.main ? store.project.value.mainMuted : props.track?.kind === 'sound' ? props.track.muted : !!props.track?.hidden))
const isSound = computed(() => props.main || props.track?.kind === 'sound')
const toggleLabel = computed(() => (isSound.value ? (off.value ? 'Silenciada' : 'Silenciar') : off.value ? 'Oculta' : 'Ocultar'))
const toggleTitle = computed(() =>
  isSound.value ? (off.value ? 'No se oye: pulsa para que vuelva a sonar' : 'Que no se oiga esta fila') : off.value ? 'No se ve: pulsa para que vuelva a verse' : 'Que no se vea esta fila',
)

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
        :data-testid="main ? 'main-mute' : 'track-toggle'"
        @click="toggle"
      >
        <AppIcon :name="isSound ? (off ? 'mute' : 'sound') : off ? 'eye-off' : 'eye'" :size="18" />
        {{ toggleLabel }}
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
  height: var(--row);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding: 2px 8px 2px 10px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  min-width: 0;
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
  font: inherit;
  font-size: 15px;
  padding: 1px 6px;
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
  font-weight: 650;
}
.actions {
  display: flex;
  gap: 4px;
}
.mini {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
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
.mini.remove {
  margin-left: auto;
  padding: 0 6px;
  color: var(--text-muted);
}
.mini.remove:hover {
  color: var(--bad);
  border-color: var(--bad);
}
@media (max-height: 860px) {
  .track-header {
    gap: 0;
  }
  .mini {
    height: 22px;
  }
  .name,
  .rename {
    font-size: 14px;
  }
}
</style>
