<script setup lang="ts">
// La duración, siempre a la vista: cuánto dura el vídeo y, con máximo, cuánto queda o sobra.
// En las herramientas que cambian la duración enseña también «Este trozo: 32 s → 14 s».
import { computed } from 'vue'
import { describeTarget, formatDuration, formatDurationChange, targetFraction } from '../domain'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  totalMs: number
  targetMs: number | null
  /** Duración del trozo antes y ahora (herramientas del trozo). */
  clipBeforeMs?: number | null
  clipAfterMs?: number | null
  /** Duración del vídeo antes de los cambios (herramientas del trozo). */
  projectBeforeMs?: number | null
}>()

const hasTarget = computed(() => props.targetMs !== null && props.targetMs > 0)
const over = computed(() => hasTarget.value && props.totalMs - (props.targetMs ?? 0) >= 500)
const fraction = computed(() => (hasTarget.value ? targetFraction(props.totalMs, props.targetMs!) : 0))
const targetText = computed(() => (hasTarget.value ? describeTarget(props.totalMs, props.targetMs!) : ''))
const showChanges = computed(() => props.clipBeforeMs != null && props.clipAfterMs != null)
const clipText = computed(() => formatDurationChange(props.clipBeforeMs ?? 0, props.clipAfterMs ?? 0))
const projectText = computed(() => formatDurationChange(props.projectBeforeMs ?? props.totalMs, props.totalMs))
</script>

<template>
  <section
    class="duration-bar"
    :class="{ over, 'has-target': hasTarget }"
    data-testid="duration-bar"
    :data-duration-ms="totalMs"
    aria-live="polite"
  >
    <div class="main">
      <AppIcon name="clock" :size="26" class="clock" />
      <p class="total" data-testid="duration-total">
        El vídeo dura <strong>{{ formatDuration(totalMs) }}</strong>
      </p>
    </div>

    <div v-if="hasTarget" class="target">
      <div
        class="meter"
        role="meter"
        :aria-valuenow="Math.round(fraction * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`Duración respecto al máximo de ${formatDuration(targetMs!)}`"
      >
        <div class="fill" :style="{ width: `${Math.min(1, fraction) * 100}%` }" />
      </div>
      <p class="target-text" data-testid="target-text">
        <AppIcon :name="over ? 'warning' : 'check'" :size="22" />
        <span class="target-main">{{ targetText }}</span>
        <span class="of" data-testid="target-max">(máx. {{ formatDuration(targetMs!) }})</span>
      </p>
    </div>

    <div v-if="showChanges" class="changes" data-testid="duration-changes">
      <p data-testid="clip-change">Este trozo: <strong>{{ clipText }}</strong></p>
      <p data-testid="project-change">Vídeo completo: <strong>{{ projectText }}</strong></p>
    </div>

    <div class="slot"><slot /></div>
  </section>
</template>

<style scoped>
.duration-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 10px 20px;
  min-height: 64px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}
.main {
  display: flex;
  align-items: center;
  gap: 10px;
}
.clock {
  color: var(--accent);
}
.total {
  font-size: 20px;
  white-space: nowrap;
}
.total strong {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.target {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 0 1 auto;
}
.meter {
  width: 180px;
  height: 14px;
  border-radius: 7px;
  background: var(--surface-sunken);
  overflow: hidden;
  flex: none;
}
.fill {
  height: 100%;
  background: var(--good);
  border-radius: 7px;
  transition: width 0.15s;
}
.target-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 18px;
  font-weight: 650;
  color: var(--good);
  min-width: 0;
  /* Si no cabe, «(máx. …)» baja a otra línea: nada se corta. */
  flex-wrap: wrap;
  column-gap: 6px;
  row-gap: 0;
  line-height: 1.2;
}
.target-main {
  white-space: nowrap;
}
.of {
  white-space: nowrap;
  font-weight: 400;
  color: var(--text-muted);
  font-size: 16px;
}
.over .fill {
  background: var(--bad);
}
.over .target-text {
  color: var(--bad);
}
.over.has-target {
  background: var(--bad-soft);
  border-bottom-color: color-mix(in srgb, var(--bad) 30%, var(--border));
}
.changes {
  display: flex;
  flex-direction: column;
  gap: 0;
  font-size: 17px;
  line-height: 1.3;
  color: var(--text-muted);
  padding-left: 22px;
  border-left: 1px solid var(--border);
}
.changes strong {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.slot {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
@media (max-width: 1250px) {
  .duration-bar {
    gap: 18px;
  }
  .meter {
    width: 90px;
  }
  .total,
  .target-text {
    font-size: 17px;
  }
  .total strong {
    font-size: 19px;
  }
  .changes {
    font-size: 15px;
    padding-left: 14px;
  }
}
@media (max-height: 760px) {
  .duration-bar {
    min-height: 54px;
    padding: 6px 20px;
  }
}
</style>
