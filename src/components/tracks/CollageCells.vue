<script setup lang="ts">
// «Huecos» sobre la vista previa: cada hueco del collage elegido con su borde y su número. Un hueco vacío dice
// «Suelta aquí un vídeo» y ofrece «Elegir vídeo»; uno con vídeo dice si está silenciado o no tiene sonido.
// Arrastrar un hueco sobre otro los intercambia; con «Llenar», arrastrar dentro del hueco mueve el encuadre. Pulsar un
// hueco lo elige. Nada depende solo de arrastrar: la barra de abajo y las teclas hacen lo mismo.
import { computed, ref } from 'vue'
import { cellContentLayout, cellRects, layoutById, panOffset, type TrackItem } from '../../domain'
import { store, tracks } from '../../store'
import AppIcon from '../AppIcon.vue'

const props = defineProps<{ item: TrackItem; rect: { left: number; top: number; width: number; height: number } }>()

const collage = computed(() => props.item.collage!)
const cells = computed(() => {
  const layout = layoutById(collage.value.layoutId)
  if (!layout) return []
  return cellRects(layout, props.rect.width, props.rect.height, collage.value.gap).map((r, i) => {
    const cell = collage.value.cells[i]!
    const m = cell.source ? store.media.value[cell.source.path] : null
    const lost = !!cell.source && (!!store.missing.value[cell.source.path] || !m)
    return { i, r, cell, lost, name: cell.source ? cell.source.path.split(/[\\/]/).pop() ?? '' : '' }
  })
})
const picked = computed(() => tracks.pickedCell.value)

/** El arrastre: desde qué hueco, dónde va el puntero y si mueve el encuadre o va a intercambiar. */
const drag = ref<{ from: number; over: number; x: number; y: number; start: { offsetX: number; offsetY: number }; panning: boolean; moved: boolean } | null>(null)

function cellAt(clientX: number, clientY: number, host: HTMLElement): number {
  const b = host.getBoundingClientRect()
  const x = clientX - b.left
  const y = clientY - b.top
  return cells.value.find((c) => x >= c.r.left && x < c.r.left + c.r.width && y >= c.r.top && y < c.r.top + c.r.height)?.i ?? -1
}

function down(i: number, e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  tracks.pickedCell.value = i
  const cell = collage.value.cells[i]!
  drag.value = { from: i, over: i, x: e.clientX, y: e.clientY, start: { offsetX: cell.offsetX, offsetY: cell.offsetY }, panning: false, moved: false }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function move(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const host = (e.currentTarget as HTMLElement).closest('.collage-cells') as HTMLElement
  const over = cellAt(e.clientX, e.clientY, host)
  const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y)
  if (dist > 4) d.moved = true
  d.over = over
  const c = cells.value[d.from]
  const cell = c?.cell
  const m = cell?.source ? store.media.value[cell.source.path] : null
  if (over === d.from && cell && m && cell.fit === 'fill') {
    // Dentro de su hueco: mueve el encuadre (lo que sobra del vídeo).
    const content = cellContentLayout(cell, m.width, m.height, c!.r.width, c!.r.height)
    const next = panOffset(content, c!.r.width, c!.r.height, d.start, e.clientX - d.x, e.clientY - d.y)
    d.panning = true
    tracks.previewCellFraming(props.item.id, d.from, next.offsetX, next.offsetY)
  } else if (d.panning) {
    store.cancelPreview()
    d.panning = false
  }
}

function up() {
  const d = drag.value
  drag.value = null
  if (!d) return
  if (d.over >= 0 && d.over !== d.from && d.moved) {
    if (d.panning) store.cancelPreview()
    tracks.swapCollageCells(props.item.id, d.from, d.over)
    store.showToast(`Intercambiados los huecos ${d.from + 1} y ${d.over + 1}.`, { label: 'Deshacer', run: store.undo })
  } else if (d.panning) {
    store.commitPreview()
  }
}

function choose(i: number) {
  tracks.pickedCell.value = i
  void tracks.pickCellVideo(props.item.id, i)
}
</script>

<template>
  <div
    class="collage-cells"
    :style="{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }"
    data-testid="collage-cells"
  >
    <div
      v-for="c in cells"
      :key="c.i"
      class="slot"
      :class="{ picked: c.i === picked, empty: !c.cell.source, target: drag && drag.over === c.i && drag.from !== c.i && drag.moved }"
      :style="{ left: `${c.r.left}px`, top: `${c.r.top}px`, width: `${c.r.width}px`, height: `${c.r.height}px` }"
      :data-cell-index="c.i"
      :data-testid="`collage-slot-${c.i}`"
      :data-muted="c.cell.muted ? 1 : 0"
      @pointerdown="down(c.i, $event)"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
    >
      <span class="num">{{ c.i + 1 }}</span>
      <template v-if="!c.cell.source">
        <span class="drop">Suelta aquí un vídeo</span>
        <button class="btn small choose" type="button" :data-testid="`collage-choose-${c.i}`" @pointerdown.stop @click="choose(c.i)">
          <AppIcon name="folder" />
          Elegir vídeo
        </button>
      </template>
      <template v-else>
        <span v-if="c.lost" class="tag warn"><AppIcon name="warning" :size="16" /> No encuentro «{{ c.name }}»</span>
        <span v-else-if="!c.cell.source.hasAudio" class="tag" data-testid="cell-no-sound"><AppIcon name="mute" :size="16" /> Sin sonido</span>
        <span v-else-if="c.cell.muted" class="tag" data-testid="cell-muted"><AppIcon name="mute" :size="16" /> Silenciado</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.collage-cells {
  position: absolute;
  z-index: 40;
  pointer-events: auto;
  box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.18);
}
.slot {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  outline: 2px dashed rgb(255 255 255 / 0.85);
  outline-offset: -2px;
  cursor: grab;
  touch-action: none;
  color: #fff;
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.8);
}
.slot.picked {
  outline: 3px solid var(--accent);
  outline-offset: -3px;
}
.slot.target {
  outline: 3px solid #f2c94c;
  background: rgb(242 201 76 / 0.2);
}
.num {
  position: absolute;
  left: 6px;
  top: 6px;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 12px;
  background: rgb(255 255 255 / 0.9);
  color: #1d2b36;
  font-size: 14px;
  font-weight: 700;
  line-height: 24px;
  text-align: center;
  text-shadow: none;
}
.slot.picked .num {
  background: var(--accent);
  color: #fff;
}
.drop {
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  padding: 0 6px;
}
.choose {
  min-height: 36px;
  padding: 0 10px;
  font-size: 14px;
  text-shadow: none;
}
.tag {
  position: absolute;
  right: 6px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 12px);
  padding: 2px 8px;
  border-radius: 10px;
  background: rgb(20 24 30 / 0.75);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: none;
}
.tag.warn {
  background: var(--warn, #b26b00);
}
</style>
