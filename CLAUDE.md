# easy-cut

Editor de vídeo doméstico para Windows, pensado para alguien no técnico: una tira de trozos que se cortan, parten, encuadran, aceleran o silencian, con «quitar pausas», teleprompter y exportación para WhatsApp, YouTube o calidad alta (o «Solo el sonido», un M4A). Un trozo puede ser un vídeo o un sonido (M4A, MP3, WAV…), y su «Imagen» decide qué se ve mientras suena: su vídeo, un fondo liso («Solo se oye») u otro vídeo encima, con su propio vídeo en pequeño en una esquina si se quiere. **Manda el trozo que se oye**: su duración, cortes, velocidad y sonido; lo de encima se adapta (corre en tiempo de salida, a velocidad normal, y se queda en su última imagen si se acaba). No hay segunda pista. ffmpeg/ffprobe (binarios externos, empaquetados como sidecar) hacen todo el trabajo de vídeo; la shell de escritorio es **Tauri 2** (`src-tauri/`), que los lanza. La UI es Vue 3.

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

Requiere Rust (rustup, MSVC). Antes del primer build, dejar ffmpeg y ffprobe en `src-tauri/binaries/` (sidecar; no se commitean). Para el instalador, la compilación fijada en `scripts/ffmpeg-build.json` (la descarga, comprueba el SHA-256 y extrae los dos ejecutables; es la misma que usa el workflow de release):

```powershell
pnpm fetch-ffmpeg -Download
```

Sin `-Download` copia los del PATH (para desarrollar con el ffmpeg que haya en el PC).

```powershell
pnpm tauri dev
```

```powershell
pnpm tauri build
```

El instalador NSIS queda en `src-tauri/target/release/bundle/nsis/`. Tests de Rust: `cargo test` dentro de `src-tauri`. El instalador que se publica se hace con `pnpm build-release` (firmado y con las rutas remapeadas; ver «Actualizaciones y releases»).

