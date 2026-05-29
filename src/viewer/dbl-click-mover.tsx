'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useScene, getDescendantIds } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import { sceneRegistry } from '@/core/registry/scene-registry'
import type { AnyNode, CabinetNode, CountertopNode, CustomItemNode, EmptyNode, LightNode, WallNode } from '@/core/schema'
import { applyStickySnap, createSnapState, dimsOf, resetSnapState, snapWallTranslate } from '@/core/systems/object-snap'
import { deselectState, moveMode } from '@/core/systems/deselect-state'
import { findWallFacingRotation, shouldAutoRotateToWall } from '@/core/systems/auto-rotate'

const TRANSFORMABLE = new Set(['cabinet', 'countertop', 'custom-item', 'wall', 'light', 'empty'])

function partialized() {
  const s = useScene.getState()
  const nodes: Record<string, AnyNode> = {}
  for (const [k, v] of Object.entries(s.nodes)) nodes[k] = JSON.parse(JSON.stringify(v))
  return { nodes, rootNodeIds: [...s.rootNodeIds] }
}

/**
 * Double-click-to-pick-up, click-to-place.
 * - With a transformable node selected, a double-click enters move mode.
 *   The node jumps to the cursor on its own Y plane and follows the mouse.
 * - The next left-click places it and exits move mode.
 * - Escape cancels and reverts to the pre-move position.
 *
 * Snap and sticky collision are applied while moving.
 */
