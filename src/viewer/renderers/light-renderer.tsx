'use client'

import { useRef } from 'react'
import type { Mesh } from 'three'
import type { LightNode } from '@/core/schema'
import { useRegistry } from '@/core/registry/use-registry'
import { emitter } from '@/core/events/emitter'
import { useScene } from '@/core/store/use-scene'

// Indicator mesh + the actual Three light, both positioned directly at
// node.position (no wrapping group). A previous version wrapped them in
// `<group position={node.position}>` and rendered the mesh at local origin,
// which caused TransformControls to write a non-zero LOCAL offset to the
// mesh during drag while the group's position was updated from world
// coords each frame — the world position became (group + mesh) and grew
// every frame, so tiny drags multiplied into huge jumps. Pinning the
// mesh's position prop to node.position keeps target.position == world,
// which is what patchFromObject's `getWorldPosition` already assumes.
export function LightRenderer({ node }: { node: LightNode }) {
  const meshRef = useRef<Mesh>(null!)
  useRegistry(node.id, 'light', meshRef)
  const selected = useScene((s) => s.selectedIds.includes(node.id))

  const indicatorColor = selected ? '#ffdd66' : node.color

  return (
    <>
      <mesh
        ref={meshRef}
        position={node.position}
        onPointerDown={(e) => {
          e.stopPropagation()
          emitter.emit('node:click', {
            node,
            position: [e.point.x, e.point.y, e.point.z],
            shiftKey: e.nativeEvent?.shiftKey,
            ctrlKey: e.nativeEvent?.ctrlKey,
            metaKey: e.nativeEvent?.metaKey,
            altKey: e.nativeEvent?.altKey,
          })
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <sphereGeometry args={[0.08, 16, 12]} />
        <meshBasicMaterial color={indicatorColor} />
      </mesh>

      {/* decay={1} (linear) instead of physical inverse-square so the slider
          range maps to clearly perceptible brightness changes — at decay=2
          intensity 8 was nearly invisible against the ambient + envmap. */}
      {node.kind === 'point' && (
        <pointLight position={node.position} intensity={node.intensity} color={node.color} distance={0} decay={1} castShadow />
      )}
      {node.kind === 'spot' && (
        <spotLight
          position={node.position}
          intensity={node.intensity}
          color={node.color}
          angle={Math.PI / 6}
          penumbra={0.4}
          distance={0}
          decay={1}
          castShadow
        />
      )}
      {node.kind === 'rect' && (
        // RectAreaLight needs ambient setup not bundled here; render as a
        // diffuse point light fallback so the placeholder still illuminates.
        <pointLight position={node.position} intensity={node.intensity * 0.6} color={node.color} distance={0} decay={1} />
      )}
    </>
  )
}
