// Blender-style Snapping Logic Rewrite

import * as THREE from 'three'
import type { AnyNode, CustomItemNode, WallNode } from '@/core/schema'
import { useScene } from '@/core/store/use-scene'
import { useEditor, type SnapMode } from '@/core/store/use-editor'
import { nodeBox, overlaps, type Box } from '@/core/systems/collision'
import { getAssetBbox } from '@/core/assets/asset-bbox'

/**
 * Blender-like snapping priorities:
 * 1. Vertex (Corner) - Most precise, locks 3 axes.
 * 2. Edge - Slides along a line.
 * 3. Face - Slides on a plane.
 * 4. Increment - Grid-like steps.
 *
 * "Snap With": Closest (Blender default)
 * We find the point on the dragged object (Source) that is closest to any point on target objects (Target).
 */

const ENGAGE_DIST = 0.12
const RELEASE_DIST = 0.22

export type SnapState = {
  activeSnap: {
    targetPoint: THREE.Vector3
    nodeId: string
    type: SnapMode
  } | null
  // For hysteresis: where was the cursor when we snapped?
  lockAnchor: THREE.Vector3 | null
}

export function createSnapState(): SnapState {
  return { activeSnap: null, lockAnchor: null }
}

export function resetSnapState(s: SnapState) {
  s.activeSnap = null
  s.lockAnchor = null
}

export type Dims = { w: number; h: number; d: number }

export function dimsOf(node: AnyNode): Dims | null {
  if (node.type === 'cabinet') return { w: node.width, h: node.height, d: node.depth }
  if (node.type === 'countertop') return { w: node.width, h: node.thickness, d: node.depth }
  if (node.type === 'wall') {
    const w = node as WallNode
    const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
    return { w: len, h: w.height, d: w.thickness }
  }
  if (node.type === 'custom-item') {
    const c = node as CustomItemNode
    const sx = c.scale?.[0] ?? 1
    const sy = c.scale?.[1] ?? 1
    const sz = c.scale?.[2] ?? 1
    // Prefer the actual normalized bbox recorded when the GLTF loaded — that
    // way snap operates on the real footprint (e.g. a wide, shallow sink)
    // rather than a 0.5 cube approximation, which previously made snap
    // engage at the wrong corner positions for non-cube assets.
    const bb = getAssetBbox(c.assetId)
    if (bb) return { w: bb[0] * sx, h: bb[1] * sy, d: bb[2] * sz }
    return { w: 0.5 * sx, h: 0.5 * sy, d: 0.5 * sz }
  }
  return null
}

function yOffsets(node: AnyNode, dims: Dims): { lo: number; hi: number } {
  if (node.type === 'countertop') return { lo: -dims.h / 2, hi: dims.h / 2 }
  return { lo: 0, hi: dims.h }
}

type Frame = {
  center: THREE.Vector3
  u: THREE.Vector3
  v: THREE.Vector3
  w: THREE.Vector3
  halfU: number
  halfV: number
  halfW: number
}

function getFrameFor(node: AnyNode, posOverride?: THREE.Vector3, rotOverride?: number): Frame | null {
  if (node.type === 'wall') {
    const wall = node as WallNode
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) return null

    const u = new THREE.Vector3(dx / len, 0, dz / len)
    const w = new THREE.Vector3(u.z, 0, -u.x) // Fix: corrected normal direction consistency
    const v = new THREE.Vector3(0, 1, 0)

    // posOverride translates the wall's center while preserving direction
    // and length — used during gizmo translate so snap candidates evaluate
    // at the cursor position before commit. Y is always wall.height/2 so
    // the wall's vertical AABB matches floor-standing objects.
    const cx = posOverride?.x ?? (wall.start[0] + wall.end[0]) / 2
    const cz = posOverride?.z ?? (wall.start[1] + wall.end[1]) / 2

    return {
      center: new THREE.Vector3(cx, wall.height / 2, cz),
      u, v, w,
      halfU: len / 2,
      halfV: wall.height / 2,
      halfW: wall.thickness / 2,
    }
  }

  const dims = dimsOf(node)
  if (!dims) return null
  const yOff = yOffsets(node, dims)

  const px = posOverride?.x ?? (node as any).transform?.position?.[0] ?? 0
  const py = posOverride?.y ?? (node as any).transform?.position?.[1] ?? 0
  const pz = posOverride?.z ?? (node as any).transform?.position?.[2] ?? 0
  const rotY = rotOverride ?? (node as any).transform?.rotationY ?? 0

  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)

  return {
    center: new THREE.Vector3(px, py + (yOff.lo + yOff.hi) / 2, pz),
    u: new THREE.Vector3(cos, 0, -sin),
    v: new THREE.Vector3(0, 1, 0),
    w: new THREE.Vector3(sin, 0, cos),
    halfU: dims.w / 2,
    halfV: (yOff.hi - yOff.lo) / 2,
    halfW: dims.d / 2,
  }
}

