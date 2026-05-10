import { z } from 'zod'
import { BaseNode, MaterialRef, Transform, Vec2, Vec3 } from './base'

export const RoomNode = BaseNode.extend({
  type: z.literal('room'),
  parentId: z.null(),
  name: z.string().default('Room'),
  wallHeight: z.number().default(2.6),
})
export type RoomNode = z.infer<typeof RoomNode>

export const WallNode = BaseNode.extend({
  type: z.literal('wall'),
  start: Vec2,
  end: Vec2,
  thickness: z.number().default(0.1),
  height: z.number().default(2.6),
  material: MaterialRef.default({}),
})
export type WallNode = z.infer<typeof WallNode>

export const CabinetStyle = z.enum(['base', 'wall', 'tall'])
export type CabinetStyle = z.infer<typeof CabinetStyle>

export const CabinetDoorKind = z.enum(['none', 'single', 'double', 'drawers'])
export type CabinetDoorKind = z.infer<typeof CabinetDoorKind>

export const CabinetNode = BaseNode.extend({
  type: z.literal('cabinet'),
  transform: Transform.default({ position: [0, 0, 0], rotationY: 0 }),
  style: CabinetStyle.default('base'),
  width: z.number().default(0.6),
  height: z.number().default(0.85),
  depth: z.number().default(0.6),
  doorKind: CabinetDoorKind.default('single'),
  drawerCount: z.number().int().min(1).max(6).default(3),
  stackedBelowId: z.string().nullable().default(null),
  carcassMaterial: MaterialRef.default({ color: '#ffffff' }),
  doorMaterial: MaterialRef.default({ color: '#e5e5e5' }),
  handleMaterial: MaterialRef.default({ color: '#333333', metalness: 0.8, roughness: 0.2 }),
})
export type CabinetNode = z.infer<typeof CabinetNode>

export const CountertopNode = BaseNode.extend({
  type: z.literal('countertop'),
  transform: Transform.default({ position: [0, 0.9, 0], rotationY: 0 }),
  width: z.number().default(1.2),
  depth: z.number().default(0.62),
  thickness: z.number().default(0.04),
  material: MaterialRef.default({ color: '#222222', roughness: 0.3 }),
})
export type CountertopNode = z.infer<typeof CountertopNode>

export const CustomItemNode = BaseNode.extend({
  type: z.literal('custom-item'),
  transform: Transform.default({ position: [0, 0, 0], rotationY: 0 }),
  assetId: z.string(),
  scale: Vec3.default([1, 1, 1]),
  materialOverrides: z.record(MaterialRef).default({}),
})
export type CustomItemNode = z.infer<typeof CustomItemNode>

// Parent-only container with no geometry. Used to group children so the
// user can move multiple objects together by translating the empty.
export const EmptyNode = BaseNode.extend({
  type: z.literal('empty'),
  transform: Transform.default({ position: [0, 0, 0], rotationY: 0 }),
})
export type EmptyNode = z.infer<typeof EmptyNode>

export const LightNode = BaseNode.extend({
  type: z.literal('light'),
  kind: z.enum(['point', 'spot', 'rect']).default('point'),
  position: Vec3.default([0, 2.4, 0]),
  intensity: z.number().default(1),
  color: z.string().default('#ffffff'),
})
export type LightNode = z.infer<typeof LightNode>

export const AnyNode = z.discriminatedUnion('type', [
  RoomNode,
  WallNode,
  CabinetNode,
  CountertopNode,
  CustomItemNode,
  EmptyNode,
  LightNode,
])
export type AnyNode = z.infer<typeof AnyNode>
export type NodeType = AnyNode['type']
