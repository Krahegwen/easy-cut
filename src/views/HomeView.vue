<script setup lang="ts">
// Inicio: hacer un vídeo nuevo (principal), grabarse leyendo un texto, solo recortar un vídeo y, debajo, los vídeos en marcha (cada
// uno se guarda solo en cada cambio): abrir, cambiar el nombre, duplicar y borrar (borrar nunca toca los
// originales). Con la lista vacía, Inicio es como siempre.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import AppVersion from '../components/AppVersion.vue'
import UpdateNotice from '../components/UpdateNotice.vue'
import KeyHint from '../components/KeyHint.vue'
import KeysButton from '../components/KeysButton.vue'
import { describeTouched, formatDuration } from '../domain'
import { askConfirm } from '../lib/confirm'
import { LAYER_PRIORITY } from '../lib/shortcuts'
import { useShortcuts } from '../lib/use-shortcuts'
import { store, trim, type ProjectListEntry } from '../store'

const list = computed(() => store.projects.value)

function newVideo() {
  // El que estuviera abierto ya está guardado en la lista: no hay nada que perder.
  store.startNewProject()
  store.go('pick')
}

function open(p: ProjectListEntry) {
  if (renaming.value) return
  void store.openProject(p.id)
}

// ------------------------------------------------------------------ miniaturas

const thumbs = ref<Record<string, string | null>>({})
watch(
  list,
  (l) => {
    for (const p of l) {
      const t = p.thumb
      const key = t ? `${t.path}|${t.timeMs}` : ''
      if (!t || key in thumbs.value) continue
      thumbs.value = { ...thumbs.value, [key]: null }
      void store.thumbnail(t.path, t.timeMs, 144).then((img) => {
        thumbs.value = { ...thumbs.value, [key]: img?.url ?? null }
      })
    }
  },
  { immediate: true },
)
function thumbOf(p: ProjectListEntry): string | null {
  return p.thumb ? (thumbs.value[`${p.thumb.path}|${p.thumb.timeMs}`] ?? null) : null
}

// «Hace 5 minutos» se pone al día solo.
const nowMs = ref(Date.now())
let clock = 0
onMounted(() => {
  clock = window.setInterval(() => (nowMs.value = Date.now()), 30_000)
})
onBeforeUnmount(() => window.clearInterval(clock))

function describe(p: ProjectListEntry): string {
  if (p.clipCount === 0) return 'Vacío'
  return `${p.clipCount} ${p.clipCount === 1 ? 'trozo' : 'trozos'} · dura ${formatDuration(p.durationMs)}`
}

// ------------------------------------------------------------------ cambiar el nombre

const renaming = ref<string | null>(null)
const draft = ref('')
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)

async function startRename(p: ProjectListEntry) {
  menuFor.value = null
  renaming.value = p.id
  draft.value = p.name
  await nextTick()
  const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value
  el?.focus()
  el?.select()
}

function finishRename(save: boolean) {
  const id = renaming.value
  if (!id) return
  renaming.value = null
  if (save) void store.renameProject(id, draft.value)
}

/**
 * Al salir del cuadro se guarda, pero un momento después: Esc saca primero del cuadro (el atajo de siempre) y
 * justo después llega su tecla, que cancela.
 */
function onRenameBlur() {
  window.setTimeout(() => finishRename(true), 0)
}

// ------------------------------------------------------------------ duplicar, borrar y lo demás

async function duplicate(p: ProjectListEntry) {
  menuFor.value = null
  await store.duplicateProject(p.id)
}

async function remove(p: ProjectListEntry) {
  menuFor.value = null
  const ok = await askConfirm({
    title: `¿Borrar «${p.name}»?`,
    message: 'Se quita de la lista con todo lo que has hecho en él. Tus vídeos originales y los vídeos que ya has guardado no se tocan.',
    confirmLabel: 'Sí, borrarlo',
    cancelLabel: 'No, volver',
    danger: true,
  })
  if (ok) await store.deleteProject(p.id)
}

const menuFor = ref<string | null>(null)
function toggleMenu(p: ProjectListEntry) {
  menuFor.value = menuFor.value === p.id ? null : p.id
}

async function exportFile(p: ProjectListEntry) {
  menuFor.value = null
  await store.exportProject(p.id)
}

