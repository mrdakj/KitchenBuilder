'use client'

import { useFrame } from '@react-three/fiber'
import { useScene } from '@/core/store/use-scene'

export function Systems() {
  useFrame(() => {
    const state = useScene.getState()
    if (state.dirtyNodes.size === 0) return
    for (const id of state.dirtyNodes) {
      state.clearDirty(id)
    }
  })
  return null
}
