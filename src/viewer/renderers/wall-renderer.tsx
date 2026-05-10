'use client'

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Mesh } from 'three'
import type { WallNode } from '@/core/schema'
import { buildWallGeometry } from '@/core/geometry/wall'
import { useRegistry } from '@/core/registry/use-registry'
import { emitter } from '@/core/events/emitter'
import { useScene } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import { useMaterialTexture } from '@/viewer/use-material-texture'

export function WallRenderer({ node }: { node: WallNode }) {
  const ref = useRef<Mesh>(null!)
  useRegistry(node.id, 'wall', ref)
  const selected = useScene((s) => s.selectedIds.includes(node.id))
  const rep = node.material.textureRepeat ?? 2
  const colorMap = useMaterialTexture(node.material.textureUrl, false, rep)
  const normalMap = useMaterialTexture(node.material.normalMapUrl, true, rep)
  const roughnessMap = useMaterialTexture(node.material.roughnessMapUrl, true, rep)
  const nScale = node.material.normalScale ?? 1.5

  // Subscribe to the (stable-reference) nodes object and derive the OTHER
  // walls list inside a memo. Returning a freshly-built array directly from
  // the selector triggers React's "result of getSnapshot should be cached"
  // warning because each render produces a new array reference.
  const nodes = useScene((s) => s.nodes)
  const otherWalls = useMemo(() => {
    const out: WallNode[] = []
    for (const n of Object.values(nodes)) {
      if (n.type === 'wall' && n.id !== node.id) out.push(n)
    }
    return out
  }, [nodes, node.id])
  const otherWallKey = otherWalls
    .map((w) => `${w.id}:${w.start[0]},${w.start[1]}:${w.end[0]},${w.end[1]}:${w.thickness}`)
    .join('|')

  const built = useMemo(
    () => buildWallGeometry(node, otherWalls),
    [node.start, node.end, node.height, node.thickness, otherWallKey],
  )
  if (!built) return null

  return (
    <mesh
      ref={ref}
      geometry={built.geom}
      position={built.position}
      rotation={[0, built.rotationY, 0]}
      onPointerDown={(e) => {
        if (useEditor.getState().tool !== 'select') return
        e.stopPropagation()
        emitter.emit('node:click', {
          node,
          position: [e.point.x, e.point.y, e.point.z],
          normal: e.face?.normal ? [e.face.normal.x, e.face.normal.y, e.face.normal.z] : undefined,
          shiftKey: e.nativeEvent?.shiftKey,
          ctrlKey: e.nativeEvent?.ctrlKey,
          metaKey: e.nativeEvent?.metaKey,
          altKey: e.nativeEvent?.altKey,
        })
      }}
      onClick={(e) => {
        if (useEditor.getState().tool !== 'select') return
        e.stopPropagation()
      }}
    >
      <meshStandardMaterial
        key={`${colorMap?.uuid ?? 'n'}-${normalMap?.uuid ?? 'n'}-${roughnessMap?.uuid ?? 'n'}`}
        color={selected ? '#ffdd66' : node.material.color}
        roughness={node.material.roughness}
        metalness={node.material.metalness}
        map={colorMap}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(nScale, nScale)}
        roughnessMap={roughnessMap}
      />
    </mesh>
  )
}
