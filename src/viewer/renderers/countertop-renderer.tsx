'use client'

import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Mesh } from 'three'
import type { CountertopNode } from '@/core/schema'
import { useRegistry } from '@/core/registry/use-registry'
import { emitter } from '@/core/events/emitter'
import { useScene } from '@/core/store/use-scene'
import { useEditor } from '@/core/store/use-editor'
import { useMaterialTexture } from '@/viewer/use-material-texture'

// Default footprint of the predef sink (slightly smaller than the visible
// model so the sink rim hides the cut edges). The sink GLTF's long side runs
// along its local Z axis, so the unrotated hole is wider along Z (depth)
// than X — earlier W/D were swapped which made rot=0 look like rot=90 and
// vice-versa once a real sink rotation was applied.
const SINK_HOLE_W = 0.42 // along sink local X
const SINK_HOLE_D = 0.34 // along sink local Z
const SINK_HOLE_INSET = 0.005 // 5 mm — keeps hole strictly inside the countertop boundary
// Approx height of a custom-item: GLTF normalized to 0.5 along longest axis,
// then multiplied by the node's scale.y. Used for Y-range overlap test.
const CUSTOM_ITEM_BASE_H = 0.5

export function CountertopRenderer({ node }: { node: CountertopNode }) {
  const ref = useRef<Mesh>(null!)
  useRegistry(node.id, 'countertop', ref)
  const selected = useScene((s) => s.selectedIds.includes(node.id))
  const rep = node.material.textureRepeat ?? 2
  const colorMap = useMaterialTexture(node.material.textureUrl, false, rep)
  const normalMap = useMaterialTexture(node.material.normalMapUrl, true, rep)
  const roughnessMap = useMaterialTexture(node.material.roughnessMapUrl, true, rep)
  const nScale = node.material.normalScale ?? 1.5

  // Subscribe to the full nodes map so we re-render when any sink's position
  // changes. The geometry is rebuilt only when one of the inputs in the
  // useMemo dep array actually changes.
  const nodes = useScene((s) => s.nodes)

  // Compute sinks intersecting THIS countertop's slab volume in countertop-local
  // coordinates. The hole exists for as long as the sink's Y range overlaps
  // the countertop's Y range AND its footprint lies inside the slab — so a
  // sink dropped down into the countertop (basin sitting below the surface)
  // keeps the hole.
  const cutters = useMemo(() => {
    const out: { lx: number; lz: number; w: number; d: number; rot: number }[] = []
    const ctY = node.transform.position[1]
    const ctBottom = ctY - node.thickness / 2
    const ctTop = ctY + node.thickness / 2
    const cosR = Math.cos(node.transform.rotationY)
    const sinR = Math.sin(node.transform.rotationY)
    const halfW = node.width / 2 - SINK_HOLE_INSET
    const halfD = node.depth / 2 - SINK_HOLE_INSET
    for (const n of Object.values(nodes)) {
      if (n.type !== 'custom-item') continue
      if (n.assetId !== 'predef:sink') continue
      // Y-range overlap test (3D intersection, not just "near the top").
      const sinkScaleY = n.scale?.[1] ?? 1
      const sinkBottom = n.transform.position[1]
      const sinkTop = sinkBottom + CUSTOM_ITEM_BASE_H * sinkScaleY
      if (sinkTop <= ctBottom || sinkBottom >= ctTop) continue

      // World XZ -> countertop-local XZ via inverse Y rotation.
      const dx = n.transform.position[0] - node.transform.position[0]
      const dz = n.transform.position[2] - node.transform.position[2]
      const lx = dx * cosR - dz * sinR
      const lz = dx * sinR + dz * cosR

      // Sink scale on its own X/Z axes.
      const sinkScaleX = n.scale?.[0] ?? 1
      const sinkScaleZ = n.scale?.[2] ?? 1
      const w = SINK_HOLE_W * sinkScaleX
      const d = SINK_HOLE_D * sinkScaleZ

      // Sink rotation expressed in the countertop's local frame, then mapped
      // to the 2D shape plane (shape Y = local Z, so rotation sign flips).
      const relRot = node.transform.rotationY - n.transform.rotationY

      // AABB of the rotated rectangle in shape coords — used to keep the
      // hole strictly inside the countertop boundary so ExtrudeGeometry
      // doesn't trip on a path crossing the outer shape.
      const cr = Math.cos(relRot)
      const sr = Math.sin(relRot)
      const aabbHalfX = Math.abs((w / 2) * cr) + Math.abs((d / 2) * sr)
      const aabbHalfZ = Math.abs((w / 2) * sr) + Math.abs((d / 2) * cr)
      if (Math.abs(lx) + aabbHalfX > halfW) continue
      if (Math.abs(lz) + aabbHalfZ > halfD) continue

      out.push({ lx, lz, w, d, rot: relRot })
    }
    return out
  }, [
    nodes,
    node.transform.position[0],
    node.transform.position[1],
    node.transform.position[2],
    node.transform.rotationY,
    node.thickness,
    node.width,
    node.depth,
  ])

  const geometry = useMemo(() => {
    const w = node.width / 2
    const d = node.depth / 2
    const shape = new THREE.Shape()
    shape.moveTo(-w, -d)
    shape.lineTo(w, -d)
    shape.lineTo(w, d)
    shape.lineTo(-w, d)
    shape.closePath()

    for (const c of cutters) {
      const hw = c.w / 2
      const hd = c.d / 2
      const cr = Math.cos(c.rot)
      const sr = Math.sin(c.rot)
      // Hole corners in sink-local space, then rotated by `rot` and offset
      // by (lx, lz) to land at the sink's position in countertop-local space.
      // Order goes counter-clockwise so it's a proper inner path for the
      // shape (ExtrudeGeometry uses the path winding to detect a hole).
      const corners: [number, number][] = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ]
      const hole = new THREE.Path()
      corners.forEach(([ox, oz], i) => {
        const x = c.lx + ox * cr - oz * sr
        const z = c.lz + ox * sr + oz * cr
        if (i === 0) hole.moveTo(x, z)
        else hole.lineTo(x, z)
      })
      hole.closePath()
      shape.holes.push(hole)
    }

    // Custom UV generator: by default ExtrudeGeometry sets UVs equal to the
    // shape's world coordinates (in meters), so a small image tiles many times
    // across the slab — appearing as a "grid of ellipses" rather than a single
    // wood plank. Mapping top/bottom face UVs to 0..1 across the countertop's
    // bbox makes each uploaded texture cover the surface once.
    const halfW = node.width / 2
    const halfD = node.depth / 2
    const uvGenerator = {
      generateTopUV: (
        _g: THREE.ExtrudeGeometry,
        verts: number[],
        ia: number,
        ib: number,
        ic: number,
      ) => {
        const u = (i: number) => (verts[i * 3] + halfW) / node.width
        const v = (i: number) => (verts[i * 3 + 1] + halfD) / node.depth
        return [
          new THREE.Vector2(u(ia), v(ia)),
          new THREE.Vector2(u(ib), v(ib)),
          new THREE.Vector2(u(ic), v(ic)),
        ]
      },
      generateSideWallUV: (
        _g: THREE.ExtrudeGeometry,
        verts: number[],
        ia: number,
        ib: number,
        ic: number,
        id: number,
      ) => {
        // Side band: just produce a 0..1 quad per side segment. The texture
        // appearance on the thin edge is rarely critical; this keeps it from
        // tiling weirdly with shape coordinates.
        const u = (i: number) => verts[i * 3]
        const y = (i: number) => verts[i * 3 + 2]
        const us = [u(ia), u(ib), u(ic), u(id)]
        const ys = [y(ia), y(ib), y(ic), y(id)]
        const minU = Math.min(...us)
        const maxU = Math.max(...us)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        const norm = (val: number, lo: number, hi: number) =>
          hi - lo < 1e-6 ? 0 : (val - lo) / (hi - lo)
        return [
          new THREE.Vector2(norm(us[0], minU, maxU), norm(ys[0], minY, maxY)),
          new THREE.Vector2(norm(us[1], minU, maxU), norm(ys[1], minY, maxY)),
          new THREE.Vector2(norm(us[2], minU, maxU), norm(ys[2], minY, maxY)),
          new THREE.Vector2(norm(us[3], minU, maxU), norm(ys[3], minY, maxY)),
        ]
      },
    }
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: node.thickness,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1,
      UVGenerator: uvGenerator,
    })
    // Shape lives in XY; ExtrudeGeometry extrudes along +Z. Rotate so the
    // extrusion axis becomes world Y, then center vertically so the
    // countertop's `transform.position[1]` is its center (matches the old
    // BoxGeometry behavior).
    geom.rotateX(Math.PI / 2)
    geom.translate(0, node.thickness / 2, 0)
    geom.computeVertexNormals()
    return geom
  }, [node.width, node.depth, node.thickness, cutters])

  return (
    <mesh
      ref={ref}
      position={node.transform.position}
      rotation={[0, node.transform.rotationY, 0]}
      geometry={geometry}
      onPointerDown={(e) => {
        // Skip swallowing while a placement tool is active so the click
        // reaches the GroundPlane and lands at the cursor's true XZ.
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
      <meshStandardMaterial
        // Recreate the material when any texture appears/changes — r3f
        // doesn't always set needsUpdate=true when a map slot flips from
        // null to a real Texture, so the shader stays compiled without the
        // map slot active and the texture appears to do nothing (and on
        // remount sometimes appears blank).
        key={`${colorMap?.uuid ?? 'n'}-${normalMap?.uuid ?? 'n'}-${roughnessMap?.uuid ?? 'n'}`}
        color={selected ? '#ffdd66' : node.material.color}
        roughness={node.material.roughness}
        metalness={node.material.metalness}
        map={colorMap}
        normalMap={normalMap}
        normalScale={new THREE.Vector2(nScale, nScale)}
        roughnessMap={roughnessMap}
      />
    </mesh>
  )
}
