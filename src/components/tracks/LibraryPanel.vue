<script setup lang="ts">
// «Añadir sonidos y efectos»: la biblioteca (Sonidos / Efectos, por categorías y con buscador) y «De mi
// ordenador». Se prueba antes de poner: los sonidos suenan al pulsar su tarjeta; los efectos se ven en su
// tarjeta (en bucle) y, con «Probar sobre mi vídeo», en la vista previa. «Poner aquí» lo pone donde está la línea.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  baseName,
  countByCategory,
  describeMediaEntry,
  describeUsage,
  formatClock,
  formatDuration,
  libraryFetchMessage,
  mediaUsage,
  NO_USAGE,
  poolActions,
  poolForDisplay,
  searchLibrary,
  usageTotal,
  type LibraryAsset,
  type LibraryCategory,
  type LibraryIcon,
  type MediaEntry,
} from '../../domain'
import { LAYER_PRIORITY } from '../../lib/shortcuts'
import { useShortcuts } from '../../lib/use-shortcuts'
import { library, store, tracks } from '../../store'
import AppIcon from '../AppIcon.vue'
import type { IconName } from '../icons'
import KeyHint from '../KeyHint.vue'
import CreditsDialog from './CreditsDialog.vue'

const tab = computed(() => tracks.libraryTab.value)
const query = ref('')
const category = ref<string | null>(null)
const creditsOpen = ref(false)

const kind = computed(() => (tab.value === 'effect' ? 'effect' : 'sound'))
const categories = computed<LibraryCategory[]>(() => library.categories.value.filter((c) => c.kind === kind.value))
const results = computed(() => (tab.value === 'computer' ? [] : searchLibrary(library.catalog.value, kind.value, query.value, category.value)))
/** Cuántos hay en cada categoría con lo que se está buscando (el contador de cada botón). */
const counts = computed(() => countByCategory(library.catalog.value, kind.value, query.value))
const total = computed(() => Object.values(counts.value).reduce((s, n) => s + n, 0))
const categoryName = computed(() => categories.value.find((c) => c.id === category.value)?.name ?? '')

watch(tab, () => {
  category.value = null
  stopSound()
})

// Al buscar o cambiar de categoría, la lista vuelve arriba (si no, se queda a media lista de lo anterior).
const grid = ref<HTMLElement | null>(null)
watch([query, category, tab], () => {
  if (grid.value) grid.value.scrollTop = 0
})

const ICONS: Record<LibraryIcon, IconName> = {
  party: 'party',
  clap: 'clap',
  bell: 'bell',
  music: 'music',
  fire: 'fire',
  light: 'light',
  snow: 'snow',
  heart: 'heart',
  star: 'star',
  frame: 'frame',
  whoosh: 'whoosh',
  laugh: 'laugh',
  check: 'check',
  // Una «×» junto al desplegable parecería «quitar el filtro».
  cross: 'warning',
  drum: 'drum',
  voice: 'mic',
  countdown: 'clock',
  objects: 'library',
}
function iconOf(id: string): IconName {
  const c = library.catalog.value.categories.find((x) => x.id === id)
  return c ? ICONS[c.icon] : 'star'
}

// ------------------------------------------------------------------ probar un sonido

const audio = ref<HTMLAudioElement | null>(null)
const playingId = ref<string | null>(null)
async function toggleSound(a: LibraryAsset) {
  if (playingId.value === a.id) {
    stopSound()
    return
  }
  stopSound()
  try {
    const path = await library.ensureAsset(a)
    const el = audio.value
    if (!el) return
    el.src = store.mediaSrc(path)
    playingId.value = a.id
    await el.play()
  } catch (e) {
    playingId.value = null
    store.showError(libraryFetchMessage(a.name, e), e)
  }
}
function stopSound() {
  const el = audio.value
  if (el && !el.paused) el.pause()
  playingId.value = null
}

// ------------------------------------------------------------------ vistas previas de los efectos

const previews = ref<Record<string, string>>({})
watch(
  [tab, results],
  () => {
    if (tab.value !== 'effect') return
    for (const a of results.value) {
      if (previews.value[a.id]) continue
      void library.ensurePreview(a).then((p) => {
        if (p) previews.value = { ...previews.value, [a.id]: store.mediaSrc(p) }
      })
    }
  },
  { immediate: true },
)

