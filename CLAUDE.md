# easy-cut

Editor de vídeo doméstico para Windows, pensado para alguien no técnico: una tira de trozos que se cortan, parten, encuadran, aceleran o silencian, con «quitar pausas», teleprompter y exportación para WhatsApp, YouTube o calidad alta (o «Solo el sonido», un M4A). Un trozo puede ser un vídeo o un sonido (M4A, MP3, WAV…), y su «Imagen» decide qué se ve mientras suena: su vídeo, un fondo liso («Solo se oye») u otro vídeo encima, con su propio vídeo en pequeño en una esquina si se quiere. **Manda el trozo que se oye**: su duración, cortes, velocidad y sonido; lo de encima se adapta (corre en tiempo de salida, a velocidad normal, y se queda en su última imagen si se acaba). Debajo de la fila de trozos puede haber **pistas** de sonidos y de efectos (hasta 4 y 3), con elementos colocados en el tiempo y **pegados a un trozo** (ver «Pistas de sonidos y efectos»); la fila de trozos sigue mandando: sin huecos, su orden y su duración son los del vídeo. Hay una **biblioteca** de sonidos y efectos que se descargan bajo demanda (ver «Biblioteca»). ffmpeg/ffprobe (binarios externos, empaquetados como sidecar) hacen todo el trabajo de vídeo; la shell de escritorio es **Tauri 2** (`src-tauri/`), que los lanza. La UI es Vue 3.

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

Prueba de integración con el ffmpeg real del PATH (genera `test-output/`, tarda ~2 min; no corre en `pnpm test`). `tests/integration/tracks.itest.ts` monta pausas quitadas y trozos reordenados con música repetida, sonidos pegados a trozos, una pista silenciada, un efecto «como luz», uno con alfa y una imagen, y **mide** en el fichero dónde empieza cada sonido (±40 ms), que la pista silenciada no suena, que la voz no baja (con y sin pistas) y el color dentro y fuera de cada efecto (en `test-output/tracks/`):

```powershell
pnpm test:ffmpeg
```

La biblioteca (tanda propia y de terceros, en `library/dist/`, y sus entradas en `library/catalog.json`; con `--review`, hojas de contacto, espectros y niveles para revisarlos; la de terceros necesita los originales en `library/sources/`, ver `library/README.md`):

```powershell
node scripts/build-library.mjs --review
```

Que `library/dist/` cuadra con el catálogo y está lista para subir:

