# easy-cut

Editor de vídeo doméstico para Windows, pensado para alguien no técnico: una fila de trozos que se cortan, parten, encuadran, aceleran o silencian, con «quitar pausas», teleprompter y exportación para WhatsApp, YouTube o calidad alta (o «Solo el sonido», un M4A). Un trozo puede ser un vídeo o un sonido (M4A, MP3, WAV…), y su «Imagen» decide qué se ve mientras suena: su vídeo, un fondo liso («Solo se oye») u otro vídeo encima, con su propio vídeo en pequeño en una esquina si se quiere. **Manda el trozo que se oye**: su duración, cortes, velocidad y sonido; lo de encima se adapta (corre en tiempo de salida, a velocidad normal, y se queda en su última imagen si se acaba). Encima y debajo de la fila de trozos («Vídeo») puede haber **pistas** de efectos y de sonidos (sin límite), con elementos colocados en el tiempo y **pegados a un trozo** (ver «Pistas de sonidos y efectos»); la fila de trozos sigue mandando: sin huecos, su orden y su duración son los del vídeo. Hay una **biblioteca** de sonidos y efectos que se descargan bajo demanda (ver «Biblioteca»). ffmpeg/ffprobe (binarios externos, empaquetados como sidecar) hacen todo el trabajo de vídeo; la shell de escritorio es **Tauri 2** (`src-tauri/`), que los lanza. La UI es Vue 3.

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

**La app de desarrollo (`pnpm tauri dev`, compilación debug) no toca los datos de la instalada**: guarda en `Vídeos\Mis montajes (pruebas)` (y sus grabaciones en `…\Grabaciones`) y usa la subcarpeta `pruebas` dentro de la carpeta de datos (vídeos en marcha) y de la caché (miniaturas, proxies, formas de onda, biblioteca). Lo decide `cfg!(debug_assertions)` en `commands.rs`; en release, todo como siempre. El `localStorage` (texto del teleprompter) ya va aparte porque el origen es otro (`localhost:4850` frente a `tauri.localhost`). Las pruebas e2e empiezan y acaban con `window.__easyCut.resetProjects()`, que vacía la lista de vídeos de esa carpeta de pruebas.

Prueba de extremo a extremo de los ficheros y los proyectos (el autoguardado de antes pasa a la lista; Inicio con dos vídeos: abrir, cambiar el nombre, Esc que cancela, duplicar, borrar con su pregunta y «Deshacer», reiniciar la app y que sigan, deshacer tras reiniciar; «De mi ordenador» con usos, miniaturas y las tres acciones, y una imagen que no puede ser trozo; volver a enlazar originales movidos a otra carpeta: el aviso de uno que no cuadra, los de la misma carpeta de una vez, también un sonido de una pista, y deshacer; capturas `proj-*.png` a 1280×800 y 1100×700). Trabaja con copias en una carpeta temporal. Necesita los ficheros de `pnpm test:ffmpeg` y la biblioteca generada:

```powershell
node scripts/projects-e2e.mjs
```

Prueba de extremo a extremo de «Solo recortar» (Inicio → «Solo recortar un vídeo» → un vídeo de «móvil» con fotograma clave cada 2 s, rotación y ubicación → marcar con → / E / T → «Rápido» (la cifra de «Empezará 1,0 s antes», la zona rayada en la barra, reproducir desde ahí) y «Exacto», los dos con ffprobe (duración, primer paquete clave, sin ubicación, rotación) y su frase en «¡Listo!» → «Convertir en un vídeo normal» → en «Tu vídeo» con el corte y en la lista; un ProRes sin «Rápido»; teclas dibujadas; capturas `trim-*.png` a 1280×800 y 1100×700). Trabaja con una copia en una carpeta temporal y borra lo que guarda. Necesita `test-output/trim/` de `pnpm test:ffmpeg`:

```powershell
node scripts/trim-e2e.mjs
```

Prueba de extremo a extremo de la interfaz (arranca y cierra ella misma la app, pulsa los botones reales sobre la fila «Vídeo» —reordenar, recortar por las asas con el texto en vivo, E / T / P en la línea—, el divisor de la vista previa (tamaños fijos, arrastre, mínimos y que se recuerda), que las pistas van a todo el ancho y nada se sale a 1100–2000 px, el vídeo vacío, guarda y comprueba con ffprobe, cancela, reinicia la app y deja capturas en `test-output/screenshots/`; borra lo que guarda en «Mis montajes (pruebas)»). Con la app cerrada y `cargo` en el PATH:

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

Prueba de extremo a extremo de los atajos de teclado (eventos de teclado reales de CDP en cada pantalla, escribir en el texto del teleprompter sin que salte nada, espacio con un botón enfocado, Esc en las preguntas, E / T / P sobre el trozo elegido, Supr y deshacer, Ctrl+C / Ctrl+V de un trozo, pegar ficheros copiados en el Explorador con `Set-Clipboard -Path`, el panel «Teclas», y que cada tecla dibujada es un atajo que vale y se ve entera, también a 1100x700; capturas `keys-*.png`). Usa la cámara falsa, borra lo que guarda y graba y deja el portapapeles como estaba:

```powershell
node scripts/shortcuts-e2e.mjs
```

Prueba de extremo a extremo de las pistas y la biblioteca (biblioteca con origen local `library/dist`: «Poner aquí» un sonido y un efecto, un sonido «De mi ordenador»; mover con imán, recortar, partir, duplicar, volumen, entrada suave, repetir; silenciar/ocultar pistas y la fila «Vídeo»; quitar pista y deshacer; quitar pausas en un trozo anterior, reordenar un trozo y quitar el trozo ancla; zoom; indicadores de la fila «Vídeo»; recortar por delante el trozo ancla (lo pegado sigue a su imagen); que los botones de cada cabecera caben en su fila (getBoundingClientRect, a 1100–2400 px de ancho, con 3 y con 12 o más filas, desplazando); «Escuchar solo esta»; pistas nuevas a mano y pasar un sonido a otra; «Tamaño y sitio»; reproducir midiendo la sincronía de sonidos y efectos; guardar «Para WhatsApp» con ffprobe; créditos en «¡Listo!»; buscador y categorías con contador y nombres legibles; un sonido de Freesound y uno de Kenney guardados y medidos en el fichero (±40 ms); rendimiento con 5 minutos, 20 trozos y 12 pistas (8 sonidos a la vez sonando y 4 efectos viéndose en la vista previa) y el arrastre con 3 pistas y 30 elementos; capturas `tracks-*.png` y `lib-*.png` a 1280×800 y 1100×700). Necesita los ficheros de `pnpm test:ffmpeg` y la biblioteca generada:

```powershell
node scripts/tracks-e2e.mjs
```

