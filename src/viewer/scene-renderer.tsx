'use client'

import { useMemo } from 'react'
import { useScene } from '@/core/store/use-scene'
import { NodeRenderer } from './renderers/node-renderer'

export function SceneRenderer() {
  const nodes = useScene((s) => s.nodes)
  const ids = useMemo(() => Object.keys(nodes), [nodes])
  return (
    <>
      {ids.map((id) => (
        <NodeRenderer key={id} nodeId={id} />
      ))}
    </>
  )
}
