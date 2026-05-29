'use client'

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Group } from 'three'
import type { AnyNode, CabinetNode, MaterialRef } from '@/core/schema'

// Memoize once per render — `normalScale={new Vector2(...)}` inline would
// recreate a Vector2 on every render and force the material to update.
const normalScale = (m: MaterialRef) => {
  const s = m.normalScale ?? 1.5
  return new THREE.Vector2(s, s)
}
import { buildCabinetGeometry, computeFillerHeight } from '@/core/geometry/cabinet'
import { useRegistry } from '@/core/registry/use-registry'
import { emitter } from '@/core/events/emitter'
import { useScene } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import { useMaterialTexture } from '@/viewer/use-material-texture'

export function CabinetRenderer({ node }: { node: CabinetNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'cabinet', ref)
  const selected = useScene((s) => s.selectedIds.includes(node.id))
  const nodes = useScene((s) => s.nodes) as Record<string, AnyNode>
  const fillerHeight = node.fillerKind === 'drawer' ? computeFillerHeight(node, nodes) : 0
  const carcassRep = node.carcassMaterial.textureRepeat ?? 2
  const doorRep = node.doorMaterial.textureRepeat ?? 2
  const handleRep = node.handleMaterial.textureRepeat ?? 2
  const carcassTex = useMaterialTexture(node.carcassMaterial.textureUrl, false, carcassRep)
  const carcassNormal = useMaterialTexture(node.carcassMaterial.normalMapUrl, true, carcassRep)
  const carcassRough = useMaterialTexture(node.carcassMaterial.roughnessMapUrl, true, carcassRep)
  const doorTex = useMaterialTexture(node.doorMaterial.textureUrl, false, doorRep)
  const doorNormal = useMaterialTexture(node.doorMaterial.normalMapUrl, true, doorRep)
  const doorRough = useMaterialTexture(node.doorMaterial.roughnessMapUrl, true, doorRep)
  const handleTex = useMaterialTexture(node.handleMaterial.textureUrl, false, handleRep)
  const handleNormal = useMaterialTexture(node.handleMaterial.normalMapUrl, true, handleRep)
  const handleRough = useMaterialTexture(node.handleMaterial.roughnessMapUrl, true, handleRep)

  const geom = useMemo(
    () => buildCabinetGeometry(node, fillerHeight),
    // fillerHeight is derived from scene nodes, so it must be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node.style, node.width, node.height, node.depth, node.doorKind, node.drawerCount, node.fillerKind, fillerHeight],
  )

  const onClick = (e: any) => {
    // While a placement tool is active, let the click pass through to the
    // GroundPlane so the cabinet doesn't shadow the user's intended XZ
    // ground target — this fixes "couldn't place if cursor was over an
    // object that happened to be in front of where I wanted to place".
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
  }
  const swallow = (e: any) => {
    if (useEditor.getState().tool !== 'select') return
    e.stopPropagation()
  }

  const carcassColor = selected ? '#ffdd66' : node.carcassMaterial.color
  const doorColor = selected ? '#ffd24d' : node.doorMaterial.color

  return (
    <group
      ref={ref}
      position={node.transform.position}
      rotation={[0, node.transform.rotationY, 0]}
      onPointerDown={onClick}
      onClick={swallow}
    >
      <mesh geometry={geom.carcass}>
        <meshStandardMaterial
          key={`${carcassTex?.uuid ?? 'n'}-${carcassNormal?.uuid ?? 'n'}-${carcassRough?.uuid ?? 'n'}`}
          color={carcassColor}
          roughness={node.carcassMaterial.roughness}
          metalness={node.carcassMaterial.metalness}
          map={carcassTex}
          normalMap={carcassNormal}
          normalScale={normalScale(node.carcassMaterial)}
          roughnessMap={carcassRough}
        />
      </mesh>
      {geom.doors.map((d, i) => (
        <mesh key={`d${i}`} geometry={d.geom} position={d.position}>
          <meshStandardMaterial
            key={`${doorTex?.uuid ?? 'n'}-${doorNormal?.uuid ?? 'n'}-${doorRough?.uuid ?? 'n'}`}
            color={doorColor}
            roughness={node.doorMaterial.roughness}
            metalness={node.doorMaterial.metalness}
            map={doorTex}
            normalMap={doorNormal}
            normalScale={normalScale(node.doorMaterial)}
            roughnessMap={doorRough}
          />
        </mesh>
      ))}
      {geom.handles.map((h, i) => (
        <mesh key={`h${i}`} geometry={h.geom} position={h.position}>
          <meshStandardMaterial
            key={`${handleTex?.uuid ?? 'n'}-${handleNormal?.uuid ?? 'n'}-${handleRough?.uuid ?? 'n'}`}
            color={node.handleMaterial.color}
            roughness={node.handleMaterial.roughness}
            metalness={node.handleMaterial.metalness}
            map={handleTex}
            normalMap={handleNormal}
            normalScale={normalScale(node.handleMaterial)}
            roughnessMap={handleRough}
          />
        </mesh>
      ))}
    </group>
  )
}
