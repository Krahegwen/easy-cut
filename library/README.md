# Biblioteca de sonidos y efectos

Lo que sale en «Añadir sonidos y efectos» → «Biblioteca» de Easy Cut.

- `catalog.json` (versionado): qué hay, con su licencia y su fuente. Va empaquetado con la app.
- Los ficheros **no van en el repo ni en el instalador**. Se publican como assets de la release de GitHub `library-v1` (`baseUrl` del catálogo) y la app los descarga cuando hacen falta a su caché, comprobando el SHA-256 de cada uno. Lo ya descargado se usa sin conexión.
- `dist/` (ignorada por git): los ficheros generados, más una copia de `catalog.json` y `CREDITS.md`, listos para subir. En la app de desarrollo (`pnpm tauri dev`) hace de release: si un fichero está ahí, se copia de ahí en vez de descargarlo (con la misma comprobación del SHA-256). En la app instalada no se mira nunca.
- `third-party.json` (versionado): la selección de material de terceros, con lo que hay que hacer con cada original (tramo, fundidos, nivel) y su ficha. Ver «Tanda de terceros».
- `sources/` (ignorada por git): los originales de terceros de los que sale la tanda importada.

## Reglas de licencia

Solo material que se pueda **redistribuir** (va dentro de los vídeos de quien use la app y en una release pública):

| `license` | Qué es | Créditos |
| --- | --- | --- |
| `own` | Hecho por el proyecto (por ejemplo, con `scripts/build-library.mjs`). Se publica bajo **CC0** (`ownLicense`). | No |
| `CC0-1.0` | Dominio público. | No |
| `CC-BY-3.0`, `CC-BY-4.0` | Hay que nombrar al autor. | Sí: `attribution` con el texto exacto |

Nada de «solo uso personal», «no comercial» (NC), «sin obras derivadas» (ND) ni «compartir igual» (SA), ni material de bancos de sonidos con licencias propias que no permitan redistribuir el fichero suelto. Cada entrada dice **de dónde sale** (`sourceUrl`, la página exacta del original) y **de quién es** (`author`). El test `src/domain/library.test.ts` comprueba el esquema y estas reglas.

Lo que pide atribución sale en la pantalla «¡Listo!» del vídeo que lo use («Copiar los créditos», para la descripción) y en «Créditos de la biblioteca». Lo CC0 de terceros **no** sale en «¡Listo!» (no hace falta), pero sí en «Créditos de la biblioteca», con su agradecimiento (`thanks`), y en `dist/CREDITS.md`.

## Cada entrada

```jsonc
{
  "id": "luz-calida",            // único, minúsculas y guiones
  "kind": "effect",              // "sound" o "effect"
  "name": "Luz cálida",          // en castellano llano: qué es y en qué se distingue de los parecidos (único, sin «2»)
  "category": "luz",             // una de "categories" (del mismo tipo)
  "description": "…",            // opcional: una línea (se ve en la tarjeta y cuenta para el buscador)
  "tags": ["fuga de luz", "atardecer"],
  "durationMs": 8000,            // 0 si es una imagen fija
  "format": "mp4",               // m4a (sonidos) · mp4 · webm (con alfa) · png (imagen fija)
  "width": 1920, "height": 1080, // efectos
  "hasAudio": false,
  "hasAlpha": true,              // si trae transparencia (webm VP9 con alfa, png)
  "still": true,                 // solo las imágenes fijas
  "file": "luz-calida.mp4", "sha256": "…", "bytes": 3600000,
  "preview": { "file": "luz-calida.preview.mp4", "sha256": "…", "bytes": 85000 }, // efectos: 480×270, ligero
  "defaults": { "repeat": true, "durationMs": 8000, "volume": 1, "look": { "mix": "light", "opacity": 0.9 } },
  "license": "own", "author": "…", "sourceUrl": "https://…", "attribution": null,
  "channels": 1,                 // sonidos: 1 (mono) o 2
  "thanks": "\"Título\" por autor — https://… — CC0 1.0", // terceros sin atribución: el agradecimiento
  "verifiedOn": "2026-11-25"     // terceros: cuándo se comprobaron licencia y fuente
}
```

`validateCatalog` exige `thanks` en lo CC0 de terceros, `verifiedOn` en todo lo de terceros, y que no haya dos nombres iguales o casi iguales (sin contar tildes ni signos, o a una o dos letras) ni nombres acabados en número de serie.

`defaults.look.mix`: `"light"` («Como luz»: el negro desaparece; para luces, chispas, nieve… sobre fondo negro) o `"normal"` (encima, con su transparencia). `defaults.durationMs: null` = hasta el final del vídeo.

Formatos: sonidos en M4A (AAC 48 kHz, estéreo); efectos «como luz» en H.264 sobre negro puro, 1080p a 30 fps; los de mezcla normal con transparencia en WebM VP9 con alfa (`yuva420p`) o PNG. Lo que se repite tiene que enlazar sin salto (el último fotograma con el primero).

