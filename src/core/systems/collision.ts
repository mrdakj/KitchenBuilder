import { useScene } from '@/core/store/use-scene'
import type { AnyNode, CabinetNode, CountertopNode, CustomItemNode, WallNode } from '@/core/schema'
import { getAssetBbox } from '@/core/assets/asset-bbox'

export type Box = { min: [number, number, number]; max: [number, number, number] }

// Fallback half-extents/height used only when an asset's real bbox isn't
// known yet (asset hasn't loaded). Once the GLTF normalizes and reports its
// size, those numbers take over.
const CUSTOM_EXTENT = 0.25
const CUSTOM_HEIGHT = 0.5
const EPS = 1e-3

export function nodeBox(n: AnyNode): Box | null {
  if (n.type === 'cabinet') {
    const c = n as CabinetNode
    const [x, y, z] = c.transform.position
    return {
      min: [x - c.width / 2 + EPS, y + EPS, z - c.depth / 2 + EPS],
      max: [x + c.width / 2 - EPS, y + c.height - EPS, z + c.depth / 2 - EPS],
    }
  }
  if (n.type === 'countertop') {
    const c = n as CountertopNode
    const [x, y, z] = c.transform.position
    return {
      min: [x - c.width / 2 + EPS, y - c.thickness / 2 + EPS, z - c.depth / 2 + EPS],
      max: [x + c.width / 2 - EPS, y + c.thickness / 2 - EPS, z + c.depth / 2 - EPS],
    }
  }
  if (n.type === 'custom-item') {
    const c = n as CustomItemNode
    const [x, y, z] = c.transform.position
    // Prefer the actual normalized bbox; fall back to the cube approximation
    // until the asset's GLTF has loaded and reported its real size.
    const bb = getAssetBbox(c.assetId)
    const halfX = bb ? (bb[0] / 2) * (c.scale?.[0] ?? 1) : (c.scale?.[0] ?? 1) * CUSTOM_EXTENT
    const fullY = bb ? bb[1] * (c.scale?.[1] ?? 1) : (c.scale?.[1] ?? 1) * CUSTOM_HEIGHT
    const halfZ = bb ? (bb[2] / 2) * (c.scale?.[2] ?? 1) : (c.scale?.[2] ?? 1) * CUSTOM_EXTENT
    return {
      min: [x - halfX + EPS, y + EPS, z - halfZ + EPS],
      max: [x + halfX - EPS, y + fullY - EPS, z + halfZ - EPS],
    }
  }
  if (n.type === 'wall') {
    const w = n as WallNode
    const dx = w.end[0] - w.start[0]
    const dz = w.end[1] - w.start[1]
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) return null
    const nxv = -dz / len
    const nzv = dx / len
    const h = w.thickness / 2
    const xs = [
      w.start[0] + nxv * h,
      w.start[0] - nxv * h,
      w.end[0] + nxv * h,
      w.end[0] - nxv * h,
    ]
    const zs = [
      w.start[1] + nzv * h,
      w.start[1] - nzv * h,
      w.end[1] + nzv * h,
      w.end[1] - nzv * h,
    ]
    return {
      min: [Math.min(...xs) + EPS, EPS, Math.min(...zs) + EPS],
      max: [Math.max(...xs) - EPS, w.height - EPS, Math.max(...zs) - EPS],
    }
  }
  return null
}

export function overlaps(a: Box, b: Box): boolean {
  return (
    a.min[0] < b.max[0] &&
    a.max[0] > b.min[0] &&
    a.min[1] < b.max[1] &&
    a.max[1] > b.min[1] &&
    a.min[2] < b.max[2] &&
    a.max[2] > b.min[2]
  )
}

export function collidesBox(ignoreId: string | null, box: Box): string | null {
  const state = useScene.getState()
  for (const n of Object.values(state.nodes)) {
    if (!n.visible) continue
    if (n.id === ignoreId) continue
    const other = nodeBox(n)
    if (!other) continue
    if (overlaps(box, other)) return n.id
  }
  return null
}

export function boxFor(kind: 'cabinet' | 'countertop' | 'place-item', pos: [number, number, number], dims: { w: number; h: number; d: number; y?: number }): Box {
  const y = dims.y ?? pos[1]
  return {
    min: [pos[0] - dims.w / 2, y, pos[2] - dims.d / 2],
    max: [pos[0] + dims.w / 2, y + dims.h, pos[2] + dims.d / 2],
  }
}
