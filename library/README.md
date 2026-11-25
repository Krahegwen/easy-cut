# Biblioteca de sonidos y efectos

Lo que sale en «Añadir sonidos y efectos» → «Biblioteca» de Easy Cut.

- `catalog.json` (versionado): qué hay, con su licencia y su fuente. Va empaquetado con la app.
- Los ficheros **no van en el repo ni en el instalador**. Se publican como assets de la release de GitHub `library-v1` (`baseUrl` del catálogo) y la app los descarga cuando hacen falta a su caché, comprobando el SHA-256 de cada uno. Lo ya descargado se usa sin conexión.
- `dist/` (ignorada por git): los ficheros generados. En la app de desarrollo (`pnpm tauri dev`) hace de release: si un fichero está ahí, se copia de ahí en vez de descargarlo (con la misma comprobación del SHA-256). En la app instalada no se mira nunca.

## Reglas de licencia

Solo material que se pueda **redistribuir** (va dentro de los vídeos de quien use la app y en una release pública):

| `license` | Qué es | Créditos |
| --- | --- | --- |
| `own` | Hecho por el proyecto (por ejemplo, con `scripts/build-library.mjs`). Se publica bajo **CC0** (`ownLicense`). | No |
| `CC0-1.0` | Dominio público. | No |
| `CC-BY-3.0`, `CC-BY-4.0` | Hay que nombrar al autor. | Sí: `attribution` con el texto exacto |

Nada de «solo uso personal», «no comercial» (NC), «sin obras derivadas» (ND) ni «compartir igual» (SA), ni material de bancos de sonidos con licencias propias que no permitan redistribuir el fichero suelto. Cada entrada dice **de dónde sale** (`sourceUrl`, la página exacta del original) y **de quién es** (`author`). El test `src/domain/library.test.ts` comprueba el esquema y estas reglas.

Lo que pide atribución sale en la pantalla «¡Listo!» del vídeo que lo use («Copiar los créditos», para la descripción) y en «Créditos de la biblioteca».

## Cada entrada

```jsonc
{
  "id": "luz-calida",            // único, minúsculas y guiones
  "kind": "effect",              // "sound" o "effect"
  "name": "Luz cálida",          // en castellano llano
  "category": "luz",             // una de "categories" (del mismo tipo)
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
  "license": "own", "author": "…", "sourceUrl": "https://…", "attribution": null
}
```

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

`--only confeti,ding` rehace solo esos; `--review` deja en `dist/review/` hojas de contacto de cada efecto y el espectro y la forma de onda de cada sonido, para revisarlos antes de publicar. Fuego y humo realistas no se generan: quedan para material de terceros. Al regenerar cambian los SHA-256 (depende de la versión de ffmpeg): hay que volver a subir los ficheros a la release.
