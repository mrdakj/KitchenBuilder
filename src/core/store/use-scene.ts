'use client'

import { create } from 'zustand'
import { temporal } from 'zundo'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { AnyNode } from '@/core/schema'
import { makeId } from '@/core/utils/id'

const PREFIX_FOR_TYPE: Record<string, string> = {
  wall: 'wall',
  cabinet: 'cab',
  countertop: 'top',
  'custom-item': 'item',
  light: 'light',
  room: 'room',
}

const DUP_OFFSET = 0.2 // meters — small XZ offset so the duplicate is visible

type SceneState = {
  nodes: Record<string, AnyNode>
  rootNodeIds: string[]
  dirtyNodes: Set<string>
  // Primary (last picked) selection — most existing code reads this. Stays
  // in sync with selectedIds[selectedIds.length - 1].
  selectedId: string | null
  // Full selection set for multi-select (delete-many, duplicate-many, etc.).
  selectedIds: string[]

  createNode: (node: AnyNode, parentId?: string | null) => void
  updateNode: (id: string, updates: Partial<AnyNode> & Record<string, unknown>) => void
  deleteNode: (id: string) => void
  // Multi-delete cascades to descendants — deleting a parent also removes
  // its children (sinks parented to the countertop go away with it).
  deleteNodes: (ids: string[]) => void
  // Replace the selection. `null` clears.
  select: (id: string | null) => void
  // Toggle a single id in/out of the selection (Shift-click semantics).
  toggleSelect: (id: string) => void
  // Replace selection with multiple ids.
  selectMany: (ids: string[]) => void
  // Clone the given nodes with new ids and a small position offset; the
  // resulting clones become the new selection. Returns the cloned ids.
  duplicateNodes: (ids: string[]) => string[]
  // Re-parent: set `childId.parentId = parentId`. `null` unparents (becomes
  // a root). Rejects cycles (refuses to set a node's parent to one of its
  // own descendants).
  setParent: (childId: string, parentId: string | null) => void
  markDirty: (id: string) => void
  clearDirty: (id: string) => void
  reset: () => void
}

// Returns all transitive descendants of `id` (children, grandchildren, …).
export function getDescendantIds(nodes: Record<string, AnyNode>, id: string): string[] {
  const out: string[] = []
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of Object.values(nodes)) {
      if (n.parentId === cur) {
        out.push(n.id)
        stack.push(n.id)
      }
    }
  }
  return out
}

// True when `candidateAncestor` is an ancestor of `nodeId`. Used to reject
// re-parenting that would create a cycle.
function isAncestorOf(
  nodes: Record<string, AnyNode>,
  candidateAncestor: string,
  nodeId: string,
): boolean {
  let cur: AnyNode | undefined = nodes[nodeId]
  while (cur?.parentId) {
    if (cur.parentId === candidateAncestor) return true
    cur = nodes[cur.parentId]
  }
  return false
}

const idbStorage: StateStorage = {
  getItem: async (key) => (await idbGet(key)) ?? null,
  setItem: async (key, value) => {
    await idbSet(key, value)
  },
  removeItem: async (key) => {
    await idbDel(key)
  },
}

