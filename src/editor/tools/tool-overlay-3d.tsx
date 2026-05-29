'use client'

import { useEffect } from 'react'
import * as THREE from 'three'
import { emitter } from '@/core/events/emitter'
import { useScene } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import { useAssets } from '@/core/store/use-assets'
import { makeId } from '@/core/utils/id'
import { snap } from '@/core/utils/math'
import type { AnyNode, CabinetNode, CountertopNode, CustomItemNode, EmptyNode, LightNode, WallNode } from '@/core/schema'
import { findCabinetBelow, cabinetWorldTop } from '@/core/systems/cabinet-stack'
import { boxFor, collidesBox, isAllowedBuiltInCabinetOverlap } from '@/core/systems/collision'
import { gizmoState } from '@/core/systems/gizmo-state'
import { deselectState, moveMode } from '@/core/systems/deselect-state'
import { isPredefinedAssetId } from '@/core/assets/predefined'
import { getAssetBbox } from '@/core/assets/asset-bbox'
import { playPlaceSound } from '@/core/utils/place-sound'
import { applyStickySnap, createSnapState, dimsOf } from '@/core/systems/object-snap'
import { findWallFacingRotation } from '@/core/systems/auto-rotate'

let lastClickAt = 0

function snapXZ(x: number, z: number) {
  const ed = useEditor.getState()
  if (!ed.snapEnabled) return [x, z] as [number, number]
  return [snap(x, ed.snapStep), snap(z, ed.snapStep)] as [number, number]
}

// Run the kitchen-aware sticky-snap pass before committing a placement so a
// new cabinet/countertop/item flushes against its neighbours instead of
// dropping at the raw cursor position. The candidate node is NOT in the
// scene yet — applyStickySnap reads scene state to find OTHERS only and
// uses `selfNode` purely for category + frame, so passing a stub works.
function snapPlacement(
  stub: AnyNode,
  x: number,
  y: number,
  z: number,
  suppress: { x: boolean; y: boolean; z: boolean } = { x: false, y: false, z: false },
): [number, number, number] {
  const ed = useEditor.getState()
  if (!ed.snapEnabled) return [x, y, z]
  const dims = dimsOf(stub)
  if (!dims) return [x, y, z]
  const probe = new THREE.Vector3(x, y, z)
  applyStickySnap(
    stub,
    dims,
    probe,
    createSnapState(),
    null,
    undefined,
    undefined,
    suppress,
    ed.snapMode,
  )
  return [probe.x, probe.y, probe.z]
}

function findOpenCabinetAtXZ(x: number, z: number): CabinetNode | null {
  const nodes = useScene.getState().nodes
  for (const n of Object.values(nodes)) {
    if (n.type !== 'cabinet' || n.doorKind !== 'none' || !n.visible) continue
    const [cx, , cz] = n.transform.position
    const relX = x - cx
    const relZ = z - cz
    const cos = Math.cos(-n.transform.rotationY)
    const sin = Math.sin(-n.transform.rotationY)
    const localX = relX * cos - relZ * sin
    const localZ = relX * sin + relZ * cos
    if (Math.abs(localX) <= n.width / 2 + 0.12 && Math.abs(localZ) <= n.depth / 2 + 0.18) return n
  }
  return null
}

