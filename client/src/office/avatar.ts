import type { Direction, HairStyle, UserStatus } from "@shared/types"

import { roundRect, shade } from "./draw"

// Procedural avatar drawn to a 2D context. Shared by the office canvas and the home preview,
// so both always show the same character. Coordinates are world pixels, origin at the feet-box center.

export interface AvatarLook {
  shirtColor: string
  skinTone: string
  hairStyle: HairStyle
  status: UserStatus
}

export interface AvatarDraw {
  /** world pixels, center of the 20x14 feet box */
  x: number
  y: number
  dir: Direction
  moving: boolean
  /** seconds, drives the walk cycle */
  time: number
  /** world pixels per tile: 32 in the office, larger for the home preview */
  tileSize: number
  /** per-player offset so avatars don't walk in lockstep */
  phase?: number
  isSelf?: boolean
  /** Remote peer is currently speaking (drives a soft activity ring). */
  speaking?: boolean
}

/** Screen-space offset from the feet box center to the top of the avatar (world px at tileSize 32). */
export const AVATAR_LABEL_OFFSET = 46

const HAIR_COLORS: Record<HairStyle, string> = {
  0: "#2b2018",
  1: "#3d2a1c",
  2: "#1f1915",
  3: "#4a3323",
}

const PANTS = "#252b36"
const SHOES = "#141821"