export const useScene = create<SceneState>()(
  persist(
    temporal(
      (set, get) => ({
        nodes: {},
        rootNodeIds: [],
        dirtyNodes: new Set(),
        selectedId: null,
        selectedIds: [],

        createNode: (node, parentId = null) => {
          set((s) => {
            const nodes = { ...s.nodes, [node.id]: { ...node, parentId } as AnyNode }
            const rootNodeIds =
              parentId == null && !s.rootNodeIds.includes(node.id)
                ? [...s.rootNodeIds, node.id]
                : s.rootNodeIds
            const dirty = new Set(s.dirtyNodes)
            dirty.add(node.id)
            return { nodes, rootNodeIds, dirtyNodes: dirty }
          })
        },

        updateNode: (id, updates) => {
          set((s) => {
            const existing = s.nodes[id]
            if (!existing) return s
            const nodes = { ...s.nodes, [id]: { ...existing, ...updates } as AnyNode }
            const dirty = new Set(s.dirtyNodes)
            dirty.add(id)
            return { nodes, dirtyNodes: dirty }
          })
        },

        deleteNode: (id) => {
          set((s) => {
            const nodes = { ...s.nodes }
            delete nodes[id]
            const rootNodeIds = s.rootNodeIds.filter((r) => r !== id)
            const dirty = new Set(s.dirtyNodes)
            dirty.delete(id)
            const selectedIds = s.selectedIds.filter((sId) => sId !== id)
            const selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null
            return { nodes, rootNodeIds, dirtyNodes: dirty, selectedId, selectedIds }
          })
        },

        deleteNodes: (ids) => {
          set((s) => {
            if (ids.length === 0) return s
            // Cascade: collect each id's descendants too so deleting a parent
            // takes its children with it (sink parented to countertop is
            // removed when the countertop is deleted).
            const all = new Set<string>()
            for (const id of ids) {
              all.add(id)
              for (const d of getDescendantIds(s.nodes, id)) all.add(d)
            }
            const nodes = { ...s.nodes }
            const dirty = new Set(s.dirtyNodes)
            for (const id of all) {
              delete nodes[id]
              dirty.delete(id)
            }
            const rootNodeIds = s.rootNodeIds.filter((r) => !all.has(r))
            const selectedIds = s.selectedIds.filter((sId) => !all.has(sId))
            const selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null
            return { nodes, rootNodeIds, dirtyNodes: dirty, selectedId, selectedIds }
          })
        },

        select: (id) =>
          set({ selectedId: id, selectedIds: id ? [id] : [] }),

        toggleSelect: (id) => {
          set((s) => {
            const has = s.selectedIds.includes(id)
            const selectedIds = has
              ? s.selectedIds.filter((sId) => sId !== id)
              : [...s.selectedIds, id]
            const selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null
            return { selectedIds, selectedId }
          })
        },

        selectMany: (ids) =>
          set({ selectedIds: [...ids], selectedId: ids.length ? ids[ids.length - 1] : null }),

        duplicateNodes: (ids) => {
          const cloned: string[] = []
          set((s) => {
            const nodes = { ...s.nodes }
            const rootNodeIds = [...s.rootNodeIds]
            const dirty = new Set(s.dirtyNodes)
            for (const id of ids) {
              const orig = s.nodes[id]
              if (!orig) continue
              const newId = makeId(PREFIX_FOR_TYPE[orig.type] ?? orig.type)
              const copy: AnyNode = JSON.parse(JSON.stringify(orig))
              copy.id = newId
              // Offset position so the duplicate doesn't overlap the source.
              if ('transform' in copy && copy.transform) {
                const p = (copy as any).transform.position as [number, number, number]
                ;(copy as any).transform.position = [p[0] + DUP_OFFSET, p[1], p[2] + DUP_OFFSET]
              }
              if (copy.type === 'wall') {
                copy.start = [copy.start[0] + DUP_OFFSET, copy.start[1] + DUP_OFFSET]
                copy.end = [copy.end[0] + DUP_OFFSET, copy.end[1] + DUP_OFFSET]
              }
              if (copy.type === 'light') {
                copy.position = [copy.position[0] + DUP_OFFSET, copy.position[1], copy.position[2] + DUP_OFFSET]
              }
              nodes[newId] = copy
              if (orig.parentId == null) rootNodeIds.push(newId)
              dirty.add(newId)
              cloned.push(newId)
            }
            const selectedIds = [...cloned]
            const selectedId = cloned.length ? cloned[cloned.length - 1] : s.selectedId
            return { nodes, rootNodeIds, dirtyNodes: dirty, selectedIds, selectedId }
          })
          return cloned
        },

        setParent: (childId, parentId) => {
          set((s) => {
            if (childId === parentId) return s
            const child = s.nodes[childId]
            if (!child) return s
            // Reject cycles: parentId can't be a descendant of childId.
            if (parentId != null && (parentId === childId || isAncestorOf(s.nodes, childId, parentId))) {
              return s
            }
            if (child.parentId === parentId) return s
            const nodes = {
              ...s.nodes,
              [childId]: { ...child, parentId } as AnyNode,
            }
            // Maintain rootNodeIds: a node with parentId=null is a root.
            let rootNodeIds = s.rootNodeIds
            const isRoot = rootNodeIds.includes(childId)
            if (parentId == null && !isRoot) rootNodeIds = [...rootNodeIds, childId]
            else if (parentId != null && isRoot) rootNodeIds = rootNodeIds.filter((r) => r !== childId)
            const dirty = new Set(s.dirtyNodes)
            dirty.add(childId)
            return { nodes, rootNodeIds, dirtyNodes: dirty }
          })
        },

        markDirty: (id) => {
          const dirty = new Set(get().dirtyNodes)
          dirty.add(id)
          set({ dirtyNodes: dirty })
        },

        clearDirty: (id) => {
          const dirty = new Set(get().dirtyNodes)
          dirty.delete(id)
          set({ dirtyNodes: dirty })
        },

        reset: () => set({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set(), selectedId: null, selectedIds: [] }),
      }),
      {
        limit: 50,
        partialize: (s) => ({ nodes: s.nodes, rootNodeIds: s.rootNodeIds }),
        equality: (a, b) => a.nodes === b.nodes && a.rootNodeIds === b.rootNodeIds,
      },
    ),
    {
      name: 'kitchen-scene',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ nodes: s.nodes, rootNodeIds: s.rootNodeIds } as unknown as SceneState),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        state.dirtyNodes = new Set(Object.keys(state.nodes))
      },
    },
  ),
)