**Las pruebas no suenan**: los scripts que arrancan la app le pasan `--mute-audio` a WebView2 (`webviewArgs` de `scripts/cdp.mjs`, el único sitio); con `--with-sound` se oye. Solo quita la salida por los altavoces: `currentTime`, `MediaRecorder` y el medidor del micrófono funcionan igual.

**Las pruebas no roban el foco**: los scripts arrancan la app con `EASY_CUT_TEST=1` (`appTestEnv` de `scripts/cdp.mjs`), que solo en la compilación de desarrollo crea la ventana oculta y la enseña detrás de las demás sin activarla (`src-tauri/src/test_window.rs`; por eso la ventana va con `"create": false` en `tauri.conf.json` y se crea en `lib.rs`). Visible y sin minimizar, a propósito: minimizada, Chromium para `requestAnimationFrame` y los temporizadores. WebView2 lleva además `--disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion` para que tapada no se frene, y CDP activa `Emulation.setFocusEmulationEnabled` (la página se comporta como enfocada). Teclas y ratón van por `Input.dispatch*`, que no necesita el foco. Con `--foreground` se abre delante, como siempre. Ojo: `window.show()` de tao sí activa la ventana; hay que enseñarla con `SetWindowPos(…SWP_SHOWWINDOW | SWP_NOACTIVATE)`.

En desarrollo, `window.__easyCut` expone `bridge`, `domain`, `store`, `tracks`, `library`, `cacheCleaner`, `trim`, `resetProjects()` (sin vídeos en marcha ni autoguardado de antes, en Inicio), `shortcuts()` (atajos que valen ahora), `liveTracks()` (pistas de cámara o micrófono encendidas) y `queuePickedVideos(rutas)` (sustituye a la siguiente apertura del diálogo de elegir vídeos, también el de «Elegir el vídeo» de encima); la pantalla de diagnóstico se abre con `?diagnostics`. En producción no existe ninguna de las dos cosas.

## Atajos de teclado

De **una sola tecla**, salvo las cuatro combinaciones de siempre (Ctrl+Z, Ctrl+Y, Ctrl+C, Ctrl+V). Cada botón con atajo lleva su tecla dibujada (`KeyHint`), y el botón «Teclas» (o **F1**, en todas partes, también escribiendo) abre la lista de la pantalla. Cada pantalla o diálogo declara los suyos con `useShortcuts` (`src/lib/use-shortcuts.ts`); la lógica es pura y con tests (`src/lib/shortcuts.ts`): capas por prioridad (pantalla < aviso < desplegable < diálogo < error < panel) y, con un diálogo abierto, solo valen los suyos. Un solo listener (en captura). Reglas:

- Con el foco en un cuadro de texto (o un desplegable) no vale ninguno: todo es del texto, también Ctrl+C / Ctrl+V / Ctrl+Z. Esc saca del cuadro; F1 sí vale.
- Con Alt, AltGr o la tecla Windows, nunca. Las letras van por `event.key` (teclado español); con Ctrl, también por `code`.
- Dejar la tecla pulsada solo repite las flechas (y deshacer/rehacer); Supr, partir, guardar… no.
- Espacio siempre es el atajo, aunque haya un botón con el foco (no se pulsan las dos cosas). Intro en un botón al que se llegó **con Tab** lo pulsa; uno que se tocó con el ratón no se vuelve a pulsar. No se usa `:focus-visible` para saberlo (Chromium la activa con cualquier tecla): se mira si el foco llegó con Tab.
- Esc: cierra el diálogo o el aviso abierto; si no hay y algo se está reproduciendo, para y vuelve al principio; si no, «Volver», con la pregunta de siempre donde la hay. En las preguntas destructivas, Intro es «No, volver» (y el foco empieza ahí).

| Pantalla | Teclas |
| --- | --- |
| Inicio | Intro «Hacer un vídeo nuevo» (ya no pregunta: el abierto queda en la lista) · Tab + Intro abre un vídeo de la lista o pulsa sus botones (también «Solo recortar un vídeo») · el nombre: Intro guarda, Esc lo deja como estaba |
| Solo recortar | Espacio (desde donde empieza lo que se guarda, y para al final de lo marcado) · Esc (parar y a ese principio / Inicio) · Inicio / Fin · ← → 1 s · E «Empieza aquí» · T «Termina aquí» · 1 «Rápido» · 2 «Exacto» · G o Intro «Guardar» |
| Menú «Más cosas» de un vídeo (Inicio) | Esc cerrar |
| «Buscarlo» (el fichero no cuadra o hay más en la carpeta) | Intro «Usarlo igualmente» / «Usar los N» · Esc «Cancelar» |
| Elige tus vídeos | Intro elegir · Ctrl+V pegar vídeos copiados en el Explorador · Esc Inicio |
| Tu vídeo | Espacio · Esc (parar y al 0 / Inicio) · Inicio / Fin · ← → 1 s · RePág / AvPág trozo anterior / siguiente · A arreglar · Supr quitar (con «Deshacer») · Ctrl+C / Ctrl+V · G guardar · B «Añadir sonidos y efectos» · F vista previa a pantalla completa · + / - acercar / alejar (pistas) · Ctrl+Z / Ctrl+Y |
| Vista previa a pantalla completa | Esc o F salir (sin parar) · Espacio · Inicio / Fin · ← → 1 s · F1 (sale y enseña «Teclas») |
| Tu vídeo, con un trozo elegido y ningún sonido o efecto elegido | E / T que el trozo empiece / termine en la línea · P partirlo en la línea (solo con la línea dentro del trozo; la barra de abajo dice cuál) |
| Tu vídeo, con un sonido o efecto elegido (vista de pistas) | Esc dejar de elegirlo · Supr quitarlo · M que empiece en la línea · E / T que empiece / termine en la línea · P partir en la línea · D duplicar · R repetir · ↑ ↓ a la pista de arriba / abajo (del mismo tipo) |
| Volumen / Transparencia (desplegable) | ← → (↓ ↑) menos / más · Esc cerrar |
| Tamaño y sitio | Esc o Intro «Listo» · F pantalla completa |
| Biblioteca | Esc cerrar (si hay un aviso abierto, primero el aviso) · / buscar |
| Arreglar este trozo | Espacio · Esc (parar y al principio del trozo / volver) · Inicio / Fin del trozo · ← → 1 s · E / T / P (en «Cortar») · 1–6 pestañas · L o Intro «Listo» · Ctrl+Z / Ctrl+Y |
| Guardar | 1 2 3 las tarjetas · 4 «Solo el sonido» · Esc volver |
| Guardando | Esc «Cancelar» (pregunta) |
| ¡Listo! | Intro «Ver el vídeo» / «Escuchar» · Esc volver a tu vídeo (o a «Solo recortar», si se guardó desde allí) |
| Teleprompter: texto | solo Esc (escribiendo, primero sale del texto) |
| Teleprompter: cámara | Intro «Empezar a grabar» · Esc volver al texto |
| Ensayar / grabar | Espacio pausa / sigue · ↑ ↓ más despacio / más rápido · ← retroceder · Esc dejar de ensayar / grabar (pregunta) · Intro terminar, solo cuando ya ha pasado todo el texto |
| Teleprompter: revisar | Espacio · Esc (parar y al 0 / salir, con pregunta) · Inicio / Fin · ← → · Intro «Usar esta grabación» |
| Preguntas | Esc cancelar · Intro la principal, o «No, volver» si es destructiva |
| Aviso de versión nueva (Inicio, «Tu vídeo») | Esc «Más tarde» (antes que el Esc de la pantalla) |
| Actualizar | Intro «Actualizar ahora» · Esc «Más tarde»; descargando, Esc «Cancelar»; si falla, Intro / Esc «Entendido» |

