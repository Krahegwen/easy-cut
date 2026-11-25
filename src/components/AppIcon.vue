<script setup lang="ts">
// Iconos propios en SVG (trazo de 2 px sobre 24 × 24), sencillos y siempre acompañados de texto.
import { computed } from 'vue'
import type { IconName } from './icons'

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 24 })

// Cada icono: lista de elementos SVG (path d o figuras simples).
const ICONS: Record<IconName, string> = {
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  split: '<path d="M12 3v18"/><path d="M8 7H4v10h4M16 7h4v10h-4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  'arrow-left': '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  save: '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M5 19.5h14"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  'rotate-left': '<path d="M4 4v5h5"/><path d="M4.6 9A8 8 0 1 1 6 16.9"/>',
  'rotate-right': '<path d="M20 4v5h-5"/><path d="M19.4 9A8 8 0 1 0 18 16.9"/>',
  'zoom-in': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6"/>',
  'zoom-out': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M7.5 10.5h6"/>',
  center: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5"/>',
  speed: '<path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13.5" r="1.2" fill="currentColor"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  folder: '<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  warning: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  pauses: '<path d="M3 12h3l2-5 3 10 2-5h1.5"/><path d="M17 8v8M20.5 8v8"/>',
  frame: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>',
  horizontal: '<rect x="2.5" y="6.5" width="19" height="11" rx="1.5"/>',
  vertical: '<rect x="7" y="2.5" width="10" height="19" rx="1.5"/>',
  square: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  'step-back': '<path d="M11 7 6 12l5 5"/><path d="M18 7l-5 5 5 5"/>',
  'step-forward': '<path d="m13 7 5 5-5 5"/><path d="m6 7 5 5-5 5"/>',
  'start-here': '<path d="M6 4v16"/><path d="M10 12h10M15 7l5 5-5 5"/>',
  'end-here': '<path d="M18 4v16"/><path d="M4 12h10M9 7l5 5-5 5"/>',
  reset: '<path d="M4 4v5h5"/><path d="M4.6 9A8 8 0 1 1 4 13"/>',
  wrench: '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9L20 11l-9.5 9.5a2.1 2.1 0 0 1-3-3L17 8l.6.6"/><path d="M14.5 5.5 17 3l1.5 1.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M10.5 18h3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/>',
  upload: '<path d="M12 16V5M7 9.5l5-5 5 5"/><path d="M5 19.5h14"/>',
  camera: '<rect x="2.5" y="6.5" width="13" height="11" rx="2"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>',
  record: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  'text-smaller': '<path d="M3 18 7.5 7 12 18M4.6 14.5h5.8"/><path d="M15 12h6"/>',
  'text-larger': '<path d="M2.5 19 8 5l5.5 14M4.5 14.5h7"/><path d="M15.5 12h6M18.5 9v6"/>',
  slower: '<path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="m12 13-4-4"/><circle cx="12" cy="13.5" r="1.2" fill="currentColor"/>',
  faster: '<path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="m12 13 4.5-3.5"/><circle cx="12" cy="13.5" r="1.2" fill="currentColor"/>',
  rewind: '<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/><path d="M5 3.5h14"/>',
  'eye-off': '<path d="M2.5 12S6 5.5 12 5.5c2 0 3.7.7 5.1 1.7M21.5 12S18 18.5 12 18.5c-2 0-3.7-.7-5.1-1.7"/><path d="M4 20 20 4"/>',
  text: '<path d="M4 6h16M4 10.5h16M4 15h11M4 19.5h7"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5-5-8.5 8.5"/>',
  wave: '<path d="M3 12h1.5M6.5 9v6M10 5.5v13M13.5 8v8M17 10v4M20.5 12H21"/>',
  'cover-video': '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>',
  corner: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><rect x="13" y="12.5" width="6" height="4.5" rx="1" fill="currentColor" stroke="none"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 14.5h8"/>',
  paste: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3.5h6v1M9 11h6M9 15h4"/>',
  tracks: '<rect x="3" y="4.5" width="18" height="4" rx="1"/><rect x="7" y="10.5" width="10" height="3.5" rx="1"/><rect x="3" y="16" width="12" height="3.5" rx="1"/>',
  cards: '<rect x="2.5" y="7" width="5.5" height="10" rx="1.2"/><rect x="9.25" y="7" width="5.5" height="10" rx="1.2"/><rect x="16" y="7" width="5.5" height="10" rx="1.2"/>',
  library: '<path d="M4 19.5V5a1 1 0 0 1 1-1h3v15.5M8 19.5V7h4v12.5M12 19.5V9l4-1.2 3.8 11.4"/><path d="M3 20.5h18"/>',
  'fade-in': '<path d="M3 19 13 7h8"/><path d="M3 19h18"/>',
  'fade-out': '<path d="M3 7h8l10 12"/><path d="M3 19h18"/>',
  repeat: '<path d="M17 3.5 20.5 7 17 10.5"/><path d="M3.5 11.5V10a3 3 0 0 1 3-3h14"/><path d="M7 20.5 3.5 17 7 13.5"/><path d="M20.5 12.5V14a3 3 0 0 1-3 3h-14"/>',
  'move-here': '<path d="M12 3v18"/><path d="M4 9l3.5 3L4 15M20 9l-3.5 3L20 15"/>',
  resize: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke-dasharray="3 2.5"/><path d="M13 11h7v9h-9v-7z" fill="currentColor" stroke="none"/>',
  blend: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M5 19.5h14"/>',
  party: '<path d="m4 20 4.5-12 7.5 7.5z"/><path d="M14 4.5c.5 1.5 0 2.5-1 3M18 8.5c1.5-.3 2.5.3 3 1.3M16.5 3l.3 1.5M20.5 5.5l-1.4.5"/>',
  clap: '<path d="M8 13.5 5 10.5a1.4 1.4 0 0 1 2-2l4 4M9.5 9.5 6.5 6.5a1.4 1.4 0 0 1 2-2l5.5 5.5"/><path d="m11 6.5.5-.5a1.4 1.4 0 0 1 2 0l3.5 3.5c2.5 2.5 2.5 6.5 0 9a6.4 6.4 0 0 1-9 0L5 15.5a1.4 1.4 0 0 1 2-2l1 1"/><path d="M17 3.5l.8-1.5M20 6l1.5-.8"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  fire: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.6 3.2-5.6 3.5-9.3 2 1.2 3.4 3.2 3.6 5.2.8-.8 1.3-2 1.3-3.2 2.4 2 4.6 4.6 4.6 7.6 0 3.4-2.6 5.9-6.5 5.9z"/><path d="M12 21c-1.5 0-2.6-1-2.6-2.5 0-1.6 1.4-2.4 2.6-4 1.2 1.6 2.6 2.4 2.6 4 0 1.5-1.1 2.5-2.6 2.5z"/>',
  light: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  snow: '<path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5"/><path d="m9.5 4 2.5 2.5L14.5 4M9.5 20l2.5-2.5 2.5 2.5"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  whoosh: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  laugh: '<circle cx="12" cy="12" r="8.5"/><path d="M8 9.5l1.6 1.2L8 11.9M16 9.5l-1.6 1.2 1.6 1.2"/><path d="M7.5 14h9a4.5 4.5 0 0 1-9 0z"/>',
  drum: '<ellipse cx="12" cy="9" rx="7.5" ry="3"/><path d="M4.5 9v6.5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V9"/><path d="M8 12.2v6M16 12.2v6M14.5 2.5 18 6.5M9.5 2.5 6 6.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  drag: '<circle cx="9" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="17" r="1.2" fill="currentColor"/><circle cx="15" cy="17" r="1.2" fill="currentColor"/>',
}

const svg = computed(() => ICONS[props.name])
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    v-html="svg"
  />
</template>

<style scoped>
.app-icon {
  flex: none;
  display: block;
}
</style>