## Añadir material

1. Deja el fichero en `library/dist/` con un nombre seguro (`[a-z0-9._-]`).
2. Añade su entrada a `catalog.json` con `sha256` y `bytes` del fichero (PowerShell: `Get-FileHash -Algorithm SHA256 ruta` y `(Get-Item ruta).Length`; el hash en minúsculas).
3. Sube `revision` en uno: así las apps ya instaladas cogen el catálogo nuevo de la release sin publicar versión.
4. `pnpm test` (comprueba el esquema y las licencias).
5. Sube el fichero (y su vista previa) y el `catalog.json` nuevo a la release `library-v1`.

## Tanda propia (`scripts/build-library.mjs`)

Genera los efectos y sonidos del proyecto (sin terceros) en `dist/` y reescribe sus entradas del catálogo:

```powershell
node scripts/build-library.mjs --review
```

`--only confeti,ding` rehace solo esos; `--import-only` rehace solo la tanda de terceros; `--review` deja en `dist/review/` hojas de contacto de cada efecto, el espectro y la forma de onda de cada sonido y `sound-levels.json` (lo medido en cada uno), para revisarlos antes de publicar. Al regenerar pueden cambiar los SHA-256 (depende de la versión de ffmpeg): hay que volver a subir los ficheros a la release. La revisión del catálogo sube sola cuando algo cambia.

El efecto «Llamas en la parte de abajo» usa los sprites del Particle Pack de Kenney (CC0): sin `sources/kenney/particle-pack/` se queda el que ya hay.

## Tanda de terceros (`third-party.json`)

Todo CC0 1.0: 37 sonidos de [Freesound](https://freesound.org) (uno descartado por saturado) y una selección de nueve packs de [Kenney](https://kenney.nl) (licencia comprobada en el `License.txt` de cada zip y en su página). Cada elemento dice su origen (`from`), el tramo del original (`inMs`/`outMs`), fundidos (`fadeInMs`/`fadeOutMs`, por defecto 4 y 25 ms), si se recorta el silencio de los extremos (`trim`, por defecto sí) y su ficha (nombre, categoría, descripción, etiquetas). Las entradas `{ "voice": … }` dan dos elementos (voz de hombre y de mujer); las `{ "own": id }` colocan un sonido propio en ese puesto de su categoría. El orden dentro de cada categoría es el del fichero: de lo más usado a lo menos.

Los originales no se versionan. Para rehacer la tanda:

1. Los de Freesound (descargados con una cuenta), con su nombre de descarga (`<id>__<autor>__<título>.<ext>`), en `sources/freesound/`.
2. Los zips de Kenney, cada uno descomprimido en `sources/kenney/<pack>/` (`music-jingles`, `voiceover-pack`, `interface-sounds`, `digital-audio`, `impact-sounds`, `rpg-audio`, `casino-audio`, `ui-audio`, `particle-pack`).
3. `node scripts/build-library.mjs --import-only --review` (`scripts/library-import.mjs` hace el trabajo; de los originales solo leen ffmpeg y ffprobe).

Volumen: todos los sonidos (también los propios) a −16 LUFS integrados con el pico verdadero ≤ −1 dBTP, limitando como mucho `maxLimitDb` (3 dB por defecto; más en aplausos o golpes); lo que no llega sin pasarse se queda más bajo (los fuegos artificiales y los ruidos de objetos, a −23/−27 LUFS: son golpes sueltos). Lo de menos de medio segundo se nivela por pico (−4 dBTP). Salida M4A AAC 192 kbps a 48 kHz, mono si el original lo es (o sus dos canales son casi iguales).

## Comprobar y publicar

```powershell
pnpm library:check
```

Comprueba que cada fichero del catálogo (y su vista previa) está en `dist/` con su tamaño y su SHA-256, que `dist/catalog.json` es el del repo, que `CREDITS.md` nombra todo lo de terceros y que no sobra nada. Para publicar (sube los ficheros de `dist/`, sin la carpeta `review`; con `gh` autenticado):

```powershell
gh release create library-v1 --repo Krahegwen/easy-cut --title "Biblioteca de sonidos y efectos" --notes-file library/dist/CREDITS.md --latest=false (Get-ChildItem library/dist -File).FullName
```

Si la release ya existe, los ficheros nuevos o cambiados se suben con `gh release upload library-v1 --repo Krahegwen/easy-cut --clobber` y la misma lista.

Si la descarga falla, la app distingue tres casos por la marca con la que `library_fetch` empieza el error: `offline:` (sin conexión o el servidor no responde), `missing:` (404: ese fichero aún no está en la release) y `mismatch:` (lo descargado no coincide en tamaño o SHA-256); cada uno con su mensaje (`libraryFetchMessage`).
