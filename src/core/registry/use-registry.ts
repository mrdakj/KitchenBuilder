import { useEffect, type RefObject } from 'react'
import type { Object3D } from 'three'
import type { NodeType } from '@/core/schema'
import { sceneRegistry } from './scene-registry'

export function useRegistry(id: string, type: NodeType, ref: RefObject<Object3D | null>) {
  useEffect(() => {
    if (!ref.current) return
    sceneRegistry.register(id, type, ref.current)
    return () => sceneRegistry.unregister(id, type)
  }, [id, type, ref])
}
