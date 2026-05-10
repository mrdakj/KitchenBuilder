// Predefined PBR materials bundled with the app under /public/materials.
// The inspector exposes these as a dropdown so users can dress a cabinet,
// countertop, or wall with a curated material in one click instead of
// uploading three textures by hand. Each preset is just a MaterialRef
// shape with the public URLs filled in.

import type { MaterialRef } from '@/core/schema'

export type PredefinedMaterial = {
  id: string
  name: string
  // Best-fit category for filtering — purely advisory, not enforced.
  category: 'wood' | 'stone' | 'metal' | 'fabric'
  // Partial overrides applied on top of the current material when picked.
  // We keep `color` neutral white so the texture's true colour shows;
  // texture/normal/roughness URLs point at /public/materials/<id>/*.
  preset: Partial<MaterialRef>
}

export const PREDEFINED_MATERIALS: PredefinedMaterial[] = [
  {
    id: 'wood095',
    name: 'Wood Plank (Wood095)',
    category: 'wood',
    preset: {
      color: '#ffffff',
      roughness: 0.7,
      metalness: 0,
      textureUrl: '/materials/wood095/color.jpg',
      normalMapUrl: '/materials/wood095/normal.jpg',
      roughnessMapUrl: '/materials/wood095/roughness.jpg',
      textureRepeat: 2,
      normalScale: 1.5,
    },
  },
]

export function getPredefinedMaterial(id: string): PredefinedMaterial | undefined {
  return PREDEFINED_MATERIALS.find((m) => m.id === id)
}

// Apply a preset to an existing MaterialRef. Properties absent from the
// preset are preserved so the user's roughness/metalness tweaks survive
// when they switch presets.
export function applyMaterialPreset(current: MaterialRef, presetId: string): MaterialRef {
  const p = getPredefinedMaterial(presetId)
  if (!p) return current
  return { ...current, ...p.preset }
}
