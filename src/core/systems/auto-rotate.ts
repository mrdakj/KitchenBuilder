// Auto-rotate placement helper. When the user drops a cabinet, fridge,
// oven, etc. near a wall, the object's back should face the wall — that's
// how kitchens are laid out. Rather than asking users to rotate manually
// every time, the placement handler queries this helper and uses the
// returned rotationY for the new node.

import { useScene } from '@/core/store/use-scene'
import type { AnyNode } from '@/core/schema'

const FACE_DIST = 0.6 // 60 cm — within this range of a wall, auto-orient
const WALL_END_TOLERANCE = 0.05
const QUARTER_TURN = Math.PI / 2

export function shouldAutoRotateToWall(node: AnyNode): boolean {
  if (node.type === 'cabinet') return true
  if (node.type !== 'custom-item') return false
  return node.assetId === 'predef:fridge' || node.assetId === 'predef:oven'
}

function visualFrontOffsetY(node: AnyNode | null): number {
  if (node?.type !== 'custom-item') return 0
  // The bundled fridge GLTF's door/handle side is local +X after its
  // authored root transform, unlike cabinets whose doors face local +Z.
  if (node.assetId === 'predef:fridge') return QUARTER_TURN
  return 0
}

/**
 * Given a placement position, find the nearest wall within {@link FACE_DIST}
 * and return the Y rotation that orients the object's back toward that wall
 * (equivalently, its front away from the wall). Returns null when no wall
 * is close enough — the caller should keep the existing rotation.
 *
 * Three.js Y-rotation convention: local +Z in world = (sin(rotY), 0, cos(rotY)).
 * We want local +Z (the object's front) to point along the wall's outward
 * normal — i.e. the unit vector that points from the wall plane toward
 * the object. That's:
 *   rotY = atan2(normal.x, normal.z)
 */
export function findWallFacingRotation(
  pos: [number, number, number],
  node: AnyNode | null = null,
  maxDist = FACE_DIST,
): number | null {
  const nodes = useScene.getState().nodes
  const [px, , pz] = pos
  let bestDist = maxDist
  let bestRot: number | null = null
  for (const w of Object.values(nodes)) {
    if (w.type !== 'wall' || !w.visible) continue
    const dx = w.end[0] - w.start[0]
    const dz = w.end[1] - w.start[1]
    const len = Math.hypot(dx, dz)
    if (len < 1e-3) continue
    const dirX = dx / len
    const dirZ = dz / len
    // Wall surface normal (rotate direction 90° in XZ).
    const nX = -dirZ
    const nZ = dirX
    const cx = (w.start[0] + w.end[0]) / 2
    const cz = (w.start[1] + w.end[1]) / 2
    const relX = px - cx
    const relZ = pz - cz
    // Signed distance from object to wall plane.
    const distSigned = relX * nX + relZ * nZ
    const distAbs = Math.abs(distSigned)
    if (distAbs > maxDist) continue
    // Position along the wall (must be inside the wall's footprint, with
    // only a tiny tolerance for float/grid noise. A loose corner tolerance
    // makes appliances rotate when they are near a wall end instead of
    // actually against the wall face.
    const along = relX * dirX + relZ * dirZ
    if (Math.abs(along) > len / 2 + WALL_END_TOLERANCE) continue
    if (distAbs < bestDist) {
      bestDist = distAbs
      // Outward normal pointing FROM wall TOWARD object.
      const sign = distSigned >= 0 ? 1 : -1
      const tx = nX * sign
      const tz = nZ * sign
      // Three.js: local +Z direction in world = (sin(rotY), cos(rotY)).
      bestRot = Math.atan2(tx, tz) - visualFrontOffsetY(node)
    }
  }
  return bestRot
}
