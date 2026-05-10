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

export type TextureMeta = {
  id: string
  name: string
  mime: string
  sizeBytes: number
  createdAt: number
}

const blobKey = (id: string) => `kitchen-texture-blob:${id}`

type TexturesState = {
  textures: Record<string, TextureMeta>
  addTexture: (file: File) => Promise<TextureMeta>
  removeTexture: (id: string) => Promise<void>
  // Returns a fresh object URL for the texture blob — caller is responsible
  // for revoking it when done. Returns null if the texture isn't present.
  getTextureUrl: (id: string) => Promise<string | null>
}

let counter = 0
const makeTexId = () => `tex_${Date.now().toString(36)}_${(counter++).toString(36)}`

export const useTextures = create<TexturesState>()(
  persist(
    (set, get) => ({
      textures: {},

      addTexture: async (file) => {
        const id = makeTexId()
        await idbSet(blobKey(id), file)
        const meta: TextureMeta = {
          id,
          name: file.name,
          mime: file.type || 'image/png',
          sizeBytes: file.size,
          createdAt: Date.now(),
        }
        set((s) => ({ textures: { ...s.textures, [id]: meta } }))
        return meta
      },

      removeTexture: async (id) => {
        await idbDel(blobKey(id))
        set((s) => {
          const next = { ...s.textures }
          delete next[id]
          return { textures: next }
        })
      },

      getTextureUrl: async (id) => {
        // Read the blob directly from IDB without consulting state.textures.
        // The zustand persist middleware hydrates asynchronously, so on a
        // canvas remount (e.g. switching split → 3D view) the meta might not
        // be loaded yet even though the blob has been there since upload.
        // Doing a state-independent lookup means the texture re-appears
        // immediately on remount instead of waiting for hydration.
        const blob = (await idbGet(blobKey(id))) as Blob | undefined
        if (!blob) return null
        return URL.createObjectURL(blob)
      },
    }),
    {
      name: 'kitchen-textures',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ textures: s.textures } as unknown as TexturesState),
    },
  ),
)
