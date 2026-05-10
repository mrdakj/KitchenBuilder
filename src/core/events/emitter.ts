import mitt from 'mitt'
import type { AnyNode } from '@/core/schema'

export type NodeEvent = {
  node: AnyNode
  position: [number, number, number]
  normal?: [number, number, number]
  // Held modifier keys at the time of the click — used by the selection
  // handler to do shift-click multi-select / ctrl-click toggle.
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export type GridEvent = {
  position: [number, number, number]
  button: number
}

export type Events = {
  'node:click': NodeEvent
  'node:hover': NodeEvent
  'node:context-menu': NodeEvent
  'grid:click': GridEvent
  'grid:move': GridEvent
  'selection:change': { id: string | null }
}

export const emitter = mitt<Events>()