Copiar y pegar: Ctrl+C copia el trozo en la app (no toca el portapapeles de Windows); Ctrl+V pega detrás del elegido con todos sus ajustes (`duplicateClip` / `insertClipAfter`, un paso de deshacer). Si el portapapeles de Windows tiene vídeos o sonidos copiados en el Explorador **después** de copiar el trozo, Ctrl+V añade esos al final, como soltarlos. Se sabe por el número de secuencia del portapapeles (`GetClipboardSequenceNumber`), apuntado al copiar el trozo: unos ficheros viejos no ganan (`src/domain/paste.ts`). La lista de ficheros (CF_HDROP) se lee con Win32 en `src-tauri/src/clipboard.rs` (microsegundos, rutas en UTF-16). «Pegar» se activa mirando la secuencia cada 1,5 s y al volver a la ventana.

## Vista previa: pantalla completa y repasar más rápido

- **Pantalla completa** (`PreviewPlayer` con `fullscreenable`, solo «Tu vídeo»): la raíz del reproductor pasa a la capa superior con la **Popover API** (`popover="manual"` puesto solo mientras dura, `showPopover()` / `hidePopover()`), sin moverla en el DOM, y ocupa la ventana; no una capa `position: fixed` (el `container-type: size` de la columna la encerraría: la capa superior se lo salta). Además la ventana se pone a pantalla completa del sistema (`bridge.setWindowFullscreen`, comando `set_window_fullscreen`, en cola para que entrar y salir no se crucen) y se deja como estaba al salir, al desmontar y si se abre un diálogo; en el modo de pruebas (`EASY_CUT_TEST=1`) el comando no toca la ventana (taparía el escritorio) y devuelve false. No es la Fullscreen API: ver «Notas de Tauri / WebView2». No se vuelve a montar nada: el mismo `<video>`, el vídeo de encima y las pistas siguen sonando en su instante, con el mismo encuadre. Botón con F y, dentro, controles siempre visibles (reproducir/pausa, posición, «Repasar más rápido», «Salir» con Esc). Su capa de atajos (`preview-fullscreen`, `LAYER_PRIORITY.fullscreen`, entre desplegable y diálogo) es modal mientras dura; Esc sale antes que parar o volver, y un Esc rezagado justo después no hace nada. Si se abre un diálogo, un error o «Teclas» (también F1), se sale sola para que se vea (`coveredByModal` / `isLayerCovered`). En «Tamaño y sitio» la F es de esa capa.
- **Repasar más rápido** (`reviewable`, solo «Tu vídeo»): 1×, 1,5× y 2×, en el reproductor y con el aviso «Repasando a 2× · el vídeo guardado no cambia» mientras dura; no es la velocidad del trozo (que sí cambia el resultado). El factor vive solo en el reproductor: ni proyecto, ni historial, ni autoguardado; al guardar o reabrir, 1×. playbackRate = velocidad del trozo × factor (0,0625–16; `mediaRate` en `playback.ts`); lo de encima y las pistas, al factor (`TrackLayers` recibe `rate`); el reloj del montaje sale del `<video>` del trozo y los 150 ms de recolocación siguen midiéndose en tiempo del montaje. El margen de fin de tramo crece con el ritmo (`spanEndToleranceMs`) para no enseñar lo quitado a 8×.
- **Sonidos y efectos sin sonido propio** (`TrackLayers`): un fichero sin sonido corre con el reloj de pared y arranca al momento, pero el reloj del montaje (el `<video>` del trozo) va por lo que ya se oye y arranca más tarde: empezando a la vez, el efecto iba siempre por delante unos 60 ms × el ritmo (medido: 64 ms a 1×, 115 a 1,5×, 135 a 2×), por debajo de los 150 ms de recolocar. Por eso espera a que el reloj del montaje se mueva para arrancar y, si va más de 40 ms por delante, se para un momento (sin buscar) hasta que el reloj lo alcanza (queda a ±10 ms). Al reproducir, lo que ya está en su sitio no se vuelve a buscar (buscar tarda y lo desplazaba).
- Prueba de extremo a extremo: `node scripts/preview-e2e.mjs` (pantalla completa con el botón y con F, en la capa superior y ocupando la ventana, los mismos elementos `<video>`/`<audio>`/`<img>` (no se vuelve a montar nada) y mismo encuadre relativo, teclas dentro, Esc y F salen sin parar; repaso a 1,5× y 2× midiendo el reloj, los playbackRate y la sincronía, el aviso, y que al ir a Guardar vuelve a 1×; capturas `preview-*.png`). Necesita los ficheros de `pnpm test:ffmpeg`.

## Pistas de sonidos y efectos