async function restoreBackup(p: ProjectListEntry) {
  menuFor.value = null
  const ok = await askConfirm({
    title: `¿Volver a como estaba «${p.name}» hace un rato?`,
    message: 'Se pone la copia que guardé antes de tus últimos cambios. Lo de ahora no se pierde: pasa a ser la copia, y puedes volver a ella de la misma manera.',
    confirmLabel: 'Sí, volver a la copia',
    cancelLabel: 'No, volver',
  })
  if (ok && (await store.restoreProjectBackup(p.id))) store.showToast(`«${p.name}» está como hace un rato.`)
}

function importFile() {
  void store.importProjectFile()
}

// Intro = lo destacado: «Hacer un vídeo nuevo» (ya no pregunta: el que hubiera a medias queda en la lista).
useShortcuts({
  id: 'home',
  title: 'Inicio',
  shortcuts: () => [{ id: 'new-video', keys: ['Enter'], label: 'Intro', description: '«Hacer un vídeo nuevo»', run: newVideo }],
})

useShortcuts({
  id: 'home-menu',
  title: 'Menú del vídeo',
  priority: LAYER_PRIORITY.popover,
  active: () => menuFor.value !== null,
  shortcuts: () => [{ id: 'home-menu-close', keys: ['Escape'], label: 'Esc', description: 'cerrar el menú', run: () => (menuFor.value = null) }],
})
</script>

<template>
  <main class="screen home" :class="{ 'with-list': list.length > 0 }" data-testid="home-view" @click.self="menuFor = null">
    <KeysButton floating />
    <div class="content">
      <UpdateNotice />
      <header class="hero">
        <span class="logo" aria-hidden="true"><AppIcon name="film" :size="34" /></span>
        <h1>Tus vídeos, fáciles de montar</h1>
        <p class="muted">Junta tus vídeos, quita lo que sobra y guárdalo listo para mandar.</p>
      </header>

      <div class="actions">
        <button class="btn primary huge" type="button" data-testid="new-video" @click="newVideo">
          <AppIcon name="plus" :size="30" />
          Hacer un vídeo nuevo
          <KeyHint k="Intro" />
        </button>

        <div class="others">
          <button class="btn large secondary" type="button" data-testid="teleprompter" @click="store.go('teleprompter')">
            <AppIcon name="mic" />
            Grabarme leyendo un texto
          </button>
          <button class="btn large secondary" type="button" data-testid="trim-only" @click="trim.begin()">
            <AppIcon name="scissors" />
            Solo recortar un vídeo
          </button>
        </div>
      </div>

      <section v-if="list.length > 0" class="projects" aria-labelledby="projects-title" data-testid="project-list">
        <h2 id="projects-title">Tus vídeos en marcha</h2>
        <p class="muted hint">Cada uno se guarda solo mientras lo haces. Pulsa uno para seguir con él.</p>
        <ul class="grid">
          <li
            v-for="p in list"
            :key="p.id"
            class="project card"
            :class="{ open: p.id === store.projectId.value, menu: menuFor === p.id }"
            :data-project-id="p.id"
            data-testid="project-card"
          >
            <button class="open-project" type="button" :aria-label="`Abrir «${p.name}»`" data-testid="project-open" @click="open(p)">
              <span class="thumb" aria-hidden="true">
                <img v-if="thumbOf(p)" :src="thumbOf(p)!" alt="" draggable="false" />
                <AppIcon v-else :name="p.clipCount === 0 ? 'film' : 'wave'" :size="30" />
              </span>
              <span class="info">
                <strong v-if="renaming !== p.id" class="name" :title="p.name" data-testid="project-name">{{ p.name }}</strong>
                <span class="meta" data-testid="project-meta">{{ describe(p) }}</span>
                <span class="when muted" data-testid="project-when">{{ describeTouched(p.modifiedMs, nowMs) }}</span>
              </span>
            </button>
            <input
              v-if="renaming === p.id"
              ref="renameInput"
              v-model="draft"
              class="rename"
              type="text"
              maxlength="80"
              spellcheck="false"
              aria-label="Nombre del vídeo"
              data-testid="project-rename-input"
              @keydown.enter.prevent="finishRename(true)"
              @keydown.esc.prevent.stop="finishRename(false)"
              @blur="onRenameBlur"
            />
            <div class="tools">
              <button class="btn small quiet" type="button" data-testid="project-rename" @click="startRename(p)">
                <AppIcon name="pencil" :size="18" />
                Cambiar el nombre
              </button>
              <button class="btn small quiet" type="button" data-testid="project-duplicate" @click="duplicate(p)">
                <AppIcon name="copy" :size="18" />
                Duplicar
              </button>
              <button class="btn small quiet danger-text" type="button" data-testid="project-delete" @click="remove(p)">
                <AppIcon name="trash" :size="18" />
                Borrar
              </button>
              <span class="spacer" />
              <button
                class="btn small quiet more"
                type="button"
                :aria-expanded="menuFor === p.id"
                aria-label="Más cosas"
                title="Más cosas"
                data-testid="project-more"
                @click="toggleMenu(p)"
              >
                <AppIcon name="more" :size="20" />
              </button>
              <div v-if="menuFor === p.id" class="menu-pop card" role="menu" data-testid="project-menu">
                <button class="menu-item" type="button" role="menuitem" data-testid="project-export" @click="exportFile(p)">
                  <AppIcon name="save" :size="18" />
                  Guardar en un fichero (para llevarlo a otro ordenador)
                </button>
                <button v-if="p.hasBackup" class="menu-item" type="button" role="menuitem" data-testid="project-restore" @click="restoreBackup(p)">
                  <AppIcon name="undo" :size="18" />
                  Volver a como estaba hace un rato
                </button>
              </div>
            </div>
          </li>
        </ul>
        <button class="link import" type="button" data-testid="project-import" @click="importFile">Abrir un vídeo guardado en un fichero</button>
      </section>

      <AppVersion />
    </div>
  </main>
