<script setup lang="ts">
// «Tu vídeo»: vista previa del montaje, forma, duración máxima, la tira de trozos y «Guardar el vídeo».
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import type { IconName } from '../components/icons'
import ClipStrip from '../components/ClipStrip.vue'
import DurationBar from '../components/DurationBar.vue'
import PreviewPlayer from '../components/PreviewPlayer.vue'
import TargetPicker from '../components/TargetPicker.vue'
import UndoRedo from '../components/UndoRedo.vue'
import { clipStartTimes, setAspect, type AspectRatio } from '../domain'
import { pickAndAddVideos } from '../lib/add-videos'
import { setKeyHandler } from '../lib/keys'
import { store } from '../store'

const player = ref<InstanceType<typeof PreviewPlayer> | null>(null)

const shapes: { id: AspectRatio; icon: IconName; label: string; hint: string }[] = [
  { id: '16:9', icon: 'horizontal', label: 'Horizontal', hint: 'Para la tele y el ordenador' },
  { id: '9:16', icon: 'vertical', label: 'Vertical', hint: 'Para el móvil' },
  { id: '1:1', icon: 'square', label: 'Cuadrado', hint: 'Para redes sociales' },
]

const clip = computed(() => store.selectedClip.value)
const index = computed(() => store.selectedIndex.value)
const count = computed(() => store.project.value.clips.length)
const clipMissing = computed(() => !!clip.value && !!store.missing.value[clip.value.sourcePath])
const missingCount = computed(() => store.project.value.clips.filter((c) => store.missing.value[c.sourcePath]).length)

function setShape(a: AspectRatio) {
  store.apply((p) => setAspect(p, a))
}

function save() {
  if (store.hasMissing.value) {
    store.showToast('Antes de guardar, quita los trozos cuyo vídeo no encuentro.')
    return
  }
  player.value?.pause()
  store.go('save')
}

function fix() {
  if (!clip.value) return
  player.value?.pause()
  store.openClipEditor(clip.value.id)
}

// Al elegir un trozo, la vista previa salta a su principio (si no está sonando).
watch(
  () => store.selectedClipId.value,
  (id) => {
    if (!id || !player.value || player.value.playing) return
    const playable = store.playableProject.value
    const i = playable.clips.findIndex((c) => c.id === id)
    if (i >= 0) player.value.seek(clipStartTimes(playable)[i] ?? 0)
  },
)

onMounted(() => {
  setKeyHandler((e) => {
    const p = player.value
    if (!p) return false
    if (e.key === ' ') {
      p.toggle()
      return true
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      p.seek(p.currentMs + (e.key === 'ArrowLeft' ? -1000 : 1000))
      return true
    }
    return false
  })
})
onBeforeUnmount(() => setKeyHandler(null))
</script>