function getFeatures(f: Frame) {
  const corners: THREE.Vector3[] = []
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      for (const sw of [-1, 1]) {
        corners.push(new THREE.Vector3(
          f.center.x + f.halfU * su * f.u.x + f.halfV * sv * f.v.x + f.halfW * sw * f.w.x,
          f.center.y + f.halfU * su * f.u.y + f.halfV * sv * f.v.y + f.halfW * sw * f.w.y,
          f.center.z + f.halfU * su * f.u.z + f.halfV * sv * f.v.z + f.halfW * sw * f.w.z,
        ))
      }
    }
  }

  const edges: { start: THREE.Vector3; end: THREE.Vector3; dir: THREE.Vector3 }[] = []
  // Edges along U
  for (const sv of [-1, 1]) {
    for (const sw of [-1, 1]) {
      const c = f.center.clone().addScaledVector(f.v, sv * f.halfV).addScaledVector(f.w, sw * f.halfW)
      edges.push({
        start: c.clone().addScaledVector(f.u, -f.halfU),
        end: c.clone().addScaledVector(f.u, f.halfU),
        dir: f.u
      })
    }
  }
  // Edges along V
  for (const su of [-1, 1]) {
    for (const sw of [-1, 1]) {
      const c = f.center.clone().addScaledVector(f.u, su * f.halfU).addScaledVector(f.w, sw * f.halfW)
      edges.push({
        start: c.clone().addScaledVector(f.v, -f.halfV),
        end: c.clone().addScaledVector(f.v, f.halfV),
        dir: f.v
      })
    }
  }
  // Edges along W
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      const c = f.center.clone().addScaledVector(f.u, su * f.halfU).addScaledVector(f.v, sv * f.halfV)
      edges.push({
        start: c.clone().addScaledVector(f.w, -f.halfW),
        end: c.clone().addScaledVector(f.w, f.halfW),
        dir: f.w
      })
    }
  }

  const faces: { center: THREE.Vector3; normal: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; hu: number; hv: number }[] = [
    { center: f.center.clone().addScaledVector(f.u, f.halfU), normal: f.u, u: f.v, v: f.w, hu: f.halfV, hv: f.halfW },
    { center: f.center.clone().addScaledVector(f.u, -f.halfU), normal: f.u.clone().negate(), u: f.v, v: f.w, hu: f.halfV, hv: f.halfW },
    { center: f.center.clone().addScaledVector(f.v, f.halfV), normal: f.v, u: f.u, v: f.w, hu: f.halfU, hv: f.halfW },
    { center: f.center.clone().addScaledVector(f.v, -f.halfV), normal: f.v.clone().negate(), u: f.u, v: f.w, hu: f.halfU, hv: f.halfW },
    { center: f.center.clone().addScaledVector(f.w, f.halfW), normal: f.w, u: f.u, v: f.v, hu: f.halfU, hv: f.halfV },
    { center: f.center.clone().addScaledVector(f.w, -f.halfW), normal: f.w.clone().negate(), u: f.u, v: f.v, hu: f.halfU, hv: f.halfV },
  ]

  return { corners, edges, faces }
}

function projectOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
  const ab = b.clone().sub(a)
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()))
  return a.clone().addScaledVector(ab, t)
}

// Returns the perpendicular projection of `p` onto the face plane, OR null
// if that projection lies outside the face's tangent bounds. Returning null
// (instead of clamping to the edge) is what stops the bouncing as a cabinet
// enters another object's face: clamped targets used to drag the cabinet
// sideways toward whichever edge the out-of-bounds corner was nearest, and
// that edge changed every frame as more corners crossed in.
function projectOnFace(
  p: THREE.Vector3,
  face: ReturnType<typeof getFeatures>['faces'][0],
): THREE.Vector3 | null {
  const d = p.clone().sub(face.center)
  const dist = d.dot(face.normal)
  const proj = p.clone().addScaledVector(face.normal, -dist)
  const rel = proj.clone().sub(face.center)
  const uDist = rel.dot(face.u)
  const vDist = rel.dot(face.v)
  const tol = 0.02
  if (Math.abs(uDist) > face.hu + tol) return null
  if (Math.abs(vDist) > face.hv + tol) return null
  return proj
}

