import { z } from 'zod'

export const Vec2 = z.tuple([z.number(), z.number()])
export const Vec3 = z.tuple([z.number(), z.number(), z.number()])

export const Transform = z.object({
  position: Vec3.default([0, 0, 0]),
  rotationY: z.number().default(0),
})
export type Transform = z.infer<typeof Transform>

export const MaterialRef = z.object({
  color: z.string().default('#dddddd'),
  roughness: z.number().min(0).max(1).default(0.6),
  metalness: z.number().min(0).max(1).default(0.0),
  // Color (diffuse) map — multiplied with `color`.
  textureUrl: z.string().optional(),
  // PBR maps. Same `tex:<id>` / direct-URL convention as textureUrl.
  normalMapUrl: z.string().optional(),
  roughnessMapUrl: z.string().optional(),
  // How many times the texture tiles across the surface (UV repeat).
  // Optional so older saved scenes still parse cleanly. The renderers
  // default to 2 when unset — mild tiling that makes normal-map plank
  // detail visible without specifying it everywhere a node is created.
  textureRepeat: z.number().min(0.1).max(20).optional(),
  // Strength multiplier on the normal map. Renderers default to 1.5 when
  // unset so default-uploaded normal maps read visibly under the dim
  // scene lighting.
  normalScale: z.number().min(0).max(5).optional(),
})
export type MaterialRef = z.infer<typeof MaterialRef>

export const BaseNode = z.object({
  id: z.string(),
  type: z.string(),
  parentId: z.string().nullable(),
  visible: z.boolean().default(true),
  name: z.string().optional(),
})