export function ToolOverlay3D() {
  useEffect(() => {
    const onGridClick = ({ position, button }: { position: [number, number, number]; button: number }) => {
      if (button !== 0) return
      // MoveMode consumes its own clicks (pickup / place). Don't react here.
      if (moveMode.active) return
      const now = performance.now()
      if (now - lastClickAt < 80) return
      lastClickAt = now
      const tool = useEditor.getState().tool
      const state = useScene.getState()
      const [x, , z] = position
      const [sx, sz] = snapXZ(x, z)

      if (tool === 'select') {
        if (gizmoState.dragging || gizmoState.hoveringAxis) return
        // Delay the deselect so a following double-click can cancel it
        // and enter move mode with the current selection intact.
        deselectState.cancel()
        deselectState.pendingTimeoutId = setTimeout(() => {
          useScene.getState().select(null)
          deselectState.pendingTimeoutId = null
        }, 280)
        return
      }

      if (tool === 'wall') {
        // Walls always grid-snap during placement, regardless of the global
        // snapEnabled flag — keeps wall endpoints on consistent step values
        // so layouts stay clean.
        const step = useEditor.getState().snapStep
        const wsx = snap(x, step)
        const wsz = snap(z, step)
        const start = useEditor.getState().wallDrawStart
        if (!start) {
          useEditor.getState().setWallDrawStart([wsx, wsz])
        } else if (start[0] === wsx && start[1] === wsz) {
          useEditor.getState().setWallDrawStart(null)
        } else {
          const id = makeId('wall')
          const node: WallNode = {
            id,
            type: 'wall',
            parentId: null,
            visible: true,
            start,
            end: [wsx, wsz],
            thickness: 0.1,
            height: 2.6,
            material: { color: '#cccccc', roughness: 0.9, metalness: 0 },
          }
          state.createNode(node)
        playPlaceSound()
          state.select(id)
          useEditor.getState().setWallDrawStart([wsx, wsz])
        }
        return
      }

      if (tool === 'cabinet') {
        const d = useEditor.getState().cabinetDefaults
        const below = findCabinetBelow([sx, 0, sz], { w: d.width, d: d.depth })
        const y =
          d.style === 'wall'
            ? 1.4
            : below
              ? cabinetWorldTop(state.nodes[below] as CabinetNode)
              : 0
        const stub: CabinetNode = {
          id: '__placement__',
          type: 'cabinet',
          parentId: null,
          visible: true,
          transform: { position: [sx, y, sz], rotationY: 0 },
          style: d.style,
          width: d.width,
          height: d.height,
          depth: d.depth,
          doorKind: d.doorKind,
          drawerCount: d.drawerCount,
          stackedBelowId: below,
          fillerKind: 'none',
          carcassMaterial: { color: '#fff', roughness: 0.6, metalness: 0 },
          doorMaterial: { color: '#e5e5e5', roughness: 0.5, metalness: 0 },
          handleMaterial: { color: '#333', roughness: 0.2, metalness: 0.8 },
        }
        const [psx, py, psz] = snapPlacement(stub, sx, y, sz)
        const facingRot = findWallFacingRotation([psx, py, psz]) ?? 0
        const box = boxFor('cabinet', [psx, 0, psz], { w: d.width, h: d.height, d: d.depth, y: py })
        if (collidesBox(null, box)) {
          console.warn('cabinet placement blocked — would collide')
          return
        }
        const id = makeId('cab')
        const node: CabinetNode = {
          id,
          type: 'cabinet',
          parentId: null,
          visible: true,
          transform: { position: [psx, py, psz], rotationY: facingRot },
          style: d.style,
          width: d.width,
          height: d.height,
          depth: d.depth,
          doorKind: d.doorKind,
          drawerCount: d.drawerCount,
          stackedBelowId: below,
          fillerKind: 'none',
          carcassMaterial: { color: '#ffffff', roughness: 0.6, metalness: 0 },
          doorMaterial: { color: '#e5e5e5', roughness: 0.5, metalness: 0 },
          handleMaterial: { color: '#333333', roughness: 0.2, metalness: 0.8 },
        }
        state.createNode(node)
        playPlaceSound()
        state.select(id)
        return
      }

      if (tool === 'countertop') {
        // If a base cabinet sits at this XZ, land the countertop on its
        // top automatically — otherwise the default 0.88 m would clash
        // with taller cabinets and the collision check would block placement.
        let topY = 0.88
        const cabBelow = findCabinetBelow([sx, 0, sz], { w: 1.2, d: 0.62 })
        if (cabBelow) {
          const cab = state.nodes[cabBelow] as CabinetNode | undefined
          if (cab) topY = cabinetWorldTop(cab) + 0.02 // half countertop thickness
        }
        const stub: CountertopNode = {
          id: '__placement__',
          type: 'countertop',
          parentId: null,
          visible: true,
          transform: { position: [sx, topY, sz], rotationY: 0 },
          width: 1.2,
          depth: 0.62,
          thickness: 0.04,
          material: { color: '#222', roughness: 0.3, metalness: 0 },
        }
        const [psx, ptopY, psz] = snapPlacement(stub, sx, topY, sz)
        const box = boxFor('countertop', [psx, ptopY, psz], { w: 1.2, h: 0.04, d: 0.62, y: ptopY - 0.02 })
        if (collidesBox(null, box)) {
          console.warn('countertop placement blocked — would collide')
          return
        }
        const id = makeId('top')
        const node: CountertopNode = {
          id,
          type: 'countertop',
          parentId: null,
          visible: true,
          transform: { position: [psx, ptopY, psz], rotationY: 0 },
          width: 1.2,
          depth: 0.62,
          thickness: 0.04,
          material: { color: '#222222', roughness: 0.3, metalness: 0 },
        }
        state.createNode(node)
        playPlaceSound()
        state.select(id)
        return
      }

      if (tool === 'empty') {
        const id = makeId('empty')
        const node: EmptyNode = {
          id,
          type: 'empty',
          parentId: null,
          visible: true,
          transform: { position: [sx, 0, sz], rotationY: 0 },
        }
        state.createNode(node)
        playPlaceSound()
        state.select(id)
        return
      }

      if (tool === 'light') {
        const id = makeId('light')
        const node: LightNode = {
          id,
          type: 'light',
          parentId: null,
          visible: true,
          kind: 'point',
          position: [sx, 2.4, sz],
          intensity: 6,
          color: '#ffffff',
        }
        state.createNode(node)
        playPlaceSound()
        state.select(id)
        // Switch back to select tool — otherwise the light tool stays active
        // and follow-up clicks (e.g. while moving the freshly placed light)
        // would drop more lights into the scene.
        useEditor.getState().setTool('select')
        return
      }

      if (tool === 'place-item') {
        const assetId = useEditor.getState().placingAssetId
        if (!assetId) return
        if (!isPredefinedAssetId(assetId) && !useAssets.getState().assets[assetId]) return

        // Per-asset placement defaults: fridge is roughly cabinet-sized so
        // it makes sense visually next to base cabinets; sink/mixer want
        // their bottom to land on a countertop's top if one's underneath.
        let initialScale: [number, number, number] = [1, 1, 1]
        let initialY = 0
        let initialRotationY = 0
        if (assetId === 'predef:fridge') {
          // Target a 60 cm depth (kitchen-cabinet line). The GLTF is
          // normalized so longest dim = 0.5 m; the actual depth is some
          // smaller fraction (a real fridge is taller than it is deep).
          // Derive a uniform scale so depth × scale = 0.6 m.
          const bb = getAssetBbox(assetId)
          if (bb && bb[2] > 0) {
            const k = 0.6 / bb[2]
            initialScale = [k, k, k]
          } else {
            // First-ever placement (bbox not yet cached) — use a sensible
            // fallback that gives ~60 cm depth for the typical 180×60×60
            // fridge proportions.
            initialScale = [3.6, 3.6, 3.6]
          }
        }
        if (assetId === 'predef:oven') {
          // Built-in oven slot is roughly the size of a base cabinet
          // (60 cm × 60 cm × 60 cm). Longest GLTF dim ≈ 0.5 m, so ×1.2.
          initialScale = [1.2, 1.2, 1.2]
          const openCabinet = findOpenCabinetAtXZ(sx, sz)
          if (openCabinet) initialRotationY = openCabinet.transform.rotationY
        }
        if (assetId === 'predef:induction') {
          // Hob top is ~60 cm × 52 cm; flat. Scale up to roughly fit a
          // cabinet's top footprint.
          initialScale = [1.2, 1.2, 1.2]
        }
        // Items that sit on a countertop snap their bottom onto the slab top
        // when one's underneath the click position.
        if (assetId === 'predef:sink' || assetId === 'predef:mixer' || assetId === 'predef:induction') {
          // If a countertop covers (sx, sz), drop the item right on its top.
          for (const n of Object.values(state.nodes)) {
            if (n.type !== 'countertop' || !n.visible) continue
            const cx = n.transform.position[0]
            const cz = n.transform.position[2]
            const w = n.width, d = n.depth
            if (sx >= cx - w / 2 && sx <= cx + w / 2 && sz >= cz - d / 2 && sz <= cz + d / 2) {
              initialY = n.transform.position[1] + n.thickness / 2
              if (assetId === 'predef:sink') initialY -= Math.min(0.025, n.thickness / 2)
              break
            }
          }
        }

        const stub: CustomItemNode = {
          id: '__placement__',
          type: 'custom-item',
          parentId: null,
          visible: true,
          assetId,
          transform: { position: [sx, initialY, sz], rotationY: initialRotationY },
          scale: initialScale,
          materialOverrides: {},
        }
        const [psx, pY, psz] = snapPlacement(
          stub,
          sx,
          initialY,
          sz,
          assetId === 'predef:sink'
            ? { x: false, y: true, z: false }
            : { x: false, y: false, z: false },
        )
        // Auto-rotate floor-standing appliances (fridge / oven) to face away
        // from a nearby wall. Countertop items (sink / mixer / induction)
        // sit on a slab and don't need wall orientation.
        const wantsWallFacing = assetId === 'predef:fridge' || assetId === 'predef:oven'
        const facingRot = assetId === 'predef:oven'
          ? initialRotationY
          : wantsWallFacing
            ? (findWallFacingRotation([psx, pY, psz]) ?? 0)
            : 0
        const placedDims = dimsOf({ ...stub, transform: { ...stub.transform, position: [psx, pY, psz] } })
          ?? { w: 0.5, h: 0.5, d: 0.5 }
        const box = boxFor('place-item', [psx, pY, psz], { ...placedDims, y: pY })
        if (collidesBox(null, box, (n, other) => isAllowedBuiltInCabinetOverlap(assetId, box, n, other))) {
          console.warn('asset placement blocked — would collide')
          return
        }
        const id = makeId('item')
        const node: CustomItemNode = {
          id,
          type: 'custom-item',
          parentId: null,
          visible: true,
          assetId,
          transform: { position: [psx, pY, psz], rotationY: facingRot },
          scale: initialScale,
          materialOverrides: {},
        }
        state.createNode(node)
        playPlaceSound()
        state.select(id)
        // Drop the placing tool so we don't drop more items each time the
        // user clicks while moving the placed one.
        useEditor.getState().setTool('select')
        useEditor.getState().setPlacingAssetId(null)
        return
      }
    }

    const onNodeClick = ({ node, position, shiftKey, ctrlKey, metaKey, altKey }: { node: any; position: [number, number, number]; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) => {
      if (moveMode.active) return
      if (gizmoState.dragging || gizmoState.hoveringAxis) return
      const tool = useEditor.getState().tool
      // If a placement tool is active, the user clicked an existing object
      // by accident (or because the object happens to be over where they
      // want to place). Fall through to the grid-click handler so the
      // placement still happens at that XZ rather than being blocked.
      if (tool !== 'select') {
        emitter.emit('grid:click', { position, button: 0 })
        return
      }
      deselectState.cancel()

      // If the clicked node is inside a "Group" empty (created by Merge),
      // selecting the leaf would feel wrong — the user expects all members
      // to be picked together. Walk up the parent chain to the topmost
      // empty named "Group" and select that. Alt-click drills past the
      // group and selects the actual clicked leaf.
      const allNodes = useScene.getState().nodes
      let targetId: string = node.id
      if (!altKey) {
        let cur: any = node
        while (cur && cur.parentId) {
          const parent = allNodes[cur.parentId]
          if (!parent) break
          if (parent.type === 'empty' && (parent as any).name === 'Group') {
            targetId = parent.id
          }
          cur = parent
        }
      }

      if (shiftKey || ctrlKey || metaKey) {
        useScene.getState().toggleSelect(targetId)
      } else {
        useScene.getState().select(targetId)
      }
    }

    emitter.on('grid:click', onGridClick)
    emitter.on('node:click', onNodeClick)
    return () => {
      emitter.off('grid:click', onGridClick)
      emitter.off('node:click', onNodeClick)
    }
  }, [])

  return null
}