// "Stack" relationships: A is meant to physically sit ON TOP of B. For these
// pairs we restrict snap to the top-of-B host face only (no side-to-side
// alignment) and require that the snap position actually places A above B.
// Cabinet→cabinet and similar non-stacking pairs go through the default
// (looser) snap rules so side-by-side cabinet placement still works.
function isStackRelation(a: AnyNode, b: AnyNode): boolean {
  if (a.type === 'countertop' && b.type === 'cabinet') return true
  // Items (sinks, mixers, appliances) only sit on countertops, never directly
  // on a cabinet — placing a sink on a bare cabinet doesn't make sense in a
  // kitchen layout. Cabinets get countertops first; items go on the countertop.
  if (a.type === 'custom-item' && b.type === 'countertop') return true
  return false
}

// =================================================================
// Kitchen-aware snap.
//
// Each pair of object types has explicit, real-life snap rules:
//
//   cabinet/appliance ↔ cabinet/appliance  → side-to-side & back-to-back
//                                            (lateral overlap required;
//                                            Y stays at floor)
//   cabinet/appliance ↔ wall               → side flush against wall
//   countertop       ↔ cabinet             → countertop bottom rests on
//                                            cabinet top, slides in X/Z
//   countertop       ↔ wall                → side flush against wall
//   item             ↔ countertop          → item bottom sits on
//                                            countertop top, slides X/Z;
//                                            won't sink into the slab
//   anything else                           → no snap (sink doesn't grab
//                                            the fridge, cabinet doesn't
//                                            stack on countertop, …)
//
// Hysteresis is score-based: once a snap engages on target T, the snap
// stays on T as long as T's candidate score (= perpendicular distance
// to the snap surface) stays below RELEASE_DIST. Sliding along a
// surface keeps the lock indefinitely; small cursor jitter can't make
// the snap jump to a competing target. ONE 3D delta per frame, no
// per-axis mixing across different sources.
// =================================================================

type KitchenCat = 'cabinet' | 'appliance' | 'countertop' | 'item' | 'wall' | 'other'

function categorize(node: AnyNode): KitchenCat {
  if (node.type === 'cabinet') return 'cabinet'
  if (node.type === 'countertop') return 'countertop'
  if (node.type === 'wall') return 'wall'
  if (node.type === 'custom-item') {
    const c = node as CustomItemNode
    // Floor-standing appliances behave like cabinets (side/back snap).
    if (c.assetId === 'predef:fridge' || c.assetId === 'predef:oven') return 'appliance'
    // Sink, mixer, induction hob, and other countertop items.
    return 'item'
  }
  return 'other'
}

type AABB = { min: [number, number, number]; max: [number, number, number] }

// World-space AABB of an oriented frame.
function frameAabb(f: Frame): AABB {
  const hx = Math.abs(f.u.x) * f.halfU + Math.abs(f.v.x) * f.halfV + Math.abs(f.w.x) * f.halfW
  const hy = Math.abs(f.u.y) * f.halfU + Math.abs(f.v.y) * f.halfV + Math.abs(f.w.y) * f.halfW
  const hz = Math.abs(f.u.z) * f.halfU + Math.abs(f.v.z) * f.halfV + Math.abs(f.w.z) * f.halfW
  return {
    min: [f.center.x - hx, f.center.y - hy, f.center.z - hz],
    max: [f.center.x + hx, f.center.y + hy, f.center.z + hz],
  }
}

function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin <= bMax + 0.01 && aMax + 0.01 >= bMin
}

type Cand = {
  delta: THREE.Vector3
  score: number
  targetId: string
}

// Generous threshold for SECONDARY edge alignment — fires when the primary
// snap is already engaged and a matching edge lies within 35 cm. Larger
// than ENGAGE_DIST because once the fridge is touching the cabinet's side,
// we want the back-to-back alignment to "find" it even when the fridge
// was dragged in from a wider Z offset. Still small enough that wildly
// misaligned objects (>35 cm offset on the secondary axis) don't get
// auto-aligned against the user's intent.
const ALIGN_DIST = 0.35