- **Modelo** (`src/domain/project.ts`, versión 4 del proyecto, ver «Vídeos en marcha y ficheros del proyecto»; la 1 y la 2 se migran sin pistas): `Project.mainMuted` (silencia el sonido de todos los trozos) y `Project.tracks`: `{ id, kind: 'sound' | 'effect', name, muted, hidden, items }`. Hasta 4 pistas de sonido y 3 de efectos; el orden de las de efectos es el de apilado (la primera, encima; una nueva va encima). Cada `TrackItem`: `source` (`file` con ruta o `library` con `assetId`), `anchor`, `inMs`/`outMs` (trozo del original), `phaseMs` (por dónde va la vuelta si repite), `repeat`, `durationMs` (si repite o es una imagen fija; `null` = hasta el final del vídeo), `volume` 0–1,5, `fadeInMs`/`fadeOutMs`, y en los efectos `look`: `mix` (`normal` | `light` = «Como luz», screen), `opacity`, `box` `{ x, y, scale }` (centro relativo al marco y tamaño; 1 = `fit` en el marco) y `fit` (`cover` | `contain`).
- **Anclaje al trozo, no al tiempo**: `anchor = { clipId, offsetMs }` (tiempo de salida de ese trozo) o `{ clipId: null, offsetMs }` (desde el principio). El tiempo absoluto se resuelve con la fila de trozos (`resolveTracks`, `src/domain/tracks.ts`). Reglas: reordenar un trozo se lleva lo suyo; quitar pausas de otro no lo descoloca; si el trozo ancla se acorta, se sujeta a su final (el offset se guarda: al alargarlo vuelve); si se recorta (o alarga) su principio, lo pegado sigue a su imagen y se corre lo mismo, y si su momento queda fuera se sujeta al principio (offset negativo guardado: al alargarlo vuelve); al partir el trozo, cada elemento se queda con la parte donde cae su inicio (`splitClip`); al quitarlo, lo pegado se queda en el mismo sitio del vídeo pegado al trozo que haya ahí (`removeClip`) y se avisa («2 sonidos estaban pegados a este trozo…»), en un solo paso de deshacer. Copiar y pegar un trozo **no** duplica lo que lleva pegado. La música «de fondo» (repite hasta el final y empieza en el 0) se pega al principio del vídeo (`clipId: null`). Lo que pasa del final del vídeo se ve atenuado y se corta al guardar.
- **Edición** (puro, en `tracks.ts`): `insertItem` («Poner aquí»: primera pista del tipo con sitio, si no una nueva, si no a continuación), `moveItem` (reancla al trozo de debajo; si pisa a otro, a continuación; si no cabe, no se mueve), `trimItemStart` / `trimItemEnd` (sin repetir, hasta el original; repitiendo, libre), `splitItem`, `duplicateItem`, `setItemRepeat` (un efecto repite su fichero entero), imanes (`snapPoints`: trozos, cabezal, otros elementos; `snapMove`, `snapTime`). Sin solapes dentro de una pista al soltar.
- **Guardar** (`ffmpeg-args.ts`): los tiempos se resuelven con los fotogramas enteros de cada trozo (`projectTiming(…, exportedClipDurationMs)`), así cada sonido cae donde su trozo en el fichero. Sonido: `atrim`/`-stream_loop -1` (fichero entero) o `aloop` (un trozo), `volume`, `afade` en muestras, `adelay` en muestras; mezcla `amix … normalize=0:duration=first` + `alimiter=limit=0.97:level=0:latency=1` + `apad/atrim` a las muestras exactas. Efectos: el vídeo montado se parte en tramos; solo los tramos con efectos pasan a RGB (`gbrp`, con matriz BT.709) y vuelven a `yuv420p`; dentro, por orden de pista: «Normal» con `overlay=…:format=gbrp:eof_action=pass` (alfa del fichero, `colorchannelmixer=aa` para la transparencia, `fade …:alpha=1`), «Como luz» con `blend=all_mode=screen:all_opacity=…:eof_action=pass` (recortado y sobre negro a pantalla completa, `fade` a negro). Cada efecto entra con `setpts=…+offset/TB` en su instante y solo se lee durante su tramo. WebM con alfa: `-c:v libvpx-vp9` (o `libvpx`) delante de `-i`. Imagen fija: `-loop 1 -framerate F -t …`. «Solo el sonido» lleva también las pistas.
- **Vista previa** (`components/TrackLayers.vue`, dentro del marco de `PreviewPlayer` con la prop `tracks`): `<audio>` por sonido (como mucho 8 montados: los que suenan o empiezan en los próximos 3 s), recolocados si se separan más de 150 ms del reloj del montaje; volumen y suaves en vivo (el navegador no pasa del 100 %: lo de más solo se oye al guardar). Efectos en `<video>`/`<img>` con `mix-blend-mode: screen` («Como luz»), opacidad y suaves. `data-sync` del contenedor y `data-item-id` de cada elemento, para las pruebas. «Tamaño y sitio»: recuadro sobre la vista previa (arrastrar mueve, las esquinas cambian el tamaño).
- **Interfaz** («Tu vídeo», `views/EditorView.vue`): arriba, la vista previa y la columna derecha (forma del vídeo y «Añadir sonidos y efectos» (B); al abrirla, la biblioteca en su lugar); un **divisor** (`lib/preview-split.ts`: se arrastra o se elige «Pequeña» / «Mediana» / «Grande», con mínimos de 200 px arriba y 190 px abajo, 150 con la biblioteca abierta, que además sube arriba hasta 470 px si cabe; se recuerda en `localStorage`, `easy-cut.preview-split`, con try/catch); abajo, **a todo el ancho**, la barra de lo elegido (el trozo, con «Empieza aquí» E, «Termina aquí» T y «Partir» P en la línea, o `ItemBar.vue` si hay un sonido o efecto elegido) y la **vista de pistas, que es la única** (ya no hay tira de tarjetas; `components/tracks/TracksView.vue`): zoom en la esquina (−, +, ver todo; Ctrl + rueda), regla (pulsar o arrastrar para mover la línea), filas de efectos encima de «Vídeo» y de sonido debajo, cabeceras con nombre (se cambia pulsándolo), «Silenciar» / «Ocultar», «Escuchar solo esta» (auriculares; `toggleSoloSound`: calla las demás filas de sonido, también la fila «Vídeo», en un paso; otra vez, suena todo) y quitar pista. La fila «Vídeo» lleva los indicadores de cada trozo (`data-badges`: velocidad, sin sonido, sin pausas, vídeo encima, «Solo se oye», lo pegado; el nombre accesible lo dice en llano), el aviso de original perdido, **asas para recortar** (ver abajo) y, al final, «Añadir vídeos o sonidos» y «Grabarme» (pegados al borde derecho si con zoom no se ve el final; con el vídeo vacío, una invitación). Al pie, «Pista de sonido» / «Pista de efectos» y cómo pasar algo de una pista a otra (arrastrarlo, o ↑ ↓). Con muchas filas se desplaza hacia abajo; la regla, la fila «Vídeo» y el pie se quedan a la vista (sticky). La biblioteca (`LibraryPanel.vue`) comparte fila con la vista previa (las pistas siguen a la vista debajo). Soltar ficheros encima de una pista de sonidos o efectos (o con la biblioteca abierta) los pone en las pistas, en la línea; en el resto, como trozos al final (`App.vue`, con la posición que da Tauri). Ctrl+V de ficheros del Explorador va a las pistas con la biblioteca abierta o un sonido o efecto elegido.
- **Recortar un trozo desde las pistas** (`trimClip` en `project.ts`, en tiempo de salida): las asas de cada bloque acortan o alargan hasta donde dé el original (con pausas quitadas, recortar se salta lo quitado y alargar estira el primer o el último rango, y se vuelven a quitar las pausas detectadas; con otra velocidad, el original se mueve lo arrastrado × velocidad); los siguientes se recolocan. Texto en vivo («Trozo 2: 10 s → 8 s · Vídeo: 36 s → 34 s»), la escala congelada mientras se arrastra y un paso de deshacer. **Lo pegado sigue a su imagen**: al recortar o alargar el principio, `setInOut` corre lo pegado a ese trozo lo mismo; si su momento queda fuera, se sujeta al principio del trozo con el offset negativo guardado (al alargarlo, vuelve), igual que por el final.