Prueba de humo de la app por CDP (WebView2 con depuración remota en el 4853). En una consola:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=4853 --mute-audio'
```

```powershell
pnpm tauri dev
```

Y en otra, con los clips de `test-output/`:

```powershell
node scripts/webview-smoke.mjs
```

**La app de desarrollo (`pnpm tauri dev`, compilación debug) no toca los datos de la instalada**: guarda en `Vídeos\Mis montajes (pruebas)` (y sus grabaciones en `…\Grabaciones`) y usa la subcarpeta `pruebas` dentro de la carpeta de datos (autoguardado) y de la caché (miniaturas, proxies, formas de onda). Lo decide `cfg!(debug_assertions)` en `commands.rs`; en release, todo como siempre. El `localStorage` (texto del teleprompter) ya va aparte porque el origen es otro (`localhost:4850` frente a `tauri.localhost`). Las pruebas e2e miran y limpian esa carpeta de pruebas.

Prueba de extremo a extremo de la interfaz (arranca y cierra ella misma la app, pulsa los botones reales, guarda y comprueba con ffprobe, cancela, reinicia la app y deja capturas en `test-output/screenshots/`; borra lo que guarda en «Mis montajes (pruebas)»). Con la app cerrada y `cargo` en el PATH:

```powershell
node scripts/ui-e2e.mjs
```

Prueba de extremo a extremo de «Imagen» y «Solo el sonido» (añadir un M4A, las tres opciones, vídeo de encima por el gancho de desarrollo, «Empieza en…», esquina y tamaño, partir, deshacer, reproducir midiendo la deriva del vídeo de encima, guardar «Para WhatsApp» y «Solo el sonido» con ffprobe, vídeo de encima borrado, duración a 1100 px; capturas `pic-*.png`). Necesita los ficheros de `pnpm test:ffmpeg`:

```powershell
node scripts/picture-e2e.mjs
```

Prueba de extremo a extremo del teleprompter (texto, ritmo, ensayo midiendo el avance, cámara, grabar con pausa, revisar, usar la grabación y comprobarla con ffprobe, «Repetir», solo la voz a M4A y «Usar esta grabación» → trozo de solo sonido → quitar pausas, cámara ocupada o ausente). Sin opciones usa la cámara y el micrófono de verdad y **no hace capturas**; con `--fake-media` usa los dispositivos falsos de WebView2 y deja las capturas `tp-*.png`. Borra lo que graba:

```powershell
node scripts/teleprompter-e2e.mjs --fake-media
```

Prueba de extremo a extremo de los atajos de teclado (eventos de teclado reales de CDP en cada pantalla, escribir en el texto del teleprompter sin que salte nada, espacio con un botón enfocado, Esc en las preguntas, Supr y deshacer, Ctrl+C / Ctrl+V de un trozo, pegar ficheros copiados en el Explorador con `Set-Clipboard -Path`, el panel «Teclas», y que cada tecla dibujada es un atajo que vale y se ve entera, también a 1100x700; capturas `keys-*.png`). Usa la cámara falsa, borra lo que guarda y graba y deja el portapapeles como estaba:

```powershell
node scripts/shortcuts-e2e.mjs
```

**Las pruebas no suenan**: los scripts que arrancan la app le pasan `--mute-audio` a WebView2 (`webviewArgs` de `scripts/cdp.mjs`, el único sitio); con `--with-sound` se oye. Solo quita la salida por los altavoces: `currentTime`, `MediaRecorder` y el medidor del micrófono funcionan igual.

**Las pruebas no roban el foco**: los scripts arrancan la app con `EASY_CUT_TEST=1` (`appTestEnv` de `scripts/cdp.mjs`), que solo en la compilación de desarrollo crea la ventana oculta y la enseña detrás de las demás sin activarla (`src-tauri/src/test_window.rs`; por eso la ventana va con `"create": false` en `tauri.conf.json` y se crea en `lib.rs`). Visible y sin minimizar, a propósito: minimizada, Chromium para `requestAnimationFrame` y los temporizadores. WebView2 lleva además `--disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion` para que tapada no se frene, y CDP activa `Emulation.setFocusEmulationEnabled` (la página se comporta como enfocada). Teclas y ratón van por `Input.dispatch*`, que no necesita el foco. Con `--foreground` se abre delante, como siempre. Ojo: `window.show()` de tao sí activa la ventana; hay que enseñarla con `SetWindowPos(…SWP_SHOWWINDOW | SWP_NOACTIVATE)`.

En desarrollo, `window.__easyCut` expone `bridge`, `domain`, `store`, `shortcuts()` (atajos que valen ahora), `liveTracks()` (pistas de cámara o micrófono encendidas) y `queuePickedVideos(rutas)` (sustituye a la siguiente apertura del diálogo de elegir vídeos, también el de «Elegir el vídeo» de encima); la pantalla de diagnóstico se abre con `?diagnostics`. En producción no existe ninguna de las dos cosas.

## Atajos de teclado

De **una sola tecla**, salvo las cuatro combinaciones de siempre (Ctrl+Z, Ctrl+Y, Ctrl+C, Ctrl+V). Cada botón con atajo lleva su tecla dibujada (`KeyHint`), y el botón «Teclas» (o **F1**, en todas partes, también escribiendo) abre la lista de la pantalla. Cada pantalla o diálogo declara los suyos con `useShortcuts` (`src/lib/use-shortcuts.ts`); la lógica es pura y con tests (`src/lib/shortcuts.ts`): capas por prioridad (pantalla < aviso < desplegable < diálogo < error < panel) y, con un diálogo abierto, solo valen los suyos. Un solo listener (en captura). Reglas:

- Con el foco en un cuadro de texto (o un desplegable) no vale ninguno: todo es del texto, también Ctrl+C / Ctrl+V / Ctrl+Z. Esc saca del cuadro; F1 sí vale.
- Con Alt, AltGr o la tecla Windows, nunca. Las letras van por `event.key` (teclado español); con Ctrl, también por `code`.
- Dejar la tecla pulsada solo repite las flechas (y deshacer/rehacer); Supr, partir, guardar… no.
- Espacio siempre es el atajo, aunque haya un botón con el foco (no se pulsan las dos cosas). Intro en un botón al que se llegó **con Tab** lo pulsa; uno que se tocó con el ratón no se vuelve a pulsar. No se usa `:focus-visible` para saberlo (Chromium la activa con cualquier tecla): se mira si el foco llegó con Tab.
- Esc: cierra el diálogo o el aviso abierto; si no hay y algo se está reproduciendo, para y vuelve al principio; si no, «Volver», con la pregunta de siempre donde la hay. En las preguntas destructivas, Intro es «No, volver» (y el foco empieza ahí).

| Pantalla | Teclas |
| --- | --- |
| Inicio | Intro «Hacer un vídeo nuevo» (pregunta si hay uno a medias) |
| Elige tus vídeos | Intro elegir · Ctrl+V pegar vídeos copiados en el Explorador · Esc Inicio |
| Tu vídeo | Espacio · Esc (parar y al 0 / Inicio) · Inicio / Fin · ← → 1 s · RePág / AvPág trozo anterior / siguiente · A arreglar · Supr quitar (con «Deshacer») · Ctrl+C / Ctrl+V · G guardar · Ctrl+Z / Ctrl+Y |
| Arreglar este trozo | Espacio · Esc (parar y al principio del trozo / volver) · Inicio / Fin del trozo · ← → 1 s · E / T / P (en «Cortar») · 1–6 pestañas · L o Intro «Listo» · Ctrl+Z / Ctrl+Y |
| Guardar | 1 2 3 las tarjetas · 4 «Solo el sonido» · Esc volver |
| Guardando | Esc «Cancelar» (pregunta) |
| ¡Listo! | Intro «Ver el vídeo» / «Escuchar» · Esc volver a tu vídeo |
| Teleprompter: texto | solo Esc (escribiendo, primero sale del texto) |
| Teleprompter: cámara | Intro «Empezar a grabar» · Esc volver al texto |
| Ensayar / grabar | Espacio pausa / sigue · ↑ ↓ más despacio / más rápido · ← retroceder · Esc dejar de ensayar / grabar (pregunta) · Intro terminar, solo cuando ya ha pasado todo el texto |
| Teleprompter: revisar | Espacio · Esc (parar y al 0 / salir, con pregunta) · Inicio / Fin · ← → · Intro «Usar esta grabación» |
| Preguntas | Esc cancelar · Intro la principal, o «No, volver» si es destructiva |
| Aviso de versión nueva (Inicio, «Tu vídeo») | Esc «Más tarde» (antes que el Esc de la pantalla) |
| Actualizar | Intro «Actualizar ahora» · Esc «Más tarde»; descargando, Esc «Cancelar»; si falla, Intro / Esc «Entendido» |

Copiar y pegar: Ctrl+C copia el trozo en la app (no toca el portapapeles de Windows); Ctrl+V pega detrás del elegido con todos sus ajustes (`duplicateClip` / `insertClipAfter`, un paso de deshacer). Si el portapapeles de Windows tiene vídeos o sonidos copiados en el Explorador **después** de copiar el trozo, Ctrl+V añade esos al final, como soltarlos. Se sabe por el número de secuencia del portapapeles (`GetClipboardSequenceNumber`), apuntado al copiar el trozo: unos ficheros viejos no ganan (`src/domain/paste.ts`). La lista de ficheros (CF_HDROP) se lee con Win32 en `src-tauri/src/clipboard.rs` (microsegundos, rutas en UTF-16). «Pegar» se activa mirando la secuencia cada 1,5 s y al volver a la ventana.

## Actualizaciones y releases

- **Actualizador**: plugins oficiales `tauri-plugin-updater` y `tauri-plugin-process` (Rust y JS; permisos mínimos en `capabilities/default.json`). `tauri.conf.json` → `plugins.updater`: endpoint `https://github.com/Krahegwen/easy-cut/releases/latest/download/latest.json`, la clave **pública** (`pubkey`) e instalación `passive` (barra de progreso sin preguntas; el instalador NSIS es por usuario, `installMode: currentUser`, sin administrador). `bundle.createUpdaterArtifacts: true` hace que la compilación firme el instalador (`.sig`).
- **Lógica** en `src/lib/updater.ts` (pura salvo los `ref` de Vue, con tests; el plugin entra por `UpdaterBackend`, implementado en `src/native/tauri-updater.ts`); la instancia, en `src/store/index.ts`. Solo en la compilación release (`updaterEnabled`: ni `tauri dev` ni el navegador). Primera comprobación 8 s después de arrancar, luego como mucho cada 6 h; si falla, solo un log. El aviso (`UpdateNotice`, en Inicio y en la columna derecha de «Tu vídeo») no sale fuera de esas dos pantallas ni con un guardado o la cámara/micrófono en marcha. «Más tarde» (Esc) lo oculta hasta el próximo arranque. «Actualizar ahora» abre `UpdateDialog`: pregunta (Intro / Esc), descarga con progreso real y «Cancelar» (el plugin no corta la descarga: se deja acabar y se descarta), escribe el autoguardado antes de descargar y otra vez justo antes de instalar, e instala; en Windows el instalador cierra la app y la vuelve a abrir (`/R`). Si falla (también una firma que no cuadra): «No se ha podido actualizar. No se ha perdido nada…» con «Copiar detalles», y no se vuelve a ofrecer en esa sesión. El pie de Inicio (`AppVersion`) enseña «Versión x.y.z» y «Buscar actualizaciones».
- **Versión**: una sola fuente para la app, `package.json` (`tauri.conf.json` tiene `"version": "../package.json"` y Vite la inyecta como `__APP_VERSION__`). `src-tauri/Cargo.toml` lleva la misma a mano (Cargo no la puede leer de fuera); `scripts/prepare-release.mjs` comprueba que las tres coinciden con la etiqueta. Para subirla: `package.json` y `Cargo.toml`, `cargo check` (actualiza `Cargo.lock`) y la sección nueva de `CHANGELOG.md`.
- **Clave privada** de firma: `%USERPROFILE%\.tauri\easy-cut.key`, sin contraseña. **No se versiona ni se imprime nunca.** En GitHub va como secret del repo `TAURI_SIGNING_PRIVATE_KEY` (el contenido del fichero). `scripts/build-release.ps1` la lee de ese fichero si la variable no está definida (y deja `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` vacía); sin clave, error. `tauri dev` no la necesita. **Si se pierde, las instalaciones que ya existen no podrán actualizarse nunca más** (solo aceptan lo firmado con ella): habría que publicar una versión con una clave nueva y que cada persona la instale a mano. Guardar una copia fuera de este PC.
- **ffmpeg fijado**: `scripts/ffmpeg-build.json` (URL, versión, rama, commit, SHA-256, licencia) lo leen `fetch-ffmpeg.ps1 -Download` y el workflow, así local y CI empaquetan el mismo. Es un autobuild **de fin de mes** de FFmpeg-Builds (los diarios se borran a las ~2 semanas; los de fin de mes duran unos 2 años). Cuando se borre, cambiar a otro de fin de mes (o replicar el zip como asset de una release propia, p. ej. `ffmpeg-bin`) y actualizar el hash.
- **Workflows**: `.github/workflows/ci.yml` (push a `main` y PR: tests, tipos, `vite build`, `cargo test` y `clippy -D warnings`; sidecars vacíos de relleno porque `tauri-build` exige que existan los de `externalBin`). `.github/workflows/release.yml` (etiqueta `v*`: comprueba etiqueta = versión, tests, ffmpeg fijado, `cargo test`, `build-release.ps1` con el secret, que el `.exe` no lleve rutas del runner, `scripts/prepare-release.mjs` → `Easy-Cut_<versión>_x64-setup.exe` + `.sig` + `latest.json` + notas desde `CHANGELOG.md`, y la release se crea en borrador, se suben los ficheros y se publica como «latest»; con `workflow_dispatch` solo deja un artifact). Acciones de terceros fijadas por SHA. Publicación a mano con `gh release`, no `tauri-action`: los nombres de los assets y `latest.json` salen de un script que también se ejecuta en local.
- **Probar el actualizador en local** sin tocar GitHub: compilar con `scripts/build-release.ps1 -Config <json>` con un `plugins.updater` que apunte a `http://127.0.0.1:4851/latest.json` y `dangerousInsecureTransportProtocol: true` (solo en esa config de prueba, nunca en `tauri.conf.json`), y generar el `latest.json` de la versión superior con `node scripts/prepare-release.mjs --base-url http://127.0.0.1:4851`.

