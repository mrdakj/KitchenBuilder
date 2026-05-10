'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useScene } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import { useAssets } from '@/core/store/use-assets'
import { emitter } from '@/core/events/emitter'
import { makeId } from '@/core/utils/id'
import { snap } from '@/core/utils/math'
import type {
  WallNode,
  CabinetNode,
  CountertopNode,
  CustomItemNode,
} from '@/core/schema'

const PX_PER_METER_DEFAULT = 60
const GRID_STEP = 0.1

export function Canvas2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ pxPerMeter: PX_PER_METER_DEFAULT, offsetX: 0, offsetY: 0 })
  const nodes = useScene((s) => s.nodes)
  const selectedId = useScene((s) => s.selectedId)
  const selectedIds = useScene((s) => s.selectedIds)
  const tool = useEditor((s) => s.tool)
  const wallDrawStart = useEditor((s) => s.wallDrawStart)
  const cabDefaults = useEditor((s) => s.cabinetDefaults)
  const showMeasurements = useEditor((s) => s.showMeasurements)
  const [hoverWorld, setHoverWorld] = useState<[number, number] | null>(null)

  const toWorld = useCallback(
    (sx: number, sy: number): [number, number] => {
      const rect = canvasRef.current!.getBoundingClientRect()
      const cx = rect.width / 2
      const cy = rect.height / 2
      const x = (sx - cx - view.offsetX) / view.pxPerMeter
      const z = (sy - cy - view.offsetY) / view.pxPerMeter
      return [snap(x, GRID_STEP), snap(z, GRID_STEP)]
    },
    [view],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    render(canvas, container, nodes, view, selectedId, wallDrawStart, hoverWorld, tool, cabDefaults, showMeasurements, selectedIds)
  }, [nodes, view, selectedId, selectedIds, wallDrawStart, hoverWorld, tool, cabDefaults, showMeasurements])

  // Live-redraw when the container resizes — the split-view divider mutates
  // the parent's flex width without firing a window 'resize', so a plain
  // window listener wasn't enough to keep the canvas crisp during the drag.
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ro = new ResizeObserver(() => {
      render(canvas, container, nodes, view, selectedId, wallDrawStart, hoverWorld, tool, cabDefaults, showMeasurements, selectedIds)
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [nodes, view, selectedId, selectedIds, wallDrawStart, hoverWorld, tool, cabDefaults, showMeasurements])

  // Drag-to-move for objects in the 2D plan. Picks the object's current
  // anchor (cabinet/countertop position; wall midpoint) at pointerdown, then
  // each pointermove translates by the cursor's world delta. Wall snap and
  // sticky kitchen snap aren't applied here — the 2D view is meant for
  // coarse layout adjustments. Snap on the gizmo / dbl-click handlers in
  // the 3D viewport remains the canonical fine-tune path.
  const startObjectDrag = (id: string, startWx: number, startWz: number) => {
    const sceneAtStart = useScene.getState().nodes[id]
    if (!sceneAtStart) return
    const anchorOf = (n: any): [number, number] | null => {
      if (n.type === 'cabinet' || n.type === 'countertop' || n.type === 'custom-item' || n.type === 'empty') {
        return [n.transform.position[0], n.transform.position[2]]
      }
      if (n.type === 'wall') return [(n.start[0] + n.end[0]) / 2, (n.start[1] + n.end[1]) / 2]
      if (n.type === 'light') return [n.position[0], n.position[2]]
      return null
    }
    const anchor = anchorOf(sceneAtStart)
    if (!anchor) return
    const offX = anchor[0] - startWx
    const offZ = anchor[1] - startWz
    let lastWx = startWx, lastWz = startWz
    const onMove = (ev: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const [wx, wz] = toWorld(ev.clientX - rect.left, ev.clientY - rect.top)
      if (wx === lastWx && wz === lastWz) return
      lastWx = wx
      lastWz = wz
      const tx = wx + offX
      const tz = wz + offZ
      const n = useScene.getState().nodes[id]
      if (!n) return
      if (n.type === 'cabinet' || n.type === 'countertop' || n.type === 'custom-item' || n.type === 'empty') {
        const [, py] = n.transform.position
        useScene.getState().updateNode(id, {
          transform: { ...n.transform, position: [tx, py, tz] },
        } as any)
      } else if (n.type === 'wall') {
        const cx = (n.start[0] + n.end[0]) / 2
        const cz = (n.start[1] + n.end[1]) / 2
        const dx = tx - cx
        const dz = tz - cz
        useScene.getState().updateNode(id, {
          start: [n.start[0] + dx, n.start[1] + dz],
          end: [n.end[0] + dx, n.end[1] + dz],
        } as any)
      } else if (n.type === 'light') {
        const [, py] = n.position
        useScene.getState().updateNode(id, { position: [tx, py, tz] } as any)
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Ctrl/Cmd-drag (or middle button) pans the 2D view — kept consistent
    // with the 3D viewport's modifier conventions. Alt is no longer used
    // here so it's free for future operator-style shortcuts.
    if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
      const start = { x: e.clientX, y: e.clientY, offX: view.offsetX, offY: view.offsetY }
      const onMove = (ev: PointerEvent) => {
        setView((v) => ({ ...v, offsetX: start.offX + (ev.clientX - start.x), offsetY: start.offY + (ev.clientY - start.y) }))
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      return
    }

    const rect = canvasRef.current!.getBoundingClientRect()
    const [wx, wz] = toWorld(e.clientX - rect.left, e.clientY - rect.top)

    if (tool === 'wall') {
      const start = wallDrawStart
      if (!start) {
        useEditor.getState().setWallDrawStart([wx, wz])
      } else if (start[0] === wx && start[1] === wz) {
        useEditor.getState().setWallDrawStart(null)
      } else {
        const state = useScene.getState()
        const id = makeId('wall')
        const node: WallNode = {
          id,
          type: 'wall',
          parentId: null,
          visible: true,
          start,
          end: [wx, wz],
          thickness: 0.1,
          height: 2.6,
          material: { color: '#cccccc', roughness: 0.9, metalness: 0 },
        }
        state.createNode(node)
        state.select(id)
        useEditor.getState().setWallDrawStart([wx, wz])
      }
      return
    }

    if (tool === 'cabinet') {
      const defaults = useEditor.getState().cabinetDefaults
      const state = useScene.getState()
      const id = makeId('cab')
      const node: CabinetNode = {
        id,
        type: 'cabinet',
        parentId: null,
        visible: true,
        transform: { position: [wx, defaults.style === 'wall' ? 1.4 : 0, wz], rotationY: 0 },
        style: defaults.style,
        width: defaults.width,
        height: defaults.height,
        depth: defaults.depth,
        doorKind: 'single',
        drawerCount: 3,
        stackedBelowId: null,
        carcassMaterial: { color: '#ffffff', roughness: 0.6, metalness: 0 },
        doorMaterial: { color: '#e5e5e5', roughness: 0.5, metalness: 0 },
        handleMaterial: { color: '#333333', roughness: 0.2, metalness: 0.8 },
      }
      state.createNode(node)
      state.select(id)
      return
    }

    if (tool === 'countertop') {
      const state = useScene.getState()
      const id = makeId('top')
      const node: CountertopNode = {
        id,
        type: 'countertop',
        parentId: null,
        visible: true,
        transform: { position: [wx, 0.88, wz], rotationY: 0 },
        width: 1.2,
        depth: 0.62,
        thickness: 0.04,
        material: { color: '#222222', roughness: 0.3, metalness: 0 },
      }
      state.createNode(node)
      state.select(id)
      return
    }

    if (tool === 'place-item') {
      const assetId = useEditor.getState().placingAssetId
      if (!assetId) return
      const asset = useAssets.getState().assets[assetId]
      if (!asset) return
      const state = useScene.getState()
      const id = makeId('item')
      const node: CustomItemNode = {
        id,
        type: 'custom-item',
        parentId: null,
        visible: true,
        assetId,
        transform: { position: [wx, 0, wz], rotationY: 0 },
        scale: [1, 1, 1],
        materialOverrides: {},
      }
      state.createNode(node)
      state.select(id)
      return
    }

    if (tool === 'select') {
      const hit = hitTest(wx, wz, nodes)
      useScene.getState().select(hit)
      if (hit) startObjectDrag(hit, wx, wz)
      return
    }

    emitter.emit('grid:click', { position: [wx, 0, wz], button: e.button })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const [wx, wz] = toWorld(e.clientX - rect.left, e.clientY - rect.top)
    setHoverWorld([wx, wz])
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setView((v) => ({ ...v, pxPerMeter: Math.max(10, Math.min(400, v.pxPerMeter * delta)) }))
  }

  const cursor = tool === 'wall' || tool === 'cabinet' || tool === 'countertop' || tool === 'place-item' ? 'crosshair' : 'default'

  return (
    <div ref={containerRef} className="relative w-full h-full bg-[#0f0f0f] select-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onWheel={onWheel}
      />
      <div className="absolute top-2 left-2 text-xs text-neutral-400 bg-neutral-900/80 px-2 py-1 rounded">
        2D plan — ctrl-drag to pan, wheel to zoom · {view.pxPerMeter.toFixed(0)} px/m
        {hoverWorld && ` · (${hoverWorld[0].toFixed(2)}, ${hoverWorld[1].toFixed(2)}) m`}
      </div>
    </div>
  )
}

function hitTest(wx: number, wz: number, nodes: Record<string, any>): string | null {
  for (const n of Object.values(nodes) as any[]) {
    if (!n.visible) continue
    if (n.type === 'cabinet') {
      const c = n as CabinetNode
      const cx = c.transform.position[0]
      const cz = c.transform.position[2]
      if (Math.abs(wx - cx) <= c.width / 2 && Math.abs(wz - cz) <= c.depth / 2) return c.id
    } else if (n.type === 'countertop') {
      const c = n as CountertopNode
      const cx = c.transform.position[0]
      const cz = c.transform.position[2]
      if (Math.abs(wx - cx) <= c.width / 2 && Math.abs(wz - cz) <= c.depth / 2) return c.id
    } else if (n.type === 'custom-item') {
      const c = n as CustomItemNode
      const cx = c.transform.position[0]
      const cz = c.transform.position[2]
      if (Math.hypot(wx - cx, wz - cz) < 0.25) return c.id
    } else if (n.type === 'wall') {
      const w = n as WallNode
      if (pointNearSegment([wx, wz], w.start, w.end, w.thickness / 2 + 0.05)) return w.id
    }
  }
  return null
}

function pointNearSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  tol: number,
) {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const apx = p[0] - a[0]
  const apy = p[1] - a[1]
  const l2 = abx * abx + aby * aby
  if (l2 === 0) return Math.hypot(apx, apy) <= tol
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / l2))
  const cx = a[0] + t * abx
  const cy = a[1] + t * aby
  return Math.hypot(p[0] - cx, p[1] - cy) <= tol
}

