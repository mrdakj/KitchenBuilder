import * as THREE from 'three'
import type { AnyNode, CabinetNode, CustomItemNode } from '@/core/schema'

export type CabinetGeom = {
  carcass: THREE.BufferGeometry
  doors: { geom: THREE.BufferGeometry; position: THREE.Vector3 }[]
  handles: { geom: THREE.BufferGeometry; position: THREE.Vector3 }[]
}

const PANEL_T = 0.018
const DOOR_GAP = 0.003
export const TOE_KICK_H = 0.08
const TOE_KICK_INSET = 0.05

export function buildCabinetGeometry(node: CabinetNode, fillerHeight = 0): CabinetGeom {
  const { width: w, height: h, depth: d, style, doorKind, drawerCount, fillerKind } = node

  const carcassShapes: THREE.BufferGeometry[] = []

  const addBox = (sx: number, sy: number, sz: number, px: number, py: number, pz: number) => {
    const g = new THREE.BoxGeometry(sx, sy, sz)
    g.translate(px, py, pz)
    carcassShapes.push(g)
  }

  const hasToeKick = style === 'base' || style === 'tall'
  const carcassBottom = hasToeKick ? TOE_KICK_H : 0
  const carcassHeight = h - carcassBottom

  // sides
  addBox(PANEL_T, carcassHeight, d, -w / 2 + PANEL_T / 2, carcassBottom + carcassHeight / 2, 0)
  addBox(PANEL_T, carcassHeight, d, w / 2 - PANEL_T / 2, carcassBottom + carcassHeight / 2, 0)
  // bottom
  addBox(w - 2 * PANEL_T, PANEL_T, d, 0, carcassBottom + PANEL_T / 2, 0)
  // top (for base only a front stretcher)
  if (style === 'base') {
    addBox(w - 2 * PANEL_T, PANEL_T, 0.08, 0, h - PANEL_T / 2, d / 2 - 0.04)
    addBox(w - 2 * PANEL_T, PANEL_T, 0.08, 0, h - PANEL_T / 2, -d / 2 + 0.04)
  } else {
    addBox(w - 2 * PANEL_T, PANEL_T, d, 0, h - PANEL_T / 2, 0)
  }
  // back
  addBox(w - 2 * PANEL_T, carcassHeight - PANEL_T, PANEL_T, 0, carcassBottom + carcassHeight / 2, -d / 2 + PANEL_T / 2)
  // toe kick
  if (hasToeKick) {
    addBox(w, TOE_KICK_H, PANEL_T, 0, TOE_KICK_H / 2, -d / 2 + TOE_KICK_INSET + PANEL_T / 2)
  }

  const carcass = mergeGeometries(carcassShapes)

  const doors: CabinetGeom['doors'] = []
  const handles: CabinetGeom['handles'] = []

  const faceZ = d / 2 + PANEL_T / 2
  const frontH = carcassHeight

  if (doorKind === 'drawers') {
    const n = Math.max(1, drawerCount)
    const drawerH = frontH / n
    for (let i = 0; i < n; i++) {
      const dw = w - DOOR_GAP * 2
      const dh = drawerH - DOOR_GAP * 2
      const cy = carcassBottom + drawerH * i + drawerH / 2
      doors.push({
        geom: new THREE.BoxGeometry(dw, dh, PANEL_T),
        position: new THREE.Vector3(0, cy, faceZ),
      })
      handles.push({
        geom: new THREE.BoxGeometry(Math.min(0.15, dw * 0.4), 0.015, 0.02),
        position: new THREE.Vector3(0, cy + dh / 2 - 0.04, faceZ + PANEL_T / 2 + 0.01),
      })
    }
  } else if (doorKind === 'single') {
    const dw = w - DOOR_GAP * 2
    const dh = frontH - DOOR_GAP * 2
    doors.push({
      geom: new THREE.BoxGeometry(dw, dh, PANEL_T),
      position: new THREE.Vector3(0, carcassBottom + frontH / 2, faceZ),
    })
    handles.push({
      geom: new THREE.BoxGeometry(0.015, 0.1, 0.02),
      position: new THREE.Vector3(dw / 2 - 0.04, carcassBottom + frontH / 2, faceZ + PANEL_T / 2 + 0.01),
    })
  } else if (doorKind === 'double') {
    const dw = (w - DOOR_GAP * 3) / 2
    const dh = frontH - DOOR_GAP * 2
    for (const sign of [-1, 1]) {
      const cx = sign * (dw / 2 + DOOR_GAP / 2)
      doors.push({
        geom: new THREE.BoxGeometry(dw, dh, PANEL_T),
        position: new THREE.Vector3(cx, carcassBottom + frontH / 2, faceZ),
      })
      handles.push({
        geom: new THREE.BoxGeometry(0.015, 0.1, 0.02),
        position: new THREE.Vector3(cx - sign * (dw / 2 - 0.04), carcassBottom + frontH / 2, faceZ + PANEL_T / 2 + 0.01),
      })
    }
  }

  // Filler drawer at the bottom of an open (doorKind === 'none') cabinet.
  // Gives users a way to fill leftover space below an oven or other appliance.
  if (doorKind === 'none' && fillerKind === 'drawer') {
    const fh = Math.min(fillerHeight, carcassHeight - 0.05)
    if (fh >= 0.05) {
      const dw = w - DOOR_GAP * 2
      const dh = fh - DOOR_GAP * 2
      const cy = carcassBottom + fh / 2
      doors.push({
        geom: new THREE.BoxGeometry(dw, dh, PANEL_T),
        position: new THREE.Vector3(0, cy, faceZ),
      })
      handles.push({
        geom: new THREE.BoxGeometry(Math.min(0.15, dw * 0.4), 0.015, 0.02),
        position: new THREE.Vector3(0, cy + dh / 2 - 0.04, faceZ + PANEL_T / 2 + 0.01),
      })
    }
  }

  return { carcass, doors, handles }
}