async function put(a: LibraryAsset) {
  stopSound()
  if (tracks.trying.value?.asset.id === a.id) tracks.trying.value = null
  await tracks.addAsset(a, tracks.playheadMs.value)
}

function close() {
  stopSound()
  tracks.closeLibrary()
}

const searchInput = ref<HTMLInputElement | null>(null)

useShortcuts({
  id: 'library',
  title: 'Biblioteca',
  priority: LAYER_PRIORITY.overlay,
  active: () => tracks.libraryOpen.value && !creditsOpen.value,
  shortcuts: () => [
    { id: 'library-close', keys: ['Escape'], label: 'Esc', description: 'cerrar la biblioteca', run: close },
    { id: 'library-search', keys: ['/'], label: '/', description: 'buscar', run: () => searchInput.value?.focus() },
  ],
})

onBeforeUnmount(stopSound)

function progressOf(a: LibraryAsset): number | null {
  return library.downloadProgress(a)
}

// ------------------------------------------------------------------ «De mi ordenador»: lo ya traído

const pool = computed(() => (tab.value === 'computer' ? poolForDisplay(store.project.value) : []))
const usage = computed(() => mediaUsage(store.project.value))
function usesOf(path: string): number {
  return usageTotal(usage.value.get(path) ?? NO_USAGE)
}
function usageText(path: string): string {
  return describeUsage(usage.value.get(path) ?? NO_USAGE)
}
function isLost(path: string): boolean {
  return !!store.missing.value[path]
}
const poolThumbs = ref<Record<string, string | null>>({})
watch(
  pool,
  (list) => {
    for (const m of list) {
      if (m.path in poolThumbs.value || m.kind === 'sound' || isLost(m.path)) continue
      if (m.kind === 'image') {
        poolThumbs.value = { ...poolThumbs.value, [m.path]: store.mediaSrc(m.path) }
        continue
      }
      poolThumbs.value = { ...poolThumbs.value, [m.path]: null }
      void store.thumbnail(m.path, Math.min(1000, Math.round(m.durationMs / 2)), 96).then((t) => {
        poolThumbs.value = { ...poolThumbs.value, [m.path]: t?.url ?? null }
      })
    }
  },
  { immediate: true },
)
function poolThumb(m: MediaEntry): string | null {
  return isLost(m.path) ? null : (poolThumbs.value[m.path] ?? null)
}
</script>

