'use client'

import { useRef } from 'react'
import { Upload, Trash2, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAssets, type AssetMeta } from '@/core/store/use-assets'
import { useEditor } from '@/core/store/use-editor'
import { makeId } from '@/core/utils/id'

export function AssetLibrary() {
  const assets = useAssets((s) => s.assets)
  const addAsset = useAssets((s) => s.addAsset)
  const addAssetFiles = useAssets((s) => s.addAssetFiles)
  const removeAsset = useAssets((s) => s.removeAsset)
  const placingAssetId = useEditor((s) => s.placingAssetId)
  const setPlacingAssetId = useEditor((s) => s.setPlacingAssetId)
  const setTool = useEditor((s) => s.setTool)
  const fileRef = useRef<HTMLInputElement>(null)
  const addToRef = useRef<HTMLInputElement>(null)
  const addToIdRef = useRef<string | null>(null)

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)

    const glb = list.find((f) => f.name.toLowerCase().endsWith('.glb'))
    const gltf = list.find((f) => f.name.toLowerCase().endsWith('.gltf'))
    const root = glb ?? gltf
    if (!root) {
      alert('Please include a .glb or .gltf file in your selection.')
      return
    }

    // All chosen files become part of this asset package (so .bin + textures travel with the .gltf).
    const companions = list
    const totalSize = companions.reduce((n, f) => n + f.size, 0)

    const meta: AssetMeta = {
      id: makeId('asset'),
      name: root.name.replace(/\.(glb|gltf)$/i, ''),
      kind: root.name.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf',
      sizeBytes: totalSize,
      createdAt: Date.now(),
      root: root.name,
      files: companions.map((f) => f.name),
    }
    await addAsset(meta, companions)

    if (fileRef.current) fileRef.current.value = ''
  }

  const onAddFiles = async (files: FileList | null) => {
    const id = addToIdRef.current
    addToIdRef.current = null
    if (addToRef.current) addToRef.current.value = ''
    if (!id || !files || files.length === 0) return
    await addAssetFiles(id, Array.from(files))
  }

  const list = Object.values(assets).sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-400">Assets</span>
        <button
          onClick={() => fileRef.current?.click()}
          className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1"
        >
          <Upload size={12} /> Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".glb,.gltf,.bin,image/*"
          multiple
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1">
        {list.length === 0 && (
          <div className="text-xs text-neutral-500 p-2">
            No assets yet. For a .gltf, select the .gltf + its .bin + any textures together. A single .glb works on its own.
          </div>
        )}
        {list.map((a) => (
          <div
            key={a.id}
            className={clsx(
              'group flex items-center justify-between px-2 py-1 rounded cursor-pointer',
              placingAssetId === a.id ? 'bg-amber-900/40 border border-amber-700' : 'hover:bg-neutral-800',
            )}
            onClick={() => {
              setPlacingAssetId(a.id)
              setTool('place-item')
            }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{a.name}</div>
              <div className="text-[10px] text-neutral-500">
                {(a.sizeBytes / 1024).toFixed(1)} KB · {a.kind.toUpperCase()} · {(a.files?.length ?? 0)} file
                {(a.files?.length ?? 0) === 1 ? '' : 's'}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                addToIdRef.current = a.id
                addToRef.current?.click()
              }}
              className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-amber-400 p-1"
              title="Add files (e.g. missing textures)"
            >
              <Plus size={12} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeAsset(a.id)
                if (placingAssetId === a.id) setPlacingAssetId(null)
              }}
              className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400 p-1"
              title="Remove"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <input
        ref={addToRef}
        type="file"
        accept=".bin,image/*"
        multiple
        hidden
        onChange={(e) => onAddFiles(e.target.files)}
      />
    </div>
  )
}
