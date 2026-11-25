# easy-cut

Editor de vídeo doméstico para Windows, pensado para alguien no técnico: una tira de trozos que se cortan, parten, encuadran, aceleran o silencian, con «quitar pausas», teleprompter y exportación para WhatsApp, YouTube o calidad alta. ffmpeg/ffprobe (binarios externos) hacen todo el trabajo de vídeo; la shell de escritorio (Tauri 2 o Electron, **sin decidir**) los lanza. La UI es Vue 3.

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
    teleprompter.ts  palabras, duración, ritmo y scroll
    file-name.ts     «Vídeo del 25 de noviembre de 2026 (para WhatsApp).mp4»
  native/bridge.ts   interfaz que implementará la shell (sin implementación)
  App.vue, main.ts   marcador de posición de la UI
tests/integration/   prueba con ffmpeg real (pnpm test:ffmpeg)
```

## Notas de ffmpeg comprobadas

- Las etiquetas BT.709 se ponen con `setparams` en el filtro: `-color_trc`/`-color_primaries` de salida no bastan si el fotograma llega sin especificar.
- Con muchos trozos o pausas quitadas, el filtro puede pasar del límite de 32 767 caracteres de Windows: usar `filterScriptPath` (`-/filter_complex fichero`, ffmpeg ≥ 7.1).
- NVENC va con opciones conservadoras para Pascal (GTX 1060): `-preset p5 -rc vbr -cq … -bf 2 -b_ref_mode disabled`, sin lookahead ni temporal AQ. Probado en una RTX, no en la GTX 1060.
