# Easy Cut

Editor de vídeo para Windows pensado para quien no quiere aprender a usar un editor de vídeo. Sin formatos ni ajustes técnicos: una tira de trozos, botones grandes y la duración siempre a la vista; y, cuando hacen falta, unas pistas sencillas para poner música, sonidos y efectos encima.

La interfaz está en castellano.

## Qué hace

- **Juntar vídeos** en el orden que quieras, y también ficheros de sonido.
- **Arreglar cada trozo**: cortar el principio y el final, partirlo en dos todas las veces que haga falta, cambiar la velocidad, quitar el sonido, girarlo y encuadrarlo.
- **Quitar pausas**: busca los silencios de un trozo y los quita, con tres niveles (pocas, normal, muchas).
- **Imagen**: dejar un trozo solo con sonido, poner otro vídeo encima, o verte en una esquina mientras se ve otro vídeo.
- **Sonidos y efectos**: música de fondo, aplausos, una campanita, confeti, chispas, luces, nieve, un logo o un marco, en pistas debajo de los trozos. Cada cosa va pegada a su trozo (si lo mueves, va con él) y cada pista se puede silenciar u ocultar. Trae una **biblioteca** propia (se descarga lo que se usa) y también vale lo que tengas en el ordenador.
- **Grabarte leyendo un texto**: un teleprompter que calcula si el texto cabe en el tiempo que tienes y a qué ritmo hay que leerlo, y graba en vídeo o solo la voz.
- **Duración máxima**: si el vídeo no puede pasar de, por ejemplo, 5 minutos, la app dice en todo momento cuánto te queda o cuánto te sobra.
- **Guardar** con un botón: «Para WhatsApp», «Para YouTube», «Calidad alta» o «Solo el sonido».
- **Atajos de una sola tecla**, escritos en cada botón.

Los vídeos originales no se modifican nunca, y lo que se está montando se guarda solo.

## Instalar

Descarga el instalador de la [última versión](../../releases/latest) y ábrelo. Se instala para tu usuario, sin pedir permisos de administrador.

El instalador no está firmado, así que Windows mostrará el aviso de SmartScreen la primera vez: «Más información» → «Ejecutar de todas formas».

Requiere Windows 10 u 11 de 64 bits.

## Actualizaciones

Easy Cut se actualiza sola desde la versión 0.2.0. Al abrirla, mira si hay una versión nueva; si la hay, avisa en Inicio y en «Tu vídeo» con «Actualizar ahora» y «Más tarde». Al actualizar se descarga, se instala y la app se vuelve a abrir sola, con el vídeo a medias guardado. Sin internet no pasa nada: se sigue usando la versión instalada. En el pie de Inicio están la versión instalada y «Buscar actualizaciones».

Las actualizaciones van firmadas: la app solo instala las que se han publicado con la clave del proyecto.

Si tienes la 0.1.0, instala la 0.2.0 a mano una vez; a partir de ahí ya no hace falta.

## Compilar

Hace falta [Node](https://nodejs.org) 24 o posterior, [pnpm](https://pnpm.io), [Rust](https://rustup.rs) con las Build Tools de Visual Studio, y `ffmpeg` y `ffprobe` (los del PATH, o los de la compilación fijada con `-Download`).

```powershell
pnpm install
```

```powershell
pnpm fetch-ffmpeg -Download
```

```powershell
pnpm tauri dev
```

Para generar el instalador firmado (necesita la clave privada del actualizador; ver [`CLAUDE.md`](CLAUDE.md)):

```powershell
pnpm build-release
```

Las pruebas y el mapa del código están descritos en [`CLAUDE.md`](CLAUDE.md).

## Publicar una versión

La publica GitHub Actions (`.github/workflows/release.yml`) al subir una etiqueta `v…`: compila el instalador en Windows, lo firma y crea la release con el instalador, su firma y el `latest.json` que lee el actualizador.

1. Sube la versión en `package.json` y en `src-tauri/Cargo.toml` (las dos iguales; `tauri.conf.json` toma la de `package.json`). Después, `cargo check` dentro de `src-tauri` para que se actualice `Cargo.lock`.
2. Escribe las novedades en `CHANGELOG.md`, en una sección `## [x.y.z] - fecha`: salen en la release.
3. Haz commit, crea la etiqueta y súbela (cambia `0.3.0` por la versión):

```powershell
git tag v0.3.0
```

```powershell
git push origin main
```

```powershell
git push origin v0.3.0
```

Si la etiqueta no coincide con la versión del código, el workflow falla sin publicar nada. Para probar la compilación sin publicar, ejecuta el workflow a mano («Run workflow»): deja el resultado como artifact.

## Cómo está hecho

[Tauri 2](https://tauri.app) y [Vue 3](https://vuejs.org). Todo el trabajo de vídeo lo hace [FFmpeg](https://ffmpeg.org), que la app lanza como un programa aparte.

## Licencias

El código de Easy Cut se publica bajo la licencia [MIT](LICENSE).

Los sonidos y efectos de la biblioteca que ha hecho el proyecto (`scripts/build-library.mjs`) se publican bajo [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.es): se pueden usar en cualquier vídeo sin nombrar a nadie. Lo que sea de otras personas lleva su licencia, su autor y su fuente en [`library/catalog.json`](library/catalog.json) (ver [`library/README.md`](library/README.md)); si pide que se le nombre, la app lo dice al guardar el vídeo y da el texto de los créditos.

El instalador incluye los programas `ffmpeg` y `ffprobe` sin modificar, que **no** forman parte de este código y tienen su propia licencia: son una compilación de [FFmpeg-Builds](https://github.com/FFmpeg-Builds/FFmpeg-Builds) (antes BtbN/FFmpeg-Builds; variante `win64-gpl`), distribuida bajo la **GNU General Public License, versión 3**. La compilación exacta (versión, commit de FFmpeg y SHA-256) está fijada en [`scripts/ffmpeg-build.json`](scripts/ffmpeg-build.json) y la repite la nota de cada versión publicada; los scripts con los que se compila están en el repositorio de FFmpeg-Builds. Más detalle en [`THIRD-PARTY.md`](THIRD-PARTY.md).
