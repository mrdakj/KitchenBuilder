'use client'

import { useEffect, useRef, useState } from 'react'
import { useScene } from '@/core/store/use-scene'
import { useTextures } from '@/core/store/use-textures'
import type { AnyNode, CabinetNode, CountertopNode, CustomItemNode, EmptyNode, LightNode, WallNode, MaterialRef } from '@/core/schema'
import { PREDEFINED_MATERIALS, applyMaterialPreset } from '@/core/assets/predefined-materials'

export function Inspector() {
  const node = useScene((s) => (s.selectedId ? s.nodes[s.selectedId] : null))

  if (!node) {
    return (
      <div className="p-3 text-xs text-neutral-500">Select an object to edit its properties.</div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-400">Inspector</span>
        <span className="text-[10px] text-neutral-500">{node.name ?? defaultDisplayName(node)}</span>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-3">
        <NameField node={node} />
        {node.type === 'cabinet' && <CabinetFields node={node as CabinetNode} />}
        {node.type === 'countertop' && <CountertopFields node={node as CountertopNode} />}
        {node.type === 'wall' && <WallFields node={node as WallNode} />}
        {node.type === 'custom-item' && <CustomItemFields node={node as CustomItemNode} />}
        {node.type === 'light' && <LightFields node={node as LightNode} />}
        {node.type === 'empty' && <EmptyFields node={node as EmptyNode} />}
      </div>
    </div>
  )
}

// Friendly default name for a node — used as the input placeholder so the
// inspector reads "Fridge" / "Sink" instead of "custom-item". The user can
// still type their own name to override.
function defaultDisplayName(node: AnyNode): string {
  if (node.type === 'cabinet') return `${node.style[0].toUpperCase()}${node.style.slice(1)} cabinet`
  if (node.type === 'countertop') return 'Countertop'
  if (node.type === 'wall') return 'Wall'
  if (node.type === 'light') return 'Light'
  if (node.type === 'empty') return 'Empty'
  if (node.type === 'custom-item') {
    const aid = (node as CustomItemNode).assetId
    if (aid === 'predef:sink') return 'Sink'
    if (aid === 'predef:mixer') return 'Stand Mixer'
    if (aid === 'predef:fridge') return 'Fridge'
    if (aid === 'predef:oven') return 'Oven'
    if (aid === 'predef:induction') return 'Induction Hob'
    return 'Asset'
  }
  return node.type
}

function NameField({ node }: { node: AnyNode }) {
  const update = useScene((s) => s.updateNode)
  return (
    <Field label="Name">
      <input
        type="text"
        value={node.name ?? ''}
        onChange={(e) => update(node.id, { name: e.target.value } as Partial<AnyNode>)}
        className="inp"
        placeholder={defaultDisplayName(node)}
      />
    </Field>
  )
}

function CabinetFields({ node }: { node: CabinetNode }) {
  const update = useScene((s) => s.updateNode)
  return (
    <>
      <Field label="Style">
        <select
          className="inp"
          value={node.style}
          onChange={(e) => update(node.id, { style: e.target.value as CabinetNode['style'] })}
        >
          <option value="base">Base</option>
          <option value="wall">Wall</option>
          <option value="tall">Tall</option>
        </select>
      </Field>
      <NumField label="Width (m)" value={node.width} step={0.05} min={0.2} max={1.5}
        onChange={(v) => update(node.id, { width: v })} />
      <NumField label="Height (m)" value={node.height} step={0.05} min={0.2} max={2.4}
        onChange={(v) => update(node.id, { height: v })} />
      <NumField label="Depth (m)" value={node.depth} step={0.05} min={0.2} max={0.8}
        onChange={(v) => update(node.id, { depth: v })} />

      <Field label="Front">
        <select
          className="inp"
          value={node.doorKind}
          onChange={(e) => update(node.id, { doorKind: e.target.value as CabinetNode['doorKind'] })}
        >
          <option value="none">Open</option>
          <option value="single">Single door</option>
          <option value="double">Double door</option>
          <option value="drawers">Drawers</option>
        </select>
      </Field>

      {node.doorKind === 'drawers' && (
        <NumField label="Drawer count" value={node.drawerCount} step={1} min={1} max={6}
          onChange={(v) => update(node.id, { drawerCount: Math.round(v) })} />
      )}

      <NumField label="Rotation (°)" value={(node.transform.rotationY * 180) / Math.PI} step={15} min={-360} max={360}
        onChange={(v) =>
          update(node.id, {
            transform: { ...node.transform, rotationY: (v * Math.PI) / 180 },
          })
        } />

      <PositionField
        label="Position"
        value={node.transform.position}
        onChange={(p) => update(node.id, { transform: { ...node.transform, position: p } })}
      />

      <MaterialFields
        label="Carcass material"
        value={node.carcassMaterial}
        onChange={(m) => update(node.id, { carcassMaterial: m })}
      />
      <MaterialFields
        label="Door material"
        value={node.doorMaterial}
        onChange={(m) => update(node.id, { doorMaterial: m })}
      />
      <MaterialFields
        label="Handle material"
        value={node.handleMaterial}
        onChange={(m) => update(node.id, { handleMaterial: m })}
      />
    </>
  )
}

function CountertopFields({ node }: { node: CountertopNode }) {
  const update = useScene((s) => s.updateNode)
  return (
    <>
      <NumField label="Width (m)" value={node.width} step={0.1} min={0.3} max={4}
        onChange={(v) => update(node.id, { width: v })} />
      <NumField label="Depth (m)" value={node.depth} step={0.05} min={0.3} max={1.2}
        onChange={(v) => update(node.id, { depth: v })} />
      <NumField label="Thickness (m)" value={node.thickness} step={0.005} min={0.015} max={0.1}
        onChange={(v) => update(node.id, { thickness: v })} />
      <PositionField
        label="Position"
        value={node.transform.position}
        onChange={(p) => update(node.id, { transform: { ...node.transform, position: p } })}
      />
      <MaterialFields
        label="Material"
        value={node.material}
        onChange={(m) => update(node.id, { material: m })}
      />
    </>
  )
}

function WallFields({ node }: { node: WallNode }) {
  const update = useScene((s) => s.updateNode)
  return (
    <>
      <NumField label="Height (m)" value={node.height} step={0.05} min={1.5} max={4}
        onChange={(v) => update(node.id, { height: v })} />
      <NumField label="Thickness (m)" value={node.thickness} step={0.01} min={0.05} max={0.4}
        onChange={(v) => update(node.id, { thickness: v })} />
      <MaterialFields
        label="Material"
        value={node.material}
        onChange={(m) => update(node.id, { material: m })}
      />
    </>
  )
}

function CustomItemFields({ node }: { node: CustomItemNode }) {
  const update = useScene((s) => s.updateNode)
  return (
    <>
      <PositionField
        label="Position"
        value={node.transform.position}
        onChange={(p) => update(node.id, { transform: { ...node.transform, position: p } })}
      />
      <NumField label="Rotation (°)" value={(node.transform.rotationY * 180) / Math.PI} step={15} min={-360} max={360}
        onChange={(v) => update(node.id, { transform: { ...node.transform, rotationY: (v * Math.PI) / 180 } })} />
      <NumField label="Scale" value={node.scale[0]} step={0.05} min={0.1} max={5}
        onChange={(v) => update(node.id, { scale: [v, v, v] })} />
    </>
  )
}

function EmptyFields({ node }: { node: EmptyNode }) {
  const update = useScene((s) => s.updateNode)
  return (
    <>
      <div className="text-[11px] text-neutral-500">
        Empty container — has no geometry. Drag other nodes onto this one in
        the outliner to make them children, then move/rotate this empty to
        move them all together.
      </div>
      <PositionField
        label="Position"
        value={node.transform.position}
        onChange={(p) => update(node.id, { transform: { ...node.transform, position: p } })}
      />
      <NumField label="Rotation (°)" value={(node.transform.rotationY * 180) / Math.PI} step={15} min={-360} max={360}
        onChange={(v) =>
          update(node.id, { transform: { ...node.transform, rotationY: (v * Math.PI) / 180 } })
        }
      />
    </>
  )
}

function LightFields({ node }: { node: LightNode }) {
  const update = useScene((s) => s.updateNode)
  return (
    <>
      <Field label="Type">
        <select
          className="inp"
          value={node.kind}
          onChange={(e) => update(node.id, { kind: e.target.value as LightNode['kind'] })}
        >
          <option value="point">Point</option>
          <option value="spot">Spot</option>
          <option value="rect">Area</option>
        </select>
      </Field>
      <PositionField
        label="Position"
        value={node.position}
        onChange={(p) => update(node.id, { position: p })}
      />
      <NumField label="Intensity" value={node.intensity} step={5} min={0} max={500}
        onChange={(v) => update(node.id, { intensity: v })} />
      <Field label="Color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={node.color}
            onChange={(e) => update(node.id, { color: e.target.value })}
            className="w-8 h-8 rounded border border-neutral-700 bg-transparent"
          />
          <input
            type="text"
            className="inp flex-1"
            value={node.color}
            onChange={(e) => update(node.id, { color: e.target.value })}
          />
        </div>
      </Field>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-neutral-400 space-y-1">
      <div>{label}</div>
      {children}
    </label>
  )
}

function NumField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  step: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        className="inp"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
      />
    </Field>
  )
}

