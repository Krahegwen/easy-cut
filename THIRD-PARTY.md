# Programas de terceros incluidos en el instalador

## FFmpeg (`ffmpeg.exe` y `ffprobe.exe`)

El instalador de Easy Cut incluye, sin modificar, los ejecutables `ffmpeg.exe` y `ffprobe.exe`. Easy Cut los lanza como programas independientes; no están enlazados con su código.

- **Proyecto**: [FFmpeg](https://ffmpeg.org) — © the FFmpeg developers.
- **Compilación**: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), variante `win64-gpl` (estática).
- **Licencia**: [GNU General Public License, versión 3](https://www.gnu.org/licenses/gpl-3.0.html) (la compilación usa `--enable-gpl --enable-version3` e incluye, entre otras, libx264 y libx265).
- **Versión incluida**: la indica la nota de cada versión publicada en GitHub. Se puede comprobar en una instalación con `ffmpeg.exe -version`, en la carpeta donde se instala la app.
- **Código fuente**: el repositorio de FFmpeg, <https://git.ffmpeg.org/ffmpeg.git>, en la revisión que aparece en el nombre de la versión (por ejemplo, `N-126374-g089a48eb36` corresponde al commit `089a48eb36`). Los scripts de compilación y las versiones de las bibliotecas que se enlazan están en <https://github.com/BtbN/FFmpeg-Builds>.

Si necesitas el código fuente correspondiente a los ejecutables de una versión concreta de Easy Cut y no lo encuentras en esos enlaces, abre una incidencia en este repositorio.

## Bibliotecas

Las dependencias de Rust y de JavaScript con las que se compila la app están listadas, con sus versiones, en `src-tauri/Cargo.lock` y `pnpm-lock.yaml`; cada una se distribuye bajo su propia licencia (en su mayoría MIT o Apache-2.0).