## Pendientes

Viven en el vault: `proyectos/easy-cut/Pendientes.md`. No crear `TODO.md` en el repo.

## Mapa de carpetas

```
src/
  domain/            lógica pura (sin DOM ni Node)
    project.ts       modelo (MediaInfo con hasVideo, Clip con picture own/none/cover+inset), operaciones, conversión
                     de tiempos, JSON (versión 2; la 1 se migra al leerla)
    history.ts       deshacer/rehacer por instantáneas
    durations.ts     duraciones y frases en castellano («Te sobran 20 segundos»)
    probe.ts         args de ffprobe y parser → MediaInfo (rotación, HDR, fps; sonidos sin imagen, carátulas fuera)
    output.ts        presets whatsapp/youtube/high, tamaño (solo cuenta la imagen que se ve; sin ninguna, 1280×720 a
                     30 fps), fps, bitrate y peso; peso y tiempo de «Solo el sonido»
    encoders.ts      parámetros por encoder (nvenc/qsv/amf/libx264), prueba y fallback
    ffmpeg-args.ts   filter_complex y args de exportación (imagen de cada trozo según picture) y de «Solo el sonido»
    progress.ts      parser de -progress y tiempo restante
    silence.ts       silencedetect y rangos conservados («quitar pausas»)
    teleprompter.ts  guion (párrafos = pausa corta), ritmo y «¿cabe en la duración máxima?», scroll por palabras
                     (líneas medidas → posición), «vas bien / vas tarde»
    recording.ts     reloj sin pausas, formato del grabador, vídeo o solo voz, calidad pedida, nivel del micrófono,
                     errores de la cámara en llano, nombre de la grabación
    file-name.ts     «Vídeo del 25 de noviembre de 2026 (para WhatsApp).mp4», «Sonido del … .m4a», extensiones de
                     vídeo y de sonido
    transcode.ts     proxy de vista previa (540p; de un sonido, solo AAC), grabaciones → MP4 (vídeo) o M4A (solo voz),
                     duración por ffprobe
    playback.ts      plan de la vista previa: tiempo del vídeo ↔ trozo / rango / tiempo del original; tiempo del vídeo
                     de encima y cuándo recolocarlo (>150 ms)
    layout.ts        formas (horizontal/vertical/cuadrado), encuadre en el marco de la vista previa, color del fondo
                     liso y sitio y tamaño del vídeo en la esquina
    paste.ts         qué pega Ctrl+V: ficheros del Explorador más nuevos que el trozo copiado (por la secuencia
                     del portapapeles) o el trozo
  store/
    editor.ts        estado: proyecto + historial, originales (y vídeos de encima), pantalla, avisos, autoguardado,
                     proxies, miniaturas, formas de onda, «Elegir el vídeo» de encima, copiar y pegar trozos
    exporter.ts      guardar (vídeo o «Solo el sonido»): comprobación de originales, filtro en fichero, reintento con
                     libx264, borrar a medias
    save-flow.ts     pantallas Guardar / Guardando / ¡Listo!
    index.ts         instancia única (y `window.__easyCut` solo en desarrollo)
  lib/               confirmaciones, portapapeles, añadir y pegar vídeos, estado de «quitar pausas»,
                     shortcuts.ts (registro de atajos por capas, puro y con tests), use-shortcuts.ts (useShortcuts,
                     el único listener de teclado y el panel «Teclas»),
                     camera.ts (getUserMedia, dispositivos, medidor), recorder.ts (MediaRecorder → disco por partes),
                     teleprompter-settings.ts (texto y ajustes en localStorage),
                     updater.ts (cuándo comprobar, aviso, «Más tarde», descarga con progreso e instalar; con tests)
  components/        PreviewPlayer, ClipStrip, Filmstrip, DurationBar, TargetPicker, AppIcon (iconos SVG propios),
                     KeyHint (la tecla dibujada; el texto va en ::before), KeysButton y KeysPanel («Teclas», F1),
                     UpdateNotice, UpdateDialog y AppVersion (actualizaciones)…
    teleprompter/    PrompterRun (pantalla de ensayar/grabar: texto con translateY desde rAF), CameraSetup
  views/             Home, Pick, Editor («Tu vídeo»), ClipEditor («Arreglar este trozo», con la pestaña «Imagen»),
                     Save (tres tarjetas y «Solo el sonido»), Saving, Done,
                     Teleprompter (texto → cámara → grabar → revisar → trozo), Diagnostics (solo desarrollo)
  native/
    bridge.ts        interfaz NativeBridge (independiente de la plataforma)
    tauri-bridge.ts  implementación sobre Tauri (invoke + canales)
    browser-bridge.ts  versión mínima para abrir la UI en el navegador (errores claros)
    tauri-updater.ts UpdaterBackend sobre los plugins updater y process
    index.ts         exporta `bridge` (Tauri si hay __TAURI_INTERNALS__, si no el del navegador)
  App.vue, main.ts
src-tauri/           shell Tauri 2 (Rust)
  src/binaries.rs    resolución de ffmpeg/ffprobe: sidecar junto al .exe y, si no, PATH
  src/process.rs     procesos con array de args, sin consola, línea a línea, cancelación por trabajo
  src/job_object.rs  Job Object: si la app muere, mueren sus ffmpeg
  src/commands.rs    comandos invoke (miniaturas, formas de onda, caché, diálogos, autoguardado, grabaciones…);
                     carpetas aparte en desarrollo
  src/files.rs       nombres sin sobrescribir, clave de caché, tamaño de JPEG
  src/clipboard.rs   ficheros copiados en el Explorador (CF_HDROP) y secuencia del portapapeles, con Win32
  src/media_permissions.rs  cámara y micrófono concedidos sin diálogo (WebView2)
  src/test_window.rs  modo de pruebas (EASY_CUT_TEST=1, solo desarrollo): ventana detrás y sin quitar el foco
  capabilities/      permisos mínimos (solo los comandos propios y escuchar eventos)
.github/workflows/   ci.yml (tests, tipos, cargo test y clippy) y release.yml (etiqueta v* → release con latest.json)
scripts/
  fetch-ffmpeg.ps1   ffmpeg/ffprobe a src-tauri/binaries/: del PATH, o con -Download la compilación fijada
  ffmpeg-build.json  la compilación de ffmpeg que se empaqueta (URL, versión, commit, SHA-256, licencia)
  build-release.ps1  instalador firmado con rutas remapeadas (pnpm build-release; -Config para pruebas)
  prepare-release.mjs  assets de la release: instalador sin espacios, .sig, latest.json y notas (CHANGELOG.md)
  webview-smoke.mjs  prueba de humo de la app por CDP
  ui-e2e.mjs         prueba de extremo a extremo de la interfaz por CDP (cdp.mjs: cliente mínimo)
  teleprompter-e2e.mjs  prueba de extremo a extremo del teleprompter (--fake-media para las capturas)
  picture-e2e.mjs    prueba de extremo a extremo de «Imagen» y «Solo el sonido»
  shortcuts-e2e.mjs  prueba de extremo a extremo de los atajos de teclado y de copiar y pegar
tests/integration/   prueba con ffmpeg real (pnpm test:ffmpeg)
```

