<script setup lang="ts">
// Pantalla de diagnóstico de la shell de escritorio: un botón por función del bridge.
// Solo en desarrollo (abrir con ?diagnostics). No es para el usuario final.

import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import * as domain from '../domain'
import type { MediaInfo, PresetId, ProgressUpdate, TimeRange } from '../domain'
import { bridge, isDesktop, type RunningProcess, type Thumbnail } from '../native'

const paths = ref<string[]>([])
const selected = ref<string | null>(null)
const info = shallowRef<MediaInfo | null>(null)
const log = ref<string[]>([])
const hovering = ref(false)

const videoEl = ref<HTMLVideoElement | null>(null)
const videoSrc = ref<string | null>(null)
const videoState = reactive({ error: '', duration: 0, currentTime: 0, videoWidth: 0, videoHeight: 0, usingProxy: false })

const thumbs = ref<Thumbnail[]>([])
const silences = ref<TimeRange[] | null>(null)
const encoders = ref<Record<string, boolean> | null>(null)

const preset = ref<PresetId>('whatsapp')
const exportProgress = shallowRef<ProgressUpdate | null>(null)
const exportedPath = ref<string | null>(null)
const proxyProgress = shallowRef<ProgressUpdate | null>(null)

const running = shallowRef<RunningProcess<unknown> | null>(null)
const busy = computed(() => running.value !== null)

const camera = shallowRef<MediaStream | null>(null)
const cameraEl = ref<HTMLVideoElement | null>(null)
const recorder = shallowRef<MediaRecorder | null>(null)
const recordedPath = ref<string | null>(null)

function write(message: string) {
  const time = new Date().toLocaleTimeString('es-ES')
  log.value = [`${time}  ${message}`, ...log.value].slice(0, 200)
}

function fail(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  write(`ERROR ${message}`)
}

/** Lanza un trabajo cancelable y lo deja en `running` para el botón «Cancelar». */
async function track<T>(process: RunningProcess<T>): Promise<T | undefined> {
  running.value = process as RunningProcess<unknown>
  try {
    return await process.result
  } catch (error) {
    if (error instanceof domain.ProbeError || !(error instanceof Error) || error.name !== 'CancelledError') fail(error)
    else write('Cancelado')
    return undefined
  } finally {
    running.value = null
  }
}

function cancel() {
  running.value?.cancel()
}

async function addPaths(newPaths: string[]) {
  for (const p of newPaths) if (!paths.value.includes(p)) paths.value.push(p)
  if (newPaths[0]) await select(newPaths[0])
}

async function pick() {
  try {
    const picked = await bridge.pickVideos({ multiple: true })
    write(`Elegidos: ${picked.length}`)
    await addPaths(picked)
  } catch (e) {
    fail(e)
  }
}

async function select(path: string) {
  selected.value = path
  info.value = null
  thumbs.value = []
  silences.value = null
  exportedPath.value = null
  videoState.usingProxy = false
  videoState.error = ''
  videoSrc.value = bridge.mediaUrl(path)
  try {
    const t0 = performance.now()
    info.value = await bridge.probe(path)
    write(`probe ${Math.round(performance.now() - t0)} ms: ${info.value.width}x${info.value.height} ${info.value.videoCodec} ${info.value.durationMs} ms`)
  } catch (e) {
    fail(e)
  }
}

function onVideoEvent() {
  const v = videoEl.value
  if (!v) return
  videoState.duration = Number.isFinite(v.duration) ? v.duration : 0
  videoState.currentTime = v.currentTime
  videoState.videoWidth = v.videoWidth
  videoState.videoHeight = v.videoHeight
}

function onVideoError() {
  const err = videoEl.value?.error
  videoState.error = err ? `código ${err.code}: ${err.message}` : 'error desconocido'
  write(`El <video> no puede reproducir el original (${videoState.error}). Prueba con «Vista previa ligera».`)
}

