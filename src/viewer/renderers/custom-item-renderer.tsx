'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Group } from 'three'
import { GLTFMaterialsPbrSpecularGlossinessExtension } from '@/viewer/gltf-pbr-specgloss-extension'
import type { CustomItemNode } from '@/core/schema'
import { useAssets } from '@/core/store/use-assets'
import { useScene } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import { useRegistry } from '@/core/registry/use-registry'
import { emitter } from '@/core/events/emitter'
import { getPredefinedAsset, isPredefinedAssetId } from '@/core/assets/predefined'
import { setAssetBbox } from '@/core/assets/asset-bbox'

const SELECTED_TINT = new THREE.Color('#ffdd66')

export function CustomItemRenderer({ node }: { node: CustomItemNode }) {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'custom-item', ref)
  const [scene, setScene] = useState<THREE.Group | null>(null)
  const [error, setError] = useState<string | null>(null)
  const getAssetFileUrls = useAssets((s) => s.getAssetFileUrls)
  const assetMeta = useAssets((s) => s.assets[node.assetId])
  const selected = useScene((s) => s.selectedIds.includes(node.id))
  // After the GLTF loads we clone each mesh's material so we can tint it
  // amber on selection without bleeding into other instances of the same
  // asset. We also need to NULL the colour map while selected — otherwise
  // amber multiplies with the asset's baseColor texture and each asset
  // (sink, mixer, fridge…) ends up a different shade. Saving the original
  // map / colour means deselect restores the exact look the model had.
  const matsRef = useRef<{
    mat: THREE.MeshStandardMaterial
    origColor: THREE.Color
    origMap: THREE.Texture | null
  }[]>([])

  useEffect(() => {
    let cancelled = false
    const createdUrls: string[] = []
    setError(null)
    setScene(null)

    ;(async () => {
      // Predefined assets live in /public — load directly by URL with a
      // standard manager (companion files like .bin and textures are resolved
      // relative to the GLTF, no URL rewriting needed).
      const predef = isPredefinedAssetId(node.assetId) ? getPredefinedAsset(node.assetId) : undefined
      let rootUrl: string | null
      let urls: Record<string, string> = {}
      if (predef) {
        rootUrl = predef.rootUrl
      } else {
        const blobs = await getAssetFileUrls(node.assetId)
        if (cancelled) {
          Object.values(blobs.urls).forEach((u) => URL.revokeObjectURL(u))
          return
        }
        rootUrl = blobs.rootUrl
        urls = blobs.urls
        createdUrls.push(...Object.values(urls))
      }
      if (!rootUrl) {
        setError('Root file missing — re-upload asset')
        return
      }

      const manager = new THREE.LoadingManager()
      if (!predef) {
        manager.setURLModifier((url) => {
          try {
            const base = url.split(/[?#]/)[0]
            const raw = decodeURIComponent(base.split(/[\\/]/).pop() ?? '')
            if (urls[raw]) return urls[raw]
            const lower = raw.toLowerCase()
            for (const key of Object.keys(urls)) {
              if (key.toLowerCase() === lower) return urls[key]
            }
          } catch {}
          return url
        })
      }

      const loader = new GLTFLoader(manager)
      loader.register((parser: any) => new GLTFMaterialsPbrSpecularGlossinessExtension(parser))
      if (predef) {
        // Anchor texture/companion resolution to the predef folder. Without
        // this the parser sometimes resolves textures against the document
        // base instead of the GLTF folder when the GLTF URL starts with `/`,
        // and the .png files 404. Setting resourcePath forces correct
        // resolution to /assets/<folder>/textures/...png.
        const folder = predef.rootUrl.substring(0, predef.rootUrl.lastIndexOf('/') + 1)
        loader.setResourcePath(folder)
      }
      loader.load(
        rootUrl,
        (gltf) => {
          if (cancelled) return
          // normalize to roughly ~0.5m so small/huge models land visibly; user can scale after
          const box = new THREE.Box3().setFromObject(gltf.scene)
          const size = box.getSize(new THREE.Vector3())
          const longest = Math.max(size.x, size.y, size.z)
          if (longest > 0) {
            const k = 0.5 / longest
            gltf.scene.scale.setScalar(k)
            gltf.scene.updateMatrixWorld(true)
            const box2 = new THREE.Box3().setFromObject(gltf.scene)
            // Re-anchor the model: bottom on the floor, footprint centred
            // on the placement origin. Without the XZ recentre, GLTFs
            // whose authored origin isn't at the bbox centre (oven,
            // induction hob) appear far from where the user clicked.
            const center = box2.getCenter(new THREE.Vector3())
            gltf.scene.position.x -= center.x
            gltf.scene.position.y -= box2.min.y
            gltf.scene.position.z -= center.z
            const finalSize = box2.getSize(new THREE.Vector3())
            setAssetBbox(node.assetId, [finalSize.x, finalSize.y, finalSize.z])
          }
          setScene(gltf.scene)
        },
        undefined,
        (err) => {
          if (cancelled) return
          console.error('GLTF load error:', err)
          setError(`Load failed: ${(err as any)?.message ?? 'unknown'}`)
        },
      )
    })()

    return () => {
      cancelled = true
      for (const u of createdUrls) URL.revokeObjectURL(u)
    }
    // assetMeta.files is depended on so that adding files to an existing
    // uploaded asset (e.g. the user uploads missing textures after the GLTF)
    // triggers a fresh load with the new files in scope.
  }, [node.assetId, getAssetFileUrls, assetMeta?.files?.length])

  // Walk the loaded scene once and clone every mesh's material so tint
  // toggling can't affect siblings sharing the same source material. Captures
  // each material's original color for deselect restoration.
  useEffect(() => {
    matsRef.current = []
    if (!scene) return
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!(mesh as any).isMesh) return
      const m = mesh.material as any
      if (Array.isArray(m)) {
        const cloned = m.map((sub) => sub.clone())
        mesh.material = cloned
        for (const c of cloned as any[]) {
          if (c?.color) matsRef.current.push({ mat: c, origColor: c.color.clone(), origMap: c.map ?? null })
        }
      } else if (m?.color) {
        const cloned = m.clone()
        mesh.material = cloned
        matsRef.current.push({ mat: cloned, origColor: cloned.color.clone(), origMap: cloned.map ?? null })
      }
    })
  }, [scene])

  // Apply / remove the amber tint as the selection toggles. Setting map =
  // null while selected gives a uniform amber surface across every asset —
  // otherwise amber × baseColorMap produces a different shade per asset
  // (sink ceramic vs mixer metal vs fridge enamel). Normal/roughness maps
  // stay on so the surface still reads as 3D.
  useEffect(() => {
    for (const { mat, origColor, origMap } of matsRef.current) {
      if (selected) {
        mat.color.copy(SELECTED_TINT)
        mat.map = null
      } else {
        mat.color.copy(origColor)
        mat.map = origMap
      }
      mat.needsUpdate = true
    }
  }, [selected, scene])

  const fallbackName = isPredefinedAssetId(node.assetId)
    ? getPredefinedAsset(node.assetId)?.name ?? 'Loading…'
    : assetMeta?.name ?? 'Loading…'
  return (
    <group
      ref={ref}
      position={node.transform.position}
      rotation={[0, node.transform.rotationY, 0]}
      scale={node.scale}
      onPointerDown={(e) => {
        if (useEditor.getState().tool !== 'select') return
        e.stopPropagation()
        emitter.emit('node:click', {
          node,
          position: [e.point.x, e.point.y, e.point.z],
          shiftKey: e.nativeEvent?.shiftKey,
          ctrlKey: e.nativeEvent?.ctrlKey,
          metaKey: e.nativeEvent?.metaKey,
          altKey: e.nativeEvent?.altKey,
        })
      }}
      onClick={(e) => {
        if (useEditor.getState().tool !== 'select') return
        e.stopPropagation()
      }}
    >
      {scene ? (
        <primitive object={scene} />
      ) : (
        <PlaceholderBox name={error ?? fallbackName} error={!!error} />
      )}
    </group>
  )
}

function PlaceholderBox({ name: _name, error }: { name: string; error: boolean }) {
  return (
    <mesh position={[0, 0.25, 0]}>
      <boxGeometry args={[0.4, 0.5, 0.4]} />
      <meshStandardMaterial color={error ? '#aa3333' : '#888'} wireframe />
    </mesh>
  )
}