## Notas de Tauri / WebView2 comprobadas

- Vídeo: `<video :src="bridge.mediaUrl(path)">` (protocolo asset, `http://asset.localhost/…`). Seek y range requests funcionan, también con rutas con espacios y tildes y con un MP4 de 750 MB. El scope del protocolo asset es `**` (todo el disco): ffmpeg ya puede leer cualquier ruta, así que restringirlo no añadía seguridad.
- Un original que WebView2 no decodifica **no siempre da error**: un ProRes con audio PCM carga «bien» con `videoWidth === 0` (solo suena). Comprobar `error` **y** `videoWidth > 0` tras `loadedmetadata`; si falla, `makePreviewProxy`. Con un fichero de sonido (o un trozo cuya imagen no se ve) no se mira `videoWidth`: el mismo `<video>` lo reproduce; el proxy solo si da `error`.
- El vídeo de encima va en un segundo `<video muted>` que sigue el tiempo de salida del trozo y se recoloca si se separa más de 150 ms; `data-cover-ms` / `data-cover-expected-ms` del reproductor dan su posición real y la esperada (para las pruebas).
- HEVC se reproduce en este PC (tiene la extensión); en otro puede que no.
- CSP: `media-src`/`img-src` admiten `asset:`, `http://asset.localhost`, `blob:` y `mediastream:`. Nada de `<script>` en línea; estilos en línea sí (`style-src 'unsafe-inline'`).
- Arrastrar ficheros: con `dragDropEnabled` (por defecto) el webview **no** recibe los eventos HTML5 de soltar ficheros; usar `bridge.onFilesDropped`.
- Al cancelar una exportación, el MP4 a medias se queda en la carpeta del usuario: lo borra la UI con `deletePartialOutput` (solo .mp4 dentro de «Mis montajes»).
- Grabar: MediaRecorder de WebView2 (Chromium 158) admite `video/mp4;codecs=avc1.640028,mp4a.40.2`, que sabe su duración (el WebM no) y se revisa con seek; es el primero que se prueba. Para solo la voz, `audio/mp4` (AAC). Los datos se escriben al disco cada segundo (`beginRecording` → `recording_append`). `MediaRecorder.pause()` no deja hueco: tras pausar y seguir, el MP4 final dura lo grabado sin la pausa y audio y vídeo coinciden (±0,1 s, comprobado con cámara real y falsa).
- La cámara falsa de WebView2 (`--use-fake-device-for-media-stream`) da 1080p a 20 fps; la conversión la deja a 30 CFR.
- Teclado: el texto de `::before` (la tecla de `KeyHint`) no entra en `innerText` ni, con `aria-hidden`, en el nombre del botón; las pruebas que leen el texto de un botón no lo ven. `:focus-visible` se activa en cuanto se pulsa una tecla aunque el botón se tocara con el ratón (por eso el foco «de teclado» se mira con Tab). `Input.dispatchKeyEvent` de CDP con `text` escribe de verdad en un `<textarea>` y con `autoRepeat` llega como `event.repeat`.
- Portapapeles: `Set-Clipboard -LiteralPath` (PowerShell 5.1) deja los ficheros como CF_HDROP, igual que copiar en el Explorador; `DragQueryFileW` devuelve las rutas con tildes intactas. Leerlos por Win32, con el viaje de invoke incluido, tarda unos 3 ms (medido en la e2e); con `powershell -Command Get-Clipboard -Format FileDropList` eran ~300 ms (medido aquí).
- La tira de trozos se reordena con eventos de puntero, no con el arrastre HTML5 de elementos (con `dragDropEnabled` en Windows no es fiable, según los avisos de Tauri; no se ha comprobado aquí).

