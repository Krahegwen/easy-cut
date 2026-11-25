// Encoders de H.264: parámetros por preset, prueba mínima de cada encoder hardware y elección con fallback.

import { PRESETS, type OutputSpec } from './output'

export type HardwareEncoder = 'h264_nvenc' | 'h264_qsv' | 'h264_amf'
export type VideoEncoder = HardwareEncoder | 'libx264'

/** Orden de preferencia: el PC de destino tiene una NVIDIA (GTX 1060). */
export const HARDWARE_ENCODERS: readonly HardwareEncoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf']
export const SOFTWARE_ENCODER = 'libx264' as const

export const ENCODER_LABELS: Record<VideoEncoder, string> = {
  h264_nvenc: 'Tarjeta gráfica NVIDIA',
  h264_qsv: 'Gráficos Intel',
  h264_amf: 'Tarjeta gráfica AMD',
  libx264: 'Procesador',
}

const k = (kbps: number) => `${Math.round(kbps)}k`

/**
 * Parámetros de vídeo del encoder para una salida concreta.
 * NVENC va con opciones conservadoras que admite Pascal (GTX 10xx): sin B-frames como
 * referencia (`-b_ref_mode disabled`), presets p1–p7 (driver ≥ 456) y sin lookahead ni temporal AQ.
 */
export function encoderVideoArgs(encoder: VideoEncoder, spec: OutputSpec): string[] {
  const preset = PRESETS[spec.preset]
  const gop = String(spec.fps * 2)
  const rate = ['-maxrate', k(spec.maxBitrateKbps), '-bufsize', k(spec.bufferKbps)]
  switch (encoder) {
    case 'libx264':
      return [
        '-c:v', 'libx264',
        '-preset', preset.x264Preset,
        '-crf', String(preset.x264Crf),
        ...rate,
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        '-g', gop,
      ]
    case 'h264_nvenc':
      return [
        '-c:v', 'h264_nvenc',
        '-preset', 'p5',
        '-tune', 'hq',
        '-rc', 'vbr',
        '-cq', String(preset.hwQuality),
        '-b:v', k(spec.videoBitrateKbps),
        ...rate,
        '-profile:v', 'high',
        '-bf', '2',
        '-b_ref_mode', 'disabled',
        '-spatial-aq', '1',
        '-pix_fmt', 'yuv420p',
        '-g', gop,
      ]
    case 'h264_qsv':
      return [
        '-c:v', 'h264_qsv',
        '-preset', 'medium',
        '-b:v', k(spec.videoBitrateKbps),
        ...rate,
        '-profile:v', 'high',
        '-pix_fmt', 'nv12',
        '-g', gop,
      ]
    case 'h264_amf':
      return [
        '-c:v', 'h264_amf',
        '-usage', 'transcoding',
        '-quality', 'quality',
        '-rc', 'vbr_peak',
        '-b:v', k(spec.videoBitrateKbps),
        ...rate,
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        '-g', gop,
      ]
  }
}

/** Salida de prueba con la que se comprueba un encoder (los mismos parámetros que la exportación). */
const PROBE_SPEC: OutputSpec = {
  preset: 'youtube',
  width: 640,
  height: 360,
  fps: 30,
  videoBitrateKbps: 1_000,
  maxBitrateKbps: 1_500,
  bufferKbps: 3_000,
  audioBitrateKbps: 128,
}

/**
 * Prueba mínima: 1 s de `lavfi` codificado a `-f null`. Si ffmpeg sale con código 0, el encoder sirve.
 * Se usan los mismos parámetros que en la exportación, para descubrir también opciones no admitidas.
 */
export function buildEncoderProbeArgs(encoder: VideoEncoder): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `testsrc2=size=${PROBE_SPEC.width}x${PROBE_SPEC.height}:rate=${PROBE_SPEC.fps}:duration=1`,
    ...encoderVideoArgs(encoder, PROBE_SPEC),
    '-f', 'null',
    '-',
  ]
}

export type EncoderProbeResults = Partial<Record<VideoEncoder, boolean>>

/** El primer encoder hardware que haya pasado la prueba; si ninguno, libx264. */
export function chooseEncoder(results: EncoderProbeResults, preferred?: VideoEncoder): VideoEncoder {
  if (preferred && (preferred === SOFTWARE_ENCODER || results[preferred] === true)) return preferred
  return HARDWARE_ENCODERS.find((e) => results[e] === true) ?? SOFTWARE_ENCODER
}

/** Encoders a intentar en orden si una exportación falla: los hardware que pasaron y al final libx264. */
export function encoderFallbackChain(results: EncoderProbeResults, preferred?: VideoEncoder): VideoEncoder[] {
  const first = chooseEncoder(results, preferred)
  const chain: VideoEncoder[] = [first]
  for (const e of HARDWARE_ENCODERS) if (results[e] === true && !chain.includes(e)) chain.push(e)
  if (!chain.includes(SOFTWARE_ENCODER)) chain.push(SOFTWARE_ENCODER)
  return chain
}
