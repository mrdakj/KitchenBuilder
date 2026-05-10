export const EPS = 1e-4

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}

export function distance2(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return Math.hypot(dx, dy)
}

export function snap(v: number, step: number) {
  return Math.round(v / step) * step
}