function PositionField({
  label,
  value,
  onChange,
}: {
  label: string
  value: [number, number, number]
  onChange: (v: [number, number, number]) => void
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-3 gap-1">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <input
            key={axis}
            type="number"
            step={0.05}
            className="inp"
            value={value[i]}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (Number.isNaN(v)) return
              const next = [...value] as [number, number, number]
              next[i] = v
              onChange(next)
            }}
          />
        ))}
      </div>
    </Field>
  )
}

function TextureRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const addTexture = useTextures((s) => s.addTexture)
  const fileRef = useRef<HTMLInputElement>(null)
  const onUpload = async (file: File | null | undefined) => {
    if (!file) return
    const meta = await addTexture(file)
    onChange(`tex:${meta.id}`)
    if (fileRef.current) fileRef.current.value = ''
  }
  const has = !!value
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700"
        >
          {has ? 'Replace' : 'Upload'}
        </button>
        {has && (
          <button
            onClick={() => onChange(undefined)}
            className="px-2 py-1 text-xs rounded text-neutral-400 hover:text-red-400"
          >
            Clear
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onUpload(e.target.files?.[0])}
        />
      </div>
    </Field>
  )
}

// Tiny faux-3D sphere thumbnail showing a material's color map. Achieves
// the "ball" look with CSS only — radial highlight + inner shadow on a
// circular div with the texture as its background. Cheap relative to a
// per-thumbnail WebGL render and good enough to read at thumbnail size.
function MaterialBall({ textureUrl, color }: { textureUrl?: string; color?: string }) {
  return (
    <div
      className="w-8 h-8 rounded-full border border-neutral-600 shrink-0"
      style={{
        backgroundImage: textureUrl ? `url(${textureUrl})` : undefined,
        backgroundColor: color ?? '#777',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        boxShadow:
          'inset -4px -4px 8px rgba(0,0,0,0.55), inset 3px 3px 6px rgba(255,255,255,0.18)',
      }}
    />
  )
}

