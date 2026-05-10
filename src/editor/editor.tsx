'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Toolbar, ViewModeSwitcher, rotateSelected90 } from './toolbar'
import { AssetLibrary } from './asset-library'
import { Outliner } from './outliner'
import { Inspector } from './inspector'
import { Canvas3D } from '@/viewer/canvas-3d'
import { Canvas2D } from '@/viewer/canvas-2d'
import { useEditor } from '@/core/store/use-editor'
import { useScene, getDescendantIds } from '@/core/store/use-scene'
import { dimsOf, findPointSnap } from '@/core/systems/object-snap'
import { extrudeFace, screenExtrudeToLocal } from '@/core/systems/extrude'

export default function Editor() {
  const viewMode = useEditor((s) => s.viewMode)
  // Width fraction of the LEFT (2D) pane when split-view is active. The
  // divider clamps it between 15% and 85% so neither pane disappears.
  const [splitRatio, setSplitRatio] = useState(0.5)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const onSplitDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = splitContainerRef.current
    if (!container) return
    e.preventDefault()
    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      const r = (ev.clientX - rect.left) / rect.width
      setSplitRatio(Math.max(0.15, Math.min(0.85, r)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useScene.temporal.getState().redo()
        else useScene.temporal.getState().undo()
        return
      }
      // Esc cancels in-progress wall drawing or active asset placement so
      // the user can quickly back out of a placement they didn't intend.
      if (e.key === 'Escape') {
        const ed = useEditor.getState()
        if (ed.tool === 'wall' && ed.wallDrawStart) {
          ed.setWallDrawStart(null)
          return
        }
        if (ed.tool === 'place-item' && ed.placingAssetId) {
          ed.setPlacingAssetId(null)
          ed.setTool('select')
          return
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = useScene.getState().selectedIds
        if (ids.length) useScene.getState().deleteNodes(ids)
        return
      }
      // Ctrl/Cmd+D — duplicate the current selection (single or multi).
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const ids = useScene.getState().selectedIds
        if (ids.length) useScene.getState().duplicateNodes(ids)
        return
      }
      const toolMap: Record<string, any> = {
        v: 'select',
        b: 'wall',
        c: 'cabinet',
        n: 'countertop',
        p: 'place-item',
        l: 'light',
        e: 'empty',
      }
      const tool = toolMap[e.key.toLowerCase()]
      if (tool) {
        useEditor.getState().setTool(tool)
        return
      }
      const tmMap: Record<string, any> = { g: 'translate', r: 'rotate', s: 'scale' }
      const tm = tmMap[e.key.toLowerCase()]
      if (tm) {
        useEditor.getState().setTransformMode(tm)
        return
      }

      if (e.key.toLowerCase() === 'x') {
        useEditor.getState().setSnapEnabled(!useEditor.getState().snapEnabled)
        return
      }

      // 0 (zero) — reset the selected object's rotation to 0. Useful when
      // an asset (sink, fridge) ended up rotated and the user wants to
      // restore the canonical front-facing orientation.
      if (e.key === '0') {
        const state = useScene.getState()
        const id = state.selectedId
        if (!id) return
        const n = state.nodes[id]
        if (!n) return
        if (n.type === 'cabinet' || n.type === 'countertop' || n.type === 'custom-item' || n.type === 'empty') {
          state.updateNode(id, { transform: { ...n.transform, rotationY: 0 } } as any)
        }
        return
      }

      if (e.key.toLowerCase() === 'q') {
        // Delegate to the toolbar helper so single AND multi-selection rotate
        // 90° around the selection centroid (walls, lights, descendants too).
        rotateSelected90()
        return
      }

      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        const state = useScene.getState()
        const id = state.selectedId
        if (!id) return
        const n = state.nodes[id]
        if (!n) return
        const arrowSupported = (t: string) =>
          t === 'cabinet' || t === 'countertop' || t === 'custom-item' || t === 'light' || t === 'wall' || t === 'empty'
        if (!arrowSupported(n.type)) return
        e.preventDefault()
        const ed = useEditor.getState()
        const step = e.shiftKey ? ed.snapStep * 10 : ed.snapStep

        // Alt+Arrow → extrude one side only. The OPPOSITE face stays put;
        // the arrow-direction face moves outward by `step`. Achieved by
        // growing the parametric dimension AND shifting position by
        // `step/2` toward the arrow.
        //
        // Alt+Shift+Arrow → undo: pull the arrow-direction face back
        // inward by `step` (opposite face still anchored). Same magnitude,
        // negative — restoring the previous dimension.
        if (e.altKey && (n.type === 'cabinet' || n.type === 'countertop')) {
          let screenDx = 0, screenDz = 0
          if (e.key === 'ArrowRight') screenDx = +1
          else if (e.key === 'ArrowLeft') screenDx = -1
          else if (e.key === 'ArrowDown') screenDz = +1
          else if (e.key === 'ArrowUp') screenDz = -1
          if (screenDx !== 0 || screenDz !== 0) {
            const { dim, arrowDir } = screenExtrudeToLocal(n.transform.rotationY, screenDx, screenDz)
            // Shift means "undo": pull the arrow-direction face back inward
            // by one step (opposite face still anchored). Without shift, grow.
            const growSign = e.shiftKey ? -1 : +1
            extrudeFace(id, dim, arrowDir, growSign)
          }
          return
        }
        // Build the world XZ delta from the arrow direction.
        let dx = 0, dz = 0
        if (e.key === 'ArrowLeft') dx = -step
        else if (e.key === 'ArrowRight') dx = step
        else if (e.key === 'ArrowUp') dz = -step
        else if (e.key === 'ArrowDown') dz = step

        // Apply the same delta to every selected node + its descendants.
        // Multi-arrow now moves the whole selection (was single-only). Arrow
        // also covers walls and lights via the per-type shift below.
        const ids = state.selectedIds.length > 0 ? state.selectedIds : [id]
        const toShift = new Set<string>()
        for (const sid of ids) {
          if (!arrowSupported(state.nodes[sid]?.type ?? '')) continue
          toShift.add(sid)
          for (const dId of getDescendantIds(state.nodes, sid)) toShift.add(dId)
        }

        for (const tid of toShift) {
          const tn = state.nodes[tid]
          if (!tn) continue
          if (tn.type === 'cabinet' || tn.type === 'countertop' || tn.type === 'custom-item' || tn.type === 'empty') {
            const [x, y, z] = tn.transform.position
            state.updateNode(tid, {
              transform: { ...tn.transform, position: [x + dx, y, z + dz] },
            } as any)
          } else if (tn.type === 'light') {
            const [x, y, z] = tn.position
            state.updateNode(tid, { position: [x + dx, y, z + dz] } as any)
          } else if (tn.type === 'wall') {
            state.updateNode(tid, {
              start: [tn.start[0] + dx, tn.start[1] + dz],
              end: [tn.end[0] + dx, tn.end[1] + dz],
            } as any)
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex flex-col h-screen w-screen">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <aside className="w-60 border-r border-neutral-800 bg-neutral-950 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 border-b border-neutral-800">
            <Outliner />
          </div>
          <div className="flex-1 min-h-0">
            <AssetLibrary />
          </div>
        </aside>

        <main className="flex-1 min-w-0 relative">
          {viewMode === '3d' && <Canvas3D />}
          {viewMode === '2d' && <Canvas2D />}
          {viewMode === 'split' && (
            <div ref={splitContainerRef} className="flex h-full w-full">
              <div style={{ width: `${splitRatio * 100}%` }} className="border-r border-neutral-800">
                <Canvas2D />
              </div>
              <div
                onPointerDown={onSplitDragStart}
                className="w-1.5 cursor-col-resize bg-neutral-800 hover:bg-neutral-600 transition-colors"
                title="Drag to resize"
              />
              <div style={{ width: `${(1 - splitRatio) * 100}%` }}>
                <Canvas3D />
              </div>
            </div>
          )}
          <ViewModeSwitcher />
        </main>

        <aside className="w-72 border-l border-neutral-800 bg-neutral-950">
          <Inspector />
        </aside>
      </div>
    </div>
  )
}