</template>

<style scoped>
.home {
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  background:
    radial-gradient(1200px 500px at 50% -10%, #e6eef4 0%, transparent 70%),
    var(--bg);
}
.content {
  width: min(680px, calc(100% - 48px));
  display: flex;
  flex-direction: column;
  gap: 40px;
  padding: 40px 0;
}
.hero {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.logo {
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  border-radius: 20px;
  background: var(--accent);
  color: #fff;
  box-shadow: var(--shadow);
}
.hero h1 {
  font-size: 36px;
  font-weight: 700;
}
.hero p {
  font-size: 19px;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.huge {
  min-height: 84px;
  font-size: 24px;
  border-radius: 18px;
  gap: 14px;
}
.others {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}
.secondary {
  border-color: var(--border);
  background: transparent;
}

/* Con vídeos en marcha: arriba, lo de siempre más apretado; debajo, la lista, que se desplaza. */
.home.with-list {
  justify-content: flex-start;
}
.with-list .content {
  width: min(1000px, calc(100% - 48px));
  gap: 22px;
  padding: 24px 0 28px;
}
.with-list .hero {
  flex-direction: row;
  justify-content: center;
  gap: 16px;
  text-align: left;
}
.with-list .logo {
  width: 52px;
  height: 52px;
  border-radius: 16px;
}
.with-list .hero h1 {
  font-size: 30px;
}
.with-list .hero p {
  display: none;
}
.with-list .actions {
  flex-direction: row;
  align-items: stretch;
  justify-content: center;
  gap: 14px;
}
.with-list .huge {
  flex: 0 1 460px;
  min-height: 72px;
  font-size: 22px;
}
.with-list .others {
  flex-wrap: nowrap;
}
.with-list .secondary {
  align-self: stretch;
  min-height: 72px;
}
.projects h2 {
  font-size: 22px;
}
.hint {
  margin: 2px 0 12px;
  font-size: 16px;
}
.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 12px;
}
.project {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1.5px solid var(--border);
}
.project.open {
  border-color: var(--accent);
}
.open-project {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 4px;
  border: none;
  border-radius: 10px;
  background: none;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.open-project:hover {
  background: var(--accent-soft);
}
.thumb {
  flex: none;
  width: 144px;
  height: 81px;
  border-radius: 8px;
  overflow: hidden;
  background: #1c2229;
  color: #9fb0c0;
  display: grid;
  place-items: center;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.name {
  font-size: 18px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  font-size: 15px;
}
.when {
  font-size: 14px;
}
.rename {
  font: inherit;
  font-size: 17px;
  font-weight: 600;
  padding: 6px 10px;
  border: 2px solid var(--accent);
  border-radius: 8px;
}
.tools {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
}
.btn.small {
  min-height: 38px;
  padding: 0 10px;
  gap: 6px;
  font-size: 15px;
}
.danger-text {
  color: var(--bad);
}
.spacer {
  flex: 1;
}
.menu-pop {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 5;
  display: flex;
  flex-direction: column;
  padding: 6px;
  min-width: 300px;
  box-shadow: var(--shadow-lg);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: none;
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}
.menu-item:hover {
  background: var(--accent-soft);
}
.link {
  border: 0;
  background: none;
  padding: 4px 2px;
  font: inherit;
  font-size: 15px;
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.import {
  margin-top: 12px;
}
@media (max-width: 1000px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
