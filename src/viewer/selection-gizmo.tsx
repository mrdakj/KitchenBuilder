'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import type { Object3D } from 'three'
import { useScene, getDescendantIds } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import { sceneRegistry } from '@/core/registry/scene-registry'
import type { AnyNode, CabinetNode, CountertopNode, CustomItemNode, EmptyNode, LightNode, WallNode } from '@/core/schema'
import { applyStickySnap, createSnapState, dimsOf, resetSnapState, snapWallTranslate } from '@/core/systems/object-snap'
import { snapAxisFlush } from '@/core/systems/extrude'
import { gizmoState } from '@/core/systems/gizmo-state'
import { snap as snapStep } from '@/core/utils/math'
import { findWallFacingRotation, shouldAutoRotateToWall } from '@/core/systems/auto-rotate'

const TRANSFORMABLE = new Set(['cabinet', 'countertop', 'custom-item', 'wall', 'light', 'empty'])

type PatchableNode = CabinetNode | CountertopNode | CustomItemNode | WallNode | LightNode | EmptyNode

function patchFromObject(node: AnyNode, target: Object3D): Partial<PatchableNode> | null {
  if (node.type === 'cabinet' || node.type === 'countertop' || node.type === 'empty') {
    return {
      transform: {
        position: [target.position.x, target.position.y, target.position.z],
        rotationY: target.rotation.y,
      },
    }
  }
  if (node.type === 'custom-item') {
    return {
      transform: {
        position: [target.position.x, target.position.y, target.position.z],
        rotationY: target.rotation.y,
      },
      scale: [target.scale.x, target.scale.y, target.scale.z],
    }
  }
  if (node.type === 'light') {
    const wp = target.getWorldPosition(target.position.clone())
    return { position: [wp.x, wp.y, wp.z] }
  }
  if (node.type === 'wall') {
    const wall = node as WallNode
    const [sx, sz] = wall.start
    const [ex, ez] = wall.end
    const origLen = Math.hypot(ex - sx, ez - sz)
    const rot = target.rotation.y
    const dirX = Math.cos(rot)
    const dirZ = -Math.sin(rot)
    const cx = target.position.x
    const cz = target.position.z
    const half = origLen / 2
    return {
      start: [cx - dirX * half, cz - dirZ * half],
      end: [cx + dirX * half, cz + dirZ * half],
    }
  }
  return null
}

// Move a node by (dx, dy, dz) without changing its rotation/scale/etc.
function shiftNodePatch(node: AnyNode, dx: number, dy: number, dz: number): Partial<PatchableNode> | null {
  if (node.type === 'cabinet' || node.type === 'countertop' || node.type === 'custom-item' || node.type === 'empty') {
    const [x, y, z] = node.transform.position
    return { transform: { ...node.transform, position: [x + dx, y + dy, z + dz] } } as any
  }
  if (node.type === 'light') {
    const [x, y, z] = node.position
    return { position: [x + dx, y + dy, z + dz] } as any
  }
  if (node.type === 'wall') {
    return {
      start: [node.start[0] + dx, node.start[1] + dz],
      end: [node.end[0] + dx, node.end[1] + dz],
    } as any
  }
  return null
}

// Compute the world-space "anchor" position for a node — used for centroid.
function nodeAnchor(node: AnyNode): [number, number, number] | null {
  if (node.type === 'cabinet' || node.type === 'countertop' || node.type === 'custom-item' || node.type === 'empty') {
    return node.transform.position as [number, number, number]
  }
  if (node.type === 'light') return node.position as [number, number, number]
  if (node.type === 'wall') {
    const cx = (node.start[0] + node.end[0]) / 2
    const cz = (node.start[1] + node.end[1]) / 2
    return [cx, 0, cz]
  }
  return null
}

function partialized() {
  const s = useScene.getState()
  const nodes: Record<string, AnyNode> = {}
  for (const [k, v] of Object.entries(s.nodes)) nodes[k] = JSON.parse(JSON.stringify(v))
  return { nodes, rootNodeIds: [...s.rootNodeIds] }
}

