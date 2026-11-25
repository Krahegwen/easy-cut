# easy-cut

Editor de vídeo doméstico para Windows, pensado para alguien no técnico: una tira de trozos que se cortan, parten, encuadran, aceleran o silencian, con «quitar pausas», teleprompter y exportación para WhatsApp, YouTube o calidad alta. ffmpeg/ffprobe (binarios externos, empaquetados como sidecar) hacen todo el trabajo de vídeo; la shell de escritorio es **Tauri 2** (`src-tauri/`), que los lanza. La UI es Vue 3.

## Reglas

- **pnpm** (versión fijada en `packageManager`). Nada de npm, yarn ni bun. `pnpm-workspace.yaml` lleva `minimumReleaseAge: 4320` y `allowBuilds` explícito: no bajar el plazo; si una versión nueva no instala, usar una anterior.
- Vue 3 + Vite + TypeScript estricto + Vitest. Sin router ni extras hasta que hagan falta.
- **Código en inglés** (identificadores, ficheros, tipos, ramas, URL). **Comentarios y logs en castellano.** Textos de interfaz en castellano llano.
- El dueño usa **Windows PowerShell 5.1**: en documentación y scripts, nada de `&&` ni `||`; un comando por línea.
- ffmpeg siempre con **array de argumentos** (`spawn`/`execFile`), nunca una cadena para el shell.
- `src/domain/` es puro: sin DOM ni Node, todo testeable en Vitest. Tiempos en **milisegundos enteros**. Operaciones inmutables.
- Los originales nunca se modifican.
- Identidad git local del repo: `Krahegwen <15855474+Krahegwen@users.noreply.github.com>`.

## Puertos (con `strictPort: true`)

| Uso     | Puerto |
| ------- | ------ |
| dev     | 4850   |
| e2e     | 4851   |
| preview | 4852   |

Nunca 5173/4173.

## Comandos

```powershell
pnpm install
```

```powershell
pnpm test
```

```powershell
pnpm typecheck
```

Prueba de integración con el ffmpeg real del PATH (genera `test-output/`, tarda ~1 min; no corre en `pnpm test`):

```powershell
pnpm test:ffmpeg
```

### App de escritorio (Tauri 2)

Requiere Rust (rustup, MSVC). Antes del primer build, copiar ffmpeg y ffprobe del PATH a `src-tauri/binaries/` (sidecar; no se commitean):

```powershell
pnpm fetch-ffmpeg
```

```powershell
pnpm tauri dev
```

```powershell
pnpm tauri build
```

El instalador NSIS queda en `src-tauri/target/release/bundle/nsis/`. Tests de Rust: `cargo test` dentro de `src-tauri`.