## Biblioteca

- `library/catalog.json` (versionado, empaquetado con la app): categorías y elementos con `file`, `sha256`, `bytes`, `durationMs`, formato, `defaults` (mezcla, repetir, volumen, tamaño…), `license` (`own` | `CC0-1.0` | `CC-BY-3.0` | `CC-BY-4.0`), `author`, `sourceUrl`, `attribution` (texto exacto si la licencia lo pide). `validateCatalog` (`src/domain/library.ts`) lo comprueba; el test `library.test.ts` valida el del repo. Reglas de licencia y cómo añadir material: `library/README.md`.
- Los ficheros van como assets de la release `library-v1` (`baseUrl` del catálogo), no en el repo ni en el instalador. `src-tauri/src/library.rs`: `library_fetch` (descarga a la caché `…\library\<sha16>-<fichero>`, solo https de `github.com`, `objects.githubusercontent.com` y `release-assets.githubusercontent.com`, también en cada redirección; nombres saneados; 3 intentos; progreso por canal; cancelación con `cancel_job`; comprueba tamaño y SHA-256; nada se ejecuta), `library_status` (lo ya descargado, sin red) y `library_catalog` (el de la release si es JSON, guardado en caché; si no, el último). En la interfaz (`src/store/library.ts`) el catálogo descargado solo sustituye al empaquetado si es válido y de `revision` mayor. La información de cada elemento sale del catálogo (sin ffprobe).
- **Hasta que exista la release**: la app de desarrollo copia los ficheros de `library/dist/` (o de `EASY_CUT_LIBRARY_DIR`) a la caché, con la misma comprobación del SHA-256; la instalada no mira nunca esa carpeta. `library/dist/` está en `.gitignore`.
- La tanda propia (todo `own`, publicado CC0) la genera `scripts/build-library.mjs`: efectos «como luz» sobre negro dibujados en JS (partículas con suma de luz y un halo con `gblur` en RGB; las llamas, con sprites del Particle Pack de Kenney, `scripts/library-particles.mjs`) y codificados en H.264 1080p30; corazones en WebM VP9 con alfa; viñeta y marco en PNG con alfa; sonidos sintetizados a M4A. Lo que repite enlaza sin salto (movimiento periódico). Cada efecto trae una vista previa de 480×270.
- La **tanda de terceros** (CC0 de Freesound y Kenney, ~110 sonidos) sale de `library/third-party.json` con el mismo script (`--import-only` para solo esa; el trabajo, en `scripts/library-import.mjs`): tramo, mono si lo es, recorte de silencios, microfundidos, volumen igualado (−16 LUFS / −1 dBTP para todos los sonidos, también los propios; lo muy corto por pico) y M4A. Los originales van en `library/sources/` (ignorada). Nombres en castellano que dicen qué es y en qué se distingue; `findNameClashes` (en `validateCatalog`) no deja nombres iguales, casi iguales ni con número de serie. Cada sonido lleva `description` (se ve en la tarjeta) y `channels`; lo de terceros, `thanks` y `verifiedOn`. El script deja también `dist/catalog.json` y `dist/CREDITS.md`, y quita de `dist/` lo que ya no está; `pnpm library:check` comprueba que `dist/` cuadra con el catálogo (y el comando para publicar la release está en `library/README.md`).
- **Buscador y categorías** (`searchLibrary`, `countByCategory`): sin tildes ni mayúsculas, en nombre, descripción, categoría y etiquetas; cada categoría lleva su contador (con lo que se busca) y, buscando, solo salen las que tienen algo.
- **Errores de descarga**: `library_fetch` empieza el mensaje con `offline:`, `missing:` (4xx, sobre todo 404) o `mismatch:` (tamaño o SHA-256); `libraryFetchMessage` / `librarySaveMessage` dan un mensaje llano distinto para cada uno.
- **Créditos** (`projectCredits`, `libraryCredits`, `libraryThanks`, `creditsText`): «¡Listo!» los enseña con «Copiar los créditos» si el vídeo usa algo que pida atribución (lo CC0 no); «Créditos de la biblioteca» (en el pie de la biblioteca) enseña eso y, aparte, los agradecimientos de todo lo de terceros.

## Vídeos en marcha y ficheros del proyecto