function seekTo(fraction: number) {
  const v = videoEl.value
  if (v && videoState.duration > 0) v.currentTime = videoState.duration * fraction
}

async function useProxy() {
  if (!selected.value) return
  const t0 = performance.now()
  const proxyPath = await track(
    bridge.makePreviewProxy(selected.value, (u) => {
      proxyProgress.value = u
    }),
  )
  if (proxyPath) {
    write(`Proxy listo en ${Math.round(performance.now() - t0)} ms: ${proxyPath}`)
    videoState.usingProxy = true
    videoState.error = ''
    videoSrc.value = bridge.mediaUrl(proxyPath)
  }
}

async function makeThumbs() {
  if (!info.value) return
  const d = info.value.durationMs
  const times = Array.from({ length: 8 }, (_, i) => Math.round((d * (i + 0.5)) / 8))
  const t0 = performance.now()
  const result = await track(bridge.thumbnails({ path: info.value.path, timesMs: times, height: 90 }))
  if (result) {
    thumbs.value = result
    write(`Miniaturas: ${result.length} en ${Math.round(performance.now() - t0)} ms`)
  }
}

async function findSilences() {
  if (!info.value) return
  const range = { startMs: 0, endMs: info.value.durationMs }
  const result = await track(bridge.detectSilences(info.value.path, range, { minSilenceMs: 500 }))
  if (result) {
    silences.value = result
    write(`Silencios: ${result.length}`)
  }
}

async function testEncoders() {
  try {
    const t0 = performance.now()
    encoders.value = (await bridge.probeEncoders()) as Record<string, boolean>
    write(`Encoders en ${Math.round(performance.now() - t0)} ms: ${JSON.stringify(encoders.value)}`)
  } catch (e) {
    fail(e)
  }
}

async function exportOne() {
  if (!info.value) return
  try {
    const media = info.value
    let project = domain.createProject(media.width >= media.height ? '16:9' : '9:16')
    project = domain.addClip(project, domain.createClip(media))
    const results = await bridge.probeEncoders()
    const encoder = domain.chooseEncoder(results)
    const folder = await bridge.getOutputFolder()
    const name = domain.buildOutputFileName(new Date(), preset.value, await bridge.listFileNames(folder))
    const outPath = bridge.joinPath(folder, name)
    const cmd = domain.buildExportCommand(project, new Map([[media.path, media]]), preset.value, encoder, outPath)
    const parser = domain.createProgressParser(cmd.expectedDurationMs, Date.now())
    exportProgress.value = null
    exportedPath.value = null
    write(`Exportando con ${encoder} a ${outPath}`)
    const result = await track(
      bridge.runFfmpeg(cmd.args, (line) => {
        for (const u of parser.push(`${line}\n`, Date.now())) exportProgress.value = u
      }),
    )
    if (!result) return
    if (result.exitCode === 0) {
      exportedPath.value = outPath
      write(`Exportado: ${outPath}`)
    } else {
      write(`ffmpeg salió con ${result.exitCode}: ${result.stderr.slice(-500)}`)
    }
  } catch (e) {
    fail(e)
  }
}

async function run(label: string, action: () => Promise<unknown>) {
  try {
    const value = await action()
    write(`${label}: ${value === undefined ? 'hecho' : JSON.stringify(value)}`)
  } catch (e) {
    fail(e)
  }
}

async function startCamera() {
  try {
    camera.value = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    if (cameraEl.value) cameraEl.value.srcObject = camera.value
    const tracks = camera.value.getTracks().map((t) => `${t.kind}: ${t.label}`)
    write(`Cámara y micrófono: ${tracks.join(' | ')}`)
  } catch (e) {
    fail(e)
  }
}

function stopCamera() {
  camera.value?.getTracks().forEach((t) => t.stop())
  camera.value = null
}