<template>
  <aside class="library" data-testid="library-panel" aria-label="Añadir sonidos y efectos">
    <header class="head">
      <h2><AppIcon name="library" /> Añadir sonidos y efectos</h2>
      <button class="btn quiet small" type="button" data-testid="library-close" @click="close">
        <AppIcon name="close" />
        Cerrar
        <KeyHint k="Esc" />
      </button>
    </header>
    <div class="tabs" role="tablist" aria-label="Qué añadir">
      <button role="tab" :aria-selected="tab === 'sound'" class="tab" :class="{ on: tab === 'sound' }" type="button" data-testid="library-tab-sounds" @click="tracks.libraryTab.value = 'sound'">
        <AppIcon name="sound" :size="20" /> Sonidos
      </button>
      <button role="tab" :aria-selected="tab === 'effect'" class="tab" :class="{ on: tab === 'effect' }" type="button" data-testid="library-tab-effects" @click="tracks.libraryTab.value = 'effect'">
        <AppIcon name="light" :size="20" /> Efectos
      </button>
      <button role="tab" :aria-selected="tab === 'computer'" class="tab" :class="{ on: tab === 'computer' }" type="button" data-testid="library-tab-computer" @click="tracks.libraryTab.value = 'computer'">
        <AppIcon name="folder" :size="20" /> De mi ordenador
      </button>
    </div>

    <template v-if="tab !== 'computer'">
      <div class="filters">
        <label class="search">
          <AppIcon name="search" :size="20" />
          <input ref="searchInput" v-model="query" type="search" spellcheck="false" autocomplete="off" :placeholder="tab === 'sound' ? 'Buscar: aplausos, campana…' : 'Buscar: luz, nieve, confeti…'" aria-label="Buscar en la biblioteca" data-testid="library-search" />
        </label>
        <!-- Con una docena de categorías, unos botones ocuparían media biblioteca: un desplegable con su contador. -->
        <label class="category" :class="{ on: category !== null }">
          <AppIcon :name="category ? iconOf(category) : 'library'" :size="20" />
          <select v-model="category" aria-label="Categoría" data-testid="library-category">
            <option :value="null" data-category="">Todo ({{ total }})</option>
            <template v-for="c in categories" :key="c.id">
              <!-- Buscando, solo las categorías donde hay algo (y la elegida, aunque se quede vacía). -->
              <option v-if="!query.trim() || counts[c.id] || category === c.id" :value="c.id" :data-category="c.id" :data-count="counts[c.id] ?? 0">
                {{ c.name }} ({{ counts[c.id] ?? 0 }})
              </option>
            </template>
          </select>
        </label>
      </div>
      <div ref="grid" class="grid" :class="tab" data-testid="library-grid">
        <p v-if="results.length === 0" class="empty muted">
          No hay nada con «{{ query }}»<template v-if="category"> en «{{ categoryName }}»</template>. Prueba con otra palabra<template v-if="category"> o mira en «Todo»</template>.
        </p>
        <article
          v-for="a in results"
          :key="a.id"
          class="asset"
          :class="{ playing: playingId === a.id, trying: tracks.trying.value?.asset.id === a.id }"
          :data-asset-id="a.id"
          data-testid="library-asset"
        >
          <button v-if="a.kind === 'sound'" class="listen" type="button" :aria-label="playingId === a.id ? `Parar «${a.name}»` : `Escuchar «${a.name}»`" :data-testid="`library-listen-${a.id}`" @click="toggleSound(a)">
            <AppIcon :name="playingId === a.id ? 'stop' : 'play'" :size="22" />
          </button>
          <div v-else class="preview">
            <img v-if="a.still && previews[a.id]" :src="previews[a.id]" alt="" draggable="false" />
            <video v-else-if="previews[a.id]" :src="previews[a.id]" muted loop autoplay playsinline disablepictureinpicture />
            <span v-else class="spinner" />
          </div>
          <div class="info">
            <!-- Si no cabe, se corta con «…» y el nombre entero queda en el título (y en el botón de escuchar). -->
            <strong class="asset-name" :title="a.name">{{ a.name }}</strong>
            <span class="meta muted" :title="a.description">
              <AppIcon :name="iconOf(a.category)" :size="15" class="meta-icon" />
              <span class="meta-text">
                {{ a.still ? 'Imagen' : formatDuration(a.durationMs) }}<template v-if="a.defaults.repeat"> · se repite</template><template v-if="a.defaults.look?.mix === 'light'"> · como luz</template><template v-if="a.description"> · {{ a.description }}</template>
              </span>
            </span>
          </div>
          <div class="buttons">
            <button
              v-if="a.kind === 'effect'"
              class="btn small"
              :class="{ selected: tracks.trying.value?.asset.id === a.id }"
              type="button"
              :data-testid="`library-try-${a.id}`"
              :aria-pressed="tracks.trying.value?.asset.id === a.id"
              @click="tracks.tryEffect(a)"
            >
              <AppIcon name="eye" />
              {{ tracks.trying.value?.asset.id === a.id ? 'Dejar de probar' : 'Probar sobre mi vídeo' }}
            </button>
            <button class="btn small primary" type="button" :data-testid="`library-put-${a.id}`" @click="put(a)">
              <AppIcon name="plus" />
              Poner aquí
            </button>
          </div>
          <div v-if="progressOf(a) !== null" class="progress" :style="{ width: `${Math.round((progressOf(a) ?? 0) * 100)}%` }" />
        </article>
      </div>
    </template>

    <div v-else class="computer" data-testid="library-computer">
      <div class="computer-head">
        <button class="btn primary" type="button" data-testid="library-pick-files" @click="tracks.pickFiles(tracks.playheadMs.value)">
          <AppIcon name="folder" />
          Elegir del ordenador
        </button>
        <p class="muted small-text">
          Sonidos, vídeos o imágenes (un logo, una pegatina…). También puedes soltarlos aquí o pegarlos con <KeyHint k="Ctrl V" />.
        </p>
      </div>
      <h3 v-if="pool.length" class="pool-title">Ya traídos a este vídeo</h3>
      <p v-else class="muted pool-empty" data-testid="pool-empty">Aquí saldrán los vídeos, sonidos e imágenes que traigas a este vídeo, para volver a usarlos.</p>
      <ul v-if="pool.length" class="pool" data-testid="pool-list">
        <li
          v-for="m in pool"
          :key="m.path"
          class="pool-item"
          :class="{ lost: isLost(m.path) }"
          :data-path="m.path"
          :data-kind="m.kind"
          :data-uses="usesOf(m.path)"
          data-testid="pool-item"
        >
          <span class="pool-pic" :class="m.kind" aria-hidden="true">
            <img v-if="poolThumb(m)" :src="poolThumb(m)!" alt="" draggable="false" />
            <AppIcon v-else :name="isLost(m.path) ? 'warning' : m.kind === 'sound' ? 'music' : m.kind === 'image' ? 'image' : 'film'" :size="24" />
          </span>
          <span class="pool-info">
            <strong class="asset-name" :title="m.path">{{ baseName(m.path) }}</strong>
            <span class="meta muted">
              <span class="meta-text">{{ describeMediaEntry(m) }} · <span data-testid="pool-uses">{{ usageText(m.path) }}</span></span>
            </span>
            <span v-if="isLost(m.path)" class="pool-lost" data-testid="pool-lost">No lo encuentro: puede que se haya movido o borrado.</span>
          </span>
          <span class="pool-buttons">
            <button v-if="isLost(m.path)" class="btn small primary" type="button" data-testid="pool-relink" @click="store.relink(m.path)">
              <AppIcon name="relink" />
              Buscarlo
            </button>
            <template v-else>
              <button v-if="poolActions(m).clip" class="btn small" type="button" :title="`Añadir «${baseName(m.path)}» al final del vídeo, como un trozo`" data-testid="pool-as-clip" @click="tracks.addPoolClip(m.path)">
                <AppIcon name="plus" />
                Trozo
              </button>
              <button v-if="poolActions(m).effect" class="btn small" type="button" :title="`Poner «${baseName(m.path)}» encima del vídeo, donde está la línea`" data-testid="pool-as-effect" @click="tracks.addPoolItem(m.path, 'effect')">
                <AppIcon name="light" />
                Encima
              </button>
              <button v-if="poolActions(m).sound" class="btn small" type="button" :title="`Poner el sonido de «${baseName(m.path)}» en una pista, donde está la línea`" data-testid="pool-as-sound" @click="tracks.addPoolItem(m.path, 'sound')">
                <AppIcon name="sound" />
                Sonido
              </button>
            </template>
          </span>
        </li>
      </ul>
    </div>

    <footer class="foot">
      <span v-if="tracks.adding.value" class="adding"><span class="spinner" /> Trayendo «{{ tracks.adding.value }}»…</span>
      <span v-else class="where muted" data-testid="library-where">«Poner aquí» lo pone donde está la línea: {{ formatClock(tracks.playheadMs.value) }}</span>
      <button class="link" type="button" data-testid="library-credits" @click="creditsOpen = true">Créditos de la biblioteca</button>
    </footer>
    <audio ref="audio" @ended="playingId = null" />
    <CreditsDialog v-if="creditsOpen" @close="creditsOpen = false" />
  </aside>
