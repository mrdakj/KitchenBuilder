import * as THREE from 'three'
import type { WallNode } from '@/core/schema'

const JOINT_EPS = 0.01 // 1 cm — endpoints within this distance are considered joined

// Miter-extend each wall end where it meets another wall, so the corner
// closes cleanly without visible seams or gaps. The math: at a joint where
// two wall axes diverge by angle θ (each pointing AWAY from the joint),
// each wall is extended along its own axis by (thickness/2) / tan(θ/2).
//
//   - θ = 90°  (perpendicular)  ⇒ extend = thickness/2
//   - θ = 180° (collinear)      ⇒ extend = 0
//   - θ small  (sharp corner)   ⇒ extend grows (needs more material)
//
// At T/X junctions where >2 walls share a point, we pick the largest
// per-pair extension so the wall covers all neighbours.
function jointExtend(
  joint: [number, number],
  awayDir: [number, number],
  thickness: number,
  otherWalls: WallNode[],
): number {
  let maxExt = 0
  for (const w of otherWalls) {
    let otherAway: [number, number] | null = null
    if (Math.hypot(w.start[0] - joint[0], w.start[1] - joint[1]) < JOINT_EPS) {
      const dx = w.end[0] - joint[0]
      const dz = w.end[1] - joint[1]
      const len = Math.hypot(dx, dz)
      if (len > 1e-4) otherAway = [dx / len, dz / len]
    } else if (Math.hypot(w.end[0] - joint[0], w.end[1] - joint[1]) < JOINT_EPS) {
      const dx = w.start[0] - joint[0]
      const dz = w.start[1] - joint[1]
      const len = Math.hypot(dx, dz)
      if (len > 1e-4) otherAway = [dx / len, dz / len]
    }
    if (!otherAway) continue
    const dot = awayDir[0] * otherAway[0] + awayDir[1] * otherAway[1]
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
    if (angle < 0.05 || angle > Math.PI - 0.05) continue // collinear
    const half = angle / 2
    const ext = (thickness / 2) / Math.max(0.1, Math.tan(half))
    if (ext > maxExt) maxExt = ext
  }
  return maxExt
}

export function buildWallGeometry(node: WallNode, otherWalls: WallNode[] = []) {
  const [sx, sz] = node.start
  const [ex, ez] = node.end
  const dx = ex - sx
  const dz = ez - sz
  const len = Math.hypot(dx, dz)
  if (len < 1e-4) return null
  const angle = Math.atan2(dz, dx)
  const dirX = dx / len
  const dirZ = dz / len

  // Extend each end if it joins another wall (mitred for clean corners).
  const startExt = jointExtend(node.start, [dirX, dirZ], node.thickness, otherWalls)
  const endExt = jointExtend(node.end, [-dirX, -dirZ], node.thickness, otherWalls)

  const fullLen = len + startExt + endExt
  // Shift centre so the wall stays anchored at its original start/end while
  // the extensions push past those endpoints into the joint corners.
  const shift = (endExt - startExt) / 2
  const cx = (sx + ex) / 2 + dirX * shift
  const cz = (sz + ez) / 2 + dirZ * shift

  const geom = new THREE.BoxGeometry(fullLen, node.height, node.thickness)
  geom.translate(0, node.height / 2, 0)

  return {
    geom,
    position: new THREE.Vector3(cx, 0, cz),
    rotationY: -angle,
  }
}