function render(
  canvas: HTMLCanvasElement,
  container: HTMLDivElement,
  nodes: Record<string, any>,
  view: { pxPerMeter: number; offsetX: number; offsetY: number },
  selectedId: string | null,
  wallStart: [number, number] | null,
  hoverWorld: [number, number] | null,
  tool: string,
  cabDefaults: { width: number; depth: number; style: 'base' | 'wall' | 'tall' },
  showMeasurements: boolean,
  selectedIds: string[],
) {
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== container.clientWidth * dpr || canvas.height !== container.clientHeight * dpr) {
    canvas.width = container.clientWidth * dpr
    canvas.height = container.clientHeight * dpr
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const W = container.clientWidth
  const H = container.clientHeight
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0f0f0f'
  ctx.fillRect(0, 0, W, H)

  const step = view.pxPerMeter
  const cx = W / 2 + view.offsetX
  const cy = H / 2 + view.offsetY
  ctx.strokeStyle = '#222'
  ctx.lineWidth = 1
  const startX = cx - Math.ceil(cx / step) * step
  const startY = cy - Math.ceil(cy / step) * step
  for (let x = startX; x < W; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  for (let y = startY; y < H; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
  ctx.strokeStyle = '#3a3a3a'
  ctx.beginPath()
  ctx.moveTo(cx, 0)
  ctx.lineTo(cx, H)
  ctx.moveTo(0, cy)
  ctx.lineTo(W, cy)
  ctx.stroke()

  const toS = (wx: number, wz: number) => ({ x: cx + wx * step, y: cy + wz * step })

  for (const n of Object.values(nodes) as any[]) {
    if (!n.visible) continue
    if (n.type !== 'wall') continue
    const w = n as WallNode
    const a = toS(w.start[0], w.start[1])
    const b = toS(w.end[0], w.end[1])
    ctx.strokeStyle = selectedId === w.id ? '#ffdd66' : '#e0e0e0'
    ctx.lineWidth = Math.max(2, w.thickness * step)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  for (const n of Object.values(nodes) as any[]) {
    if (!n.visible) continue
    if (n.type !== 'cabinet') continue
    const c = n as CabinetNode
    const s = toS(c.transform.position[0], c.transform.position[2])
    const w = c.width * step
    const d = c.depth * step
    ctx.save()
    ctx.translate(s.x, s.y)
    ctx.rotate(c.transform.rotationY)
    ctx.fillStyle = c.style === 'wall' ? 'rgba(120,180,255,0.25)' : 'rgba(255,255,255,0.15)'
    ctx.strokeStyle = selectedId === c.id ? '#ffdd66' : c.style === 'wall' ? '#7ab6ff' : '#fff'
    ctx.lineWidth = 1.5
    ctx.fillRect(-w / 2, -d / 2, w, d)
    ctx.strokeRect(-w / 2, -d / 2, w, d)
    ctx.beginPath()
    ctx.moveTo(-w / 2, d / 2)
    ctx.lineTo(w / 2, d / 2)
    ctx.strokeStyle = selectedId === c.id ? '#ffdd66' : '#888'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
  }

  for (const n of Object.values(nodes) as any[]) {
    if (!n.visible) continue
    if (n.type !== 'countertop') continue
    const c = n as CountertopNode
    const s = toS(c.transform.position[0], c.transform.position[2])
    const w = c.width * step
    const d = c.depth * step
    ctx.save()
    ctx.translate(s.x, s.y)
    ctx.rotate(c.transform.rotationY)
    ctx.strokeStyle = selectedId === c.id ? '#ffdd66' : '#55d'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 2])
    ctx.strokeRect(-w / 2, -d / 2, w, d)
    ctx.setLineDash([])
    ctx.restore()
  }

  for (const n of Object.values(nodes) as any[]) {
    if (!n.visible) continue
    if (n.type !== 'custom-item') continue
    const s = toS(n.transform.position[0], n.transform.position[2])
    ctx.fillStyle = selectedId === n.id ? '#ffdd66' : '#b98cff'
    ctx.beginPath()
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2)
    ctx.fill()
  }

  // placement ghost
  if (hoverWorld) {
    const hs = toS(hoverWorld[0], hoverWorld[1])
    ctx.fillStyle = '#ffdd66'
    ctx.beginPath()
    ctx.arc(hs.x, hs.y, 3, 0, Math.PI * 2)
    ctx.fill()

    if (tool === 'cabinet') {
      const w = cabDefaults.width * step
      const d = cabDefaults.depth * step
      ctx.strokeStyle = '#ffdd66'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.strokeRect(hs.x - w / 2, hs.y - d / 2, w, d)
      ctx.setLineDash([])
    } else if (tool === 'countertop') {
      const w = 1.2 * step
      const d = 0.62 * step
      ctx.strokeStyle = '#ffdd66'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.strokeRect(hs.x - w / 2, hs.y - d / 2, w, d)
      ctx.setLineDash([])
    } else if (tool === 'place-item') {
      ctx.strokeStyle = '#ffdd66'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.arc(hs.x, hs.y, 12, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  if (tool === 'wall' && wallStart && hoverWorld) {
    const a = toS(wallStart[0], wallStart[1])
    const b = toS(hoverWorld[0], hoverWorld[1])
    ctx.strokeStyle = '#ffdd66'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#ffdd66'
    ctx.beginPath()
    ctx.arc(a.x, a.y, 4, 0, Math.PI * 2)
    ctx.fill()
    // Live distance readout while drawing a wall.
    const dx = hoverWorld[0] - wallStart[0]
    const dz = hoverWorld[1] - wallStart[1]
    const len = Math.hypot(dx, dz)
    if (len > 0.01) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      drawLabel(ctx, mid.x, mid.y - 12, `${(len * 100).toFixed(1)} cm`)
    }
  }

  // Measurements overlay for selected nodes (toggle in toolbar).
  if (showMeasurements && selectedIds.length > 0) {
    ctx.fillStyle = '#ffdd66'
    for (const id of selectedIds) {
      const n = nodes[id]
      if (!n) continue
      let label = ''
      let labelPos: { x: number; y: number } | null = null
      if (n.type === 'wall') {
        const len = Math.hypot(n.end[0] - n.start[0], n.end[1] - n.start[1])
        const a = toS(n.start[0], n.start[1])
        const b = toS(n.end[0], n.end[1])
        labelPos = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12 }
        label = `${(len * 100).toFixed(1)} cm`
      } else if (n.type === 'cabinet' || n.type === 'countertop') {
        const s = toS(n.transform.position[0], n.transform.position[2])
        const w = n.type === 'cabinet' ? n.width : n.width
        const d = n.type === 'cabinet' ? n.depth : n.depth
        labelPos = { x: s.x, y: s.y }
        label = `${(w * 100).toFixed(0)}×${(d * 100).toFixed(0)} cm`
      } else if (n.type === 'custom-item') {
        const s = toS(n.transform.position[0], n.transform.position[2])
        const sx = (n.scale?.[0] ?? 1) * 0.5
        const sz = (n.scale?.[2] ?? 1) * 0.5
        labelPos = { x: s.x, y: s.y }
        label = `${(sx * 100).toFixed(0)}×${(sz * 100).toFixed(0)} cm`
      }
      if (labelPos && label) drawLabel(ctx, labelPos.x, labelPos.y, label)
    }
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.save()
  ctx.font = '11px ui-sans-serif, system-ui'
  const m = ctx.measureText(text)
  const padX = 4
  const padY = 2
  const w = m.width + padX * 2
  const h = 14
  ctx.fillStyle = 'rgba(20, 20, 20, 0.85)'
  ctx.strokeStyle = '#555'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.rect(x - w / 2, y - h / 2, w, h)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ffdd66'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(text, x, y + 1)
  void padY
  ctx.restore()
}
