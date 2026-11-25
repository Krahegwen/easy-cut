// Tipos de los eventos de la vista previa.
import type { FramingLayout } from '../domain'

export interface PlayerTime {
  projectMs: number
  clipIndex: number
  sourceMs: number
  playing: boolean
}

export interface PanEvent {
  phase: 'start' | 'move' | 'end'
  dx: number
  dy: number
  layout: FramingLayout
  frameWidth: number
  frameHeight: number
}

