'use client'

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Box, Minus, Square, Package, Eye, EyeOff, Trash2, ChevronRight, ChevronDown, Lightbulb, CircleDot } from 'lucide-react'
import { useScene } from '@/core/store/use-scene'
import type { AnyNode } from '@/core/schema'

const DRAG_MIME = 'application/x-kitchen-node-id'

function iconFor(type: AnyNode['type']) {
  switch (type) {
    case 'wall':
      return <Minus size={12} />
    case 'cabinet':
      return <Box size={12} />
    case 'countertop':
      return <Square size={12} />
    case 'custom-item':
      return <Package size={12} />
    case 'light':
      return <Lightbulb size={12} />
    case 'empty':
      return <CircleDot size={12} />
    default:
      return null
  }
}

function defaultName(n: AnyNode): string {
  if (n.name) return n.name
  switch (n.type) {
    case 'wall':
      return 'Wall'
    case 'cabinet':
      return `${n.style[0].toUpperCase()}${n.style.slice(1)} cabinet`
    case 'countertop':
      return 'Countertop'
    case 'custom-item': {
      // Use the predef catalog name for built-in assets so the outliner
      // shows "Sink" / "Stand Mixer" / "Fridge" instead of generic "Asset".
      const aid = (n as any).assetId as string | undefined
      if (aid === 'predef:sink') return 'Sink'
      if (aid === 'predef:mixer') return 'Stand Mixer'
      if (aid === 'predef:fridge') return 'Fridge'
      if (aid === 'predef:oven') return 'Oven'
      if (aid === 'predef:induction') return 'Induction Hob'
      return 'Asset'
    }
    case 'light':
      return 'Light'
    case 'empty':
      return 'Empty'
    case 'room':
      return 'Room'
    default:
      return 'Node'
  }
}

export function Outliner() {
  const nodes = useScene((s) => s.nodes)
  const rootNodeIds = useScene((s) => s.rootNodeIds)
  const selectedIds = useScene((s) => s.selectedIds)
  const select = useScene((s) => s.select)
  const toggleSelect = useScene((s) => s.toggleSelect)
  const updateNode = useScene((s) => s.updateNode)
  const deleteNode = useScene((s) => s.deleteNode)
  const setParent = useScene((s) => s.setParent)

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [rootDropActive, setRootDropActive] = useState(false)

  // Build child-of-id map once per nodes change so we can render a tree.
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, string[]>()
    for (const n of Object.values(nodes)) {
      const arr = map.get(n.parentId) ?? []
      arr.push(n.id)
      map.set(n.parentId, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const A = nodes[a]
        const B = nodes[b]
        return A.type.localeCompare(B.type) || a.localeCompare(b)
      })
    }
    return map
  }, [nodes])

  // Tree roots come from the store's rootNodeIds, but also include any node
  // whose parent isn't in the scene any more (defensive — orphan recovery).
  const rootIds = useMemo(() => {
    const set = new Set(rootNodeIds)
    for (const n of Object.values(nodes)) {
      if (n.parentId == null) set.add(n.id)
      else if (!nodes[n.parentId]) set.add(n.id)
    }
    return Array.from(set).filter((id) => nodes[id])
  }, [nodes, rootNodeIds])

  const onDragStart = (id: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, id)
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOverRow = (targetId: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetId(targetId)
  }

  const onDropRow = (targetId: string) => (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetId(null)
    const draggedId = e.dataTransfer.getData(DRAG_MIME)
    if (!draggedId || draggedId === targetId) return
    setParent(draggedId, targetId)
  }

  const onDragOverRoot = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setRootDropActive(true)
  }

  const onDropRoot = (e: React.DragEvent) => {
    e.preventDefault()
    setRootDropActive(false)
    const draggedId = e.dataTransfer.getData(DRAG_MIME)
    if (!draggedId) return
    setParent(draggedId, null)
  }

  const onDragLeaveRoot = () => setRootDropActive(false)

  const renderRow = (id: string, depth: number) => {
    const n = nodes[id]
    if (!n) return null
    const kids = childrenOf.get(id) ?? []
    const hasKids = kids.length > 0
    const isCollapsed = !!collapsed[id]
    const isSelected = selectedIds.includes(id)
    const isDropTarget = dropTargetId === id
    return (
      <div key={id}>
        <div
          draggable
          onDragStart={onDragStart(id)}
          onDragOver={onDragOverRow(id)}
          onDragLeave={() => setDropTargetId((cur) => (cur === id ? null : cur))}
          onDrop={onDropRow(id)}
          className={clsx(
            'group flex items-center gap-1 px-2 py-1 rounded text-sm cursor-pointer',
            isSelected ? 'bg-amber-900/40 text-amber-100' : 'hover:bg-neutral-800',
            isDropTarget && 'ring-1 ring-sky-400',
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={(e) => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSelect(n.id)
            else select(n.id)
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (hasKids) setCollapsed((c) => ({ ...c, [id]: !c[id] }))
            }}
            className={clsx('text-neutral-500 hover:text-white', !hasKids && 'invisible')}
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          <span className="text-neutral-400">{iconFor(n.type)}</span>
          <span className="flex-1 truncate">{defaultName(n)}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              updateNode(n.id, { visible: !n.visible })
            }}
            className="opacity-40 group-hover:opacity-100 hover:text-white"
            title={n.visible ? 'Hide' : 'Show'}
          >
            {n.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              deleteNode(n.id)
            }}
            className="opacity-0 group-hover:opacity-100 hover:text-red-400"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
        {hasKids && !isCollapsed && (
          <div>{kids.map((kid) => renderRow(kid, depth + 1))}</div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className={clsx(
          'px-3 py-2 border-b border-neutral-800 flex items-center justify-between',
          rootDropActive && 'bg-sky-900/30',
        )}
        onDragOver={onDragOverRoot}
        onDragLeave={onDragLeaveRoot}
        onDrop={onDropRoot}
        title="Drop here to unparent"
      >
        <span className="text-xs uppercase tracking-wide text-neutral-400">Outline</span>
        <span className="text-[10px] text-neutral-500">{Object.keys(nodes).length}</span>
      </div>
      <div
        className={clsx(
          'flex-1 overflow-auto p-1 space-y-0.5',
          rootDropActive && 'bg-sky-900/10',
        )}
        onDragOver={onDragOverRoot}
        onDragLeave={onDragLeaveRoot}
        onDrop={onDropRoot}
      >
        {rootIds.length === 0 && (
          <div className="text-xs text-neutral-500 p-2">Scene is empty.</div>
        )}
        {rootIds.map((id) => renderRow(id, 0))}
      </div>
    </div>
  )
}
