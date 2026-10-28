import type { Direction, HairStyle, MapObject, OfficeMap, UserStatus } from "@shared/types"

import { drawAvatar } from "./avatar"
import { hash01, roundRect, shade } from "./draw"

// Canvas renderer for the office: procedural floors per zone theme, walls with a fake
// 2.5D depth, furniture and y-sorted avatars. Everything derives from OfficeMap data.

const WALL_HEIGHT = 20

export interface ViewRect {
  /** world pixels */
  left: number
  top: number
  right: number
  bottom: number
}

export interface RenderPlayer {
  id: string
  /** world pixels: center of the feet box */
  x: number
  y: number
  dir: Direction
  moving: boolean
  shirtColor: string
  skinTone: string
  hairStyle: HairStyle
  status: UserStatus
}

export const worldView = (cameraX: number, cameraY: number, screenW: number, screenH: number, zoom: number): ViewRect => {
  const halfW = screenW / 2 / zoom
  const halfH = screenH / 2 / zoom
  return { left: cameraX - halfW, top: cameraY - halfH, right: cameraX + halfW, bottom: cameraY + halfH }
}

// ── Floors ────────────────────────────────────────────────────────────────────

interface Theme {
  base: [string, string, string]
  line: string
}

const theme = (hex: string, line: string): Theme => ({
  base: [shade(hex, -5), hex, shade(hex, 5)],
  line,
})

const THEMES: Theme[] = [
  theme("#313a49", "rgba(255,255,255,0.05)"), // 0 open desks: carpet tiles
  theme("#584430", "rgba(0,0,0,0.18)"), //       1 wood planks
  theme("#33474a", "rgba(255,255,255,0.05)"), // 2 meeting: blue-green carpet
  theme("#3b4553", "rgba(0,0,0,0.22)"), //       3 kitchen: checker tiles
  theme("#493641", "rgba(255,255,255,0.08)"), // 4 lounge: patterned rug floor
  theme("#39334a", "rgba(192,132,252,0.10)"), // 5 focus pods: purple carpet
  theme("#252b36", "rgba(255,255,255,0.03)"), // 6 corridor: concrete
]

const drawFloorTile = (ctx: CanvasRenderingContext2D, map: OfficeMap, tx: number, ty: number): void => {
  const ts = map.tileSize
  const x = tx * ts
  const y = ty * ts
  const palette = THEMES[map.floors[ty * map.width + tx] % THEMES.length]
  const variant = Math.floor(hash01(tx, ty) * 3)
  ctx.fillStyle = palette.base[variant]
  ctx.fillRect(x, y, ts, ts)

  switch (map.floors[ty * map.width + tx] % THEMES.length) {
    case 1: {
      // Staggered wood planks.
      ctx.fillStyle = palette.line
      ctx.fillRect(x, y + 7, ts, 1)
      ctx.fillRect(x, y + 15, ts, 1)
      ctx.fillRect(x, y + 23, ts, 1)
      ctx.fillRect(x + ((ty % 2) * 16 + 8), y, 1, ts)
      break
    }
    case 2: {
      // Diagonal carpet seams.
      ctx.strokeStyle = palette.line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y + ts)
      ctx.lineTo(x + ts, y)
      ctx.stroke()
      break
    }
    case 3: {
      // Kitchen checkerboard with grout.
      if ((tx + ty) % 2 === 0) {
        ctx.fillStyle = shade("#3b4553", 7)
        ctx.fillRect(x, y, ts, ts)
      }
      ctx.fillStyle = palette.line
      ctx.fillRect(x, y + ts - 1, ts, 1)
      ctx.fillRect(x + ts - 1, y, 1, ts)
      break
    }
    case 4: {
      // Lounge: diamond motif.
      ctx.fillStyle = palette.line
      ctx.fillRect(x + ts / 2 - 2, y + ts / 2 - 2, 4, 4)
      break
    }
    case 5: {
      // Focus pods: dotted carpet.
      ctx.fillStyle = palette.line
      ctx.fillRect(x + 8, y + 8, 2, 2)
      ctx.fillRect(x + 22, y + 22, 2, 2)
      break
    }
    case 6: {
      ctx.fillStyle = palette.line
      ctx.fillRect(x, y + ts - 1, ts, 1)
      break
    }
    default: {
      // Open desk carpet: tile seams + faint checker.
      ctx.fillStyle = palette.line
      ctx.fillRect(x, y + ts - 1, ts, 1)
      ctx.fillRect(x + ts - 1, y, 1, ts)
      break
    }
  }
}

