'use client'

import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls, Environment } from '@react-three/drei'
import { SceneRenderer } from './scene-renderer'
import { GroundPlane } from './ground-plane'
import { SelectionGizmo } from './selection-gizmo'
import { PlacementPreview } from './placement-preview'
import { DblClickMover } from './dbl-click-mover'
import { CameraViewSync } from './camera-view-sync'
import { OriginMarker } from './origin-marker'
import { Measurements } from './measurements'
import { ToolOverlay3D } from '@/editor/tools/tool-overlay-3d'
import { useEditor, type LightingPreset } from '@/core/store/use-editor'

type LightingTuning = {
  envPreset: 'apartment' | 'studio' | 'sunset' | 'night' | 'city' | 'park' | 'warehouse'
  ambient: number
  directional: number
  background: string
}

// Lower ambient + a punchy directional gives the scene visible shadows and
// proper light/dark falloff instead of the previous "everything's evenly
// lit, can barely see the shadows" look. Each preset still has its own
// envmap so reflections look right per mood.
const LIGHTING_TUNING: Record<LightingPreset, LightingTuning> = {
  apartment: { envPreset: 'apartment', ambient: 0.10, directional: 1.0, background: '#1a1a1a' },
  studio:    { envPreset: 'studio',    ambient: 0.15, directional: 1.2, background: '#202024' },
  sunset:    { envPreset: 'sunset',    ambient: 0.10, directional: 1.1, background: '#221814' },
  night:     { envPreset: 'night',     ambient: 0.04, directional: 0.4, background: '#0d0d12' },
}

export function Canvas3D() {
  const lightingPreset = useEditor((s) => s.lightingPreset)
  const tuning = LIGHTING_TUNING[lightingPreset]
  return (
    <Canvas
      shadows
      camera={{ position: [5, 4, 6], fov: 45, near: 0.1, far: 200 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={[tuning.background]} />
      <ambientLight intensity={tuning.ambient} />
      <directionalLight position={[5, 8, 4]} intensity={tuning.directional} castShadow />
      {/* Suspense around Environment: while drei loads the new HDR after a
          preset switch, the old envmap is unmounted and materials see a null
          envmap which combined with the directional light blew the whole
          scene out white. Suspending lets the previous frame stay visible
          until the new HDR is ready, so the swap looks instant. */}
      <Suspense fallback={null}>
        <Environment key={tuning.envPreset} preset={tuning.envPreset} />
      </Suspense>

      <Grid
        position={[0, 0, 0]}
        args={[20, 20]}
        // Subtle but legible: sub-grid cells just light enough to read, the
        // 2 m sections noticeably brighter as the dominant lines.
        cellColor="#3a3a3a"
        sectionColor="#5a5a5a"
        cellSize={0.5}
        sectionSize={2}
        cellThickness={0.7}
        sectionThickness={1.0}
        // Generous fadeDistance keeps the grid visible at ortho/orbit
        // distances — never auto-removed regardless of camera view.
        fadeDistance={150}
        fadeStrength={1}
        infiniteGrid
      />

      <GroundPlane />
      <OriginMarker />
      <Suspense fallback={null}>
        <SceneRenderer />
      </Suspense>
      <SelectionGizmo />
      <PlacementPreview />
      <DblClickMover />
      <ToolOverlay3D />
      <CameraViewSync />
      <Measurements />

      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  )
}