// Pick the smallest-magnitude alignment delta along an axis: any of the four
// edge pairings (min↔min, max↔max, min↔max, max↔min) within ALIGN_DIST
// counts. Returns 0 when none qualifies — the snap leaves the axis alone.
function bestEdgeAlign(sMin: number, sMax: number, oMin: number, oMax: number): number {
  const dMinMin = oMin - sMin
  const dMaxMax = oMax - sMax
  const dMinMax = oMax - sMin
  const dMaxMin = oMin - sMax
  const candidates = [dMinMin, dMaxMax, dMinMax, dMaxMin]
  let best = 0
  let bestAbs = ALIGN_DIST
  for (const c of candidates) {
    const a = Math.abs(c)
    if (a < bestAbs) {
      bestAbs = a
      best = c
    }
  }
  return best
}

// Side adjacency along world axis (0=X, 2=Z). sign=+1 means "self's +axis
// face touches other's -axis face"; -1 the reverse. The PRIMARY axis is
// the one where the faces touch; we ALSO try to align the OTHER lateral
// axis (back-to-back / front-to-front) so the snap pulls both coordinates
// together — placing two cabinets next to each other lines up their
// backs in the same step.
function pushSide(
  axis: 0 | 2,
  s: AABB,
  o: AABB,
  sign: 1 | -1,
  otherId: string,
  out: Cand[],
) {
  const sFace = sign === 1 ? s.max[axis] : s.min[axis]
  const oFace = sign === 1 ? o.min[axis] : o.max[axis]
  const d = oFace - sFace
  if (Math.abs(d) > ENGAGE_DIST) return
  if (!rangesOverlap(s.min[1], s.max[1], o.min[1], o.max[1])) return
  const lat = axis === 0 ? 2 : 0
  if (!rangesOverlap(s.min[lat], s.max[lat], o.min[lat], o.max[lat])) return
  // Lateral edge alignment (back-to-back / front-to-front).
  const latDelta = bestEdgeAlign(s.min[lat], s.max[lat], o.min[lat], o.max[lat])
  // Y edge alignment: both pieces standing on the floor get their bottoms
  // (or tops) lined up — addresses the "fridge snapped on side and back but
  // floats slightly above the cabinet's floor line" case.
  const yDelta = bestEdgeAlign(s.min[1], s.max[1], o.min[1], o.max[1])
  const delta = new THREE.Vector3(0, yDelta, 0)
  if (axis === 0) {
    delta.x = d
    delta.z = latDelta
  } else {
    delta.z = d
    delta.x = latDelta
  }
  out.push({ delta, score: Math.abs(d), targetId: otherId })
}

// Stack-on-top: self bottom → other top. Y delta locks. When `lateralAlign`
// is true (countertop → cabinet) the lateral edges also pull together, so
// a countertop snaps cleanly to a cabinet's edge. When false (item →
// countertop, e.g. sink/mixer/fridge) the item slides freely in X/Z so
// the user can position it anywhere on the surface — only Y is locked.
function pushStack(
  s: AABB,
  o: AABB,
  otherId: string,
  out: Cand[],
  lateralAlign: boolean,
) {
  const dy = o.max[1] - s.min[1]
  if (Math.abs(dy) > ENGAGE_DIST) return
  if (!rangesOverlap(s.min[0], s.max[0], o.min[0], o.max[0])) return
  if (!rangesOverlap(s.min[2], s.max[2], o.min[2], o.max[2])) return
  const dxAlign = lateralAlign ? bestEdgeAlign(s.min[0], s.max[0], o.min[0], o.max[0]) : 0
  const dzAlign = lateralAlign ? bestEdgeAlign(s.min[2], s.max[2], o.min[2], o.max[2]) : 0
  out.push({
    delta: new THREE.Vector3(dxAlign, dy, dzAlign),
    score: Math.abs(dy),
    targetId: otherId,
  })
}

