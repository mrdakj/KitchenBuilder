// Module-level cache of each loaded asset's normalized bounding box size.
// Populated by the CustomItemRenderer the first time it loads a GLTF; read
// by snap/collision so that custom-items use their actual model footprint
// (e.g. a wide-but-shallow sink) instead of a fixed 0.5 cube.
//
// Sizes here are AFTER the renderer's "fit to 0.5m max" normalization but
// BEFORE the per-node `scale` is applied. Multiply by node.scale.[xyz] to
// get the world-space dimensions.

const bboxes = new Map<string, [number, number, number]>()

export function setAssetBbox(id: string, size: [number, number, number]) {
  bboxes.set(id, size)
}

export function getAssetBbox(id: string): [number, number, number] | null {
  return bboxes.get(id) ?? null
}
