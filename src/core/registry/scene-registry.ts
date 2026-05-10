import type { Object3D } from 'three'
import type { NodeType } from '@/core/schema'

class SceneRegistry {
  nodes = new Map<string, Object3D>()
  byType = new Map<NodeType, Set<string>>()

  register(id: string, type: NodeType, obj: Object3D) {
    this.nodes.set(id, obj)
    let set = this.byType.get(type)
    if (!set) {
      set = new Set()
      this.byType.set(type, set)
    }
    set.add(id)
  }

  unregister(id: string, type: NodeType) {
    this.nodes.delete(id)
    this.byType.get(type)?.delete(id)
  }

  get(id: string) {
    return this.nodes.get(id)
  }

  getByType(type: NodeType): string[] {
    return Array.from(this.byType.get(type) ?? [])
  }
}

export const sceneRegistry = new SceneRegistry()
