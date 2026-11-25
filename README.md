# Easy Cut

Editor de vídeo para Windows pensado para quien no quiere aprender a usar un editor de vídeo. Sin línea de tiempo, sin formatos ni ajustes técnicos: una tira de trozos, botones grandes y la duración siempre a la vista.

La interfaz está en castellano.

## Qué hace

- **Juntar vídeos** en el orden que quieras, y también ficheros de sonido.
- **Arreglar cada trozo**: cortar el principio y el final, partirlo en dos todas las veces que haga falta, cambiar la velocidad, quitar el sonido, girarlo y encuadrarlo.
- **Quitar pausas**: busca los silencios de un trozo y los quita, con tres niveles (pocas, normal, muchas).
- **Imagen**: dejar un trozo solo con sonido, poner otro vídeo encima, o verte en una esquina mientras se ve otro vídeo.
- **Grabarte leyendo un texto**: un teleprompter que calcula si el texto cabe en el tiempo que tienes y a qué ritmo hay que leerlo, y graba en vídeo o solo la voz.
- **Duración máxima**: si el vídeo no puede pasar de, por ejemplo, 5 minutos, la app dice en todo momento cuánto te queda o cuánto te sobra.
- **Guardar** con un botón: «Para WhatsApp», «Para YouTube», «Calidad alta» o «Solo el sonido».
- **Atajos de una sola tecla**, escritos en cada botón.

Los vídeos originales no se modifican nunca, y lo que se está montando se guarda solo.

## Instalar

Descarga el instalador de la [última versión](../../releases/latest) y ábrelo. Se instala para tu usuario, sin pedir permisos de administrador.

El instalador no está firmado, así que Windows mostrará el aviso de SmartScreen la primera vez: «Más información» → «Ejecutar de todas formas».

Requiere Windows 10 u 11 de 64 bits.

## Compilar

Hace falta [Node](https://nodejs.org), [pnpm](https://pnpm.io), [Rust](https://rustup.rs) con las Build Tools de Visual Studio, y `ffmpeg` y `ffprobe` en el PATH.

```powershell
pnpm install
```

```powershell
pnpm fetch-ffmpeg
```

```powershell
pnpm tauri dev
```

Para generar el instalador:

```powershell
pnpm build-release
```

Las pruebas y el mapa del código están descritos en [`CLAUDE.md`](CLAUDE.md).

## Cómo está hecho

[Tauri 2](https://tauri.app) y [Vue 3](https://vuejs.org). Todo el trabajo de vídeo lo hace [FFmpeg](https://ffmpeg.org), que la app lanza como un programa aparte.

## Licencias

El código de Easy Cut se publica bajo la licencia [MIT](LICENSE).

El instalador incluye los programas `ffmpeg` y `ffprobe` sin modificar, que **no** forman parte de este código y tienen su propia licencia: son una compilación de [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) (variante `win64-gpl`), distribuida bajo la **GNU General Public License, versión 3**. Su código fuente es el de [FFmpeg](https://git.ffmpeg.org/ffmpeg.git) en la revisión que indica cada versión publicada, y los scripts con los que se compila están en el repositorio de BtbN. Más detalle en [`THIRD-PARTY.md`](THIRD-PARTY.md).
