'use client'

import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'

const idbStorage: StateStorage = {
  getItem: async (key) => (await idbGet(key)) ?? null,
  setItem: async (key, value) => {
    await idbSet(key, value)
  },
  removeItem: async (key) => {
    await idbDel(key)
  },
}

export type AssetMeta = {
  id: string
  name: string
  kind: 'glb' | 'gltf'
  sizeBytes: number
  createdAt: number
  root: string
  files: string[]
}

export type LoadedAssetFiles = {
  rootUrl: string | null
  urls: Record<string, string>
}

type AssetsState = {
  assets: Record<string, AssetMeta>
  addAsset: (meta: AssetMeta, files: File[]) => Promise<void>
  // Append more files to an existing asset (e.g. textures uploaded after the
  // GLTF). Files with names already present in the asset overwrite the
  // existing blobs. Bumps `sizeBytes` to reflect the new total.
  addAssetFiles: (id: string, files: File[]) => Promise<void>
  removeAsset: (id: string) => Promise<void>
  getAssetFileUrls: (id: string) => Promise<LoadedAssetFiles>
}

const blobKey = (id: string, filename: string) => `kitchen-asset-blob:${id}:${filename}`

export const useAssets = create<AssetsState>()(
  persist(
    (set, get) => ({
      assets: {},

      addAsset: async (meta, files) => {
        for (const file of files) {
          await idbSet(blobKey(meta.id, file.name), file)
        }
        set((s) => ({ assets: { ...s.assets, [meta.id]: meta } }))
      },

      addAssetFiles: async (id, files) => {
        const existing = get().assets[id]
        if (!existing) return
        for (const file of files) {
          await idbSet(blobKey(id, file.name), file)
        }
        const newNames = files.map((f) => f.name)
        const merged = Array.from(new Set([...(existing.files ?? []), ...newNames]))
        const sizeAdded = files.reduce((n, f) => n + f.size, 0)
        set((s) => ({
          assets: {
            ...s.assets,
            [id]: { ...existing, files: merged, sizeBytes: existing.sizeBytes + sizeAdded },
          },
        }))
      },

      removeAsset: async (id) => {
        const meta = get().assets[id]
        if (meta) {
          for (const f of meta.files ?? []) {
            await idbDel(blobKey(id, f))
          }
        }
        set((s) => {
          const assets = { ...s.assets }
          delete assets[id]
          return { assets }
        })
      },

      getAssetFileUrls: async (id): Promise<LoadedAssetFiles> => {
        const meta = get().assets[id]
        if (!meta) return { rootUrl: null, urls: {} }
        const urls: Record<string, string> = {}
        const files = meta.files ?? [meta.root].filter(Boolean)
        for (const fname of files) {
          const blob = (await idbGet(blobKey(id, fname))) as Blob | undefined
          if (blob) urls[fname] = URL.createObjectURL(blob)
        }
        return { rootUrl: urls[meta.root] ?? null, urls }
      },
    }),
    {
      name: 'kitchen-assets',
      version: 2,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ assets: s.assets } as unknown as AssetsState),
      migrate: (persisted) => {
        const p = (persisted as { assets?: Record<string, Partial<AssetMeta>> }) ?? {}
        const assets: Record<string, AssetMeta> = {}
        for (const [id, a] of Object.entries(p.assets ?? {})) {
          if (!a) continue
          const root = a.root ?? (a.kind === 'glb' ? `${a.name}.glb` : `${a.name}.gltf`)
          const files = a.files ?? [root]
          assets[id] = {
            id: a.id ?? id,
            name: a.name ?? 'asset',
            kind: a.kind ?? 'glb',
            sizeBytes: a.sizeBytes ?? 0,
            createdAt: a.createdAt ?? Date.now(),
            root,
            files,
          }
        }
        return { assets } as unknown as AssetsState
      },
    },
  ),
)