```powershell
pnpm library:check
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

Prueba de extremo a extremo de las pistas y la biblioteca (biblioteca con origen local `library/dist`: «Poner aquí» un sonido y un efecto, un sonido «De mi ordenador»; mover con imán, recortar, partir, duplicar, volumen, entrada suave, repetir; silenciar/ocultar pistas y la fila «Vídeo»; quitar pista y deshacer; quitar pausas en un trozo anterior, reordenar un trozo y quitar el trozo ancla; zoom; tarjetas/pistas; «Tamaño y sitio»; reproducir midiendo la sincronía de sonidos y efectos; guardar «Para WhatsApp» con ffprobe; créditos en «¡Listo!»; buscador y categorías con contador y nombres legibles; un sonido de Freesound y uno de Kenney guardados y medidos en el fichero (±40 ms); rendimiento con 5 minutos, 20 trozos, 3 pistas y 30 elementos; capturas `tracks-*.png` y `lib-*.png` a 1280×800 y 1100×700). Necesita los ficheros de `pnpm test:ffmpeg` y la biblioteca generada:

```powershell
node scripts/tracks-e2e.mjs
```

**Las pruebas no suenan**: los scripts que arrancan la app le pasan `--mute-audio` a WebView2 (`webviewArgs` de `scripts/cdp.mjs`, el único sitio); con `--with-sound` se oye. Solo quita la salida por los altavoces: `currentTime`, `MediaRecorder` y el medidor del micrófono funcionan igual.

**Las pruebas no roban el foco**: los scripts arrancan la app con `EASY_CUT_TEST=1` (`appTestEnv` de `scripts/cdp.mjs`), que solo en la compilación de desarrollo crea la ventana oculta y la enseña detrás de las demás sin activarla (`src-tauri/src/test_window.rs`; por eso la ventana va con `"create": false` en `tauri.conf.json` y se crea en `lib.rs`). Visible y sin minimizar, a propósito: minimizada, Chromium para `requestAnimationFrame` y los temporizadores. WebView2 lleva además `--disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion` para que tapada no se frene, y CDP activa `Emulation.setFocusEmulationEnabled` (la página se comporta como enfocada). Teclas y ratón van por `Input.dispatch*`, que no necesita el foco. Con `--foreground` se abre delante, como siempre. Ojo: `window.show()` de tao sí activa la ventana; hay que enseñarla con `SetWindowPos(…SWP_SHOWWINDOW | SWP_NOACTIVATE)`.

En desarrollo, `window.__easyCut` expone `bridge`, `domain`, `store`, `tracks`, `library`, `shortcuts()` (atajos que valen ahora), `liveTracks()` (pistas de cámara o micrófono encendidas) y `queuePickedVideos(rutas)` (sustituye a la siguiente apertura del diálogo de elegir vídeos, también el de «Elegir el vídeo» de encima); la pantalla de diagnóstico se abre con `?diagnostics`. En producción no existe ninguna de las dos cosas.

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
| Tu vídeo | Espacio · Esc (parar y al 0 / Inicio) · Inicio / Fin · ← → 1 s · RePág / AvPág trozo anterior / siguiente · A arreglar · Supr quitar (con «Deshacer») · Ctrl+C / Ctrl+V · G guardar · B «Añadir sonidos y efectos» · V tarjetas / pistas · + / - acercar / alejar (pistas) · Ctrl+Z / Ctrl+Y |
| Tu vídeo, con un sonido o efecto elegido (vista de pistas) | Esc dejar de elegirlo · Supr quitarlo · M que empiece en la línea · E / T que empiece / termine en la línea · P partir en la línea · D duplicar · R repetir · ↑ ↓ a la pista de arriba / abajo (del mismo tipo) |
| Volumen / Transparencia (desplegable) | ← → (↓ ↑) menos / más · Esc cerrar |
| Tamaño y sitio | Esc o Intro «Listo» · F pantalla completa |
| Biblioteca | Esc cerrar (si hay un aviso abierto, primero el aviso) · / buscar |
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

## Pistas de sonidos y efectos

- **Modelo** (`src/domain/project.ts`, versión 3 del proyecto; la 1 y la 2 se migran sin pistas): `Project.mainMuted` (silencia el sonido de todos los trozos) y `Project.tracks`: `{ id, kind: 'sound' | 'effect', name, muted, hidden, items }`. Hasta 4 pistas de sonido y 3 de efectos; el orden de las de efectos es el de apilado (la primera, encima; una nueva va encima). Cada `TrackItem`: `source` (`file` con ruta o `library` con `assetId`), `anchor`, `inMs`/`outMs` (trozo del original), `phaseMs` (por dónde va la vuelta si repite), `repeat`, `durationMs` (si repite o es una imagen fija; `null` = hasta el final del vídeo), `volume` 0–1,5, `fadeInMs`/`fadeOutMs`, y en los efectos `look`: `mix` (`normal` | `light` = «Como luz», screen), `opacity`, `box` `{ x, y, scale }` (centro relativo al marco y tamaño; 1 = `fit` en el marco) y `fit` (`cover` | `contain`).
- **Anclaje al trozo, no al tiempo**: `anchor = { clipId, offsetMs }` (tiempo de salida de ese trozo) o `{ clipId: null, offsetMs }` (desde el principio). El tiempo absoluto se resuelve con la fila de trozos (`resolveTracks`, `src/domain/tracks.ts`). Reglas: reordenar un trozo se lleva lo suyo; quitar pausas de otro no lo descoloca; si el trozo ancla se acorta, se sujeta a su final (el offset se guarda: al alargarlo vuelve); al partir el trozo, cada elemento se queda con la parte donde cae su inicio (`splitClip`); al quitarlo, lo pegado se queda en el mismo sitio del vídeo pegado al trozo que haya ahí (`removeClip`) y se avisa («2 sonidos estaban pegados a este trozo…»), en un solo paso de deshacer. Copiar y pegar un trozo **no** duplica lo que lleva pegado. La música «de fondo» (repite hasta el final y empieza en el 0) se pega al principio del vídeo (`clipId: null`). Lo que pasa del final del vídeo se ve atenuado y se corta al guardar.
- **Edición** (puro, en `tracks.ts`): `insertItem` («Poner aquí»: primera pista del tipo con sitio, si no una nueva, si no a continuación), `moveItem` (reancla al trozo de debajo; si pisa a otro, a continuación; si no cabe, no se mueve), `trimItemStart` / `trimItemEnd` (sin repetir, hasta el original; repitiendo, libre), `splitItem`, `duplicateItem`, `setItemRepeat` (un efecto repite su fichero entero), imanes (`snapPoints`: trozos, cabezal, otros elementos; `snapMove`, `snapTime`). Sin solapes dentro de una pista al soltar.
- **Guardar** (`ffmpeg-args.ts`): los tiempos se resuelven con los fotogramas enteros de cada trozo (`projectTiming(…, exportedClipDurationMs)`), así cada sonido cae donde su trozo en el fichero. Sonido: `atrim`/`-stream_loop -1` (fichero entero) o `aloop` (un trozo), `volume`, `afade` en muestras, `adelay` en muestras; mezcla `amix … normalize=0:duration=first` + `alimiter=limit=0.97:level=0:latency=1` + `apad/atrim` a las muestras exactas. Efectos: el vídeo montado se parte en tramos; solo los tramos con efectos pasan a RGB (`gbrp`, con matriz BT.709) y vuelven a `yuv420p`; dentro, por orden de pista: «Normal» con `overlay=…:format=gbrp:eof_action=pass` (alfa del fichero, `colorchannelmixer=aa` para la transparencia, `fade …:alpha=1`), «Como luz» con `blend=all_mode=screen:all_opacity=…:eof_action=pass` (recortado y sobre negro a pantalla completa, `fade` a negro). Cada efecto entra con `setpts=…+offset/TB` en su instante y solo se lee durante su tramo. WebM con alfa: `-c:v libvpx-vp9` (o `libvpx`) delante de `-i`. Imagen fija: `-loop 1 -framerate F -t …`. «Solo el sonido» lleva también las pistas.
- **Vista previa** (`components/TrackLayers.vue`, dentro del marco de `PreviewPlayer` con la prop `tracks`): `<audio>` por sonido (como mucho 8 montados: los que suenan o empiezan en los próximos 3 s), recolocados si se separan más de 150 ms del reloj del montaje; volumen y suaves en vivo (el navegador no pasa del 100 %: lo de más solo se oye al guardar). Efectos en `<video>`/`<img>` con `mix-blend-mode: screen` («Como luz»), opacidad y suaves. `data-sync` del contenedor y `data-item-id` de cada elemento, para las pruebas. «Tamaño y sitio»: recuadro sobre la vista previa (arrastrar mueve, las esquinas cambian el tamaño).
- **Interfaz**: «Tu vídeo» sin pistas es la de siempre; en la columna derecha, el panel «Sonidos y efectos» con «Añadir sonidos y efectos» (B) y, con pistas, «Ver abajo: Tarjetas / Pistas» (V). Al poner lo primero, abajo pasa a la vista de pistas (`components/tracks/TracksView.vue`): zoom en la esquina (−, +, ver todo; Ctrl + rueda), regla (pulsar o arrastrar para mover la línea), filas de efectos encima de «Vídeo» y de sonido debajo, cabeceras con nombre (se cambia pulsándolo), «Silenciar» / «Ocultar» y quitar pista. La barra del elemento elegido (`ItemBar.vue`) va siempre en una línea (con poco ancho, botones en icono y tecla). La biblioteca (`LibraryPanel.vue`) ocupa la columna derecha entera (la vista previa y las pistas siguen a la vista). Con la vista de pistas o la biblioteca abierta, soltar o pegar ficheros los pone en las pistas, en la línea.

## Biblioteca

- `library/catalog.json` (versionado, empaquetado con la app): categorías y elementos con `file`, `sha256`, `bytes`, `durationMs`, formato, `defaults` (mezcla, repetir, volumen, tamaño…), `license` (`own` | `CC0-1.0` | `CC-BY-3.0` | `CC-BY-4.0`), `author`, `sourceUrl`, `attribution` (texto exacto si la licencia lo pide). `validateCatalog` (`src/domain/library.ts`) lo comprueba; el test `library.test.ts` valida el del repo. Reglas de licencia y cómo añadir material: `library/README.md`.
- Los ficheros van como assets de la release `library-v1` (`baseUrl` del catálogo), no en el repo ni en el instalador. `src-tauri/src/library.rs`: `library_fetch` (descarga a la caché `…\library\<sha16>-<fichero>`, solo https de `github.com`, `objects.githubusercontent.com` y `release-assets.githubusercontent.com`, también en cada redirección; nombres saneados; 3 intentos; progreso por canal; cancelación con `cancel_job`; comprueba tamaño y SHA-256; nada se ejecuta), `library_status` (lo ya descargado, sin red) y `library_catalog` (el de la release si es JSON, guardado en caché; si no, el último). En la interfaz (`src/store/library.ts`) el catálogo descargado solo sustituye al empaquetado si es válido y de `revision` mayor. La información de cada elemento sale del catálogo (sin ffprobe).
- **Hasta que exista la release**: la app de desarrollo copia los ficheros de `library/dist/` (o de `EASY_CUT_LIBRARY_DIR`) a la caché, con la misma comprobación del SHA-256; la instalada no mira nunca esa carpeta. `library/dist/` está en `.gitignore`.
- La tanda propia (todo `own`, publicado CC0) la genera `scripts/build-library.mjs`: efectos «como luz» sobre negro dibujados en JS (partículas con suma de luz y un halo con `gblur` en RGB; las llamas, con sprites del Particle Pack de Kenney, `scripts/library-particles.mjs`) y codificados en H.264 1080p30; corazones en WebM VP9 con alfa; viñeta y marco en PNG con alfa; sonidos sintetizados a M4A. Lo que repite enlaza sin salto (movimiento periódico). Cada efecto trae una vista previa de 480×270.
- La **tanda de terceros** (CC0 de Freesound y Kenney, ~110 sonidos) sale de `library/third-party.json` con el mismo script (`--import-only` para solo esa; el trabajo, en `scripts/library-import.mjs`): tramo, mono si lo es, recorte de silencios, microfundidos, volumen igualado (−16 LUFS / −1 dBTP para todos los sonidos, también los propios; lo muy corto por pico) y M4A. Los originales van en `library/sources/` (ignorada). Nombres en castellano que dicen qué es y en qué se distingue; `findNameClashes` (en `validateCatalog`) no deja nombres iguales, casi iguales ni con número de serie. Cada sonido lleva `description` (se ve en la tarjeta) y `channels`; lo de terceros, `thanks` y `verifiedOn`. El script deja también `dist/catalog.json` y `dist/CREDITS.md`, y quita de `dist/` lo que ya no está; `pnpm library:check` comprueba que `dist/` cuadra con el catálogo (y el comando para publicar la release está en `library/README.md`).
- **Buscador y categorías** (`searchLibrary`, `countByCategory`): sin tildes ni mayúsculas, en nombre, descripción, categoría y etiquetas; cada categoría lleva su contador (con lo que se busca) y, buscando, solo salen las que tienen algo.
- **Errores de descarga**: `library_fetch` empieza el mensaje con `offline:`, `missing:` (4xx, sobre todo 404) o `mismatch:` (tamaño o SHA-256); `libraryFetchMessage` / `librarySaveMessage` dan un mensaje llano distinto para cada uno.
- **Créditos** (`projectCredits`, `libraryCredits`, `libraryThanks`, `creditsText`): «¡Listo!» los enseña con «Copiar los créditos» si el vídeo usa algo que pida atribución (lo CC0 no); «Créditos de la biblioteca» (en el pie de la biblioteca) enseña eso y, aparte, los agradecimientos de todo lo de terceros.

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
    project.ts       modelo (MediaInfo con hasVideo, Clip con picture own/none/cover+inset, pistas y elementos con su
                     anclaje), operaciones, conversión de tiempos, JSON (versión 3; la 1 y la 2 se migran al leerlas)
    tracks.ts        pistas: resolver anclajes, poner, mover, recortar, partir, duplicar, sin solapes, imanes, suaves
    library.ts       catálogo de la biblioteca: validación, búsqueda, valores de serie, URL permitidas y créditos
    history.ts       deshacer/rehacer por instantáneas
    durations.ts     duraciones y frases en castellano («Te sobran 20 segundos»)
    probe.ts         args de ffprobe y parser → MediaInfo (rotación, HDR, fps; sonidos sin imagen, carátulas fuera)
    output.ts        presets whatsapp/youtube/high, tamaño (solo cuenta la imagen que se ve; sin ninguna, 1280×720 a
                     30 fps), fps, bitrate y peso; peso y tiempo de «Solo el sonido»
    encoders.ts      parámetros por encoder (nvenc/qsv/amf/libx264), prueba y fallback
    ffmpeg-args.ts   filter_complex y args de exportación (imagen de cada trozo según picture; mezcla de los sonidos y
                     efectos por tramos) y de «Solo el sonido»
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
    save-flow.ts     pantallas Guardar / Guardando / ¡Listo! (antes, trae lo de la biblioteca que falte)
    tracks.ts        pistas en la interfaz: elegido, vista tarjetas/pistas, biblioteca abierta, poner (biblioteca y
                     ordenador), arrastres con preview/commit, silenciar/ocultar, quitar pista, «Probar sobre mi vídeo»
    library.ts       catálogo (empaquetado o más nuevo), lo descargado, descargas con progreso, información de cada elemento
    index.ts         instancia única (y `window.__easyCut` solo en desarrollo)
  lib/               confirmaciones, portapapeles, añadir y pegar vídeos, estado de «quitar pausas»,
                     shortcuts.ts (registro de atajos por capas, puro y con tests), use-shortcuts.ts (useShortcuts,
                     el único listener de teclado y el panel «Teclas»),
                     camera.ts (getUserMedia, dispositivos, medidor), recorder.ts (MediaRecorder → disco por partes),
                     teleprompter-settings.ts (texto y ajustes en localStorage),
                     updater.ts (cuándo comprobar, aviso, «Más tarde», descarga con progreso e instalar; con tests)
  components/        PreviewPlayer, ClipStrip, Filmstrip, DurationBar, TargetPicker, AppIcon (iconos SVG propios),
                     KeyHint (la tecla dibujada; el texto va en ::before), KeysButton y KeysPanel («Teclas», F1),
                     UpdateNotice, UpdateDialog y AppVersion (actualizaciones), TrackLayers (sonidos y efectos en la
                     vista previa y «Tamaño y sitio»)…
    teleprompter/    PrompterRun (pantalla de ensayar/grabar: texto con translateY desde rAF), CameraSetup
    tracks/          TracksView (vista de pistas), TrackHeader, ItemBar (barra del elemento elegido), LibraryPanel
                     (biblioteca y «De mi ordenador»), CreditsDialog
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
  src/library.rs     biblioteca: descarga bajo demanda (hosts permitidos, SHA-256, reintentos, progreso, cancelación),
                     lo ya descargado y el catálogo de la release; en desarrollo, la carpeta library/dist
library/             catalog.json y third-party.json (versionados), README.md (reglas, cómo añadir y publicar);
                     dist/ (ficheros, ignorada), sources/ (originales de terceros, ignorada)
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
  tracks-e2e.mjs     prueba de extremo a extremo de las pistas, la biblioteca y los créditos (capturas tracks-*.png)
  build-library.mjs  genera la biblioteca (tanda propia y de terceros) en library/dist, el catálogo y CREDITS.md
  library-import.mjs  tanda de terceros (library/third-party.json → M4A nivelados) y el nivelado común
  library-particles.mjs  sprites del Particle Pack de Kenney para los efectos
  check-library.mjs  pnpm library:check: library/dist cuadra con el catálogo (ficheros, tamaños, SHA-256)
tests/integration/   pruebas con ffmpeg real (pnpm test:ffmpeg): export.itest.ts y tracks.itest.ts (pistas, medidas)
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
- `blend=all_mode=screen` hay que hacerlo en RGB (`gbrp`): en YUV mezcla también los planos de color y el negro sale morado (pasó al generar la biblioteca). Por eso los tramos con efectos pasan a `gbrp` con `scale=in_color_matrix=bt709:in_range=tv` y vuelven con `out_color_matrix=bt709:out_range=tv`; el resto del vídeo no se convierte.
- `overlay` y `blend` (framesync) dejan pasar la imagen de debajo tal cual antes del primer fotograma del de encima (con `setpts=…+t/TB`) y, con `eof_action=pass`, después del último (comprobado: fotogramas 0–44 sin tocar y desde el 75 otra vez sin tocar con un efecto de 1,5 a 2,5 s).
- `amix … normalize=0` suma sin bajar ninguna entrada (la voz medida con y sin música: −21,075 dB en los dos casos). `alimiter` necesita `level=0` (si no, normaliza hacia arriba) y `latency=1` (si no, retrasa todo lo que dura el ataque). `adelay=delays=NS:all=1` en muestras: los sonidos medidos en el fichero empiezan a ±1 ms de lo que dice el modelo.
- `aloop` guarda la vuelta en memoria (vale para un trozo de un sonido); un efecto que repite usa `-stream_loop -1` con el fichero entero (`loop` de vídeo con 1080p ocuparía cientos de MB).
- NVENC va con opciones conservadoras para Pascal (GTX 1060): `-preset p5 -rc vbr -cq … -bf 2 -b_ref_mode disabled`, sin lookahead ni temporal AQ. Probado en una RTX, no en la GTX 1060.
