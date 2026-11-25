<script setup lang="ts">
// «Guardando tu vídeo…»: barra gruesa, tiempo que falta y «Cancelar» (con confirmación).
import { computed } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { describeRemaining, formatPercent } from '../domain'
import { askConfirm } from '../lib/confirm'
import { saveFlow } from '../store'

const sound = computed(() => saveFlow.preset.value === 'sound')
const fraction = computed(() => saveFlow.progress.value?.fraction ?? 0)
const remaining = computed(() => describeRemaining(saveFlow.progress.value?.remainingMs ?? null, saveFlow.progress.value?.done))

async function cancel() {
  const ok = await askConfirm({
    title: '¿Dejar de guardar?',
    message: `${sound.value ? 'El sonido' : 'El vídeo'} no se guardará. Lo que llevas montado no se pierde y puedes volver a guardarlo cuando quieras.`,
    confirmLabel: 'Sí, dejar de guardar',
    cancelLabel: 'No, seguir guardando',
    danger: true,
  })
  if (ok) saveFlow.cancel()
}
</script>

<template>
  <main class="screen saving" data-testid="saving-view">
    <div class="box card">
      <span class="spinner big" />
      <h1>{{ sound ? 'Guardando el sonido…' : 'Guardando tu vídeo…' }}</h1>
      <div class="bar" role="progressbar" :aria-valuenow="Math.round(fraction * 100)" aria-valuemin="0" aria-valuemax="100">
        <div class="fill" :style="{ width: `${fraction * 100}%` }" />
      </div>
      <p class="numbers">
        <strong data-testid="saving-percent">{{ formatPercent(fraction) }}</strong>
        <span data-testid="saving-remaining">{{ remaining }}</span>
      </p>
      <p v-if="saveFlow.retrying.value" class="retry">Ha habido un problema con la tarjeta gráfica; lo estoy intentando de otra forma.</p>
      <p class="muted">Puedes usar el ordenador mientras tanto. No cierres esta ventana.</p>
      <button class="btn danger large" type="button" data-testid="cancel-saving" @click="cancel">
        <AppIcon name="close" />
        Cancelar
      </button>
    </div>
  </main>
</template>

<style scoped>
.saving {
  align-items: center;
  justify-content: center;
}
.box {
  width: min(680px, calc(100% - 48px));
  padding: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  text-align: center;
}
.spinner.big {
  width: 44px;
  height: 44px;
  border-width: 4px;
  color: var(--accent);
}
h1 {
  font-size: 32px;
}
.bar {
  width: 100%;
  height: 26px;
  border-radius: 13px;
  background: var(--surface-sunken);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--accent);
  border-radius: 13px;
  transition: width 0.3s;
}
.numbers {
  display: flex;
  gap: 16px;
  align-items: baseline;
  font-size: 20px;
}
.numbers strong {
  font-size: 26px;
  font-variant-numeric: tabular-nums;
}
.retry {
  color: var(--warn);
  font-weight: 600;
}
.box > .muted {
  font-size: 18px;
}
</style>