export function DblClickMover() {
  const { gl, camera } = useThree()
  const controls = useThree((s) => s.controls) as any

  const moveIdRef = useRef<string | null>(null)
  const preRef = useRef<any>(null)
  const dragYRef = useRef<number>(0)
  const snapStateRef = useRef(createSnapState())
  const prevPosRef = useRef<THREE.Vector3 | null>(null)
  // Remember the most recent selection so a dblclick right after an
  // accidental empty click still knows what to move.
  const lastSelectedIdRef = useRef<string | null>(null)
  // Same as lastSelectedIdRef but for multi-selection — captured so a
  // dblclick after a click that fires deselect-on-empty still has the
  // full set of selected ids to move as a group.
  const lastSelectedIdsRef = useRef<string[]>([])
  // Offset between the dragged node's anchor and the cursor's drag-plane
  // pick point captured at startMove. Without this, a dbl-click anywhere
  // other than directly on the object teleports the object to the cursor's
  // projection (especially noticeable for ceiling lights, where the
  // cursor projection lands metres away from the bulb).
  const moveOffsetRef = useRef<{ x: number; z: number }>({ x: 0, z: 0 })
  // Followers (other selected nodes + descendants of all selected nodes,
  // excluding the primary) to shift by the primary's per-frame delta when
  // multi-selection is active. Captured at startMove so it stays stable
  // through the drag even if selection state mutates.
  const followerIdsRef = useRef<string[]>([])

  useEffect(() => {
    const unsub = useScene.subscribe((s) => {
      if (s.selectedId) lastSelectedIdRef.current = s.selectedId
      if (s.selectedIds.length > 0) lastSelectedIdsRef.current = [...s.selectedIds]
    })
    return unsub
  }, [])

  useEffect(() => {
    const el = gl.domElement

    const pickPlane = (clientX: number, clientY: number, planeY: number): THREE.Vector3 | null => {
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      const rc = new THREE.Raycaster()
      rc.setFromCamera(ndc, camera)
      const ray = rc.ray
      if (Math.abs(ray.direction.y) < 1e-6) return null
      const t = (planeY - ray.origin.y) / ray.direction.y
      if (t <= 0) return null
      return ray.origin.clone().add(ray.direction.multiplyScalar(t))
    }

    const applyPosition = (id: string, x: number, z: number) => {
      const raw = useScene.getState().nodes[id]
      if (!raw) return

      // Walls don't have transform.position; they're a start/end pair.
      // Move them by the XZ delta from their current midpoint to the cursor,
      // then run the wall-specific axis-aligned snap so the wall flushes
      // against neighbours (other walls, cabinets, countertops) just like
      // the gizmo translate does.
      if (raw.type === 'wall') {
        const w = raw as WallNode
        const cx = (w.start[0] + w.end[0]) / 2
        const cz = (w.start[1] + w.end[1]) / 2
        let tx = x
        let tz = z
        if (useEditor.getState().snapEnabled) {
          const probe = new THREE.Vector3(tx, 0, tz)
          const { dx: sdx, dz: sdz } = snapWallTranslate(w, probe)
          tx += sdx
          tz += sdz
        }
        const dx = tx - cx
        const dz = tz - cz
        if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return
        useScene.getState().updateNode(id, {
          start: [w.start[0] + dx, w.start[1] + dz],
          end: [w.end[0] + dx, w.end[1] + dz],
        } as Partial<WallNode>)
        shiftFollowers(dx, 0, dz)
        return
      }

      // Light has its own `position` field rather than `transform`. Move it
      // by the XZ delta the user requested; Y stays at whatever the light
      // was at (most useful for ceiling lights — they keep their height).
      // Grid-snap when snap is enabled so the light moves in discrete steps,
      // which makes ceiling-light positioning feel controlled instead of
      // skating a metre per pixel of mouse motion.
      if (raw.type === 'light') {
        const li = raw as LightNode
        const [px, py, pz] = li.position
        const ed = useEditor.getState()
        const tx = ed.snapEnabled ? Math.round(x / ed.snapStep) * ed.snapStep : x
        const tz = ed.snapEnabled ? Math.round(z / ed.snapStep) * ed.snapStep : z
        const dx = tx - px
        const dz = tz - pz
        if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return
        useScene.getState().updateNode(id, { position: [tx, py, tz] } as Partial<LightNode>)
        shiftFollowers(dx, 0, dz)
        return
      }

      const n = raw as CabinetNode | CountertopNode | CustomItemNode | EmptyNode
      const free = new THREE.Vector3(x, n.transform.position[1], z)
      if (useEditor.getState().snapEnabled) {
        const dims = dimsOf(n as AnyNode)
        if (dims)
          applyStickySnap(
            n as AnyNode,
            dims,
            free,
            snapStateRef.current,
            prevPosRef.current,
            undefined,
            undefined,
            { x: false, y: false, z: false },
            useEditor.getState().snapMode,
          )
      }
      prevPosRef.current = free.clone()

      // Compute the per-frame XYZ delta so we can cascade it to children.
      // Without this, dragging a parent (countertop) leaves its children
      // (sink, etc.) behind.
      const dx = free.x - n.transform.position[0]
      const dy = free.y - n.transform.position[1]
      const dz = free.z - n.transform.position[2]
      const wallRot = shouldAutoRotateToWall(n as AnyNode)
        ? findWallFacingRotation([free.x, free.y, free.z], n as AnyNode)
        : null
      const rotationY = wallRot ?? n.transform.rotationY

      const obj = sceneRegistry.get(id)
      if (obj) {
        obj.position.set(free.x, free.y, free.z)
        obj.rotation.y = rotationY
      }
      useScene.getState().updateNode(id, {
        transform: { ...n.transform, position: [free.x, free.y, free.z], rotationY },
      } as Partial<typeof n>)

      // Shift followers (other selected + descendants) by the same delta.
      if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6 || Math.abs(dz) > 1e-6) {
        shiftFollowers(dx, dy, dz)
      }
    }

    // Shared helper: apply (dx, dy, dz) to every node in followerIdsRef.
    // Picks up children parented under the dragged node AND any other
    // members of a multi-selection so the whole group moves as a unit.
    const shiftFollowers = (dx: number, dy: number, dz: number) => {
      const ids = followerIdsRef.current
      if (ids.length === 0) return
      const sceneState = useScene.getState()
      for (const childId of ids) {
        const c = sceneState.nodes[childId]
        if (!c) continue
        if (c.type === 'cabinet' || c.type === 'countertop' || c.type === 'custom-item' || c.type === 'empty') {
          const [px, py, pz] = c.transform.position
          sceneState.updateNode(childId, {
            transform: { ...c.transform, position: [px + dx, py + dy, pz + dz] },
          } as any)
        } else if (c.type === 'light') {
          const [px, py, pz] = c.position
          sceneState.updateNode(childId, { position: [px + dx, py + dy, pz + dz] } as any)
        } else if (c.type === 'wall') {
          sceneState.updateNode(childId, {
            start: [c.start[0] + dx, c.start[1] + dz],
            end: [c.end[0] + dx, c.end[1] + dz],
          } as any)
        }
      }
    }

    const startMove = (clientX: number, clientY: number) => {
      const sceneNow = useScene.getState()
      const id = sceneNow.selectedId ?? lastSelectedIdRef.current
      if (!id) return false
      const n = sceneNow.nodes[id]
      if (!n || !TRANSFORMABLE.has(n.type)) return false

      // Capture the full selection set BEFORE any select() call below resets
      // selectedIds. Falls back to the last-seen selection so a dblclick
      // following an empty-click deselect still grabs the multi-set.
      const idsSet = new Set<string>()
      const liveIds = sceneNow.selectedIds.length > 0 ? sceneNow.selectedIds : lastSelectedIdsRef.current
      for (const sid of liveIds) {
        if (TRANSFORMABLE.has(sceneNow.nodes[sid]?.type ?? '')) idsSet.add(sid)
      }
      idsSet.add(id)
      // Followers = (all selected ∪ descendants of each) − primary.
      const followers = new Set<string>()
      for (const sid of idsSet) {
        if (sid !== id) followers.add(sid)
        for (const d of getDescendantIds(sceneNow.nodes, sid)) {
          if (d !== id) followers.add(d)
        }
      }
      followerIdsRef.current = [...followers]

      // Make sure selection is current (in case click-to-deselect fired just before).
      if (sceneNow.selectedId !== id) useScene.getState().select(id)

      // Pick a horizontal drag plane suitable for the node's type.
      let planeY: number
      let prevWorld: THREE.Vector3
      if (n.type === 'wall') {
        const w = n as WallNode
        planeY = w.height / 2
        prevWorld = new THREE.Vector3((w.start[0] + w.end[0]) / 2, planeY, (w.start[1] + w.end[1]) / 2)
      } else if (n.type === 'light') {
        // Drag plane sits at the light's own Y. The pick-offset logic below
        // keeps the light from teleporting to the cursor's projection.
        const li = n as LightNode
        planeY = li.position[1]
        prevWorld = new THREE.Vector3(li.position[0], li.position[1], li.position[2])
      } else {
        const nn = n as CabinetNode | CountertopNode | CustomItemNode | EmptyNode
        planeY = nn.transform.position[1] + (dimsOf(n as AnyNode)?.h ?? 0) * 0.5
        prevWorld = new THREE.Vector3(nn.transform.position[0], nn.transform.position[1], nn.transform.position[2])
      }
      dragYRef.current = planeY
      const hit = pickPlane(clientX, clientY, planeY)
      if (!hit) return false

      moveIdRef.current = id
      preRef.current = partialized()
      resetSnapState(snapStateRef.current)
      prevPosRef.current = prevWorld
      // Initial pick → offset so the node stays put on dbl-click and tracks
      // the cursor delta from there. Same pattern as a typical drag handle.
      moveOffsetRef.current = { x: prevWorld.x - hit.x, z: prevWorld.z - hit.z }
      moveMode.active = true
      if (controls) controls.enabled = false
      const temporal = (useScene.temporal as any).getState()
      temporal.pause?.()

      // Don't snap the object to the cursor immediately — leave it where
      // the user double-clicked it. The next pointermove triggers
      // `applyPosition`, which moves the object as the cursor travels.
      // Avoids the surprise of an accidental dbl-click yanking the object
      // away from its original spot.
      void hit
      return true
    }

    const commitMove = () => {
      if (!moveMode.active) return
      const pre = preRef.current
      moveIdRef.current = null
      preRef.current = null
      resetSnapState(snapStateRef.current)
      prevPosRef.current = null
      followerIdsRef.current = []
      moveMode.active = false
      if (controls) controls.enabled = true
      const temporalStore = useScene.temporal as any
      const temporal = temporalStore.getState()
      temporal.resume?.()
      if (pre) {
        const current = temporalStore.getState()
        temporalStore.setState({
          pastStates: [...current.pastStates, pre],
          futureStates: [],
        })
      }
    }

    const cancelMove = () => {
      if (!moveMode.active) return
      const pre = preRef.current
      moveIdRef.current = null
      preRef.current = null
      resetSnapState(snapStateRef.current)
      prevPosRef.current = null
      followerIdsRef.current = []
      moveMode.active = false
      if (controls) controls.enabled = true
      const temporalStore = useScene.temporal as any
      const temporal = temporalStore.getState()
      temporal.resume?.()
      if (pre) {
        // Restore full partialized snapshot via main store
        useScene.setState({ nodes: pre.nodes, rootNodeIds: pre.rootNodeIds })
      }
    }

    const onDblClick = (e: MouseEvent) => {
      // A dblclick is a follow-up to a click that may have scheduled deselect.
      deselectState.cancel()
      if (moveMode.active) {
        commitMove()
        e.stopPropagation()
        e.preventDefault()
        return
      }
      if (startMove(e.clientX, e.clientY)) {
        e.stopPropagation()
        e.preventDefault()
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!moveMode.active || !moveIdRef.current) return
      const hit = pickPlane(e.clientX, e.clientY, dragYRef.current)
      if (!hit) return
      // Apply the drag-handle offset captured at startMove so the node
      // tracks cursor *delta* instead of jumping to the cursor's literal
      // drag-plane projection.
      const ox = moveOffsetRef.current.x
      const oz = moveOffsetRef.current.z
      applyPosition(moveIdRef.current, hit.x + ox, hit.z + oz)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!moveMode.active) return
      if (e.button !== 0) return
      // Single click during move = commit / place
      commitMove()
      e.stopPropagation()
      e.preventDefault()
    }

    const onKey = (e: KeyboardEvent) => {
      if (!moveMode.active) return
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelMove()
      }
    }

    el.addEventListener('dblclick', onDblClick, { capture: true })
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('dblclick', onDblClick, { capture: true } as any)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerdown', onPointerDown, { capture: true } as any)
      window.removeEventListener('keydown', onKey)
    }
  }, [gl, camera, controls])

  return null
}
