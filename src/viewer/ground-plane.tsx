'use client'

import { emitter } from '@/core/events/emitter'

export function GroundPlane() {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      // Sit a clear millimetre below the drei Grid lines (which live at
      // y=0). Any closer and the two surfaces z-fight on some GPUs,
      // showing as flickering grid pixels.
      position={[0, -0.01, 0]}
      onClick={(e) => {
        // Use click (not pointerdown) so a drag on the TransformControls gizmo
        // doesn't reach the ground and deselect. Click only fires when the
        // pointer stays mostly still between down and up.
        e.stopPropagation()
        emitter.emit('grid:click', {
          position: [e.point.x, e.point.y, e.point.z],
          button: e.button ?? 0,
        })
      }}
      onPointerMove={(e) => {
        emitter.emit('grid:move', {
          position: [e.point.x, e.point.y, e.point.z],
          button: e.buttons,
        })
      }}
    >
      <planeGeometry args={[200, 200]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  )
}
