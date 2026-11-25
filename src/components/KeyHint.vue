<script setup lang="ts">
// Una tecla dibujada («Espacio», «Esc», «E», «Ctrl C») junto al botón que hace lo mismo, para que el atajo
// se aprenda con el uso. El texto va en ::before (desde data-key): así no cambia el nombre del botón ni su
// texto (lectores de pantalla y pruebas), y aria-hidden la deja fuera de lo que se lee.
defineProps<{ k: string }>()
</script>

<template>
  <kbd class="key-hint" :class="{ arrow: /^[←→↑↓]$/.test(k) }" :data-key="k" data-key-hint aria-hidden="true" />
</template>

<style scoped>
.key-hint {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Proporcional al texto del botón (más grande en los botones grandes), nunca por debajo de 12,5 px. */
  font-size: max(12.5px, 0.7em);
  min-width: 1.75em;
  height: 1.7em;
  padding: 0 0.42em;
  border: 1px solid color-mix(in srgb, currentColor 42%, transparent);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: color-mix(in srgb, currentColor 9%, transparent);
  font-family: var(--font);
  font-weight: 650;
  line-height: 1;
  letter-spacing: 0.01em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  opacity: 0.88;
  vertical-align: middle;
}
/* Las flechas, un poco más grandes: en letra pequeña casi no se ven. */
.key-hint.arrow {
  font-size: max(16px, 0.9em);
  font-weight: 700;
  min-width: 1.5em;
  height: 1.35em;
}
.key-hint::before {
  content: attr(data-key);
}
</style>