function kitchenCandidates(
  selfNode: AnyNode,
  otherNode: AnyNode,
  sA: AABB,
  oA: AABB,
): Cand[] {
  const sCat = categorize(selfNode)
  const oCat = categorize(otherNode)
  const out: Cand[] = []
  const id = otherNode.id
  const cabinetLike = (c: KitchenCat) => c === 'cabinet' || c === 'appliance'

  // Cabinet/appliance ↔ cabinet/appliance: side-to-side / back-to-back.
  if (cabinetLike(sCat) && cabinetLike(oCat)) {
    pushSide(0, sA, oA, +1, id, out)
    pushSide(0, sA, oA, -1, id, out)
    pushSide(2, sA, oA, +1, id, out)
    pushSide(2, sA, oA, -1, id, out)
  }

  // Cabinet/appliance/countertop ↔ wall: side flush.
  if ((cabinetLike(sCat) || sCat === 'countertop') && oCat === 'wall') {
    pushSide(0, sA, oA, +1, id, out)
    pushSide(0, sA, oA, -1, id, out)
    pushSide(2, sA, oA, +1, id, out)
    pushSide(2, sA, oA, -1, id, out)
  }

  // Wall as self ↔ anything floor-standing: side flush so a translated wall
  // sticks to nearby cabinets, countertops, appliances, and other walls.
  if (sCat === 'wall' && (cabinetLike(oCat) || oCat === 'countertop' || oCat === 'wall')) {
    pushSide(0, sA, oA, +1, id, out)
    pushSide(0, sA, oA, -1, id, out)
    pushSide(2, sA, oA, +1, id, out)
    pushSide(2, sA, oA, -1, id, out)
  }

  // Countertop sits on cabinet — both Y AND lateral edges pull together.
  if (sCat === 'countertop' && oCat === 'cabinet') {
    pushStack(sA, oA, id, out, true)
  }
  // Item (sink/mixer) sits on countertop — only Y locks. X/Z slide free
  // so the user can place freely in the middle of the slab.
  if (sCat === 'item' && oCat === 'countertop') {
    pushStack(sA, oA, id, out, false)
  }

  return out
}

// Aggregate stack snap when self spans multiple cabinets/countertops:
// the countertop should sit on every cabinet underneath it, with X/Z edges
// pulling to the OUTERMOST matching edges across all of them. Without this,
// a countertop bridging cabinets A and B can only snap to one cabinet's
// edge at a time, so the second cabinet's edge alignment is ignored as
// the user drags past it.
function aggregatedStackCand(
  selfA: AABB,
  supports: AABB[],
  syntheticId: string,
): Cand | null {
  if (supports.length === 0) return null
  // Y delta — shortest distance from any support's top to self's bottom.
  let bestDy = 0
  let bestDyAbs = ENGAGE_DIST
  for (const o of supports) {
    const dy = o.max[1] - selfA.min[1]
    const a = Math.abs(dy)
    if (a < bestDyAbs) { bestDyAbs = a; bestDy = dy }
  }
  if (bestDyAbs >= ENGAGE_DIST) return null

  // X / Z edge alignment: scan EVERY support's edges; pick the smallest
  // in-range alignment across all of them, on each axis independently.
  let bestDx = 0, bestDxAbs = ALIGN_DIST
  let bestDz = 0, bestDzAbs = ALIGN_DIST
  for (const o of supports) {
    const xCands = [
      o.min[0] - selfA.min[0],
      o.max[0] - selfA.max[0],
      o.max[0] - selfA.min[0],
      o.min[0] - selfA.max[0],
    ]
    for (const c of xCands) {
      const a = Math.abs(c)
      if (a < bestDxAbs) { bestDxAbs = a; bestDx = c }
    }
    const zCands = [
      o.min[2] - selfA.min[2],
      o.max[2] - selfA.max[2],
      o.max[2] - selfA.min[2],
      o.min[2] - selfA.max[2],
    ]
    for (const c of zCands) {
      const a = Math.abs(c)
      if (a < bestDzAbs) { bestDzAbs = a; bestDz = c }
    }
  }
  return {
    delta: new THREE.Vector3(bestDx, bestDy, bestDz),
    score: bestDyAbs,
    targetId: syntheticId,
  }
}

