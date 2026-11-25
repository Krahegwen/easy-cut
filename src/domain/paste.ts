// Qué se pega con Ctrl+V en «Tu vídeo»: los ficheros copiados en el Explorador o el trozo copiado en la app.
//
// El portapapeles de Windows lleva un número de secuencia que sube cada vez que algo lo cambia
// (GetClipboardSequenceNumber). Al copiar un trozo en la app se apunta ese número: si al pegar sigue igual,
// lo último que se ha copiado es el trozo, aunque el portapapeles conserve unos ficheros de antes; si ha
// cambiado y trae ficheros, los ficheros son lo más nuevo y mandan.

/** Trozo copiado en la app y el número de secuencia del portapapeles del sistema en ese momento. */
export interface CopiedClipMark {
  /** null si no se pudo leer (fuera de Windows): entonces cualquier fichero del sistema se tiene por más nuevo. */
  sequence: number | null
}

/** Lo que hay en el portapapeles del sistema. */
export interface SystemClipboardFiles {
  sequence: number
  paths: readonly string[]
}

export type PasteSource =
  | { kind: 'files'; paths: string[] }
  | { kind: 'clip' }
  /** Hay ficheros más nuevos que el trozo, pero ninguno es un vídeo ni un sonido. */
  | { kind: 'not-media'; paths: string[] }
  | { kind: 'nothing' }

export function choosePasteSource(
  copied: CopiedClipMark | null,
  system: SystemClipboardFiles | null,
  isMedia: (path: string) => boolean,
): PasteSource {
  const files = system?.paths ?? []
  const filesAreNewer = files.length > 0 && (!copied || copied.sequence === null || copied.sequence !== system!.sequence)
  if (filesAreNewer) {
    const media = files.filter(isMedia)
    if (media.length > 0) return { kind: 'files', paths: media }
    return { kind: 'not-media', paths: [...files] }
  }
  if (copied) return { kind: 'clip' }
  return { kind: 'nothing' }
}

/** ¿Tiene sentido ofrecer «Pegar»? (los ficheros que no son vídeos no cuentan). */
export function canPaste(copied: CopiedClipMark | null, system: SystemClipboardFiles | null, isMedia: (path: string) => boolean): boolean {
  const s = choosePasteSource(copied, system, isMedia)
  return s.kind === 'files' || s.kind === 'clip'
}
