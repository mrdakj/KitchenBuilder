// Predefined assets bundled with the app under /public/assets. Each entry's
// id is prefixed with "predef:" so loaders can distinguish them from
// user-uploaded assets stored in IndexedDB.

export type PredefinedAssetCategory = 'sink' | 'electric'

export type PredefinedAsset = {
  id: string
  name: string
  category: PredefinedAssetCategory
  // Path to the GLTF/GLB root file, relative to the site root (served from /public).
  rootUrl: string
}

export const PREDEFINED_ASSETS: PredefinedAsset[] = [
  {
    id: 'predef:sink',
    name: 'Kitchen Sink',
    category: 'sink',
    rootUrl: '/assets/sink/scene.gltf',
  },
  {
    id: 'predef:mixer',
    name: 'Stand Mixer',
    category: 'electric',
    rootUrl: '/assets/mixer/scene.gltf',
  },
  {
    id: 'predef:fridge',
    name: 'Fridge',
    category: 'electric',
    rootUrl: '/assets/fridge/scene.gltf',
  },
  {
    id: 'predef:oven',
    name: 'Oven',
    category: 'electric',
    rootUrl: '/assets/oven/scene.gltf',
  },
  {
    id: 'predef:induction',
    name: 'Induction Hob',
    category: 'electric',
    rootUrl: '/assets/induction_hob/scene.gltf',
  },
]

export function isPredefinedAssetId(id: string): boolean {
  return id.startsWith('predef:')
}

export function getPredefinedAsset(id: string): PredefinedAsset | undefined {
  return PREDEFINED_ASSETS.find((a) => a.id === id)
}