<template>
  <main class="screen editor" data-testid="editor">
    <header class="topbar">
      <button class="btn quiet" type="button" data-testid="go-home" @click="store.go('home')">
        <AppIcon name="home" />
        Inicio
      </button>
      <h1>Tu vídeo</h1>
      <span class="spacer" />
      <UndoRedo />
      <button class="btn primary large save" type="button" data-testid="save-video" :disabled="count === 0" @click="save">
        <AppIcon name="save" />
        Guardar el vídeo
      </button>
    </header>

    <DurationBar :total-ms="store.durationMs.value" :target-ms="store.project.value.targetDurationMs">
      <TargetPicker />
    </DurationBar>

    <div class="workspace">
      <section class="preview">
        <PreviewPlayer ref="player" :project="store.playableProject.value">
          <template #overlay>
            <div v-if="missingCount > 0" class="missing-banner">
              <AppIcon name="warning" />
              {{ missingCount === 1 ? 'Hay un trozo cuyo vídeo no encuentro: no sale aquí.' : `Hay ${missingCount} trozos cuyo vídeo no encuentro: no salen aquí.` }}
            </div>
          </template>
        </PreviewPlayer>
      </section>

      <aside class="side">
        <section class="panel">
          <h2>Forma del vídeo</h2>
          <div class="shapes" role="radiogroup" aria-label="Forma del vídeo">
            <button
              v-for="s in shapes"
              :key="s.id"
              class="shape"
              :class="{ selected: store.project.value.aspect === s.id }"
              type="button"
              role="radio"
              :aria-checked="store.project.value.aspect === s.id"
              :data-testid="`shape-${s.label.toLowerCase()}`"
              @click="setShape(s.id)"
            >
              <AppIcon :name="s.icon" :size="30" />
              <span class="shape-text">
                <strong>{{ s.label }}</strong>
                <span>{{ s.hint }}</span>
              </span>
            </button>
          </div>
        </section>

        <p class="tip muted">
          <AppIcon name="drag" :size="20" />
          Arrastra los trozos de abajo para cambiar el orden, o usa «Mover antes» y «Mover después».
        </p>
      </aside>
    </div>

    <footer class="strip-area">
      <div v-if="clip" class="clip-actions" data-testid="clip-panel">
        <h2>Trozo {{ index + 1 }} <span class="muted">de {{ count }}</span></h2>
        <template v-if="clipMissing">
          <p class="lost"><AppIcon name="warning" /> No encuentro este vídeo. Puede que se haya movido o borrado.</p>
          <span class="spacer" />
          <button class="btn danger" type="button" data-testid="remove-clip" @click="store.removeClip(clip.id)">
            <AppIcon name="trash" />
            Quitarlo del vídeo
          </button>
        </template>
        <template v-else>
          <button class="btn fix" type="button" data-testid="fix-clip" @click="fix">
            <AppIcon name="wrench" />
            Arreglar este trozo
          </button>
          <button class="btn" type="button" :disabled="index <= 0" data-testid="move-before" @click="store.moveBy(clip.id, -1)">
            <AppIcon name="arrow-left" />
            Mover antes
          </button>
          <button class="btn" type="button" :disabled="index >= count - 1" data-testid="move-after" @click="store.moveBy(clip.id, 1)">
            <AppIcon name="arrow-right" />
            Mover después
          </button>
          <span class="spacer" />
          <button class="btn danger" type="button" data-testid="remove-clip" @click="store.removeClip(clip.id)">
            <AppIcon name="trash" />
            Quitar del vídeo
          </button>
        </template>
      </div>
      <ClipStrip @add="pickAndAddVideos" />
    </footer>
  </main>
</template>

<style scoped>
.save {
  margin-left: 8px;
}
.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
  padding: 16px 20px 0;
}
.preview {
  min-height: 0;
  min-width: 0;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow-y: auto;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel h2 {
  font-size: 18px;
  font-weight: 650;
}
.panel h2 .muted {
  font-weight: 400;
}
.shapes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.shape {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 54px;
  padding: 6px 12px;
  border-radius: 12px;
  border: 1.5px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  text-align: left;
  color: var(--text-muted);
}
.shape:hover {
  border-color: var(--border-strong);
}
.shape.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.shape-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.shape-text strong {
  color: var(--text);
  font-size: 17px;
}
.shape-text span {
  font-size: 15px;
}
.fix {
  border-color: var(--accent);
  color: var(--accent-hover);
}
.fix:hover {
  background: var(--accent-soft) !important;
  border-color: var(--accent) !important;
}
.clip-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px 0;
}
.clip-actions h2 {
  font-size: 19px;
  font-weight: 650;
  margin-right: 8px;
  white-space: nowrap;
}
.clip-actions h2 .muted {
  font-weight: 400;
}
.spacer {
  flex: 1;
}
.tip {
  display: flex;
  gap: 10px;
  font-size: 15px;
  padding: 0 6px;
}
.lost {
  display: flex;
  gap: 8px;
  color: var(--warn);
  font-weight: 600;
}
.strip-area {
  flex: none;
  margin-top: 14px;
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.missing-banner {
  position: absolute;
  left: 12px;
  right: 12px;
  top: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--warn-soft);
  color: var(--warn);
  font-weight: 600;
}
@media (max-width: 1250px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr) 250px;
  }
}
@media (max-height: 760px) {
  .workspace {
    padding-top: 10px;
  }
  .clip-actions {
    padding-top: 8px;
  }
  .strip-area {
    margin-top: 10px;
  }
  .tip {
    display: none;
  }
  .panel {
    padding: 10px;
  }
}
</style>