- **Modelo v4** (`src/domain/project.ts`): `Project.media: MediaEntry[]`, la lista de los ficheros del ordenador traídos al proyecto, en el orden en que se trajeron: `path`, `kind` (`video` | `sound` | `image`), `durationMs` (0 en una imagen), `hasVideo`, `hasAudio`, `width`/`height` (visibles), `fps`, `sizeBytes`, `hasAlpha` y `probed` (false si viene de migrar: solo se sabía la duración y si tenía imagen; se completa con ffprobe al abrir). **No se deshace**: `commit` la pone al día (`syncMediaPool` con lo medido) y deshacer/rehacer la une con la de antes (`mergeMediaPool`), así lo traído sigue en «De mi ordenador» aunque se deshaga o se quite el trozo que lo usaba; `setMedia` actualiza la entrada sin paso de deshacer (`upsertMediaEntry` + `replaceState`). Migración 1/2/3 → 4 en `parseProject`: la lista sale de lo que usa el proyecto (`usedMediaPaths`: trozos, vídeos de encima y elementos `file` de las pistas; lo de la biblioteca no). El **nombre** del vídeo va en el sobre del fichero (`serializeProject(p, { name })`, `parseProjectFile`), fuera del proyecto: cambiarlo no se deshace.
- **Dónde se guardan** (`src-tauri/src/projects.rs`): `projects\<id>.json` en la carpeta de datos (la subcarpeta `pruebas` en desarrollo), por identificador (`[A-Za-z0-9_-]{1,64}`, nunca una ruta), con `<id>.prev.json` (copia anterior: al guardar, si la copia tiene más de 10 minutos, el de antes pasa a ser la copia) y `<id>.history.json` (deshacer guardado, `src/domain/history-file.ts`: los 30 pasos más cercanos de deshacer y de rehacer; solo vale si su `present` coincide con el proyecto guardado, si no se descarta). Comandos `list_projects`, `read_project`, `write_project`, `delete_project` (borra los tres ficheros de ese id y nada más), `restore_project_backup` (intercambia copia y proyecto y descarta el historial), `read_project_history`, `write_project_history`. El `.easycut` (`save_project` / `load_project`, con diálogo) es el mismo JSON: «Guardar en un fichero» y «Abrir un vídeo guardado en un fichero».
- **Store** (`src/store/editor.ts`): `projectId` (null mientras el vídeo nuevo está vacío: uno vacío no se guarda), `projectName`, `projects` (resúmenes de la lista: `summarizeProject`, lo más reciente primero). Cada cambio se guarda solo (600 ms; `flushAutosave` toma una foto en el momento y las escrituras van en cola) con el historial. `startNewProject` deja guardado el abierto y empieza uno vacío; `openProject` (el mismo que está abierto: vuelve tal cual, con su deshacer, y mira otra vez los originales), `renameProject`, `duplicateProject` («X (copia)»), `deleteProject` (con «Deshacer» en el aviso: se guarda en memoria lo borrado), `restoreProjectBackup`, `exportProject`, `importProjectFile`. Nombre por defecto `defaultProjectName`: «Vídeo del 26 de noviembre», con «(2)» si ya hay uno así (`src/domain/projects.ts`).
- **El autoguardado de antes** (`autosave.json`, un solo vídeo a medias) se pasa a la lista al arrancar (`loadProjects` → `migrateLegacyAutosave`): se escribe como vídeo nuevo, se vuelve a leer para comprobarlo y solo entonces se borra el viejo; si no se puede leer o escribir, se deja como está. `loadProjects` comparte la lectura en marcha (las pruebas esperan a ella antes de limpiar).
- **Inicio** (`views/HomeView.vue`): «Hacer un vídeo nuevo» y, más discretos, «Grabarme leyendo un texto» y «Solo recortar un vídeo» (ver «Solo recortar»). Con la lista vacía, como siempre; con vídeos, lo de arriba más apretado y debajo «Tus vídeos en marcha»: tarjetas con miniatura (primer trozo con imagen, o el vídeo de encima), nombre, trozos y duración y «cuándo se tocó» (`describeTouched`: «Hace 5 minutos», «Hoy a las 10:30», «Ayer…», «El 3 de noviembre»), y «Cambiar el nombre» (en la tarjeta; Intro guarda, Esc no), «Duplicar», «Borrar» (pregunta destructiva, Intro = «No, volver»), y en «Más cosas» «Guardar en un fichero» y «Volver a como estaba hace un rato» (si hay copia). Debajo, «Abrir un vídeo guardado en un fichero». El teleprompter, desde Inicio, pregunta si la grabación va al vídeo más reciente o a uno nuevo.
- **«De mi ordenador»** (`LibraryPanel.vue`): «Elegir del ordenador» y la lista de lo ya traído (`poolForDisplay`, lo último primero) con miniatura, tipo y duración (`describeMediaEntry`) y usos (`mediaUsage`, `describeUsage`), y por fichero «Trozo» (al final, `tracks.addPoolClip`), «Encima» (efecto en la línea) y «Sonido» (`tracks.addPoolItem`), según `poolActions`: una imagen solo «Encima»; algo sin sonido, sin «Sonido». Lo que no se encuentra: «Buscarlo».
- **Volver a enlazar** (`store.relink(ruta)`, botón «Buscarlo» en la barra del trozo, en la del vídeo de encima, en «Arreglar este trozo», en la barra de un sonido o efecto perdido (`ItemBar`) y en «De mi ordenador»): diálogo de un fichero con título «¿Dónde está ahora «x»?» en su carpeta de antes; `relinkProblem` rechaza lo que no vale para algún uso (una imagen como trozo, un sonido como vídeo de encima…); `compareMedia` dice en llano qué no cuadra (tipo, duración con margen `durationToleranceMs`, tamaño de imagen y sonido, estos dos solo si se midió); `siblingCandidates` busca en la carpeta nueva, por nombre, los demás que faltaban de la misma carpeta (se comprueban con `exists` y ffprobe). Si todo cuadra y no hay más, se cambia ya; si no, `RelinkDialog.vue` (marcados de serie los que cuadran). `relinkMedia` lo cambia en todos los sitios (trozos, vídeos de encima, pistas y la entrada de la lista) conservándolo todo; si el nuevo dura menos, se recorta a lo que hay (o se usa entero). Un paso de deshacer.
- **Limpieza de la caché** (`src-tauri/src/cache_cleanup.rs`, `src/store/cache.ts`): 30 s después de arrancar, como mucho una vez al día (`ultima-limpieza` en la caché). Nunca se borra lo que usa un vídeo de la lista o el abierto (`cacheProtection`: sus ficheros, también los de «De mi ordenador», y `libraryCacheNames` de lo que usa de la biblioteca), ni las vistas previas de la biblioteca ni las grabaciones en curso; si algún vídeo de la lista no se puede leer, no se limpia nada. Lo demás, por tiempo sin usarse (cada uso renueva la fecha del fichero: `touch` en miniaturas, formas de onda y proxies): temporales 2 días, proxies 30, miniaturas y formas de onda 60, biblioteca 90; y si aún pasa de 3 GB, lo más viejo hasta 2 GB. Las miniaturas y formas de onda llevan delante la etiqueta de su original (`source_tag`) para saber de quién son; los proxies se reconocen por su clave exacta.

## Solo recortar

- **Qué es**: un tercer botón de Inicio, «Solo recortar un vídeo» (`views/TrimView.vue`, pantalla `trim`, estado en `store/trim.ts`). Un vídeo, dónde empieza y dónde termina, y guardar; sin pistas ni calidades. No toca el vídeo abierto en «Tu vídeo» hasta «Convertir en un vídeo normal», que empieza uno nuevo con un trozo ya recortado (`trimProject`, `store.startProjectFrom`: se guarda ya en la lista y se abre en «Tu vídeo»; el que estaba abierto se queda guardado; sin deshacer hacia atrás). Solo vídeos con imagen (un sonido se rechaza con un aviso). Vista previa: un `<video>` sencillo con `store.mediaSrc` y el proxy si WebView2 no lo decodifica (`videoWidth === 0` o `error`); barra con lo marcado en azul, tiradores que se arrastran y, con «Rápido», en rayado ámbar lo que añade por delante. Reproducir arranca desde donde empezará lo que se guarda (con «Rápido», el fotograma clave) y para al final de lo marcado.
- **Dos formas de guardar** (`src/domain/trim.ts`): **«Rápido»** (por defecto) copia sin recodificar (`buildTrimCopyArgs`, `startTrimCopy` en `exporter.ts`); **«Exacto»** guarda `trimProject` por el camino normal con «Calidad alta» (`startExport`, con su reintento con libx264). «Rápido» solo con vídeo H.264 o HEVC y sonido AAC, MP3 o ninguno (`copyProblem`: si no, no se ofrece y se dice por qué, p. ej. «(ProRes)… Con «Exacto» sí se guarda bien»). Las dos van por las pantallas Guardando y ¡Listo! (`saveFlow.startTrim`; `saveFlow.origin` = `'trim'` hace que Esc, «Volver a recortar» y cancelar vuelvan a `trim`, y que no salgan créditos). Salida en «Mis montajes»: «<nombre del original> (recortado).mp4», «… (recortado) 2.mp4»… (`buildTrimFileName`).
- **El fotograma clave** (`buildKeyframeProbeArgs` + `parseKeyframes`, `bridge.keyframes`): ffprobe solo lee paquetes (`-show_entries packet=pts_time,flags`, sin decodificar) de la primera pista de vídeo en `-read_intervals` desde 30 s antes del principio marcado hasta 0,5 s después (ffprobe busca el principio de la ventana en el clave anterior, así que siempre sale uno); si no diera ninguno, desde el 0. Los instantes se redondean **hacia arriba** al ms, para que `-ss` con ese valor no caiga antes del clave (buscaría el anterior). Se mira 150 ms después del último cambio del principio y se guarda por principio. `planCopy`: si lo marcado empieza en 0, antes del primer clave o a menos de medio fotograma de uno, «Rápido» ya es exacto («Aquí corta justo donde has marcado»); si no, «Empezará 0,8 s antes, en 0:04…» con la cifra real (`describeCopyPlan`). Si ffprobe falla, «Rápido» no se ofrece.
- **Registro**: cada guardado se apunta como siempre, con `method` (`'encode'` | `'copy'`) y `tool` (`'editor'` | `'trim'`); «¡Listo!» dice «Guardado en 2 segundos sin recodificar» y «Copiar detalles», «Guardado: Solo recortar, rápido (copiado sin recodificar)» o «Solo recortar, exacto (Calidad alta)».
- Prueba de integración: `tests/integration/trim.itest.ts` (en `test-output/trim/`, que `export.itest.ts` no borra; lo usa también `trim-e2e`).