function record(seconds: number) {
  const stream = camera.value
  if (!stream) return
  const chunks: Blob[] = []
  const rec = new MediaRecorder(stream)
  recorder.value = rec
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  rec.onstop = async () => {
    recorder.value = null
    const blob = new Blob(chunks, { type: rec.mimeType })
    write(`Grabado ${blob.size} bytes (${rec.mimeType}); guardando…`)
    try {
      const saved = await bridge.saveRecording(blob, 'Prueba de grabación')
      recordedPath.value = saved.path
      write(`Grabación: ${saved.path} (${saved.durationMs} ms)`)
    } catch (e) {
      fail(e)
    }
  }
  rec.start(1000)
  setTimeout(() => rec.stop(), seconds * 1000)
}

let stopDrop: (() => void) | null = null
onMounted(() => {
  stopDrop = bridge.onFilesDropped({
    onDrop: (dropped) => {
      write(`Soltados: ${dropped.join(', ')}`)
      void addPaths(dropped)
    },
    onHover: (h) => (hovering.value = h),
  })
  // Acceso para las pruebas automáticas por CDP (scripts/webview-smoke.mjs).
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__easyCut = { bridge, domain, select, videoEl, videoState, log }
  }
})
onBeforeUnmount(() => {
  stopDrop?.()
  stopCamera()
})

const fmt = (ms: number) => (ms / 1000).toFixed(2)
</script>

