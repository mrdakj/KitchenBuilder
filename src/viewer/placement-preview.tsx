'use client'

import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useEditor } from '@/core/store/use-editor'
import { useScene } from '@/core/store/use-scene'
import { snap } from '@/core/utils/math'
import { boxFor, collidesBox, isAllowedBuiltInCabinetOverlap } from '@/core/systems/collision'
import { buildCabinetGeometry } from '@/core/geometry/cabinet'
import type { AnyNode, CabinetNode } from '@/core/schema'
import { getAssetBbox, setAssetBbox } from '@/core/assets/asset-bbox'
import { getPredefinedAsset, isPredefinedAssetId } from '@/core/assets/predefined'
import { findWallFacingRotation } from '@/core/systems/auto-rotate'

export function PlacementPreview() {
  const group = useRef<THREE.Group>(null!)
  const lineRef = useRef<THREE.Line>(null!)
  const boxMatRef = useRef<THREE.MeshBasicMaterial>(null!)
  const boxEdgesMatRef = useRef<THREE.LineBasicMaterial>(null!)
  const ringMatRef = useRef<THREE.MeshBasicMaterial>(null!)
  const { camera, pointer } = useThree()

  const lineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    return g
  }, [])

  useFrame(() => {
    const tool = useEditor.getState().tool
    const wallStart = useEditor.getState().wallDrawStart
    const snapEnabled = useEditor.getState().snapEnabled
    const step = useEditor.getState().snapStep
    const showBox = tool === 'cabinet' || tool === 'countertop' || tool === 'place-item' || tool === 'light' || tool === 'empty'
    const showWallGhost = tool === 'wall' && wallStart !== null
    const showCrosshair = tool === 'wall' || showBox

    if (!group.current) return
    group.current.visible = showCrosshair

    const ndc = new THREE.Vector3(pointer.x, pointer.y, 0.5).unproject(camera)
    const dir = ndc.sub(camera.position).normalize()
    if (Math.abs(dir.y) < 1e-6) {
      group.current.visible = false
      return
    }
    const t = -camera.position.y / dir.y
    if (t <= 0) {
      group.current.visible = false
      return
    }
    const hit = camera.position.clone().add(dir.multiplyScalar(t))
    const sx = snapEnabled ? snap(hit.x, step) : hit.x
    const sz = snapEnabled ? snap(hit.z, step) : hit.z

    // For countertop items, lift the ghost onto the countertop top while
    // hovering — what the user sees in preview matches what's about to drop.
    let groundY = 0
    const placingId = useEditor.getState().placingAssetId
    if (
      tool === 'place-item' &&
      (placingId === 'predef:sink' || placingId === 'predef:mixer' || placingId === 'predef:induction')
    ) {
      const sceneNodes = useScene.getState().nodes
      for (const n of Object.values(sceneNodes)) {
        if (n.type !== 'countertop' || !n.visible) continue
        const cx = n.transform.position[0]
        const cz = n.transform.position[2]
        const w = n.width, d = n.depth
        if (sx >= cx - w / 2 && sx <= cx + w / 2 && sz >= cz - d / 2 && sz <= cz + d / 2) {
          groundY = n.transform.position[1] + n.thickness / 2
          if (placingId === 'predef:sink') groundY -= Math.min(0.025, n.thickness / 2)
          break
        }
      }
    }
    let previewNode: AnyNode | null = null
    if (tool === 'cabinet') {
      const cab = useEditor.getState().cabinetDefaults
      previewNode = {
        id: '__preview__',
        type: 'cabinet',
        parentId: null,
        visible: true,
        transform: { position: [sx, groundY, sz], rotationY: 0 },
        style: cab.style,
        width: cab.width,
        height: cab.height,
        depth: cab.depth,
        doorKind: cab.doorKind,
        drawerCount: cab.drawerCount,
        stackedBelowId: null,
        fillerKind: 'none',
        carcassMaterial: { color: '#ffffff', roughness: 0.6, metalness: 0 },
        doorMaterial: { color: '#e5e5e5', roughness: 0.5, metalness: 0 },
        handleMaterial: { color: '#333333', roughness: 0.2, metalness: 0.8 },
      }
    } else if (tool === 'place-item' && (placingId === 'predef:fridge' || placingId === 'predef:oven')) {
      previewNode = {
        id: '__preview__',
        type: 'custom-item',
        parentId: null,
        visible: true,
        assetId: placingId,
        transform: { position: [sx, groundY, sz], rotationY: 0 },
        scale: [1, 1, 1],
        materialOverrides: {},
      }
    }
    const wallRot = previewNode ? findWallFacingRotation([sx, groundY, sz], previewNode) : null
    group.current.position.set(sx, groundY, sz)
    group.current.rotation.y = wallRot ?? 0

    // collision tinting
    let collides = false
    if (showBox) {
      const cab = useEditor.getState().cabinetDefaults
      const dims =
        tool === 'cabinet'
          ? { w: cab.width, h: cab.height, d: cab.depth, y: cab.style === 'wall' ? 1.4 : 0 }
          : tool === 'countertop'
            ? { w: 1.2, h: 0.04, d: 0.62, y: 0.88 }
            : { w: 0.5, h: 0.5, d: 0.5, y: 0 }
      const box = boxFor(tool === 'place-item' ? 'place-item' : tool as any, [sx, 0, sz], dims)
      collides = !!collidesBox(
        null,
        box,
        (n, other) => isAllowedBuiltInCabinetOverlap(placingId, box, n, other),
      )
    }

    const color = collides ? 0xff5555 : 0xffdd66
    boxMatRef.current?.color.setHex(color)
    boxEdgesMatRef.current?.color.setHex(color)
    ringMatRef.current?.color.setHex(color)

    if (lineRef.current) {
      lineRef.current.visible = showWallGhost
      if (showWallGhost && wallStart) {
        const arr = (lineRef.current.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
        arr[0] = wallStart[0] - sx
        arr[1] = 0.01
        arr[2] = wallStart[1] - sz
        arr[3] = 0
        arr[4] = 0.01
        arr[5] = 0
        ;(lineRef.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
      }
    }
  })

  const tool = useEditor((s) => s.tool)
  const cabDefaults = useEditor((s) => s.cabinetDefaults)
  const placingAssetId = useEditor((s) => s.placingAssetId)
  const { boxW, boxH, boxD, boxY } = useMemo(() => {
    if (tool === 'cabinet')
      return {
        boxW: cabDefaults.width,
        boxH: cabDefaults.height,
        boxD: cabDefaults.depth,
        boxY: cabDefaults.style === 'wall' ? 1.4 + cabDefaults.height / 2 : cabDefaults.height / 2,
      }
    if (tool === 'countertop') return { boxW: 1.2, boxH: 0.04, boxD: 0.62, boxY: 0.9 }
    if (tool === 'place-item') {
      // Use the asset's actual normalised bbox (cached when first loaded)
      // multiplied by the placement-time scale we'll apply on click. That
      // way the ghost matches the size of what's actually about to drop.
      const bb = placingAssetId ? getAssetBbox(placingAssetId) : null
      let scale = 1.0
      if (placingAssetId === 'predef:fridge') {
        scale = bb && bb[2] > 0 ? 0.6 / bb[2] : 3.6
      } else if (placingAssetId === 'predef:oven' || placingAssetId === 'predef:induction') {
        scale = 1.2
      }
      const w = (bb ? bb[0] : 0.5) * scale
      const h = (bb ? bb[1] : 0.5) * scale
      const d = (bb ? bb[2] : 0.5) * scale
      return { boxW: w, boxH: h, boxD: d, boxY: h / 2 }
    }
    if (tool === 'light') return { boxW: 0.16, boxH: 0.16, boxD: 0.16, boxY: 2.4 }
    if (tool === 'empty') return { boxW: 0.16, boxH: 0.16, boxD: 0.16, boxY: 0.1 }
    return { boxW: 0.2, boxH: 0.2, boxD: 0.2, boxY: 0.1 }
  }, [tool, cabDefaults, placingAssetId])

  const showBox = tool === 'cabinet' || tool === 'countertop' || tool === 'place-item' || tool === 'light' || tool === 'empty'

  // For cabinet tool, build the actual cabinet geometry (carcass + doors +
  // handles) so the preview reads as a real cabinet rather than a generic
  // bounding box. Memoised on the placement defaults.
  const cabinetGhost = useMemo(() => {
    if (tool !== 'cabinet') return null
    const stub: CabinetNode = {
      id: 'preview-cabinet',
      type: 'cabinet',
      parentId: null,
      visible: true,
      transform: { position: [0, 0, 0], rotationY: 0 },
      style: cabDefaults.style,
      width: cabDefaults.width,
      height: cabDefaults.height,
      depth: cabDefaults.depth,
      doorKind: cabDefaults.doorKind,
      drawerCount: cabDefaults.drawerCount,
      stackedBelowId: null,
      fillerKind: 'none',
      carcassMaterial: { color: '#ffffff', roughness: 0.6, metalness: 0 },
      doorMaterial: { color: '#e5e5e5', roughness: 0.5, metalness: 0 },
      handleMaterial: { color: '#333333', roughness: 0.2, metalness: 0.8 },
    }
    return buildCabinetGeometry(stub)
  }, [tool, cabDefaults])
  const cabinetGhostY = tool === 'cabinet'
    ? cabDefaults.style === 'wall' ? 1.4 : 0
    : 0

  return (
    <group ref={group}>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.04, 0.06, 24]} />
        <meshBasicMaterial ref={ringMatRef} color="#ffdd66" transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <circleGeometry args={[0.01, 16]} />
        <meshBasicMaterial color="#ffdd66" depthWrite={false} />
      </mesh>

      {tool === 'cabinet' && cabinetGhost && (
        <group position={[0, cabinetGhostY, 0]} raycast={() => null}>
          <mesh geometry={cabinetGhost.carcass} raycast={() => null}>
            <meshBasicMaterial ref={boxMatRef} color="#ffdd66" transparent opacity={0.45} depthWrite={false} />
          </mesh>
          {cabinetGhost.doors.map((d, i) => (
            <mesh key={`pd${i}`} geometry={d.geom} position={d.position} raycast={() => null}>
              <meshBasicMaterial color="#ffdd66" transparent opacity={0.55} depthWrite={false} />
            </mesh>
          ))}
          {cabinetGhost.handles.map((h, i) => (
            <mesh key={`ph${i}`} geometry={h.geom} position={h.position} raycast={() => null}>
              <meshBasicMaterial color="#ffdd66" transparent opacity={0.7} depthWrite={false} />
            </mesh>
          ))}
        </group>
      )}
      {/* Place-item ghost: for predefined assets, render the actual GLTF
          so the user sees the real sink / fridge / oven / induction shape
          before they click. Falls back to the bbox when the asset isn't
          predef (user-uploaded). */}
      {tool === 'place-item' && placingAssetId && isPredefinedAssetId(placingAssetId) && (
        <Suspense fallback={null}>
          <PredefAssetGhost assetId={placingAssetId} />
        </Suspense>
      )}
      {showBox && tool !== 'cabinet' &&
        !(tool === 'place-item' && placingAssetId && isPredefinedAssetId(placingAssetId)) && (
        <mesh position={[0, boxY, 0]} raycast={() => null}>
          <boxGeometry args={[boxW, boxH, boxD]} />
          <meshBasicMaterial ref={boxMatRef} color="#ffdd66" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
      {showBox && tool !== 'cabinet' &&
        !(tool === 'place-item' && placingAssetId && isPredefinedAssetId(placingAssetId)) && (
        <lineSegments position={[0, boxY, 0]} raycast={() => null}>
          <edgesGeometry args={[new THREE.BoxGeometry(boxW, boxH, boxD)]} />
          <lineBasicMaterial ref={boxEdgesMatRef} color="#ffdd66" />
        </lineSegments>
      )}

      {/* @ts-expect-error three-elements line */}
      <line ref={lineRef} raycast={() => null}>
        <primitive object={lineGeom} attach="geometry" />
        <lineBasicMaterial color="#ffdd66" linewidth={2} />
      </line>
    </group>
  )
}

// Renders the predef GLTF as a placement ghost. The model is normalised
// (longest dim → 0.5 m), centred on its bbox in XZ, and dropped to the
// floor — same recipe the runtime CustomItemRenderer uses. Then it's
// scaled up by the same factor the placement handler will apply on click,
// so the ghost matches the actual size of what's about to drop.
function PredefAssetGhost({ assetId }: { assetId: string }) {
  const predef = getPredefinedAsset(assetId)
  // useGLTF caches by URL so this is cheap on subsequent placements.
  // Hooks must be called unconditionally — fall back to the sink URL if
  // predef is missing; we early-return null below so the fallback isn't
  // actually rendered.
  const gltf = useGLTF(predef?.rootUrl ?? '/assets/sink/scene.gltf')
  const cloned = useMemo(() => {
    const c = (gltf as any).scene.clone(true) as THREE.Object3D
    const box = new THREE.Box3().setFromObject(c)
    const size = box.getSize(new THREE.Vector3())
    const longest = Math.max(size.x, size.y, size.z)
    if (longest > 0) {
      const k = 0.5 / longest
      c.scale.setScalar(k)
      c.updateMatrixWorld(true)
      const box2 = new THREE.Box3().setFromObject(c)
      const center = box2.getCenter(new THREE.Vector3())
      c.position.x -= center.x
      c.position.y -= box2.min.y
      c.position.z -= center.z
      // Cache the normalized bbox so the placement handler can compute a
      // depth-targeted scale on the very first click (the runtime renderer
      // populates this too, but only after a node is in the scene).
      const finalSize = box2.getSize(new THREE.Vector3())
      setAssetBbox(assetId, [finalSize.x, finalSize.y, finalSize.z])
    }
    // Replace each mesh's material with a uniform amber transparent ghost
    // material so the placement preview reads consistently as "about to
    // place" — same look as the cabinet ghost. Without this, sink shows
    // its ceramic colour, fridge shows steel, etc.
    c.traverse((o: any) => {
      o.raycast = () => {}
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({
          color: 0xffdd66,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        })
      }
    })
    return c
  }, [gltf, assetId])
  if (!predef) return null
  // Match the placement-time scale-up.
  // Match the placement-time scale rules so the ghost matches what's
  // actually about to drop. Fridge specifically targets a 60 cm depth
  // (kitchen-cabinet depth) — derive its scale from its own bbox.
  let scale = 1.0
  if (assetId === 'predef:fridge') {
    const bb = getAssetBbox(assetId)
    scale = bb && bb[2] > 0 ? 0.6 / bb[2] : 3.6
  } else if (assetId === 'predef:oven' || assetId === 'predef:induction') {
    scale = 1.2
  }
  return (
    <group scale={[scale, scale, scale]}>
      <primitive object={cloned} />
    </group>
  )
}