export function drawAvatar(ctx: CanvasRenderingContext2D, look: AvatarLook, view: AvatarDraw): void {
  const u = view.tileSize / 32
  const phase = view.phase ?? 0
  const stride = view.moving ? Math.sin(view.time * 11 + phase) : 0
  // Idle life: a slow breath when standing still; walking keeps its bounce.
  const bob = view.moving
    ? Math.abs(Math.cos(view.time * 11 + phase)) * 1.5 * u
    : Math.sin(view.time * 2.1 + phase * 1.7) * 0.55 * u
  const blink = !view.moving && Math.sin(view.time * 1.9 + phase * 2.3) > 0.98
  const side = view.dir === "left" || view.dir === "right"
  const faceSign = view.dir === "left" ? -1 : view.dir === "right" ? 1 : 0

  const shirt = look.shirtColor
  const shirtDark = shade(shirt, -34)
  const shirtLight = shade(shirt, 26)
  const skin = look.skinTone
  const skinDark = shade(skin, -30)
  const hair = HAIR_COLORS[look.hairStyle]

  ctx.save()
  ctx.translate(view.x, view.y - bob)

  // Ground shadow, then a colored ring for yourself.
  ctx.fillStyle = "rgba(0,0,0,0.30)"
  ctx.beginPath()
  ctx.ellipse(0, 4.5 * u, 11.5 * u, 4.2 * u, 0, 0, Math.PI * 2)
  ctx.fill()
  if (view.isSelf) {
    ctx.strokeStyle = "rgba(124,92,255,0.9)"
    ctx.lineWidth = 1.6 * u
    ctx.beginPath()
    ctx.ellipse(0, 4.5 * u, 13.6 * u, 5.2 * u, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (view.speaking) {
    // Soft green pulse: a static color cue plus motion, so reduced motion still reads.
    const pulse = 1 + Math.sin(view.time * 5 + phase) * 0.06
    ctx.strokeStyle = "rgba(74,222,128,0.85)"
    ctx.lineWidth = 1.8 * u
    ctx.beginPath()
    ctx.ellipse(0, 4.5 * u, 15.4 * u * pulse, 6 * u * pulse, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  const bodyW = (side ? 13.5 : 16.5) * u
  const legSwing = stride * 3.4 * u

  // Legs and shoes (drawn under the torso), swinging in opposite directions.
  for (const leg of [
    { x: -5.4, swing: legSwing },
    { x: 0.8, swing: -legSwing },
  ]) {
    ctx.fillStyle = PANTS
    roundRect(ctx, leg.x * u, -8 * u + leg.swing, 4.6 * u, 10 * u, 1.8 * u)
    ctx.fill()
    ctx.fillStyle = SHOES
    roundRect(ctx, leg.x * u - 0.3 * u, 1.2 * u + leg.swing, 5.2 * u, 2.4 * u, 1.2 * u)
    ctx.fill()
  }

  // Torso.
  ctx.fillStyle = shirt
  roundRect(ctx, -bodyW / 2, -27 * u, bodyW, 20 * u, 5 * u)
  ctx.fill()
  ctx.fillStyle = shirtLight
  roundRect(ctx, -bodyW / 2 + 1.4 * u, -26 * u, bodyW - 2.8 * u, 4.5 * u, 3 * u)
  ctx.fill()
  ctx.fillStyle = shirtDark
  roundRect(ctx, -bodyW / 2, -9.5 * u, bodyW, 2.6 * u, 1.3 * u)
  ctx.fill()

  // Arms swing opposite to the legs; hands are skin-colored dots.
  for (const armSign of [-1, 1] as const) {
    const swing = armSign === -1 ? -legSwing : legSwing
    const armX = armSign * (bodyW / 2 - 1.6 * u) - 2.2 * u
    ctx.fillStyle = shirtDark
    roundRect(ctx, armX, -24 * u + swing * 0.6, 4.6 * u, 11 * u, 2.3 * u)
    ctx.fill()
    ctx.fillStyle = skin
    ctx.beginPath()
    ctx.arc(armX + 2.3 * u, -12.5 * u + swing * 0.6, 2.1 * u, 0, Math.PI * 2)
    ctx.fill()
  }

  // Head.
  const headX = faceSign * 1.4 * u
  const headY = -34.5 * u
  ctx.fillStyle = skin
  ctx.beginPath()
  ctx.arc(headX, headY, 7.6 * u, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = skinDark
  ctx.beginPath()
  ctx.arc(headX - faceSign * 5.6 * u, headY + 1.2 * u, 1.5 * u, 0, Math.PI * 2)
  ctx.fill()

  // Hair: four simple silhouettes.
  ctx.fillStyle = hair
  if (look.hairStyle === 1) {
    roundRect(ctx, headX - 8.6 * u, headY - 3 * u, 4.2 * u, 15 * u, 2 * u)
    ctx.fill()
    roundRect(ctx, headX + 4.4 * u, headY - 3 * u, 4.2 * u, 15 * u, 2 * u)
    ctx.fill()
  }
  if (look.hairStyle === 3) {
    for (const [dx, dy, r] of [
      [-5.2, -4.6, 3.4],
      [0, -6.4, 3.8],
      [5.2, -4.6, 3.4],
      [-6.6, 0.4, 2.5],
      [6.6, 0.4, 2.5],
    ] as const) {
      ctx.beginPath()
      ctx.arc(headX + dx * u, headY + dy * u, r * u, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    ctx.beginPath()
    ctx.arc(headX, headY - 1.2 * u, 8.3 * u, Math.PI * 1.02, Math.PI * 1.98)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(headX - 8.3 * u, headY - 2.6 * u, 16.6 * u, 2.6 * u)
  }
  if (look.hairStyle === 2) {
    ctx.beginPath()
    ctx.arc(headX, headY - 9.2 * u, 3.7 * u, 0, Math.PI * 2)
    ctx.fill()
  }

  // Face: profile when walking sideways, back of the head when walking up.
  ctx.fillStyle = "#20232b"
  if (view.dir === "down") {
    if (blink) {
      ctx.fillRect(headX - 3.6 * u, headY + 0.2 * u, 2.2 * u, 0.9 * u)
      ctx.fillRect(headX + 1.4 * u, headY + 0.2 * u, 2.2 * u, 0.9 * u)
    } else {
      ctx.beginPath()
      ctx.arc(headX - 2.5 * u, headY + 0.6 * u, 1.15 * u, 0, Math.PI * 2)
      ctx.arc(headX + 2.5 * u, headY + 0.6 * u, 1.15 * u, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (side) {
    ctx.beginPath()
    if (blink) ctx.fillRect(headX + faceSign * 2.4 * u, headY + 0.2 * u, 2.2 * u, 0.9 * u)
    else {
      ctx.arc(headX + faceSign * 3.4 * u, headY + 0.4 * u, 1.1 * u, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = skinDark
    ctx.beginPath()
    ctx.arc(headX + faceSign * 5.4 * u, headY + 2.2 * u, 1 * u, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}
