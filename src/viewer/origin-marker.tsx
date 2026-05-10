'use client'

import { useMemo } from 'react'
import * as THREE from 'three'

// World-origin marker — three short coloured line segments (X red, Y green,
// Z blue) plus a tiny dot. Helps the user keep their bearings, especially
// after rotating the camera or switching ortho views.
const LEN = 0.4

export function OriginMarker() {
  const xGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, LEN, 0, 0]), 3))
    return g
  }, [])
  const yGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, LEN, 0]), 3))
    return g
  }, [])
  const zGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, LEN]), 3))
    return g
  }, [])

  return (
    <group raycast={() => null}>
      <mesh raycast={() => null}>
        <sphereGeometry args={[0.025, 12, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <lineSegments raycast={() => null}>
        <primitive object={xGeom} attach="geometry" />
        <lineBasicMaterial color="#ff5555" linewidth={2} />
      </lineSegments>
      <lineSegments raycast={() => null}>
        <primitive object={yGeom} attach="geometry" />
        <lineBasicMaterial color="#55dd55" linewidth={2} />
      </lineSegments>
      <lineSegments raycast={() => null}>
        <primitive object={zGeom} attach="geometry" />
        <lineBasicMaterial color="#5599ff" linewidth={2} />
      </lineSegments>
    </group>
  )
}
