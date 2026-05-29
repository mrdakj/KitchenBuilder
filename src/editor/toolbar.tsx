'use client'

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  MousePointer2,
  Square,
  Box,
  Minus,
  Upload,
  Undo2,
  Redo2,
  Trash2,
  Move3d,
  RotateCw,
  Maximize,
  Maximize2,
  Magnet,
  Droplet,
  Zap,
  Sun,
  Lightbulb,
  Copy,
  CircleDot,
  Ruler,
  Combine,
  Download,
  FolderOpen,
  Home,
  RotateCcw,
} from 'lucide-react'
import { useEditor, type Tool, type TransformMode, type SnapMode, type LightingPreset } from '@/core/store/use-editor'
import { useScene, getDescendantIds } from '@/core/store/use-scene'
import type { AnyNode, CabinetNode, CountertopNode, CustomItemNode, WallNode } from '@/core/schema'
import { makeId } from '@/core/utils/id'
import { PREDEFINED_ASSETS } from '@/core/assets/predefined'
import { extrudeFace, screenExtrudeToLocal } from '@/core/systems/extrude'

// Cabinet placement is handled by the variant menu (CabinetVariantMenu)
// rather than a standalone tool button — the variant picker also activates
// the 'cabinet' tool, so users only deal with one entry point.
const tools: { id: Tool; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select', hint: 'V', icon: <MousePointer2 size={16} /> },
  { id: 'wall', label: 'Wall', hint: 'B', icon: <Minus size={16} /> },
  { id: 'countertop', label: 'Countertop', hint: 'N', icon: <Square size={16} /> },
  { id: 'place-item', label: 'Place asset', hint: 'P', icon: <Upload size={16} /> },
  { id: 'light', label: 'Light', hint: 'L', icon: <Lightbulb size={16} /> },
  { id: 'empty', label: 'Empty', hint: 'E', icon: <CircleDot size={16} /> },
]

const transformModes: { id: TransformMode; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'translate', label: 'Move', hint: 'G', icon: <Move3d size={16} /> },
  { id: 'rotate', label: 'Rotate', hint: 'R', icon: <RotateCw size={16} /> },
  { id: 'scale', label: 'Scale', hint: 'S', icon: <Maximize size={16} /> },
]

const snapModes: { id: SnapMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Best of corner/edge/face/axis' },
  { id: 'corner', label: 'Pt', hint: 'Vertex / corner snap' },
  { id: 'edge', label: 'Edge', hint: 'Edge snap' },
  { id: 'face', label: 'Face', hint: 'Face snap' },
  { id: 'axis', label: 'Axis', hint: 'Per-axis face flush only' },
]