export function SelectionGizmo() {
  const transformMode = useEditor((s) => s.transformMode)
  const snapEnabled = useEditor((s) => s.snapEnabled)
  const snapAngleDeg = useEditor((s) => s.snapAngleDeg)
  const [target, setTarget] = useState<Object3D | null>(null)
  const tcRef = useRef<any>(null)
  const controls = useThree((s) => s.controls) as any

  const preDragRef = useRef<any>(null)
  const dragIdRef = useRef<string | null>(null)
  const snapStateRef = useRef(createSnapState())
  const prevPosRef = useRef<THREE.Vector3 | null>(null)

  // Multi-selection state — when more than one node is selected and mode is
  // 'translate', the gizmo attaches to a virtual pivot (an empty Group at
  // the selection's centroid). Each gizmo update shifts every selected node
  // by the same incremental delta.
  const pivot = useMemo(() => new THREE.Group(), [])
  const prevPivotPosRef = useRef(new THREE.Vector3())
  const prevPivotRotYRef = useRef(0)
  const multiIdsRef = useRef<string[]>([])
  // Track previous target.position during single-translate so we can apply
  // the same delta to the selected node's descendants (children parented to it).
  const prevTargetPosRef = useRef(new THREE.Vector3())

  useFrame(() => {
    const state = useScene.getState()
    const ids = state.selectedIds
    // Multi pivot is engaged for translate, rotate, AND scale when 2+ nodes
    // selected — each transform pivots around the centroid and applies the
    // gizmo delta to every selected node.
    const isMulti = ids.length > 1 && (transformMode === 'translate' || transformMode === 'rotate' || transformMode === 'scale')

    if (isMulti) {
      multiIdsRef.current = ids
      // Recompute centroid only when not actively dragging — during drag the
      // gizmo owns pivot.position/rotation. While idle we keep the pivot
      // tracking the current centroid in case nodes change.
      if (!gizmoState.dragging) {
        pivot.rotation.set(0, 0, 0)
        pivot.scale.set(1, 1, 1)
        let cx = 0, cy = 0, cz = 0
        let count = 0
        for (const id of ids) {
          const n = state.nodes[id]
          if (!n) continue
          const a = nodeAnchor(n)
          if (!a) continue
          cx += a[0]; cy += a[1]; cz += a[2]
          count++
        }
        if (count > 0) {
          pivot.position.set(cx / count, cy / count, cz / count)
        }
      }
      if (target !== pivot) setTarget(pivot)
      return
    }

    multiIdsRef.current = []
    const sel = state.selectedId
    if (!sel) {
      if (target) setTarget(null)
      return
    }
    const node = state.nodes[sel]
    if (!node || !TRANSFORMABLE.has(node.type)) {
      if (target) setTarget(null)
      return
    }
    const obj = sceneRegistry.get(sel) ?? null
    const attached = obj && obj.parent ? obj : null
    if (attached !== target) setTarget(attached)
  })

  useEffect(() => {
    const tc = tcRef.current
    if (!tc) return
    const onDragChanged = (e: any) => {
      gizmoState.dragging = !!e.value
      if (controls) controls.enabled = !e.value
      const temporalStore = useScene.temporal as any
      const temporal = temporalStore.getState()
      const selId = useScene.getState().selectedId
      if (e.value) {
        dragIdRef.current = selId
        preDragRef.current = partialized()
        resetSnapState(snapStateRef.current)
        prevPosRef.current = target ? target.position.clone() : null
        prevPivotPosRef.current.copy(pivot.position)
        prevPivotRotYRef.current = pivot.rotation.y
        if (target) prevTargetPosRef.current.copy(target.position)
        temporal.pause?.()
      } else {
        const id = dragIdRef.current
        const pre = preDragRef.current
        dragIdRef.current = null
        preDragRef.current = null
        resetSnapState(snapStateRef.current)
        prevPosRef.current = null

        // Multi-scale leaves pivot.scale at the user's drag value; reset to
        // identity so the next drag starts fresh (otherwise the gizmo would
        // re-apply the prior factor on top of the already-scaled nodes).
        if (target === pivot && transformMode === 'scale' && multiIdsRef.current.length > 1) {
          pivot.scale.set(1, 1, 1)
        }

        if (id && target && transformMode === 'scale' && multiIdsRef.current.length === 0) {
          const n = useScene.getState().nodes[id]
          if (n && (n.type === 'cabinet' || n.type === 'countertop')) {
            const sx = target.scale.x
            const sy = target.scale.y
            const sz = target.scale.z
            if (n.type === 'cabinet') {
              useScene.getState().updateNode(id, {
                width: Math.max(0.1, n.width * sx),
                height: Math.max(0.1, n.height * sy),
                depth: Math.max(0.1, n.depth * sz),
              } as Partial<CabinetNode>)
            } else {
              useScene.getState().updateNode(id, {
                width: Math.max(0.1, n.width * sx),
                thickness: Math.max(0.005, n.thickness * sy),
                depth: Math.max(0.1, n.depth * sz),
              } as Partial<CountertopNode>)
            }
            target.scale.set(1, 1, 1)
            // Snap-after-scale: flush the closest face to a nearby parallel
            // face so a free-dragged scale lands on a clean alignment when
            // the user nudges close to one. Same threshold as Alt+Arrow.
            if (snapEnabled) snapAxisFlush(id)
          }
          if (n && n.type === 'wall') {
            const wall = n as WallNode
            const [wsx, wsz] = wall.start
            const [wex, wez] = wall.end
            const origLen = Math.hypot(wex - wsx, wez - wsz)
            const newLen = Math.max(0.1, origLen * target.scale.x)
            const dirX = origLen > 1e-6 ? (wex - wsx) / origLen : 1
            const dirZ = origLen > 1e-6 ? (wez - wsz) / origLen : 0
            const cx = (wsx + wex) / 2
            const cz = (wsz + wez) / 2
            const half = newLen / 2
            useScene.getState().updateNode(id, {
              start: [cx - dirX * half, cz - dirZ * half],
              end: [cx + dirX * half, cz + dirZ * half],
              height: Math.max(0.1, wall.height * target.scale.y),
              thickness: Math.max(0.01, wall.thickness * target.scale.z),
            } as Partial<WallNode>)
            target.scale.set(1, 1, 1)
          }
        }

        temporal.resume?.()
        if (!pre) return

        const current = temporalStore.getState()
        temporalStore.setState({
          pastStates: [...current.pastStates, pre],
          futureStates: [],
        })
      }
    }
    const onAxisChanged = () => {
      gizmoState.hoveringAxis = !!tc.axis
    }
    tc.addEventListener('dragging-changed', onDragChanged)
    tc.addEventListener('axis-changed', onAxisChanged)
    return () => {
      tc.removeEventListener('dragging-changed', onDragChanged)
      tc.removeEventListener('axis-changed', onAxisChanged)
    }
  }, [controls, target, transformMode, pivot])

  if (!target) return null

  const onObjectChange = () => {
    if (!target) return

    // Multi-scale path: gizmo attached to pivot at centroid. Each frame's
    // pivot.scale is applied AGAINST the pre-drag snapshot — both the
    // dimensions and the position relative to the centroid scale uniformly.
    // Re-deriving from the snapshot every frame avoids precision drift from
    // chained multiplicative updates and lets the user freely scale up/down
    // through 1.0 without ratchet effects.
    if (target === pivot && multiIdsRef.current.length > 1 && transformMode === 'scale') {
      const sx = pivot.scale.x
      const sy = pivot.scale.y
      const sz = pivot.scale.z
      const cx = pivot.position.x
      const cy = pivot.position.y
      const cz = pivot.position.z
      const pre = preDragRef.current
      if (!pre) return
      const sceneState = useScene.getState()
      const toScale = new Set<string>()
      for (const id of multiIdsRef.current) {
        toScale.add(id)
        for (const d of getDescendantIds(sceneState.nodes, id)) toScale.add(d)
      }
      for (const id of toScale) {
        const orig = pre.nodes[id]
        if (!orig) continue
        if (orig.type === 'cabinet') {
          const [px, py, pz] = orig.transform.position
          sceneState.updateNode(id, {
            width: Math.max(0.1, orig.width * sx),
            height: Math.max(0.1, orig.height * sy),
            depth: Math.max(0.1, orig.depth * sz),
            transform: {
              ...orig.transform,
              position: [cx + (px - cx) * sx, cy + (py - cy) * sy, cz + (pz - cz) * sz],
            },
          } as Partial<CabinetNode>)
        } else if (orig.type === 'countertop') {
          const [px, py, pz] = orig.transform.position
          sceneState.updateNode(id, {
            width: Math.max(0.1, orig.width * sx),
            thickness: Math.max(0.005, orig.thickness * sy),
            depth: Math.max(0.1, orig.depth * sz),
            transform: {
              ...orig.transform,
              position: [cx + (px - cx) * sx, cy + (py - cy) * sy, cz + (pz - cz) * sz],
            },
          } as Partial<CountertopNode>)
        } else if (orig.type === 'custom-item') {
          const [px, py, pz] = orig.transform.position
          const oScale = orig.scale ?? [1, 1, 1]
          sceneState.updateNode(id, {
            transform: {
              ...orig.transform,
              position: [cx + (px - cx) * sx, cy + (py - cy) * sy, cz + (pz - cz) * sz],
            },
            scale: [oScale[0] * sx, oScale[1] * sy, oScale[2] * sz],
          } as Partial<CustomItemNode>)
        } else if (orig.type === 'empty') {
          const [px, py, pz] = orig.transform.position
          sceneState.updateNode(id, {
            transform: {
              ...orig.transform,
              position: [cx + (px - cx) * sx, cy + (py - cy) * sy, cz + (pz - cz) * sz],
            },
          } as Partial<EmptyNode>)
        } else if (orig.type === 'wall') {
          // Scale the wall's length by sx/sz combined (use the longer of the
          // two so a uniform-feeling scale on the gizmo translates to a
          // proportional length change), and scale height by sy.
          const lenK = Math.max(sx, sz)
          const [s0x, s0z] = orig.start
          const [e0x, e0z] = orig.end
          const newSx = cx + (s0x - cx) * sx
          const newSz = cz + (s0z - cz) * sz
          const newEx = cx + (e0x - cx) * sx
          const newEz = cz + (e0z - cz) * sz
          sceneState.updateNode(id, {
            start: [newSx, newSz],
            end: [newEx, newEz],
            height: Math.max(0.1, orig.height * sy),
            thickness: Math.max(0.01, orig.thickness * lenK),
          } as Partial<WallNode>)
        } else if (orig.type === 'light') {
          const [px, py, pz] = orig.position
          sceneState.updateNode(id, {
            position: [cx + (px - cx) * sx, cy + (py - cy) * sy, cz + (pz - cz) * sz],
          } as Partial<LightNode>)
        }
      }
      return
    }

    // Multi-rotate path: gizmo attached to pivot at centroid. Each frame's
    // delta angle rotates every selected node both about its own Y axis AND
    // around the centroid. Cabinet/countertop/custom-item/empty rotate via
    // their `transform.rotationY`; walls rotate by re-orienting their
    // start/end around the centroid; lights have no rotation but their
    // position revolves. Cascades to descendants too.
    if (target === pivot && multiIdsRef.current.length > 1 && transformMode === 'rotate') {
      const dRot = pivot.rotation.y - prevPivotRotYRef.current
      prevPivotRotYRef.current = pivot.rotation.y
      if (Math.abs(dRot) < 1e-6) return
      const cosR = Math.cos(dRot)
      const sinR = Math.sin(dRot)
      const cx = pivot.position.x
      const cz = pivot.position.z
      const sceneState = useScene.getState()
      const toRotate = new Set<string>()
      for (const id of multiIdsRef.current) {
        toRotate.add(id)
        for (const d of getDescendantIds(sceneState.nodes, id)) toRotate.add(d)
      }
      const rotXZ = (x: number, z: number): [number, number] => [
        cx + (x - cx) * cosR - (z - cz) * sinR,
        cz + (x - cx) * sinR + (z - cz) * cosR,
      ]
      for (const id of toRotate) {
        const n = sceneState.nodes[id]
        if (!n) continue
        if (n.type === 'cabinet' || n.type === 'countertop' || n.type === 'custom-item' || n.type === 'empty') {
          const [px, py, pz] = n.transform.position
          const [nx, nz] = rotXZ(px, pz)
          sceneState.updateNode(id, {
            transform: { position: [nx, py, nz], rotationY: n.transform.rotationY + dRot },
          } as any)
        } else if (n.type === 'wall') {
          const [s0, s1] = rotXZ(n.start[0], n.start[1])
          const [e0, e1] = rotXZ(n.end[0], n.end[1])
          sceneState.updateNode(id, { start: [s0, s1], end: [e0, e1] } as any)
        } else if (n.type === 'light') {
          const [px, py, pz] = n.position
          const [nx, nz] = rotXZ(px, pz)
          sceneState.updateNode(id, { position: [nx, py, nz] } as any)
        }
      }
      return
    }

    // Multi-translate path: gizmo is attached to the pivot. Compute the
    // incremental delta since last frame and apply it to every selected
    // node AND to all of their descendants (so children parented to a
    // selected node move with it). Deduped via Set so a node selected and
    // also reachable as a descendant of another selected node only shifts
    // once.
    if (target === pivot && multiIdsRef.current.length > 1) {
      const dx = pivot.position.x - prevPivotPosRef.current.x
      const dy = pivot.position.y - prevPivotPosRef.current.y
      const dz = pivot.position.z - prevPivotPosRef.current.z
      prevPivotPosRef.current.copy(pivot.position)
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 && Math.abs(dz) < 1e-6) return
      const sceneState = useScene.getState()
      const toShift = new Set<string>()
      for (const id of multiIdsRef.current) {
        toShift.add(id)
        for (const d of getDescendantIds(sceneState.nodes, id)) toShift.add(d)
      }
      for (const id of toShift) {
        const n = sceneState.nodes[id]
        if (!n) continue
        const patch = shiftNodePatch(n, dx, dy, dz)
        if (patch) sceneState.updateNode(id, patch as Partial<AnyNode> & Record<string, unknown>)
      }

      // Group snap: after applying the user's pivot drag delta, scan each
      // selected node for its own kitchen-snap correction and apply the
      // SHORTEST one to every node + descendant. The group moves as a unit
      // — relative offsets between selected nodes are preserved — but the
      // group as a whole pulls into alignment when any of its members
      // would normally snap to scene geometry.
      if (snapEnabled) {
        let bestCorr: THREE.Vector3 | null = null
        let bestMag = Infinity
        const fresh = useScene.getState()
        for (const id of multiIdsRef.current) {
          const n = fresh.nodes[id]
          if (!n) continue
          const dims = dimsOf(n)
          if (!dims) continue
          const a = nodeAnchor(n)
          if (!a) continue
          const probe = new THREE.Vector3(a[0], a[1], a[2])
          const orig = probe.clone()
          // Fresh per-node snap state so each node evaluates independently.
          const tmpState = createSnapState()
          applyStickySnap(
            n as any,
            dims,
            probe,
            tmpState,
            null,
            undefined,
            undefined,
            { x: false, y: false, z: false },
            useEditor.getState().snapMode,
          )
          const cdx = probe.x - orig.x
          const cdy = probe.y - orig.y
          const cdz = probe.z - orig.z
          const mag = Math.hypot(cdx, cdy, cdz)
          if (mag > 1e-6 && mag < bestMag) {
            bestMag = mag
            bestCorr = new THREE.Vector3(cdx, cdy, cdz)
          }
        }
        if (bestCorr) {
          for (const id of toShift) {
            const n = useScene.getState().nodes[id]
            if (!n) continue
            const patch = shiftNodePatch(n, bestCorr.x, bestCorr.y, bestCorr.z)
            if (patch) useScene.getState().updateNode(id, patch as Partial<AnyNode> & Record<string, unknown>)
          }
        }
      }
      return
    }

    // Single-selection path (existing behavior).
    const selectedId = useScene.getState().selectedId
    if (!selectedId) return
    const node = useScene.getState().nodes[selectedId]
    if (!node) return

    if (snapEnabled && transformMode === 'translate') {
      if (node.type === 'wall') {
        // Walls always sit on the floor — pin Y. Use the wall-specific
        // axis-aligned face-flush snap (looser thresholds than the general
        // kitchen sticky snap, since walls are coarse drag targets and
        // need to latch onto cabinet backs / perpendicular wall ends from
        // further away). Grid step is the fallback when no neighbour
        // engages on a given axis.
        const step = useEditor.getState().snapStep
        target.position.y = 0
        const probe = target.position.clone()
        const tcAxis = String((tcRef.current as any)?.axis ?? '').toUpperCase()
        const suppress = {
          x: !tcAxis.includes('X') && tcAxis !== '' && tcAxis !== 'XY' && tcAxis !== 'XZ' && tcAxis !== 'XYZ',
          z: !tcAxis.includes('Z') && tcAxis !== '' && tcAxis !== 'XZ' && tcAxis !== 'YZ' && tcAxis !== 'XYZ',
        }
        const { dx, dz } = snapWallTranslate(node, probe, suppress)
        const snappedX = Math.abs(dx) > 1e-6
        const snappedZ = Math.abs(dz) > 1e-6
        target.position.x = snappedX ? probe.x + dx : (suppress.x ? probe.x : snapStep(probe.x, step))
        target.position.z = snappedZ ? probe.z + dz : (suppress.z ? probe.z : snapStep(probe.z, step))
        prevPosRef.current = target.position.clone()
      } else if (node.type === 'light') {
        const step = useEditor.getState().snapStep
        target.position.x = snapStep(target.position.x, step)
        target.position.y = snapStep(target.position.y, step)
        target.position.z = snapStep(target.position.z, step)
      } else {
        const dims = dimsOf(node)
        if (dims) {
          const p = target.position.clone()
          const tcAxis = String((tcRef.current as any)?.axis ?? '').toUpperCase()
          const suppress = {
            x: !tcAxis.includes('X') && tcAxis !== '' && tcAxis !== 'XY' && tcAxis !== 'XZ' && tcAxis !== 'XYZ',
            y: !tcAxis.includes('Y') && tcAxis !== '' && tcAxis !== 'XY' && tcAxis !== 'YZ' && tcAxis !== 'XYZ',
            z: !tcAxis.includes('Z') && tcAxis !== '' && tcAxis !== 'XZ' && tcAxis !== 'YZ' && tcAxis !== 'XYZ',
          }
          if (node.type === 'custom-item' && tcAxis === 'Y') suppress.y = true
          const mode = useEditor.getState().snapMode
          applyStickySnap(node as any, dims, p, snapStateRef.current, prevPosRef.current, undefined, undefined, suppress, mode)
          target.position.set(p.x, p.y, p.z)
          const wallRot = shouldAutoRotateToWall(node)
            ? findWallFacingRotation([p.x, p.y, p.z], node)
            : null
          if (wallRot !== null) target.rotation.y = wallRot
          prevPosRef.current = p.clone()
        }
      }
    }

    const patch = patchFromObject(node, target)
    if (patch) useScene.getState().updateNode(selectedId, patch as Partial<AnyNode> & Record<string, unknown>)

    // Single-translate cascade: shift this node's descendants by the same
    // delta we just applied to it, so children parented under it follow.
    // (Rotate/scale don't cascade — only the selected node responds.)
    if (transformMode === 'translate') {
      const dx = target.position.x - prevTargetPosRef.current.x
      const dy = target.position.y - prevTargetPosRef.current.y
      const dz = target.position.z - prevTargetPosRef.current.z
      prevTargetPosRef.current.copy(target.position)
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 && Math.abs(dz) < 1e-6) return
      const sceneState = useScene.getState()
      for (const id of getDescendantIds(sceneState.nodes, selectedId)) {
        const n = sceneState.nodes[id]
        if (!n) continue
        const p = shiftNodePatch(n, dx, dy, dz)
        if (p) sceneState.updateNode(id, p as Partial<AnyNode> & Record<string, unknown>)
      }
    }
  }

  const TC = TransformControls as any
  return (
    <>
      {/* Mount the multi-selection pivot in the scene (invisible). The gizmo
          attaches to this when more than one node is selected in translate mode. */}
      <primitive object={pivot} />
      <TC
        ref={tcRef}
        object={target}
        mode={transformMode}
        size={0.9}
        translationSnap={null}
        rotationSnap={snapEnabled ? (snapAngleDeg * Math.PI) / 180 : null}
        scaleSnap={snapEnabled ? 0.1 : null}
        onObjectChange={onObjectChange}
      />
    </>
  )
}
