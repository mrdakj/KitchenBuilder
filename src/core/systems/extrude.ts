import { useScene } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import type { AnyNode, CabinetNode, CountertopNode } from '@/core/schema'

const ENGAGE = 0.12

const isAxisAligned = (rotY: number) =>
  Math.abs(((rotY % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)) < 0.05

/**
 * Map a screen-space arrow direction (Right = +X world, Down = +Z world) to
 * the matching local `dim` + `arrowDir` for a rotated cabinet/countertop.
 * Without this, alt+Right on a 90°-rotated cabinet would extrude its local
 * +X face which now points along world -Z — visually "moving back/front"
 * when the user expected "grow toward the right". Picking whichever local
 * axis projects most onto the screen direction makes extrude follow what
 * the user sees on screen regardless of rotation.
 */
export function screenExtrudeToLocal(
  rotY: number,
  screenDx: number,
  screenDz: number,
): { dim: 'width' | 'depth'; arrowDir: 1 | -1 } {
  const cosR = Math.cos(rotY)
  const sinR = Math.sin(rotY)
  // local +X in world XZ = (cosR, -sinR);  local +Z in world XZ = (sinR, cosR)
  const dotX = screenDx * cosR + screenDz * -sinR
  const dotZ = screenDx * sinR + screenDz * cosR
  if (Math.abs(dotX) >= Math.abs(dotZ)) {
    return { dim: 'width', arrowDir: dotX >= 0 ? 1 : -1 }
  }
  return { dim: 'depth', arrowDir: dotZ >= 0 ? 1 : -1 }
}

/**
 * Grow or shrink one face of a cabinet/countertop by ONE snap step. The
 * opposite face stays put; the face in the arrow's direction moves outward
 * (growSign=+1) or inward (growSign=-1). When snap is enabled and the node
 * is axis-aligned, the moving face also flushes to nearby parallel faces
 * within {@link ENGAGE} m. Used by the Alt+Arrow keybinding and the toolbar
 * directional extrude buttons.
 */
export function extrudeFace(
  nodeId: string,
  dim: 'width' | 'depth',
  arrowDir: 1 | -1,
  growSign: 1 | -1,
) {
  const state = useScene.getState()
  const ed = useEditor.getState()
  const n = state.nodes[nodeId]
  if (!n || (n.type !== 'cabinet' && n.type !== 'countertop')) return
  const cur = n as CabinetNode | CountertopNode
  const baseStep = ed.snapStep
  let next = Math.max(0.1, (cur as any)[dim] + baseStep * growSign)
  // Local-axis shift: positive `shift` along the cabinet's LOCAL X (width)
  // or LOCAL Z (depth) — direction it moves to keep the opposite face
  // anchored. We rotate this into world XZ at the end so a cabinet rotated
  // 90° doesn't slide sideways into the wrong axis when extruded.
  let shift = (baseStep * growSign * arrowDir) / 2
  const [px, py, pz] = cur.transform.position
  const rotY = cur.transform.rotationY
  const cosR = Math.cos(rotY)
  const sinR = Math.sin(rotY)
  // local X → world ( cosR, -sinR );  local Z → world ( sinR, cosR )
  let extDx = dim === 'width' ? shift * cosR : shift * sinR
  let extDz = dim === 'width' ? -shift * sinR : shift * cosR

  if (ed.snapEnabled && Math.abs(cur.transform.rotationY) < 0.05) {
    const axis: 0 | 2 = dim === 'width' ? 0 : 2
    const lat: 0 | 2 = axis === 0 ? 2 : 0
    const selfH = cur.type === 'countertop' ? cur.thickness : cur.height
    const sYmin = cur.type === 'countertop' ? py - selfH / 2 : py
    const sYmax = cur.type === 'countertop' ? py + selfH / 2 : py + selfH
    const sLatExt = lat === 0 ? cur.width : cur.depth
    const sLatPos = lat === 0 ? px : pz
    const sLatMin = sLatPos - sLatExt / 2
    const sLatMax = sLatPos + sLatExt / 2
    const anchorFace = (axis === 0 ? px : pz) - arrowDir * (axis === 0 ? cur.width : cur.depth) / 2
    const newCenter = axis === 0 ? px + extDx : pz + extDz
    const newFace = newCenter + arrowDir * next / 2

    let bestSnapped = newFace
    let bestDist = ENGAGE

    for (const other of Object.values(state.nodes)) {
      if (other.id === nodeId || !other.visible) continue
      let oCx = 0, oCy = 0, oCz = 0
      let oW = 0, oH = 0, oD = 0
      let oYmin = 0, oYmax = 0

      if (other.type === 'wall') {
        const dxw = other.end[0] - other.start[0]
        const dzw = other.end[1] - other.start[1]
        if (Math.abs(dxw) > 1e-3 && Math.abs(dzw) > 1e-3) continue
        const len = Math.hypot(dxw, dzw)
        const wallAlongX = Math.abs(dxw) > Math.abs(dzw)
        oW = wallAlongX ? len : other.thickness
        oD = wallAlongX ? other.thickness : len
        oH = other.height
        oCx = (other.start[0] + other.end[0]) / 2
        oCz = (other.start[1] + other.end[1]) / 2
        oCy = oH / 2
        oYmin = 0
        oYmax = oH
      } else if (other.type === 'cabinet' || other.type === 'countertop') {
        if (!isAxisAligned(other.transform.rotationY)) continue
        const swap = Math.round(other.transform.rotationY / (Math.PI / 2)) % 2 !== 0
        oW = swap ? other.depth : other.width
        oD = swap ? other.width : other.depth
        oH = other.type === 'countertop' ? other.thickness : other.height
        oCx = other.transform.position[0]
        oCy = other.transform.position[1]
        oCz = other.transform.position[2]
        oYmin = other.type === 'countertop' ? oCy - oH / 2 : oCy
        oYmax = other.type === 'countertop' ? oCy + oH / 2 : oCy + oH
      } else continue

      if (oYmax < sYmin - 0.01 || oYmin > sYmax + 0.01) continue
      const oLatPos = lat === 0 ? oCx : oCz
      const oLatExt = lat === 0 ? oW : oD
      if (oLatPos + oLatExt / 2 < sLatMin - 0.01 || oLatPos - oLatExt / 2 > sLatMax + 0.01) continue
      const oExtAxis = axis === 0 ? oW : oD
      const oCAxis = axis === 0 ? oCx : oCz
      for (const cand of [oCAxis - oExtAxis / 2, oCAxis + oExtAxis / 2]) {
        const d = Math.abs(cand - newFace)
        if (d < bestDist) {
          bestDist = d
          bestSnapped = cand
        }
      }
    }

    if (bestSnapped !== newFace) {
      const newDim = (bestSnapped - anchorFace) * arrowDir
      if (newDim >= 0.1) {
        next = newDim
        const newShift = (newDim - (cur as any)[dim]) * arrowDir / 2
        extDx = dim === 'width' ? newShift : 0
        extDz = dim === 'depth' ? newShift : 0
      }
    }
  }

  state.updateNode(nodeId, {
    [dim]: next,
    transform: { ...cur.transform, position: [px + extDx, py, pz + extDz] },
  } as Partial<AnyNode> & Record<string, unknown>)
}

/**
 * Scan all 4 horizontal faces of an axis-aligned cabinet/countertop and
 * flush the closest one to a nearby parallel face within {@link ENGAGE} m.
 * The OPPOSITE face stays anchored at its current world position, so only
 * the snap-side dimension changes. Used after gizmo scale commits to give
 * scale the same flush behaviour the Alt+Arrow extrude path has.
 */
export function snapAxisFlush(nodeId: string) {
  const state = useScene.getState()
  const ed = useEditor.getState()
  if (!ed.snapEnabled) return
  const n = state.nodes[nodeId]
  if (!n || (n.type !== 'cabinet' && n.type !== 'countertop')) return
  if (!isAxisAligned(n.transform.rotationY)) return
  const cur = n as CabinetNode | CountertopNode
  const [px, py, pz] = cur.transform.position
  const selfH = cur.type === 'countertop' ? cur.thickness : cur.height
  const sYmin = cur.type === 'countertop' ? py - selfH / 2 : py
  const sYmax = cur.type === 'countertop' ? py + selfH / 2 : py + selfH

  // For each axis, find the best snap candidate considering BOTH faces.
  // Pick the (axis, face-direction) with the smallest snap distance and
  // adjust dim + position so that face flushes while the opposite face
  // stays put.
  type Best = { axis: 0 | 2; arrowDir: 1 | -1; snappedFace: number; dist: number }
  let best: Best | null = null

  for (const axis of [0, 2] as const) {
    const lat: 0 | 2 = axis === 0 ? 2 : 0
    const sLatExt = lat === 0 ? cur.width : cur.depth
    const sLatPos = lat === 0 ? px : pz
    const sLatMin = sLatPos - sLatExt / 2
    const sLatMax = sLatPos + sLatExt / 2
    const ext = axis === 0 ? cur.width : cur.depth
    const center = axis === 0 ? px : pz
    const minFace = center - ext / 2
    const maxFace = center + ext / 2

    for (const other of Object.values(state.nodes)) {
      if (other.id === nodeId || !other.visible) continue
      let oCx = 0, oCy = 0, oCz = 0
      let oW = 0, oH = 0, oD = 0
      let oYmin = 0, oYmax = 0
      if (other.type === 'wall') {
        const dxw = other.end[0] - other.start[0]
        const dzw = other.end[1] - other.start[1]
        if (Math.abs(dxw) > 1e-3 && Math.abs(dzw) > 1e-3) continue
        const len = Math.hypot(dxw, dzw)
        const wallAlongX = Math.abs(dxw) > Math.abs(dzw)
        oW = wallAlongX ? len : other.thickness
        oD = wallAlongX ? other.thickness : len
        oH = other.height
        oCx = (other.start[0] + other.end[0]) / 2
        oCz = (other.start[1] + other.end[1]) / 2
        oCy = oH / 2
        oYmin = 0
        oYmax = oH
      } else if (other.type === 'cabinet' || other.type === 'countertop') {
        if (!isAxisAligned(other.transform.rotationY)) continue
        const swap = Math.round(other.transform.rotationY / (Math.PI / 2)) % 2 !== 0
        oW = swap ? other.depth : other.width
        oD = swap ? other.width : other.depth
        oH = other.type === 'countertop' ? other.thickness : other.height
        oCx = other.transform.position[0]
        oCy = other.transform.position[1]
        oCz = other.transform.position[2]
        oYmin = other.type === 'countertop' ? oCy - oH / 2 : oCy
        oYmax = other.type === 'countertop' ? oCy + oH / 2 : oCy + oH
      } else continue
      if (oYmax < sYmin - 0.01 || oYmin > sYmax + 0.01) continue
      const oLatPos = lat === 0 ? oCx : oCz
      const oLatExt = lat === 0 ? oW : oD
      if (oLatPos + oLatExt / 2 < sLatMin - 0.01 || oLatPos - oLatExt / 2 > sLatMax + 0.01) continue
      const oExt = axis === 0 ? oW : oD
      const oC = axis === 0 ? oCx : oCz
      const oFaceMin = oC - oExt / 2
      const oFaceMax = oC + oExt / 2

      // Try snapping the +face (arrowDir=+1) to oFaceMin or oFaceMax
      for (const cand of [oFaceMin, oFaceMax]) {
        const d = Math.abs(cand - maxFace)
        if (d < ENGAGE && (!best || d < best.dist)) {
          best = { axis, arrowDir: +1, snappedFace: cand, dist: d }
        }
      }
      // Try snapping the -face (arrowDir=-1)
      for (const cand of [oFaceMin, oFaceMax]) {
        const d = Math.abs(cand - minFace)
        if (d < ENGAGE && (!best || d < best.dist)) {
          best = { axis, arrowDir: -1, snappedFace: cand, dist: d }
        }
      }
    }
  }

  if (!best) return
  const dim: 'width' | 'depth' = best.axis === 0 ? 'width' : 'depth'
  const ext = best.axis === 0 ? cur.width : cur.depth
  const center = best.axis === 0 ? px : pz
  const anchorFace = center - best.arrowDir * ext / 2
  const newDim = (best.snappedFace - anchorFace) * best.arrowDir
  if (newDim < 0.1) return
  const newCenter = anchorFace + best.arrowDir * newDim / 2
  const dpx = best.axis === 0 ? newCenter - px : 0
  const dpz = best.axis === 2 ? newCenter - pz : 0
  state.updateNode(nodeId, {
    [dim]: newDim,
    transform: { ...cur.transform, position: [px + dpx, py, pz + dpz] },
  } as Partial<AnyNode> & Record<string, unknown>)
}