export function applyStickySnap(
  selfNode: AnyNode,
  _dims: Dims,
  pos: THREE.Vector3,
  state: SnapState,
  _prevPos: THREE.Vector3 | null,
  _unused1: any,
  _unused2: any,
  suppress: { x: boolean; y: boolean; z: boolean },
  snapMode: SnapMode = 'auto'
): { snappedX: boolean; snappedY: boolean; snappedZ: boolean } {
  void snapMode // mode buttons are advisory only — kitchen rules apply universally
  const rotY = (selfNode as any).transform?.rotationY ?? 0
  const selfFrame = getFrameFor(selfNode, pos, rotY)
  if (!selfFrame) return { snappedX: false, snappedY: false, snappedZ: false }
  const selfAabb = frameAabb(selfFrame)
  const nodes = useScene.getState().nodes

  // Collect every candidate from every other node.
  const all: Cand[] = []
  // Track cabinet AABBs that the countertop overlaps in XZ — used to build
  // a single aggregated stack candidate so a countertop bridging multiple
  // cabinets snaps to ALL their edges, not just the closest one.
  const countertopSupports: AABB[] = []
  const itemSupports: AABB[] = []
  for (const other of Object.values(nodes)) {
    if (other.id === selfNode.id || !other.visible) continue
    const otherFrame = getFrameFor(other)
    if (!otherFrame) continue
    const otherAabb = frameAabb(otherFrame)
    const cands = kitchenCandidates(selfNode, other, selfAabb, otherAabb)
    for (const c of cands) all.push(c)
    // Collect potential supports for the aggregated multi-stack pass below.
    if (selfNode.type === 'countertop' && other.type === 'cabinet') {
      if (rangesOverlap(selfAabb.min[0], selfAabb.max[0], otherAabb.min[0], otherAabb.max[0]) &&
          rangesOverlap(selfAabb.min[2], selfAabb.max[2], otherAabb.min[2], otherAabb.max[2])) {
        countertopSupports.push(otherAabb)
      }
    } else if (selfNode.type === 'custom-item' && other.type === 'countertop') {
      if (rangesOverlap(selfAabb.min[0], selfAabb.max[0], otherAabb.min[0], otherAabb.max[0]) &&
          rangesOverlap(selfAabb.min[2], selfAabb.max[2], otherAabb.min[2], otherAabb.max[2])) {
        itemSupports.push(otherAabb)
      }
    }
  }

  // If countertop overlaps 2+ cabinets, replace per-cabinet stack candidates
  // with a single aggregated candidate that pulls edges from ALL cabinets.
  if (countertopSupports.length >= 2) {
    const aggregated = aggregatedStackCand(selfAabb, countertopSupports, '__countertop_multi__')
    if (aggregated) all.push(aggregated)
  }
  // Items can also overlap multiple countertops (rare, but harmless to handle).
  if (itemSupports.length >= 2) {
    const aggregated = aggregatedStackCand(selfAabb, itemSupports, '__item_multi__')
    if (aggregated) {
      // Items still slide free in X/Z — drop lateral edge alignment.
      aggregated.delta.x = 0
      aggregated.delta.z = 0
      all.push(aggregated)
    }
  }

  if (all.length === 0) {
    state.activeSnap = null
    state.lockAnchor = null
    return { snappedX: false, snappedY: false, snappedZ: false }
  }

  // Hysteresis: if a snap was previously held, prefer the same target as
  // long as its candidate is still within RELEASE_DIST. That keeps the
  // snap from flickering between competing targets while the user drags
  // along a surface.
  let chosen: Cand | null = null
  if (state.activeSnap) {
    const heldId = state.activeSnap.nodeId
    const held = all.find((c) => c.targetId === heldId)
    if (held && held.score < RELEASE_DIST) chosen = held
  }
  if (!chosen) {
    let best = all[0]
    for (const c of all) if (c.score < best.score) best = c
    if (best.score < ENGAGE_DIST) chosen = best
  }

  if (!chosen) {
    state.activeSnap = null
    state.lockAnchor = null
    return { snappedX: false, snappedY: false, snappedZ: false }
  }

  state.activeSnap = {
    targetPoint: pos.clone().add(chosen.delta),
    nodeId: chosen.targetId,
    type: snapMode,
  }
  state.lockAnchor = pos.clone()

  if (!suppress.x) pos.x += chosen.delta.x
  if (!suppress.y) pos.y += chosen.delta.y
  if (!suppress.z) pos.z += chosen.delta.z
  return {
    snappedX: !suppress.x && Math.abs(chosen.delta.x) > 1e-6,
    snappedY: !suppress.y && Math.abs(chosen.delta.y) > 1e-6,
    snappedZ: !suppress.z && Math.abs(chosen.delta.z) > 1e-6,
  }
}


