import { useScene } from '@/core/store/use-scene'
import type { CabinetNode } from '@/core/schema'

export function cabinetWorldTop(node: CabinetNode): number {
  return node.transform.position[1] + node.height
}

export function snapCabinetToStack(id: string) {
  const state = useScene.getState()
  const node = state.nodes[id]
  if (!node || node.type !== 'cabinet' || !node.stackedBelowId) return
  const below = state.nodes[node.stackedBelowId]
  if (!below || below.type !== 'cabinet') return
  const topY = cabinetWorldTop(below)
  state.updateNode(id, {
    transform: {
      ...node.transform,
      position: [below.transform.position[0], topY, below.transform.position[2]],
      rotationY: below.transform.rotationY,
    },
  } as Partial<CabinetNode>)
}

export function findCabinetBelow(
  pos: [number, number, number],
  footprint: { w: number; d: number },
  ignoreId?: string,
): string | null {
  const state = useScene.getState()
  let best: { id: string; topY: number } | null = null
  for (const n of Object.values(state.nodes)) {
    if (n.type !== 'cabinet' || n.id === ignoreId) continue
    const dx = Math.abs(n.transform.position[0] - pos[0])
    const dz = Math.abs(n.transform.position[2] - pos[2])
    if (dx > footprint.w * 0.5 || dz > footprint.d * 0.5) continue
    const top = cabinetWorldTop(n)
    if (top > pos[1] + 0.01) continue
    if (!best || top > best.topY) best = { id: n.id, topY: top }
  }
  return best?.id ?? null
}