## Notas de ffmpeg comprobadas

- Las etiquetas BT.709 se ponen con `setparams` en el filtro: `-color_trc`/`-color_primaries` de salida no bastan si el fotograma llega sin especificar.
- Con muchos trozos o pausas quitadas, el filtro puede pasar del límite de 32 767 caracteres de Windows: usar `filterScriptPath` (`-/filter_complex fichero`, ffmpeg ≥ 7.1).
- Imagen de un trozo: `none` es `color=c=0x1c2229:s=W×H:r=F,trim=end_frame=N`; `cover` es otra entrada con `-ss` de entrada (nunca a menos de 250 ms de su final, para que haya fotogramas que repetir) y `tpad=stop_mode=clone:stop=N,trim=end_frame=N`, así dura lo mismo que el audio del trozo aunque se acabe antes; el sonido del vídeo de encima no se usa.
- Esquinas redondeadas del vídeo en la esquina: máscara `geq` calculada **una sola vez** (`color…,trim=end_frame=1,geq…,loop=loop=-1:size=1,trim,setpts=N/F/TB`) y `alphamerge`. Con `geq` por fotograma el mismo guardado tardaba ~6 veces más (medido: 3,8 s frente a 0,7 s en 10 s a 1080p).
- «Solo el sonido»: las entradas llevan `-vn` (no se lee el vídeo) y cada trozo tiene sus muestras exactas (`clipOutputMs × 48`), no redondeadas a fotogramas; guardar 30 s tarda ~0,6 s.
- NVENC va con opciones conservadoras para Pascal (GTX 1060): `-preset p5 -rc vbr -cq … -bf 2 -b_ref_mode disabled`, sin lookahead ni temporal AQ. Probado en una RTX, no en la GTX 1060.