const drawRug = (ctx: CanvasRenderingContext2D, object: MapObject, ts: number): void => {
  const x = object.x * ts
  const y = object.y * ts
  const w = object.w * ts
  const h = object.h * ts
  const colors = ["#4d4358", "#46525c", "#5a4a40", "#45506a"]
  ctx.fillStyle = colors[Math.floor(hash01(object.x, object.y) * colors.length)]
  roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 6)
  ctx.fill()
  ctx.strokeStyle = "rgba(255,255,255,0.10)"
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.strokeStyle = "rgba(0,0,0,0.14)"
  ctx.lineWidth = 1
  roundRect(ctx, x + 10, y + 10, w - 20, h - 20, 4)
  ctx.stroke()
}

const drawZoneLabels = (ctx: CanvasRenderingContext2D, map: OfficeMap, view: ViewRect): void => {
  const ts = map.tileSize
  ctx.save()
  ctx.font = "600 11px ui-sans-serif, system-ui, -apple-system, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = "rgba(232,235,242,0.26)"
  for (const zone of map.zones) {
    const centerX = (zone.x + zone.w / 2) * ts
    const centerY = (zone.y + zone.h / 2) * ts
    if (centerX < view.left - 200 || centerX > view.right + 200 || centerY < view.top - 200 || centerY > view.bottom + 200) {
      continue
    }
    ctx.fillText(zone.name.toUpperCase(), centerX, centerY)
  }
  ctx.restore()
}

// ── Walls ─────────────────────────────────────────────────────────────────────

const drawWall = (ctx: CanvasRenderingContext2D, wx: number, wy: number, ts: number): void => {
  const x = wx * ts
  const y = wy * ts
  // Front face (the strip under the shifted top face) plus the top face: fake wall height.
  ctx.fillStyle = "#191e27"
  ctx.fillRect(x, y + ts - WALL_HEIGHT, ts, WALL_HEIGHT)
  ctx.fillStyle = "rgba(0,0,0,0.25)"
  ctx.fillRect(x, y + ts - 3, ts, 3)
  ctx.fillStyle = "#3a4250"
  ctx.fillRect(x, y - WALL_HEIGHT, ts, ts)
  ctx.fillStyle = "rgba(255,255,255,0.10)"
  ctx.fillRect(x, y - WALL_HEIGHT, ts, 2)
  ctx.fillStyle = "rgba(255,255,255,0.04)"
  ctx.fillRect(x + 2, y - WALL_HEIGHT + 3, ts - 4, 1)
  ctx.fillStyle = "rgba(0,0,0,0.16)"
  ctx.fillRect(x, y + ts - WALL_HEIGHT - 2, ts, 2)
}

// ── Furniture ─────────────────────────────────────────────────────────────────