function SnapModePicker({ disabled }: { disabled: boolean }) {
  const snapMode = useEditor((s) => s.snapMode)
  const setSnapMode = useEditor((s) => s.setSnapMode)
  return (
    <div
      className={clsx(
        'flex rounded overflow-hidden border border-neutral-700',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      {snapModes.map((m) => (
        <button
          key={m.id}
          onClick={() => setSnapMode(m.id)}
          className={clsx(
            'px-2 py-1 text-[11px]',
            snapMode === m.id ? 'bg-neutral-700 text-white' : 'hover:bg-neutral-800',
          )}
          title={m.hint}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

function PredefinedAssetMenu({
  category,
  label,
  icon,
}: {
  category: 'sink' | 'electric'
  label: string
  icon: React.ReactNode
}) {
  const setPlacingAssetId = useEditor((s) => s.setPlacingAssetId)
  const setTool = useEditor((s) => s.setTool)
  const placingAssetId = useEditor((s) => s.placingAssetId)
  const items = PREDEFINED_ASSETS.filter((a) => a.category === category)
  const isActive = items.some((a) => a.id === placingAssetId)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (items.length === 1) {
    const only = items[0]
    return (
      <button
        onClick={() => {
          setPlacingAssetId(only.id)
          setTool('place-item')
        }}
        className={clsx(
          'px-2 py-1 rounded flex items-center gap-1 hover:bg-neutral-800',
          isActive && 'bg-neutral-700 text-white',
        )}
        title={only.name}
      >
        {icon}
        <span className="hidden md:inline">{label}</span>
      </button>
    )
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'px-2 py-1 rounded flex items-center gap-1 hover:bg-neutral-800',
          (isActive || open) && 'bg-neutral-700 text-white',
        )}
      >
        {icon}
        <span className="hidden md:inline">{label}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 flex flex-col bg-neutral-900 border border-neutral-700 rounded shadow-lg z-50 min-w-[140px]">
          {items.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setPlacingAssetId(a.id)
                setTool('place-item')
                setOpen(false)
              }}
              className={clsx(
                'px-3 py-1 text-xs text-left hover:bg-neutral-800',
                placingAssetId === a.id && 'bg-neutral-700 text-white',
              )}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const LIGHTING_OPTIONS: { id: LightingPreset; label: string }[] = [
  { id: 'apartment', label: 'Apartment' },
  { id: 'studio', label: 'Studio' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'night', label: 'Night' },
]

function LightingPicker() {
  const lightingPreset = useEditor((s) => s.lightingPreset)
  const setLightingPreset = useEditor((s) => s.setLightingPreset)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = LIGHTING_OPTIONS.find((o) => o.id === lightingPreset)
  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'px-2 py-1 rounded flex items-center gap-1 hover:bg-neutral-800',
          open && 'bg-neutral-700 text-white',
        )}
        title={`Lighting: ${current?.label ?? lightingPreset}`}
      >
        <Sun size={16} />
        <span className="hidden md:inline text-xs">{current?.label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 flex flex-col bg-neutral-900 border border-neutral-700 rounded shadow-lg z-50 min-w-[120px]">
          {LIGHTING_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                setLightingPreset(o.id)
                setOpen(false)
              }}
              className={clsx(
                'px-3 py-1 text-xs text-left hover:bg-neutral-800',
                lightingPreset === o.id && 'bg-neutral-700 text-white',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Inline SVG front-elevation thumbnail of a cabinet variant. Renders the
// rectangle scaled to its width:height aspect plus simple glyphs for the
// door kind (vertical splits + knobs, horizontal drawer strips). Style
// drives the fill colour so base/wall/tall are visually distinguishable
// at a glance.
function CabinetPreview({
  width,
  height,
  style,
  doorKind,
  drawerCount,
}: {
  width: number
  height: number
  style: 'base' | 'wall' | 'tall'
  doorKind: 'none' | 'single' | 'double' | 'drawers'
  drawerCount?: number
}) {
  const SIZE = 32
  const maxDim = Math.max(width, height)
  const drawW = (width / maxDim) * (SIZE - 4)
  const drawH = (height / maxDim) * (SIZE - 4)
  const ox = (SIZE - drawW) / 2
  const oy = (SIZE - drawH) / 2
  const stroke = '#9aa0a6'
  const fill = style === 'wall' ? '#1f3344' : style === 'tall' ? '#2c2538' : '#262626'
  const knob = '#b0b0b0'
  const n = doorKind === 'drawers' ? Math.max(1, drawerCount ?? 3) : 0
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0">
      <rect x={ox} y={oy} width={drawW} height={drawH} fill={fill} stroke={stroke} strokeWidth={1} rx={1} />
      {doorKind === 'single' && (
        <>
          <line x1={ox + drawW * 0.6} y1={oy + 1} x2={ox + drawW * 0.6} y2={oy + drawH - 1} stroke={stroke} strokeWidth={0.5} />
          <circle cx={ox + drawW * 0.55} cy={oy + drawH / 2} r={1} fill={knob} />
        </>
      )}
      {doorKind === 'double' && (
        <>
          <line x1={ox + drawW / 2} y1={oy + 1} x2={ox + drawW / 2} y2={oy + drawH - 1} stroke={stroke} strokeWidth={0.5} />
          <circle cx={ox + drawW * 0.42} cy={oy + drawH / 2} r={1} fill={knob} />
          <circle cx={ox + drawW * 0.58} cy={oy + drawH / 2} r={1} fill={knob} />
        </>
      )}
      {doorKind === 'drawers' && Array.from({ length: n }).map((_, i) => {
        const yLine = oy + ((i + 1) / n) * drawH
        const yKnob = oy + ((i + 0.5) / n) * drawH
        return (
          <g key={i}>
            {i < n - 1 && (
              <line x1={ox + 1} y1={yLine} x2={ox + drawW - 1} y2={yLine} stroke={stroke} strokeWidth={0.5} />
            )}
            <circle cx={ox + drawW / 2} cy={yKnob} r={1} fill={knob} />
          </g>
        )
      })}
    </svg>
  )
}

function CabinetVariantMenu() {
  const cabDefaults = useEditor((s) => s.cabinetDefaults)
  const setCab = useEditor((s) => s.setCabinetDefaults)
  const setTool = useEditor((s) => s.setTool)
  const tool = useEditor((s) => s.tool)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Curated set of cabinet variants — picks set the placement defaults and
  // switch to the cabinet placement tool so the next click drops the chosen
  // variant.
  type Variant = {
    label: string
    style: 'base' | 'wall' | 'tall'
    width: number
    height: number
    depth: number
    doorKind: 'none' | 'single' | 'double' | 'drawers'
    drawerCount?: number
  }
  const variants: Variant[] = [
    { label: 'Base · single door',    style: 'base', width: 0.60, height: 0.85, depth: 0.60, doorKind: 'single' },
    { label: 'Base · double door',    style: 'base', width: 0.90, height: 0.85, depth: 0.60, doorKind: 'double' },
    { label: 'Base · drawers (3)',    style: 'base', width: 0.60, height: 0.85, depth: 0.60, doorKind: 'drawers', drawerCount: 3 },
    { label: 'Base · drawers (4)',    style: 'base', width: 0.60, height: 0.85, depth: 0.60, doorKind: 'drawers', drawerCount: 4 },
    { label: 'Base · open (no door)', style: 'base', width: 0.60, height: 0.85, depth: 0.60, doorKind: 'none' },
    { label: 'Wall · single door',    style: 'wall', width: 0.60, height: 0.70, depth: 0.35, doorKind: 'single' },
    { label: 'Wall · double door',    style: 'wall', width: 0.80, height: 0.70, depth: 0.35, doorKind: 'double' },
    { label: 'Tall · double door',    style: 'tall', width: 0.60, height: 2.10, depth: 0.60, doorKind: 'double' },
    { label: 'Tall · open (oven slot)', style: 'tall', width: 0.60, height: 2.10, depth: 0.60, doorKind: 'none' },
  ]

  const isCab = tool === 'cabinet'

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'px-2 py-1 rounded flex items-center gap-1 hover:bg-neutral-800 text-xs',
          (isCab || open) && 'bg-neutral-700 text-white',
        )}
        title="Cabinet variants"
      >
        <Box size={14} />
        <span className="hidden md:inline">{cabDefaults.style[0].toUpperCase()}{cabDefaults.style.slice(1)} · {cabDefaults.doorKind}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 flex flex-col bg-neutral-900 border border-neutral-700 rounded shadow-lg z-50 min-w-[240px]">
          {variants.map((v) => (
            <button
              key={v.label}
              onClick={() => {
                setCab({
                  style: v.style,
                  width: v.width,
                  height: v.height,
                  depth: v.depth,
                  doorKind: v.doorKind,
                  drawerCount: v.drawerCount ?? 3,
                })
                setTool('cabinet')
                setOpen(false)
              }}
              className="px-2 py-1 text-xs text-left hover:bg-neutral-800 flex items-center gap-2"
            >
              <CabinetPreview
                width={v.width}
                height={v.height}
                style={v.style}
                doorKind={v.doorKind}
                drawerCount={v.drawerCount}
              />
              <span>{v.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Wipes the scene after a confirmation prompt. Undoable through the
// temporal store, so an accidental click is recoverable with Ctrl+Z.
function clearScene() {
  const count = Object.keys(useScene.getState().nodes).length
  if (count === 0) return
  if (!window.confirm(`Clear all ${count} objects from the scene?`)) return
  useScene.getState().reset()
}

// One-click 4 × 3 m closed room — quick scaffolding so users don't have to
// click out a rectangle of 4 walls by hand. Created at the world origin;
// users can move/scale individual walls afterwards.
function addRoom() {
  const W = 4
  const D = 3
  const height = 2.6
  const thickness = 0.1
  const corners: [number, number][] = [
    [-W / 2, -D / 2],
    [W / 2, -D / 2],
    [W / 2, D / 2],
    [-W / 2, D / 2],
  ]
  for (let i = 0; i < 4; i++) {
    const id = makeId('wall')
    const wall: WallNode = {
      id,
      type: 'wall',
      parentId: null,
      visible: true,
      start: corners[i],
      end: corners[(i + 1) % 4],
      thickness,
      height,
      material: { color: '#dddddd', roughness: 0.9, metalness: 0 },
    }
    useScene.getState().createNode(wall)
  }
}

// Export the current scene to a JSON file the user can download. Just the
// authoritative scene data — selection state is intentionally dropped.
function exportScene() {
  const s = useScene.getState()
  const data = {
    version: 1,
    nodes: s.nodes,
    rootNodeIds: s.rootNodeIds,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kitchen-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Replace the current scene with the contents of a saved JSON file.
async function importScene(file: File) {
  try {
    const text = await file.text()
    const data = JSON.parse(text) as { nodes?: Record<string, AnyNode>; rootNodeIds?: string[] }
    if (!data.nodes || !data.rootNodeIds) throw new Error('Invalid scene file')
    useScene.setState({
      nodes: data.nodes,
      rootNodeIds: data.rootNodeIds,
      dirtyNodes: new Set(Object.keys(data.nodes)),
      selectedId: null,
      selectedIds: [],
    })
  } catch (e) {
    alert(`Failed to load scene: ${(e as Error).message}`)
  }
}

function ImportButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        className="px-2 py-1 rounded hover:bg-neutral-800 flex items-center gap-1"
        title="Open scene from JSON file"
      >
        <FolderOpen size={16} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importScene(f)
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </>
  )
}

function ExtrudeMenu() {
  // 4-way directional pad for face extrude. Mirrors Alt+Arrow on the keyboard:
  // each button grows the face in its direction by one snap step (Shift-click
  // shrinks). Disabled unless a cabinet or countertop is selected — those are
  // the only types whose dimensions are parametric.
  const selectedId = useScene((s) => s.selectedId)
  const nodeType = useScene((s) => (selectedId ? s.nodes[selectedId]?.type : undefined))
  const supported = nodeType === 'cabinet' || nodeType === 'countertop'
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Buttons map screen-space directions (↑ = world -Z, ↓ = +Z, ← = -X, → = +X)
  // to the cabinet's local extrude axis based on its current rotation, so a
  // rotated cabinet still extrudes the face the user sees on screen.
  const fire = (screenDx: number, screenDz: number, growSign: 1 | -1) => {
    if (!selectedId) return
    const node = useScene.getState().nodes[selectedId]
    if (!node || (node.type !== 'cabinet' && node.type !== 'countertop')) return
    const { dim, arrowDir } = screenExtrudeToLocal(node.transform.rotationY, screenDx, screenDz)
    extrudeFace(selectedId, dim, arrowDir, growSign)
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        disabled={!supported}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'px-2 py-1 rounded hover:bg-neutral-800 disabled:opacity-30',
          open && 'bg-neutral-700 text-white',
        )}
        title="Extrude one face by one snap step (Alt+Arrow on keyboard)"
      >
        <Maximize2 size={16} />
      </button>
      {open && supported && (
        <div className="absolute left-0 top-full mt-1 flex flex-col gap-2 bg-neutral-900 border border-neutral-700 rounded shadow-lg z-[100] p-2 w-[140px]">
          <div>
            <div className="text-[10px] text-neutral-400 mb-1 select-none">Extrude (grow)</div>
            <div className="grid grid-cols-3 gap-1">
              <div />
              <button
                onClick={() => fire(0, -1, +1)}
                className="px-2 py-1 rounded hover:bg-neutral-800 text-xs"
                title="Extrude back face (Alt+ArrowUp)"
              >↑</button>
              <div />
              <button
                onClick={() => fire(-1, 0, +1)}
                className="px-2 py-1 rounded hover:bg-neutral-800 text-xs"
                title="Extrude left face (Alt+ArrowLeft)"
              >←</button>
              <div />
              <button
                onClick={() => fire(+1, 0, +1)}
                className="px-2 py-1 rounded hover:bg-neutral-800 text-xs"
                title="Extrude right face (Alt+ArrowRight)"
              >→</button>
              <div />
              <button
                onClick={() => fire(0, +1, +1)}
                className="px-2 py-1 rounded hover:bg-neutral-800 text-xs"
                title="Extrude front face (Alt+ArrowDown)"
              >↓</button>
              <div />
            </div>
          </div>
          <div>
            <div className="text-[10px] text-neutral-400 mb-1 select-none">Unextrude (shrink)</div>
            <div className="grid grid-cols-3 gap-1">
              <div />
              <button
                onClick={() => fire(0, -1, -1)}
                className="px-2 py-1 rounded hover:bg-amber-900/40 text-xs"
                title="Pull back face inward (Alt+Shift+ArrowUp)"
              >↑</button>
              <div />
              <button
                onClick={() => fire(-1, 0, -1)}
                className="px-2 py-1 rounded hover:bg-amber-900/40 text-xs"
                title="Pull left face inward (Alt+Shift+ArrowLeft)"
              >←</button>
              <div />
              <button
                onClick={() => fire(+1, 0, -1)}
                className="px-2 py-1 rounded hover:bg-amber-900/40 text-xs"
                title="Pull right face inward (Alt+Shift+ArrowRight)"
              >→</button>
              <div />
              <button
                onClick={() => fire(0, +1, -1)}
                className="px-2 py-1 rounded hover:bg-amber-900/40 text-xs"
                title="Pull front face inward (Alt+Shift+ArrowDown)"
              >↓</button>
              <div />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MergeButton() {
  // Enable when 2+ nodes of any kind are selected. Clicking groups them
  // under a "Group" empty; the click handler will then treat any of them
  // as the same logical object.
  const count = useScene((s) => s.selectedIds.length)
  return (
    <button
      disabled={count < 2}
      onClick={groupSelected}
      className="px-2 py-1 rounded hover:bg-neutral-800 flex items-center gap-1 disabled:opacity-30"
      title={`Merge ${count} selected objects into one (parented to a group)`}
    >
      <Combine size={16} />
    </button>
  )
}

function MeasurementsToggle() {
  const show = useEditor((s) => s.showMeasurements)
  const set = useEditor((s) => s.setShowMeasurements)
  return (
    <button
      onClick={() => set(!show)}
      className={clsx(
        'px-2 py-1 rounded flex items-center gap-1 hover:bg-neutral-800',
        show && 'bg-amber-700/50 text-amber-100',
      )}
      title="Show dimensions for selected objects"
    >
      <Ruler size={16} />
      <span className="hidden md:inline">Dim</span>
    </button>
  )
}

// Group the currently selected nodes under a single "Group" empty so they
// behave like one logical object: clicking any member selects the group,
// translating moves them together, deleting cascade-removes them all. The
// empty is created at the centroid of the selection's anchor points and
// each selected node is reparented to it. Marked `name: 'Group'` so the
// click handler knows to walk up to the group rather than select a leaf.
function groupSelected() {
  const scene = useScene.getState()
  const ids = [...scene.selectedIds]
  if (ids.length < 2) return

  const anchorOf = (n: AnyNode): [number, number, number] | null => {
    if (n.type === 'cabinet' || n.type === 'countertop' || n.type === 'custom-item' || n.type === 'empty') {
      return n.transform.position
    }
    if (n.type === 'wall') return [(n.start[0] + n.end[0]) / 2, 0, (n.start[1] + n.end[1]) / 2]
    if (n.type === 'light') return n.position
    return null
  }

  let cx = 0, cy = 0, cz = 0
  let count = 0
  for (const id of ids) {
    const n = scene.nodes[id]
    if (!n) continue
    const a = anchorOf(n as AnyNode)
    if (!a) continue
    cx += a[0]; cy += a[1]; cz += a[2]; count++
  }
  if (count === 0) return
  cx /= count; cy /= count; cz /= count

  const emptyId = makeId('empty')
  const empty = {
    id: emptyId,
    type: 'empty' as const,
    parentId: null as string | null,
    visible: true,
    name: 'Group',
    transform: { position: [cx, cy, cz] as [number, number, number], rotationY: 0 },
  }
  useScene.getState().createNode(empty as any)
  for (const id of ids) {
    if (id !== emptyId) useScene.getState().setParent(id, emptyId)
  }
  useScene.getState().select(emptyId)
}

export function rotateSelected90() {
  const state = useScene.getState()
  const ids = state.selectedIds.length > 0 ? state.selectedIds : (state.selectedId ? [state.selectedId] : [])
  if (ids.length === 0) return

  const anchorOf = (n: AnyNode): [number, number, number] | null => {
    if (n.type === 'cabinet' || n.type === 'countertop' || n.type === 'custom-item' || n.type === 'empty') {
      return n.transform.position
    }
    if (n.type === 'wall') return [(n.start[0] + n.end[0]) / 2, 0, (n.start[1] + n.end[1]) / 2]
    if (n.type === 'light') return n.position
    return null
  }

  // Single-selection path: rotate in place around the node's own centre.
  if (ids.length === 1) {
    const id = ids[0]
    const node = state.nodes[id]
    if (!node) return
    if (node.type === 'wall') {
      const w = node as WallNode
      const cx = (w.start[0] + w.end[0]) / 2
      const cz = (w.start[1] + w.end[1]) / 2
      const rotXZ = (x: number, z: number): [number, number] => [
        cx - (z - cz),
        cz + (x - cx),
      ]
      state.updateNode(id, {
        start: rotXZ(w.start[0], w.start[1]),
        end: rotXZ(w.end[0], w.end[1]),
      } as Partial<WallNode>)
      return
    }
    if (node.type !== 'cabinet' && node.type !== 'countertop' && node.type !== 'custom-item') return
    const n = node as CabinetNode | CountertopNode | CustomItemNode
    const newY = n.transform.rotationY + Math.PI / 2
    state.updateNode(id, { transform: { ...n.transform, rotationY: newY } } as Partial<typeof n>)
    return
  }

  // Multi-selection: rotate every selected node 90° around the selection
  // centroid. Cabinets/countertops/items get their own rotationY bumped AND
  // their position revolves; walls re-orient by rotating both endpoints;
  // lights have no rotation but their position revolves; descendants follow
  // (so a grouped object rotates as a unit).
  let cx = 0, cz = 0, count = 0
  for (const id of ids) {
    const n = state.nodes[id]
    if (!n) continue
    const a = anchorOf(n as AnyNode)
    if (!a) continue
    cx += a[0]; cz += a[2]; count++
  }
  if (count === 0) return
  cx /= count; cz /= count
  const rotXZ = (x: number, z: number): [number, number] => [
    cx - (z - cz),
    cz + (x - cx),
  ]

  const toRotate = new Set<string>()
  for (const id of ids) {
    toRotate.add(id)
    for (const d of getDescendantIds(state.nodes, id)) toRotate.add(d)
  }
  for (const id of toRotate) {
    const n = state.nodes[id]
    if (!n) continue
    if (n.type === 'cabinet' || n.type === 'countertop' || n.type === 'custom-item' || n.type === 'empty') {
      const [px, py, pz] = n.transform.position
      const [nx, nz] = rotXZ(px, pz)
      state.updateNode(id, {
        transform: { position: [nx, py, nz], rotationY: n.transform.rotationY + Math.PI / 2 },
      } as any)
    } else if (n.type === 'wall') {
      const [s0, s1] = rotXZ(n.start[0], n.start[1])
      const [e0, e1] = rotXZ(n.end[0], n.end[1])
      state.updateNode(id, { start: [s0, s1], end: [e0, e1] } as any)
    } else if (n.type === 'light') {
      const [px, py, pz] = n.position
      const [nx, nz] = rotXZ(px, pz)
      state.updateNode(id, { position: [nx, py, nz] } as any)
    }
  }
}

export function Toolbar() {
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const transformMode = useEditor((s) => s.transformMode)
  const setTransformMode = useEditor((s) => s.setTransformMode)
  const snapEnabled = useEditor((s) => s.snapEnabled)
  const setSnapEnabled = useEditor((s) => s.setSnapEnabled)
  const snapStep = useEditor((s) => s.snapStep)
  const selectedId = useScene((s) => s.selectedId)
  const selectedIds = useScene((s) => s.selectedIds)
  const deleteNodes = useScene((s) => s.deleteNodes)
  const duplicateNodes = useScene((s) => s.duplicateNodes)

  const undo = () => useScene.temporal.getState().undo()
  const redo = () => useScene.temporal.getState().redo()

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1 bg-neutral-900 border-b border-neutral-800 text-sm">
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          className={clsx(
            'px-2 py-1 rounded flex items-center gap-1 hover:bg-neutral-800',
            tool === t.id && 'bg-neutral-700 text-white',
          )}
          title={`${t.label} (${t.hint})`}
        >
          {t.icon}
          <span className="hidden md:inline">{t.label}</span>
        </button>
      ))}

      <button
        onClick={addRoom}
        className="px-2 py-1 rounded flex items-center gap-1 hover:bg-neutral-800"
        title="Add a 4 × 3 m room (4 walls)"
      >
        <Home size={16} />
        <span className="hidden md:inline">Room</span>
      </button>
      <CabinetVariantMenu />
      <PredefinedAssetMenu category="sink" label="Sink" icon={<Droplet size={16} />} />
      <PredefinedAssetMenu category="electric" label="Electric" icon={<Zap size={16} />} />

      <div className="w-px h-5 bg-neutral-700 mx-1" />

      {transformModes.map((m) => (
        <button
          key={m.id}
          onClick={() => setTransformMode(m.id)}
          className={clsx(
            'px-2 py-1 rounded flex items-center gap-1 hover:bg-neutral-800',
            transformMode === m.id && tool === 'select' && 'bg-neutral-700 text-white',
          )}
          title={`${m.label} (${m.hint})`}
        >
          {m.icon}
        </button>
      ))}

      <button
        disabled={!selectedId}
        onClick={rotateSelected90}
        className="px-2 py-1 rounded hover:bg-neutral-800 disabled:opacity-30"
        title="Rotate 90° (Q)"
      >
        <RotateCw size={16} />
        <span className="hidden md:inline ml-1 text-[10px]">90°</span>
      </button>

      <ExtrudeMenu />

      <div className="w-px h-5 bg-neutral-700 mx-1" />

      <button
        onClick={() => setSnapEnabled(!snapEnabled)}
        className={clsx(
          'px-2 py-1 rounded flex items-center gap-1 hover:bg-neutral-800',
          snapEnabled && 'bg-amber-700/50 text-amber-100',
        )}
        title={`Snap (X) — ${snapStep * 100} cm / 90°`}
      >
        <Magnet size={16} />
        <span className="hidden md:inline">Snap</span>
      </button>

      <MeasurementsToggle />

      <div className="w-px h-5 bg-neutral-700 mx-1" />

      <button onClick={undo} className="px-2 py-1 rounded hover:bg-neutral-800" title="Undo (Ctrl+Z)">
        <Undo2 size={16} />
      </button>
      <button onClick={redo} className="px-2 py-1 rounded hover:bg-neutral-800" title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={16} />
      </button>
      <button
        onClick={exportScene}
        className="px-2 py-1 rounded hover:bg-neutral-800"
        title="Save scene to JSON file"
      >
        <Download size={16} />
      </button>
      <ImportButton />
      <button
        onClick={clearScene}
        className="px-2 py-1 rounded hover:bg-red-900 text-neutral-400 hover:text-red-300"
        title="Clear all objects from the scene"
      >
        <RotateCcw size={16} />
      </button>
      <button
        disabled={selectedIds.length === 0}
        onClick={() => duplicateNodes(selectedIds)}
        className="px-2 py-1 rounded hover:bg-neutral-800 flex items-center gap-1 disabled:opacity-30"
        title={`Duplicate (Ctrl/Cmd+D) — ${selectedIds.length} selected`}
      >
        <Copy size={16} />
      </button>
      <MergeButton />
      <button
        disabled={selectedIds.length === 0}
        onClick={() => deleteNodes(selectedIds)}
        className="px-2 py-1 rounded hover:bg-red-900 flex items-center gap-1 disabled:opacity-30"
        title={`Delete (Del) — ${selectedIds.length} selected`}
      >
        <Trash2 size={16} />
      </button>

      <div className="flex-1" />

      <LightingPicker />

      <div className="flex rounded overflow-hidden border border-neutral-700">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <button
            key={axis}
            onClick={() => useEditor.getState().setCameraView(axis)}
            className="px-2 py-1 text-xs hover:bg-neutral-800"
            title={`Ortho view along ${axis.toUpperCase()} axis`}
          >
            {axis.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() => useEditor.getState().setCameraView('free')}
          className="px-2 py-1 text-xs hover:bg-neutral-800"
          title="Reset to default perspective view"
        >
          P
        </button>
      </div>

    </div>
  )
}

// Floating view-mode switcher rendered as an overlay over the main viewport
// (top-right corner). Pulled OUT of the toolbar because the toolbar's
// flex-wrap layout could push the buttons onto a wrapped row that was
// hard to see. As an absolute overlay it's always visible regardless of
// toolbar width.
export function ViewModeSwitcher() {
  const viewMode = useEditor((s) => s.viewMode)
  const setViewMode = useEditor((s) => s.setViewMode)
  return (
    <div className="absolute top-2 right-2 z-30 flex rounded overflow-hidden border border-neutral-600 shadow-lg bg-neutral-900/80 backdrop-blur">
      {(['2d', 'split', '3d'] as const).map((m) => (
        <button
          key={m}
          onClick={() => setViewMode(m)}
          className={clsx(
            'px-3 py-1.5 text-xs font-semibold tracking-wide',
            viewMode === m
              ? 'bg-amber-600 text-white'
              : 'bg-neutral-800/70 text-neutral-200 hover:bg-neutral-700',
          )}
        >
          {m.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
