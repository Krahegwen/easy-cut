# Programas de terceros incluidos en el instalador

## FFmpeg (`ffmpeg.exe` y `ffprobe.exe`)

El instalador de Easy Cut incluye, sin modificar, los ejecutables `ffmpeg.exe` y `ffprobe.exe`. Easy Cut los lanza como programas independientes; no están enlazados con su código.

- **Proyecto**: [FFmpeg](https://ffmpeg.org) — © the FFmpeg developers.
- **Compilación**: [FFmpeg-Builds](https://github.com/FFmpeg-Builds/FFmpeg-Builds) (el proyecto de BtbN, antes en `BtbN/FFmpeg-Builds`), variante `win64-gpl` de una rama estable de FFmpeg (estática).
- **Licencia**: [GNU General Public License, versión 3](https://www.gnu.org/licenses/gpl-3.0.html) (la compilación usa `--enable-gpl --enable-version3` e incluye, entre otras, libx264 y libx265).
- **Versión incluida**: desde Easy Cut 0.2.0, FFmpeg `n9.0.2-39-g7adfbe40dc` (rama `release/9.0`), del autobuild `autobuild-2026-10-31-12-59`. La compilación exacta que se empaqueta (URL, versión, commit y SHA-256 del zip) está fijada en [`scripts/ffmpeg-build.json`](scripts/ffmpeg-build.json); la usan igual la compilación local (`pnpm fetch-ffmpeg -Download`) y la de GitHub Actions, y la nota de cada versión publicada la repite. Se puede comprobar en una instalación con `ffmpeg.exe -version`, en la carpeta donde se instala la app.
- **Código fuente**: el repositorio de FFmpeg, <https://git.ffmpeg.org/ffmpeg.git>, en el commit que indica `scripts/ffmpeg-build.json` (para la 0.2.0, `7adfbe40dcde598f93a6963d2f7b22cd75202ccc`; el nombre de la versión lo lleva abreviado tras la `g`). Los scripts de compilación y las versiones de las bibliotecas que se enlazan están en <https://github.com/FFmpeg-Builds/FFmpeg-Builds>.
- **Easy Cut 0.1.0** incluía una compilación de la rama principal, `N-126374-g089a48eb36` (commit `089a48eb36`).

Si necesitas el código fuente correspondiente a los ejecutables de una versión concreta de Easy Cut y no lo encuentras en esos enlaces, abre una incidencia en este repositorio.

## Bibliotecas

Las dependencias de Rust y de JavaScript con las que se compila la app están listadas, con sus versiones, en `src-tauri/Cargo.lock` y `pnpm-lock.yaml`; cada una se distribuye bajo su propia licencia (en su mayoría MIT o Apache-2.0).
