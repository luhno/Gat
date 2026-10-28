import type { OfficeMap, Vec2 } from "./types"

/**
 * Positions are WORLD PIXELS. A player position is the center of its feet box (20x14 px).
 * Client and server MUST both use this module so wall resolution is identical on both sides.
 */
export const PLAYER_HALF_WIDTH = 10
export const PLAYER_HALF_HEIGHT = 7

/** Center of a map tile in world pixels. */
export const tileCenter = (map: OfficeMap, tileX: number, tileY: number): Vec2 => ({
  x: tileX * map.tileSize + map.tileSize / 2,
  y: tileY * map.tileSize + map.tileSize / 2,
})

export const clampToMap = (map: OfficeMap, x: number, y: number): Vec2 => ({
  x: Math.min(Math.max(x, PLAYER_HALF_WIDTH), map.width * map.tileSize - PLAYER_HALF_WIDTH),
  y: Math.min(Math.max(y, PLAYER_HALF_HEIGHT), map.height * map.tileSize - PLAYER_HALF_HEIGHT),
})

const overlapsSolidObject = (map: OfficeMap, left: number, top: number, right: number, bottom: number): boolean => {
  const ts = map.tileSize
  return map.objects.some((object) => {
    if (!object.solid) return false
    return (
      left < (object.x + object.w) * ts &&
      right > object.x * ts &&
      top < (object.y + object.h) * ts &&
      bottom > object.y * ts
    )
  })
}

/** True when the feet box at (x, y) intersects a wall tile, a solid object or the map edge. */
export const isBlocked = (map: OfficeMap, x: number, y: number): boolean => {
  const ts = map.tileSize
  const left = x - PLAYER_HALF_WIDTH
  const right = x + PLAYER_HALF_WIDTH
  const top = y - PLAYER_HALF_HEIGHT
  const bottom = y + PLAYER_HALF_HEIGHT
  const minX = Math.floor(left / ts)
  const maxX = Math.ceil(right / ts) - 1
  const minY = Math.floor(top / ts)
  const maxY = Math.ceil(bottom / ts) - 1
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true
      if (map.walls[ty * map.width + tx] === 1) return true
    }
  }
  return overlapsSolidObject(map, left, top, right, bottom)
}

/**
 * Moves the feet box from `from` towards `to`, resolving each axis separately so the player
 * slides along walls instead of sticking. Client predicts with this; server validates with this.
 */
export const resolveMovement = (map: OfficeMap, from: Vec2, to: Vec2): Vec2 => {
  const target = clampToMap(map, to.x, to.y)
  const x = isBlocked(map, target.x, from.y) ? from.x : target.x
  const y = isBlocked(map, x, target.y) ? from.y : target.y
  return { x, y }
}