export function findPointSnap(
  self: AnyNode,
  pos: THREE.Vector3,
  rotY: number,
  threshold = ENGAGE_DIST
): THREE.Vector3 | null {
  const selfFrame = getFrameFor(self, pos, rotY)
  if (!selfFrame) return null
  const selfFeats = getFeatures(selfFrame)
  const nodes = useScene.getState().nodes
  const snapMode = useEditor.getState().snapMode

  let bestDist = threshold
  let bestTarget: THREE.Vector3 | null = null

  const check = (source: THREE.Vector3, target: THREE.Vector3) => {
    const d = source.distanceTo(target)
    if (d < bestDist) {
      bestDist = d
      bestTarget = target.clone()
    }
  }

  for (const other of Object.values(nodes)) {
    if (other.id === self.id || !other.visible) continue
    const otherFrame = getFrameFor(other)
    if (!otherFrame) continue
    const otherFeats = getFeatures(otherFrame)

    if (snapMode === 'auto' || snapMode === 'corner') {
      for (const sc of selfFeats.corners) {
        for (const oc of otherFeats.corners) check(sc, oc)
      }
    }
    if (snapMode === 'auto' || snapMode === 'edge') {
      for (const sc of selfFeats.corners) {
        for (const oe of otherFeats.edges) check(sc, projectOnSegment(sc, oe.start, oe.end))
      }
    }
    if (snapMode === 'auto' || snapMode === 'face') {
      for (const sc of selfFeats.corners) {
        for (const ofc of otherFeats.faces) {
          if (ofc.normal.y <= -0.5) continue
          const t = projectOnFace(sc, ofc)
          if (t) check(sc, t)
        }
      }
    }
  }

  if (bestTarget) {
    let bestSource: THREE.Vector3 | null = null
    let d2 = threshold
    for (const sc of selfFeats.corners) {
      const d = sc.distanceTo(bestTarget!)
      if (d < d2 + 0.001) {
        d2 = d
        bestSource = sc
      }
    }
    if (bestSource) {
      const bt = bestTarget as THREE.Vector3
      return pos.clone().add(bt.clone().sub(bestSource))
    }
  }

  return null
}

export function findSnapHit() { return null }
export function findCornerSnap() { return null }
export function findFaceSnap() { return null }

// =================================================================
// Wall-specific translate snap. The general kitchen-aware sticky snap
// was firing for walls in code review but in practice users couldn't
// reliably get walls to flush against neighbours — both perpendicular
// walls (corner joins) and cabinet backs. This dedicated path uses a
// generous 30 cm engage distance and a relaxed lateral-overlap test
// so a wall being dragged toward a neighbour latches onto the
// nearest face well before the cursor reaches it. AABB-based and
// axis-aligned, so it's much simpler than the candidate scoring
// above and easy to reason about.
// =================================================================
const WALL_ENGAGE = 0.30 // 30 cm — generous on purpose for coarse wall dragging
const WALL_LATERAL_TOLERANCE = 0.6 // walls can latch when their lateral footprints are within 60 cm of overlapping

type SimpleAabb = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

function aabbOf(node: AnyNode): SimpleAabb | null {
  if (node.type === 'wall') {
    const w = node as WallNode
    const dx = w.end[0] - w.start[0]
    const dz = w.end[1] - w.start[1]
    if (Math.abs(dx) > 1e-3 && Math.abs(dz) > 1e-3) {
      // Diagonal wall — its world AABB doesn't reflect a flat face, so
      // skip it as a snap target rather than producing misleading flushes.
      return null
    }
    const cx = (w.start[0] + w.end[0]) / 2
    const cz = (w.start[1] + w.end[1]) / 2
    const len = Math.hypot(dx, dz)
    const wallAlongX = Math.abs(dx) >= Math.abs(dz)
    const halfX = wallAlongX ? len / 2 : w.thickness / 2
    const halfZ = wallAlongX ? w.thickness / 2 : len / 2
    return {
      minX: cx - halfX, maxX: cx + halfX,
      minY: 0, maxY: w.height,
      minZ: cz - halfZ, maxZ: cz + halfZ,
    }
  }
  if (node.type === 'cabinet' || node.type === 'countertop') {
    // Only handle axis-aligned for the wall-snap pass — diagonal cabinets
    // would need an oriented bbox. Walls almost always sit along world axes
    // so their snap targets do too in practice.
    const rot = node.transform.rotationY
    const k = Math.round(rot / (Math.PI / 2))
    if (Math.abs(rot - k * (Math.PI / 2)) > 0.05) return null
    const swap = ((k % 2) + 2) % 2 === 1
    const w = swap ? node.depth : node.width
    const d = swap ? node.width : node.depth
    const [px, py, pz] = node.transform.position
    const yMin = node.type === 'countertop' ? py - node.thickness / 2 : py
    const yMax = node.type === 'countertop' ? py + node.thickness / 2 : py + node.height
    return {
      minX: px - w / 2, maxX: px + w / 2,
      minY: yMin, maxY: yMax,
      minZ: pz - d / 2, maxZ: pz + d / 2,
    }
  }
  return null
}

