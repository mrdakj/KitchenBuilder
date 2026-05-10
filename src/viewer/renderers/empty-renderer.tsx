'use client'

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Mesh } from 'three'
import type { EmptyNode } from '@/core/schema'
import { useRegistry } from '@/core/registry/use-registry'
import { emitter } from '@/core/events/emitter'
import { useScene } from '@/core/store/use-scene'

// Visual marker for an empty parent: small wireframe sphere + 3-axis cross.
// The mesh is the registry/selection handle; the empty itself has no
// geometric extents and isn't a snap target.
const SIZE = 0.08

export function EmptyRenderer({ node }: { node: EmptyNode }) {
  const meshRef = useRef<Mesh>(null!)
  useRegistry(node.id, 'empty', meshRef)
  const selected = useScene((s) => s.selectedIds.includes(node.id))
  const color = selected ? '#ffdd66' : '#88aaff'

  // Three short line segments showing local +X / +Y / +Z so the empty's
  // orientation is visible in the scene.
  const axisGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const k = SIZE * 1.5
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-k, 0, 0, k, 0, 0, 0, -k, 0, 0, k, 0, 0, 0, -k, 0, 0, k]),
        3,
      ),
    )
    return g
  }, [])

  return (
    <group position={node.transform.position} rotation={[0, node.transform.rotationY, 0]}>
      <mesh
        ref={meshRef}
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
        <sphereGeometry args={[SIZE, 12, 8]} />
        <meshBasicMaterial color={color} wireframe />
      </mesh>
      <lineSegments raycast={() => null}>
        <primitive object={axisGeom} attach="geometry" />
        <lineBasicMaterial color={color} />
      </lineSegments>
    </group>
  )
}