## Registro de guardados

- Cada guardado (también los cancelados, los fallidos y «Solo el sonido») deja una línea JSON en `save-log.jsonl`, en la carpeta de datos de la app (la subcarpeta `pruebas` en desarrollo, como el autoguardado); se quedan las últimas 200 (`append_save_log` en `commands.rs`, escritura atómica). Escribirlo nunca hace fallar un guardado: si falla, solo un log.
- La entrada (`src/domain/save-log.ts`, la va rellenando `ExportJob.report` en `exporter.ts`): fecha local, versión, para qué es, encoder pedido y usado, si hubo reintento con libx264 y la última línea útil de ffmpeg, encoders que pasaron la prueba, duración, tamaño y fps, tiempo total y de ffmpeg, veces tiempo real, peso (`output_file_size`, solo en «Mis montajes») y resultado. Sin rutas: solo el nombre del fichero de salida, y en los errores de ffmpeg cada ruta se queda en su último nombre.
- «¡Listo!» lo enseña en llano («Guardado en 48 segundos con la tarjeta gráfica» / «… con el procesador, porque con la tarjeta gráfica no ha funcionado») con «Copiar detalles» (el texto técnico de ese guardado), para que quien use el PC se lo pueda leer o pegar al dueño.

## Teleprompter, palabra a palabra

El texto se pinta por donde debería ir la lectura (ya leído en gris, la palabra de ahora en ámbar y subrayada, por leer en blanco). Qué palabra toca lo decide `wordCursorAt` (dominio, búsqueda binaria sobre `flattenTokens`); `PrompterRun` solo cambia las clases `w-read` / `w-current` de los trozos que dice `cursorDirtyRange` (uno o dos por palabra), sin rehacer el DOM, y solo color y subrayado (el peso movería las palabras de línea). Sigue solo la pausa, el ritmo y ←, porque sale del avance. Para las pruebas, `data-current-word` (-1 en una pausa de párrafo o al acabar) y `data-words-read` en `[data-testid=prompter-text]`.

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
                     anclaje, lista de ficheros `media`), operaciones (también recortar un trozo por un extremo,
                     trimClip), conversión de tiempos, JSON (versión 4, con el nombre en el sobre; la 1, la 2 y la 3
                     se migran al leerlas)
    media-pool.ts    lista de ficheros del proyecto: usos, acciones de «De mi ordenador», comparar al volver a
                     enlazar, cambiar un fichero en todos los sitios y buscar los de la misma carpeta
    projects.ts      vídeos en marcha: nombres por defecto y sin repetir, resumen de cada uno, «cuándo se tocó»
    history-file.ts  deshacer guardado aparte (los pasos más cercanos; solo si es del proyecto de ahora)
    cache-protection.ts  qué no puede borrar la limpieza de la caché
    tracks.ts        pistas (sin límite): resolver anclajes, poner, mover, recortar, partir, duplicar, sin solapes,
                     imanes, suaves, «escuchar solo esta»
    library.ts       catálogo de la biblioteca: validación, búsqueda, valores de serie, URL permitidas y créditos
    history.ts       deshacer/rehacer por instantáneas
    durations.ts     duraciones y frases en castellano («Te sobran 20 segundos»)
    probe.ts         args de ffprobe y parser → MediaInfo (rotación, HDR, fps; sonidos sin imagen, carátulas fuera)
    output.ts        presets whatsapp/youtube/high, tamaño (solo cuenta la imagen que se ve; sin ninguna, 1280×720 a
                     30 fps), fps, bitrate y peso; peso y tiempo de «Solo el sonido»
    encoders.ts      parámetros por encoder (nvenc/qsv/amf/libx264), prueba y fallback
    save-log.ts      registro de guardados: entrada (encoder pedido y usado, reintento y por qué, tiempos, peso,
                     resultado), frase de «¡Listo!» y texto de «Copiar detalles»; sin rutas del usuario
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
    trim.ts          «Solo recortar»: fotograma clave (args de ffprobe y parser), qué hace «Rápido» y cuándo se
                     ofrece, textos, args de la copia sin recodificar, nombre «(recortado)» y proyecto de un trozo
  store/
    editor.ts        estado: proyecto + historial, originales (y vídeos de encima), pantalla, avisos, vídeos en
                     marcha (lista, guardar solo, abrir, nombre, duplicar, borrar, copia anterior, .easycut, pasar
                     el autoguardado de antes), volver a enlazar, proxies, miniaturas, formas de onda, «Elegir el
                     vídeo» de encima, copiar y pegar trozos
    cache.ts         limpieza de la caché un rato después de arrancar (lo que usan los vídeos de la lista)
    exporter.ts      guardar (vídeo o «Solo el sonido»): comprobación de originales, filtro en fichero, reintento con
                     libx264, borrar a medias; startTrimCopy («Solo recortar», «Rápido»: copia sin recodificar)
    save-flow.ts     pantallas Guardar / Guardando / ¡Listo! (antes, trae lo de la biblioteca que falte); también
                     los dos guardados de «Solo recortar» (startTrim, origin)
    trim.ts          «Solo recortar»: el vídeo, lo marcado, «Rápido» / «Exacto», fotograma clave, guardar y
                     «Convertir en un vídeo normal»
    tracks.ts        pistas en la interfaz: elegido, crear pistas, «solo esta», recortar y partir trozos desde la
                     fila «Vídeo», biblioteca abierta, poner (biblioteca y
                     ordenador), arrastres con preview/commit, silenciar/ocultar, quitar pista, «Probar sobre mi vídeo»
    library.ts       catálogo (empaquetado o más nuevo), lo descargado, descargas con progreso, información de cada elemento
    index.ts         instancia única (y `window.__easyCut` solo en desarrollo)
  lib/               confirmaciones, portapapeles, añadir y pegar vídeos, estado de «quitar pausas»,
                     shortcuts.ts (registro de atajos por capas, puro y con tests), use-shortcuts.ts (useShortcuts,
                     el único listener de teclado y el panel «Teclas»),
                     camera.ts (getUserMedia, dispositivos, medidor), recorder.ts (MediaRecorder → disco por partes),
                     teleprompter-settings.ts (texto y ajustes en localStorage),
                     updater.ts (cuándo comprobar, aviso, «Más tarde», descarga con progreso e instalar; con tests),
                     preview-split.ts (reparto de alto entre vista previa y pistas: tamaños fijos, mínimos y
                     localStorage; con tests)
  components/        PreviewPlayer, Filmstrip, DurationBar, TargetPicker, AppIcon (iconos SVG propios),
                     KeyHint (la tecla dibujada; el texto va en ::before), KeysButton y KeysPanel («Teclas», F1),
                     UpdateNotice, UpdateDialog y AppVersion (actualizaciones), TrackLayers (sonidos y efectos en la
                     vista previa y «Tamaño y sitio»), RelinkDialog («Buscarlo» cuando no cuadra)…
    teleprompter/    PrompterRun (pantalla de ensayar/grabar: texto con translateY desde rAF), CameraSetup
    tracks/          TracksView (la vista de pistas, única de «Tu vídeo»: fila «Vídeo» con indicadores, asas para
                     recortar, «Añadir vídeos o sonidos» y «Grabarme»; pie con pistas nuevas), TrackHeader (con
                     «Escuchar solo esta»), ItemBar (barra del elemento elegido), LibraryPanel (biblioteca y «De mi
                     ordenador»), CreditsDialog
  views/             Home (con la lista de vídeos en marcha), Pick, Editor («Tu vídeo»), ClipEditor («Arreglar este trozo», con la pestaña «Imagen»),
                     Save (tres tarjetas y «Solo el sonido»), Saving, Done,
                     Teleprompter (texto → cámara → grabar → revisar → trozo), Trim («Solo recortar»),
                     Diagnostics (solo desarrollo)
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
  src/files.rs       nombres sin sobrescribir, clave de caché (y etiqueta del original), tamaño de JPEG
  src/projects.rs    vídeos en marcha: un JSON por id en la carpeta de datos, copia anterior e historial
  src/cache_cleanup.rs  limpieza de la caché (por antigüedad de uso y tamaño; nunca lo de la lista)
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
  preview-e2e.mjs    prueba de extremo a extremo de la pantalla completa y de «Repasar más rápido»
  projects-e2e.mjs   prueba de extremo a extremo de los vídeos en marcha, «De mi ordenador» y volver a enlazar
  trim-e2e.mjs       prueba de extremo a extremo de «Solo recortar» («Rápido», «Exacto» y convertir)
  build-library.mjs  genera la biblioteca (tanda propia y de terceros) en library/dist, el catálogo y CREDITS.md
  library-import.mjs  tanda de terceros (library/third-party.json → M4A nivelados) y el nivelado común
  library-particles.mjs  sprites del Particle Pack de Kenney para los efectos
  check-library.mjs  pnpm library:check: library/dist cuadra con el catálogo (ficheros, tamaños, SHA-256)