<template>
  <main class="diag" :class="{ hovering }">
    <header>
      <h1>Easy Cut · diagnóstico</h1>
      <p v-if="!isDesktop" class="warn">Abierto en el navegador: las funciones de escritorio no están disponibles.</p>
    </header>

    <section class="row">
      <button @click="pick">Elegir vídeos…</button>
      <button :disabled="!busy" @click="cancel">Cancelar</button>
      <span>o suelta vídeos en la ventana</span>
    </section>

    <section v-if="paths.length" class="row">
      <button v-for="p in paths" :key="p" :class="{ active: p === selected }" @click="select(p)">{{ p }}</button>
    </section>

    <div class="grid">
      <section>
        <h2>Vista previa {{ videoState.usingProxy ? '(proxy)' : '(original)' }}</h2>
        <video
          v-if="videoSrc"
          ref="videoEl"
          :src="videoSrc"
          controls
          preload="metadata"
          @loadedmetadata="onVideoEvent"
          @timeupdate="onVideoEvent"
          @seeked="onVideoEvent"
          @error="onVideoError"
        />
        <p>
          duración {{ videoState.duration.toFixed(2) }} s · posición {{ videoState.currentTime.toFixed(2) }} s ·
          {{ videoState.videoWidth }}x{{ videoState.videoHeight }}
          <span v-if="videoState.error" class="warn">· {{ videoState.error }}</span>
        </p>
        <div class="row">
          <button @click="seekTo(0.1)">Ir al 10 %</button>
          <button @click="seekTo(0.5)">Ir al 50 %</button>
          <button @click="seekTo(0.9)">Ir al 90 %</button>
          <button :disabled="!selected || busy" @click="useProxy">Vista previa ligera</button>
          <span v-if="proxyProgress">{{ domain.formatPercent(proxyProgress.fraction) }}</span>
        </div>
      </section>

      <section>
        <h2>Información</h2>
        <pre>{{ info ? JSON.stringify(info, null, 2) : '—' }}</pre>
      </section>
    </div>

    <section>
      <h2>Miniaturas, pausas y encoders</h2>
      <div class="row">
        <button :disabled="!info || busy" @click="makeThumbs">Miniaturas</button>
        <button :disabled="!info || busy" @click="findSilences">Buscar pausas</button>
        <button @click="testEncoders">Probar encoders</button>
      </div>
      <div class="thumbs">
        <figure v-for="t in thumbs" :key="t.timeMs">
          <img :src="t.url" :width="t.width" :height="t.height" alt="" />
          <figcaption>{{ fmt(t.timeMs) }} s</figcaption>
        </figure>
      </div>
      <p v-if="silences">Pausas: {{ silences.map((s) => `${fmt(s.startMs)}–${fmt(s.endMs)} s`).join(', ') || 'ninguna' }}</p>
      <p v-if="encoders">Encoders: {{ encoders }}</p>
    </section>

    <section>
      <h2>Exportar este vídeo</h2>
      <div class="row">
        <select v-model="preset">
          <option v-for="p in domain.PRESET_IDS" :key="p" :value="p">{{ p }}</option>
        </select>
        <button :disabled="!info || busy" @click="exportOne">Exportar</button>
        <span v-if="exportProgress">
          {{ domain.formatPercent(exportProgress.fraction) }} · {{ domain.describeRemaining(exportProgress.remainingMs, exportProgress.done) }}
        </span>
      </div>
      <progress v-if="exportProgress" :value="exportProgress.fraction" max="1" />
      <div v-if="exportedPath" class="row">
        <span>{{ exportedPath }}</span>
        <button @click="run('Abrir', () => bridge.openFile(exportedPath!))">Abrir</button>
        <button @click="run('Mostrar', () => bridge.revealInFolder(exportedPath!))">Mostrar en la carpeta</button>
        <button @click="run('Copiado al portapapeles', () => bridge.copyFileToClipboard(exportedPath!))">Copiar para WhatsApp</button>
      </div>
    </section>

    <section>
      <h2>Proyecto y carpetas</h2>
      <div class="row">
        <button @click="run('Carpeta de salida', () => bridge.getOutputFolder())">Carpeta de salida</button>
        <button @click="run('Carpeta elegida', () => bridge.pickOutputFolder())">Elegir carpeta…</button>
        <button @click="run('Autoguardado', () => bridge.saveAutosave(JSON.stringify({ paths, savedAt: Date.now() })))">Autoguardar</button>
        <button @click="run('Autoguardado leído', () => bridge.loadAutosave())">Leer autoguardado</button>
        <button @click="run('Autoguardado borrado', () => bridge.clearAutosave())">Borrar autoguardado</button>
        <button :disabled="!selected" @click="run('¿Existe?', () => bridge.exists(selected!))">¿Existe el original?</button>
      </div>
    </section>

    <section>
      <h2>Cámara y micrófono</h2>
      <div class="row">
        <button :disabled="!!camera" @click="startCamera">Encender cámara</button>
        <button :disabled="!camera || !!recorder" @click="record(3)">Grabar 3 s</button>
        <button :disabled="!camera" @click="stopCamera">Apagar</button>
        <button v-if="recordedPath" @click="run('Mostrar', () => bridge.revealInFolder(recordedPath!))">Ver grabación</button>
      </div>
      <video v-show="camera" ref="cameraEl" class="camera" autoplay muted playsinline />
    </section>

    <section>
      <h2>Registro</h2>
      <pre class="log">{{ log.join('\n') }}</pre>
    </section>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
}
.diag {
  font-family: system-ui, sans-serif;
  padding: 12px 16px;
  color: #1b1f24;
  background: #f6f7f9;
  min-height: 100vh;
  box-sizing: border-box;
}
.diag.hovering {
  outline: 4px dashed #2b6cd6;
  outline-offset: -4px;
}
h1 {
  font-size: 20px;
  margin: 0 0 8px;
}
h2 {
  font-size: 15px;
  margin: 16px 0 6px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px;
}
button.active {
  font-weight: bold;
}
video {
  width: 100%;
  max-height: 360px;
  background: #000;
}
.camera {
  width: 320px;
}
pre {
  font-size: 12px;
  background: #fff;
  border: 1px solid #d5d9de;
  padding: 8px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.thumbs figure {
  margin: 0;
  font-size: 11px;
}
.warn {
  color: #b3261e;
}
progress {
  width: 100%;
}
</style>
