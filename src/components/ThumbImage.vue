<script setup lang="ts">
// Miniatura de un instante del original (la pide al store, que la cachea).
import { ref, watch } from 'vue'
import { store } from '../store'

const props = withDefaults(defineProps<{ path: string; timeMs: number; height?: number; fit?: 'cover' | 'contain' }>(), {
  height: 120,
  fit: 'cover',
})

const url = ref<string | null>(null)
let token = 0
watch(
  () => [props.path, Math.round(props.timeMs / 100), props.height] as const,
  async () => {
    const mine = ++token
    const thumb = await store.thumbnail(props.path, props.timeMs, props.height)
    if (mine === token) url.value = thumb?.url ?? null
  },
  { immediate: true },
)
</script>

<template>
  <img v-if="url" class="thumb" :src="url" alt="" draggable="false" :style="{ objectFit: fit }" />
  <span v-else class="thumb placeholder" />
</template>

<style scoped>
.thumb {
  display: block;
  width: 100%;
  height: 100%;
  background: #2a3038;
}
.placeholder {
  background: linear-gradient(135deg, #2a3038, #39414b);
}
</style>
