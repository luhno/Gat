// Small canvas helpers shared by the avatar and office renderers.

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Lighten (>0) or darken (<0) a #rrggbb color by `amount` per channel. */
export const shade = (hex: string, amount: number): string => {
  if (hex.length !== 7 || hex[0] !== "#") return hex
  const n = Number.parseInt(hex.slice(1), 16)
  if (Number.isNaN(n)) return hex
  const channel = (shift: number): number => clamp(((n >> shift) & 0xff) + amount, 0, 255)
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`
}

export const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void => {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Deterministic 0..1 hash so procedural details stay stable between frames. */
export const hash01 = (a: number, b: number): number => {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return n - Math.floor(n)
}

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t
