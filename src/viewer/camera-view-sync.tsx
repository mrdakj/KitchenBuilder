'use client'

import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import { useEditor } from '@/core/store/use-editor'

// Distance + FOV pair for axis (ortho-style) views. FOV is small enough
// that perspective foreshortening is barely visible, but the visible
// field has to comfortably show a kitchen-sized room (~5 m). With FOV 1°
// at 50 m we only saw ~0.4 m of scene — that's the "strangely zoomed in"
// the user reported. FOV 6° at 50 m shows ~5.2 m, plenty for a typical
// floor plan while keeping the projection nearly orthographic.
const AXIS_DIST = 50
const AXIS_FOV = 6
const PERSPECTIVE_FOV = 45
const PERSPECTIVE_POS: [number, number, number] = [5, 4, 6]
const TARGET_Y = 1.2

export function CameraViewSync() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as any
  const lastNonce = useRef(0)
  const inAxisViewRef = useRef(false)

  // Ortho-style FOV is preserved through orbit/pan — the user explicitly
  // chose an axis view and expects the zoom level to stay until they
  // press the **P** (perspective) button. Auto-restoring on every drag
  // start was producing the "view zooms out as soon as I rotate" feel.
  void controls // controls intentionally not subscribed for fov reset

  useEffect(() => {
    return useEditor.subscribe((s) => {
      const req = s.cameraViewRequest
      if (req.nonce === lastNonce.current) return
      lastNonce.current = req.nonce

      if (req.view === 'free') {
        // Reset to default perspective.
        camera.fov = PERSPECTIVE_FOV
        camera.position.set(...PERSPECTIVE_POS)
        camera.lookAt(0, TARGET_Y, 0)
        camera.updateProjectionMatrix()
        inAxisViewRef.current = false
        if (controls?.target) {
          controls.target.set(0, TARGET_Y, 0)
          controls.update?.()
        }
        return
      }

      // Axis views (X / Y / Z) — narrow FOV + far camera = ortho-ish look.
      // For SIDE elevations (X / Z) the camera sits AT floor level looking
      // horizontally, so the floor plane passes straight through the view
      // line and renders as a single line at screen-centre. The Y (top)
      // view stays positioned above, looking straight down.
      camera.fov = AXIS_FOV
      let targetY = TARGET_Y
      if (req.view === 'x') {
        camera.position.set(AXIS_DIST, 0, 0)
        targetY = 0
      } else if (req.view === 'y') {
        // Tiny Z offset avoids gimbal lock when looking straight down.
        camera.position.set(0, AXIS_DIST, 0.0001)
        targetY = 0
      } else if (req.view === 'z') {
        camera.position.set(0, 0, AXIS_DIST)
        targetY = 0
      }
      camera.lookAt(0, targetY, 0)
      camera.updateProjectionMatrix()
      inAxisViewRef.current = true
      if (controls?.target) {
        controls.target.set(0, targetY, 0)
        controls.update?.()
      }
    })
  }, [camera, controls])

  return null
}