/**
 * Find the lowest appliance (oven, fridge) inside this cabinet's XZ footprint
 * and return the drawer height needed to fill the space below it.
 * Returns 0 when no appliance is found or there is no usable space.
 */
export function computeFillerHeight(cabinet: CabinetNode, nodes: Record<string, AnyNode>): number {
  const hasToeKick = cabinet.style === 'base' || cabinet.style === 'tall'
  const carcassBottom = hasToeKick ? TOE_KICK_H : 0
  const [cx, cy, cz] = cabinet.transform.position
  const rotY = cabinet.transform.rotationY
  const cos = Math.cos(-rotY)
  const sin = Math.sin(-rotY)
  const hw = cabinet.width / 2 + 0.05
  const hd = cabinet.depth / 2 + 0.05

  let lowestItemBottom: number | null = null
  for (const n of Object.values(nodes)) {
    if (n.type !== 'custom-item') continue
    const item = n as CustomItemNode
    const [ix, iy, iz] = item.transform.position
    const relX = ix - cx
    const relZ = iz - cz
    const localX = relX * cos - relZ * sin
    const localZ = relX * sin + relZ * cos
    if (Math.abs(localX) > hw || Math.abs(localZ) > hd) continue
    if (lowestItemBottom === null || iy < lowestItemBottom) lowestItemBottom = iy
  }

  if (lowestItemBottom === null) return 0
  // Convert world Y to local cabinet space; clamp to a sensible range.
  const h = (lowestItemBottom - cy) - carcassBottom
  return Math.max(0, Math.min(h, cabinet.height - carcassBottom - 0.05))
}

function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geoms.length === 0) return new THREE.BufferGeometry()
  if (geoms.length === 1) return geoms[0]

  // Convert each input to non-indexed once so we can iterate consistently.
  // Source BoxGeometries are indexed; toNonIndexed returns a new geometry.
  const nonIndexed: THREE.BufferGeometry[] = []
  for (const g of geoms) {
    nonIndexed.push(g.index ? g.toNonIndexed() : g)
  }

  let totalVerts = 0
  for (const g of nonIndexed) {
    totalVerts += (g.attributes.position as THREE.BufferAttribute).count
  }

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  // UVs must be merged too — without them, the merged carcass mesh has no
  // texture coordinates and any uploaded texture never appears on it.
  const uvs = new Float32Array(totalVerts * 2)
  let offset = 0
  for (const g of nonIndexed) {
    const p = g.attributes.position as THREE.BufferAttribute
    const n = g.attributes.normal as THREE.BufferAttribute
    const u = g.attributes.uv as THREE.BufferAttribute | undefined
    positions.set(p.array as Float32Array, offset * 3)
    normals.set(n.array as Float32Array, offset * 3)
    if (u) uvs.set(u.array as Float32Array, offset * 2)
    offset += p.count
  }

  // Dispose all source / intermediate geometries we own.
  for (let i = 0; i < geoms.length; i++) {
    if (nonIndexed[i] !== geoms[i]) nonIndexed[i].dispose()
    geoms[i].dispose()
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  return out
}
