'use client'

import { useScene } from '@/core/store/use-scene'
import { WallRenderer } from './wall-renderer'
import { CabinetRenderer } from './cabinet-renderer'
import { CountertopRenderer } from './countertop-renderer'
import { CustomItemRenderer } from './custom-item-renderer'
import { LightRenderer } from './light-renderer'
import { EmptyRenderer } from './empty-renderer'

export function NodeRenderer({ nodeId }: { nodeId: string }) {
  const node = useScene((s) => s.nodes[nodeId])
  if (!node || !node.visible) return null

  switch (node.type) {
    case 'wall':
      return <WallRenderer node={node} />
    case 'cabinet':
      return <CabinetRenderer node={node} />
    case 'countertop':
      return <CountertopRenderer node={node} />
    case 'custom-item':
      return <CustomItemRenderer node={node} />
    case 'light':
      return <LightRenderer node={node} />
    case 'empty':
      return <EmptyRenderer node={node} />
    case 'room':
      return null
    default:
      return null
  }
}
