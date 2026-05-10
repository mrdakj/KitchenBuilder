'use client'

import { Html } from '@react-three/drei'
import { useScene } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import type { AnyNode } from '@/core/schema'
import { dimsOf } from '@/core/systems/object-snap'

// World-space dimensions (W × H × D in metres) for any node we can size.
function nodeSize(n: AnyNode): { w: number; h: number; d: number } | null {
  if (n.type === 'wall') {
    const len = Math.hypot(n.end[0] - n.start[0], n.end[1] - n.start[1])
    return { w: len, h: n.height, d: n.thickness }
  }
  return dimsOf(n)
}

// Anchor position for the label (world-space). Hovers above each object's
// top-centre so it doesn't obscure the geometry.
function nodeAnchor(n: AnyNode): [number, number, number] | null {
  if (n.type === 'wall') {
    const cx = (n.start[0] + n.end[0]) / 2
    const cz = (n.start[1] + n.end[1]) / 2
    return [cx, n.height + 0.1, cz]
  }
  if (n.type === 'cabinet') return [n.transform.position[0], n.transform.position[1] + n.height + 0.1, n.transform.position[2]]
  if (n.type === 'countertop') return [n.transform.position[0], n.transform.position[1] + n.thickness / 2 + 0.1, n.transform.position[2]]
  if (n.type === 'custom-item') {
    const sy = n.scale?.[1] ?? 1
    return [n.transform.position[0], n.transform.position[1] + 0.5 * sy + 0.1, n.transform.position[2]]
  }
  return null
}

const fmt = (m: number) => `${(m * 100).toFixed(1)} cm`

export function Measurements() {
  const show = useEditor((s) => s.showMeasurements)
  const selectedIds = useScene((s) => s.selectedIds)
  const nodes = useScene((s) => s.nodes)
  if (!show || selectedIds.length === 0) return null
  return (
    <>
      {selectedIds.map((id) => {
        const n = nodes[id]
        if (!n) return null
        const size = nodeSize(n)
        const anchor = nodeAnchor(n)
        if (!size || !anchor) return null
        return (
          <Html key={id} position={anchor} center distanceFactor={6} occlude={false} pointerEvents="none">
            <div className="px-2 py-1 rounded bg-neutral-900/90 border border-neutral-700 text-[11px] text-amber-200 whitespace-nowrap select-none">
              W {fmt(size.w)} · H {fmt(size.h)} · D {fmt(size.d)}
            </div>
          </Html>
        )
      })}
    </>
  )
}