function wallSelfAabb(wall: WallNode, probe: THREE.Vector3): SimpleAabb | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  if (Math.abs(dx) > 1e-3 && Math.abs(dz) > 1e-3) return null
  const len = Math.hypot(dx, dz)
  const wallAlongX = Math.abs(dx) >= Math.abs(dz)
  const halfX = wallAlongX ? len / 2 : wall.thickness / 2
  const halfZ = wallAlongX ? wall.thickness / 2 : len / 2
  return {
    minX: probe.x - halfX, maxX: probe.x + halfX,
    minY: 0, maxY: wall.height,
    minZ: probe.z - halfZ, maxZ: probe.z + halfZ,
  }
}

/**
 * Apply axis-aligned face-flush snap for a wall being translated. Returns
 * (dx, dz) to add to the probe so the wall lands flush against the nearest
 * neighbour. Either component is 0 if no snap engaged on that axis.
 *
 * For each OTHER wall/cabinet/countertop in the scene, considers all 8
 * face pairings (4 along X, 4 along Z). A pairing only counts when the
 * two AABBs overlap in Y (so floor-only objects don't snap to wall-mounted
 * cabinets sitting at 1.4 m) and their LATERAL extent is at least roughly
 * adjacent — within {@link WALL_LATERAL_TOLERANCE} of overlap, so walls
 * can latch onto cabinet backs even when only lightly overlapping.
 */
export function snapWallTranslate(
  wall: WallNode,
  probe: THREE.Vector3,
  suppress: { x: boolean; z: boolean } = { x: false, z: false },
): { dx: number; dz: number } {
  const sA = wallSelfAabb(wall, probe)
  if (!sA) return { dx: 0, dz: 0 }
  const nodes = useScene.getState().nodes
  let bestDx = 0, bestDxAbs = WALL_ENGAGE
  let bestDz = 0, bestDzAbs = WALL_ENGAGE

  const yOverlaps = (oA: SimpleAabb) => oA.maxY >= sA.minY - 0.01 && oA.minY <= sA.maxY + 0.01
  const lateralOverlaps = (sLo: number, sHi: number, oLo: number, oHi: number) =>
    sLo <= oHi + WALL_LATERAL_TOLERANCE && sHi + WALL_LATERAL_TOLERANCE >= oLo

  for (const other of Object.values(nodes)) {
    if (other.id === wall.id || !other.visible) continue
    if (other.type !== 'wall' && other.type !== 'cabinet' && other.type !== 'countertop') continue
    const oA = aabbOf(other as AnyNode)
    if (!oA) continue
    if (!yOverlaps(oA)) continue

    // X axis flush: align an X face of self with an X face of other.
    if (!suppress.x && lateralOverlaps(sA.minZ, sA.maxZ, oA.minZ, oA.maxZ)) {
      const cands = [
        oA.minX - sA.minX, // self min ↔ other min
        oA.maxX - sA.maxX, // self max ↔ other max
        oA.minX - sA.maxX, // self max ↔ other min (touch from left)
        oA.maxX - sA.minX, // self min ↔ other max (touch from right)
      ]
      for (const c of cands) {
        const a = Math.abs(c)
        if (a < bestDxAbs) { bestDxAbs = a; bestDx = c }
      }
    }

    // Z axis flush.
    if (!suppress.z && lateralOverlaps(sA.minX, sA.maxX, oA.minX, oA.maxX)) {
      const cands = [
        oA.minZ - sA.minZ,
        oA.maxZ - sA.maxZ,
        oA.minZ - sA.maxZ,
        oA.maxZ - sA.minZ,
      ]
      for (const c of cands) {
        const a = Math.abs(c)
        if (a < bestDzAbs) { bestDzAbs = a; bestDz = c }
      }
    }
  }

  return { dx: bestDx, dz: bestDz }
}