const shadow = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void => {
  ctx.fillStyle = "rgba(0,0,0,0.20)"
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

const drawObject = (ctx: CanvasRenderingContext2D, object: MapObject, ts: number): void => {
  const x = object.x * ts
  const y = object.y * ts
  const w = object.w * ts
  const h = object.h * ts
  const cx = x + w / 2
  const cy = y + h / 2

  switch (object.kind) {
    case "desk": {
      shadow(ctx, cx, y + h - 2, w * 0.44, 4)
      ctx.fillStyle = "#57402b"
      roundRect(ctx, x + 1, y + 4, w - 2, h - 6, 3)
      ctx.fill()
      ctx.fillStyle = "#7d5f43"
      roundRect(ctx, x + 2, y + 3, w - 4, h - 10, 3)
      ctx.fill()
      ctx.fillStyle = "rgba(255,255,255,0.08)"
      ctx.fillRect(x + 5, y + 4, w - 10, 2)
      if (w >= 64) {
        // Monitor and keyboard.
        ctx.fillStyle = "#141922"
        roundRect(ctx, cx - 12, y + 1, 24, 14, 2)
        ctx.fill()
        ctx.fillStyle = "#2c4a6e"
        ctx.fillRect(cx - 10, y + 3, 20, 10)
        ctx.fillStyle = "#c6ccd6"
        roundRect(ctx, cx - 14, y + h - 11, 28, 6, 2)
        ctx.fill()
      }
      break
    }
    case "table": {
      shadow(ctx, cx, y + h - 2, w * 0.42, 5)
      ctx.fillStyle = "#5d4630"
      roundRect(ctx, x + 1, y + 4, w - 2, h - 6, 4)
      ctx.fill()
      ctx.fillStyle = "#80613f"
      roundRect(ctx, x + 3, y + 3, w - 6, h - 10, 4)
      ctx.fill()
      ctx.strokeStyle = "rgba(255,255,255,0.07)"
      ctx.lineWidth = 1
      roundRect(ctx, x + 9, y + 7, w - 18, h - 18, 3)
      ctx.stroke()
      break
    }
    case "counter": {
      shadow(ctx, cx, y + h - 2, w * 0.44, 4)
      ctx.fillStyle = "#8b929d"
      roundRect(ctx, x, y + 5, w, h - 7, 3)
      ctx.fill()
      ctx.fillStyle = "#c2c9d3"
      roundRect(ctx, x + 1, y + 3, w - 2, h - 13, 3)
      ctx.fill()
      ctx.fillStyle = "rgba(255,255,255,0.22)"
      ctx.fillRect(x + 3, y + 4, w - 6, 2)
      break
    }
    case "chair": {
      shadow(ctx, cx, cy + 9, 9, 3)
      ctx.fillStyle = "#2e3541"
      roundRect(ctx, x + 6, y + 5, 20, 22, 5)
      ctx.fill()
      ctx.fillStyle = "#414b5c"
      roundRect(ctx, x + 7, y + 12, 18, 14, 4)
      ctx.fill()
      break
    }
    case "stool": {
      shadow(ctx, cx, cy + 8, 8, 3)
      ctx.fillStyle = "#2b333d"
      ctx.beginPath()
      ctx.arc(cx, cy, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#4a5665"
      ctx.beginPath()
      ctx.arc(cx, cy - 1, 7, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case "sofa": {
      const palette = ["#4c5f7d", "#5b6b8a", "#77574a"]
      const color = palette[Math.floor(hash01(object.x, object.y) * palette.length)]
      shadow(ctx, cx, y + h - 2, w * 0.44, 5)
      ctx.fillStyle = shade(color, -22)
      roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 5)
      ctx.fill()
      ctx.fillStyle = color
      roundRect(ctx, x + 3, y + 9, w - 6, h - 12, 4)
      ctx.fill()
      ctx.fillStyle = shade(color, 12)
      const cushions = Math.max(2, Math.round(w / 40))
      for (let i = 0; i < cushions; i++) {
        const cw = (w - 10) / cushions - 3
        roundRect(ctx, x + 5 + i * (cw + 3), y + 12, cw, h - 18, 3)
        ctx.fill()
      }
      break
    }
    case "plant": {
      shadow(ctx, cx, y + h - 2, 9, 3)
      ctx.fillStyle = "#6d4a33"
      ctx.beginPath()
      ctx.moveTo(cx - 7, y + h - 11)
      ctx.lineTo(cx + 7, y + h - 11)
      ctx.lineTo(cx + 5, y + h - 1)
      ctx.lineTo(cx - 5, y + h - 1)
      ctx.closePath()
      ctx.fill()
      const greens = ["#3f7a4e", "#4d945c", "#2f5f3d", "#5aa869"]
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 + hash01(object.x + i, object.y)
        ctx.fillStyle = greens[i % greens.length]
        ctx.beginPath()
        ctx.ellipse(
          cx + Math.cos(angle) * 6,
          y + h - 15 + Math.sin(angle) * 5,
          6.5 - (i % 2) * 1.5,
          5,
          angle,
          0,
          Math.PI * 2,
        )
        ctx.fill()
      }
      break
    }
    case "whiteboard": {
      shadow(ctx, cx, y + h - 1, w * 0.42, 3)
      ctx.fillStyle = "#20262f"
      roundRect(ctx, x + 1, y + 3, w - 2, h - 5, 3)
      ctx.fill()
      ctx.fillStyle = "#dde4e8"
      roundRect(ctx, x + 4, y + 5, w - 8, h - 9, 2)
      ctx.fill()
      ctx.strokeStyle = "#7c5cff"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x + 8, y + h / 2)
      ctx.lineTo(x + 18, y + h / 2)
      ctx.lineTo(x + 26, y + h / 2 - 4)
      ctx.stroke()
      ctx.strokeStyle = "#4ade80"
      ctx.beginPath()
      ctx.moveTo(x + w - 30, y + h / 2 + 4)
      ctx.lineTo(x + w - 8, y + h / 2 + 4)
      ctx.stroke()
      break
    }
    case "bookshelf": {
      shadow(ctx, cx, y + h - 1, w * 0.42, 3)
      ctx.fillStyle = "#3d2c1e"
      roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 2)
      ctx.fill()
      ctx.fillStyle = "#5a422c"
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6)
      const bookColors = ["#a3564a", "#4a7c8c", "#b08a4a", "#5a6e9a", "#7a5a8c", "#4a8c6a"]
      const rows = Math.max(2, Math.floor(h / 22))
      for (let row = 0; row < rows; row++) {
        const rowY = y + 5 + row * ((h - 10) / rows)
        ctx.fillStyle = "#3d2c1e"
        ctx.fillRect(x + 3, rowY + (h - 10) / rows - 3, w - 6, 3)
        let bookX = x + 4
        let index = 0
        while (bookX < x + w - 6) {
          const bookW = 3 + Math.floor(hash01(object.x + bookX, object.y + row) * 3)
          ctx.fillStyle = bookColors[(index + row) % bookColors.length]
          ctx.fillRect(bookX, rowY, bookW, (h - 10) / rows - 4)
          bookX += bookW + 1
          index++
        }
      }
      break
    }
    case "lamp": {
      ctx.fillStyle = "rgba(255,214,140,0.09)"
      ctx.beginPath()
      ctx.arc(cx, cy, 30, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#5b6472"
      ctx.fillRect(cx - 1.5, cy - 2, 3, 14)
      ctx.fillStyle = "#f6d98a"
      ctx.beginPath()
      ctx.arc(cx, cy - 4, 5.5, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case "tv": {
      shadow(ctx, cx, y + h - 1, w * 0.42, 3)
      ctx.fillStyle = "#10141b"
      roundRect(ctx, x + 2, y + 3, w - 4, h - 6, 2)
      ctx.fill()
      ctx.fillStyle = "#1b3049"
      roundRect(ctx, x + 4, y + 5, w - 8, h - 10, 1)
      ctx.fill()
      ctx.fillStyle = "rgba(120,180,255,0.16)"
      ctx.fillRect(x + 5, y + 6, w - 10, 3)
      break
    }
    case "crate": {
      shadow(ctx, cx, y + h - 1, w * 0.42, 3)
      ctx.fillStyle = "#4a3624"
      roundRect(ctx, x + 2, y + 3, w - 4, h - 5, 2)
      ctx.fill()
      ctx.fillStyle = "#6b4f31"
      roundRect(ctx, x + 4, y + 5, w - 8, h - 9, 1)
      ctx.fill()
      ctx.strokeStyle = "rgba(0,0,0,0.28)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x + 5, y + 6)
      ctx.lineTo(x + w - 5, y + h - 5)
      ctx.moveTo(x + w - 5, y + 6)
      ctx.lineTo(x + 5, y + h - 5)
      ctx.stroke()
      break
    }
    case "door": {
      // Floor mat marking the walkable gap in a wall.
      ctx.fillStyle = "rgba(124,92,255,0.16)"
      roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 2)
      ctx.fill()
      ctx.fillStyle = "rgba(0,0,0,0.28)"
      if (w > h) {
        ctx.fillRect(x, y, 3, h)
        ctx.fillRect(x + w - 3, y, 3, h)
      } else {
        ctx.fillRect(x, y, w, 3)
        ctx.fillRect(x, y + h - 3, w, 3)
      }
      break
    }
    case "rug":
      break
  }
}

// ── Static draw list ──────────────────────────────────────────────────────────

interface StaticEntry {
  /** comparison key in world pixels (bottom edge) */
  sortY: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  wall: { x: number; y: number } | null
  object: MapObject | null
}

const staticsCache = new WeakMap<OfficeMap, StaticEntry[]>()

const getStatics = (map: OfficeMap): StaticEntry[] => {
  const cached = staticsCache.get(map)
  if (cached) return cached
  const entries: StaticEntry[] = []
  const ts = map.tileSize
  if (ts > 0) {
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (map.walls[ty * map.width + tx] !== 1) continue
        entries.push({
          sortY: (ty + 1) * ts,
          minX: tx * ts,
          maxX: (tx + 1) * ts,
          minY: (ty - 1) * ts,
          maxY: (ty + 1) * ts,
          wall: { x: tx, y: ty },
          object: null,
        })
      }
    }
  }
  for (const object of map.objects) {
    if (object.kind === "rug") continue // flat: drawn during the floor pass
    entries.push({
      sortY: (object.y + object.h) * ts,
      minX: object.x * ts,
      maxX: (object.x + object.w) * ts,
      minY: object.y * ts,
      maxY: (object.y + object.h) * ts,
      wall: null,
      object,
    })
  }
  entries.sort((a, b) => a.sortY - b.sortY)
  staticsCache.set(map, entries)
  return entries
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export const drawScene = (
  ctx: CanvasRenderingContext2D,
  map: OfficeMap,
  players: RenderPlayer[],
  selfId: string | null,
  time: number,
  view: ViewRect,
): void => {
  const ts = map.tileSize
  drawFloor(ctx, map, view)

  const statics = getStatics(map)
  const sorted = [...players].sort((a, b) => a.y - b.y)
  let staticIndex = 0
  let playerIndex = 0
  while (staticIndex < statics.length && statics[staticIndex].sortY < view.top - WALL_HEIGHT) staticIndex++
  while (playerIndex < sorted.length && sorted[playerIndex].y < view.top - 80) playerIndex++

  while (staticIndex < statics.length || playerIndex < sorted.length) {
    const entry = statics[staticIndex]
    const player = sorted[playerIndex]
    const drawStaticNext = !player || (entry !== undefined && entry.sortY <= player.y + 10)
    if (drawStaticNext && entry) {
      if (entry.maxX > view.left && entry.minX < view.right && entry.maxY > view.top && entry.minY < view.bottom) {
        if (entry.wall) drawWall(ctx, entry.wall.x, entry.wall.y, ts)
        else if (entry.object) drawObject(ctx, entry.object, ts)
      }
      staticIndex++
    } else if (player) {
      if (player.x > view.left - 80 && player.x < view.right + 80 && player.y > view.top - 80 && player.y < view.bottom + 40) {
        drawAvatar(
          ctx,
          {
            shirtColor: player.shirtColor,
            skinTone: player.skinTone,
            hairStyle: player.hairStyle,
            status: player.status,
          },
          {
            x: player.x,
            y: player.y,
            dir: player.dir,
            moving: player.moving,
            time,
            tileSize: ts,
            phase: hash01(player.x * 0.01, player.y * 0.01) * Math.PI * 2,
            isSelf: player.id === selfId,
          },
        )
      }
      playerIndex++
    }
  }
}

const drawFloor = (ctx: CanvasRenderingContext2D, map: OfficeMap, view: ViewRect): void => {
  const ts = map.tileSize
  const minX = Math.max(0, Math.floor(view.left / ts))
  const maxX = Math.min(map.width - 1, Math.ceil(view.right / ts))
  const minY = Math.max(0, Math.floor(view.top / ts))
  const maxY = Math.min(map.height - 1, Math.ceil(view.bottom / ts))
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) drawFloorTile(ctx, map, tx, ty)
  }
  for (const object of map.objects) {
    if (object.kind !== "rug") continue
    if (
      (object.x + object.w) * ts > view.left &&
      object.x * ts < view.right &&
      (object.y + object.h) * ts > view.top &&
      object.y * ts < view.bottom
    ) {
      drawRug(ctx, object, ts)
    }
  }
  drawZoneLabels(ctx, map, view)
}
