'use client'

import { create } from 'zustand'

export type Tool = 'select' | 'wall' | 'cabinet' | 'countertop' | 'place-item' | 'light' | 'empty'
export type ViewMode = '3d' | '2d' | 'split'
export type TransformMode = 'translate' | 'rotate' | 'scale'
export type SnapMode = 'auto' | 'corner' | 'edge' | 'face' | 'axis'
// Camera presets. 'free' = user-controlled (default); the X/Y/Z presets snap
// the camera onto the corresponding world axis looking at the origin. Bumped
// once per click so re-clicking the same axis re-applies the view (e.g. after
// the user has orbited away).
export type CameraView = 'free' | 'x' | 'y' | 'z'
export type CameraViewRequest = { view: CameraView; nonce: number }

// Lighting presets. Each maps to an Environment preset + ambient/directional
// intensities tuned for a particular mood. 'apartment' is the existing default.
export type LightingPreset = 'apartment' | 'studio' | 'sunset' | 'night'

type EditorState = {
  tool: Tool
  viewMode: ViewMode
  transformMode: TransformMode
  placingAssetId: string | null
  wallDrawStart: [number, number] | null
  snapEnabled: boolean
  snapMode: SnapMode
  snapStep: number
  snapAngleDeg: number
  cabinetDefaults: {
    style: 'base' | 'wall' | 'tall'
    width: number
    height: number
    depth: number
    doorKind: 'none' | 'single' | 'double' | 'drawers'
    drawerCount: number
  }
  cameraViewRequest: CameraViewRequest
  lightingPreset: LightingPreset
  showMeasurements: boolean

  setTool: (t: Tool) => void
  setViewMode: (m: ViewMode) => void
  setTransformMode: (m: TransformMode) => void
  setPlacingAssetId: (id: string | null) => void
  setWallDrawStart: (p: [number, number] | null) => void
  setSnapEnabled: (v: boolean) => void
  setSnapMode: (m: SnapMode) => void
  setCabinetDefaults: (d: Partial<EditorState['cabinetDefaults']>) => void
  setCameraView: (v: CameraView) => void
  setLightingPreset: (p: LightingPreset) => void
  setShowMeasurements: (v: boolean) => void
}

export const useEditor = create<EditorState>((set) => ({
  tool: 'select',
  viewMode: 'split',
  transformMode: 'translate',
  placingAssetId: null,
  wallDrawStart: null,
  snapEnabled: true,
  snapMode: 'auto',
  snapStep: 0.1,
  snapAngleDeg: 90,
  cabinetDefaults: { style: 'base', width: 0.6, height: 0.85, depth: 0.6, doorKind: 'single', drawerCount: 3 },
  cameraViewRequest: { view: 'free', nonce: 0 },
  lightingPreset: 'apartment',
  showMeasurements: false,

  setTool: (tool) => set({ tool, wallDrawStart: null }),
  setViewMode: (viewMode) => set({ viewMode }),
  setTransformMode: (transformMode) => set({ transformMode, tool: 'select', wallDrawStart: null }),
  setPlacingAssetId: (placingAssetId) => set({ placingAssetId }),
  setWallDrawStart: (wallDrawStart) => set({ wallDrawStart }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setSnapMode: (snapMode) => set({ snapMode }),
  setCabinetDefaults: (d) =>
    set((s) => ({ cabinetDefaults: { ...s.cabinetDefaults, ...d } })),
  setCameraView: (view) =>
    set((s) => ({ cameraViewRequest: { view, nonce: s.cameraViewRequest.nonce + 1 } })),
  setLightingPreset: (lightingPreset) => set({ lightingPreset }),
  setShowMeasurements: (showMeasurements) => set({ showMeasurements }),
}))