Prueba de humo de la app por CDP (WebView2 con depuración remota en el 4853). En una consola:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=4853'
```

```powershell
pnpm tauri dev
```

Y en otra, con los clips de `test-output/`:

```powershell
node scripts/webview-smoke.mjs
```

Prueba de extremo a extremo de la interfaz (arranca y cierra ella misma la app, pulsa los botones reales, guarda y comprueba con ffprobe, cancela, reinicia la app y deja capturas en `test-output/screenshots/`; borra lo que guarda en «Mis montajes»). Con la app cerrada y `cargo` en el PATH:

```powershell
node scripts/ui-e2e.mjs
```

Prueba de extremo a extremo del teleprompter (texto, ritmo, ensayo midiendo el avance, cámara, grabar con pausa, revisar, usar la grabación y comprobarla con ffprobe, «Repetir», solo la voz a M4A, cámara ocupada o ausente). Sin opciones usa la cámara y el micrófono de verdad y **no hace capturas**; con `--fake-media` usa los dispositivos falsos de WebView2 y deja las capturas `tp-*.png`. Borra lo que graba:

```powershell
node scripts/teleprompter-e2e.mjs --fake-media
```

En desarrollo, `window.__easyCut` expone `bridge`, `domain`, `store`, `liveTracks()` (pistas de cámara o micrófono encendidas) y `queuePickedVideos(rutas)` (sustituye al diálogo de elegir vídeos); la pantalla de diagnóstico se abre con `?diagnostics`. En producción no existe ninguna de las dos cosas.

## Pendientes

Viven en el vault: `proyectos/easy-cut/Pendientes.md`. No crear `TODO.md` en el repo.

## Mapa de carpetas

```
src/
  domain/            lógica pura (sin DOM ni Node)
    project.ts       modelo (MediaInfo, Clip, Project), operaciones, conversión de tiempos, JSON
    history.ts       deshacer/rehacer por instantáneas
    durations.ts     duraciones y frases en castellano («Te sobran 20 segundos»)
    probe.ts         args de ffprobe y parser → MediaInfo (rotación, HDR, fps)
    output.ts        presets whatsapp/youtube/high, tamaño, fps, bitrate y peso
    encoders.ts      parámetros por encoder (nvenc/qsv/amf/libx264), prueba y fallback
    ffmpeg-args.ts   filter_complex y args de exportación
    progress.ts      parser de -progress y tiempo restante
    silence.ts       silencedetect y rangos conservados («quitar pausas»)
    teleprompter.ts  guion (párrafos = pausa corta), ritmo y «¿cabe en la duración máxima?», scroll por palabras
                     (líneas medidas → posición), «vas bien / vas tarde»
    recording.ts     reloj sin pausas, formato del grabador, vídeo o solo voz, calidad pedida, nivel del micrófono,
                     errores de la cámara en llano, nombre de la grabación
    file-name.ts     «Vídeo del 25 de noviembre de 2026 (para WhatsApp).mp4», extensiones de vídeo
    transcode.ts     proxy de vista previa (540p), grabaciones → MP4 (vídeo) o M4A (solo voz), duración por ffprobe
    playback.ts      plan de la vista previa: tiempo del vídeo ↔ trozo / rango / tiempo del original
    layout.ts        formas (horizontal/vertical/cuadrado) y encuadre del trozo en el marco de la vista previa
  store/
    editor.ts        estado: proyecto + historial, originales, pantalla, avisos, autoguardado, proxies, miniaturas
    exporter.ts      guardar: comprobación de originales, filtro en fichero, reintento con libx264, borrar a medias
    save-flow.ts     pantallas Guardar / Guardando / ¡Listo!
    index.ts         instancia única (y `window.__easyCut` solo en desarrollo)
  lib/               confirmaciones, portapapeles, atajos, añadir vídeos, estado de «quitar pausas»,
                     camera.ts (getUserMedia, dispositivos, medidor), recorder.ts (MediaRecorder → disco por partes),
                     teleprompter-settings.ts (texto y ajustes en localStorage)
  components/        PreviewPlayer, ClipStrip, Filmstrip, DurationBar, TargetPicker, AppIcon (iconos SVG propios)…
    teleprompter/    PrompterRun (pantalla de ensayar/grabar: texto con translateY desde rAF), CameraSetup
  views/             Home, Pick, Editor («Tu vídeo»), ClipEditor («Arreglar este trozo»), Save, Saving, Done,
                     Teleprompter (texto → cámara → grabar → revisar → trozo), Diagnostics (solo desarrollo)
  native/
    bridge.ts        interfaz NativeBridge (independiente de la plataforma)
    tauri-bridge.ts  implementación sobre Tauri (invoke + canales)
    browser-bridge.ts  versión mínima para abrir la UI en el navegador (errores claros)
    index.ts         exporta `bridge` (Tauri si hay __TAURI_INTERNALS__, si no el del navegador)
  App.vue, main.ts