</template>

<style scoped>
.library {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 4px 14px;
}
.head h2 {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
}
.btn.small {
  min-height: 40px;
  padding: 0 12px;
  gap: 6px;
  font-size: 15px;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 4px 10px 0;
  border-bottom: 1px solid var(--border);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 42px;
  padding: 0 12px;
  border: none;
  border-bottom: 3px solid transparent;
  background: none;
  font-weight: 600;
  font-size: 16px;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}
.tab.on {
  color: var(--accent-hover);
  border-bottom-color: var(--accent);
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px 6px;
}
.search,
.category {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  min-height: 42px;
  border: 1.5px solid var(--border-strong);
  border-radius: 10px;
  color: var(--text-muted);
}
.search {
  flex: 1 1 200px;
}
.category {
  flex: 1 1 190px;
  cursor: pointer;
}
.category.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
}
.category select {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.category:focus-within,
.search:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.search input {
  flex: 1;
  border: none;
  outline: none;
  font: inherit;
  font-size: 16px;
  background: none;
  min-width: 0;
}
.grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 12px 12px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  align-content: start;
  /* Las tarjetas recortan su contenido (overflow): sin esto, sus filas se encogerían hasta cero. */
  grid-auto-rows: max-content;
}
.grid.effect {
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
}
.empty {
  padding: 20px 4px;
}
.asset {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    'pic info'
    'buttons buttons';
  align-items: center;
  gap: 8px 10px;
  padding: 8px;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  overflow: hidden;
}
.grid.sound .asset {
  grid-template-columns: auto 1fr auto;
  grid-template-areas: 'pic info buttons';
}
.grid.effect .asset {
  grid-template-columns: 1fr;
  grid-template-areas:
    'pic'
    'info'
    'buttons';
}
.asset.playing,
.asset.trying {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.listen {
  grid-area: pic;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.preview {
  grid-area: pic;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: #111;
  display: grid;
  place-items: center;
  color: #fff;
  /* Las de mezcla normal con transparencia se ven sobre un gris (como sobre un vídeo). */
  background-image: linear-gradient(45deg, #2a2f36 25%, transparent 25%), linear-gradient(-45deg, #2a2f36 25%, transparent 25%);
  background-size: 16px 16px;
}
.preview video,
.preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.info {
  grid-area: info;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* Hasta dos líneas; si aun así no cabe, «…» (y el nombre entero en el título). */
.asset-name {
  font-size: 16px;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  min-width: 0;
}
.meta-icon {
  flex: none;
}
.meta-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.buttons {
  grid-area: buttons;
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.grid.effect .buttons .btn {
  flex: 1;
}
.progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 4px;
  background: var(--accent);
  transition: width 0.15s;
}
.computer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 0;
  font-size: 16px;
}
.computer-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.computer-head .btn {
  flex: none;
}
.small-text {
  font-size: 14px;
  line-height: 1.3;
}
.pool-title {
  font-size: 15px;
  margin-top: 2px;
}
.pool-empty {
  font-size: 15px;
}
.pool {
  list-style: none;
  margin: 0;
  padding: 0 0 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pool-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    'pic info'
    'buttons buttons';
  align-items: center;
  gap: 6px 10px;
  padding: 6px 8px;
  border: 1.5px solid var(--border);
  border-radius: 12px;
}
.pool-item.lost {
  border-color: color-mix(in srgb, var(--warn) 50%, var(--border));
  background: var(--warn-soft);
}
.pool-pic {
  grid-area: pic;
  width: 72px;
  height: 40px;
  border-radius: 6px;
  overflow: hidden;
  background: #1c2229;
  color: #c7d3de;
  display: grid;
  place-items: center;
}
.pool-pic.sound {
  background: var(--accent-soft);
  color: var(--accent);
}
.pool-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pool-pic.image img {
  object-fit: contain;
}
.pool-info {
  grid-area: info;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.pool-info .asset-name {
  -webkit-line-clamp: 1;
  line-clamp: 1;
  font-size: 15px;
}
.pool-lost {
  font-size: 14px;
  color: var(--warn);
  font-weight: 600;
}
.pool-buttons {
  grid-area: buttons;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}
.pool-buttons .btn.small {
  min-height: 36px;
}
.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  font-size: 14px;
}
.where,
.adding {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}
.link {
  border: none;
  background: none;
  color: var(--accent-hover);
  text-decoration: underline;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}
/* Panel estrecho (ventana de 1100 px): todo un poco más compacto para que quepa en una línea. */
@container (max-width: 440px) {
  .head h2 {
    font-size: 16.5px;
    white-space: nowrap;
  }
  .tabs {
    gap: 0;
    padding: 4px 6px 0;
  }
  .tab {
    padding: 0 8px;
    gap: 5px;
    font-size: 15px;
  }
  .grid.sound .buttons .btn {
    padding: 0 10px;
  }
  .grid.effect {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid.effect .buttons {
    flex-direction: column;
  }
  .grid.effect .buttons .btn {
    white-space: normal;
    line-height: 1.15;
    padding: 4px 8px;
  }
}
/*
 * Ventana baja: la biblioteca comparte alto con las pistas (va junto a la vista previa), así que lo de arriba
 * se aprieta para dejar sitio a la lista: buscador y categoría en una sola fila, y menos aire.
 */
@media (max-height: 860px) {
  .head {
    padding-top: 4px;
    padding-bottom: 0;
  }
  .btn.small {
    min-height: 36px;
  }
  .tab {
    min-height: 36px;
  }
  .filters {
    flex-wrap: nowrap;
    padding: 6px 12px 4px;
  }
  .search {
    flex: 1 1 0;
    min-width: 0;
  }
  .category {
    flex: 0 1 168px;
    min-width: 0;
  }
  .search,
  .category {
    min-height: 38px;
  }
  .foot {
    padding: 4px 14px;
  }
}
</style>