tests/integration/   pruebas con ffmpeg real (pnpm test:ffmpeg): export.itest.ts, tracks.itest.ts (pistas, medidas) y
                     trim.itest.ts («Solo recortar»: fotograma clave, sincronía, ubicación, rotación y tiempos)
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
- Mientras un ffmpeg/ffprobe lee un original (una miniatura, una forma de onda), Windows no deja moverlo ni cambiarle el nombre (`EBUSY`). Al volver a Inicio, la tarjeta de un vídeo nuevo saca su miniatura así (~120 ms, medido); `projects-e2e` espera a que la tarjeta la enseñe antes de mover los originales.
- **Fullscreen API** (`requestFullscreen`, comprobado en WebView2 158 por CDP): sin activación de usuario la rechaza con `TypeError: Permissions check failed`; con activación (un clic real de `Input.dispatchMouseEvent` o `Runtime.evaluate` con `userGesture`) y la ventana **delante y activa**, la concede y la ventana entera pasa a ocupar la pantalla (`innerWidth` 2560×1440; wry no hace nada, lo hace WebView2). Con la ventana detrás y sin activar (el modo de pruebas), la rechaza siempre con `TypeError: not granted` (y `fullscreenerror`), aunque la página crea tener el foco (`Emulation.setFocusEmulationEnabled`). Por eso la vista previa a pantalla completa usa la Popover API más `set_window_fullscreen`: se comporta igual delante y detrás y se puede probar sin robar el foco.
- La fila «Vídeo» se reordena con eventos de puntero, no con el arrastre HTML5 de elementos (con `dragDropEnabled` en Windows no es fiable, según los avisos de Tauri; no se ha comprobado aquí).

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
- **Copiar sin recodificar** («Solo recortar», «Rápido»): `-ss <fotograma clave>` de entrada (exactamente el clave: así el primer paquete de vídeo es clave y el sonido empieza a la vez; con `-ss` en el punto marcado, el fichero llevaría delante lo de antes oculto con una edit list, que no todos los reproductores respetan), `-t`, `-map 0:v:0 -map 0:a:0` (ninguna otra pista: las de datos o metadatos temporizados pueden llevar el GPS), `-c copy`, `-map_metadata -1 -map_chapters -1` (quita `©xyz` y `com.apple.quicktime.location.ISO6709`: comprobado buscando los bytes en el fichero) y `+faststart`; HEVC con `-tag:v hvc1`. La rotación del móvil (display matrix) va con la pista y se conserva (90° → 90°). **Sin `-avoid_negative_ts make_zero`**: con B-frames, el vídeo pasaba a empezar 75 ms después (`start_time` 0,0747) porque se pierde la edit list que compensa su retraso; sin él (o con `auto`), vídeo y sonido empiezan en 0 como en el original. Medido con destellos y pitidos a la vez: el sonido queda a −11 ms de la imagen respecto al original (un paquete de AAC). Al copiar, el final puede llevar 2 fotogramas más (66 ms a 30 fps: los B-frames que van detrás). Tiempos con un 1080p30 de 20 s, 8 s recortados: «Rápido» 73 ms; «Exacto» 1,2 s con NVENC y 2,8 s con libx264.
- NVENC va con opciones conservadoras para Pascal (GTX 1060): `-preset p5 -rc vbr -cq … -bf 2 -b_ref_mode disabled`, sin lookahead ni temporal AQ. Probado en una RTX, no en la GTX 1060.