src-tauri/           shell Tauri 2 (Rust)
  src/binaries.rs    resolución de ffmpeg/ffprobe: sidecar junto al .exe y, si no, PATH
  src/process.rs     procesos con array de args, sin consola, línea a línea, cancelación por trabajo
  src/job_object.rs  Job Object: si la app muere, mueren sus ffmpeg
  src/commands.rs    comandos invoke (miniaturas, caché, diálogos, autoguardado, grabaciones…)
  src/files.rs       nombres sin sobrescribir, clave de caché, tamaño de JPEG
  src/media_permissions.rs  cámara y micrófono concedidos sin diálogo (WebView2)
  capabilities/      permisos mínimos (solo los comandos propios y escuchar eventos)
scripts/
  fetch-ffmpeg.ps1   copia ffmpeg/ffprobe del PATH a src-tauri/binaries/
  webview-smoke.mjs  prueba de humo de la app por CDP
  ui-e2e.mjs         prueba de extremo a extremo de la interfaz por CDP (cdp.mjs: cliente mínimo)
  teleprompter-e2e.mjs  prueba de extremo a extremo del teleprompter (--fake-media para las capturas)
tests/integration/   prueba con ffmpeg real (pnpm test:ffmpeg)
```

## Notas de Tauri / WebView2 comprobadas

- Vídeo: `<video :src="bridge.mediaUrl(path)">` (protocolo asset, `http://asset.localhost/…`). Seek y range requests funcionan, también con rutas con espacios y tildes y con un MP4 de 750 MB. El scope del protocolo asset es `**` (todo el disco): ffmpeg ya puede leer cualquier ruta, así que restringirlo no añadía seguridad.
- Un original que WebView2 no decodifica **no siempre da error**: un ProRes con audio PCM carga «bien» con `videoWidth === 0` (solo suena). Comprobar `error` **y** `videoWidth > 0` tras `loadedmetadata`; si falla, `makePreviewProxy`.
- HEVC se reproduce en este PC (tiene la extensión); en otro puede que no.
- CSP: `media-src`/`img-src` admiten `asset:`, `http://asset.localhost`, `blob:` y `mediastream:`. Nada de `<script>` en línea; estilos en línea sí (`style-src 'unsafe-inline'`).
- Arrastrar ficheros: con `dragDropEnabled` (por defecto) el webview **no** recibe los eventos HTML5 de soltar ficheros; usar `bridge.onFilesDropped`.
- Al cancelar una exportación, el MP4 a medias se queda en la carpeta del usuario: lo borra la UI con `deletePartialOutput` (solo .mp4 dentro de «Mis montajes»).
- Grabar: MediaRecorder de WebView2 (Chromium 158) admite `video/mp4;codecs=avc1.640028,mp4a.40.2`, que sabe su duración (el WebM no) y se revisa con seek; es el primero que se prueba. Para solo la voz, `audio/mp4` (AAC). Los datos se escriben al disco cada segundo (`beginRecording` → `recording_append`). `MediaRecorder.pause()` no deja hueco: tras pausar y seguir, el MP4 final dura lo grabado sin la pausa y audio y vídeo coinciden (±0,1 s, comprobado con cámara real y falsa).
- La cámara falsa de WebView2 (`--use-fake-device-for-media-stream`) da 1080p a 20 fps; la conversión la deja a 30 CFR.
- La tira de trozos se reordena con eventos de puntero, no con el arrastre HTML5 de elementos (con `dragDropEnabled` en Windows no es fiable, según los avisos de Tauri; no se ha comprobado aquí).

## Notas de ffmpeg comprobadas

- Las etiquetas BT.709 se ponen con `setparams` en el filtro: `-color_trc`/`-color_primaries` de salida no bastan si el fotograma llega sin especificar.
- Con muchos trozos o pausas quitadas, el filtro puede pasar del límite de 32 767 caracteres de Windows: usar `filterScriptPath` (`-/filter_complex fichero`, ffmpeg ≥ 7.1).
- NVENC va con opciones conservadoras para Pascal (GTX 1060): `-preset p5 -rc vbr -cq … -bf 2 -b_ref_mode disabled`, sin lookahead ni temporal AQ. Probado en una RTX, no en la GTX 1060.