// Custom popover-style preset picker. Shows the current preset (or
// "Custom" if none of the predefs match) with a faux-3D ball thumbnail;
// clicking opens a list of all presets each with their own ball preview.
// Replaces the plain <select> which always read "Apply preset…" because
// HTML select doesn't accept an empty-string value display while keeping
// the change handler stateless.
function MaterialPresetPicker({
  value,
  onChange,
}: {
  value: MaterialRef
  onChange: (v: MaterialRef) => void
}) {
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

  // Match the active preset by texture URL — the canonical identity for a
  // preset application. Users can still override roughness/metalness on
  // top, and the preset stays selected because we only check texture URLs.
  const current = PREDEFINED_MATERIALS.find(
    (p) => p.preset.textureUrl && p.preset.textureUrl === value.textureUrl,
  )

  return (
    <Field label="Preset">
      <div className="relative" ref={wrapRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="inp flex items-center gap-2 text-left w-full"
          type="button"
        >
          <MaterialBall textureUrl={value.textureUrl} color={value.color} />
          <span className="flex-1 truncate">{current?.name ?? 'Custom'}</span>
          <span className="text-neutral-500">▾</span>
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 w-full bg-neutral-900 border border-neutral-700 rounded shadow-lg z-50 max-h-72 overflow-auto py-1">
            <button
              type="button"
              onClick={() => {
                onChange({
                  ...value,
                  textureUrl: undefined,
                  normalMapUrl: undefined,
                  roughnessMapUrl: undefined,
                })
                setOpen(false)
              }}
              className="w-full px-2 py-1.5 text-left flex items-center gap-2 hover:bg-neutral-800"
            >
              <MaterialBall color={value.color} />
              <span className="text-xs flex-1">None (clear maps)</span>
            </button>
            {PREDEFINED_MATERIALS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(applyMaterialPreset(value, p.id))
                  setOpen(false)
                }}
                className={`w-full px-2 py-1.5 text-left flex items-center gap-2 hover:bg-neutral-800 ${
                  current?.id === p.id ? 'bg-neutral-800' : ''
                }`}
              >
                <MaterialBall textureUrl={p.preset.textureUrl} color={p.preset.color} />
                <span className="text-xs flex-1">{p.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  )
}

function MaterialFields({
  label,
  value,
  onChange,
}: {
  label: string
  value: MaterialRef
  onChange: (v: MaterialRef) => void
}) {
  return (
    <div className="pt-2 border-t border-neutral-800 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <MaterialPresetPicker value={value} onChange={onChange} />
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value.color}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
          className="w-8 h-8 rounded border border-neutral-700 bg-transparent"
        />
        <input
          type="text"
          className="inp flex-1"
          value={value.color}
          onChange={(e) => onChange({ ...value, color: e.target.value })}
        />
      </div>
      <NumField label="Roughness" value={value.roughness} step={0.05} min={0} max={1}
        onChange={(v) => onChange({ ...value, roughness: v })} />
      <NumField label="Metalness" value={value.metalness} step={0.05} min={0} max={1}
        onChange={(v) => onChange({ ...value, metalness: v })} />
      <TextureRow
        label="Color map (PNG/JPG)"
        value={value.textureUrl}
        onChange={(v) => onChange({ ...value, textureUrl: v })}
      />
      <TextureRow
        label="Normal map"
        value={value.normalMapUrl}
        onChange={(v) => onChange({ ...value, normalMapUrl: v })}
      />
      <TextureRow
        label="Roughness map"
        value={value.roughnessMapUrl}
        onChange={(v) => onChange({ ...value, roughnessMapUrl: v })}
      />
      <NumField label="Texture tile (×)" value={value.textureRepeat ?? 2} step={0.5} min={0.1} max={20}
        onChange={(v) => onChange({ ...value, textureRepeat: v })} />
      <NumField label="Normal strength" value={value.normalScale ?? 1.5} step={0.1} min={0} max={5}
        onChange={(v) => onChange({ ...value, normalScale: v })} />
    </div>
  )
}
